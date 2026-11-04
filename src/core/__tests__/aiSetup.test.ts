import { describe, expect, it } from "vitest";
import { cudaComponents, engineDep, modelDep, runtimeDeps, totalBytes } from "@/core/aiDeps";
import { forgetSeen, hasSeen, markSeen } from "@/core/setupMemory";
import type { BackendOption } from "@/types/agent";
import type { ModelStatus } from "@/types/models";
import type { RuntimeStatus } from "@/types/runtime";
import type { SdcppOption } from "@/types/sdcpp";

function runtime(id: string, bytes: number, installed = false): RuntimeStatus {
  return {
    id,
    label: `runtime.${id}`,
    note: `runtime.${id}.note`,
    group: id.startsWith("cuda") ? "cuda12" : "ort",
    core: !id.startsWith("cud") || id === "cuda" || id === "cuda13",
    bytes,
    installed,
    bundled: false,
    license: "MIT",
    dir: "",
  };
}

function option(overrides: Partial<BackendOption> = {}): BackendOption {
  return {
    kind: "cuda13",
    label: "CUDA 13",
    note: "",
    available: true,
    runtime: "cuda13",
    runtime_installed: false,
    download_bytes: 160,
    missing: [],
    ...overrides,
  };
}

function model(overrides: Partial<ModelStatus> = {}): ModelStatus {
  return {
    id: "z-image-turbo",
    name: "Z-Image Turbo",
    feature: "image-gen",
    tag: "visual",
    license: "Apache-2.0",
    family: "z_image_turbo",
    approx_bytes: 1000,
    recommended: true,
    bundled: false,
    bundle_eligible: false,
    installed: false,
    path: null,
    total_files: 2,
    installed_files: 0,
    reusable_bytes: 0,
    shared_bytes: 0,
    regions: ["cn"],
    sources: [],
    files: [
      { filename: "a.safetensors", approx_bytes: 600, installed: false, reusable: false, bytes: null },
      { filename: "b.safetensors", approx_bytes: 400, installed: false, reusable: false, bytes: null },
    ],
    ...overrides,
  };
}

describe("cudaComponents", () => {
  it("按大版本给不同的组件 id", () => {
    expect(cudaComponents("cuda")).toEqual(["cudart", "cublas", "cufft", "cudnn"]);
    expect(cudaComponents("cuda13")).toEqual(["cudart13", "cublas13", "cufft13", "cudnn13"]);
  });
});

describe("runtimeDeps", () => {
  it("本体没装时只报一条，体积含同版本组件（后端会一起下）", () => {
    const items = [
      runtime("cuda13", 160),
      runtime("cudart13", 3),
      runtime("cublas13", 400),
      runtime("cufft13", 200),
      runtime("cudnn13", 1200),
    ];
    const deps = runtimeDeps(option(), items, (key) => key);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.kind).toBe("runtime");
    expect(deps[0]!.id).toBe("cuda13");
    // 160 + 3 + 400 + 200 + 1200：不能只报本体，也不能把组件另开四条重复计。
    expect(deps[0]!.bytes).toBe(1963);
    expect(deps[0]!.hint).toBe("4");
  });

  it("本体装了但缺组件时逐条列出", () => {
    const items = [
      runtime("cuda13", 160, true),
      runtime("cudart13", 3, true),
      runtime("cublas13", 400, true),
      runtime("cufft13", 200, false),
      runtime("cudnn13", 1200, false),
    ];
    const deps = runtimeDeps(
      option({ runtime_installed: true, missing: ["cufft13", "cudnn13"] }),
      items,
      (key) => key,
    );
    expect(deps.map((dep) => dep.id)).toEqual(["cufft13", "cudnn13"]);
    expect(deps.every((dep) => dep.kind === "component")).toBe(true);
    expect(totalBytes(deps)).toBe(1400);
  });

  it("装齐了就没有依赖", () => {
    const items = [
      runtime("cuda", 160, true),
      runtime("cudart", 3, true),
      runtime("cublas", 400, true),
      runtime("cufft", 200, true),
      runtime("cudnn", 1200, true),
    ];
    const deps = runtimeDeps(
      option({ kind: "cuda12", runtime: "cuda", runtime_installed: true }),
      items,
      (key) => key,
    );
    expect(deps).toHaveLength(0);
  });

  it("非 CUDA 后端不下组件", () => {
    const deps = runtimeDeps(
      option({ kind: "directml", runtime: "directml", runtime_installed: true }),
      [runtime("directml", 0, true)],
      (key) => key,
    );
    expect(deps).toHaveLength(0);
  });
});

describe("engineDep / modelDep", () => {
  it("引擎依赖用 sdcpp-<device> 作为管理器里的 id", () => {
    const pack: SdcppOption = {
      kind: "cuda12",
      label: "sdcpp.cuda12",
      note: "",
      available: true,
      usable: true,
      recommended: true,
      installed: false,
      bytes: 917,
    };
    const dep = engineDep(pack, "CUDA 12");
    expect(dep.id).toBe("sdcpp-cuda12");
    expect(dep.kind).toBe("engine");
    expect(dep.bytes).toBe(917);
  });

  it("模型只算还没下完的那部分", () => {
    const dep = modelDep(model());
    expect(dep.id).toBe("z-image-turbo");
    expect(dep.kind).toBe("model");
    expect(dep.bytes).toBe(1000);
    expect(dep.files).toBe(2);
  });
});

describe("setupMemory", () => {
  it("按「功能 + 推荐后端」记忆，换后端会重新提示", () => {
    forgetSeen("image");
    expect(hasSeen("image", "cuda12")).toBe(false);
    markSeen("image", "cuda12");
    expect(hasSeen("image", "cuda12")).toBe(true);
    // 换了显卡 / 驱动 → 推荐变成 cuda13：应该再引导一次。
    expect(hasSeen("image", "cuda13")).toBe(false);
    forgetSeen("image");
    expect(hasSeen("image", "cuda12")).toBe(false);
  });
});

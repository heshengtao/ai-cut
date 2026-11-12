/**
 * 变声入口的「准备」向导：缺运行时 / 缺模型必须进同一个弹窗计划，
 * 而不是只弹一条 toast。MeanVC2 是完整包（转换图 + 音色编码器），
 * 缺任何一个文件都只对应一个下载项。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useVoiceSetup } from "@/composables/useAiSetup";
import { useDeviceStore } from "@/stores/device";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import type { BackendInfo, BackendOption, DeviceProfile } from "@/types/agent";
import type { ModelStatus } from "@/types/models";
import type { RuntimeStatus } from "@/types/runtime";

function backendOption(overrides: Partial<BackendOption> = {}): BackendOption {
  return {
    kind: "cuda12",
    label: "CUDA 12",
    note: "",
    available: true,
    runtime: "cuda",
    runtime_installed: false,
    download_bytes: 160,
    missing: [],
    ...overrides,
  };
}

function cpuOption(): BackendOption {
  return backendOption({
    kind: "cpu",
    label: "CPU",
    runtime: "cpu",
    runtime_installed: true,
    download_bytes: 0,
  });
}

function backendInfo(options: BackendOption[], preference: BackendInfo["preference"]): BackendInfo {
  const device: DeviceProfile = { vendor: "nvidia", name: "RTX 4060", driver: "580.0" };
  return {
    preference,
    current: preference,
    recommended: preference,
    platform: "windows/x86_64",
    device,
    loaded_runtime: null,
    restart_required: false,
    ep_ready: false,
    options,
  };
}

function runtime(id: string, bytes: number, installed = false): RuntimeStatus {
  return {
    id,
    label: `runtime.${id}`,
    note: `runtime.${id}.note`,
    group: id.startsWith("cud") ? "cuda12" : "ort",
    core: !id.startsWith("cud"),
    bytes,
    installed,
    bundled: false,
    license: "MIT",
    dir: "",
  };
}

function voiceModel(installed: boolean): ModelStatus {
  return {
    id: "meanvc2-int8",
    name: "MeanVC2",
    feature: "voice-change",
    tag: "audio",
    license: "Apache-2.0 + CC-BY-SA-3.0",
    family: "sense_voice",
    approx_bytes: 4770,
    recommended: false,
    bundled: false,
    bundle_eligible: false,
    installed,
    path: installed ? "C:/models/meanvc2-int8" : null,
    total_files: 6,
    installed_files: installed ? 6 : 0,
    reusable_bytes: 0,
    shared_bytes: 0,
    regions: ["cn"],
    sources: [],
    files: [
      {
        filename: "dit.int8.onnx",
        approx_bytes: 900,
        installed,
        reusable: false,
        bytes: installed ? 900 : null,
      },
      {
        filename: "speaker.int8.onnx",
        approx_bytes: 3870,
        installed,
        reusable: false,
        bytes: installed ? 3870 : null,
      },
    ],
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useVoiceSetup", () => {
  it("缺运行时与变声包时合成一个弹窗计划", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    const runtimes = useRuntimesStore();
    device.info = backendInfo([backendOption()], "cuda12");
    models.catalog = [voiceModel(false)];
    runtimes.items = [
      runtime("cuda", 160),
      runtime("cudart", 3),
      runtime("cublas", 400),
      runtime("cufft", 200),
      runtime("cudnn", 1200),
    ];

    const setup = useVoiceSetup();
    expect(await setup.ensure()).toBe(false);
    expect(setup.open.value).toBe(true);

    const plan = setup.plan.value;
    expect(plan).not.toBeNull();
    expect(plan!.deps.map((dep) => dep.id)).toEqual(["cuda", "meanvc2-int8"]);
    expect(plan!.restartAfter).toBe(true);
    // 运行时 1963 + 完整变声包 4770（含音色编码器）。
    expect(plan!.totalBytes).toBe(1963 + 900 + 3870);
  });

  it("只缺变声包时不把后端 / 重启塞进弹窗", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    device.info = backendInfo([cpuOption()], "cpu");
    models.catalog = [voiceModel(false)];

    const setup = useVoiceSetup();
    expect(await setup.ensure()).toBe(false);

    const plan = setup.plan.value;
    expect(plan!.deps.map((dep) => dep.id)).toEqual(["meanvc2-int8"]);
    expect(plan!.totalBytes).toBe(4770);
    expect(plan!.backend).toBeNull();
    expect(plan!.restartAfter).toBe(false);
  });

  it("运行时与模型都齐了就直接进页面，不弹窗", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    device.info = backendInfo([cpuOption()], "cpu");
    models.catalog = [voiceModel(true)];

    const setup = useVoiceSetup();
    expect(await setup.ensure()).toBe(true);
    expect(setup.open.value).toBe(false);
  });
});

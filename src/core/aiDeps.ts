/**
 * **依赖解析**：某个 AI 功能要跑起来，还差哪些东西。
 *
 * 三层依赖，按「先引擎 / 运行时、后权重」排序（下载顺序即数组顺序）：
 * 1. `engine`   —— sd.cpp 的引擎包（画图 / 视频）；
 * 2. `runtime`  —— ONNX Runtime 本体（CUDA 12 / 13）；
 * 3. `component`—— CUDA 的四件套（cudart / cuBLAS / cuFFT / cuDNN）；
 * 4. `model`    —— 权重。
 *
 * 体积必须算**真实要下的量**：CUDA 本体一条命令就会顺带补齐同大版本的全部组件
 * （`runtime.rs` 的 `bundle_plan`），所以「本体没装」时只报本体 + 组件合计的**一个**
 * 数字，不能再把四个组件重复列一遍，否则总量会翻倍、用户以为要下 4 GB。
 */
import type { BackendOption } from "@/types/agent";
import type { ModelStatus } from "@/types/models";
import type { RuntimeStatus } from "@/types/runtime";
import type { SdcppOption } from "@/types/sdcpp";
import type { SetupDep } from "@/types/setup";
import { missingBytes } from "@/utils/size";

/** CUDA provider 硬依赖的四个组件 id（后端没下发 `missing` 时的兜底清单）。 */
export function cudaComponents(runtime: string): string[] {
  const suffix = runtime === "cuda13" ? "13" : "";
  return [`cudart${suffix}`, `cublas${suffix}`, `cufft${suffix}`, `cudnn${suffix}`];
}

/** 一个 sd.cpp 引擎包 → 一条依赖（CUDA 版是「引擎 + 运行库」两个文件，一起算）。 */
export function engineDep(option: SdcppOption, label: string): SetupDep {
  return {
    kind: "engine",
    id: `sdcpp-${option.kind}`,
    label,
    bytes: option.bytes,
    installed: option.installed,
    usable: option.usable,
  };
}

/** 一个模型 → 一条依赖。 */
export function modelDep(model: ModelStatus): SetupDep {
  return {
    kind: "model",
    id: model.id,
    label: model.name,
    bytes: missingBytes(model),
    installed: model.installed,
    usable: true,
    files: model.total_files,
  };
}

/**
 * 一个 ONNX Runtime 后端 → 依赖列表。
 *
 * - 本体没装：**一条**依赖（本体 + 同版本组件打包下，体积合并）；
 * - 本体装了但缺组件：每个缺的组件一条（可以单独补）。
 */
export function runtimeDeps(
  option: BackendOption,
  items: RuntimeStatus[],
  labelOf: (key: string) => string,
): SetupDep[] {
  const find = (id: string): RuntimeStatus | undefined => items.find((item) => item.id === id);
  const core = find(option.runtime);
  if (!option.runtime_installed) {
    const missing = new Set<string>([...(option.missing ?? []), ...cudaComponents(option.runtime)]);
    const parts = [...missing].map(find).filter((item): item is RuntimeStatus => Boolean(item));
    const bytes = (core?.bytes ?? option.download_bytes) + parts.reduce((sum, part) => sum + part.bytes, 0);
    return [
      {
        kind: "runtime",
        id: option.runtime,
        label: core ? labelOf(core.label) : option.label,
        bytes,
        installed: false,
        usable: true,
        hint: parts.length > 0 ? String(parts.length) : undefined,
      },
    ];
  }
  const deps: SetupDep[] = [];
  const ids = new Set<string>([...(option.missing ?? []), ...cudaComponents(option.runtime)]);
  for (const id of ids) {
    const item = find(id);
    if (!item || item.installed) continue;
    if (deps.some((dep) => dep.id === id)) continue;
    deps.push({
      kind: "component",
      id,
      label: labelOf(item.label),
      bytes: item.bytes,
      installed: false,
      usable: true,
      group: option.runtime === "cuda13" ? "cuda13" : "cuda12",
    });
  }
  return deps;
}

/** 一组依赖里总共还差多少字节。 */
export function totalBytes(deps: SetupDep[]): number {
  return deps.reduce((sum, dep) => (dep.installed ? sum : sum + dep.bytes), 0);
}

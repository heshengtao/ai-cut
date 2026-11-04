/** 「还缺什么才能跑这个 AI 功能」的统一计划结构（模型 / 运行时 / 引擎共用）。 */
import type { DownloadSection } from "@/stores/downloads";

export type SetupDepKind = "engine" | "runtime" | "component" | "model";

/** 一条依赖。 */
export interface SetupDep {
  kind: SetupDepKind;
  /** 模型 id / 运行时 id / 组件 id / 引擎包 id。 */
  id: string;
  /** 已经翻译好的名字（模型用原名，运行时用 i18n）。 */
  label: string;
  /** 还差多少字节（已装 = 0）。 */
  bytes: number;
  installed: boolean;
  /** 这台机器能不能用；`false` 的行不展示（AMD 机器不列 CUDA）。 */
  usable: boolean;
  /** 仅 CUDA 组件：属于哪一套。 */
  group?: "cuda12" | "cuda13";
  /** 仅模型：权重文件数。 */
  files?: number;
  /** 可选的补充说明（例如「下载后会顺带补齐 4 个组件」）。 */
  hint?: string;
}

/** 推荐后端 + 可切换的其它后端。 */
export interface SetupBackend {
  kind: string;
  label: string;
  /** 「检测到 NVIDIA GeForce RTX 4060」这类依据。 */
  reason: string;
  recommended: boolean;
  /** 切换用：只列本机可用的。 */
  choices: { kind: string; label: string }[];
}

export interface SetupPlan {
  /** 弹窗标题（已经翻译好）。 */
  title: string;
  /** 顶部那一行（已经翻译好）。 */
  lead: string;
  deps: SetupDep[];
  totalBytes: number;
  /** 引擎 / 运行时那一段的后端信息（纯模型依赖时为 `null`）。 */
  backend: SetupBackend | null;
  /** 装完要重启才生效（CUDA 本体 / 组件）。 */
  restartAfter: boolean;
}

/** 依赖下载落在管理器的哪个分区。 */
export function sectionOf(dep: SetupDep): DownloadSection {
  if (dep.kind === "model") return "model";
  if (dep.kind === "engine") return "sdcpp";
  return "runtime";
}

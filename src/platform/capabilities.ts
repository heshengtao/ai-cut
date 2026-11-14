/**
 * 能力表：**服务端**告诉你每个功能当前能不能用。
 *
 * 以前前端用 `isTauri()` 猜——猜错的表现是"开关能点、点了没反应"：智能体配置被清空、
 * 代理设置回显但不落盘、模型下载成功却永远显示未安装。现在由真正干活的那一端声明
 * （`crates/daemon/src/capabilities.rs` → `/rpc/capabilities`），前端只负责照着显示。
 *
 * 约定：
 * - 桌面壳（Tauri）没有能力表，一律视为可用；
 * - 浏览器 / 容器里，**服务端没声明的 key 保持旧行为**（宁可放行也不要误伤）；
 * - 所有拒绝都必须能解释自己：`reason` + `fallback` 都是 i18n 键。
 */
import { t } from "@/i18n";
import { isTauri } from "@/utils/platform";

import { invoke } from "./tauri";

export type CapabilityState = "ok" | "degraded" | "missing" | "desktop_only" | "unsupported";

export interface Capability {
  key: string;
  state: CapabilityState;
  /** i18n 键（`caps.reason.*`）；空串 = 无需解释。 */
  reason: string;
  /** i18n 键（`caps.fallback.*`）；空串 = 没有替代做法。 */
  fallback: string;
}

export interface CapabilityReport {
  version: string;
  nativeUi: boolean;
  items: Capability[];
}

const table = new Map<string, Capability>();
let loading: Promise<void> | null = null;

/** 拉一次能力表（进程内缓存；失败保持空表，调用方按"未知"处理）。 */
export function ensureCapabilities(): Promise<void> {
  if (isTauri()) return Promise.resolve();
  loading ??= (async () => {
    try {
      const report = await invoke<CapabilityReport>("capabilities");
      for (const item of report.items) table.set(item.key, item);
    } catch {
      // 老版本 daemon 没有这条命令：保持空表，前端退回旧行为。
    }
  })();
  return loading;
}

/** 已加载的能力表（调试 / 设置页展示用）。 */
export function capabilityTable(): Capability[] {
  return [...table.values()];
}

export function capability(key: string): Capability | undefined {
  return table.get(key);
}

/** 这个能力现在能不能用（未知 key 视为可用，避免误伤旧后端）。 */
export async function isAvailable(key: string): Promise<boolean> {
  if (isTauri()) return true;
  await ensureCapabilities();
  const cap = table.get(key);
  if (!cap) return true;
  return cap.state === "ok" || cap.state === "degraded";
}

/** 面向用户的一句话解释：`功能名：原因（可用替代）`。 */
export function explain(cap: Capability, label: string): string {
  const reason = cap.reason ? t(cap.reason) : t("caps.reason.notPorted");
  const fallback = cap.fallback ? t(cap.fallback) : "";
  return fallback
    ? `${label}：${reason}${t("caps.fallback.separator")}${fallback}`
    : `${label}：${reason}`;
}

/**
 * 守卫：能用就直接返回，不能用就抛一句人话。
 *
 * 用法：`await requireCapability("asr", t("caps.feature.asr"))` 之后再发 RPC。
 * 这样即使服务端还没实现，用户看到的也是"字幕生成：本地 AI 尚未在浏览器版本提供，
 * 请在桌面应用中使用"，而不是一个裸的 `未知命令：asr_transcribe`。
 */
export async function requireCapability(key: string, label: string): Promise<void> {
  if (isTauri()) return;
  await ensureCapabilities();
  const cap = table.get(key);
  if (!cap) return;
  if (cap.state === "ok" || cap.state === "degraded") return;
  throw new Error(explain(cap, label));
}

/** 运行时管理的 Tauri 封装：清单、下载、删除、定位。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RuntimeProgress, RuntimeStatus } from "@/types/runtime";
import { EVENT_RUNTIME } from "@/types/runtime";
import { isTauri } from "@/utils/platform";

export function runtimeCatalog(): Promise<RuntimeStatus[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<RuntimeStatus[]>("runtime_catalog");
}

export function runtimeInstall(id: string, force = false): Promise<void> {
  return invoke<void>("runtime_install", { id, force });
}

export function runtimeCancel(): Promise<void> {
  return invoke<void>("runtime_cancel");
}

/** 是否有运行库正在下载（挂载时用来纠正「卡在下载中」的状态）。 */
export function runtimeBusy(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>("runtime_busy");
}

export function runtimeRemove(id: string): Promise<void> {
  return invoke<void>("runtime_remove", { id });
}

export function runtimeReveal(id: string): Promise<void> {
  return invoke<void>("runtime_reveal", { id });
}

/** 重启应用（切换运行时后由确认框调用）。 */
export function appRestart(): Promise<void> {
  return invoke<void>("app_restart");
}

export function onRuntimeProgress(
  handler: (progress: RuntimeProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<RuntimeProgress>(EVENT_RUNTIME, (event) => handler(event.payload));
}

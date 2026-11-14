/** stable-diffusion.cpp 引擎管理的 Tauri 封装。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type { SdcppInfo, SdcppProgress, SdcppStatus } from "@/types/sdcpp";
import { EVENT_SDCPP } from "@/types/sdcpp";
import { isTauri } from "@/utils/platform";

export function sdcppCatalog(): Promise<SdcppStatus[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<SdcppStatus[]>("sdcpp_catalog");
}

export function sdcppInstall(id: string, force = false): Promise<void> {
  return invoke<void>("sdcpp_install", { id, force });
}

export function sdcppCancel(): Promise<void> {
  return invoke<void>("sdcpp_cancel");
}

export function sdcppBusy(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>("sdcpp_busy");
}

export function sdcppRemove(id: string): Promise<void> {
  return invoke<void>("sdcpp_remove", { id });
}

export function sdcppReveal(id: string): Promise<void> {
  return invoke<void>("sdcpp_reveal", { id });
}

export function sdcppSelect(id: string | null): Promise<void> {
  return invoke<void>("sdcpp_select", { id });
}

export function sdcppInfo(): Promise<SdcppInfo | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invoke<SdcppInfo>("sdcpp_info");
}

export function sdcppSetBackend(backend: string): Promise<SdcppInfo> {
  return invoke<SdcppInfo>("sdcpp_set_backend", { backend });
}

export function onSdcppProgress(
  handler: (progress: SdcppProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<SdcppProgress>(EVENT_SDCPP, (event) => handler(event.payload));
}

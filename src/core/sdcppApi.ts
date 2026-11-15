/** stable-diffusion.cpp 引擎管理（桌面与浏览器共用同一份 daemon 实现）。 */
import { invoke } from "@/platform/tauri";
import { listen, type UnlistenFn } from "@/platform/tauri";
import type { SdcppInfo, SdcppProgress, SdcppStatus } from "@/types/sdcpp";
import { EVENT_SDCPP } from "@/types/sdcpp";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";

export function sdcppCatalog(): Promise<SdcppStatus[]> {
  return invoke<SdcppStatus[]>("sdcpp_catalog");
}

export async function sdcppInstall(id: string, force = false): Promise<void> {
  await requireCapability("sdcpp", t("caps.feature.sdcpp"));
  return invoke<void>("sdcpp_install", { id, force });
}

export function sdcppCancel(): Promise<void> {
  return invoke<void>("sdcpp_cancel");
}

export function sdcppBusy(): Promise<boolean> {
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
  return invoke<SdcppInfo>("sdcpp_info");
}

export function sdcppSetBackend(backend: string): Promise<SdcppInfo> {
  return invoke<SdcppInfo>("sdcpp_set_backend", { backend });
}

export function onSdcppProgress(
  handler: (progress: SdcppProgress) => void,
): Promise<UnlistenFn> {
  return listen<SdcppProgress>(EVENT_SDCPP, (event) => handler(event.payload));
}

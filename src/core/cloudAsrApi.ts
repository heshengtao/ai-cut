/**
 * 云端 ASR 配置与测试。实现都在 `crates/daemon`（`cloud_asr/`），
 * 桌面壳与无头端共用；这里只有能力表守卫。
 */
import { invoke } from "@/platform/tauri";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";
import type { CloudAsrConfig, CloudAsrProvider, CloudAsrTest } from "@/types/models";

export function cloudAsrConfig(): Promise<CloudAsrConfig> {
  return invoke<CloudAsrConfig>("cloud_asr_config");
}

export function cloudAsrSetConfig(providers: CloudAsrProvider[]): Promise<CloudAsrConfig> {
  return invoke<CloudAsrConfig>("cloud_asr_set_config", { providers });
}

export async function cloudAsrTest(
  provider: CloudAsrProvider,
  path: string,
): Promise<CloudAsrTest> {
  await requireCapability("cloud_asr", t("caps.feature.cloudAsr"));
  return invoke<CloudAsrTest>("cloud_asr_test", { provider, path });
}

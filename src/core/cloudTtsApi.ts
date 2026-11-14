/**
 * 云端 / 自定义 TTS 的调用封装。
 *
 * 实现已经下沉到 `crates/daemon`（只依赖 HTTP + 配置 + ffmpeg 探测），所以浏览器 /
 * 容器版本同样可用——这里不再有 `isTauri()` 分支，只有能力表守卫：
 * 桌面壳恒可用，无头端由 `/rpc/capabilities` 声明。
 */
import { invoke } from "@/platform/tauri";
import { requireCapability } from "@/platform/capabilities";
import { t } from "@/i18n";
import type {
  CloudTtsConfig,
  CloudTtsProvider,
  CloudTtsTest,
  TtsAudio,
  TtsItem,
  TtsVoice,
} from "@/types/models";

export function cloudTtsConfig(): Promise<CloudTtsConfig> {
  return invoke<CloudTtsConfig>("cloud_tts_config");
}

export function cloudTtsSetConfig(
  providers: CloudTtsProvider[],
): Promise<CloudTtsConfig> {
  return invoke<CloudTtsConfig>("cloud_tts_set_config", { providers });
}

export function cloudTtsVoices(provider: CloudTtsProvider): Promise<TtsVoice[]> {
  return invoke<TtsVoice[]>("cloud_tts_voices", { provider });
}

export async function cloudTtsTest(
  provider: CloudTtsProvider,
  text: string,
): Promise<CloudTtsTest> {
  await requireCapability("cloud_tts", t("caps.feature.cloudTts"));
  return invoke<CloudTtsTest>("cloud_tts_test", { provider, text });
}

export async function cloudTtsSynthesize(
  providerId: string,
  items: TtsItem[],
  voice: string | null,
): Promise<TtsAudio[]> {
  await requireCapability("cloud_tts", t("caps.feature.cloudTts"));
  return invoke<TtsAudio[]>("cloud_tts_synthesize", {
    providerId,
    items,
    voice,
  });
}

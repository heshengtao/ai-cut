/** MOSS 内置音色的展示名与分组本地化。 */
import type { TtsVoice } from "@/types/models";
import type { Translate } from "@/utils/modelSource";

/**
 * 上游 manifest 的 `display_name` 是参考音频的示例文案（第一条甚至是
 * “欢迎关注模思智能”这种广告句），不适合当音色名。界面只使用稳定的
 * `voice` id，并给中文音色补一个可读名字。
 */
const VOICE_NAME_KEYS: Record<string, string> = {
  Junhao: "ai.voiceName.junhao",
  Zhiming: "ai.voiceName.zhiming",
  Weiguo: "ai.voiceName.weiguo",
  Xiaoyu: "ai.voiceName.xiaoyu",
  Yuewen: "ai.voiceName.yuewen",
  Lingyu: "ai.voiceName.lingyu",
  leijun: "ai.voiceName.leijun",
};

export function ttsVoiceName(t: Translate, voice: TtsVoice): string {
  const key = VOICE_NAME_KEYS[voice.id];
  if (key) {
    const label = t(key);
    if (label !== key) return label;
  }
  return voice.id;
}

export function ttsVoiceGroup(t: Translate, group: string): string {
  const slug = group.trim().toLowerCase().replace(/\s+/g, "-");
  if (!slug) return t("ai.voiceGroup.other");
  const key = `ai.voiceGroup.${slug}`;
  const label = t(key);
  return label === key ? group : label;
}

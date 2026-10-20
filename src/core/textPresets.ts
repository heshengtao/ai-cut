/** 媒体库与时间线工具栏使用的文本预设。 */
import type { ClipTextStyle } from "@/types/project";
import { DEFAULT_TEXT_STYLE } from "@/core/clipStyle";
import { t } from "@/i18n";

export interface TextPreset {
  id: string;
  /** 媒体库里显示的名字。 */
  name: string;
  /** 插入时间线时使用的文案。 */
  text: string;
  /** 默认片段时长（秒）。 */
  duration: number;
  /** 文字样式。 */
  textStyle: ClipTextStyle;
  /** 内置预设立：不可删除。 */
  builtin: boolean;
}

/** 内置默认文本预设。由 store 在读取时生成，保证语言切换后名字立即更新。 */
export function defaultTextPreset(): TextPreset {
  return {
    id: "default",
    name: t("textPreset.default.name"),
    text: t("textPreset.default.text"),
    duration: 15,
    textStyle: { ...DEFAULT_TEXT_STYLE },
    builtin: true,
  };
}

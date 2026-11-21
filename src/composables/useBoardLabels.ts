/**
 * 画布 UI 的共享文案：数据类型名与工作流发布标签。
 *
 * 数据类型走 `board.type.<id>`（内置类型都有翻译）；插件注册的类型没有翻译时
 * 回落到注册表里的 `label`，最后才回落到 id——不能把 `board.type.ext.xxx` 这种
 * key 直接显示出来。
 */
import { dataTypeSpec } from "@/core/board/dataTypes";
import { useI18n } from "@/i18n";
import { isKnownMessageKey } from "@/i18n/translate";
import type { BoardPortType } from "@/types/board";

export function useBoardLabels() {
  const i18n = useI18n();

  function typeLabel(type: BoardPortType): string {
    const key = `board.type.${type}`;
    const text = i18n.t(key);
    if (text && text !== key) return text;
    const spec = dataTypeSpec(type);
    return spec.label || String(type);
  }

  /** 发布标签 → 库里用的中文 / 英文名（未知标签原样显示，不吞数据）。 */
  function tagLabel(tag: string): string {
    if (tag === "workflow") return i18n.t("board.library.badgeBase");
    if (tag === "subworkflow") return i18n.t("board.library.badgeWorkflow");
    if (tag === "api") return i18n.t("board.library.badgeApi");
    return tag;
  }

  /** 画布标题：显式名字优先；空标题 = 自动名（跟着当前语言走）。 */
  function canvasTitle(canvas: { title?: string } | null | undefined, index: number): string {
    const explicit = canvas?.title?.trim();
    // 历史数据里可能存着没翻译出来的 key（`board.canvas.defaultTitle`）：当没名字处理。
    if (explicit && !isKnownMessageKey(explicit)) return explicit;
    return i18n.t("board.canvas.defaultTitle", { n: index + 1 });
  }

  return { typeLabel, tagLabel, canvasTitle };
}

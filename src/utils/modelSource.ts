/** 模型下载源的展示与偏好。 */
import type { Vars } from "@/i18n";
import type { ModelRegion, ModelSourcePreference } from "@/types/models";

export type Translate = (key: string, vars?: Vars) => string;

export const SOURCE_PREFERENCES: ModelSourcePreference[] = [
  "auto",
  "domestic",
  "international",
];

/** 「国内外双源 / 仅国内 / 仅国际」。 */
export function regionsLabel(t: Translate, regions: ModelRegion[]): string {
  const cn = regions.includes("cn");
  const intl = regions.includes("intl");
  if (cn && intl) return t("models.sources.both");
  if (cn) return t("models.sources.cn");
  return t("models.sources.intl");
}

/** 当前下载源的展示名（镜像 / 魔搭 / HF / GitHub）。 */
export function sourceKindLabel(
  t: Translate,
  kind: string | null,
  url: string | null,
): string {
  if (kind === "mirror") return t("models.source.mirror");
  if (kind === "modelscope") return t("models.source.modelscope");
  if (kind === "hf") return t("models.source.huggingface");
  if (kind === "github") return t("models.source.github");
  if (url?.includes("modelscope")) return t("models.source.modelscope");
  if (url?.includes("huggingface")) return t("models.source.huggingface");
  if (url?.includes("github")) return t("models.source.github");
  return t("models.source.unknown");
}

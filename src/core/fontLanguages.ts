/**
 * 字体库的“语言 / 文字”筛选。
 *
 * Fontsource 的 `subsets` 是按**文字系统**划分的（latin、cyrillic、chinese-simplified…），
 * 所以这里把它映射成用户能看懂的语言项：一个语言可以覆盖多个 subset（例如繁体中文还包含
 * `chinese-hongkong`，拉丁文字包含 `latin-ext`）。
 *
 * 下拉里真正展示哪些语言由注册表数据决定（见 `availableLanguages`）：只留下字体数量
 * ≥ `MIN_FONTS` 的项，避免把 100 多种只出现 1 次的冷门文字塞进列表；数据里新出现、这里
 * 还没登记 subset 也会自动补一条（用 subset id 当名字），不用改代码。
 */
import { t } from "@/i18n";
import type { FontSourceSummary } from "./fontsApi";

export interface FontLanguage {
  /** 稳定 id（用于下拉选中值）。 */
  id: string;
  /** i18n key；为空时直接显示 subset id。 */
  labelKey: string;
  /** 参与匹配的 Fontsource subset。 */
  subsets: string[];
  /** 排序权重：越小越靠前（常用文字优先）。 */
  priority: number;
}

/** 少于这个数量的字体不单独展示（冷门文字仍可搜索字体名找到）。 */
export const MIN_FONTS = 3;

export const FONT_LANGUAGES: FontLanguage[] = [
  { id: "latin", labelKey: "font.lang.latin", subsets: ["latin", "latin-ext"], priority: 10 },
  {
    id: "chinese-simplified",
    labelKey: "font.lang.zhHans",
    subsets: ["chinese-simplified"],
    priority: 20,
  },
  {
    id: "chinese-traditional",
    labelKey: "font.lang.zhHant",
    subsets: ["chinese-traditional", "chinese-hongkong"],
    priority: 21,
  },
  { id: "japanese", labelKey: "font.lang.ja", subsets: ["japanese"], priority: 22 },
  { id: "korean", labelKey: "font.lang.ko", subsets: ["korean"], priority: 23 },
  {
    id: "cyrillic",
    labelKey: "font.lang.cyrillic",
    subsets: ["cyrillic", "cyrillic-ext"],
    priority: 30,
  },
  { id: "arabic", labelKey: "font.lang.ar", subsets: ["arabic"], priority: 31 },
  { id: "hebrew", labelKey: "font.lang.he", subsets: ["hebrew"], priority: 32 },
  { id: "vietnamese", labelKey: "font.lang.vi", subsets: ["vietnamese"], priority: 33 },
  { id: "devanagari", labelKey: "font.lang.devanagari", subsets: ["devanagari"], priority: 34 },
  { id: "thai", labelKey: "font.lang.th", subsets: ["thai"], priority: 35 },
  {
    id: "greek",
    labelKey: "font.lang.greek",
    subsets: ["greek", "greek-ext"],
    priority: 36,
  },
  { id: "bengali", labelKey: "font.lang.bn", subsets: ["bengali"], priority: 40 },
  { id: "tamil", labelKey: "font.lang.ta", subsets: ["tamil"], priority: 41 },
  { id: "telugu", labelKey: "font.lang.te", subsets: ["telugu"], priority: 42 },
  { id: "gujarati", labelKey: "font.lang.gu", subsets: ["gujarati"], priority: 43 },
  { id: "kannada", labelKey: "font.lang.kn", subsets: ["kannada"], priority: 44 },
  { id: "gurmukhi", labelKey: "font.lang.pa", subsets: ["gurmukhi"], priority: 45 },
  { id: "malayalam", labelKey: "font.lang.ml", subsets: ["malayalam"], priority: 46 },
  { id: "sinhala", labelKey: "font.lang.si", subsets: ["sinhala"], priority: 47 },
  { id: "myanmar", labelKey: "font.lang.my", subsets: ["myanmar"], priority: 48 },
  { id: "khmer", labelKey: "font.lang.km", subsets: ["khmer"], priority: 49 },
  { id: "lao", labelKey: "font.lang.lo", subsets: ["lao"], priority: 50 },
  { id: "tibetan", labelKey: "font.lang.bo", subsets: ["tibetan"], priority: 51 },
  { id: "georgian", labelKey: "font.lang.ka", subsets: ["georgian"], priority: 52 },
  { id: "armenian", labelKey: "font.lang.hy", subsets: ["armenian"], priority: 53 },
  { id: "ethiopic", labelKey: "font.lang.am", subsets: ["ethiopic"], priority: 54 },
  { id: "cherokee", labelKey: "font.lang.cherokee", subsets: ["cherokee"], priority: 55 },
  {
    id: "canadian-aboriginal",
    labelKey: "font.lang.canadianAboriginal",
    subsets: ["canadian-aboriginal"],
    priority: 56,
  },
  { id: "math", labelKey: "font.lang.math", subsets: ["math"], priority: 90 },
  {
    id: "symbols",
    labelKey: "font.lang.symbols",
    subsets: ["symbols", "symbols2"],
    priority: 91,
  },
  { id: "emoji", labelKey: "font.lang.emoji", subsets: ["emoji"], priority: 92 },
  { id: "braille", labelKey: "font.lang.braille", subsets: ["braille"], priority: 93 },
];

const KNOWN = new Map(FONT_LANGUAGES.map((language) => [language.id, language]));

/** 下拉项：`{ id, label }`，`all` 表示不过滤。 */
export interface LanguageOption {
  id: string;
  label: string;
}

/** 字体命中的语言项（可能有多个，例如同时支持中文与拉丁）。 */
export function languagesOf(font: FontSourceSummary, languages = FONT_LANGUAGES): FontLanguage[] {
  return languages.filter((language) =>
    language.subsets.some((subset) => font.subsets.includes(subset)),
  );
}

/** 字体行里显示的语言标签：优先非拉丁文字，没有就显示拉丁。 */
export function primaryLanguageLabel(font: FontSourceSummary): string {
  const hits = languagesOf(font);
  const nonLatin = hits.filter((language) => language.id !== "latin");
  const pick = nonLatin[0] ?? hits[0];
  return pick ? languageLabel(pick) : "";
}

export function languageLabel(language: FontLanguage): string {
  return language.labelKey ? t(language.labelKey) : language.id;
}

/**
 * 由注册表数据算出可用的语言项：登记过的语言 + 数据里出现但未登记的 subset。
 * 只保留字体数量达到阈值的项，并按优先级 / 名称排序。
 */
export function availableLanguages(fonts: FontSourceSummary[]): FontLanguage[] {
  const counts = new Map<string, number>();
  for (const font of fonts) {
    for (const subset of new Set(font.subsets)) {
      counts.set(subset, (counts.get(subset) ?? 0) + 1);
    }
  }

  const covered = new Set<string>();
  const out: FontLanguage[] = [];
  for (const language of FONT_LANGUAGES) {
    let count = 0;
    for (const subset of language.subsets) {
      covered.add(subset);
      count += counts.get(subset) ?? 0;
    }
    if (count >= MIN_FONTS) out.push(language);
  }

  // 未登记的 subset：数据驱动补上，避免漏掉新文字系统。
  const extra = [...counts.entries()]
    .filter(([subset, count]) => !covered.has(subset) && count >= MIN_FONTS)
    .map<FontLanguage>(([subset]) => ({
      id: subset,
      labelKey: "",
      subsets: [subset],
      priority: 1000,
    }));

  extra.sort((a, b) => a.id.localeCompare(b.id));
  out.sort((a, b) => a.priority - b.priority);
  return [...out, ...extra];
}

/** 过滤：`all` 不过滤；否则字体必须支持该语言。 */
export function matchesLanguage(
  font: FontSourceSummary,
  languageId: string,
  languages: FontLanguage[] = FONT_LANGUAGES,
): boolean {
  if (languageId === "all") return true;
  const language =
    languages.find((item) => item.id === languageId) ?? KNOWN.get(languageId) ?? null;
  // 未登记的语言 id 直接当作 subset id 匹配。
  const subsets = language ? language.subsets : [languageId];
  return subsets.some((subset) => font.subsets.includes(subset));
}

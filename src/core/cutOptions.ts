/**
 * 剪口播设置的数据层：默认值、持久化前的清洗、过滤词的增删。
 *
 * 放在核心层而不是 Pinia store 里，是因为这些规则（夹区间、去重、默认词禁用）
 * 是纯函数，单测能直接覆盖；store 只负责把结果存进 localStorage。
 */
import { HARD_FILLERS, SOFT_FILLERS, normalizeWord } from "@/core/cutAnalysis";

/** 剪口播的全部可调项。 */
export interface CutReviewOptions {
  /** 超过多少秒算长停顿。 */
  minPause: number;
  /** 剪停顿后段中保留多少秒。 */
  keep: number;
  /** 剪停顿后句末保留多少秒。 */
  sentenceKeep: number;
  /** 是否也剪「那个 / 就是」这类软口癖。 */
  includeSoft: boolean;
  /** 用户自己加的过滤词（多语言、个人口癖），命中就剪。 */
  custom: string[];
  /** 用户在设置里移除的默认过滤词。 */
  disabled: string[];
  /** 切点向两侧静音扩展多少秒。 */
  trimPad: number;
}

export const DEFAULT_CUT_OPTIONS: CutReviewOptions = {
  minPause: 0.8,
  keep: 0.3,
  sentenceKeep: 0.4,
  includeSoft: true,
  custom: [],
  disabled: [],
  trimPad: 0.12,
};

/** 各滑杆的合法区间，超出就夹回来。 */
const RANGES: Record<"minPause" | "keep" | "sentenceKeep" | "trimPad", [number, number]> = {
  minPause: [0.2, 3],
  keep: [0, 1],
  sentenceKeep: [0, 1.5],
  trimPad: [0, 0.5],
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)) * 1000) / 1000;
}

function cleanWords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const word = item.trim();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** 把 localStorage / 旧版本里读到的任意对象清洗成合法设置。 */
export function normalizeCutOptions(raw: Partial<CutReviewOptions> | null | undefined): CutReviewOptions {
  const source = raw ?? {};
  return {
    minPause: clampNumber(source.minPause, DEFAULT_CUT_OPTIONS.minPause, ...RANGES.minPause),
    keep: clampNumber(source.keep, DEFAULT_CUT_OPTIONS.keep, ...RANGES.keep),
    sentenceKeep: clampNumber(
      source.sentenceKeep,
      DEFAULT_CUT_OPTIONS.sentenceKeep,
      ...RANGES.sentenceKeep,
    ),
    includeSoft:
      typeof source.includeSoft === "boolean"
        ? source.includeSoft
        : DEFAULT_CUT_OPTIONS.includeSoft,
    custom: cleanWords(source.custom),
    disabled: cleanWords(source.disabled),
    trimPad: clampNumber(source.trimPad, DEFAULT_CUT_OPTIONS.trimPad, ...RANGES.trimPad),
  };
}

/** 这个词是不是内置的默认过滤词（中英文都算）。 */
export function isDefaultFilterWord(word: string): boolean {
  const target = normalizeWord(word);
  if (!target) return false;
  for (const lang of ["zh", "en"] as const) {
    for (const item of [...HARD_FILLERS[lang], ...SOFT_FILLERS[lang]]) {
      if (normalizeWord(item) === target) return true;
    }
  }
  return false;
}

/**
 * 添加一个过滤词。
 *
 * - 空白 / 重复直接返回原对象（调用方可以据此给出提示）；
 * - 默认词被重新添加时，只解除禁用，恢复它原本的「语气词 / 口头禅」规则；
 * - 其余词进自定义列表，命中就剪，不要求前后停顿。
 */
export function addFilterWord(options: CutReviewOptions, word: string): CutReviewOptions {
  const value = word.trim();
  if (!value) return options;
  const target = normalizeWord(value);
  if (options.custom.some((item) => normalizeWord(item) === target)) return options;

  const disabled = options.disabled.filter((item) => normalizeWord(item) !== target);
  if (isDefaultFilterWord(value)) {
    if (disabled.length === options.disabled.length) return options;
    return { ...options, disabled };
  }
  return { ...options, custom: [...options.custom, value], disabled };
}

/** 移除一个过滤词：自定义词删掉，默认词记进禁用列表。 */
export function removeFilterWord(options: CutReviewOptions, word: string): CutReviewOptions {
  const target = normalizeWord(word);
  if (!target) return options;
  const custom = options.custom.filter((item) => normalizeWord(item) !== target);
  const removedCustom = custom.length !== options.custom.length;

  if (!isDefaultFilterWord(word)) {
    return removedCustom ? { ...options, custom } : options;
  }
  if (options.disabled.some((item) => normalizeWord(item) === target)) {
    return removedCustom ? { ...options, custom } : options;
  }
  return { ...options, custom, disabled: [...options.disabled, word.trim()] };
}

/** 恢复默认过滤词：清空自定义与禁用，其余设置不动。 */
export function restoreFilterWords(options: CutReviewOptions): CutReviewOptions {
  if (options.custom.length === 0 && options.disabled.length === 0) return options;
  return { ...options, custom: [], disabled: [] };
}

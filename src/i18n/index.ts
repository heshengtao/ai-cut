/**
 * 轻量国际化：当前支持中 / 英双语。
 *
 * 语言按「用户选过的 → 系统语言 → 兜底」的顺序决定，选择存在 localStorage 里，设置页可以切。
 * 加一门语言只需在 `MESSAGES` 里补一份词典 + 在 `LOCALES` 里登记——`t()` 找不到的文案会依次
 * 回退到兜底语言、最后退回 key 本身，所以词典永远可以分步补。
 */
import { computed, ref } from "vue";

import en from "./en";
import zh from "./zh";

export type Locale = "zh" | "en";

/** 支持的语言（第一项是兜底语言；将来加语言只改这里 + 补词典）。 */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "zh", label: "简体中文" },
  { id: "en", label: "English" },
];

const FALLBACK: Locale = LOCALES[0].id;

const MESSAGES: Record<Locale, Record<string, string>> = { zh, en };

/** 语言选择的持久化键。 */
const KEY = "ai-cut-locale";

/** 文案里 `{name}` 形式的占位由 `vars` 替换。 */
export type Vars = Record<string, string | number>;

/** 按系统语言猜一个：`zh*` → 中文，其余 → 英文。 */
function detect(): Locale {
  // Node / Vitest 里没有 window：固定用兜底语言，保证测试确定性。
  if (typeof window === "undefined") return FALLBACK;
  const raw = typeof navigator === "undefined" ? "" : navigator.language;
  if (!raw) return FALLBACK;
  const lower = raw.toLowerCase();
  const hit = LOCALES.find((l) => lower.startsWith(l.id));
  return hit?.id ?? "en";
}

/** 用户选过的语言优先，其次才是系统语言。 */
function initial(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    const hit = LOCALES.find((l) => l.id === saved);
    if (hit) return hit.id;
  } catch {
    // 读不到就用系统语言。
  }
  return detect();
}

const locale = ref<Locale>(initial());
applyDocumentLang(locale.value);

function applyDocumentLang(value: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = value;
}

/** 切换语言（设置页调用）。 */
export function setLocale(next: Locale): void {
  locale.value = next;
  applyDocumentLang(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // 存不住也不影响本次会话。
  }
}

/** 取一条文案。 */
export function t(key: string, vars?: Vars): string {
  const dict = MESSAGES[locale.value] ?? MESSAGES[FALLBACK];
  let text = dict[key] ?? MESSAGES[FALLBACK][key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function useI18n() {
  return {
    /** 当前语言。 */
    locale: computed(() => locale.value),
    locales: LOCALES,
    t,
    setLocale,
  };
}

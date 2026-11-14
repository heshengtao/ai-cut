/**
 * 轻量国际化：当前支持中 / 英双语。
 *
 * 语言按「用户选过的 → 系统语言 → 兜底」的顺序决定，选择存在 localStorage 里，设置页可以切。
 * 加一门语言只需在 `MESSAGES`（`./translate`）里补一份词典 + 在 `LOCALES` 里登记——`t()` 找不到
 * 的文案会依次回退到兜底语言、最后退回 key 本身，所以词典永远可以分步补。
 *
 * 纯查表部分在 `./translate`：无头文档引擎（QuickJS）会直接复用它，不能把 Vue 拖进去。
 */
import { computed, ref } from "vue";

import {
  FALLBACK,
  LOCALES,
  setTranslateLocale,
  t as translate,
  type Locale,
  type Vars,
} from "./translate";

export { LOCALES };
export type { Locale, Vars };

/** 语言选择的持久化键。 */
const KEY = "ai-cut-locale";

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
setTranslateLocale(locale.value);
applyDocumentLang(locale.value);

function applyDocumentLang(value: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = value;
}

/**
 * 取一条文案。
 *
 * 这里刻意读一下 `locale.value`：模板在渲染期间调用 `t()` 时会把它记成依赖，
 * 语言切换才能触发重渲染。领域侧（`@/i18n/translate`）不需要这层响应式。
 */
export function t(key: string, vars?: Vars): string {
  void locale.value;
  return translate(key, vars);
}

/** 切换语言（设置页调用）。 */
export function setLocale(next: Locale): void {
  locale.value = next;
  setTranslateLocale(next);
  applyDocumentLang(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // 存不住也不影响本次会话。
  }
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

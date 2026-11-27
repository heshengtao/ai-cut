/**
 * 轻量国际化：文案在 `./translate`（纯查表），这里只负责响应式语言状态、持久化与
 * `<html lang>` / `<html dir>`。
 *
 * 语言按「用户选过的 → 系统语言 → 兜底」的顺序决定，选择存在 localStorage 里，设置页可以切。
 * 支持的语言列表在 `./locales.json`；加一门语言只需在那里登记、补一份词典，再在下面
 * `registerDictionary()` 挂上——`t()` 找不到的文案会依次回退到英文、兜底语言，最后退回
 * key 本身，所以词典永远可以分步补。
 *
 * 纯查表部分在 `./translate`：无头文档引擎（QuickJS）会直接复用它，不能把 Vue 拖进去。
 * 因此词典的静态引入集中在本文件，`./translate` 只自带 zh / en 两份。
 */
import { computed, ref } from "vue";

import ar from "./ar";
import de from "./de";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import ko from "./ko";
import ru from "./ru";
import {
  FALLBACK,
  LOCALES,
  localeInfo,
  registerDictionary,
  setTranslateLocale,
  t as translate,
  type Locale,
  type LocaleInfo,
  type Vars,
} from "./translate";
import zhTW from "./zh-TW";

export { LOCALES };
export type { Locale, LocaleInfo, Vars };

/** 语言选择的持久化键。 */
const KEY = "ai-cut-locale";

/**
 * 把浏览器给的语言标记（`zh-TW` / `zh-Hant-HK` / `pt-BR` / `ar-EG`）落到我们支持的语言上。
 * 繁体中文单独认：`zh-*` 里带 Hant / TW / HK / MO 的一律走繁體。
 */
function matchLocale(raw: string): Locale | null {
  const tag = raw.trim().toLowerCase().replace(/_/g, "-");
  if (!tag) return null;
  if (tag.startsWith("zh")) {
    if (/(^|-)(hant|tw|hk|mo)(-|$)/.test(tag)) return "zh-TW";
    return "zh";
  }
  const exact = LOCALES.find((l) => l.id.toLowerCase() === tag);
  if (exact) return exact.id;
  const base = tag.split("-")[0];
  const hit = LOCALES.find((l) => l.id.toLowerCase().split("-")[0] === base);
  return hit?.id ?? null;
}

/** 按系统语言猜一个：`navigator.languages` 里第一个认识的就是它。 */
function detect(): Locale {
  // Node / Vitest 里没有 window：固定用兜底语言，保证测试确定性。
  if (typeof window === "undefined") return FALLBACK;
  if (typeof navigator === "undefined") return FALLBACK;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const hit = matchLocale(tag ?? "");
    if (hit) return hit;
  }
  return "en";
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

// 十份词典在这里挂进查表器；`./translate` 自己只带 zh / en（无头引擎不背其余 8 份）。
registerDictionary("zh-TW", zhTW);
registerDictionary("ja", ja);
registerDictionary("ko", ko);
registerDictionary("es", es);
registerDictionary("fr", fr);
registerDictionary("de", de);
registerDictionary("ru", ru);
registerDictionary("ar", ar);

const locale = ref<Locale>(initial());
const info = computed(() => localeInfo(locale.value));

setTranslateLocale(locale.value);
applyDocumentLang(locale.value);

/** 同步 `<html lang>` / `<html dir>`：阿拉伯语整页右到左。 */
function applyDocumentLang(value: Locale): void {
  if (typeof document === "undefined") return;
  const target = localeInfo(value);
  document.documentElement.lang = target.id;
  document.documentElement.dir = target.dir;
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
    /** 当前语言的展示信息（母语名、书写方向）。 */
    info,
    /** 当前语言是否右到左。 */
    rtl: computed(() => info.value.dir === "rtl"),
    locales: LOCALES,
    t,
    setLocale,
  };
}

/**
 * 纯查表翻译：不依赖 Vue / DOM，供无头文档引擎（QuickJS）与桌面 UI 共用。
 *
 * `src/i18n/index.ts` 负责响应式语言状态与持久化，这里只保留「档位 + 查表」，
 * 这样 `core/commands`、`core/serialize`、`core/factory` 这批领域代码被打进
 * 无头引擎时不会把 Vue 一起拖进来。
 *
 * 加一门语言的步骤：在 `locales.json` 里登记 → 补一份 `./<id>.ts` 词典 → 加进下面的
 * `MESSAGES`。查不到的 key 会按「当前语言 → 英文 → 兜底语言 → key 本身」回退，
 * 所以词典可以分步补齐（`pnpm i18n:check` 会报告缺口）。
 */
import en from "./en";
import localeData from "./locales.json";
import zh from "./zh";

/** 支持的语言 id（`locales.json` 是展示信息的唯一来源）。 */
export type Locale = "zh" | "zh-TW" | "en" | "ja" | "ko" | "es" | "fr" | "de" | "ru" | "ar";

export interface LocaleInfo {
  id: Locale;
  /** 母语名（语言选择器里显示）。 */
  label: string;
  /** 英文名（给文档 / 有关需要时用）。 */
  english: string;
  dir: "ltr" | "rtl";
  /** 对应的 README 文件名。 */
  readme: string;
}

/** 支持的语言（第一项是兜底语言）。 */
export const LOCALES: LocaleInfo[] = localeData as LocaleInfo[];

export const FALLBACK: Locale = "zh";

/** 第二兜底：词典缺词条时先给英文，再给兜底语言。 */
const PIVOT: Locale = "en";

/**
 * 已装载的词典。
 *
 * 这里只静态引入兜底语言和英文：无头文档引擎（QuickJS）也会打进这个模块，
 * 把十份词典全塞进 bundle 会让 `domain.js` 平白大 1 MB 多。其余语言由 UI 层
 * （`./index.ts`）在启动时通过 `registerDictionary()` 挂进来。
 */
const MESSAGES: Partial<Record<Locale, Record<string, string>>> = { zh, en };

/** 装载一门语言的词典（UI 启动时调用；无头引擎永远只有 zh / en）。 */
export function registerDictionary(locale: Locale, dict: Record<string, string>): void {
  MESSAGES[locale] = dict;
}

/** 一个语言的回退顺序（当前 → 英文 → 兜底）。 */
function fallbackChain(locale: Locale): Locale[] {
  const order: Locale[] = [locale];
  // 繁体缺词条先看简体，比直接跳英文更接近原文。
  if (locale === "zh-TW") order.push("zh");
  if (locale !== PIVOT) order.push(PIVOT);
  if (locale !== FALLBACK && !order.includes(FALLBACK)) order.push(FALLBACK);
  return order;
}

/** 某个语言的展示信息。 */
export function localeInfo(locale: Locale): LocaleInfo {
  return LOCALES.find((l) => l.id === locale) ?? LOCALES[0];
}

/**
 * 这个字符串是不是一条已知的 i18n key？
 *
 * 用途：修复历史数据里误存的 key（早期版本把 `t()` 的返回值写进了画布标题，
 * 缺词条时 `t()` 返回 key 本身，于是 `board.canvas.defaultTitle` 被持久化）。
 * 只认「两段以上的点分小写 key + 词典里确实存在」，避免误伤用户起的名字。
 */
export function isKnownMessageKey(value: string): boolean {
  const key = value?.trim();
  if (!key || key.length > 64) return false;
  if (!/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i.test(key)) return false;
  return LOCALES.some((locale) =>
    Object.prototype.hasOwnProperty.call(MESSAGES[locale.id] ?? {}, key),
  );
}

/** 插件词典：pluginId → 语言 → 文案。key 在插件侧的写法不带前缀。 */
const PLUGIN_MESSAGES = new Map<string, Partial<Record<Locale, Record<string, string>>>>();

/**
 * 注册一个插件的文案。插件里的 key 不带前缀，宿主侧统一用 `@<pluginId>.<key>`。
 * 返回 disposer；卸载后这些 key 回落成原样输出。
 */
export function registerPluginMessages(
  pluginId: string,
  dicts: Partial<Record<Locale, Record<string, string>>>,
): () => void {
  // key 的写法是 `@<id>.<key>`，开头那个 `@` 属于命名空间标记，不属于 id。
  const id = pluginId.replace(/^@/, "");
  PLUGIN_MESSAGES.set(id, dicts);
  return () => {
    if (PLUGIN_MESSAGES.get(id) === dicts) PLUGIN_MESSAGES.delete(id);
  };
}

/** `@id.key` → 插件词典里的 `key`；不是插件 key 返回 null。 */
function pluginMessage(key: string, order: Locale[]): string | null {
  if (!key.startsWith("@")) return null;
  const dot = key.indexOf(".");
  if (dot <= 1) return null;
  const pluginId = key.slice(1, dot);
  const inner = key.slice(dot + 1);
  const dicts = PLUGIN_MESSAGES.get(pluginId);
  if (!dicts) return null;
  // 插件大多只带英文：按调用方语言、英文、兜底语言的顺序找。
  for (const locale of order) {
    const text = dicts[locale]?.[inner];
    if (text) return text;
  }
  return null;
}

/** 文案里 `{name}` 形式的占位由 `vars` 替换。 */
export type Vars = Record<string, string | number>;

let current: Locale = FALLBACK;

/** 切换查表语言（UI 的 setLocale 会同步调用；无头引擎默认用兜底语言）。 */
export function setTranslateLocale(next: Locale): void {
  current = next;
}

/** 当前查表语言。 */
export function translateLocale(): Locale {
  return current;
}

/** 取一条文案。 */
export function t(key: string, vars?: Vars): string {
  const order = fallbackChain(current);
  let text: string | undefined;
  for (const locale of order) {
    const hit = MESSAGES[locale]?.[key];
    if (hit != null) {
      text = hit;
      break;
    }
  }
  if (text == null) text = pluginMessage(key, order) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

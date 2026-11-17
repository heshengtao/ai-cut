/**
 * 纯查表翻译：不依赖 Vue / DOM，供无头文档引擎（QuickJS）与桌面 UI 共用。
 *
 * `src/i18n/index.ts` 负责响应式语言状态与持久化，这里只保留「档位 + 查表」，
 * 这样 `core/commands`、`core/serialize`、`core/factory` 这批领域代码被打进
 * 无头引擎时不会把 Vue 一起拖进来。
 */
import en from "./en";
import zh from "./zh";

export type Locale = "zh" | "en";

/** 支持的语言（第一项是兜底语言；将来加语言只改这里 + 补词典）。 */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "zh", label: "简体中文" },
  { id: "en", label: "English" },
];

export const FALLBACK: Locale = LOCALES[0].id;

const MESSAGES: Record<Locale, Record<string, string>> = { zh, en };

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
  PLUGIN_MESSAGES.set(pluginId, dicts);
  return () => {
    if (PLUGIN_MESSAGES.get(pluginId) === dicts) PLUGIN_MESSAGES.delete(pluginId);
  };
}

/** `@id.key` → 插件词典里的 `key`；不是插件 key 返回 null。 */
function pluginMessage(key: string): string | null {
  if (!key.startsWith("@")) return null;
  const dot = key.indexOf(".");
  if (dot <= 1) return null;
  const pluginId = key.slice(1, dot);
  const inner = key.slice(dot + 1);
  const dicts = PLUGIN_MESSAGES.get(pluginId);
  if (!dicts) return null;
  // 插件大多只带英文：当前语言缺了就退到 en，再退到宿主兜底语言。
  return (
    dicts[current]?.[inner] ?? dicts.en?.[inner] ?? dicts[FALLBACK]?.[inner] ?? null
  );
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
  const dict = MESSAGES[current] ?? MESSAGES[FALLBACK];
  let text = dict[key] ?? MESSAGES[FALLBACK][key] ?? pluginMessage(key) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

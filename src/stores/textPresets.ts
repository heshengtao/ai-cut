/**
 * 文字预设 store：内置默认预设 + 用户保存的样式预设。
 * 预设与「上一次使用的文字样式」都持久化在 localStorage。
 */
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { ClipTextStyle } from "@/types/project";
import { DEFAULT_TEXT_STYLE, normalizeTextStyle } from "@/core/clipStyle";
import { defaultTextPreset, type TextPreset } from "@/core/textPresets";
import { t } from "@/i18n";

const PRESETS_KEY = "ai-cut-text-presets";
const LAST_STYLE_KEY = "ai-cut-last-text-style";

interface SavedTextPreset {
  id: string;
  name: string;
  text: string;
  duration: number;
  textStyle: ClipTextStyle;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadPresets(): SavedTextPreset[] {
  const raw = readJson(PRESETS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isObject).flatMap((item) => {
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    if (typeof item.text !== "string") return [];
    const duration = typeof item.duration === "number" && item.duration > 0 ? item.duration : 15;
    return [
      {
        id: item.id,
        name: item.name,
        text: item.text,
        duration,
        textStyle: normalizeTextStyle(
          isObject(item.textStyle) ? (item.textStyle as Partial<ClipTextStyle>) : {},
        ),
      },
    ];
  });
}

function loadLastStyle(): ClipTextStyle | null {
  const raw = readJson(LAST_STYLE_KEY);
  if (!isObject(raw)) return null;
  return normalizeTextStyle(raw as Partial<ClipTextStyle>);
}

export const useTextPresetsStore = defineStore("textPresets", () => {
  const saved = ref<SavedTextPreset[]>(loadPresets());
  const last = ref<ClipTextStyle | null>(loadLastStyle());

  /** 内置默认预设在前，用户预设按保存顺序跟随。 */
  const presets = computed<TextPreset[]>(() => [
    defaultTextPreset(),
    ...saved.value.map((preset) => ({ ...preset, builtin: false })),
  ]);

  /** 加文字时使用的样式：上一次操作过的样式，没有则用默认样式。 */
  const lastStyle = computed<ClipTextStyle>(() => last.value ?? DEFAULT_TEXT_STYLE);

  /** 保存一个文字样式预设；名字为空时自动生成。 */
  function savePreset(input: {
    name?: string;
    text: string;
    duration: number;
    textStyle: Partial<ClipTextStyle>;
  }): TextPreset {
    const style = normalizeTextStyle(input.textStyle);
    const name =
      input.name?.trim() || t("textPreset.autoName", { n: saved.value.length + 1 });
    const preset: SavedTextPreset = {
      id: crypto.randomUUID(),
      name,
      text: input.text.trim() || t("textPreset.default.text"),
      duration: Math.max(0.1, input.duration),
      textStyle: style,
    };
    saved.value = [...saved.value, preset];
    return { ...preset, builtin: false };
  }

  /** 删除用户预设；内置预设不可删除。 */
  function removePreset(id: string): void {
    if (id === "default") return;
    saved.value = saved.value.filter((preset) => preset.id !== id);
  }

  /** 记录一次文字样式操作，供「在播放头处添加文字」复用。 */
  function rememberStyle(style: Partial<ClipTextStyle>): void {
    last.value = normalizeTextStyle(style);
  }

  watch(
    saved,
    (value) => {
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(value));
      } catch {
        /* 存不住只影响下次启动 */
      }
    },
    { deep: true },
  );

  watch(
    last,
    (value) => {
      try {
        if (value) localStorage.setItem(LAST_STYLE_KEY, JSON.stringify(value));
        else localStorage.removeItem(LAST_STYLE_KEY);
      } catch {
        /* 存不住只影响下次启动 */
      }
    },
    { deep: true },
  );

  return { presets, lastStyle, savePreset, removePreset, rememberStyle };
});

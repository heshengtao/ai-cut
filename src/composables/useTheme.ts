/**
 * 主题：light / dark / system + 强调色，持久化到 localStorage。
 *
 * 主题必须在挂载前应用（见 `main.ts`）：否则「上次选了深色」这件事在重新打开应用时会失效。
 */
import { ref, watch } from "vue";

export type ThemeMode = "light" | "dark" | "system";

/** 强调色；`lavender` 为 MD3 基线默认色。 */
export type AccentColor = "lavender" | "blue" | "green" | "coral" | "amber";

/** 可选强调色（顺序即设置页展示顺序）。 */
export const ACCENTS: { id: AccentColor; labelKey: string; swatch: string }[] = [
  { id: "lavender", labelKey: "accent.lavender", swatch: "#6750A4" },
  { id: "blue", labelKey: "accent.blue", swatch: "#1A6CFF" },
  { id: "green", labelKey: "accent.green", swatch: "#2E7D4F" },
  { id: "coral", labelKey: "accent.coral", swatch: "#E05642" },
  { id: "amber", labelKey: "accent.amber", swatch: "#BD8900" },
];

const KEY = "ai-cut-theme";
const ACCENT_KEY = "ai-cut-accent";

function load(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* 隐私模式读不到 localStorage：用默认值 */
  }
  return "dark";
}

function loadAccent(): AccentColor {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    if (ACCENTS.some((a) => a.id === saved)) return saved as AccentColor;
  } catch {
    /* 忽略：用默认色 */
  }
  return "lavender";
}

export const themeMode = ref<ThemeMode>(load());
export const accent = ref<AccentColor>(loadAccent());

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function isDark(): boolean {
  if (themeMode.value === "system") return media?.matches ?? false;
  return themeMode.value === "dark";
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark());
  document.documentElement.setAttribute("data-accent", accent.value);
  document.documentElement.style.backgroundColor = isDark() ? "#1c1b1f" : "#fef7ff";
}

export function setTheme(mode: ThemeMode): void {
  themeMode.value = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* 忽略：主题仍在本会话生效 */
  }
}

export function setAccent(next: AccentColor): void {
  accent.value = next;
  try {
    localStorage.setItem(ACCENT_KEY, next);
  } catch {
    /* 忽略：主题色仍在本会话生效 */
  }
}

export function initTheme(): void {
  applyTheme();
  media?.addEventListener("change", () => {
    if (themeMode.value === "system") applyTheme();
  });
  watch(themeMode, applyTheme);
  watch(accent, applyTheme);
}

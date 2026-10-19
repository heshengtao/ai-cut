/**
 * 主题：light / dark / system，持久化到 localStorage。
 *
 * 主题必须在挂载前应用（见 `main.ts`）：否则「上次选了深色」这件事在重新打开应用时会失效。
 */
import { ref, watch } from "vue";

export type ThemeMode = "light" | "dark" | "system";

const KEY = "ai-cut-theme";

function load(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    /* 隐私模式读不到 localStorage：用默认值 */
  }
  return "dark";
}

export const themeMode = ref<ThemeMode>(load());

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function isDark(): boolean {
  if (themeMode.value === "system") return media?.matches ?? false;
  return themeMode.value === "dark";
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark());
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

export function initTheme(): void {
  applyTheme();
  media?.addEventListener("change", () => {
    if (themeMode.value === "system") applyTheme();
  });
  watch(themeMode, applyTheme);
}

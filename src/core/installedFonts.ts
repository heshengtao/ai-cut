/**
 * 已安装字体：启动时加载清单，生成 `@font-face` 注入页面；预览与导出共用。
 *
 * 字体是全局资源，工程里只存 `fontFamily` id。`fontStackOf()` 先查内置字体表，再查
 * 这里；找不到时回退到默认苹方，保证旧工程 / 换机器时不会变成无衬线。
 */
import { computed, ref } from "vue";
import { convertFileSrc } from "@/platform/tauri";
import { listFonts, type InstalledFont } from "./fontsApi";
import { setInstalledFontResolver } from "./fontStack";
import { isTauri } from "@/utils/platform";
import type { Project } from "@/types/project";

/** 与内置苹方字体栈保持一致，避免自定义字体缺字时回退成通用 sans-serif。 */
const FALLBACK_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

const installed = ref<InstalledFont[]>([]);
const loaded = ref(false);
let loading: Promise<void> | null = null;
let styleEl: HTMLStyleElement | null = null;

export function installedFonts(): InstalledFont[] {
  return installed.value;
}

/** 清单是否已经加载过一次（避免启动瞬间把已安装字体误判成缺失）。 */
export function installedFontsReady(): boolean {
  return loaded.value;
}

const byId = computed(() => {
  const map = new Map<string, InstalledFont>();
  for (const font of installed.value) map.set(font.id, font);
  return map;
});

export function findInstalledFont(id: string): InstalledFont | undefined {
  return byId.value.get(id);
}

// 领域侧（`clipStyle`）通过这个解析器取字体栈：它不能依赖本模块的 Vue/Tauri 依赖。
setInstalledFontResolver((id) => {
  const font = byId.value.get(id);
  return font ? `${JSON.stringify(font.family)}, ${FALLBACK_STACK}` : null;
});

function normalizePath(dir: string, file: string): string {
  return `${dir.replace(/\\/g, "/").replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`;
}

function fontFormat(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "woff2") return "woff2";
  if (ext === "woff") return "woff";
  if (ext === "otf") return "opentype";
  return "truetype";
}

/**
 * 生成注入用的 CSS。独立成纯函数，测试里可以用假的 URL 解析器。
 */
export function buildFontCss(
  fonts: InstalledFont[],
  resolveUrl: (path: string) => string = convertFileSrc,
): string {
  const rules: string[] = [];
  for (const font of fonts) {
    const family = font.family.trim();
    if (!family || !font.dir) continue;
    for (const face of font.faces) {
      if (!face.file) continue;
      const url = resolveUrl(normalizePath(font.dir, face.file));
      const range = face.unicodeRange?.trim()
        ? `unicode-range:${face.unicodeRange.trim()};`
        : "";
      rules.push(
        `@font-face{font-family:${JSON.stringify(family)};` +
          `src:url(${JSON.stringify(url)}) format(${JSON.stringify(fontFormat(face.file))});` +
          `font-weight:${face.weight || 400};font-style:${face.style || "normal"};` +
          `font-display:swap;${range}}`,
      );
    }
  }
  return rules.join("\n");
}

function applyStyles(fonts: InstalledFont[]): void {
  if (typeof document === "undefined") return;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "aicut-installed-fonts";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildFontCss(fonts);
}

/** 重新拉取清单并重注入样式（安装 / 删除后调用）。 */
export async function reloadInstalledFonts(): Promise<void> {
  // 浏览器 / 单元测试里没有 Tauri 后端：直接标记为已加载，保持空列表。
  if (!isTauri()) {
    loaded.value = true;
    return;
  }
  try {
    const fonts = await listFonts();
    installed.value = fonts;
    loaded.value = true;
    applyStyles(fonts);
  } catch (error) {
    // 浏览器里跑测试 / 预览时没有 Tauri 后端：静默保持空列表。
    console.warn("[fonts] 读取已安装字体失败", error);
  }
}

/** 启动时只加载一次；导出前也会 await 同一个 Promise。 */
export function ensureInstalledFontsLoaded(): Promise<void> {
  if (loaded.value) return Promise.resolve();
  if (!loading) {
    loading = reloadInstalledFonts().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/** 显式等待某段文字需要的字形加载完（CJK 分片按 unicode-range 按需加载）。 */
export async function ensureFontLoadedForText(
  fontId: string | undefined,
  text: string,
  weight = 600,
): Promise<void> {
  if (!fontId || text.trim() === "") return;
  const font = byId.value.get(fontId);
  if (!font || typeof document === "undefined" || !document.fonts) return;
  try {
    await document.fonts.load(`${weight} 48px ${JSON.stringify(font.family)}`, text);
  } catch {
    // 加载失败就按 CSS 回退栈渲染，不阻塞导出。
  }
}

/** 导出前把所有文字片段用到的字体加载好；Canvas 渲染是同步的，必须先 await。 */
export async function ensureProjectFontsLoaded(project: Project): Promise<void> {
  await ensureInstalledFontsLoaded();
  if (typeof document === "undefined" || !document.fonts) return;
  const pending = new Map<string, Promise<void>>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const text = clip.text ?? "";
      const fontId = clip.textStyle?.fontFamily;
      if (!fontId || text.trim() === "") continue;
      const key = `${fontId}\u0000${text}`;
      if (!pending.has(key)) pending.set(key, ensureFontLoadedForText(fontId, text));
    }
  }
  await Promise.all(pending.values());
  try {
    await document.fonts.ready;
  } catch {
    // 忽略：字体就绪事件在部分 WebView 上不支持。
  }
}

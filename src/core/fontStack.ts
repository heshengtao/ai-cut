/**
 * 已安装字体 → CSS 字体栈的解析器（纯领域侧）。
 *
 * `clipStyle` 属于领域代码，无头文档引擎（QuickJS）也要跑它，所以不能直接 import
 * `installedFonts`——那个模块依赖 Vue / Tauri / DOM。桌面与浏览器在字体清单加载后
 * 注入解析器；无头引擎不注入，`fontStackOf` 自然回退到内置字体栈。
 */
let resolver: ((id: string) => string | null) | null = null;

export function setInstalledFontResolver(
  next: ((id: string) => string | null) | null,
): void {
  resolver = next;
}

/** 已安装字体的 CSS 字体栈；未安装（或没有注入解析器）返回 null。 */
export function installedFontStack(id: string): string | null {
  return resolver ? resolver(id) : null;
}

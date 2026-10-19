/** 平台判断：只在 Tauri 里才碰窗口 API，浏览器预览下全部降级为普通页面。 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isMacOS(): boolean {
  const platform = navigator.platform || "";
  return /mac/i.test(platform) || navigator.userAgent.includes("Macintosh");
}

export function isWindows(): boolean {
  return /win/i.test(navigator.platform || "") || navigator.userAgent.includes("Windows");
}

export function isLinux(): boolean {
  return !isMacOS() && !isWindows();
}

/**
 * 运行时环境：桌面（Tauri）还是浏览器（连本机/局域网 daemon）。
 *
 * 浏览器模式下，前端由 daemon 的静态托管同源提供；服务端**不鉴权**，
 * 打开端口就能用，访问控制交给部署侧（局域网 / 网关）。
 */

/** 是否跑在浏览器里（有 http(s) 且没有 Tauri 注入）。 */
export function isWebRuntime(): boolean {
  if (typeof window === "undefined") return false;
  if ("__TAURI_INTERNALS__" in window) return false;
  return /^https?:$/.test(window.location.protocol);
}

/** RPC / 媒体的基础路径（Vite 的 base，默认 `/`）。 */
export function apiBase(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}


/**
 * 访问 token：**已经不需要**。
 *
 * 无头服务不鉴权（打开端口即用），这里保留空实现只为兼容既有调用点。
 */
export function webToken(): string {
    return "";
}


/** 原样返回 URL：服务端不鉴权，不再拼 token。 */
export function withToken(url: string): string {
  return url;
}

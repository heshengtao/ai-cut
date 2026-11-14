/**
 * 传输层统一出口。
 *
 * 桌面：`@tauri-apps/api` 的 invoke / listen / convertFileSrc；
 * 浏览器：同一组函数改走 daemon 的 `POST /rpc/<cmd>`、`GET /events`（SSE）、`GET /file`。
 *
 * 命令名与参数与 Rust 侧一一对应，调用方（`src/core/*Api.ts`）不需要知道当前跑在哪。
 */
import {
  convertFileSrc as tauriConvertFileSrc,
  invoke as tauriInvoke,
} from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

import { apiBase, isWebRuntime, webToken, withToken } from "./env";

/** 浏览器端一次 RPC。 */
async function webInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const response = await fetch(withToken(`${apiBase()}rpc/${encodeURIComponent(cmd)}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `RPC ${cmd} 失败（${response.status}）`;
    throw new Error(message);
  }
  return data as T;
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isWebRuntime()) return webInvoke<T>(cmd, args);
  return tauriInvoke<T>(cmd, args);
}

// ---- 事件（SSE） -----------------------------------------------------------

type Handler = (payload: unknown) => void;

const subscribers = new Map<string, Set<Handler>>();
const attached = new Set<string>();
let source: EventSource | null = null;

function ensureSource(): EventSource {
  if (source) return source;
  source = new EventSource(withToken(`${apiBase()}events`));
  source.onerror = () => {
    // EventSource 自带重连；这里只避免控制台刷屏。
  };
  return source;
}

function attach(event: string): void {
  if (attached.has(event)) return;
  attached.add(event);
  ensureSource().addEventListener(event, (message) => {
    const listeners = subscribers.get(event);
    if (!listeners) return;
    let payload: unknown = null;
    try {
      payload = JSON.parse((message as MessageEvent).data);
    } catch {
      payload = (message as MessageEvent).data;
    }
    for (const listener of listeners) listener(payload);
  });
}

export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isWebRuntime()) return tauriListen<T>(event, handler);
  const listener: Handler = (payload) => handler({ payload: payload as T });
  const set = subscribers.get(event) ?? new Set<Handler>();
  set.add(listener);
  subscribers.set(event, set);
  attach(event);
  return Promise.resolve(() => {
    set.delete(listener);
  });
}

/** 绝对路径 → 可直接放进 `<video>` / `<img>` 的 URL。 */
export function convertFileSrc(path: string): string {
  if (isWebRuntime()) {
    return withToken(`${apiBase()}file?path=${encodeURIComponent(path)}`);
  }
  return tauriConvertFileSrc(path);
}

/** 当前 token（浏览器下用于媒体 URL / 二维码；桌面下为空）。 */
export function currentWebToken(): string {
  return isWebRuntime() ? webToken() : "";
}

/** 打开外链：桌面走系统浏览器，浏览器直接开新标签。 */
export function openExternal(url: string): void {
  if (isWebRuntime()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  void tauriInvoke("open_external_url", { url }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

export type { UnlistenFn } from "@tauri-apps/api/event";

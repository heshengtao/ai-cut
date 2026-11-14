/**
 * 共享会话接收端：桌面走 Tauri 事件，浏览器走 daemon 的 `/session` WebSocket。
 *
 * 文档消息带 `affected`：只合并受影响轨道 / 素材；hello 一定是整份替换。
 * 自己的广播按 `origin` 忽略，避免回声。
 */
import { ref } from "vue";

import { apiBase, isWebRuntime, webToken } from "@/platform/env";
import { parseProject } from "@/core/serialize";
import { sessionClientId } from "@/core/sessionMerge";
import { listen } from "@/platform/tauri";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import type { Affected } from "@/types/events";

const isWeb = isWebRuntime();

/** 浏览器是否已经收到 hello；会话发布器据此决定能不能开始推。 */
export const sessionReady = ref(!isWeb);
/** hello 里有没有现成文档（没有时浏览器要把本地工程推上去）。 */
export const sessionHadDoc = ref(!isWeb);

const CLIENT = sessionClientId();
let socket: WebSocket | null = null;
let stopDesktop: (() => void) | null = null;

interface SessionMessage {
  t?: string;
  project?: string | null;
  revision?: number;
  origin?: string;
  clientRevision?: number;
  affected?: Affected | null;
  full?: boolean;
  dirty?: boolean;
  path?: string | null;
  time?: number;
  playing?: boolean;
}

function applySnapshot(message: SessionMessage): void {
  if (typeof message.project !== "string") {
    sessionHadDoc.value = false;
    sessionReady.value = true;
    return;
  }
  const project = useProjectStore();
  // 自己的广播：如果本地已经有更新的编辑，不要用服务端回声把正在拖拽的状态拽回去。
  if (
    message.origin === CLIENT &&
    Number(message.clientRevision ?? 0) < project.revision
  ) {
    sessionReady.value = true;
    return;
  }
  try {
    const incoming = parseProject(message.project);
    const full = message.t === "hello" || message.full === true || !message.affected;
    project.applyRemote(
      incoming,
      Number(message.revision) || 0,
      message.affected ?? null,
      full,
      message.dirty ?? true,
      message.path ?? null,
    );
    sessionHadDoc.value = true;
    sessionReady.value = true;
  } catch {
    // 坏快照（版本不匹配 / 截断）直接忽略，下一份会覆盖。
  }
}

function applyPlayhead(message: SessionMessage): void {
  if (typeof message.time !== "number") return;
  usePlaybackStore().setPlayhead(message.time);
}

function handle(message: SessionMessage): void {
  if (message.t === "hello") {
    applySnapshot(message);
    applyPlayhead(message);
    return;
  }
  if (message.t === "doc") {
    if (message.origin === CLIENT) return;
    applySnapshot(message);
    return;
  }
  if (message.t === "playhead") applyPlayhead(message);
}

/** 浏览器：连 daemon 的 `/session`。 */
function startWebMirror(): void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}${apiBase()}session?token=${encodeURIComponent(webToken())}`;
  const ws = new WebSocket(url);
  socket = ws;
  // 连不上 / daemon 没回 hello 时也要允许本地编辑；2 秒后放开推送。
  window.setTimeout(() => {
    if (socket === ws && !sessionReady.value) sessionReady.value = true;
  }, 2000);
  ws.onmessage = (event) => {
    try {
      handle(JSON.parse(String(event.data)) as SessionMessage);
    } catch {
      // 坏帧只丢这一条。
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    sessionReady.value = false;
    // 桌面关掉又重开 / 网络抖动：1.5 秒后重连，期间本地编辑仍然可用。
    window.setTimeout(() => {
      if (!socket) startWebMirror();
    }, 1500);
  };
}

/** 桌面：daemon 的广播被 Rust 桥接成 Tauri 事件。 */
async function startDesktopMirror(): Promise<void> {
  stopDesktop = await listen<SessionMessage>("session://message", (event) => {
    if (event.payload?.origin === CLIENT) return;
    handle(event.payload);
  });
}

/** 启动接收端；桌面与浏览器各走一条。 */
export function startSessionBridge(): void {
  if (isWeb) {
    if (!socket) startWebMirror();
    return;
  }
  if (!stopDesktop) void startDesktopMirror().catch(() => undefined);
}

/** 兼容旧调用：没有只读跟随了，断开只意味着停止接收。 */
export function stopSessionBridge(): void {
  socket?.close();
  socket = null;
  stopDesktop?.();
  stopDesktop = null;
  sessionReady.value = false;
}

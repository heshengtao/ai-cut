/**
 * MCP / 智能体 → webview 的工程命令桥接。
 *
 * Rust 侧收到工具调用后 emit `project-request`；这里执行对应操作，
 * 再 invoke `bridge_respond` 把结果送回 Rust。所有写操作仍走 project store
 * 的统一命令入口，因此时间线会直接更新、撤销历史也一致。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Command, CommandResult } from "@/types/events";
import { isCommandKind } from "@/types/events";
import { useProjectStore } from "@/stores/project";
import type { Project } from "@/types/project";
import { isTauri } from "@/utils/platform";
import { t } from "@/i18n";

interface BridgeRequest {
  id: string;
  method: string;
  payload: unknown;
}

let started = false;

export function initProjectBridge(): void {
  if (started || !isTauri()) return;
  started = true;

  const project = useProjectStore();

  void listen<BridgeRequest>("project-request", async (event) => {
    const { id, method, payload } = event.payload;
    try {
      const data = await handle(method, payload, project);
      await invoke("bridge_respond", { id, ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await invoke("bridge_respond", { id, ok: false, error: message }).catch(() => undefined);
    }
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(t("error.command.invalidPayload"));
  }
  return value as Record<string, unknown>;
}

function parseCommand(value: unknown): Command {
  const record = asRecord(value);
  if (!isCommandKind(record.kind)) {
    throw new Error(t("error.command.unknownKind", { kind: String(record.kind) }));
  }
  if (typeof record.baseRevision !== "number" || !Number.isFinite(record.baseRevision)) {
    throw new Error(`${t("error.command.invalidPayload")}：baseRevision`);
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
    baseRevision: record.baseRevision,
    actor: record.actor === "human" ? "human" : "agent",
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    kind: record.kind,
    payload: record.payload ?? {},
    label:
      typeof record.label === "string" && record.label
        ? record.label
        : t("agent.command.editTimeline"),
    timestamp:
      typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
        ? record.timestamp
        : Date.now(),
  };
}

/**
 * 给智能体/MCP 的工程快照：去掉波形与缩略图路径等派生数据，避免上下文爆炸；
 * 轨道不再暴露名称，改用 1 起始的 `index` 让智能体按编号定位。
 */
function compactProject(project: Project): Record<string, unknown> {
  return {
    ...project,
    assets: project.assets.map((asset) => {
      const { wave, thumb, ...rest } = asset;
      void wave;
      void thumb;
      return rest;
    }),
    tracks: project.tracks.map(({ name, ...track }, index) => {
      void name;
      return { index: index + 1, ...track };
    }),
  };
}

async function handle(
  method: string,
  payload: unknown,
  project: ReturnType<typeof useProjectStore>,
): Promise<unknown> {
  switch (method) {
    case "project.get":
      return { revision: project.revision, project: compactProject(project.doc) };
    case "project.apply": {
      const record = asRecord(payload);
      const command = parseCommand(record.command);
      const result: CommandResult = project.applyCommand(command);
      return result;
    }
    case "project.undo":
      project.undo();
      return { ok: true, revision: project.revision };
    case "project.redo":
      project.redo();
      return { ok: true, revision: project.revision };
    default:
      throw new Error(`未知的工程桥接方法：${method}`);
  }
}
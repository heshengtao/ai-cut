/**
 * 画布工作流的导入 / 导出（单文件 JSON）。
 *
 * 工程本身已经带画布（`project.doc.board`）；这里给的是**只搬工作流**的格式：
 * 换工程、发给同事、或者把一段工作流拖进另一个画布时用。文件里只存节点和连线，
 * 素材以节点参数 / 引用 id 的形式保留（导入后缺素材的节点会显示为未选素材）。
 */
import { isWebRuntime } from "@/platform/env";
import { readTextFile, writeTextFile } from "@/core/media";
import { normalizeBoard } from "@/core/board/schema";
import type { BoardEdge, BoardNode } from "@/types/board";
import { t } from "@/i18n";

/** 工作流文件的标识（导入时用来拒绝不相干的 JSON）。 */
export const WORKFLOW_KIND = "aicut.workflow";

export interface WorkflowFile {
  kind: string;
  version: number;
  createdAt: number;
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export interface WorkflowPayload {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

/** 导出成 JSON 文本。 */
export function exportWorkflow(nodes: BoardNode[], edges: BoardEdge[]): string {
  const file: WorkflowFile = {
    kind: WORKFLOW_KIND,
    version: 1,
    createdAt: Date.now(),
    nodes: nodes.map((node) => ({
      ...node,
      data: { ...node.data, status: undefined, error: undefined, progress: undefined },
    })),
    edges: edges.map((edge) => ({ ...edge })),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * 解析工作流 JSON。
 *
 * 同时容忍「整份工程」这种 `{ nodes, edges }` 的形态：用户可能直接把工程文件拖进来。
 * 坏条目按画布 schema 的规则丢掉（未知节点类型 / 悬空连线）。
 */
export function parseWorkflow(text: string): WorkflowPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { kind?: unknown; nodes?: unknown; edges?: unknown; board?: unknown };
  // 整份工程：优先取它的 board 字段。
  const source =
    value.board && typeof value.board === "object"
      ? (value.board as { nodes?: unknown; edges?: unknown })
      : value;
  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) return null;
  const normalized = normalizeBoard({
    nodes: source.nodes,
    edges: source.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  });
  if (normalized.nodes.length === 0) return null;
  return { nodes: normalized.nodes, edges: normalized.edges };
}

/** 浏览器里下载一个 JSON 文件。 */
function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.endsWith(".json") ? name : `${name}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 让用户选一个保存位置（桌面）或直接下载（浏览器）。返回是否真的导出。 */
export async function exportWorkflowToFile(
  name: string,
  text: string,
): Promise<boolean> {
  if (isWebRuntime()) {
    downloadText(`${name || "workflow"}.json`, text);
    return true;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: `${name || "workflow"}.json`,
    filters: [{ name: t("board.workflow.filter"), extensions: ["json"] }],
  });
  if (!picked) return false;
  await writeTextFile(picked, text);
  return true;
}

/** 让用户选一个工作流 JSON 并读出来（取消返回 null）。 */
export async function pickWorkflowText(): Promise<string | null> {
  if (isWebRuntime()) {
    return new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        void file.text().then(resolve, () => resolve(null));
      };
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: t("board.workflow.filter"), extensions: ["json"] }],
  });
  if (typeof picked !== "string") return null;
  return readTextFile(picked);
}

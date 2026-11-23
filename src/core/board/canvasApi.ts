/**
 * 画布 / 工作流的「原子化操作」接口（MCP、技能、桥接共用）。
 *
 * 每个函数都是一次完整、可解释的操作：读画布列表 / 读一张画布 / 新建 / 删除 /
 * 改名 / 切换 / 在活动画布上改节点与连线 / 运行一张已发布的工作流。
 *
 * 写操作全部落在 board store 上：撤销、过期标记、防抖落盘都照常生效，MCP 写出来
 * 的编辑和手点出来的编辑没有区别。
 */
import { useBoardStore } from "@/stores/board";
import { isKnownMessageKey } from "@/i18n/translate";
import { useProjectStore } from "@/stores/project";
import { useWorkflowLibrary } from "@/composables/useWorkflowLibrary";
import { runWorkflowDoc } from "@/composables/useBoardRun";
import { readWorkflow } from "@/core/board/library";
import { type CanvasOp, canvasTitle } from "@/core/board/ops";
import { canvasWorkflow, declKey, problemTexts, workflowProblems } from "@/core/board/workflowNodes";
import type { BoardCanvas, BoardEdge, BoardNode } from "@/types/board";

export interface CanvasSummary {
  id: string;
  title: string;
  active: boolean;
  nodeCount: number;
  edgeCount: number;
  source: string | null;
  /** 工作流签名（开始节点的输入 + 结束节点的输出）。 */
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  /** 能不能当工作流发布 / 被调用。 */
  publishable: boolean;
  problems: string[];
}

/** 画布标题：空标题 = 自动名（按当前语言渲染）。语义在 `core/board/ops.ts`。 */
function titleOf(canvas: BoardCanvas, index: number): string {
  return canvasTitle(canvas, index, isKnownMessageKey);
}

function summarize(canvas: BoardCanvas, activeId: string, index = 0): CanvasSummary {
  const nodes = canvas.doc.nodes ?? [];
  const edges = canvas.doc.edges ?? [];
  const workflow = canvasWorkflow(nodes);
  const problems = workflowProblems(nodes, edges);
  return {
    id: canvas.id,
    title: titleOf(canvas, index),
    active: canvas.id === activeId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    source: canvas.doc.source?.name ?? null,
    inputs: workflow.signature.inputs.map((decl) => ({ name: declKey(decl), type: decl.type })),
    outputs: workflow.signature.outputs.map((decl) => ({ name: declKey(decl), type: decl.type })),
    publishable: problems.length === 0,
    problems: problems.map((problem) => `${problem.code}:${problem.messageKey}`),
  };
}

/** 画布列表（活动画布带 `active: true`）。 */
export function canvasList(): { activeId: string; canvases: CanvasSummary[] } {
  const board = useBoardStore();
  return {
    activeId: board.activeCanvasId,
    canvases: board.canvases.map((canvas, index) =>
      summarize(canvas, board.activeCanvasId, index),
    ),
  };
}

/** 一张画布的完整文档（默认活动画布）。 */
export function canvasGet(canvasId?: string): {
  canvas: CanvasSummary;
  nodes: BoardNode[];
  edges: BoardEdge[];
} {
  const board = useBoardStore();
  const id = canvasId || board.activeCanvasId;
  const index = board.canvases.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`画布不存在：${id}`);
  const canvas = board.canvases[index]!;
  if (id === board.activeCanvasId) {
    return {
      canvas: summarize(
        { ...canvas, doc: { ...canvas.doc, nodes: board.nodes, edges: board.edges } },
        id,
        index,
      ),
      nodes: board.nodes,
      edges: board.edges,
    };
  }
  return {
    canvas: summarize(canvas, board.activeCanvasId, index),
    nodes: canvas.doc.nodes,
    edges: canvas.doc.edges,
  };
}

/** 新建一张空白画布并切过去。 */
export function canvasCreate(title?: string): { id: string; title: string } {
  const board = useBoardStore();
  board.newCanvas(title);
  const canvas = board.activeCanvas;
  if (!canvas) throw new Error("新建画布失败");
  const index = board.canvases.findIndex((item) => item.id === canvas.id);
  return { id: canvas.id, title: titleOf(canvas, index) };
}

/** 删除画布（工程至少保留一张）。 */
export function canvasDelete(canvasId: string): { ok: true } {
  const board = useBoardStore();
  if (!board.canvases.some((canvas) => canvas.id === canvasId)) {
    throw new Error(`画布不存在：${canvasId}`);
  }
  if (board.canvases.length <= 1) throw new Error("至少要保留一张画布");
  board.removeCanvas(canvasId);
  return { ok: true };
}

/** 重命名画布。 */
export function canvasRename(canvasId: string, title: string): { ok: true; title: string } {
  const board = useBoardStore();
  if (!board.canvases.some((canvas) => canvas.id === canvasId)) {
    throw new Error(`画布不存在：${canvasId}`);
  }
  board.renameCanvas(canvasId, title);
  return { ok: true, title: title.trim() };
}

/** 切到另一张画布（先落盘当前画布的编辑）。 */
export function canvasOpen(canvasId: string): { activeId: string } {
  const board = useBoardStore();
  if (!board.canvases.some((canvas) => canvas.id === canvasId)) {
    throw new Error(`画布不存在：${canvasId}`);
  }
  board.openCanvas(canvasId);
  return { activeId: board.activeCanvasId };
}

/** 画布原子操作的种类（MCP 一个工具收 `ops` 数组，逐条执行）。 */
export type { CanvasOp };

/**
 * 在活动画布上执行一组原子操作。
 *
 * 给了 `canvasId` 时会先切过去（工具调用方要的就是「操作那张画布」）；每条操作都会
 * 走 store 的 commit，整个调用在撤销栈里留下可撤销的步骤。
 */
export function canvasApply(ops: CanvasOp[], canvasId?: string): { activeId: string; applied: number } {
  const board = useBoardStore();
  const project = useProjectStore();
  if (project.readOnly) throw new Error("工程只读");
  if (canvasId && canvasId !== board.activeCanvasId) canvasOpen(canvasId);
  // 整组先校验再落地（语义与无头引擎同一份，见 `core/board/ops.ts`）。
  const applied = board.applyOps(ops ?? []);
  return { activeId: board.activeCanvasId, applied };
}

/**
 * 把一张画布发布成工作流（写进工作流库并打标签）。
 *
 * 和画布检查器的「发布」是同一份实现：先校验签名与图，再保存一个新版本。
 * 返回新版本与标签，调用方（MCP）据此确认发布结果。
 */
export async function workflowPublish(options: {
  canvasId?: string;
  name?: string;
  tags?: string[];
}): Promise<{ rootId: string; name: string; version: number; tags: string[] }> {
  const board = useBoardStore();
  const target = options.canvasId || board.activeCanvasId;
  if (target !== board.activeCanvasId) canvasOpen(target);
  const nodes = board.nodes;
  const edges = board.edges;
  const problems = workflowProblems(nodes, edges);
  if (problems.length > 0) {
    throw new Error(problemTexts(problems).join("; "));
  }
  const tags = ["workflow", ...(options.tags ?? []).filter((tag) => tag && tag !== "workflow")];
  const library = useWorkflowLibrary();
  const activeIndex = board.canvases.findIndex((item) => item.id === board.activeCanvasId);
  const activeTitle = board.activeCanvas
    ? titleOf(board.activeCanvas, Math.max(0, activeIndex))
    : "";
  const name = options.name?.trim() || activeTitle;
  const version = await library.publishCurrent({ name, tags });
  if (!version) throw new Error("发布工作流失败");
  return { rootId: version.rootId, name: version.name, version: version.version, tags };
}

/** 工作流库里已发布的条目（带 `subworkflow` / `api` 标签才可被调用 / 嵌入）。 */
export async function workflowCatalog(): Promise<
  { rootId: string; name: string; version: number; tags: string[]; inputs: CanvasSummary["inputs"]; outputs: CanvasSummary["outputs"] }[]
> {
  const library = useWorkflowLibrary();
  await library.refresh(true);
  const rows = [];
  for (const group of library.groups.value) {
    if (group.builtin) continue;
    if (!group.tags.includes("api") && !group.tags.includes("subworkflow")) continue;
    let inputs: CanvasSummary["inputs"] = [];
    let outputs: CanvasSummary["outputs"] = [];
    try {
      const snapshot = await readWorkflow(group.latest.id);
      const workflow = canvasWorkflow(snapshot?.nodes ?? []);
      inputs = workflow.signature.inputs.map((decl) => ({ name: declKey(decl), type: decl.type }));
      outputs = workflow.signature.outputs.map((decl) => ({ name: declKey(decl), type: decl.type }));
    } catch {
      // 快照读不出来时仍列出条目（让调用方看到名字 / 标签），签名留空。
    }
    rows.push({
      rootId: group.rootId,
      name: group.name,
      version: group.latest.version,
      tags: group.tags,
      inputs,
      outputs,
    });
  }
  return rows;
}

/**
 * 运行一张已发布的工作流（MCP / API 调用入口）。
 *
 * 和嵌入节点走同一个 `runWorkflowDoc`：递归检测、签名映射、结果键都一致。
 */
export async function workflowRun(
  rootId: string,
  inputs: Record<string, unknown> = {},
): Promise<{ rootId: string; name: string; outputs: Record<string, unknown> }> {
  const library = useWorkflowLibrary();
  await library.refresh(true);
  const group = library.groups.value.find((item) => item.rootId === rootId);
  if (!group) throw new Error(`工作流不存在：${rootId}`);
  if (!group.tags.includes("api") && !group.tags.includes("subworkflow")) {
    throw new Error(`工作流未发布为可调用：${group.name}`);
  }
  const snapshot = await readWorkflow(group.latest.id);
  if (!snapshot) throw new Error(`工作流内容读取失败：${group.name}`);
  const result = await runWorkflowDoc(snapshot.nodes, snapshot.edges, {
    inputs,
    trail: [rootId],
  });
  return { rootId, name: group.name, outputs: result.outputs };
}

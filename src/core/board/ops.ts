/**
 * 画布文档的**纯操作**（不 import Vue / store）。
 *
 * 桌面端由画布 store 负责撤销 / 选中 / 防抖落盘，无头领域引擎（`src/domain/host.ts`，
 * 跑在 QuickJS 里）直接改工程文档——两边用的是**同一份语义**：
 *
 * - 成对节点（循环开始 / 工作流开始）：开始 + 结束 + 配对线一起创建、一起删除；
 * - 组节点：删组 = 连组员一起删，组员从别的组里摘掉；
 * - 输入端口上限：内置显示节点的唯一输入口是牌堆（`max: 8`），其余端口默认 1，
 *   插件 / 工作流节点的上限以 `data.ports` 快照为准。
 *
 * `applyOpsToBoard()` 是「一次调用 = 一个撤销步」的实现，MCP 的 `board_apply_ops`
 * 在两种形态下都走它。
 */
import type {
  BoardDoc,
  BoardEdge,
  BoardNode,
  BoardNodeData,
  WorkflowSignature,
} from "@/types/board";
import type { Project } from "@/types/project";
import { t } from "@/i18n/translate";
import { normalizeBoard } from "./schema";
import {
  WORKFLOW_END_TYPE,
  WORKFLOW_START_TYPE,
  newDeclId,
} from "./workflowNodes";
import { activateCanvas, canvasesOf, replaceCanvasDoc } from "./projectBoards";

/** 显示节点唯一输入口的牌堆上限（见 `registry.ts` 的 `displayInput`）。 */
const STACK_INPUT_MAX = 8;

/**
 * 输入口 `in` 是牌堆的内置节点类型。
 *
 * 端口定义在 `registry.ts`（import 了 Vue，领域引擎不能打包），所以这里留一份显式清单，
 * 由 `registry.test.ts` 守住「清单与注册表一致」。
 */
export const STACK_INPUT_TYPES: readonly string[] = [
  "display.image",
  "display.video",
  "display.audio",
  "display.text",
  "display.value",
  "model.enhance",
];

/** 画布原子操作的种类（MCP 一个工具收 `ops` 数组，逐条执行）。 */
export type CanvasOp =
  | { kind: "add_node"; node: BoardNode }
  | {
      kind: "update_node";
      nodeId: string;
      patch: Partial<BoardNode> & { data?: Partial<BoardNodeData> };
    }
  | { kind: "remove_node"; nodeIds: string[] }
  | { kind: "connect"; edge: BoardEdge }
  | { kind: "disconnect"; edgeIds: string[] }
  | { kind: "clear" }
  | { kind: "load"; nodes: BoardNode[]; edges: BoardEdge[] };

// ---------------------------------------------------------------------------
// id / 归一化
// ---------------------------------------------------------------------------

/** 领域层的随机源：桌面与 QuickJS 都由 `globalThis.crypto` 注入（见 host.ts）。 */
function newId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 归一化一个节点（走 schema，未知 data 字段会被丢掉——这是有意的）。 */
export function sanitizeNode(raw: unknown): BoardNode {
  const normalized = normalizeBoard({
    nodes: [raw],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  });
  const node = normalized.nodes[0];
  if (!node) throw new Error("节点数据无效：需要 id / type / position");
  return node;
}

/** 归一化一条连线（端点 / 端口字段必须齐全）。 */
export function sanitizeEdge(raw: unknown): BoardEdge {
  if (!raw || typeof raw !== "object") throw new Error("连线数据无效");
  const edge = raw as Record<string, unknown>;
  for (const key of ["id", "source", "sourcePort", "target", "targetPort"]) {
    if (typeof edge[key] !== "string" || !(edge[key] as string)) {
      throw new Error(`连线缺少 ${key}`);
    }
  }
  return {
    id: edge.id as string,
    source: edge.source as string,
    sourcePort: edge.sourcePort as string,
    target: edge.target as string,
    targetPort: edge.targetPort as string,
    ...(edge.kind === "pair" ? { kind: "pair" as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// 成对节点
// ---------------------------------------------------------------------------

/**
 * 成对节点：开始 + 结束 + 配对线。
 *
 * `pairId` 是真相，配对线只表达结构；删除任意一端时另一端与配对线一起消失
 * （见 `expandRemoval`）。
 */
export const PAIR_ENDS: Record<string, { endType: string; data: () => BoardNodeData }> = {
  "loop.start": {
    endType: "loop.end",
    data: () => ({ params: { slots: 1 }, bindings: {} }),
  },
  [WORKFLOW_START_TYPE]: {
    endType: WORKFLOW_END_TYPE,
    data: () => ({
      params: {},
      bindings: {},
      signature: { inputs: [], outputs: [] },
    }),
  },
};

/** 新建工作流开始节点时的默认签名（一个 text 输入，可改名 / 删掉）。 */
export function defaultWorkflowInputs(): WorkflowSignature["inputs"] {
  return [
    {
      id: newDeclId("in"),
      name: "prompt",
      label: t("board.workflow.defaultInput"),
      type: "text",
      required: true,
      default: "",
    },
  ];
}

export function defaultWorkflowOutputs(): WorkflowSignature["outputs"] {
  return [
    {
      id: newDeclId("out"),
      name: "result",
      label: t("board.workflow.defaultOutput"),
      type: "text",
      required: true,
    },
  ];
}

/**
 * 一个节点要落地时，实际要写进画布的东西。
 *
 * 成对节点返回两端 + 配对线；普通节点返回只含自己的数组。返回 `null` 表示不是成对节点。
 */
export function pairNodesFor(
  node: BoardNode,
  endSize: { width: number; height: number } = { width: 360, height: 150 },
): { nodes: BoardNode[]; edge: BoardEdge } | null {
  const pair = PAIR_ENDS[node.type];
  if (!pair) return null;
  const size = node.size ?? { width: 360, height: 150 };
  const pairId = newId();
  const endId = newId();
  const isWorkflowStart = node.type === WORKFLOW_START_TYPE;
  const signature = isWorkflowStart
    ? { inputs: defaultWorkflowInputs(), outputs: defaultWorkflowOutputs() }
    : node.data.signature;
  const start: BoardNode = {
    ...node,
    size,
    data: {
      ...node.data,
      pairId,
      ...(signature ? { signature } : {}),
    },
  };
  const end: BoardNode = {
    id: endId,
    type: pair.endType,
    position: { x: node.position.x + size.width + 96, y: node.position.y },
    size: { ...endSize },
    data: {
      ...pair.data(),
      pairId,
      ...(isWorkflowStart
        ? { signature: { inputs: [], outputs: defaultWorkflowOutputs() } }
        : {}),
    },
  };
  const edge: BoardEdge = {
    id: newId(),
    source: start.id,
    sourcePort: "pair",
    target: endId,
    targetPort: "pair",
    kind: "pair",
  };
  return { nodes: [start, end], edge };
}

/**
 * 删除时要连带删掉的节点集合。
 *
 * - 组节点：连组员一起删（否则组名没了、节点还在）；
 * - 成对节点：删任意一端，另一端一起消失（配对线随端点一起被过滤掉）。
 */
export function expandRemoval(
  nodes: readonly BoardNode[],
  ids: readonly string[],
): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const wanted = new Set<string>(ids);
  for (const id of ids) {
    const node = byId.get(id);
    if (node?.type === "group") {
      for (const child of node.data.children ?? []) wanted.add(child);
    }
  }
  for (const id of wanted) {
    const node = byId.get(id);
    if (!node?.data.pairId) continue;
    for (const other of nodes) {
      if (other.id !== node.id && other.data.pairId === node.data.pairId) {
        wanted.add(other.id);
      }
    }
  }
  return wanted;
}

/** 删掉节点集合（组员的成员引用一起摘掉），并过滤掉落在它们身上的连线。 */
export function withoutNodes(
  board: Pick<BoardDoc, "nodes" | "edges">,
  wanted: ReadonlySet<string>,
): Pick<BoardDoc, "nodes" | "edges"> {
  return {
    nodes: board.nodes
      .filter((node) => !wanted.has(node.id))
      .map((node) =>
        node.data.children
          ? {
              ...node,
              data: {
                ...node.data,
                children: node.data.children.filter((id) => !wanted.has(id)),
              },
            }
          : node,
      ),
    edges: board.edges.filter(
      (edge) => !wanted.has(edge.source) && !wanted.has(edge.target),
    ),
  };
}

// ---------------------------------------------------------------------------
// 连线
// ---------------------------------------------------------------------------

/**
 * 某个输入端口能接几条上游。
 *
 * 优先级：节点自带的端口快照（插件 / 工作流节点）→ 内置显示节点的牌堆口 → 1。
 * 内置节点的端口定义在 `registry.ts`（import 了 Vue，领域引擎不能打包），所以这里
 * 只认「显示节点唯一输入口 `in` 是牌堆」这一条，并由
 * `registry.test.ts` 守住「没有别的内置节点偷偷开多输入」。
 */
export function inputCap(node: BoardNode, portId: string): number {
  const declared = node.data.ports?.inputs.find((port) => port.id === portId);
  if (declared) return declared.max ?? 1;
  if (portId === "in" && STACK_INPUT_TYPES.includes(node.type)) return STACK_INPUT_MAX;
  return 1;
}

/**
 * 把一条连线并进连线表；接不上返回 `null`。
 *
 * - 端点必须存在、不能自己连自己；
 * - `max > 1`：追加到上限，同一上游不重复；
 * - `max === 1`：替换该端口原来的上游。
 */
export function connectEdges(
  nodes: readonly BoardNode[],
  edges: readonly BoardEdge[],
  edge: BoardEdge,
): BoardEdge[] | null {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target || source.id === target.id) return null;
  const max = inputCap(target, edge.targetPort);
  const existing = edges.filter(
    (item) => item.target === edge.target && item.targetPort === edge.targetPort,
  );
  if (max > 1) {
    if (existing.length >= max) return null;
    if (
      existing.some(
        (item) => item.source === edge.source && item.sourcePort === edge.sourcePort,
      )
    ) {
      return null;
    }
    return [...edges, edge];
  }
  return [
    ...edges.filter(
      (item) => !(item.target === edge.target && item.targetPort === edge.targetPort),
    ),
    edge,
  ];
}

// ---------------------------------------------------------------------------
// 一组原子操作
// ---------------------------------------------------------------------------

/**
 * 在**一张画布的文档**上顺序执行一组原子操作。
 *
 * 全部成功才返回新文档（不可变更新）；任何一条失败抛错，调用方拿到的是原文档，
 * 不会留下"改了一半"的画布。
 */
export function applyOpsToBoard(board: BoardDoc, ops: readonly CanvasOp[]): BoardDoc {
  let nodes = board.nodes ?? [];
  let edges = board.edges ?? [];
  let source = board.source;
  let changed = false;

  for (const op of ops ?? []) {
    switch (op?.kind) {
      case "add_node": {
        const node = sanitizeNode(op.node);
        const paired = pairNodesFor(node);
        if (paired) {
          nodes = [...nodes, ...paired.nodes];
          edges = [...edges, paired.edge];
        } else {
          nodes = [...nodes, node];
        }
        changed = true;
        break;
      }
      case "update_node": {
        const nodeId = op.nodeId;
        if (!nodeId) throw new Error("update_node 需要 nodeId");
        const current = nodes.find((node) => node.id === nodeId);
        if (!current) throw new Error(`节点不存在：${nodeId}`);
        const { data, ...rest } = op.patch ?? {};
        const merged: BoardNode = {
          ...current,
          ...rest,
          data: { ...current.data, ...(data ?? {}) },
        };
        nodes = nodes.map((node) => (node.id === nodeId ? sanitizeNode(merged) : node));
        changed = true;
        break;
      }
      case "remove_node": {
        const wanted = expandRemoval(nodes, op.nodeIds ?? []);
        const next = withoutNodes({ nodes, edges }, wanted);
        nodes = next.nodes;
        edges = next.edges;
        changed = changed || wanted.size > 0;
        break;
      }
      case "connect": {
        const edge = sanitizeEdge(op.edge);
        const next = connectEdges(nodes, edges, edge);
        if (!next) throw new Error(`连线接不上：${edge.source}:${edge.sourcePort} → ${edge.target}:${edge.targetPort}`);
        edges = next;
        changed = true;
        break;
      }
      case "disconnect": {
        const ids = new Set(op.edgeIds ?? []);
        if (ids.size === 0) break;
        const next = edges.filter((edge) => !ids.has(edge.id));
        changed = changed || next.length !== edges.length;
        edges = next;
        break;
      }
      case "clear": {
        nodes = [];
        edges = [];
        source = undefined;
        changed = true;
        break;
      }
      case "load": {
        const normalized = normalizeBoard({
          nodes: op.nodes ?? [],
          edges: op.edges ?? [],
          viewport: board.viewport ?? { x: 0, y: 0, zoom: 1 },
          updatedAt: Date.now(),
        });
        nodes = normalized.nodes;
        edges = normalized.edges;
        source = normalized.source;
        changed = true;
        break;
      }
      default:
        throw new Error(
          `未知的画布操作：${String((op as { kind?: string })?.kind ?? "")}`,
        );
    }
  }

  if (!changed) return board;
  const next = normalizeBoard({
    ...board,
    nodes,
    edges,
    source,
    updatedAt: Date.now(),
  });
  if (!source) delete next.source;
  return next;
}

/**
 * 工程层的一次原子调用：可选先切到目标画布，再改它的文档。
 *
 * 返回新工程（`boards` 是真相，`board` 访问器由 `attachBoardView()` 折返）。
 */
export function applyCanvasOps(
  project: Project,
  ops: readonly CanvasOp[],
  canvasId?: string,
): { project: Project; canvasId: string; applied: number } {
  const list = canvasesOf(project);
  if (list.length === 0) throw new Error("工程里没有画布");
  const id = canvasId?.trim() || project.activeBoardId || list[0]!.id;
  if (!list.some((canvas) => canvas.id === id)) throw new Error(`画布不存在：${id}`);
  let next = id === project.activeBoardId ? project : activateCanvas(project, id);
  const canvas = canvasesOf(next).find((item) => item.id === id);
  if (!canvas) throw new Error(`画布不存在：${id}`);
  const doc = applyOpsToBoard(canvas.doc, ops);
  if (doc !== canvas.doc) next = replaceCanvasDoc(next, id, doc);
  return { project: next, canvasId: id, applied: ops.length };
}

/** 画布标题：空标题 = 自动名（按当前语言渲染），与 UI / MCP 的展示一致。 */
export function canvasTitle(
  canvas: { title?: string },
  index: number,
  isKnownMessageKey: (key: string) => boolean,
): string {
  const explicit = canvas.title?.trim();
  if (explicit && !isKnownMessageKey(explicit)) return explicit;
  return t("board.canvas.defaultTitle", { n: index + 1 });
}

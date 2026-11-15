/**
 * 无限画布的运行时状态。
 *
 * 文档真相在 `project.doc.board`（随工程保存）；本 store 持有可交互的副本
 * （Vue Flow 直接绑 `nodes` / `edges`），改动防抖写回工程。
 *
 * 画布有**独立**的撤销栈：画布操作不进时间线历史，避免拖一次节点就多一步
 * 时间线撤销。
 */
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useProjectStore } from "@/stores/project";
import { emptyBoard, normalizeBoard } from "@/core/board/schema";
import {
  BOARD_VERSION,
  DEFAULT_VIEWPORT,
  type BoardDoc,
  type BoardEdge,
  type BoardNode,
  type BoardNodeData,
  type BoardViewport,
} from "@/types/board";

const UNDO_LIMIT = 60;
/** 写回工程的防抖时间：拖节点时不要每个 pointermove 都改文档。 */
const WRITE_DEBOUNCE = 350;

interface Snapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: BoardViewport;
}

/** 深拷贝节点（Vue Flow 会就地改 position，不能和快照共享对象）。 */
function cloneNodes(nodes: BoardNode[]): BoardNode[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    ...(node.size ? { size: { ...node.size } } : {}),
    data: {
      ...node.data,
      params: { ...node.data.params },
      bindings: { ...node.data.bindings },
    },
  }));
}

export const useBoardStore = defineStore("board", () => {
  const project = useProjectStore();

  const nodes = ref<BoardNode[]>([]);
  const edges = ref<BoardEdge[]>([]);
  const viewport = ref<BoardViewport>({ ...DEFAULT_VIEWPORT });
  const selection = ref<string[]>([]);
  const undoStack = ref<Snapshot[]>([]);
  const redoStack = ref<Snapshot[]>([]);

  /** 最近一次由本 store 写入的文档对象：用来区分"自己写的"和"外部换的"。 */
  let lastWritten: BoardDoc | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hydrating = false;

  function snapshot(): Snapshot {
    return {
      nodes: cloneNodes(nodes.value),
      edges: edges.value.map((edge) => ({ ...edge })),
      viewport: { ...viewport.value },
    };
  }

  function restore(snap: Snapshot): void {
    nodes.value = cloneNodes(snap.nodes);
    edges.value = snap.edges.map((edge) => ({ ...edge }));
    viewport.value = { ...snap.viewport };
  }

  /** 从工程文档载入画布（打开工程 / 切工程 / 外部替换时调用）。 */
  function load(board?: BoardDoc): void {
    const normalized = normalizeBoard(board ?? emptyBoard());
    hydrating = true;
    restore({ nodes: normalized.nodes, edges: normalized.edges, viewport: normalized.viewport });
    undoStack.value = [];
    redoStack.value = [];
    selection.value = [];
    hydrating = false;
  }

  /** 立刻写回工程（测试与"切走前"用）。 */
  function flush(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const board: BoardDoc = {
      version: BOARD_VERSION,
      nodes: cloneNodes(nodes.value),
      edges: edges.value.map((edge) => ({ ...edge })),
      viewport: { ...viewport.value },
      updatedAt: Date.now(),
    };
    lastWritten = board;
    project.updateBoard(board);
  }

  function schedule(): void {
    if (hydrating) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, WRITE_DEBOUNCE);
  }

  /** 一次结构性改动：先记快照，再改，再排写回。 */
  function commit(mutate: () => void): void {
    undoStack.value = [...undoStack.value.slice(-(UNDO_LIMIT - 1)), snapshot()];
    redoStack.value = [];
    mutate();
    schedule();
  }

  function undo(): boolean {
    const previous = undoStack.value[undoStack.value.length - 1];
    if (!previous) return false;
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [...redoStack.value, snapshot()];
    restore(previous);
    schedule();
    return true;
  }

  function redo(): boolean {
    const next = redoStack.value[redoStack.value.length - 1];
    if (!next) return false;
    redoStack.value = redoStack.value.slice(0, -1);
    undoStack.value = [...undoStack.value, snapshot()];
    restore(next);
    schedule();
    return true;
  }

  function addNode(node: BoardNode): void {
    commit(() => {
      nodes.value = [...nodes.value, node];
    });
    selection.value = [node.id];
  }

  function updateNode(nodeId: string, patch: Partial<BoardNode>): void {
    commit(() => {
      nodes.value = nodes.value.map((node) =>
        node.id === nodeId ? { ...node, ...patch, data: { ...node.data, ...(patch.data ?? {}) } } : node,
      );
    });
  }

  function updateNodeData(nodeId: string, patch: Partial<BoardNodeData>): void {
    commit(() => {
      nodes.value = nodes.value.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
      );
    });
  }

  /** 拖拽过程中只改本地坐标；松手时把坐标写回节点（不额外记快照）。 */
  function applyPositions(positions: Record<string, { x: number; y: number }>): void {
    let changed = false;
    nodes.value = nodes.value.map((node) => {
      const next = positions[node.id];
      if (!next || (next.x === node.position.x && next.y === node.position.y)) return node;
      changed = true;
      return { ...node, position: { x: next.x, y: next.y } };
    });
    if (changed) schedule();
  }

  /** 拖拽结束：把当前坐标落盘。 */
  function syncPositions(): void {
    schedule();
  }

  function removeNodes(ids: string[]): void {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    commit(() => {
      nodes.value = nodes.value.filter((node) => !wanted.has(node.id));
      edges.value = edges.value.filter(
        (edge) => !wanted.has(edge.source) && !wanted.has(edge.target),
      );
      selection.value = selection.value.filter((id) => !wanted.has(id));
    });
  }

  /** 连线：同一个目标端口只保留一条（后连的替换先连的）。 */
  function connect(edge: BoardEdge): boolean {
    const source = nodes.value.find((node) => node.id === edge.source);
    const target = nodes.value.find((node) => node.id === edge.target);
    if (!source || !target || source.id === target.id) return false;
    commit(() => {
      edges.value = [
        ...edges.value.filter(
          (item) => !(item.target === edge.target && item.targetPort === edge.targetPort),
        ),
        edge,
      ];
    });
    return true;
  }

  function removeEdges(ids: string[]): void {
    if (ids.length === 0) return;
    const wanted = new Set(ids);
    commit(() => {
      edges.value = edges.value.filter((edge) => !wanted.has(edge.id));
    });
  }

  function setViewport(next: BoardViewport): void {
    viewport.value = { ...next };
    schedule();
  }

  function select(ids: string[]): void {
    selection.value = [...ids];
  }

  /** 清空画布（保留工程 / 素材）。 */
  function clear(): void {
    commit(() => {
      nodes.value = [];
      edges.value = [];
      selection.value = [];
    });
  }

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  // 外部换文档（打开工程 / 恢复历史）时重新载入；自己写回的那次跳过。
  watch(
    () => project.doc.board,
    (board) => {
      if (board && board === lastWritten) return;
      load(board);
    },
    // `flush: "sync"`：打开工程 / 恢复历史要立刻换画布，等一个 tick 会闪一下旧节点。
    { immediate: true, flush: "sync" },
  );

  return {
    nodes,
    edges,
    viewport,
    selection,
    canUndo,
    canRedo,
    undoStack,
    redoStack,
    load,
    flush,
    addNode,
    updateNode,
    updateNodeData,
    syncPositions,
    applyPositions,
    removeNodes,
    connect,
    removeEdges,
    setViewport,
    select,
    clear,
    undo,
    redo,
  };
});

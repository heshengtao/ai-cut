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
import { emptyBoard, normalizeBoard, portsCompatible } from "@/core/board/schema";
import {
  MEDIA_WIDTH,
  MODEL_WIDTH,
  nodeDefinition,
  portOf,
  portsOf,
  splitModelValue,
} from "@/core/board/registry";
import { boardPortContext } from "@/composables/useBoardPortContext";
import {
  BOARD_VERSION,
  DEFAULT_VIEWPORT,
  type BoardDoc,
  type BoardEdge,
  type BoardNode,
  type BoardNodeData,
  type BoardViewport,
} from "@/types/board";
import type { BoardWorkflowSource } from "@/types/workflow";

const UNDO_LIMIT = 60;
/** 写回工程的防抖时间：拖节点时不要每个 pointermove 都改文档。 */
const WRITE_DEBOUNCE = 350;

interface Snapshot {
  nodes: BoardNode[];
  edges: BoardEdge[];
  viewport: BoardViewport;
  source?: BoardWorkflowSource;
}

/** 复制 / 粘贴用的画布片段（节点 + 片段内部的连线）。 */
export interface BoardClipboard {
  nodes: BoardNode[];
  edges: BoardEdge[];
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
      ...(node.data.outputs ? { outputs: { ...node.data.outputs } } : {}),
      ...(node.data.values ? { values: { ...node.data.values } } : {}),
      ...(node.data.assetIds ? { assetIds: [...node.data.assetIds] } : {}),
      ...(node.data.outputAssetIds ? { outputAssetIds: [...node.data.outputAssetIds] } : {}),
    },
  }));
}

export const useBoardStore = defineStore("board", () => {
  const project = useProjectStore();

  const nodes = ref<BoardNode[]>([]);
  const edges = ref<BoardEdge[]>([]);
  const viewport = ref<BoardViewport>({ ...DEFAULT_VIEWPORT });
  /** 这块画布来自工作流库的哪个工作流（保存版本时用）。 */
  const source = ref<BoardWorkflowSource | undefined>(undefined);
  const selection = ref<string[]>([]);
  const undoStack = ref<Snapshot[]>([]);
  const redoStack = ref<Snapshot[]>([]);
  /** 画布内剪贴板：复制片段可以跨工程粘贴（素材 id 仍按当前工程解析）。 */
  const clipboard = ref<BoardClipboard | null>(null);

  /** 最近一次由本 store 写入的文档对象：用来区分"自己写的"和"外部换的"。 */
  let lastWritten: BoardDoc | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hydrating = false;

  function snapshot(): Snapshot {
    return {
      nodes: cloneNodes(nodes.value),
      edges: edges.value.map((edge) => ({ ...edge })),
      viewport: { ...viewport.value },
      ...(source.value ? { source: { ...source.value } } : {}),
    };
  }

  function restore(snap: Snapshot): void {
    nodes.value = cloneNodes(snap.nodes);
    edges.value = snap.edges.map((edge) => ({ ...edge }));
    viewport.value = { ...snap.viewport };
    source.value = snap.source ? { ...snap.source } : undefined;
  }

  /** 历史版本里各节点的默认宽度（用户自己拖过的宽度不在其中，保持不动）。 */
  const LEGACY_WIDTHS = new Set([340, 360, 380, 400, 420]);

  /**
   * 旧工程的默认宽度是按节点类型各写各的（340 / 360 / 380 / 400 / 420）。
   * 载入时把「仍等于某个旧默认值」的节点收口到统一宽度；用户手动拖过的宽度保留。
   */
  function unifyNodeWidth(node: BoardNode): BoardNode {
    // 运行队列不落盘：上次退出时还在跑 / 排队的节点，载入后回到空闲，
    // 否则节点会一直显示「运行中」并累计出几分钟的假耗时。
    const settled: BoardNode =
      node.data.status === "running" || node.data.status === "queued"
        ? {
            ...node,
            data: {
              ...node.data,
              status: "idle",
              progress: undefined,
              startedAt: undefined,
              error: node.data.error ?? undefined,
            },
          }
        : node;
    const definition = nodeDefinition(node.type);
    if (!definition || definition.category === "group" || !node.size) return settled;
    const target = definition.category === "model" ? MODEL_WIDTH : MEDIA_WIDTH;
    if (!LEGACY_WIDTHS.has(node.size.width) || node.size.width === target) return settled;
    const keepsRatio =
      definition.category !== "model" &&
      (definition.assetKind === "image" || definition.assetKind === "video");
    const height = keepsRatio
      ? Math.round(node.size.height * (target / node.size.width))
      : node.size.height;
    return { ...settled, size: { width: target, height } };
  }

  /** 从工程文档载入画布（打开工程 / 切工程 / 外部替换时调用）。 */
  function load(board?: BoardDoc): void {
    const normalized = normalizeBoard(board ?? emptyBoard());
    hydrating = true;
    restore({
      nodes: normalized.nodes.map(unifyNodeWidth),
      edges: normalized.edges,
      viewport: normalized.viewport,
      ...(normalized.source ? { source: normalized.source } : {}),
    });
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
      ...(source.value ? { source: { ...source.value } } : {}),
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

  /** 标记当前画布来自工作流库的哪个工作流（保存新版本 / 判断是否是默认工作流改的）。 */
  function setSource(next?: BoardWorkflowSource): void {
    source.value = next ? { ...next } : undefined;
    schedule();
  }

  function addNode(node: BoardNode): void {
    commit(() => {
      nodes.value = [...nodes.value, node];
    });
    selection.value = [node.id];
    refreshGroupMembership([node.id]);
  }

  /**
   * 复制一个节点（组节点会连组员一起复制，组内的连线也一起复制）。
   *
   * 复制出来的组员与外部节点之间的连线**不**复制——否则复制一次就多一堆交叉线。
   */
  function duplicateNode(nodeId: string): void {
    duplicateSelection([nodeId]);
  }

  /** 选中的节点 + 组员 + 片段内部的连线（复制 / 剪切 / 粘贴 / 复制副本共用）。 */
  function collectFragment(ids: string[]): BoardClipboard {
    // 组节点本身也要复制：`expandGroups` 只返回组员，粘贴时组框会丢。
    const wanted = new Set(ids);
    for (const id of expandGroups(ids)) wanted.add(id);
    for (const id of ids) {
      const group = nodes.value.find((node) => node.id === id);
      if (group?.type === "group") {
        for (const child of group.data.children ?? []) wanted.add(child);
      }
    }
    const picked = nodes.value.filter((node) => wanted.has(node.id));
    return {
      nodes: cloneNodes(picked),
      edges: edges.value
        .filter((edge) => wanted.has(edge.source) && wanted.has(edge.target))
        .map((edge) => ({ ...edge })),
    };
  }

  /** 把一段片段复制进剪贴板（不弹任何 UI）。返回复制的节点数。 */
  function copySelection(ids: string[] = selection.value): number {
    const fragment = collectFragment(ids);
    if (fragment.nodes.length === 0) return 0;
    clipboard.value = fragment;
    return fragment.nodes.length;
  }

  /** 剪切 = 复制进剪贴板 + 从画布删除（组节点按组员整体处理）。 */
  function cutSelection(ids: string[] = selection.value): number {
    const count = copySelection(ids);
    if (count === 0) return 0;
    removeNodes(ids);
    return count;
  }

  /**
   * 从剪贴板粘贴。
   *
   * 所有 id 重新生成（不会和现有节点撞车），组员引用同步重映射；粘贴后整体选中，
   * 用户可以立刻拖走或整组操作。
   */
  function pasteClipboard(offset: { x: number; y: number } = { x: 36, y: 36 }): string[] {
    const fragment = clipboard.value;
    if (!fragment || fragment.nodes.length === 0) return [];
    return insertWorkflow(fragment, offset);
  }

  /** 复制选中内容并立即粘贴一份（⌘D / 右键「复制节点」）。 */
  function duplicateSelection(
    ids: string[] = selection.value,
    offset: { x: number; y: number } = { x: 28, y: 28 },
  ): string[] {
    const fragment = collectFragment(ids);
    if (fragment.nodes.length === 0) return [];
    return insertWorkflow(fragment, offset);
  }

  /**
   * 改节点尺寸（拖右下角后提交，记一步撤销）。
   *
   * `record: false` 用于「图片加载后自动适配比例」：这是渲染的自然结果，
   * 不应该在撤销栈里多出一步，但仍然要排写回工程。
   */
  function resizeNode(
    nodeId: string,
    size: { width: number; height: number },
    options: { record?: boolean } = {},
  ): void {
    const apply = () => {
      nodes.value = nodes.value.map((node) =>
        node.id === nodeId ? { ...node, size: { ...size } } : node,
      );
    };
    if (options.record === false) {
      apply();
      refreshGroupMembership([nodeId]);
      schedule();
      return;
    }
    commit(apply);
    // 尺寸变化可能让节点中心移出组框（或把组框撑大）：跟着维护成员与组框。
    refreshGroupMembership([nodeId]);
    syncGroupBounds();
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
    // 换模型可能让动态端口消失（H3 的 9 图 / 分离的多条音轨）：把落在
    // 不存在端口上的连线剪掉，免得留下一条看不见的悬空边。
    if ("params" in patch) pruneStalePorts(nodeId);
    // 用户改了节点内容：下游保留上次产物，但标记为"过期"，等待显式运行。
    markDownstreamStale(nodeId);
  }

  /**
   * 剪掉端口已经不存在的连线。
   *
   * 只处理「动态前缀」端口（`refImage` / `refAudio` / `stemGuitar` 这类）：
   * 普通端口（image / text / init / end）不会因为换模型消失。模型家族还没
   * 加载时不做任何裁剪，避免把刚接好的分轨连线误删。
   */
  function pruneStalePorts(nodeId: string): void {
    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    const context = boardPortContext();
    const cloudCaps = (() => {
      const model = splitModelValue(node.data.params.model);
      if (model?.kind !== "cloud") return null;
      return context.cloudCapabilities?.(model.id) ?? null;
    })();
    const stale = edges.value.filter((edge) => {
      if (edge.target === nodeId) {
        // 首帧 / 尾帧：云端服务没有图生视频能力时端口会被收起来。
        if (
          node.type === "model.video" &&
          (edge.targetPort === "init" || edge.targetPort === "end")
        ) {
          return Boolean(cloudCaps && !cloudCaps.includes("i2v"));
        }
        // 图像参考图：云端服务没有图生图能力时连第一张参考图也不存在。
        if (node.type === "model.image" && edge.targetPort === "ref") {
          return Boolean(cloudCaps && !cloudCaps.includes("i2i"));
        }
        if (!/^ref(Image|Audio|Video)/.test(edge.targetPort)) return false;
        return portOf(node, edge.targetPort, "in", context) === null;
      }
      if (edge.source === nodeId) {
        if (!/^stem[A-Z]/.test(edge.sourcePort)) return false;
        // 分轨端口取决于模型家族；家族还没加载时先不裁，避免误删。
        const model = splitModelValue(node.data.params.model);
        const family =
          model?.kind === "local" ? context.modelFamily?.(model.id) ?? null : null;
        if (!family) return false;
        return portOf(node, edge.sourcePort, "out", context) === null;
      }
      return false;
    });
    const extras: string[] = [];
    for (const port of portsOf(node, context).inputs) {
      const max = Math.max(1, port.max ?? 1);
      const list = edges.value.filter(
        (edge) => edge.target === nodeId && edge.targetPort === port.id,
      );
      if (list.length > max) extras.push(...list.slice(max).map((edge) => edge.id));
    }
    if (stale.length === 0 && extras.length === 0) return;
    const ids = new Set([...stale.map((edge) => edge.id), ...extras]);
    edges.value = edges.value.filter((edge) => !ids.has(edge.id));
  }

  /** 一个节点「刚拖到画布上」的数据形态（组节点的组员 / 标题保留）。 */
  function resetNodeData(node: BoardNode): BoardNodeData {
    const isModel = node.type.startsWith("model.");
    const keepsMedia = node.type.startsWith("input.");
    return {
      params: isModel ? {} : { ...node.data.params },
      bindings: { ...node.data.bindings },
      ...(node.data.title ? { title: node.data.title } : {}),
      ...(keepsMedia
        ? {
            ...(node.data.assetId ? { assetId: node.data.assetId } : {}),
            ...(node.data.assetIds ? { assetIds: [...node.data.assetIds] } : {}),
            ...(node.data.stackIndex !== undefined
              ? { stackIndex: node.data.stackIndex }
              : {}),
          }
        : {}),
      // 组节点：成员和启用状态是结构，不属于「运行结果」。
      ...(node.data.children ? { children: [...node.data.children] } : {}),
      ...(node.data.ignored ? { ignored: true } : {}),
      ...(node.data.bypassed ? { bypassed: true } : {}),
    };
  }

  /**
   * 重建一组节点（多选 / 整组）：回到「刚拖到画布上」的默认状态，**不运行**。
   *
   * - 模型节点：参数恢复默认（清空 params），产物 / 文本 / 思考过程 / 耗时全清；
   * - 输入 / 显示节点：保留用户选中的素材 / 文本 / 显示方式，只清运行结果；
   * - 组节点：组员各自重建（一起执行编辑操作），组本身只清运行结果；
   * - 标题、连线、绑定保留（它们是用户搭好的结构）。
   *
   * 整组 / 多选只记**一步**撤销：误点重建还能一次性救回来。
   */
  function resetNodes(ids: string[]): void {
    if (ids.length === 0) return;
    const wanted = new Set<string>();
    for (const id of ids) {
      wanted.add(id);
      for (const child of expandGroups([id])) wanted.add(child);
    }
    commit(() => {
      nodes.value = nodes.value.map((node) =>
        wanted.has(node.id) ? { ...node, data: resetNodeData(node) } : node,
      );
    });
    for (const id of wanted) markDownstreamStale(id);
  }

  /** 单个节点的重建（组的「重建」会展开到组员，见 `resetNodes`）。 */
  function resetNode(nodeId: string): void {
    resetNodes([nodeId]);
  }

  /** 整组 / 多选打标记：禁用、旁路这类「编辑操作」按组展开。 */
  function setNodeFlags(ids: string[], patch: Partial<BoardNodeData>): void {
    const wanted = new Set([...ids, ...expandGroups(ids)]);
    if (wanted.size === 0) return;
    commit(() => {
      nodes.value = nodes.value.map((node) =>
        wanted.has(node.id) ? { ...node, data: { ...node.data, ...patch } } : node,
      );
    });
    for (const id of wanted) {
      if (patch.ignored !== undefined || patch.bypassed !== undefined) {
        markDownstreamStale(id);
      }
    }
  }

  /** 运行时状态（进度 / 状态 / 输出）：不记撤销栈，只落盘。 */
  function setNodeRuntime(nodeId: string, patch: Partial<BoardNodeData>): void {
    nodes.value = nodes.value.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
    );
    schedule();
  }

  /**
   * 上游变了：把下游节点标成"过期"（不自动执行）。
   *
   * 过期只是提示——`dispatch` 语义仍然是手动运行，避免拖一次滑杆就重跑整条链。
   */
  function markDownstreamStale(nodeId: string): void {
    const stale = new Set<string>();
    let frontier = [nodeId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of edges.value) {
          if (edge.source !== id || stale.has(edge.target)) continue;
          stale.add(edge.target);
          next.push(edge.target);
        }
      }
      frontier = next;
    }
    if (stale.size === 0) return;
    nodes.value = nodes.value.map((node) =>
      stale.has(node.id)
        ? { ...node, data: { ...node.data, status: "stale" as const } }
        : node,
    );
    schedule();
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

  /** 把「组」展开成组员：删 / 禁用 / 旁路组时，组员也要跟着处理。 */
  function expandGroups(ids: string[]): string[] {
    const out = new Set<string>();
    for (const id of ids) {
      const node = nodes.value.find((item) => item.id === id);
      if (!node) continue;
      if (node.type === "group") {
        for (const child of node.data.children ?? []) out.add(child);
      } else {
        out.add(id);
      }
    }
    return [...out];
  }

  function removeNodes(ids: string[]): void {
    if (ids.length === 0) return;
    // 删组 = 连组员一起删（否则组名没了、节点还在）。
    const expanded = new Set([...ids, ...expandGroups(ids)]);
    const wanted = new Set<string>();
    for (const id of expanded) {
      wanted.add(id);
      const node = nodes.value.find((item) => item.id === id);
      if (node?.type === "group") for (const child of node.data.children ?? []) wanted.add(child);
    }
    commit(() => {
      nodes.value = nodes.value
        .filter((node) => !wanted.has(node.id))
        .map((node) =>
          node.data.children
            ? { ...node, data: { ...node.data, children: node.data.children.filter((id) => !wanted.has(id)) } }
            : node,
        );
      edges.value = edges.value.filter(
        (edge) => !wanted.has(edge.source) && !wanted.has(edge.target),
      );
      selection.value = selection.value.filter((id) => !wanted.has(id));
    });
  }

  /** 组的留白：上方留出标题条，四边留出呼吸。 */
  const GROUP_PAD = { left: 26, top: 64, right: 26, bottom: 26 };

  /** 把若干节点框成一个组。 */
  function createGroup(ids: string[]): string | null {
    const members = ids
      .map((id) => nodes.value.find((node) => node.id === id))
      .filter((node): node is BoardNode => Boolean(node) && node!.type !== "group");
    if (members.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const member of members) {
      const size = member.size ?? { width: 240, height: 160 };
      minX = Math.min(minX, member.position.x);
      minY = Math.min(minY, member.position.y);
      maxX = Math.max(maxX, member.position.x + size.width);
      maxY = Math.max(maxY, member.position.y + size.height);
    }
    const id = crypto.randomUUID();
    const group: BoardNode = {
      id,
      type: "group",
      position: { x: Math.round(minX - GROUP_PAD.left), y: Math.round(minY - GROUP_PAD.top) },
      size: {
        width: Math.round(maxX - minX + GROUP_PAD.left + GROUP_PAD.right),
        height: Math.round(maxY - minY + GROUP_PAD.top + GROUP_PAD.bottom),
      },
      data: { params: {}, bindings: {}, children: members.map((member) => member.id) },
    };
    const memberIds = new Set(members.map((member) => member.id));
    commit(() => {
      // 一个节点只属于一个组：新建组时把它从旧组的成员表里摘掉。
      nodes.value = [
        ...nodes.value.map((node) =>
          node.type === "group" && node.data.children
            ? {
                ...node,
                data: {
                  ...node.data,
                  children: node.data.children.filter((child) => !memberIds.has(child)),
                },
              }
            : node,
        ),
        group,
      ];
    });
    selection.value = [id];
    return id;
  }

  /** 解散组：只删框，组员留在画布上。 */
  function ungroup(groupId: string): void {
    commit(() => {
      nodes.value = nodes.value.filter((node) => node.id !== groupId);
    });
  }

  /** 让组框贴合组员（组成员移动 / 增删后调用）。 */
  function syncGroupBounds(groupId?: string): void {
    const groups = nodes.value.filter(
      (node) => node.type === "group" && (!groupId || node.id === groupId),
    );
    if (groups.length === 0) return;
    const byId = new Map(nodes.value.map((node) => [node.id, node]));
    let changed = false;
    const next = nodes.value.map((node) => {
      if (node.type !== "group" || (groupId && node.id !== groupId)) return node;
      const members = (node.data.children ?? [])
        .map((id) => byId.get(id))
        .filter((member): member is BoardNode => Boolean(member));
      if (members.length === 0) return node;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const member of members) {
        const size = member.size ?? { width: 240, height: 160 };
        minX = Math.min(minX, member.position.x);
        minY = Math.min(minY, member.position.y);
        maxX = Math.max(maxX, member.position.x + size.width);
        maxY = Math.max(maxY, member.position.y + size.height);
      }
      const position = {
        x: Math.round(minX - GROUP_PAD.left),
        y: Math.round(minY - GROUP_PAD.top),
      };
      const size = {
        width: Math.round(maxX - minX + GROUP_PAD.left + GROUP_PAD.right),
        height: Math.round(maxY - minY + GROUP_PAD.top + GROUP_PAD.bottom),
      };
      if (
        node.position.x === position.x &&
        node.position.y === position.y &&
        node.size?.width === size.width &&
        node.size?.height === size.height
      ) {
        return node;
      }
      changed = true;
      return { ...node, position, size };
    });
    if (!changed) return;
    nodes.value = next;
    schedule();
  }

  /** 整组启用 / 禁用 / 旁路：组节点和组员一起改。 */
  function setGroupFlag(groupId: string, patch: Partial<BoardNodeData>): void {
    const group = nodes.value.find((node) => node.id === groupId);
    if (!group) return;
    setNodeFlags([groupId, ...(group.data.children ?? [])], patch);
  }

  /**
   * 按几何关系同步组成员（对齐 ai-board 的「视觉容器」语义）。
   *
   * 节点的**中心点**落在组框里就算组员；把节点拖出组框就会离开组。给了 `ids`
   * 时只重新判定这些节点（新拖入 / 粘贴的节点），避免拖动组本身时把它路过的
   * 节点也吸进来。
   */
  function refreshGroupMembership(ids?: string[]): void {
    const groups = nodes.value.filter((node) => node.type === "group");
    if (groups.length === 0) return;
    const targets = new Set(
      ids ??
        nodes.value
          .filter((node) => node.type !== "group")
          .map((node) => node.id),
    );
    if (targets.size === 0) return;
    const rectOf = (node: BoardNode) => {
      const size = node.size ?? { width: 240, height: 160 };
      return {
        x: node.position.x,
        y: node.position.y,
        width: size.width,
        height: size.height,
      };
    };
    // 同一个节点只属于一个组；已在某个组里且中心仍在框内就保持不动，避免
    // 「复制一份组」时副本成员被原来的组抢走。
    const currentGroupOf = new Map<string, string>();
    for (const group of groups) {
      for (const child of group.data.children ?? []) {
        if (!currentGroupOf.has(child)) currentGroupOf.set(child, group.id);
      }
    }
    const assignment = new Map<string, string>();
    for (const node of nodes.value) {
      if (!targets.has(node.id) || node.type === "group") continue;
      const size = node.size ?? { width: 240, height: 160 };
      const cx = node.position.x + size.width / 2;
      const cy = node.position.y + size.height / 2;
      const contains = (group: BoardNode) => {
        const rect = rectOf(group);
        return (
          cx >= rect.x && cy >= rect.y && cx <= rect.x + rect.width && cy <= rect.y + rect.height
        );
      };
      const existing = currentGroupOf.get(node.id);
      const existingGroup = groups.find((group) => group.id === existing);
      if (existingGroup && contains(existingGroup)) {
        assignment.set(node.id, existingGroup.id);
        continue;
      }
      let best: { id: string; area: number } | null = null;
      for (const group of groups) {
        if (!contains(group)) continue;
        const area = (group.size?.width ?? 240) * (group.size?.height ?? 160);
        if (!best || area < best.area) best = { id: group.id, area };
      }
      if (best) assignment.set(node.id, best.id);
    }
    let changed = false;
    const next = nodes.value.map((node) => {
      if (node.type !== "group") return node;
      const current = new Set(node.data.children ?? []);
      for (const id of targets) {
        if (assignment.get(id) === node.id) current.add(id);
        else if (assignment.has(id)) current.delete(id);
        else if (current.has(id)) current.delete(id);
      }
      const before = node.data.children ?? [];
      const after = [...current];
      if (after.length === before.length && after.every((id, index) => id === before[index])) {
        return node;
      }
      changed = true;
      return { ...node, data: { ...node.data, children: after } };
    });
    if (!changed) return;
    nodes.value = next;
    schedule();
  }

  /**
   * 把一段工作流并进当前画布（导入 JSON / 拖文件进来）。
   *
   * 所有 id 重新生成（避免和现有节点撞车），组员引用同步重映射；导入后整体选中，
   * 用户可以立刻拖走或整组操作。
   */
  function insertWorkflow(
    payload: { nodes: BoardNode[]; edges: BoardEdge[] },
    offset: { x: number; y: number } = { x: 32, y: 32 },
    options: { source?: BoardWorkflowSource } = {},
  ): string[] {
    if (payload.nodes.length === 0) return [];
    const idMap = new Map<string, string>();
    for (const node of payload.nodes) idMap.set(node.id, crypto.randomUUID());
    const imported = payload.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      data: {
        ...node.data,
        params: { ...node.data.params },
        bindings: { ...node.data.bindings },
        status: undefined,
        error: undefined,
        progress: undefined,
        outputAssetId: undefined,
        outputAssetIds: undefined,
        outputs: undefined,
        outputText: undefined,
        outputReasoning: undefined,
        outputOpen: undefined,
        startedAt: undefined,
        durationMs: undefined,
        ...(node.data.children
          ? {
              children: node.data.children
                .map((child) => idMap.get(child))
                .filter((id): id is string => Boolean(id)),
            }
          : {}),
      },
    }));
    const importedEdges = payload.edges
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        source: idMap.get(edge.source) ?? "",
        target: idMap.get(edge.target) ?? "",
      }))
      .filter((edge) => edge.source && edge.target);
    commit(() => {
      nodes.value = [...nodes.value, ...imported];
      edges.value = [...edges.value, ...importedEdges];
      if (options.source) source.value = { ...options.source };
    });
    selection.value = imported.map((node) => node.id);
    refreshGroupMembership(imported.map((node) => node.id));
    return selection.value;
  }

  /** 连线：同一个目标端口只保留一条（后连的替换先连的）。 */
  function connect(edge: BoardEdge): boolean {
    const source = nodes.value.find((node) => node.id === edge.source);
    const target = nodes.value.find((node) => node.id === edge.target);
    if (!source || !target || source.id === target.id) return false;
    const port = portOf(target, edge.targetPort, "in", boardPortContext());
    const max = port?.max ?? 1;
    const existing = edges.value.filter(
      (item) => item.target === edge.target && item.targetPort === edge.targetPort,
    );
    if (max > 1) {
      // 合并端口：一个输入端口可以接多个上游，到上限为止。
      if (existing.length >= max) return false;
      if (
        existing.some(
          (item) => item.source === edge.source && item.sourcePort === edge.sourcePort,
        )
      ) {
        return false;
      }
      commit(() => {
        edges.value = [...edges.value, edge];
      });
    } else {
      commit(() => {
        edges.value = [
          ...edges.value.filter(
            (item) => !(item.target === edge.target && item.targetPort === edge.targetPort),
          ),
          edge,
        ];
      });
    }
    // 新连线改变了依赖：目标节点需要重新运行才能拿到上游发布值。
    markDownstreamStale(edge.source);
    return true;
  }

  /**
   * 重建某个输入端口的上游列表（检查器多选 / 排序用）。
   *
   * `sources` 的顺序就是运行时读取的顺序（H3 的 `<Picture N>` 依赖它）。
   * 已有的边对象尽量复用，避免 Vue Flow 整条闪一下。
   */
  function bindPort(
    nodeId: string,
    portId: string,
    sources: { nodeId: string; portId: string }[],
    max: number,
  ): void {
    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    const seen = new Set<string>();
    const wanted = sources
      .filter((source) => {
        if (source.nodeId === nodeId) return false;
        const key = `${source.nodeId}:${source.portId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, Math.max(1, max));
    commit(() => {
      const keep = edges.value.filter(
        (item) => !(item.target === nodeId && item.targetPort === portId),
      );
      const existing = new Map(
        edges.value
          .filter((item) => item.target === nodeId && item.targetPort === portId)
          .map((item) => [`${item.source}:${item.sourcePort}`, item]),
      );
      const next = wanted.map(
        (source) =>
          existing.get(`${source.nodeId}:${source.portId}`) ?? {
            id: crypto.randomUUID(),
            source: source.nodeId,
            sourcePort: source.portId,
            target: nodeId,
            targetPort: portId,
          },
      );
      edges.value = [...keep, ...next];
    });
    markDownstreamStale(nodeId);
  }

  /** 改一条连线的输出端口（多输出节点：人声 / 鼓 / 视频 / 音频…）。 */
  function setEdgeSourcePort(edgeId: string, sourcePort: string): boolean {
    const edge = edges.value.find((item) => item.id === edgeId);
    if (!edge) return false;
    const source = nodes.value.find((item) => item.id === edge.source);
    const target = nodes.value.find((item) => item.id === edge.target);
    if (!source || !target) return false;
    const context = boardPortContext();
    const from = portOf(source, sourcePort, "out", context);
    if (!from) return false;
    const to = portOf(target, edge.targetPort, "in", context);
    // 只允许切到和目标输入类型兼容的输出（视频不能接到音频输入上）。
    if (to && !portsCompatible(from.type, to.type)) return false;
    if (edge.sourcePort === sourcePort) return true;
    commit(() => {
      edges.value = edges.value.map((item) =>
        item.id === edgeId ? { ...item, sourcePort } : item,
      );
    });
    markDownstreamStale(edge.target);
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

  /** 清空画布（保留工程 / 素材）。来源也一起清掉：清空后是新的一张画布。 */
  function clear(): void {
    commit(() => {
      nodes.value = [];
      edges.value = [];
      selection.value = [];
      source.value = undefined;
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
    source,
    selection,
    clipboard,
    canUndo,
    canRedo,
    undoStack,
    redoStack,
    load,
    flush,
    addNode,
    updateNode,
    duplicateNode,
    duplicateSelection,
    copySelection,
    cutSelection,
    pasteClipboard,
    resizeNode,
    updateNodeData,
    setNodeRuntime,
    setNodeFlags,
    setSource,
    resetNode,
    resetNodes,
    markDownstreamStale,
    syncPositions,
    applyPositions,
    removeNodes,
    expandGroups,
    createGroup,
    ungroup,
    syncGroupBounds,
    setGroupFlag,
    refreshGroupMembership,
    insertWorkflow,
    connect,
    bindPort,
    setEdgeSourcePort,
    removeEdges,
    setViewport,
    select,
    clear,
    undo,
    redo,
  };
});

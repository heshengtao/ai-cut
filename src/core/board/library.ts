/**
 * 工作流库：内置默认工作流 + 用户保存的工作流（带版本）。
 *
 * 用户工作流存在 `<数据目录>/workflows/`（daemon 的 `workflow.rs`），浏览器与桌面
 * 共用同一份；内置默认工作流是编译期常量，不落盘、不可删改。
 *
 * 这层只做协议转换与分组，UI 在 `WorkflowLibraryPane.vue`。
 */
import { invoke } from "@/platform/tauri";
import { t } from "@/i18n";
import { BUILTIN_WORKFLOWS, builtinWorkflow, type BuiltinWorkflow } from "./builtin";
import { normalizeBoard } from "./schema";

export { BUILTIN_WORKFLOWS, builtinWorkflow, type BuiltinWorkflow };
import type { BoardEdge, BoardNode } from "@/types/board";
import type {
  SaveWorkflowInput,
  WorkflowGroup,
  WorkflowSnapshot,
  WorkflowVersion,
} from "@/types/workflow";

/** 内置工作流的 id 前缀（保存时不会被当成用户工作流的 rootId）。 */
export const BUILTIN_PREFIX = "builtin.";

export function isBuiltinWorkflowId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

/** 内置工作流 → 一个只读的「根工作流」条目（最新版本只有 1 个）。 */
export function builtinGroup(workflow: BuiltinWorkflow): WorkflowGroup {
  const version: WorkflowVersion = {
    id: workflow.id,
    rootId: workflow.id,
    version: 1,
    name: t(workflow.nameKey),
    description: t(workflow.descriptionKey),
    origin: null,
    historyKey: null,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    nodeCount: workflow.nodes().length,
    edgeCount: workflow.edges().length,
    thumbnail: null,
    fingerprint: "",
  };
  return {
    rootId: workflow.id,
    builtin: true,
    name: version.name,
    description: version.description,
    latest: version,
    versions: [version],
    origin: null,
    historyKey: null,
  };
}

export function builtinGroups(): WorkflowGroup[] {
  return BUILTIN_WORKFLOWS.map(builtinGroup);
}

/**
 * 把版本列表按根工作流归组：最新版本在前，组按更新时间倒序。
 *
 * 纯函数（可单测）：`workflow_list` 返回的是扁平的版本列表，UI 需要「一条工作流
 * 一张卡 + 展开看历史版本」。
 */
export function groupWorkflowVersions(versions: WorkflowVersion[]): WorkflowGroup[] {
  const byRoot = new Map<string, WorkflowVersion[]>();
  for (const version of versions) {
    const list = byRoot.get(version.rootId) ?? [];
    list.push(version);
    byRoot.set(version.rootId, list);
  }
  const groups: WorkflowGroup[] = [];
  for (const [rootId, list] of byRoot) {
    list.sort((a, b) => b.version - a.version);
    const latest = list[0]!;
    groups.push({
      rootId,
      builtin: false,
      name: latest.name,
      description: latest.description,
      latest,
      versions: list,
      origin: latest.origin ?? null,
      historyKey: latest.historyKey ?? null,
    });
  }
  groups.sort((a, b) => b.latest.updatedAt - a.latest.updatedAt);
  return groups;
}

/** 列出工作流库（默认在前，用户工作流按最近更新排序）。失败时只给默认。 */
export async function listWorkflowGroups(): Promise<WorkflowGroup[]> {
  let versions: WorkflowVersion[] = [];
  try {
    versions = await invoke<WorkflowVersion[]>("workflow_list");
  } catch {
    // 浏览器预览 / 旧版 daemon：工作流库还没接上，只展示默认工作流。
    versions = [];
  }
  return [...builtinGroups(), ...groupWorkflowVersions(versions)];
}

/** 去掉运行期字段：保存到库里的工作流不该带着「上次运行中 / 失败」。 */
export function cleanWorkflowNodes(nodes: BoardNode[]): BoardNode[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    ...(node.size ? { size: { ...node.size } } : {}),
    data: {
      ...node.data,
      params: { ...node.data.params },
      bindings: { ...node.data.bindings },
      ...(node.data.outputs ? { outputs: { ...node.data.outputs } } : {}),
      ...(node.data.assetIds ? { assetIds: [...node.data.assetIds] } : {}),
      ...(node.data.outputAssetIds ? { outputAssetIds: [...node.data.outputAssetIds] } : {}),
      status: undefined,
      error: undefined,
      progress: undefined,
      startedAt: undefined,
      durationMs: undefined,
      outputText: undefined,
      outputReasoning: undefined,
    },
  }));
}

export function cleanWorkflowEdges(edges: BoardEdge[]): BoardEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

/** 保存到工作流库。返回新版本（根工作流由 daemon 决定）。 */
export async function saveWorkflowToLibrary(args: {
  rootId?: string | null;
  name: string;
  description?: string;
  origin?: string | null;
  historyKey?: string | null;
  nodes: BoardNode[];
  edges: BoardEdge[];
  thumbnail?: string | null;
}): Promise<WorkflowVersion> {
  const request: SaveWorkflowInput = {
    rootId: args.rootId ?? null,
    name: args.name.trim(),
    description: args.description ?? "",
    origin: args.origin ?? null,
    historyKey: args.historyKey ?? null,
    tags: [],
    nodes: JSON.stringify(cleanWorkflowNodes(args.nodes)),
    edges: JSON.stringify(cleanWorkflowEdges(args.edges)),
    thumbnail: args.thumbnail ?? null,
  };
  return invoke<WorkflowVersion>("workflow_save", { request });
}

/** 读取一个工作流（默认工作流直接展开内置模板）。 */
export async function readWorkflow(id: string): Promise<WorkflowSnapshot | null> {
  if (isBuiltinWorkflowId(id)) {
    const workflow = builtinWorkflow(id);
    if (!workflow) return null;
    const version = builtinGroup(workflow).latest;
    return { version, nodes: workflow.nodes(), edges: workflow.edges() };
  }
  try {
    const raw = await invoke<WorkflowSnapshot>("workflow_get", { id });
    // 库里的文件可能被手改过：按画布 schema 归一化，坏节点 / 悬空连线丢掉。
    const normalized = normalizeBoard({
      nodes: raw.nodes,
      edges: raw.edges,
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    return { version: raw.version, nodes: normalized.nodes, edges: normalized.edges };
  } catch {
    return null;
  }
}

export async function deleteWorkflow(rootId: string): Promise<void> {
  if (isBuiltinWorkflowId(rootId)) return;
  await invoke<void>("workflow_delete", { id: rootId });
}

export async function renameWorkflow(rootId: string, name: string): Promise<WorkflowVersion> {
  return invoke<WorkflowVersion>("workflow_rename", { rootId, name });
}

/**
 * 工程历史分组键：和 `core/history.ts` 的归组规则一致。
 *
 * 同一个历史（同一个工程）下重复保存同名工作流时，daemon 会把它当成同一个工作
 * 流的新版本，而不是又开一张新卡片。
 */
export function historyKeyFor(project: { createdAt: number }, path: string | null): string {
  if (path) return `path:${path.replace(/\\/g, "/").replace(/\/+$/, "")}`;
  return `created:${project.createdAt}`;
}

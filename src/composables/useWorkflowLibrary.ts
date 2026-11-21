/**
 * 工作流库的共享状态与动作（右侧面板、画布工具栏、文件菜单共用）。
 *
 * 这样「保存当前画布 / 从库插入 / 清空前自动保存 / 删除 / 改名」只有一份实现，
 * 不会出现工具栏和面板各写一套、版本号对不上。
 */
import { computed, ref } from "vue";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { useViewStore } from "@/stores/view";
import { t } from "@/i18n";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import {
  deleteWorkflow,
  historyKeyFor,
  listWorkflowGroups,
  readWorkflow,
  renameWorkflow,
  saveWorkflowToLibrary,
} from "@/core/board/library";
import type { WorkflowGroup, WorkflowVersion } from "@/types/workflow";

export type WorkflowFilter = "all" | "builtin" | "mine" | "subworkflow" | "api";

const groups = ref<WorkflowGroup[]>([]);
const loading = ref(false);
const saving = ref(false);
const query = ref("");
const filter = ref<WorkflowFilter>("all");

/** 保存对话框的状态（画布工具栏 / 面板 / 文件菜单都通过它打开）。 */
const saveOpen = ref(false);
/** 清空画布时「未保存」的三选一对话框。 */
const clearOpen = ref(false);
const saveName = ref("");
const saveDescription = ref("");
let refreshing: Promise<void> | null = null;

/** 按搜索词与「默认 / 我的」筛选后的工作流。 */
const visibleGroups = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return groups.value.filter((group) => {
    if (filter.value === "builtin" && !group.builtin) return false;
    if (filter.value === "mine" && group.builtin) return false;
    if (filter.value === "subworkflow" && !group.tags.includes("subworkflow")) return false;
    if (filter.value === "api" && !group.tags.includes("api")) return false;
    if (!needle) return true;
    return (
      group.name.toLowerCase().includes(needle) ||
      group.description.toLowerCase().includes(needle) ||
      group.rootId.toLowerCase().includes(needle)
    );
  });
});

/** 当前画布对应的工作流（有的话）。 */
const currentGroup = computed(() => {
  const source = useBoardStore().source;
  const key = source?.rootId ?? source?.builtinId;
  if (!key) return null;
  return groups.value.find((group) => group.rootId === key) ?? null;
});

async function refresh(force = false): Promise<void> {
  if (refreshing && !force) return refreshing;
  loading.value = true;
  refreshing = listWorkflowGroups()
    .then((list) => {
      groups.value = list;
    })
    .finally(() => {
      loading.value = false;
      refreshing = null;
    });
  return refreshing;
}

function defaultName(): string {
  const board = useBoardStore();
  const project = useProjectStore();
  if (board.source?.name) return board.source.name;
  return t("board.library.defaultName", { name: project.doc.name || t("board.library.untitled") });
}

/** 打开保存对话框（只保存，不清空；清空走带提醒的 `clearCanvas`）。 */
function openSave(): void {
  const board = useBoardStore();
  if (board.nodes.length === 0) {
    toast(t("board.library.emptyCanvas"), "error");
    return;
  }
  saveName.value = defaultName();
  saveDescription.value = "";
  saveOpen.value = true;
}

function closeSave(): void {
  saveOpen.value = false;
}

/**
 * 保存当前画布。
 *
 * 版本规则：
 * - 画布已经来自某个用户工作流 → 追加新版本；
 * - 画布是从默认工作流改出来的 → 新建一个用户工作流（记下 origin），而不是改默认；
 * - 同一历史（同一工程）下同名的保存也会被 daemon 归到同一个工作流。
 */
async function saveCurrent(
  name?: string,
  options: { silent?: boolean; tags?: string[] } = {},
): Promise<WorkflowVersion | null> {
  const board = useBoardStore();
  const project = useProjectStore();
  if (board.nodes.length === 0) {
    if (!options.silent) toast(t("board.library.emptyCanvas"), "error");
    return null;
  }
  const trimmed = (name ?? saveName.value).trim() || defaultName();
  const rootId = board.source?.rootId ?? null;
  // 已属于用户工作流时不需要 origin；从默认工作流改出来时记下来源，方便筛选。
  const origin = rootId ? null : board.source?.builtinId ?? null;
  saving.value = true;
  try {
    const version = await saveWorkflowToLibrary({
      rootId,
      name: trimmed,
      description: saveDescription.value.trim(),
      origin,
      historyKey: historyKeyFor(project.doc, project.filePath),
      tags: options.tags,
      nodes: board.nodes,
      edges: board.edges,
    });
    board.setSource({
      rootId: version.rootId,
      name: version.name,
      version: version.version,
    });
    await refresh(true);
    if (!options.silent) {
      toast(t("board.library.saved", { name: version.name, version: version.version }));
    }
    return version;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return null;
  } finally {
    saving.value = false;
  }
}

/** 对话框提交：保存当前画布。 */
async function submitSave(): Promise<void> {
  const version = await saveCurrent();
  if (!version) return;
  saveOpen.value = false;
}

/** 发布当前画布：保存一个新版本，并打上 `workflow` / `subworkflow` / `api` 标签。 */
async function publishCurrent(options: {
  name: string;
  tags: string[];
}): Promise<WorkflowVersion | null> {
  const version = await saveCurrent(options.name, { tags: options.tags, silent: true });
  if (version) await refresh(true);
  return version;
}

/** 把工作流插入画布（默认工作流直接展开内置模板）。 */
async function insertWorkflow(
  group: WorkflowGroup,
  version?: WorkflowVersion,
  at?: { x: number; y: number },
): Promise<string[]> {
  const target = version ?? group.latest;
  const snapshot = await readWorkflow(target.id);
  if (!snapshot) {
    toast(t("board.library.loadFailed"), "error");
    return [];
  }
  const view = useViewStore();
  view.setView("board");
  const board = useBoardStore();
  // 只有往空画布插入时才接管「当前工作流」身份；往已有画布上追加时保留原来
  // 的来源，免得把两次不同的工作流存成同一个版本。
  const wasEmpty = board.nodes.length === 0;
  const ids = board.insertWorkflow(
    { nodes: snapshot.nodes, edges: snapshot.edges },
    at ?? { x: 80, y: 80 },
    wasEmpty
      ? {
          source: {
            rootId: group.builtin ? undefined : group.rootId,
            builtinId: group.builtin ? group.rootId : snapshot.version.origin ?? undefined,
            name: group.name,
            version: group.builtin ? undefined : target.version,
          },
        }
      : {},
  );
  toast(t("board.library.inserted", { count: ids.length }));
  return ids;
}

async function removeGroup(group: WorkflowGroup): Promise<void> {
  if (group.builtin) return;
  const accepted = await confirm({
    title: t("board.library.deleteTitle"),
    message: t("board.library.deleteMessage", { name: group.name }),
    confirmText: t("common.delete"),
    destructive: true,
  });
  if (!accepted) return;
  try {
    await deleteWorkflow(group.rootId);
    const board = useBoardStore();
    if (board.source?.rootId === group.rootId) board.setSource(undefined);
    await refresh(true);
    toast(t("board.library.deleted"));
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

async function renameGroup(group: WorkflowGroup, name: string): Promise<void> {
  if (group.builtin) return;
  const trimmed = name.trim();
  if (!trimmed || trimmed === group.name) return;
  try {
    await renameWorkflow(group.rootId, trimmed);
    await refresh(true);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
  }
}

/**
 * 清空画布。
 *
 * 纪律：**不再自动保存**。清空一张从没保存过的画布之前弹三选一对话框
 * （保存并清空 / 直接清空 / 取消），避免每清一次就在库里多一张工作流。
 * 已经属于某个工作流的画布只做一次普通确认——库里的版本已经在。
 */
async function clearCanvas(): Promise<void> {
  const board = useBoardStore();
  if (board.nodes.length === 0) {
    board.clear();
    return;
  }
  if (!board.source?.rootId) {
    clearOpen.value = true;
    return;
  }
  const accepted = await confirm({
    title: t("board.clearTitle"),
    message: t("board.clearMessage"),
    confirmText: t("board.clear"),
    destructive: true,
  });
  if (!accepted) return;
  board.clear();
  toast(t("board.clear.cleared"));
}

function closeClear(): void {
  clearOpen.value = false;
}

/** 未保存画布：先保存成一个工作流再清空。 */
async function clearWithSave(): Promise<void> {
  const board = useBoardStore();
  const name = board.source?.name || defaultName();
  const version = await saveCurrent(name, { silent: true });
  if (!version) return;
  clearOpen.value = false;
  board.clear();
  toast(t("board.library.savedAndCleared", { name: version.name }));
}

/** 未保存画布：不保存，直接清空。 */
function clearWithoutSave(): void {
  const board = useBoardStore();
  clearOpen.value = false;
  board.clear();
  toast(t("board.clear.cleared"));
}

/** 拖拽载荷里恢复工作流用（BoardView 调用）。 */
export async function readWorkflowGroup(id: string): Promise<WorkflowGroup | null> {
  await refresh();
  return groups.value.find((group) => group.rootId === id) ?? null;
}

export function useWorkflowLibrary() {
  return {
    groups,
    visibleGroups,
    currentGroup,
    loading,
    saving,
    query,
    filter,
    saveOpen,
    clearOpen,
    saveName,
    saveDescription,
    refresh,
    openSave,
    closeSave,
    saveCurrent,
    publishCurrent,
    submitSave,
    insertWorkflow,
    removeGroup,
    renameGroup,
    clearCanvas,
    closeClear,
    clearWithSave,
    clearWithoutSave,
  };
}

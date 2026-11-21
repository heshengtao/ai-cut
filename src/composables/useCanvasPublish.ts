/**
 * 发布工作流：从画布列表的「发布」按钮打开配置模态框。
 *
 * 发布状态是模块级单例（和 `useWorkflowLibrary` / 保存对话框一样），画布列表、
 * 模态框、MCP 桥接共用一份，不会各写一套版本号 / 标签。
 */
import { computed, ref } from "vue";
import { useBoardStore } from "@/stores/board";
import { useWorkflowLibrary } from "@/composables/useWorkflowLibrary";
import { useBoardLabels } from "@/composables/useBoardLabels";
import { toast } from "@/composables/useToast";
import { useI18n } from "@/i18n";
import {
  canvasWorkflow,
  workflowProblems,
  type WorkflowProblem,
} from "@/core/board/workflowNodes";
import type { BoardCanvas, WorkflowSignature } from "@/types/board";

const open = ref(false);
/** 要发布哪张画布（打开模态框前会先切过去，发布的是活动画布）。 */
const targetId = ref("");
const name = ref("");
const publishApi = ref(true);
const publishEmbed = ref(true);

export function useCanvasPublish() {
  const i18n = useI18n();
  const board = useBoardStore();
  const library = useWorkflowLibrary();
  const { canvasTitle } = useBoardLabels();

  const target = computed<BoardCanvas | null>(
    () => board.canvases.find((canvas) => canvas.id === targetId.value) ?? null,
  );
  const targetIndex = computed(() =>
    Math.max(0, board.canvases.findIndex((canvas) => canvas.id === targetId.value)),
  );
  const targetTitle = computed(() =>
    target.value ? canvasTitle(target.value, targetIndex.value) : "",
  );

  /** 校验与签名都基于活动画布（打开时已经切过去），所以读实时节点。 */
  const problems = computed<WorkflowProblem[]>(() =>
    workflowProblems(board.nodes, board.edges),
  );
  const signature = computed<WorkflowSignature>(() => canvasWorkflow(board.nodes).signature);
  const publishable = computed(() => problems.value.length === 0);
  const saving = computed(() => library.saving.value);

  /** 打开「发布工作流」：先把目标画布切成活动画布，再回填名字 / 标签。 */
  function openPublish(canvasId: string): void {
    const canvas = board.canvases.find((item) => item.id === canvasId);
    if (!canvas) return;
    if (canvasId !== board.activeCanvasId) board.openCanvas(canvasId);
    targetId.value = canvasId;

    const index = Math.max(0, board.canvases.findIndex((item) => item.id === canvasId));
    const group = library.currentGroup.value;
    name.value = group?.name || canvasTitle(canvas, index);
    publishApi.value = group ? group.latest.tags.includes("api") : true;
    publishEmbed.value = group ? group.latest.tags.includes("subworkflow") : true;
    open.value = true;
    // 标签 / 名字要用库里最新的一版，别用打开面板时缓存的旧列表。
    void library.refresh();
  }

  function closePublish(): void {
    open.value = false;
  }

  /** 保存一个新版本并打发布标签。成功返回 true。 */
  async function submitPublish(): Promise<boolean> {
    if (!target.value) return false;
    if (!publishable.value) {
      const first = problems.value[0];
      toast(
        first
          ? i18n.t(first.messageKey, first.params)
          : i18n.t("board.canvas.publishBlocked"),
        "error",
      );
      return false;
    }
    const tags: string[] = ["workflow"];
    if (publishApi.value) tags.push("api");
    if (publishEmbed.value) tags.push("subworkflow");
    const version = await library.publishCurrent({
      name: name.value.trim() || targetTitle.value,
      tags,
    });
    if (!version) return false;
    open.value = false;
    toast(
      i18n.t("board.canvas.savedPublish", { name: version.name, version: version.version }),
    );
    return true;
  }

  return {
    open,
    name,
    publishApi,
    publishEmbed,
    target,
    targetTitle,
    problems,
    signature,
    publishable,
    saving,
    openPublish,
    closePublish,
    submitPublish,
  };
}

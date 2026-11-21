/**
 * 发布工作流的配置模态框：切换目标画布、校验、标签与提交参数。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  publishCurrent: vi.fn(async () => ({
    id: "r1-v2",
    rootId: "r1",
    version: 2,
    name: "画布 1",
    description: "",
    tags: ["workflow", "api", "subworkflow"],
    createdAt: 1,
    updatedAt: 2,
    nodeCount: 1,
    edgeCount: 0,
  })),
  refresh: vi.fn(async () => undefined),
}));

vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

vi.mock("@/composables/useWorkflowLibrary", () => ({
  useWorkflowLibrary: () => ({
    groups: { value: [] },
    currentGroup: { value: null },
    saving: { value: false },
    publishCurrent: mocks.publishCurrent,
    refresh: mocks.refresh,
  }),
}));

import { useCanvasPublish } from "@/composables/useCanvasPublish";
import { newProject } from "@/core/factory";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import { normalizeSignature } from "@/core/board/workflowNodes";

function setup() {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.reset(newProject("工程"), null);
  return useBoardStore();
}

/** 搭一张「文本进 → 文本出」的合法工作流画布。 */
function buildWorkflow(board: ReturnType<typeof useBoardStore>): void {
  board.addNode({
    id: "start",
    type: "workflow.start",
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {} },
  });
  const end = board.nodes.find((node) => node.type === "workflow.end")!;
  const input = normalizeSignature(board.nodes.find((node) => node.id === "start")!.data.signature)!
    .inputs[0]!;
  const output = normalizeSignature(end.data.signature)!.outputs[0]!;
  board.connect({
    id: "e1",
    source: "start",
    sourcePort: input.id,
    target: end.id,
    targetPort: output.id,
  });
}

describe("发布工作流", () => {
  beforeEach(() => {
    mocks.publishCurrent.mockClear();
    mocks.refresh.mockClear();
  });

  it("打开时切到目标画布，并带出签名 / 名字", () => {
    const board = setup();
    buildWorkflow(board);
    const firstId = board.activeCanvasId;
    board.newCanvas("第二张");
    expect(board.activeCanvasId).not.toBe(firstId);

    const publish = useCanvasPublish();
    publish.openPublish(firstId);

    expect(publish.open.value).toBe(true);
    expect(board.activeCanvasId).toBe(firstId);
    expect(publish.target.value?.id).toBe(firstId);
    expect(publish.name.value).toBe("画布 1");
    expect(publish.signature.value.inputs).toHaveLength(1);
    expect(publish.signature.value.outputs).toHaveLength(1);
    expect(publish.problems.value).toEqual([]);
    expect(publish.publishable.value).toBe(true);
    publish.closePublish();
  });

  it("校验不通过时不允许发布", async () => {
    const board = setup();
    // 只有开始节点、没有结束：校验会报问题。
    board.addNode({
      id: "solo",
      type: "workflow.start",
      position: { x: 0, y: 0 },
      data: { params: {}, bindings: {} },
    });
    const publish = useCanvasPublish();
    publish.openPublish(board.activeCanvasId);
    expect(publish.publishable.value).toBe(false);
    expect(await publish.submitPublish()).toBe(false);
    expect(mocks.publishCurrent).not.toHaveBeenCalled();
    publish.closePublish();
  });

  it("提交时把名字和两个用途标签一起传下去", async () => {
    const board = setup();
    buildWorkflow(board);
    const publish = useCanvasPublish();
    publish.openPublish(board.activeCanvasId);
    publish.name.value = "产品图生成";
    publish.publishApi.value = true;
    publish.publishEmbed.value = false;

    expect(await publish.submitPublish()).toBe(true);
    expect(mocks.publishCurrent).toHaveBeenCalledWith({
      name: "产品图生成",
      tags: ["workflow", "api"],
    });
    expect(publish.open.value).toBe(false);
  });
});

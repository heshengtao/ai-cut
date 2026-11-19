/**
 * 回归：图片显示节点要接住上游**整摞**产物（多图牌堆），而不只是第一张。
 *
 * 真实事故：模型节点一次出 4 张，显示节点只发布 `outputAssetId` 那一张，
 * 卡片永远只有一张图，牌堆 / `1 / 4` 胶囊无从谈起。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
  extractAudioPreview: vi.fn(async () => ""),
  extractVideoTrack: vi.fn(async () => ""),
  fileDataUrl: vi.fn(async () => ""),
  importAssetAt: vi.fn(),
}));

import { runAdapter } from "@/composables/useBoardRun";
import { publishedAssetIds } from "@/core/board/registry";
import { addAsset } from "@/core/ops";
import { newProject } from "@/core/factory";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import type { BoardNode } from "@/types/board";
import type { MediaAsset } from "@/types/project";

function image(id: string): MediaAsset {
  return {
    id,
    name: `${id}.png`,
    kind: "image",
    src: `/tmp/${id}.png`,
    duration: 0,
    width: 1024,
    height: 1024,
    addedAt: 0,
  };
}

function setup() {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.reset(newProject("画布"), null);
  const board = useBoardStore();
  for (const id of ["a1", "a2", "a3"]) {
    project.dispatch((doc) => addAsset(doc, image(id)));
  }
  return { project, board };
}

/** 上游节点 + 图片显示节点 + 一条连线。 */
function wire(board: ReturnType<typeof useBoardStore>, upstream: BoardNode): BoardNode {
  const display: BoardNode = {
    id: "display",
    type: "display.image",
    position: { x: 400, y: 0 },
    data: { params: {}, bindings: {} },
  };
  board.addNode(upstream);
  board.addNode(display);
  board.connect({
    id: "e1",
    source: upstream.id,
    sourcePort: "image",
    target: "display",
    targetPort: "image",
  });
  return display;
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("图片显示节点的多图牌堆", () => {
  it("发布上游整摞产物，并把当前发布那张带上", async () => {
    const { board } = setup();
    const upstream: BoardNode = {
      id: "model",
      type: "model.image",
      position: { x: 0, y: 0 },
      data: {
        params: {},
        bindings: {},
        outputAssetIds: ["a1", "a2", "a3"],
        outputAssetId: "a2",
      },
    };
    const display = wire(board, upstream);

    expect(publishedAssetIds(upstream, "image")).toEqual(["a1", "a2", "a3"]);
    await expect(runAdapter(display, "display")).resolves.toEqual({
      assets: ["a1", "a2", "a3"],
      assetId: "a2",
      kind: "image",
    });
  });

  it("上游只有单张时仍然只发布那一张（旧文档兜底）", async () => {
    const { board } = setup();
    const display = wire(board, {
      id: "model",
      type: "model.image",
      position: { x: 0, y: 0 },
      data: { params: {}, bindings: {}, outputAssetId: "a3" },
    });

    await expect(runAdapter(display, "display")).resolves.toEqual({
      assets: ["a3"],
      assetId: "a3",
      kind: "image",
    });
  });

  it("上游没发布任何图时报错，而不是发一张空图", async () => {
    const { board } = setup();
    const display = wire(board, {
      id: "model",
      type: "model.image",
      position: { x: 0, y: 0 },
      data: { params: {}, bindings: {} },
    });

    await expect(runAdapter(display, "display")).rejects.toThrow("缺少上游素材");
  });
});

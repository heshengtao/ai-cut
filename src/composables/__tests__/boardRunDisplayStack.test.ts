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

function image(id: string, kind: MediaAsset["kind"] = "image"): MediaAsset {
  return {
    id,
    name: `${id}.${kind === "video" ? "mp4" : "png"}`,
    kind,
    src: `/tmp/${id}.${kind === "video" ? "mp4" : "png"}`,
    duration: kind === "video" ? 1 : 0,
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
    targetPort: "in",
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
      values: { list: ["a1", "a2", "a3"] },
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
      values: { list: ["a3"] },
    });
  });

it("多个上游合并成一个牌堆：按检查器顺序拼接并去重", async () => {
  const { board } = setup();
  const model: BoardNode = {
    id: "model",
    type: "model.image",
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {}, outputAssetIds: ["a1", "a2"], outputAssetId: "a1" },
  };
  const input: BoardNode = {
    id: "input",
    type: "input.image",
    position: { x: 0, y: 200 },
    data: {
      params: {},
      bindings: {},
      assetIds: ["a2", "a3"],
      stackIndex: 0,
      assetId: "a2",
      values: { list: ["a2", "a3"] },
    },
  };
  const display: BoardNode = {
    id: "display",
    type: "display.image",
    position: { x: 400, y: 0 },
    data: { params: {}, bindings: {} },
  };
  board.addNode(model);
  board.addNode(input);
  board.addNode(display);
  board.connect({ id: "e1", source: "model", sourcePort: "image", target: "display", targetPort: "in" });
  board.connect({ id: "e2", source: "input", sourcePort: "list", target: "display", targetPort: "in" });

  await expect(runAdapter(display, "display")).resolves.toEqual({
    assets: ["a1", "a2", "a3"],
    assetId: "a1",
    kind: "image",
    values: { list: ["a1", "a2", "a3"] },
  });
});

it("视频显示节点也发布整摞，并保持上次发布那张", async () => {
  const { board, project } = setup();
  for (const id of ["v1", "v2"]) {
    project.dispatch((doc) => addAsset(doc, image(id, "video")));
  }
  const model: BoardNode = {
    id: "model",
    type: "model.video",
    position: { x: 0, y: 0 },
    data: { params: {}, bindings: {}, outputAssetIds: ["v1", "v2"], outputAssetId: "v2" },
  };
  const display: BoardNode = {
    id: "display",
    type: "display.video",
    position: { x: 400, y: 0 },
    data: { params: {}, bindings: {}, outputAssetId: "v2" },
  };
  board.addNode(model);
  board.addNode(display);
  board.connect({ id: "e1", source: "model", sourcePort: "video", target: "display", targetPort: "in" });

  await expect(runAdapter(display, "display")).resolves.toMatchObject({
    assets: ["v1", "v2"],
    assetId: "v2",
    kind: "video",
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

/**
 * 多值节点：当前值 + 整组数组两个输出；显示节点也能吃数组。
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
import { newProject } from "@/core/factory";
import { useBoardStore } from "@/stores/board";
import { useProjectStore } from "@/stores/project";
import type { BoardNode } from "@/types/board";

function node(id: string, type: string, data: Partial<BoardNode["data"]> = {}): BoardNode {
  return { id, type, position: { x: 0, y: 0 }, data: { params: {}, bindings: {}, ...data } };
}

function setup() {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.reset(newProject("画布"), null);
  return useBoardStore();
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("多值输入 / 显示", () => {
  it("文本输入：当前段 + 整组数组", async () => {
    setup();
    const text = node("t", "input.text", { items: ["一", "二", "三"], stackIndex: 1 });
    await expect(runAdapter(text, "t")).resolves.toEqual({
      text: "二",
      values: { list: ["一", "二", "三"] },
    });
  });

  it("值输入：按 kind 解析当前值，并把整组解析成数组", async () => {
    setup();
    const value = node("v", "input.value", {
      params: { kind: "integer" },
      items: [1.9, 2.2],
      stackIndex: 1,
    });
    await expect(runAdapter(value, "v")).resolves.toEqual({
      values: { value: 2, list: [1, 2] },
    });
  });

  it("显示节点吃数组：按 stackIndex 选当前项，同时把整组透传出去", async () => {
    const board = setup();
    const list = node("src", "input.value", {
      params: { kind: "json" },
      values: { value: ["甲", "乙"] },
    });
    const display = node("d", "display.text", { stackIndex: 1 });
    board.addNode(list);
    board.addNode(display);
    board.connect({
      id: "e1",
      source: "src",
      sourcePort: "value",
      target: "d",
      targetPort: "list",
    });
    await expect(runAdapter(display, "d")).resolves.toEqual({
      text: "乙",
      values: { list: ["甲", "乙"] },
    });
  });
});

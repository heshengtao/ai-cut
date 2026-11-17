import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/platform/tauri", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import {
  deleteWorkflow,
  listWorkflowGroups,
  readWorkflow,
  renameWorkflow,
  saveWorkflowToLibrary,
} from "@/core/board/library";
import type { BoardNode } from "@/types/board";
import type { WorkflowVersion } from "@/types/workflow";

const version: WorkflowVersion = {
  id: "1710000000000-1-v1",
  rootId: "1710000000000-1",
  version: 1,
  name: "我的工作流",
  description: "",
  origin: null,
  historyKey: "created:1",
  tags: [],
  createdAt: 1,
  updatedAt: 2,
  nodeCount: 1,
  edgeCount: 0,
  thumbnail: null,
  fingerprint: "fp",
};

function node(): BoardNode {
  return {
    id: "n1",
    type: "model.image",
    position: { x: 0, y: 0 },
    data: {
      params: { model: "local:sdxl" },
      bindings: {},
      status: "error",
      error: "boom",
      outputText: "x",
    },
  };
}

beforeEach(() => {
  invoke.mockReset();
});

describe("工作流库 API", () => {
  it("保存时只发画布内容与来源，并清掉运行期字段", async () => {
    invoke.mockResolvedValue(version);
    const saved = await saveWorkflowToLibrary({
      rootId: null,
      name: "  我的工作流 ",
      origin: "builtin.text-to-image",
      historyKey: "created:1",
      nodes: [node()],
      edges: [],
    });
    expect(saved).toEqual(version);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [command, args] = invoke.mock.calls[0]!;
    expect(command).toBe("workflow_save");
    const request = (args as { request: Record<string, unknown> }).request;
    expect(request.rootId).toBeNull();
    expect(request.name).toBe("我的工作流");
    expect(request.origin).toBe("builtin.text-to-image");
    const nodes = JSON.parse(String(request.nodes)) as BoardNode[];
    expect(nodes[0]?.data.status).toBeUndefined();
    expect(nodes[0]?.data.error).toBeUndefined();
    expect(nodes[0]?.data.outputText).toBeUndefined();
    expect(nodes[0]?.data.params).toEqual({ model: "local:sdxl" });
  });

  it("列表 = 默认工作流 + 用户版本（按 root 归组）", async () => {
    invoke.mockResolvedValue([
      { ...version, version: 2, updatedAt: 5 },
      version,
    ]);
    const groups = await listWorkflowGroups();
    expect(groups.filter((group) => group.builtin).length).toBeGreaterThan(0);
    const mine = groups.find((group) => group.rootId === version.rootId);
    expect(mine?.versions.map((item) => item.version)).toEqual([2, 1]);
  });

  it("默认工作流直接展开内置模板，不调用后端", async () => {
    const snapshot = await readWorkflow("builtin.text-to-image");
    expect(snapshot?.nodes.length).toBeGreaterThan(0);
    expect(snapshot?.edges.length).toBeGreaterThan(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("删除 / 改名走对应命令，默认工作流是只读的", async () => {
    invoke.mockResolvedValue(undefined);
    await deleteWorkflow("builtin.text-to-image");
    expect(invoke).not.toHaveBeenCalled();

    await deleteWorkflow("1710000000000-1");
    expect(invoke).toHaveBeenCalledWith("workflow_delete", { id: "1710000000000-1" });

    invoke.mockResolvedValue(version);
    await renameWorkflow("1710000000000-1", "新名字");
    expect(invoke).toHaveBeenCalledWith("workflow_rename", {
      rootId: "1710000000000-1",
      name: "新名字",
    });
  });
});

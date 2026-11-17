import { describe, expect, it } from "vitest";
import {
  builtinGroups,
  builtinWorkflow,
  cleanWorkflowNodes,
  groupWorkflowVersions,
  historyKeyFor,
  isBuiltinWorkflowId,
} from "@/core/board/library";
import { BUILTIN_WORKFLOWS } from "@/core/board/builtin";
import type { WorkflowVersion } from "@/types/workflow";

function version(patch: Partial<WorkflowVersion> & { rootId: string; version: number }): WorkflowVersion {
  return {
    id: `${patch.rootId}-v${patch.version}`,
    rootId: patch.rootId,
    version: patch.version,
    name: patch.name ?? "工作流",
    description: patch.description ?? "",
    origin: patch.origin ?? null,
    historyKey: patch.historyKey ?? null,
    tags: patch.tags ?? [],
    createdAt: patch.createdAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
    nodeCount: patch.nodeCount ?? 2,
    edgeCount: patch.edgeCount ?? 1,
    thumbnail: null,
    fingerprint: patch.fingerprint ?? "",
  };
}

describe("工作流库", () => {
  it("按根工作流归组，版本倒序，组按更新时间倒序", () => {
    const groups = groupWorkflowVersions([
      version({ rootId: "a", version: 1, updatedAt: 10 }),
      version({ rootId: "a", version: 2, updatedAt: 30 }),
      version({ rootId: "b", version: 1, updatedAt: 20 }),
    ]);
    expect(groups.map((group) => group.rootId)).toEqual(["a", "b"]);
    expect(groups[0]?.latest.version).toBe(2);
    expect(groups[0]?.versions.map((item) => item.version)).toEqual([2, 1]);
  });

  it("默认工作流是只读的内置条目，且有内容", () => {
    const groups = builtinGroups();
    expect(groups).toHaveLength(BUILTIN_WORKFLOWS.length);
    for (const group of groups) {
      expect(group.builtin).toBe(true);
      expect(group.versions).toHaveLength(1);
      expect(group.latest.nodeCount).toBeGreaterThan(0);
      expect(isBuiltinWorkflowId(group.rootId)).toBe(true);
      const workflow = builtinWorkflow(group.rootId);
      expect(workflow?.nodes().length).toBe(group.latest.nodeCount);
      expect(workflow?.edges().length).toBe(group.latest.edgeCount);
    }
  });

  it("保存时会清掉运行期字段", () => {
    const cleaned = cleanWorkflowNodes([
      {
        id: "n1",
        type: "model.image",
        position: { x: 1, y: 2 },
        data: {
          params: { model: "local:sdxl" },
          bindings: {},
          status: "error",
          error: "boom",
          progress: 0.5,
          outputText: "x",
          outputAssetId: "a",
          startedAt: 1,
          durationMs: 2,
        },
      },
    ]);
    expect(cleaned[0]?.data.status).toBeUndefined();
    expect(cleaned[0]?.data.error).toBeUndefined();
    expect(cleaned[0]?.data.outputText).toBeUndefined();
    expect(cleaned[0]?.data.outputAssetId).toBe("a");
    expect(cleaned[0]?.data.params).toEqual({ model: "local:sdxl" });
  });

  it("历史分组键与历史工程一致", () => {
    expect(historyKeyFor({ createdAt: 5 }, "/tmp/a.json")).toBe("path:/tmp/a.json");
    expect(historyKeyFor({ createdAt: 5 }, null)).toBe("created:5");
  });
});

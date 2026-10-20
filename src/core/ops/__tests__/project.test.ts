import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { renameProject } from "@/core/ops/project";

describe("renameProject", () => {
  it("sets the name and bumps updatedAt", () => {
    const doc = newProject("旧名");
    const next = renameProject(doc, "新名");
    expect(next.name).toBe("新名");
    expect(next).not.toBe(doc);
    expect(doc.name).toBe("旧名");
  });

  it("is a no-op for the same name", () => {
    const doc = newProject("同名");
    expect(renameProject(doc, "同名")).toBe(doc);
  });
});

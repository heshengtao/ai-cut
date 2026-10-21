import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { renameProject, setProjectOutput } from "@/core/ops/project";

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

describe("setProjectOutput", () => {
  it("updates resolution and fps", () => {
    const doc = newProject();
    const next = setProjectOutput(doc, { width: 1080, height: 1920, fps: 60 });
    expect(next.width).toBe(1080);
    expect(next.height).toBe(1920);
    expect(next.fps).toBe(60);
    expect(next).not.toBe(doc);
    expect(doc.width).toBe(1920);
  });

  it("keeps unspecified fields", () => {
    const doc = newProject();
    const next = setProjectOutput(doc, { fps: 24 });
    expect(next.width).toBe(1920);
    expect(next.height).toBe(1080);
    expect(next.fps).toBe(24);
  });

  it("rounds dimensions to even numbers and clamps the range", () => {
    const doc = newProject();
    expect(setProjectOutput(doc, { width: 1919 }).width).toBe(1920);
    expect(setProjectOutput(doc, { width: 1 }).width).toBe(16);
    expect(setProjectOutput(doc, { height: 99999 }).height).toBe(8192);
  });

  it("clamps fps and keeps three decimals", () => {
    const doc = newProject();
    expect(setProjectOutput(doc, { fps: 0 }).fps).toBe(30);
    expect(setProjectOutput(doc, { fps: 1000 }).fps).toBe(120);
    expect(setProjectOutput(doc, { fps: 23.97604 }).fps).toBe(23.976);
  });

  it("is a no-op when nothing changes", () => {
    const doc = newProject();
    expect(setProjectOutput(doc, { width: 1920, height: 1080, fps: 30 })).toBe(doc);
  });
});

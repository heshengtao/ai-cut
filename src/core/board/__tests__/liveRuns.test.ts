import { afterEach, describe, expect, it } from "vitest";
import {
  beginLiveRun,
  clearLiveRuns,
  endLiveRun,
  liveRun,
  liveRuns,
  updateLiveRun,
} from "../liveRuns";

afterEach(() => clearLiveRuns());

describe("live runs", () => {
  it("begins a run with defaults", () => {
    const run = beginLiveRun("n1");
    expect(run.progress).toBeNull();
    expect(run.message).toBeNull();
    expect(run.text).toBe("");
    expect(liveRun("n1")).toBe(run);
  });

  it("exposes the same object through the reactive record", () => {
    beginLiveRun("n1");
    expect(liveRuns.n1).toBe(liveRun("n1"));
  });

  it("merges updates", () => {
    beginLiveRun("n1");
    updateLiveRun("n1", { progress: 0.5, message: "生成中" });
    expect(liveRun("n1")).toMatchObject({ progress: 0.5, message: "生成中" });
  });

  it("ignores updates for unknown nodes", () => {
    expect(() => updateLiveRun("missing", { progress: 1 })).not.toThrow();
  });

  it("clamps progress into 0..1", () => {
    beginLiveRun("n1");
    updateLiveRun("n1", { progress: 3 });
    expect(liveRun("n1")!.progress).toBe(1);
  });

  it("ends a run and drops the entry", () => {
    beginLiveRun("n1");
    endLiveRun("n1");
    expect(liveRun("n1")).toBeUndefined();
    expect(liveRuns.n1).toBeUndefined();
  });
});

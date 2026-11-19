import { describe, expect, it } from "vitest";
import { createRunSignals } from "../runSignals";

describe("run signals", () => {
  it("aborts only the named node", () => {
    const signals = createRunSignals();
    const a = signals.begin("a");
    const b = signals.begin("b");
    signals.abort("a");
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(false);
  });

  it("abortAll aborts every active node", () => {
    const signals = createRunSignals();
    const a = signals.begin("a");
    const b = signals.begin("b");
    signals.abortAll();
    expect(a.aborted && b.aborted).toBe(true);
  });

  it("lists active nodes and forgets ended ones", () => {
    const signals = createRunSignals();
    signals.begin("a");
    signals.begin("b");
    signals.end("a");
    expect(signals.active()).toEqual(["b"]);
  });

  it("re-beginning a node aborts the previous signal", () => {
    const signals = createRunSignals();
    const first = signals.begin("a");
    signals.begin("a");
    expect(first.aborted).toBe(true);
  });
});

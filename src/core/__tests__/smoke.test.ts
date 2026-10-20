import { describe, expect, it } from "vitest";
import { PROJECT_VERSION } from "@/types/project";

describe("toolchain", () => {
  it("resolves the @/ alias and reads project constants", () => {
    expect(PROJECT_VERSION).toBe(1);
  });
});

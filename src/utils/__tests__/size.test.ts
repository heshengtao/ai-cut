import { describe, expect, it } from "vitest";
import { humanSize, missingBytes } from "@/utils/size";

describe("humanSize", () => {
  it("formats common model sizes", () => {
    expect(humanSize(0)).toBe("0 B");
    expect(humanSize(816_730)).toBe("798 KB");
    expect(humanSize(2_313_101)).toBe("2.21 MB");
    expect(humanSize(160_609_290)).toBe("153 MB");
  });
});

describe("missingBytes", () => {
  it("counts only files that are not installed", () => {
    expect(
      missingBytes({
        files: [
          { approx_bytes: 100, installed: true },
          { approx_bytes: 250, installed: false },
        ],
      }),
    ).toBe(250);
  });
});

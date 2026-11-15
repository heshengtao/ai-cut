import { describe, expect, it } from "vitest";

import { outerStrokeWidth } from "@/core/clipStyle";
import type { ClipStroke } from "@/types/project";

const stroke: ClipStroke = { enabled: true, color: "#000000", width: 4 };

describe("outerStrokeWidth", () => {
  it("外描边取两倍线宽：居中描边，内侧一半由实色填充盖住", () => {
    expect(outerStrokeWidth(stroke)).toBe(8);
    expect(outerStrokeWidth(stroke, 2)).toBe(16);
  });

  it("关闭或零宽时不描边", () => {
    expect(outerStrokeWidth({ ...stroke, enabled: false })).toBe(0);
    expect(outerStrokeWidth({ ...stroke, width: 0 })).toBe(0);
  });

  it("预览与导出共用同一条宽度规则", () => {
    expect(outerStrokeWidth(stroke, 0.5)).toBe(4);
  });
});

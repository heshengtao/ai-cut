import { describe, expect, it } from "vitest";
import { buildFontCss } from "@/core/installedFonts";
import { fontStackOf, FONT_FAMILIES } from "@/core/clipStyle";
import { fontsourceId, type InstalledFont } from "@/core/fontsApi";

function installed(overrides: Partial<InstalledFont> = {}): InstalledFont {
  return {
    id: "fs-demo",
    family: "Demo Sans",
    source: "fontsource",
    sourceId: "demo",
    version: "1.0.0",
    license: "OFL-1.1",
    category: "sans-serif",
    subsets: ["latin"],
    weights: [400],
    styles: ["normal"],
    bytes: 1024,
    installedAt: 1,
    dir: "/data/fonts/fs-demo",
    faces: [
      {
        file: "files/latin-400-normal.woff2",
        weight: 400,
        style: "normal",
        subset: "latin",
        unicodeRange: "U+0-FF",
      },
    ],
    ...overrides,
  };
}

describe("buildFontCss", () => {
  it("generates @font-face with weight, format and unicode-range", () => {
    const css = buildFontCss([installed()], (path) => `asset://${path}`);
    expect(css).toContain('font-family:"Demo Sans"');
    expect(css).toContain('src:url("asset:///data/fonts/fs-demo/files/latin-400-normal.woff2")');
    expect(css).toContain('format("woff2")');
    expect(css).toContain("font-weight:400");
    expect(css).toContain("font-style:normal");
    expect(css).toContain("unicode-range:U+0-FF;");
    expect(css).toContain("font-display:swap");
  });

  it("escapes quotes in family names and handles ttf imports", () => {
    const css = buildFontCss(
      [
        installed({
          family: 'Demo "Quoted" Sans',
          source: "local",
          faces: [
            {
              file: "files/demo.ttf",
              weight: 700,
              style: "italic",
              subset: "custom",
            },
          ],
        }),
      ],
      (path) => path,
    );
    expect(css).toContain('font-family:"Demo \\"Quoted\\" Sans"');
    expect(css).toContain('format("truetype")');
    expect(css).toContain("font-weight:700");
    expect(css).not.toContain("unicode-range");
  });

  it("skips fonts without a directory", () => {
    expect(buildFontCss([installed({ dir: "" })])).toBe("");
  });

  it("normalizes windows separators", () => {
    const css = buildFontCss([installed({ dir: "C:\\data\\fonts\\fs-demo\\" })], (path) => path);
    expect(css).toContain("C:/data/fonts/fs-demo/files/latin-400-normal.woff2");
  });
});

describe("fontStackOf", () => {
  it("resolves built-in fonts", () => {
    expect(fontStackOf("serif")).toBe(FONT_FAMILIES.find((font) => font.id === "serif")?.stack);
  });

  it("falls back to PingFang for unknown or missing custom fonts", () => {
    expect(fontStackOf("fs-not-installed")).toBe(FONT_FAMILIES[0]!.stack);
  });
});

describe("fontsourceId", () => {
  it("uses the fs- prefix shared with the backend manifest", () => {
    expect(fontsourceId("noto-sans-sc")).toBe("fs-noto-sans-sc");
  });
});

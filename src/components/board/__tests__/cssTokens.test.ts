/**
 * 画布 UI 的 CSS 变量守卫。
 *
 * 背景色写错变量名（例如 `var(--surface-1)` 这种 main.css 里根本没有的 token）时，
 * CSS 会整条声明失效、节点变成透明——肉眼才能发现。这里静态检查画布相关组件：
 * 每个 `var(--x)` 要么在 main.css / 组件里定义过，要么自己带兜底值。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const FILES = [
  "src/components/board/BoardNode.vue",
  "src/components/board/BoardCanvasInspector.vue",
  "src/components/board/ClearCanvasDialog.vue",
  "src/components/board/CanvasPublishDialog.vue",
  "src/components/board/BoardEdge.vue",
  "src/components/board/BoardMenuList.vue",
  "src/components/board/StackBar.vue",
  "src/components/workspace/panes/BoardInspectorPane.vue",
  "src/components/workspace/panes/WorkflowLibraryPane.vue",
];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(vue|css)$/.test(entry)) out.push(path);
  }
  return out;
}

/** 全仓声明过的自定义属性（含模板里 `:style="{ '--x': … }"` 这种内联赋值）。 */
function declaredTokens(): Set<string> {
  const tokens = new Set<string>();
  const sources = [
    join(ROOT, "src/assets/main.css"),
    ...walk(join(ROOT, "src/components")),
    ...walk(join(ROOT, "src/views")),
  ].filter((file) => existsSync(file) && statSync(file).isFile());
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(--[a-z0-9-]+)['"]?\s*:/g)) tokens.add(match[1]!);
  }
  return tokens;
}

describe("画布 UI 的 CSS 变量", () => {
  it("用到的变量都已声明或带兜底（防止背景整条失效变透明）", () => {
    const declared = declaredTokens();
    const problems: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const match of text.matchAll(/var\((--[a-z0-9-]+)([^)]*)\)/g)) {
        const [, token, rest] = match;
        if (declared.has(token!)) continue;
        // `var(--x, fallback)` 有兜底，允许。
        if (rest && rest.includes(",")) continue;
        problems.push(`${relative(ROOT, join(ROOT, file))}: ${token}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

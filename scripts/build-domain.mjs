/**
 * 把 `src/domain/host.ts` 打成无头引擎用的单文件 bundle。
 *
 * 产物 `crates/daemon/assets/domain.js` 由 `include_str!` 编进 Rust，
 * 在 QuickJS 里执行。它是**同一份领域代码**的另一个运行时，
 * 不是另一份实现——所以这里不做任何业务裁剪。
 */
import { build } from "esbuild";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "crates", "daemon", "assets", "domain.js");

mkdirSync(path.dirname(outfile), { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/domain/host.ts"],
  outfile,
  bundle: true,
  format: "iife",
  globalName: "AICUT",
  platform: "neutral",
  target: ["es2020"],
  tsconfig: path.join(root, "tsconfig.json"),
  legalComments: "none",
  sourcemap: false,
  logLevel: "warning",
  metafile: true,
});

const bytes = statSync(outfile).size;
const inputs = Object.keys(result.metafile.inputs).length;

// 硬约束：无头引擎跑在 QuickJS 里，没有 DOM / Vue / Node。
// 只要有人不小心把 `@/i18n`（Vue 版）或 store 拖进依赖图，这里直接失败——
// 而不是等到容器里 `process is not defined` 才发现。
const forbidden = Object.keys(result.metafile.inputs).filter((input) =>
  /(^|\/)node_modules\/(\.pnpm\/)?(vue|@vue\/)|(^|\/)src\/stores\//.test(input),
);
if (forbidden.length > 0) {
  console.error(`domain bundle 不能依赖 Vue / store：\n  ${forbidden.join("\n  ")}`);
  process.exit(1);
}
console.log(`domain bundle: ${path.relative(root, outfile)} (${(bytes / 1024).toFixed(1)} KiB, ${inputs} inputs)`);

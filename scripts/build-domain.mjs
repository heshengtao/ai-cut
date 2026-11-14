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
console.log(`domain bundle: ${path.relative(root, outfile)} (${(bytes / 1024).toFixed(1)} KiB, ${inputs} inputs)`);

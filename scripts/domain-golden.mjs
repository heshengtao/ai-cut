/**
 * 生成无头引擎的一致性基准（golden）。
 *
 * 用 Node 的 `vm`（V8，与浏览器同族）执行 `crates/daemon/assets/domain.js`，
 * 注入与 Rust 侧完全相同的确定性 uuid / 时钟，跑完 `tests/fixtures/commands.json`，
 * 写出 `tests/fixtures/expected.json`。Rust 测试再把 QuickJS 的结果与它逐字段比对。
 *
 * 用法：node scripts/domain-golden.mjs
 * 改了领域代码或 fixture 之后必须重新生成，否则测试会红——这是有意的。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "crates", "daemon", "tests", "fixtures");

const code = readFileSync(path.join(root, "crates", "daemon", "assets", "domain.js"), "utf8");
const projectJson = readFileSync(path.join(fixtures, "project.json"), "utf8");
const commands = JSON.parse(readFileSync(path.join(fixtures, "commands.json"), "utf8"));

const CLOCK_BASE = 1_700_000_000_000;
let idCounter = 0;
let clockCounter = 0;

const context = vm.createContext({
  console,
  __aicut_uuid: () =>
    `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`,
  __aicut_now: () => CLOCK_BASE + ++clockCounter,
});

vm.runInContext(code, context, { filename: "domain.js" });

const engine = context.AICUT;
if (!engine) throw new Error("bundle did not expose AICUT");

engine.load(projectJson);

const results = commands.map((command) => JSON.parse(engine.apply(JSON.stringify(command))));
const snapshot = JSON.parse(engine.snapshot());

const expected = { results, snapshot };
writeFileSync(
  path.join(fixtures, "expected.json"),
  `${JSON.stringify(expected, null, 2)}\n`,
);

console.log(
  `golden: ${commands.length} commands, ${results.filter((r) => r.ok).length} ok, ` +
    `${Object.keys(snapshot).length} project keys, ${idCounter} uuids, ${clockCounter} clock reads`,
);

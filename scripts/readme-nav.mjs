#!/usr/bin/env node
/**
 * 重写各语言 README 顶部的语言导航块。
 *
 * 语言列表来自 `src/i18n/locales.json`（每条带 `label` 和 `readme`），所以新增语言只改那里，
 * 再跑一次 `node scripts/readme-nav.mjs` 即可。当前语言加粗。
 *
 * 用法：`node scripts/readme-nav.mjs [--check]`
 *   --check 只检查不写文件（导航块过期、或某份 README 的标题 / 代码块数量和英文版对不上），
 *   CI / 提交前用（不一致时退出码 1）。
 *
 * 注意：翻译流程产出的 README 会把原导航块原样带过来，所以这一步永远在翻译之后跑。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = JSON.parse(fs.readFileSync(path.join(ROOT, "src/i18n/locales.json"), "utf8"));

/** 生成导航块；`current` 是要加粗的那一条。 */
function navBlock(current) {
  const links = LOCALES.map((locale) =>
    locale.id === current
      ? `  <a href="${locale.readme}"><b>${locale.label}</b></a>`
      : `  <a href="${locale.readme}">${locale.label}</a>`,
  );
  return `<p align="center">\n${links.join(" ·\n")}\n</p>`;
}

/** 找到从 `<p align="center">` 开始、包含 `README_zh.md` 的那一段并替换。 */
function rewrite(text, current) {
  const marker = text.indexOf("<p align=\"center\">");
  if (marker < 0) return null;
  let index = marker;
  while (index >= 0) {
    const end = text.indexOf("</p>", index);
    if (end < 0) return null;
    const block = text.slice(index, end + 4);
    if (block.includes("README_zh.md")) {
      return text.slice(0, index) + navBlock(current) + text.slice(end + 4);
    }
    index = text.indexOf("<p align=\"center\">", end);
  }
  return null;
}

/** 结构指纹：标题层级和代码块数量必须和英文版一致，否则翻译时漏了内容。 */
function structure(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  return {
    h2: lines.filter((line) => line.startsWith("## ")).length,
    h3: lines.filter((line) => line.startsWith("### ")).length,
    fences: lines.filter((line) => line.startsWith("```")).length,
    tables: lines.filter((line) => line.startsWith("|")).length,
    bullets: lines.filter((line) => /^\s*[-*] /.test(line)).length,
  };
}

const check = process.argv.includes("--check");
let failed = false;
const baseFile = path.join(ROOT, "README.md");
const base = structure(baseFile);

for (const locale of LOCALES) {
  const file = path.join(ROOT, locale.readme);
  if (!fs.existsSync(file)) {
    console.warn(`skip ${locale.readme}: not found`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  const next = rewrite(text, locale.id);
  if (next == null) {
    console.error(`✗ ${locale.readme}: no language navigation block found`);
    failed = true;
    continue;
  }
  const shape = structure(file);
  const bad = Object.entries(base).filter(([key, value]) => shape[key] !== value);
  if (bad.length) {
    console.error(
      `✗ ${locale.readme}: structure differs from README.md (` +
        bad.map(([key, value]) => `${key} ${shape[key]}/${value}`).join(", ") +
        ")",
    );
    failed = true;
  }
  if (next === text) {
    if (!bad.length) console.log(`✓ ${locale.readme}`);
    continue;
  }
  if (check) {
    console.error(`✗ ${locale.readme}: navigation block is stale`);
    failed = true;
    continue;
  }
  fs.writeFileSync(file, next);
  console.log(`updated ${locale.readme}`);
}

if (failed) process.exitCode = 1;

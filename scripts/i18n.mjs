#!/usr/bin/env node
/**
 * i18n 词典工作流工具。
 *
 * 三个子命令：
 * - `split`：把源词典（默认 `src/i18n/en.ts`）按条目切成若干 JSON 批次，供翻译流程使用。
 * - `merge`：把 `out/<locale>/batch-*.json` 合并、校验后写成 `src/i18n/<locale>.ts`。
 * - `check`：校验所有词典与源词典的 key / 占位符是否一一对应（CI / `pnpm i18n:check`）。
 *
 * 用法：
 *   node scripts/i18n.mjs split --src en --size 220 --out .i18n-work
 *   node scripts/i18n.mjs merge --out .i18n-work
 *   node scripts/i18n.mjs check
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const I18N_DIR = path.join(ROOT, "src", "i18n");

/** 词典 → 导出的变量名。新增语言时两边一起加。 */
const IDENTS = {
  zh: "zh",
  "zh-TW": "zhTW",
  en: "en",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  ru: "ru",
  ar: "ar",
};

/** 每种语言的源词典：繁体从简体转写，其余从英文翻译。 */
const SOURCE = {
  zh: "en",
  "zh-TW": "zh",
  en: "en",
  ja: "en",
  ko: "en",
  es: "en",
  fr: "en",
  de: "en",
  ru: "en",
  ar: "en",
};

/** 生成词典文件时写在开头的说明。 */
const HEADERS = {
  zh: "中文词典（兜底语言）。key 与 `en.ts` 一一对应。",
  "zh-TW": "繁體中文詞典。key 与 `en.ts` 一一對應（由 `zh.ts` 轉寫）。",
  en: "English dictionary. Keys mirror `zh.ts` one-to-one.",
  ja: "日本語辞書。キーは `en.ts` と 1 対 1 で対応します。",
  ko: "한국어 사전. 키는 `en.ts` 와 1:1 로 대응합니다.",
  es: "Diccionario en español. Las claves coinciden una a una con `en.ts`.",
  fr: "Dictionnaire français. Les clés correspondent une à une à `en.ts`.",
  de: "Deutsches Wörterbuch. Die Schlüssel entsprechen eins zu eins `en.ts`.",
  ru: "Русский словарь. Ключи взаимно однозначно соответствуют `en.ts`.",
  ar: "قاموس عربي. المفاتيح تقابل `en.ts` واحدًا لواحد.",
};

// 缩进不强求两个空格：历史词条里混着 0 / 4 空格，词典是扁平的，按行收即可。
const ENTRY_RE = /^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*")\s*,\s*$/;
const COMMENT_RE = /^ {2}\/\/.*$/;
const OPEN_RE = /^const \w+: Record<string, string> = \{\s*$/;
const CLOSE_RE = /^\};\s*$/;

/**
 * 解析一个词典文件，保留条目顺序与分组注释。
 * @returns {{ items: { type: "comment", text: string }[], keys: string[], values: Record<string, string> }}
 */
function parseDict(file) {
  const text = fs.readFileSync(file, "utf8");
  const items = [];
  const keys = [];
  const values = {};
  let inBody = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!inBody) {
      if (OPEN_RE.test(line)) inBody = true;
      continue;
    }
    if (CLOSE_RE.test(line)) break;
    if (COMMENT_RE.test(line)) {
      items.push({ type: "comment", text: line });
      continue;
    }
    const m = line.match(ENTRY_RE);
    if (!m) continue;
    const [, key, literal] = m;
    // 字面量是合法的 JSON 字符串语法（词条里不允许裸换行）。
    const value = JSON.parse(literal);
    items.push({ type: "entry", key });
    keys.push(key);
    values[key] = value;
  }
  return { items, keys, values };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** 生成一整个词典文件的内容。 */
function renderDict(locale, values) {
  const src = parseDict(path.join(I18N_DIR, `${SOURCE[locale] ?? "en"}.ts`));
  const lines = [
    "/**",
    ` * ${HEADERS[locale]}`,
    " */",
    `const ${IDENTS[locale]}: Record<string, string> = {`,
  ];
  let lastWasComment = true;
  for (const item of src.items) {
    if (item.type === "comment") {
      if (!lastWasComment) lines.push("");
      lines.push(item.text);
      lastWasComment = true;
    } else {
      const value = values[item.key];
      if (typeof value !== "string") throw new Error(`${locale}: missing ${item.key}`);
      lines.push(`  ${JSON.stringify(item.key)}: ${JSON.stringify(value)},`);
      lastWasComment = false;
    }
  }
  lines.push("};", "", `export default ${IDENTS[locale]};`, "");
  return lines.join("\n");
}

function placeholders(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

// ---------------------------------------------------------------- split ----

function split(args) {
  const srcLocale = args.src ?? "en";
  const size = Number(args.size ?? 220);
  const outDir = path.resolve(ROOT, args.out ?? ".i18n-work");
  const src = parseDict(path.join(I18N_DIR, `${srcLocale}.ts`));
  const batches = [];
  let current = {};
  let count = 0;
  const flush = () => {
    if (!count) return;
    batches.push(current);
    current = {};
    count = 0;
  };
  for (const key of src.keys) {
    current[key] = src.values[key];
    count += 1;
    if (count >= size) flush();
  }
  flush();
  const dir = path.join(outDir, "src", srcLocale);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { locale: srcLocale, total: src.keys.length, batches: [] };
  batches.forEach((batch, index) => {
    const name = `batch-${String(index + 1).padStart(2, "0")}.json`;
    writeJson(path.join(dir, name), batch);
    manifest.batches.push({ name, keys: Object.keys(batch).length });
  });
  writeJson(path.join(outDir, "src", srcLocale, "manifest.json"), manifest);
  console.log(
    `split ${srcLocale}: ${src.keys.length} keys → ${batches.length} batches in ${path.relative(ROOT, dir)}`,
  );
}

// ---------------------------------------------------------------- merge ----

function merge(args) {
  const outDir = path.resolve(ROOT, args.out ?? ".i18n-work");
  const only = args.locale ? [args.locale] : Object.keys(IDENTS);
  const report = [];
  for (const locale of only) {
    if (!IDENTS[locale]) throw new Error(`unknown locale ${locale}`);
    const sourceLocale = SOURCE[locale] ?? "en";
    const src = parseDict(path.join(I18N_DIR, `${sourceLocale}.ts`));
    const dir = path.join(outDir, "out", locale);
    const values = {};
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir).sort()) {
        // 只认正式批次：代理偶尔会留下 part-a.json 之类的中转文件。
        if (!/^batch-.*\.json$/.test(name)) continue;
        Object.assign(values, readJson(path.join(dir, name)));
      }
    }
    const missing = src.keys.filter((key) => !(key in values));
    const extra = Object.keys(values).filter((key) => !(key in src.values));
    const empty = src.keys.filter((key) => typeof values[key] === "string" && !values[key].trim());
    const badVars = [];
    for (const key of src.keys) {
      const value = values[key];
      if (typeof value !== "string" || !value.trim()) continue;
      const a = placeholders(src.values[key]).join(",");
      const b = placeholders(value).join(",");
      if (a !== b) badVars.push({ key, source: src.values[key], value });
    }
    const filled = {};
    for (const key of src.keys) {
      filled[key] = typeof values[key] === "string" && values[key].trim()
        ? values[key].replace(/\r?\n/g, " ").trim()
        : src.values[key];
    }
    if (missing.length < src.keys.length) {
      fs.writeFileSync(path.join(I18N_DIR, `${locale}.ts`), renderDict(locale, filled));
    }
    report.push({
      locale,
      source: sourceLocale,
      total: src.keys.length,
      translated: src.keys.length - missing.length,
      missing: missing.length,
      extra: extra.length,
      empty: empty.length,
      badVars: badVars.length,
      missingKeys: missing,
      extraKeys: extra,
      emptyKeys: empty,
      badVarsSample: badVars.slice(0, 20),
    });
  }
  fs.mkdirSync(path.join(outDir), { recursive: true });
  writeJson(path.join(outDir, "merge-report.json"), report);
  for (const r of report) {
    console.log(
      `${r.locale.padEnd(6)} ${String(r.translated).padStart(4)}/${r.total} translated · ` +
        `missing ${r.missing} · extra ${r.extra} · empty ${r.empty} · placeholder ${r.badVars}`,
    );
  }
}

// ---------------------------------------------------------------- check ----

function check() {
  const en = parseDict(path.join(I18N_DIR, "en.ts"));
  let failed = false;
  for (const locale of Object.keys(IDENTS)) {
    const file = path.join(I18N_DIR, `${locale}.ts`);
    if (!fs.existsSync(file)) {
      console.error(`${locale}: missing ${path.relative(ROOT, file)}`);
      failed = true;
      continue;
    }
    const dict = parseDict(file);
    const missing = en.keys.filter((key) => !(key in dict.values));
    const extra = dict.keys.filter((key) => !(key in en.values));
    const empty = en.keys.filter((key) => !dict.values[key]?.trim());
    const badVars = en.keys.filter((key) => {
      const a = placeholders(en.values[key]).join(",");
      const b = placeholders(dict.values[key] ?? "").join(",");
      return a !== b;
    });
    const order = dict.keys.join("\n") !== en.keys.join("\n");
    const problems = [];
    if (missing.length) problems.push(`missing ${missing.length} (${missing.slice(0, 3).join(", ")})`);
    if (extra.length) problems.push(`extra ${extra.length} (${extra.slice(0, 3).join(", ")})`);
    if (empty.length) problems.push(`empty ${empty.length}`);
    if (badVars.length) problems.push(`placeholder mismatch ${badVars.length} (${badVars.slice(0, 3).join(", ")})`);
    if (order) problems.push("key order differs from en.ts");
    if (problems.length) {
      failed = true;
      console.error(`✗ ${locale}: ${problems.join(" · ")}`);
    } else {
      console.log(`✓ ${locale}: ${dict.keys.length} keys`);
    }
  }
  if (failed) process.exitCode = 1;
}

// ----------------------------------------------------------------- main ----

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 1) {
  const token = rest[i];
  if (!token.startsWith("--")) continue;
  const name = token.slice(2);
  const next = rest[i + 1];
  if (next && !next.startsWith("--")) {
    args[name] = next;
    i += 1;
  } else {
    args[name] = true;
  }
}

if (cmd === "split") split(args);
else if (cmd === "merge") merge(args);
else if (cmd === "check") check();
else {
  console.error("usage: node scripts/i18n.mjs <split|merge|check> [--src en] [--size 220] [--out .i18n-work] [--locale xx]");
  process.exitCode = 1;
}

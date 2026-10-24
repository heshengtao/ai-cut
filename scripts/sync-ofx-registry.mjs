#!/usr/bin/env node
/**
 * 构建时同步 OFX 注册表快照。
 *
 * - 默认从 GitHub raw 拉 registry.json；
 * - 支持 HTTPS_PROXY / HTTP_PROXY（优先 curl，其次 Node fetch）；
 * - 写入 src-tauri/assets/ofx-registry.json（随 App 编译进二进制）；
 * - 网络失败时保留已有快照并 exit 0；`--strict` 时 exit 1。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(ROOT, "src-tauri", "assets");
const TARGET = path.join(ASSETS, "ofx-registry.json");
const META = path.join(ASSETS, "ofx-registry.meta.json");
const DEFAULT_URL =
  "https://raw.githubusercontent.com/heshengtao/ai-cut-ofx-registry/main/registry.json";
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const urlIndex = args.indexOf("--url");
const url = urlIndex >= 0 && args[urlIndex + 1] ? args[urlIndex + 1] : DEFAULT_URL;

/** 环境变量优先；macOS 上回退到系统代理（含 SOCKS）。 */
function systemProxy() {
  const env =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    "";
  if (env) return env;
  if (process.platform !== "darwin") return "";
  try {
    const text = execFileSync("scutil", ["--proxy"], { encoding: "utf8" });
    const value = (key) => {
      const match = text.match(new RegExp(`${key}\\s*:\\s*(.+)`));
      return match ? match[1].trim() : "";
    };
    if (value("HTTPSEnable") === "1") {
      return `http://${value("HTTPSProxy")}:${value("HTTPSPort")}`;
    }
    if (value("HTTPEnable") === "1") {
      return `http://${value("HTTPProxy")}:${value("HTTPPort")}`;
    }
    if (value("SOCKSEnable") === "1") {
      return `socks5h://${value("SOCKSProxy")}:${value("SOCKSPort")}`;
    }
  } catch {
    // 没有系统代理就直连。
  }
  return "";
}

const proxy = systemProxy();

function fetchText() {
  try {
    const curlArgs = ["-fsSL", url];
    if (proxy) curlArgs.unshift("--proxy", proxy);
    return execFileSync("curl", curlArgs, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    if (proxy) throw error;
  }
  return null;
}

async function fetchWithNode() {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function validate(text) {
  const doc = JSON.parse(text);
  if (doc.schema_version !== 1) {
    throw new Error(`unsupported schema_version: ${doc.schema_version}`);
  }
  if (!Array.isArray(doc.plugins) || doc.plugins.length === 0) {
    throw new Error("registry has no plugins");
  }
  const slugs = new Set();
  for (const plugin of doc.plugins) {
    for (const key of ["slug", "name", "version", "license"]) {
      if (typeof plugin[key] !== "string" || plugin[key].trim() === "") {
        throw new Error(`plugin is missing ${key}`);
      }
    }
    if (slugs.has(plugin.slug)) throw new Error(`duplicate slug: ${plugin.slug}`);
    slugs.add(plugin.slug);
  }
  return doc;
}

async function main() {
  fs.mkdirSync(ASSETS, { recursive: true });

  let text = null;
  try {
    text = fetchText();
    if (text === null) text = await fetchWithNode();
  } catch (error) {
    console.warn(`[sync:ofx] could not fetch ${url}: ${error.message}`);
  }

  if (text === null) {
    if (fs.existsSync(TARGET)) {
      console.warn("[sync:ofx] keeping the existing bundled snapshot");
      if (strict) process.exit(1);
      return;
    }
    console.error("[sync:ofx] no remote registry and no bundled snapshot");
    process.exit(1);
  }

  let doc;
  try {
    doc = validate(text);
  } catch (error) {
    console.error(`[sync:ofx] invalid registry: ${error.message}`);
    if (fs.existsSync(TARGET)) {
      console.warn("[sync:ofx] keeping the existing bundled snapshot");
      if (strict) process.exit(1);
      return;
    }
    process.exit(1);
  }

  fs.writeFileSync(TARGET, `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync(
    META,
    `${JSON.stringify(
      {
        source_url: url,
        fetched_at: new Date().toISOString(),
        count: doc.plugins.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[sync:ofx] wrote ${doc.plugins.length} plugins to ${path.relative(ROOT, TARGET)}`);
}

await main();

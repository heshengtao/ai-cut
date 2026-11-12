#!/usr/bin/env node
/**
 * 把模型下载源的 revision **钉到 commit**，不再跟随 `master` / `main` 浮动分支。
 *
 * 为什么：清单里的 `sha256` 是硬门禁（见 `src-tauri/src/models.rs` 头注释），而
 * `resolve/master/<file>` 的内容随上游每次 push 变化。上游换一版权重，用户的下载会在
 * 100% 处报「sha256 校验失败」，而且换源也救不了——两个源都会变。所以 revision 必须是
 * **不可变的 commit sha**。
 *
 *   node tools/pin-models.mjs            # 只检查（浮动就退出码 1）
 *   node tools/pin-models.mjs --write    # 把 `master` / `main` 改写成当前分支头 commit
 *   node tools/pin-models.mjs --bump     # 连已经钉住的一起升到当前头（升级模型 = 人肉决定）
 *
 * 本仓的清单有两种写法，两种都要处理：
 *   1. 直接写整条 URL（`official(...)` / `verified(...)` / `sized(...)`）；
 *   2. `moss_file!` / `moss_file_sized!` 宏：URL 由 `concat!(…, $ms, "/resolve/", $ms_rev, …)`
 *      拼出来，仓库名是宏参数 → 这里给宏加两个 revision 参数，并在每个调用点补上。
 *
 * HF 直连在部分网络下不通，走 `HF_MIRROR`（默认 https://hf-mirror.com）解析；镜像只是通道。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HF_MIRROR = (process.env.HF_MIRROR ?? "https://hf-mirror.com").replace(/\/+$/, "");

const TARGETS = [
  "src-tauri/src/models.rs",
  "src-tauri/src/sdcpp.rs",
  "docs/voice-models.md",
];

const MODE = process.argv.includes("--write")
  ? "write"
  : process.argv.includes("--bump")
    ? "bump"
    : "check";

/** `https://host/(models/)?ns/repo/resolve/<rev>/<path>` */
const URL_RE =
  /https:\/\/(?:www\.)?(modelscope\.cn|huggingface\.co)\/(models\/)?([\w.-]+)\/([\w.-]+)\/resolve\/([^/"'\s]+)\/([^"'\s]+)/g;

const SHA_REV = /^[0-9a-f]{40}$/;

/**
 * URL 里直接写死的浮动分支（含没有文件名的 BASE 前缀，例如 `…/resolve/master`）。
 * 这一路是兜底：`URL_RE` 只认「带文件名的完整 URL」，前缀式写法会漏。
 */
function floatingLines(text) {
  const hits = [];
  text.split("\n").forEach((line, index) => {
    if (/https:\/\/[^\s"']*\/resolve\/(master|main)\b/.test(line)) {
      hits.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

function lsRemote(url, ref) {
  try {
    const out = execFileSync("git", ["ls-remote", url, ref], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = out.split("\n").find((l) => l.trim().endsWith(ref));
    return line ? line.split("\t")[0].trim() : null;
  } catch {
    return null;
  }
}

/**
 * 解出某个仓库默认分支的头 commit。
 *
 * HF 走 `/api/models/<repo>` 而不是 `git ls-remote`：仓库被重命名时会 307 到新名字（旧名字
 * 上的 `resolve/<sha>` 是 404，只有 `main` 能被重定向救——所以重命名必须连仓库名一起改），
 * 而 gated / auto-gated 的仓库 git 匿名读不到、API 元数据却是公开的。
 */
async function headCommit(key) {
  const [host, repo] = key.split("\u0000");
  if (host === "modelscope.cn") {
    const sha = lsRemote(`https://modelscope.cn/models/${repo}.git`, "refs/heads/master");
    return sha ? { sha, repo } : null;
  }
  try {
    const response = await fetch(`${HF_MIRROR}/api/models/${repo}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.sha) return { sha: data.sha, repo: data.id ?? repo };
    }
  } catch {
    // 掉到 git 兜底
  }
  const sha = lsRemote(`${HF_MIRROR}/${repo}.git`, "refs/heads/main");
  return sha ? { sha, repo } : null;
}

async function headCommits(keys, concurrency = 4) {
  const unique = [...keys].sort();
  const out = new Map();
  let index = 0;
  async function worker() {
    while (index < unique.length) {
      const key = unique[index++];
      const resolved = await headCommit(key);
      out.set(key, resolved);
      const [host, repo] = key.split("\u0000");
      process.stderr.write(
        resolved
          ? `  ✓ ${host} ${repo} @ ${resolved.sha.slice(0, 8)}${resolved.repo !== repo ? `（重命名为 ${resolved.repo}）` : ""}\n`
          : `  ✗ ${host} ${repo}（解析不出 commit）\n`,
      );
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

function scan() {
  const found = [];
  for (const rel of TARGETS) {
    const abs = join(ROOT, rel);
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(URL_RE)) {
      const [full, host, modelsPrefix, ns, repo, rev, path] = match;
      found.push({
        file: rel,
        abs,
        text,
        index: match.index,
        full,
        host,
        modelsPrefix,
        repo: `${ns}/${repo}`,
        rev,
        path,
      });
    }
  }
  return found;
}

/** 宏调用 `moss_file!(…)` / `moss_file_sized!(…)`：仓库名是参数，URL 在宏里拼。 */
function scanMacroCalls(text = readFileSync(join(ROOT, TARGETS[0]), "utf8")) {
  const calls = [];
  const abs = join(ROOT, TARGETS[0]);
  const re = /(moss_file_sized!|moss_file!)\(([^()]*)\)/g;
  for (const match of text.matchAll(re)) {
    const args = match[2]
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    // 已钉住的调用末尾是两个 40 位 commit（moss_file! 7 个参数、moss_file_sized! 8 个）。
    const pinned = args.length > 5 && args.slice(-2).every((a) => /^"[0-9a-f]{40}"$/.test(a));
    const [msRepo, hfRepo] = args.slice(-2);
    calls.push({
      abs,
      macro: match[1],
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      args,
      pinned,
      msRepo: JSON.parse(msRepo),
      hfRepo: JSON.parse(hfRepo),
    });
  }
  return calls;
}

const links = scan();
const floating = links.filter((l) => !SHA_REV.test(l.rev));
const macroCalls = scanMacroCalls();
// 宏调用里 revision 还没被参数化（定义里仍是 "/resolve/master/"）就算浮动。
const macroFloating = macroCalls.some((call) => !call.pinned);

console.log(
  `扫描 ${TARGETS.length} 个文件：${links.length} 条 resolve 链接（${floating.length} 条浮动），` +
    `${macroCalls.length} 处 moss_file! 调用（宏定义${macroFloating ? "仍浮动" : "已参数化"}）`,
);

const literalFloats = TARGETS.flatMap((rel) => {
  try {
    return floatingLines(readFileSync(join(ROOT, rel), "utf8")).map((line) => `${rel} → ${line}`);
  } catch {
    return [];
  }
});

if (MODE === "check") {
  for (const l of floating) {
    console.log(`  浮动：${relative(ROOT, l.abs)} ← ${l.full}`);
  }
  if (macroFloating) {
    console.log("  浮动：moss_file! / moss_file_sized! 的宏定义仍在用 /resolve/master/");
  }
  for (const line of literalFloats) {
    console.log(`  浮动（字面 URL）：${line}`);
  }
  process.exit(floating.length || macroFloating || literalFloats.length ? 1 : 0);
}

// ---- write / bump ---------------------------------------------------------
const keys = new Set();
for (const l of floating) keys.add(`${l.host}\u0000${l.repo}`);
if (MODE === "bump") for (const l of links) keys.add(`${l.host}\u0000${l.repo}`);
for (const call of macroCalls) {
  if (call.pinned) continue;
  keys.add(`modelscope.cn\u0000${call.msRepo}`);
  keys.add(`huggingface.co\u0000${call.hfRepo}`);
}
console.log(`解析 ${keys.size} 个仓库的头 commit…`);
const heads = await headCommits(keys);

const unresolved = new Set();
let changed = 0;

// 1) 整条 URL：按文件聚合，从后往前替换，避免下标错位。
const byFile = new Map();
for (const l of links) {
  if (!(MODE === "bump" || !SHA_REV.test(l.rev))) continue;
  const resolved = heads.get(`${l.host}\u0000${l.repo}`);
  if (!resolved) {
    console.error(`  ✗ ${l.repo}：解不出 commit，保留原样`);
    unresolved.add(l.repo);
    continue;
  }
  const list = byFile.get(l.abs) ?? [];
  list.push({ ...l, sha: resolved });
  byFile.set(l.abs, list);
}
for (const [abs, list] of byFile) {
  let text = readFileSync(abs, "utf8");
  list.sort((a, b) => b.index - a.index);
  for (const l of list) {
    if (!text.startsWith(l.full, l.index)) continue;
    // 用 parts 重建：HF 仓库可能被重命名（旧名 + 新 commit = 404，必须连仓库名一起换）。
    const after = `https://${l.host}/${l.modelsPrefix ?? ""}${l.sha.repo}/resolve/${l.sha.sha}/${l.path}`;
    text = text.slice(0, l.index) + after + text.slice(l.index + l.full.length);
    changed += 1;
  }
  writeFileSync(abs, text);
  console.log(`  ✓ ${relative(ROOT, abs)}（${list.length} 条）`);
}

// 2) 宏：把 revision 参数化，然后给每个调用点补两个新的字面量。
const modelsAbs = join(ROOT, TARGETS[0]);
let models = readFileSync(modelsAbs, "utf8");
if (macroFloating) {
  models = models.replace(
    '$file:literal, $size:literal, $sha:literal, $ms:literal, $hf:literal',
    '$file:literal, $size:literal, $sha:literal, $ms:literal, $hf:literal, $ms_rev:literal, $hf_rev:literal',
  );
  models = models.replace(
    '$file:literal, $size:literal, $ms_size:literal, $hf_size:literal, $ms:literal, $hf:literal',
    '$file:literal, $size:literal, $ms_size:literal, $hf_size:literal, $ms:literal, $hf:literal, $ms_rev:literal, $hf_rev:literal',
  );
  models = models
    .replaceAll('"/resolve/master/",', '"/resolve/", $ms_rev, "/",')
    .replaceAll('"/resolve/main/",', '"/resolve/", $hf_rev, "/",');
  console.log("  ✓ 宏定义已参数化（$ms_rev / $hf_rev）");
}

// 调用点：从后往前插参数。宏已经是参数化的就跳过（幂等）。
if (macroFloating) {
  // 注意：要在**刚刚改过宏定义的那个字符串**上重新扫，否则下标会错位。
  const calls = scanMacroCalls(models)
    .filter((call) => !call.pinned)
    .sort((a, b) => b.start - a.start);
  for (const call of calls) {
    const msRev = heads.get(`modelscope.cn\u0000${call.msRepo}`)?.sha;
    const hfRev = heads.get(`huggingface.co\u0000${call.hfRepo}`)?.sha;
    if (!msRev || !hfRev) {
      console.error(`  ✗ ${call.msRepo}：解不出 commit`);
      unresolved.add(call.msRepo);
      continue;
    }
    const trimmed = call.raw.replace(/,\s*\)$/, ")");
    const withArgs = `${trimmed.slice(0, -1).trimEnd()}, "${msRev}", "${hfRev}")`;
    models = models.slice(0, call.start) + withArgs + models.slice(call.start + call.raw.length);
    changed += 1;
  }
  console.log(`  ✓ moss_file! 调用点补了 revision（${calls.length} 处）`);
}
writeFileSync(modelsAbs, models);

console.log(`\n已改写 ${changed} 处。`);
if (unresolved.size) {
  console.error(`有 ${unresolved.size} 个仓库没能钉住：${[...unresolved].join(", ")}`);
  process.exit(1);
}
console.log("接下来跑 node tools/check-models.mjs 校验字节。");

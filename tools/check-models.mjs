#!/usr/bin/env node
/**
 * 校验**线上字节**与清单里钉的 sha256 是否一致。
 *
 *   node tools/check-models.mjs             # 全量校验（只读）
 *   node tools/check-models.mjs --strict    # 「读不到指纹 / 网络不通」也算失败
 *   node tools/check-models.mjs --id whisper  # 只查 id / 文件名里含该串的条目
 *
 * 为什么需要它：`pin-models.mjs` 只保证 revision 不浮动，不保证「钉住的 commit 里的那个
 * 文件」就是清单里写的那个 sha256。两个脚本合起来才闭环：
 *   - revision 钉死 → 同一个 URL 永远返回同一份字节；
 *   - sha256 对上 → 那份字节就是我们验证过的模型。
 *
 * 判定依据：
 *   - 魔搭：`X-Linked-Etag` 就是文件的 sha256（LFS 与否都给）；
 *   - HF：LFS 文件同样有 `X-Linked-Etag`（带引号），非 LFS 小文件没有 → UNKNOWN；
 *   - GitHub Release：没有可靠指纹 → UNKNOWN（靠 tag + 清单 sha256 兜底）。
 *
 * HF 直连在部分网络下不通，默认走 `HF_MIRROR`（默认 https://hf-mirror.com）。
 * 镜像只是通道：它转发的是同一个仓库同一个 commit。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "src-tauri/src/models.rs");
const HF_MIRROR = (process.env.HF_MIRROR ?? "https://hf-mirror.com").replace(/\/+$/, "");
const STRICT = process.argv.includes("--strict");
/**
 * `--deep`：对「读不到指纹」的小文件直接把字节拉下来算 sha256。
 *
 * HF 对非 LFS 文件只给 git blob sha1，GitHub Release 干脆什么都没有——这类源只能靠下载后
 * 比对。大文件（几个 GB 的权重）默认不下载，用 `--max-bytes` 调上限。
 */
const DEEP = process.argv.includes("--deep");
const MAX_BYTES = (() => {
  const i = process.argv.indexOf("--max-bytes");
  return i >= 0 ? Number(process.argv[i + 1]) : 32 * 1024 * 1024;
})();
const FILTER = (() => {
  const i = process.argv.indexOf("--id");
  return i >= 0 ? process.argv[i + 1] : null;
})();
/**
 * 走代理探测（`--proxy socks5h://127.0.0.1:7892` 或 `MODEL_PROXY=`）。
 *
 * Node 的 `fetch` **完全不读系统代理**（macOS 的 `scutil` / 环境变量都不认），所以在有
 * 全局代理的机器上直连 huggingface.co 会超时——这时改用 curl（它认 `--proxy`，也支持
 * socks5h）。设了代理就**不再走 HF_MIRROR**：镜像只是通道，能直连时当然对着真身校验。
 */
const PROXY = (() => {
  const i = process.argv.indexOf("--proxy");
  return i >= 0 ? (process.argv[i + 1] ?? "") : (process.env.MODEL_PROXY ?? "");
})();
const TIMEOUT_MS = 45_000;
const CONCURRENCY = 6;

/**
 * 从清单里抽出「源 URL → 期望 sha256」。
 *
 * 清单有三种写法定：`verified(...)`（自带 sha256）、`official(...)` / `sized(...)`
 * （用所在 `ModelFile` 的文件级 sha256）、以及 `moss_file!` 宏（URL 由 repo + revision +
 * 文件名拼出来）。用文本扫描而不是编译 Rust：清单是纯静态数据，形状稳定。
 */
function parseCatalog() {
  const text = readFileSync(CATALOG, "utf8").split("\n#[cfg(test)]")[0];
  const entries = [];

  const entryBlocks = text.split(/ModelEntry\s*\{/).slice(1);
  for (const block of entryBlocks) {
    const id = block.match(/\bid:\s*"([^"]+)"/)?.[1] ?? "?";
    const name = block.match(/\bname:\s*"([^"]+)"/)?.[1] ?? id;
    if (FILTER && !id.includes(FILTER) && !name.includes(FILTER)) continue;

    const fileBlocks = block.split(/ModelFile\s*\{/).slice(1);
    // 宏每次展开也相当于一个 ModelFile：单独扫一遍调用点。
    for (const call of block.matchAll(/moss_file!\(([^()]*)\)/g)) {
      const args = call[1]
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => a.replace(/^"|"$/g, ""));
      if (args.length < 7) continue;
      const [filename, size, sha, ms, hf, msRev, hfRev] = args;
      entries.push({
        id,
        name,
        filename,
        kind: "modelscope",
        url: `https://modelscope.cn/models/${ms}/resolve/${msRev}/${filename}`,
        sha256: sha,
        perSource: false,
        size: Number(size.replaceAll("_", "")),
      });
      entries.push({
        id,
        name,
        filename,
        kind: "hf",
        url: `https://huggingface.co/${hf}/resolve/${hfRev}/${filename}`,
        sha256: sha,
        perSource: false,
        size: Number(size.replaceAll("_", "")),
      });
    }

    for (const fileBlock of fileBlocks) {
      const filename = fileBlock.match(/\bfilename:\s*"([^"]+)"/)?.[1] ?? "?";
      const fileSha = fileBlock.match(/\bsha256:\s*"([0-9a-f]*)"(?:\s*,)?\s*\n/)?.[1] ?? "";
      const push = (kind, url, sha, perSource, size) =>
        entries.push({ id, name, filename, kind, url, sha256: sha, perSource, size });

      for (const m of fileBlock.matchAll(
        /verified\(\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)",\s*"([0-9a-f]*)",\s*([\d_]+)/g,
      )) {
        push(m[1], m[2], m[3], true, Number(m[4].replaceAll("_", "")));
      }
      for (const m of fileBlock.matchAll(/official\(\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)"/g)) {
        push(m[1], m[2], fileSha, false, 0);
      }
      for (const m of fileBlock.matchAll(
        /sized\(\s*"([^"]+)",\s*"[^"]+",\s*"([^"]+)",\s*([\d_]+)/g,
      )) {
        push(m[1], m[2], fileSha, false, Number(m[3].replaceAll("_", "")));
      }
    }
  }
  return entries;
}

function requestUrl(url) {
  if (PROXY) return url; // 有代理就直连真身
  if (url.startsWith("https://huggingface.co/")) {
    return url.replace("https://huggingface.co/", `${HF_MIRROR}/`);
  }
  return url;
}

/** 一次 HEAD，返回状态码 + 头（`Map`）。有代理时走 curl，否则走 fetch。 */
async function head(url) {
  if (PROXY) {
    const text = execFileSync(
      "curl",
      ["-sI", "--max-time", String(Math.round(TIMEOUT_MS / 1000)), "--proxy", PROXY, url],
      { encoding: "utf8", timeout: TIMEOUT_MS + 5_000 },
    );
    const lines = text.split(/\r?\n/);
    const status = Number(lines.find((l) => /^HTTP\//.test(l))?.split(" ")[1] ?? 0);
    const headers = new Map();
    for (const line of lines.slice(1)) {
      const i = line.indexOf(":");
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
    return { status, headers };
  }
  const response = await fetch(url, {
    method: "HEAD",
    redirect: "manual", // HF 的 X-Linked-* 在第一跳上，跟到 CDN 就没了
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const headers = new Map();
  response.headers.forEach((value, key) => headers.set(key.toLowerCase(), value));
  return { status: response.status, headers };
}

async function probe(entry) {
  const url = requestUrl(entry.url);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response;
    try {
      response = await head(url);
    } catch (error) {
      if (attempt === 2) return { ...entry, status: "UNREACHABLE", detail: String(error) };
      continue;
    }
    const header = (response.headers.get("x-linked-etag") ?? "").replaceAll('"', "").trim();
    // 只有 64 位十六进制才是文件的 sha256。HF 对**非 LFS** 小文件给的是 git blob 的 sha1
    // （40 位），拿它比 sha256 只会得到假阳性。
    const etag = /^[0-9a-f]{64}$/.test(header) ? header : "";
    if (etag) {
      const ok = etag === entry.sha256;
      return {
        ...entry,
        status: ok ? "OK" : "DRIFT",
        detail: ok
          ? ""
          : `线上 ${etag.slice(0, 12)}… ≠ 清单 ${entry.sha256.slice(0, 12) || "(空)"}…`,
      };
    }
    if (response.status === 404) {
      return { ...entry, status: "DRIFT", detail: "404：钉住的 commit 里没有这个文件" };
    }
    // gated 仓库：这是**预期**的（应用会在下载时弹授权窗），不是校验失败。
    if (
      (response.status === 401 || response.status === 403) &&
      (response.headers.get("x-error-code") ?? "").toLowerCase() === "gatedrepo"
    ) {
      return { ...entry, status: "GATED", detail: "仓库需要同意许可（应用里下载时会提示授权）" };
    }
    if (response.status === 403 || response.status === 401) {
      return { ...entry, status: "UNKNOWN", detail: `HTTP ${response.status}（需要授权）` };
    }
    return {
      ...entry,
      status: "UNKNOWN",
      detail: entry.sha256
        ? "没有 sha256 指纹（HF 非 LFS 小文件只给 git blob sha1）"
        : "清单本身没有 sha256",
      response,
    };
  }
  return { ...entry, status: "UNREACHABLE", detail: "" };
}

const all = parseCatalog();
if (!all.length) {
  console.error("没有解析出任何下载源——清单结构变了？");
  process.exit(2);
}
console.log(`清单：${all.length} 条源${FILTER ? `（过滤 ${FILTER}）` : ""}，探测中…`);

/** 下载后比对：只对「读不到指纹」且体积在 `MAX_BYTES` 内的源做。 */
async function deepCheck(result) {
  if (result.status !== "UNKNOWN" || !result.sha256) return result;
  const url = requestUrl(result.url);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS * 4) });
    if (!response.ok) return result;
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      return { ...result, detail: `${result.detail}；${length} 字节超过 --max-bytes，未下载` };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    return digest === result.sha256
      ? { ...result, status: "OK", detail: "（下载后比对）" }
      : {
          ...result,
          status: "DRIFT",
          detail: `下载后 ${digest.slice(0, 12)}… ≠ 清单 ${result.sha256.slice(0, 12)}…`,
        };
  } catch (error) {
    return { ...result, detail: `${result.detail}；下载失败 ${error}` };
  }
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < all.length) {
    const entry = all[cursor++];
    let result = await probe(entry);
    if (DEEP) result = await deepCheck(result);
    results.push(result);
    const mark = { OK: "✓", DRIFT: "✗", UNKNOWN: "?", UNREACHABLE: "!" }[result.status] ?? "?";
    process.stderr.write(`${mark} ${result.id}/${result.filename}\n`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const drift = results.filter((r) => r.status === "DRIFT");
const unknown = results.filter((r) => r.status === "UNKNOWN");
const gated = results.filter((r) => r.status === "GATED");
const unreachable = results.filter((r) => r.status === "UNREACHABLE");
const ok = results.filter((r) => r.status === "OK");

console.log(
  `\n${ok.length} 一致 / ${drift.length} 不一致 / ${unknown.length} 读不到指纹 / ` +
    `${gated.length} 需 HF 授权 / ${unreachable.length} 不可达`,
);

for (const r of drift) {
  console.log(
    `\n✗ ${r.id} / ${r.filename}\n  ${relative(ROOT, CATALOG)}\n  ${r.url}\n  ${r.detail}`,
  );
}
if (unknown.length && STRICT) {
  for (const r of unknown) console.log(`\n? ${r.id} / ${r.filename}\n  ${r.url}\n  ${r.detail}`);
}
if (unreachable.length) {
  for (const r of unreachable) console.log(`\n! ${r.id} / ${r.filename}\n  ${r.url}\n  ${r.detail}`);
}

// 默认只把「字节对不上」当失败：网络不通 / 读不到指纹都是**无法判定**，不该把 CI 卡死
// （GitHub Release 在部分网络下 HEAD 直接失败）。要「一条都不能少」，加 `--strict`。
const failed =
  drift.length > 0 || (STRICT && (unknown.length > 0 || unreachable.length > 0));
process.exit(failed ? 1 : 0);

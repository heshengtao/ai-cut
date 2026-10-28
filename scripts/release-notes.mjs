#!/usr/bin/env node
/**
 * 根据 git 提交生成 GitHub Release 正文与更新器 notes。
 *
 * 用法：TAG=v0.2.3 REPO=owner/repo node scripts/release-notes.mjs
 * 产物：release-body.md（发布页正文）、updater-notes.txt（latest.json 的 notes，纯文本）。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.env.TAG ?? "";
const repo = process.env.REPO ?? "";

if (!tag || !repo) {
  console.error("TAG and REPO are required");
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function previousTag() {
  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`]);
  } catch {
    return "";
  }
}

const previous = previousTag();
const range = previous ? `${previous}..${tag}` : tag;
const commits = git(["log", range, "--no-merges", "--pretty=format:%h%x09%s"])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf("\t");
    return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
  });

const GROUPS = [
  { key: "feat", title: "✨ Features / 新功能" },
  { key: "fix", title: "🐛 Fixes / 修复" },
  { key: "perf", title: "⚡ Performance / 性能" },
  { key: "refactor", title: "♻️ Refactor / 重构" },
  { key: "docs", title: "📝 Docs / 文档" },
  { key: "test", title: "✅ Tests / 测试" },
  { key: "build", title: "🔧 Build / 构建" },
  { key: "ci", title: "👷 CI" },
  { key: "chore", title: "🧹 Chores / 杂项" },
  { key: "style", title: "🎨 Style / 样式" },
  { key: "revert", title: "⏪ Reverts / 回滚" },
];

const grouped = new Map(GROUPS.map((group) => [group.key, []]));
const other = [];

for (const commit of commits) {
  const match = /^([a-zA-Z]+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(commit.subject);
  const bucket = match ? grouped.get(match[1].toLowerCase()) : undefined;
  if (bucket) bucket.push({ hash: commit.hash, subject: match[2] });
  else other.push(commit);
}

const lines = [];
for (const group of GROUPS) {
  const items = grouped.get(group.key);
  if (!items?.length) continue;
  lines.push(`### ${group.title}`, "");
  for (const item of items) lines.push(`- ${item.subject} (\`${item.hash}\`)`);
  lines.push("");
}
if (other.length) {
  lines.push("### 📌 Other / 其他", "");
  for (const item of other) lines.push(`- ${item.subject} (\`${item.hash}\`)`);
  lines.push("");
}
if (!lines.length) {
  lines.push("- No notable changes. / 本次没有可列出的改动。", "");
}

const changelog = lines.join("\n").trim();

const downloads = `## 📦 Downloads

👉 [Windows — installer (.msi)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-windows-amd64.msi)

👉 [Windows — setup (.exe)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-windows-amd64-setup.exe)

👉 [macOS — Apple Silicon (.dmg)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-macos-arm64.dmg)

👉 [Linux — x86_64 (.AppImage)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-linux-amd64.AppImage)

👉 [Linux — x86_64 (.deb)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-linux-amd64.deb)

👉 [Linux — arm64 (.AppImage)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-linux-arm64.AppImage)

👉 [Linux — arm64 (.deb)](https://github.com/${repo}/releases/download/${tag}/AI-Cut-${tag}-linux-arm64.deb)`;

const body = `${downloads}

## 🆕 What's changed / 更新内容

${changelog}

## 🍎 macOS：首次打开提示 / First launch

**中文：** 应用为 ad-hoc 签名（未使用 Apple 开发者证书、未公证）。首次打开时 macOS 会提示「Apple 无法验证此 App」，这是正常现象：

1. 在「访达」里**右键**点 App →「打开」→ 再点一次「打开」；
2. 或打开「系统设置 → 隐私与安全性」，在下方点「仍要打开」。

**EN:** The app is ad-hoc signed (not notarized), so macOS asks for confirmation on first launch. Right-click the app in Finder → **Open** → **Open** again, or go to System Settings → Privacy & Security → **Open Anyway**.

> 只有在提示「App 已损坏，无法打开」（弹窗里没有「仍要打开」按钮）时，才需要执行：
>
> \`\`\`bash
> xattr -cr "/Applications/AI Cut.app"
> \`\`\`
>
> 执行后仍然报「已损坏」，说明安装包本身的签名是残缺的（打包期没签名）：请确认下载的是最新版本。

## 🔄 Auto-update

Installed apps check this release's \`latest.json\` and update in place (Settings → About → Check for updates).
`;

// 更新器 notes 在设置页按纯文本展示，去掉 Markdown 标题标记。
const plainNotes = changelog.replace(/^### /gm, "").replace(/`/g, "");

writeFileSync(resolve(root, "release-body.md"), body);
writeFileSync(resolve(root, "updater-notes.txt"), `${plainNotes}\n`);
console.log(
  previous
    ? `Release notes for ${tag} (${commits.length} commits since ${previous})`
    : `Release notes for ${tag} (${commits.length} commits, no previous tag)`,
);

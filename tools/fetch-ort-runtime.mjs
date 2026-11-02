#!/usr/bin/env node
/**
 * 下载**当前平台**的 ONNX Runtime 基线运行时，解出需要的文件到
 * `src-tauri/resources/ort/`，随安装包分发（`bundle.resources` 里的 `resources/ort/`）。
 *
 * 为什么需要这一步：Windows / Linux 的 `ort` 改成了 `load-dynamic`（这样才能按需
 * 换 CUDA 运行时），CPU / DirectML 基线不再链接进 exe，必须作为资源随包带上。
 * macOS 依旧静态链接 CoreML，不需要任何文件。
 *
 * 用法：`pnpm fetch:ort`（已存在则跳过，`--force` 重下）。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const OUT = join(ROOT, "src-tauri", "resources", "ort");
const FORCE = process.argv.includes("--force");

const ORT = "1.30.0";
const DIRECTML_ORT = "1.24.4";
const DIRECTML = "1.15.4";
const NUGET = "https://api.nuget.org/v3-flatcontainer";
const GH = `https://github.com/microsoft/onnxruntime/releases/download/v${ORT}`;

/** 当前平台要准备什么：目标文件名 → 来源。 */
function plan() {
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      files: ["onnxruntime.dll", "DirectML.dll"],
      steps: [
        {
          url: `${NUGET}/microsoft.ml.onnxruntime.directml/${DIRECTML_ORT}/microsoft.ml.onnxruntime.directml.${DIRECTML_ORT}.nupkg`,
          kind: "zip",
          pick: { "runtimes/win-x64/native/onnxruntime.dll": "onnxruntime.dll" },
        },
        {
          url: `${NUGET}/microsoft.ai.directml/${DIRECTML}/microsoft.ai.directml.${DIRECTML}.nupkg`,
          kind: "zip",
          pick: { "bin/x64-win/DirectML.dll": "DirectML.dll" },
        },
      ],
    };
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return {
      files: ["libonnxruntime.so"],
      steps: [
        {
          url: `${GH}/onnxruntime-linux-x64-${ORT}.tgz`,
          kind: "tgz",
          pick: { [`onnxruntime-linux-x64-${ORT}/lib/libonnxruntime.so.${ORT}`]: "libonnxruntime.so" },
        },
      ],
    };
  }
  // macOS：静态链接 CoreML，没有需要随包的文件。
  return null;
}

function skipIfReady(plan) {
  if (FORCE) return false;
  return plan.files.every((file) => {
    const path = join(OUT, file);
    return existsSync(path) && statSync(path).size > 0;
  });
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`下载失败 ${response.status}：${url}`);
  const { writeFileSync } = await import("node:fs");
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, buffer);
  return buffer.length;
}

function extract(archive, kind, into) {
  mkdirSync(into, { recursive: true });
  if (kind === "zip") {
    if (process.platform === "win32") {
      execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${into}'`],
        { stdio: "inherit" },
      );
    } else {
      execFileSync("unzip", ["-o", "-q", archive, "-d", into], { stdio: "inherit" });
    }
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", into], { stdio: "inherit" });
  }
}

function find(dir, relative) {
  const target = relative.split("/").join(process.platform === "win32" ? "\\" : "/");
  const direct = join(dir, target);
  if (existsSync(direct)) return direct;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else if (next.toLowerCase().endsWith(target.toLowerCase())) return next;
    }
  }
  return null;
}

async function main() {
  const current = plan();
  if (!current) {
    console.log("macOS: ONNX Runtime 静态链接，无需随包文件。");
    return;
  }
  if (skipIfReady(current)) {
    console.log(`ONNX Runtime 已就绪（${OUT}），跳过。`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const temp = mkdtempSync(join(tmpdir(), "ai-cut-ort-"));
  try {
    for (const step of current.steps) {
      console.log(`下载 ${step.url}`);
      const name = step.url.split("/").pop();
      // Expand-Archive 只认 .zip：nupkg 先改成 .zip 再解。
      const archive = join(
        temp,
        step.kind === "zip" && !name.toLowerCase().endsWith(".zip")
          ? `${name}.zip`
          : name,
      );
      const size = await download(step.url, archive);
      console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB`);
      const into = join(temp, name.replace(/\.(nupkg|zip|tgz|tar\.gz)$/i, ""));
      extract(archive, step.kind, into);
      for (const [source, target] of Object.entries(step.pick)) {
        const found = find(into, source);
        if (!found) throw new Error(`归档里没有 ${source}`);
        copyFileSync(found, join(OUT, target));
        console.log(`  ${source} → ${target}`);
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`完成：${OUT}`);
}

await main();

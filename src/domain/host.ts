/**
 * 无头文档引擎的宿主入口。
 *
 * 这个文件是「同一份领域代码，跑在两种运行时」的接缝：
 * - 桌面 / 浏览器：Pinia store 直接 import `core/ops`、`core/commands`；
 * - 无头（`aicutd` / Docker）：`scripts/build-domain.mjs` 把本文件用 esbuild 打成
 *   `crates/daemon/assets/domain.js`，由 Rust 里的 QuickJS 执行。
 *
 * 因此这里**不能**碰 DOM、网络、Vue、Tauri；只有两个不确定源由宿主注入：
 * `__aicut_uuid()` 与 `__aicut_now()`。桌面端用真 uuid / 系统时钟，
 * 测试用递增计数器，保证两个运行时逐字段可比。
 */
import type { Affected, Command } from "@/types/events";
import type { Project } from "@/types/project";
import { applyCommandToDoc } from "@/core/commands";
import { parseProject, serializeProject } from "@/core/serialize";
import { clipDetail, overview } from "@/core/projectView";
import { setTranslateLocale } from "@/i18n/translate";

declare const __aicut_uuid: () => string;
declare const __aicut_now: () => number;

// 宿主注入的随机源与时钟：必须在任何领域代码执行前就位。
(globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto = {
  randomUUID: () => __aicut_uuid(),
};
Date.now = () => __aicut_now();

/** 线格式：Rust 与前端都只消费 JSON 字符串。 */
interface ApplyWire {
  ok: boolean;
  revision: number;
  changed?: boolean;
  affected?: Affected;
  error?: string;
}

let doc: Project | null = null;
let revision = 0;

function fail(revisionNow: number, error: string): string {
  const wire: ApplyWire = { ok: false, revision: revisionNow, error };
  return JSON.stringify(wire);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 载入一份工程快照（启动 / 控制权移交 / MCP 写入前的对齐）。 */
export function load(json: string): string {
  doc = parseProject(json);
  revision = 0;
  return JSON.stringify({ ok: true, revision });
}

/** 取当前文档快照。只有加入 / 重同步时才调用，不是每帧。 */
export function snapshot(): string {
  if (!doc) throw new Error("project not loaded");
  return serializeProject(doc);
}

/** 当前 revision（命令的乐观并发基线）。 */
export function currentRevision(): number {
  return revision;
}

/**
 * 设置引擎的语言：默认命名（「轨道 2」「标记 1」）与错误文案会跟着变。
 * 会话语言由客户端在 `load` 前后同步一次，避免两个运行时对同一个默认名给出不同结果。
 */
export function setLocale(locale: string): string {
  if (locale !== "zh" && locale !== "en") throw new Error(`unsupported locale: ${locale}`);
  setTranslateLocale(locale);
  return locale;
}

/** 应用一条命令，返回 `{ok, revision, changed, affected, error}`。 */
export function apply(commandJson: string): string {
  if (!doc) return fail(revision, "project not loaded");

  let command: Command;
  try {
    command = JSON.parse(commandJson) as Command;
  } catch (error) {
    return fail(revision, `invalid command json: ${errorText(error)}`);
  }

  if (command.baseRevision !== revision) {
    return fail(
      revision,
      `stale revision: expected ${revision}, got ${String(command.baseRevision)}`,
    );
  }

  try {
    const result = applyCommandToDoc(doc, command);
    if (result.doc === doc) {
      const wire: ApplyWire = {
        ok: true,
        revision,
        changed: false,
        affected: result.affected,
      };
      return JSON.stringify(wire);
    }
    doc = result.doc;
    revision += 1;
    const wire: ApplyWire = {
      ok: true,
      revision,
      changed: true,
      affected: result.affected,
    };
    return JSON.stringify(wire);
  } catch (error) {
    return fail(revision, errorText(error));
  }
}

/** MCP / CLI 的只读视图；与 `core/projectView` 同一套实现。 */
export function view(method: string, argsJson: string): string {
  if (!doc) throw new Error("project not loaded");
  const args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  switch (method) {
    case "overview":
      return JSON.stringify(overview(doc, revision));
    case "clip":
      return JSON.stringify(clipDetail(doc, revision, String(args.clipId ?? "")));
    default:
      throw new Error(`unknown view: ${method}`);
  }
}

/**
 * 工程文档 store：唯一写入口是 `dispatch` / `applyCommand`。
 *
 * - 撤销/重做采用文档快照（纯 JSON、体积小、最稳），上限 100 步。
 * - 每次真实变更都会递增 `revision` 并产生一条 `OpEvent`，供 Agent 活动流、
 *   时间线高亮与 MCP 审阅使用。
 * - `dispatch` 是人类 UI 的快捷入口；`applyCommand` 是可序列化的外部入口。
 */
import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type {
  Affected,
  Command,
  CommandResult,
  DispatchMeta,
  HistoryEntry,
  HistoryStep,
  OpEvent,
} from "@/types/events";
import type { Project } from "@/types/project";
import { newProject as makeProject } from "@/core/factory";
import { parseProject, serializeProject } from "@/core/serialize";
import { applyCommandToDoc, applyCommandsToDoc, diffAffected } from "@/core/commands";
import { recordProjectHistory, getProjectHistory, flushHistoryRecords } from "@/core/history";
import { updateAsset } from "@/core/ops";
import { renameProject } from "@/core/ops/project";
import {
  pathExists,
  pickProjectFile,
  pickSaveProjectPath,
  readProjectFile,
  writeProjectFile,
} from "@/core/media";
import { t } from "@/i18n";

/** 快照历史上限。 */
export const HISTORY_LIMIT = 100;
/** 内存事件日志上限。 */
export const EVENT_LOG_LIMIT = 1000;

const EMPTY_AFFECTED: Affected = { clipIds: [], trackIds: [], assetIds: [] };

interface PendingCoalesce {
  key: string;
  before: Project;
  baseRevision: number;
  command: Command;
  startedAt: number;
}

function makeCommand(input: {
  kind: Command["kind"];
  payload: unknown;
  actor: Command["actor"];
  label: string;
  sessionId?: string;
  baseRevision: number;
}): Command {
  return {
    id: crypto.randomUUID(),
    baseRevision: input.baseRevision,
    actor: input.actor,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    kind: input.kind,
    payload: input.payload,
    label: input.label,
    timestamp: Date.now(),
  };
}

export const useProjectStore = defineStore("project", () => {
  const doc = shallowRef<Project>(makeProject());
  const dirty = ref(false);
  const filePath = ref<string | null>(null);
  const undoStack = shallowRef<HistoryStep[]>([]);
  const redoStack = shallowRef<HistoryStep[]>([]);
  /** 连续同类操作（滑杆拖动）的合并键；不同键则另记一步历史。 */
  const coalesceKey = ref<string | null>(null);
  /** 文档版本：每次真实变更 +1，命令用它做乐观并发校验。 */
  const revision = ref(0);
  /** 打开 / 恢复工程时的顶部进度条状态。 */
  const busy = ref(false);
  /** 最近事件（环形缓冲）。 */
  const opLog = shallowRef<OpEvent[]>([]);

  const listeners = new Set<(event: OpEvent) => void>();
  let pendingCoalesce: PendingCoalesce | null = null;

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  /** 操作记录：已应用（正序）+ 已撤销（正序），供面板直接渲染。 */
  const history = computed<HistoryEntry[]>(() => [
    ...undoStack.value.map((step) => toEntry(step, true)),
    ...[...redoStack.value].reverse().map((step) => toEntry(step, false)),
  ]);

  function toEntry(step: HistoryStep, applied: boolean): HistoryEntry {
    return {
      id: step.id,
      kind: step.kind,
      actor: step.actor,
      ...(step.sessionId ? { sessionId: step.sessionId } : {}),
      label: step.label,
      timestamp: step.timestamp,
      affected: step.affected,
      durationMs: step.durationMs,
      applied,
    };
  }

  function emitEvent(event: OpEvent): void {
    opLog.value = [...opLog.value, event].slice(-EVENT_LOG_LIMIT);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // 监听器失败不影响写操作。
      }
    }
  }

  /** 订阅所有已执行命令；返回取消订阅函数。 */
  function subscribe(listener: (event: OpEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function makeStep(
    command: Command,
    affected: Affected,
    durationMs: number,
    before: Project,
    after: Project,
  ): HistoryStep {
    return {
      id: command.id,
      kind: command.kind,
      actor: command.actor,
      ...(command.sessionId ? { sessionId: command.sessionId } : {}),
      label: command.label,
      timestamp: command.timestamp,
      affected,
      durationMs,
      before,
      after,
    };
  }

  function pushHistory(step: HistoryStep): void {
    const stack = undoStack.value.slice();
    stack.push(step);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    undoStack.value = stack;
    redoStack.value = [];
  }

  /** 合并手势期间更新已入栈那一步的最终快照与影响范围。 */
  function updateStep(
    id: string,
    patch: Partial<Pick<HistoryStep, "affected" | "durationMs" | "after">>,
  ): void {
    const stack = undoStack.value;
    const index = stack.findIndex((step) => step.id === id);
    if (index < 0) return;
    const next = stack.slice();
    next[index] = { ...next[index], ...patch };
    undoStack.value = next;
  }

  function commitBefore(
    after: Project,
    before: Project,
    command: Command,
    affected: Affected,
    durationMs: number,
  ): void {
    pushHistory(makeStep(command, affected, durationMs, before, after));
    doc.value = after;
    dirty.value = true;
    revision.value += 1;
  }

  /**
   * 结束/切换一段合并操作时，把整段手势汇总成一条事件。
   * 合并期间 `revision` 已经逐次递增，事件记录最终版本。
   */
  function flushCoalesce(): void {
    const pending = pendingCoalesce;
    pendingCoalesce = null;
    coalesceKey.value = null;
    if (!pending) return;
    const after = doc.value;
    // 手势回到起点（拖出去又拖回来）：这一步没有净改动，直接从历史里摘掉，
    // 否则重做会停在中途的某个值上。
    if (after === pending.before) {
      undoStack.value = undoStack.value.filter((step) => step.id !== pending.command.id);
      return;
    }
    const affected = diffAffected(pending.before, after);
    const durationMs = Date.now() - pending.startedAt;
    updateStep(pending.command.id, { affected, durationMs, after });
    emitEvent({
      revision: revision.value,
      command: pending.command,
      affected,
      durationMs,
    });
  }

  /**
   * 人类 UI 的唯一写入口。`mutate` 返回同一引用即视为无变化（不记历史、不置 dirty）。
   * 返回是否真的发生了修改。
   */
  function dispatch(
    mutate: (current: Project) => Project,
    meta?: DispatchMeta,
  ): boolean {
    flushCoalesce();
    const before = doc.value;
    const baseRevision = revision.value;
    const startedAt = Date.now();
    const next = mutate(before);
    if (next === before) return false;

    const command = makeCommand({
      kind: meta?.kind ?? "ui.dispatch",
      payload: meta?.payload ?? {},
      actor: meta?.actor ?? "human",
      label: meta?.label ?? t("agent.command.editTimeline"),
      sessionId: meta?.sessionId,
      baseRevision,
    });
    const affected = diffAffected(before, next);
    const durationMs = Date.now() - startedAt;
    commitBefore(next, before, command, affected, durationMs);
    emitEvent({
      revision: revision.value,
      command,
      affected,
      durationMs,
    });
    return true;
  }

  /**
   * 合并提交：同一 `key` 的连续调用只记第一步历史、只产生一条事件。
   * 用于滑杆这类高频输入，避免一次拖动产生几十步撤销。
   */
  function dispatchCoalesced(
    mutate: (current: Project) => Project,
    key: string,
    meta?: DispatchMeta,
  ): boolean {
    if (pendingCoalesce && pendingCoalesce.key !== key) flushCoalesce();

    const before = doc.value;
    const baseRevision = revision.value;
    const next = mutate(before);
    if (next === before) return false;

    if (!pendingCoalesce) {
      pendingCoalesce = {
        key,
        before,
        baseRevision,
        command: makeCommand({
          kind: meta?.kind ?? "ui.dispatch",
          payload: meta?.payload ?? {},
          actor: meta?.actor ?? "human",
          label: meta?.label ?? t("agent.command.editTimeline"),
          sessionId: meta?.sessionId,
          baseRevision,
        }),
        startedAt: Date.now(),
      };
    }

    const pending = pendingCoalesce;
    if (coalesceKey.value !== key) {
      pushHistory(
        makeStep(
          pending.command,
          diffAffected(before, next),
          0,
          before,
          next,
        ),
      );
      coalesceKey.value = key;
    }
    doc.value = next;
    dirty.value = true;
    revision.value = baseRevision + 1;
    // 步骤的最终快照与影响范围在 `flushCoalesce` 时一次写入：拖动过程中不重复复制历史数组。
    return true;
  }

  /** 显式结束合并（滑杆松开时调用）。 */
  function endCoalesce(): void {
    flushCoalesce();
  }

  /** 可序列化命令入口：MCP / 外部客户端使用。 */
  function applyCommand(command: Command): CommandResult {
    flushCoalesce();

    if (command.baseRevision !== revision.value) {
      const error = t("error.command.stale", {
        expected: revision.value,
        actual: command.baseRevision,
      });
      emitEvent({
        revision: revision.value,
        command,
        affected: EMPTY_AFFECTED,
        durationMs: 0,
        error,
      });
      return {
        ok: false,
        revision: revision.value,
        affected: EMPTY_AFFECTED,
        changed: false,
        error,
      };
    }

    const before = doc.value;
    const startedAt = Date.now();

    try {
      const result = applyCommandToDoc(before, command);
      if (result.doc === before) {
        return {
          ok: true,
          revision: revision.value,
          affected: result.affected,
          changed: false,
        };
      }

      const durationMs = Date.now() - startedAt;
      commitBefore(result.doc, before, command, result.affected, durationMs);
      emitEvent({
        revision: revision.value,
        command,
        affected: result.affected,
        durationMs,
      });
      return {
        ok: true,
        revision: revision.value,
        affected: result.affected,
        changed: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitEvent({
        revision: revision.value,
        command,
        affected: EMPTY_AFFECTED,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return {
        ok: false,
        revision: revision.value,
        affected: EMPTY_AFFECTED,
        changed: false,
        error: message,
      };
    }
  }

  /**
   * 批量命令入口：整批在草稿上执行，全部成功才提交一次 revision / 一个撤销步。
   * 任意一条失败都不会改动当前文档。
   */
  function applyCommands(commands: Command[]): CommandResult {
    flushCoalesce();

    if (commands.length === 0) {
      return {
        ok: false,
        revision: revision.value,
        affected: EMPTY_AFFECTED,
        changed: false,
        error: "至少需要一条命令",
      };
    }

    const expected = revision.value;
    for (const command of commands) {
      if (command.baseRevision !== expected) {
        const error = t("error.command.stale", {
          expected,
          actual: command.baseRevision,
        });
        emitEvent({
          revision: expected,
          command,
          affected: EMPTY_AFFECTED,
          durationMs: 0,
          error,
        });
        return {
          ok: false,
          revision: expected,
          affected: EMPTY_AFFECTED,
          changed: false,
          error,
        };
      }
    }

    const before = doc.value;
    const startedAt = Date.now();

    try {
      const result = applyCommandsToDoc(before, commands);
      if (result.doc === before) {
        return {
          ok: true,
          revision: revision.value,
          affected: result.affected,
          changed: false,
        };
      }

      const label =
        commands.length === 1
          ? commands[0].label
          : t("ops.batchLabel", { label: commands[0].label, count: commands.length });
      const stepCommand: Command = {
        ...commands[0],
        kind: "ui.dispatch",
        payload: { count: commands.length },
        label,
      };
      const durationMs = Date.now() - startedAt;
      commitBefore(result.doc, before, stepCommand, result.affected, durationMs);
      emitEvent({
        revision: revision.value,
        command: stepCommand,
        affected: result.affected,
        durationMs,
      });
      return {
        ok: true,
        revision: revision.value,
        affected: result.affected,
        changed: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitEvent({
        revision: revision.value,
        command: commands[0],
        affected: EMPTY_AFFECTED,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return {
        ok: false,
        revision: revision.value,
        affected: EMPTY_AFFECTED,
        changed: false,
        error: message,
      };
    }
  }

  /** 撤销一步；`record` 为 false 时用于「回撤到此步」的批量重放，不逐条刷事件流。 */
  function undoOne(record: boolean): boolean {
    flushCoalesce();
    const stack = undoStack.value.slice();
    const step = stack.pop();
    if (!step) return false;

    const before = doc.value;
    const baseRevision = revision.value;
    const startedAt = Date.now();
    undoStack.value = stack;
    redoStack.value = [...redoStack.value, step];
    doc.value = step.before;
    dirty.value = true;
    revision.value = baseRevision + 1;

    if (!record) return true;

    const command = makeCommand({
      kind: "history.undo",
      payload: {},
      actor: "human",
      label: t("agent.command.undo"),
      baseRevision,
    });
    emitEvent({
      revision: revision.value,
      command,
      affected: diffAffected(before, step.before),
      durationMs: Date.now() - startedAt,
    });
    return true;
  }

  /** 重做一步；`record` 语义同 `undoOne`。 */
  function redoOne(record: boolean): boolean {
    flushCoalesce();
    const stack = redoStack.value.slice();
    const step = stack.pop();
    if (!step) return false;

    const before = doc.value;
    const baseRevision = revision.value;
    const startedAt = Date.now();
    redoStack.value = stack;
    undoStack.value = [...undoStack.value, step];
    doc.value = step.after;
    dirty.value = true;
    revision.value = baseRevision + 1;

    if (!record) return true;

    const command = makeCommand({
      kind: "history.redo",
      payload: {},
      actor: "human",
      label: t("agent.command.redo"),
      baseRevision,
    });
    emitEvent({
      revision: revision.value,
      command,
      affected: diffAffected(before, step.after),
      durationMs: Date.now() - startedAt,
    });
    return true;
  }

  function undo(): void {
    undoOne(true);
  }

  function redo(): void {
    redoOne(true);
  }

  /**
   * 回撤到某一步之前：该步及其之后所有已应用的操作都会撤销。
   * 被撤销的步骤仍留在操作记录里，可以随时重做到其中任意一步。
   */
  function revertTo(id: string): boolean {
    flushCoalesce();
    const index = undoStack.value.findIndex((step) => step.id === id);
    if (index < 0) return false;
    let changed = false;
    while (undoStack.value.length > index) {
      if (!undoOne(false)) break;
      changed = true;
    }
    return changed;
  }

  /** 重做到某一步（含该步），把它之前的撤销步骤一并恢复。 */
  function reapplyTo(id: string): boolean {
    flushCoalesce();
    const index = redoStack.value.findIndex((step) => step.id === id);
    if (index < 0) return false;
    const count = redoStack.value.length - index;
    let changed = false;
    for (let i = 0; i < count; i += 1) {
      if (!redoOne(false)) break;
      changed = true;
    }
    return changed;
  }

  /** 用一份新文档替换当前工程，并清空历史与事件流。被替换的工作副本会进入历史工程。 */
  function reset(project: Project, path: string | null): void {
    recordProjectHistory(doc.value, filePath.value, dirty.value);
    pendingCoalesce = null;
    coalesceKey.value = null;
    doc.value = project;
    filePath.value = path;
    dirty.value = false;
    undoStack.value = [];
    redoStack.value = [];
    revision.value = 0;
    opLog.value = [];

    const command = makeCommand({
      kind: "project.reset",
      payload: { name: project.name },
      actor: "human",
      label: t("agent.command.openProject"),
      baseRevision: 0,
    });
    emitEvent({
      revision: 0,
      command,
      affected: EMPTY_AFFECTED,
      durationMs: 0,
    });
  }

  function newProject(name?: string): void {
    reset(makeProject(name), null);
  }

  /** 修改工程名（顶栏铅笔按钮）。 */
  function rename(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed === doc.value.name) return false;
    return dispatch((current) => renameProject(current, trimmed), {
      kind: "project.rename",
      payload: { name: trimmed },
      label: t("agent.command.renameProject"),
    });
  }

  function markSaved(path: string): void {
    filePath.value = path;
    dirty.value = false;
  }

  /**
   * 写入素材的波形缓存。波形是派生数据，不进撤销栈、不置 dirty、不产生事件。
   */
  function setAssetWaveform(assetId: string, wave: number[]): void {
    const next = updateAsset(doc.value, assetId, { wave });
    if (next !== doc.value) doc.value = next;
  }

  /** 载入时把源文件已缺失的素材标为离线。 */
  async function markOfflineAssets(project: Project): Promise<Project> {
    let next = project;
    for (const asset of project.assets) {
      const exists = await pathExists(asset.src);
      if (!exists) next = updateAsset(next, asset.id, { offline: true });
    }
    return next;
  }

  async function openPath(path: string): Promise<void> {
    busy.value = true;
    try {
      const json = await readProjectFile(path);
      const parsed = parseProject(json);
      reset(await markOfflineAssets(parsed), path);
      // 打开过的工程直接进入历史，和自动保存的工程一样可随时回来。
      recordProjectHistory(doc.value, path, false);
      await flushHistoryRecords();
    } finally {
      busy.value = false;
    }
  }

  /** 回到一份历史工程；当前工程会先被记入历史。 */
  async function restoreHistory(id: string): Promise<void> {
    busy.value = true;
    try {
      const snapshot = await getProjectHistory(id);
      const parsed = parseProject(snapshot.project);
      reset(await markOfflineAssets(parsed), snapshot.path);
      dirty.value = snapshot.dirty;
      recordProjectHistory(doc.value, snapshot.path, snapshot.dirty);
      await flushHistoryRecords();
    } finally {
      busy.value = false;
    }
  }

  /** 打开工程（原生文件框）。取消则什么都不做。 */
  async function open(): Promise<boolean> {
    const path = await pickProjectFile();
    if (!path) return false;
    await openPath(path);
    return true;
  }

  async function save(): Promise<boolean> {
    if (!filePath.value) return saveAs();
    const path = filePath.value;
    await writeProjectFile(path, serializeProject(doc.value));
    dirty.value = false;
    recordProjectHistory(doc.value, path, false);
    await flushHistoryRecords();
    return true;
  }

  async function saveAs(): Promise<boolean> {
    const path = await pickSaveProjectPath(doc.value.name);
    if (!path) return false;
    await writeProjectFile(path, serializeProject(doc.value));
    markSaved(path);
    recordProjectHistory(doc.value, path, false);
    await flushHistoryRecords();
    return true;
  }

  return {
    doc,
    dirty,
    filePath,
    revision,
    busy,
    opLog,
    history,
    canUndo,
    canRedo,
    subscribe,
    dispatch,
    dispatchCoalesced,
    endCoalesce,
    applyCommand,
    applyCommands,
    setAssetWaveform,
    undo,
    redo,
    revertTo,
    reapplyTo,
    reset,
    newProject,
    rename,
    markSaved,
    markOfflineAssets,
    open,
    openPath,
    restoreHistory,
    save,
    saveAs,
  };
});

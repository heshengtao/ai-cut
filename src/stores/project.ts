/**
 * 工程文档 store：唯一写入口是 `dispatch`。
 * 撤销/重做采用文档快照（纯 JSON、体积小、最稳），上限 100 步。
 */
import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { Project } from "@/types/project";
import { newProject as makeProject } from "@/core/factory";
import { parseProject, serializeProject } from "@/core/serialize";
import { updateAsset } from "@/core/ops";
import { renameProject } from "@/core/ops/project";
import {
  pathExists,
  pickProjectFile,
  pickSaveProjectPath,
  readProjectFile,
  writeProjectFile,
} from "@/core/media";

/** 快照历史上限。 */
export const HISTORY_LIMIT = 100;

export const useProjectStore = defineStore("project", () => {
  const doc = shallowRef<Project>(makeProject());
  const dirty = ref(false);
  const filePath = ref<string | null>(null);
  const undoStack = shallowRef<Project[]>([]);
  const redoStack = shallowRef<Project[]>([]);
  /** 连续同类操作（滑杆拖动）的合并键；不同键则另记一步历史。 */
  const coalesceKey = ref<string | null>(null);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  /**
   * 唯一写入口。`mutate` 返回同一引用即视为无变化（不记历史、不置 dirty）。
   * 返回是否真的发生了修改。
   */
  function dispatch(mutate: (current: Project) => Project): boolean {
    coalesceKey.value = null;
    const next = mutate(doc.value);
    if (next === doc.value) return false;

    const stack = undoStack.value.slice();
    stack.push(doc.value);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    undoStack.value = stack;
    redoStack.value = [];
    doc.value = next;
    dirty.value = true;
    return true;
  }

  /**
   * 合并提交：同一 `key` 的连续调用只记第一步历史。
   * 用于滑杆这类高频输入，避免一次拖动产生几十步撤销。
   */
  function dispatchCoalesced(mutate: (current: Project) => Project, key: string): boolean {
    const next = mutate(doc.value);
    if (next === doc.value) return false;

    if (coalesceKey.value !== key) {
      const stack = undoStack.value.slice();
      stack.push(doc.value);
      if (stack.length > HISTORY_LIMIT) stack.shift();
      undoStack.value = stack;
      redoStack.value = [];
      coalesceKey.value = key;
    }
    doc.value = next;
    dirty.value = true;
    return true;
  }

  /** 显式结束合并（滑杆松开时调用）。 */
  function endCoalesce(): void {
    coalesceKey.value = null;
  }

  function undo(): void {
    coalesceKey.value = null;
    const stack = undoStack.value.slice();
    const previous = stack.pop();
    if (!previous) return;
    redoStack.value = [...redoStack.value, doc.value];
    undoStack.value = stack;
    doc.value = previous;
    dirty.value = true;
  }

  function redo(): void {
    coalesceKey.value = null;
    const stack = redoStack.value.slice();
    const next = stack.pop();
    if (!next) return;
    undoStack.value = [...undoStack.value, doc.value];
    redoStack.value = stack;
    doc.value = next;
    dirty.value = true;
  }

  /** 用一份新文档替换当前工程，并清空历史。 */
  function reset(project: Project, path: string | null): void {
    doc.value = project;
    filePath.value = path;
    dirty.value = false;
    undoStack.value = [];
    redoStack.value = [];
    coalesceKey.value = null;
  }

  function newProject(name?: string): void {
    reset(makeProject(name), null);
  }

  /** 修改工程名（顶栏铅笔按钮）。 */
  function rename(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed || trimmed === doc.value.name) return false;
    return dispatch((current) => renameProject(current, trimmed));
  }

  function markSaved(path: string): void {
    filePath.value = path;
    dirty.value = false;
  }

  /**
   * 写入素材的波形缓存。波形是派生数据，不进撤销栈、不置 dirty。
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
    const json = await readProjectFile(path);
    const parsed = parseProject(json);
    reset(await markOfflineAssets(parsed), path);
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
    await writeProjectFile(filePath.value, serializeProject(doc.value));
    dirty.value = false;
    return true;
  }

  async function saveAs(): Promise<boolean> {
    const path = await pickSaveProjectPath(doc.value.name);
    if (!path) return false;
    await writeProjectFile(path, serializeProject(doc.value));
    markSaved(path);
    return true;
  }

  return {
    doc,
    dirty,
    filePath,
    canUndo,
    canRedo,
    dispatch,
    dispatchCoalesced,
    endCoalesce,
    setAssetWaveform,
    undo,
    redo,
    reset,
    newProject,
    rename,
    markSaved,
    open,
    openPath,
    save,
    saveAs,
  };
});

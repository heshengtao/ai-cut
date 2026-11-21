/**
 * 工程里的多画布文档视图。
 *
 * 真相在 `doc.boards`（一个工程可以开多张画布）；`doc.board` 是指向
 * `doc.activeBoardId` 那张画布的**不可枚举访问器**——写盘只落 `boards`，
 * 读盘时由 `attachBoardView()` 折返，磁盘上不会出现两份画布。
 *
 * 约束：本文件不 import Vue / store（domain 引擎也要打包它）。
 */
import type { BoardCanvas, BoardDoc } from "@/types/board";
import type { Project } from "@/types/project";
import { emptyBoard, normalizeBoard } from "./schema";
import { isKnownMessageKey, t } from "@/i18n/translate";

/** 已挂过画布视图的文档对象。 */
const attached = new WeakSet<object>();

export function isBoardViewAttached(doc: Project): boolean {
  return attached.has(doc);
}

// 避免 core 层依赖 crypto 的全局类型（QuickJS / 测试环境都有 randomUUID）。
function newCanvasId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return `canvas-${cryptoApi.randomUUID()}`;
  return `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function looksLikeBoard(value: unknown): value is BoardDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<BoardDoc>;
  return Array.isArray(doc.nodes) && Array.isArray(doc.edges);
}

/** 画布列表（永远至少一项）。 */
export function canvasesOf(doc: Project): BoardCanvas[] {
  const list = doc.boards;
  if (Array.isArray(list) && list.length > 0) return list;
  return [];
}

/** 当前画布；`activeBoardId` 失效时回落到第一张。 */
export function activeCanvas(doc: Project): BoardCanvas | null {
  const list = canvasesOf(doc);
  if (list.length === 0) return null;
  return list.find((canvas) => canvas.id === doc.activeBoardId) ?? list[0];
}

/**
 * 折返「boards 是真相 + `board` 访问器就绪」的形态。
 *
 * - 老工程只有 `board` → 包成一张画布；
 * - 被 `{ ...doc, board }` 展开 / 打补丁过（有自有 `board` 数据字段）→ 写回活动画布；
 * - 已就绪 → 原样返回（幂等，`dispatch` 依赖它判断文档有没有变）。
 */
export function attachBoardView(input: Project): Project {
  const descriptor = Object.getOwnPropertyDescriptor(input, "board");
  const hasAccessor = Boolean(descriptor?.get);
  const raw = (input as Partial<Project>).boards;
  const list = Array.isArray(raw) && raw.length > 0 ? raw : [];
  const ownBoard =
    !hasAccessor && looksLikeBoard(descriptor?.value) ? (descriptor?.value as BoardDoc) : undefined;

  let boards: BoardCanvas[];
  if (list.length === 0) {
    const doc = ownBoard ? normalizeBoard(ownBoard) : emptyBoard();
    // 标题留空 = 自动名（「画布 N」由 UI 按当前语言渲染），不把语言写进文档。
    boards = [{ id: newCanvasId(), title: "", doc }];
  } else {
    const activeIndex = Math.max(
      0,
      list.findIndex((canvas) => canvas.id === (input as Project).activeBoardId),
    );
    // 自有 `board` 数据字段可能是两种东西：
    // - `{ ...doc, board }` 的补丁（和活动画布不是同一个对象）→ 写回活动画布；
    // - 展开可枚举访问器时顺手拷贝的旧值（同一个对象）→ 忽略。
    const patched =
      ownBoard && list[activeIndex]?.doc !== ownBoard ? normalizeBoard(ownBoard) : undefined;
    let changed = patched !== undefined;
    boards = list.map((canvas, index) => {
      const id = typeof canvas?.id === "string" && canvas.id ? canvas.id : newCanvasId();
      // 历史数据：早期版本把缺词条的 `t()` 返回值（key 本身）存成了标题，读盘时修掉。
      const rawTitle = typeof canvas?.title === "string" ? canvas.title.trim() : "";
      const title = isKnownMessageKey(rawTitle) ? "" : rawTitle;
      const doc =
        patched && index === activeIndex
          ? patched
          : looksLikeBoard(canvas?.doc)
            ? canvas.doc
            : normalizeBoard(canvas?.doc);
      if (id !== canvas?.id || title !== canvas?.title || doc !== canvas?.doc) changed = true;
      return { id, title, doc };
    });
    if (
      !changed &&
      attached.has(input) &&
      hasAccessor &&
      input.boards === list
    ) {
      return input;
    }
  }

  const active =
    boards.find((canvas) => canvas.id === (input as Project).activeBoardId) ?? boards[0]!;
  const next = { ...input, boards, activeBoardId: active.id } as Project;
  // 老工程 / `{ ...doc, board }` 带来的自有 `board` 字段已经并进 boards：删掉，
  // 避免磁盘上出现两份画布。
  delete (next as Partial<Project>).board;
  Object.defineProperty(next, "board", {
    // 和 episodes 的 tracks / markers 一样是**可枚举**访问器：
    // `{ ...doc }` 展开时把活动画布文档带过去，外部展开过的文档仍然有 `board`。
    // 代价是 JSON 里会出现一份重复，由 `serializeProject()` 负责剔除。
    enumerable: true,
    configurable: true,
    get: () => {
      const current = next.boards ?? [];
      return (current.find((canvas) => canvas.id === next.activeBoardId) ?? current[0])?.doc;
    },
    set: (value: BoardDoc | undefined) => {
      if (!value) return;
      const current = next.boards ?? [];
      const index = Math.max(
        0,
        current.findIndex((canvas) => canvas.id === next.activeBoardId),
      );
      next.boards = current.map((canvas, item) =>
        item === index ? { ...canvas, doc: value } : canvas,
      );
    },
  });
  attached.add(next);
  return next;
}

/**
 * 去掉自有 `board` 数据字段：内部改动（切换 / 新建 / 删除）不能让活动画布
 * 的旧投影覆盖掉刚写进去的内容。
 */
function withoutBoardProjection(doc: Project): Project {
  const next = { ...doc } as Project;
  delete (next as Partial<Project>).board;
  return next;
}

/** 替换某张画布的文档（活动画布也可以走 `doc.board = …`）。 */
export function replaceCanvasDoc(doc: Project, canvasId: string, board: BoardDoc): Project {
  const list = canvasesOf(doc);
  if (list.length === 0) return attachBoardView({ ...doc, boards: [], board } as Project);
  const index = list.findIndex((canvas) => canvas.id === canvasId);
  if (index < 0) return doc;
  return attachBoardView({
    ...withoutBoardProjection(doc),
    boards: list.map((canvas, item) => (item === index ? { ...canvas, doc: board } : canvas)),
  });
}

/** 新建一张空画布并切过去（切走前调用方负责把当前画布写回）。 */
export function createCanvas(doc: Project, title?: string): Project {
  const list = canvasesOf(doc);
  const canvas: BoardCanvas = {
    id: newCanvasId(),
    title: title?.trim() || "",
    doc: emptyBoard(),
  };
  return attachBoardView({
    ...withoutBoardProjection(doc),
    boards: [...list, canvas],
    activeBoardId: canvas.id,
  });
}

/** 删除一张画布；删掉的是当前画布时切到相邻一张。工程永远至少留一张。 */
export function deleteCanvas(doc: Project, canvasId: string): Project {
  const list = canvasesOf(doc);
  if (list.length <= 1) return doc;
  const index = list.findIndex((canvas) => canvas.id === canvasId);
  if (index < 0) return doc;
  const boards = list.filter((canvas) => canvas.id !== canvasId);
  const activeBoardId =
    doc.activeBoardId === canvasId
      ? (boards[Math.min(index, boards.length - 1)]?.id ?? boards[0]!.id)
      : doc.activeBoardId;
  return attachBoardView({ ...withoutBoardProjection(doc), boards, activeBoardId });
}

/** 重命名画布。 */
export function renameCanvas(doc: Project, canvasId: string, title: string): Project {
  const list = canvasesOf(doc);
  // 清空名字 = 回到自动名（按语言渲染的「画布 N」）。
  const nextTitle = title.trim();
  const index = list.findIndex((canvas) => canvas.id === canvasId);
  if (index < 0 || (list[index]!.title ?? "") === nextTitle) return doc;
  return attachBoardView({
    ...withoutBoardProjection(doc),
    boards: list.map((canvas, item) =>
      item === index ? { ...canvas, title: nextTitle } : canvas,
    ),
  });
}

/** 切到另一张画布（调用方先把当前画布写回）。 */
export function activateCanvas(doc: Project, canvasId: string): Project {
  const list = canvasesOf(doc);
  if (!list.some((canvas) => canvas.id === canvasId)) return doc;
  if (doc.activeBoardId === canvasId) return doc;
  return attachBoardView({ ...withoutBoardProjection(doc), activeBoardId: canvasId });
}

/** 复制一张画布（文档深拷贝，来源身份不复制——副本是一张新画布）。 */
export function duplicateCanvas(doc: Project, canvasId: string): Project {
  const list = canvasesOf(doc);
  const source = list.find((canvas) => canvas.id === canvasId);
  if (!source) return doc;
  const copy: BoardCanvas = {
    id: newCanvasId(),
    // 自动名的画布复制出来仍是自动名（编号由 UI 算），有名字的才加「副本」。
    title: source.title ? `${source.title} ${t("board.canvas.copySuffix")}`.trim() : "",
    doc: normalizeBoard(JSON.parse(JSON.stringify(source.doc))),
  };
  return attachBoardView({
    ...withoutBoardProjection(doc),
    boards: [...list, copy],
    activeBoardId: copy.id,
  });
}

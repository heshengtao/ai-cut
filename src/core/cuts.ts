/**
 * 剪口播的数据层：剪口（`CutRecord`）是真相，时间线上的片段是它投影出来的结果。
 *
 * 一组剪口记在 `CutScope` 上：
 * - `baseIn..baseOut` 划定这组剪口负责的素材范围，`baseStart` 是它在时间线上的落点；
 * - 每次增删改剪口，都从 `baseIn..baseOut` 减去全部剪口，重新铺一遍片段；
 * - 所以「还原一刀」「改剪口范围」都是同一套重建，不依赖删之前时间线长什么样。
 *
 * 剪口用素材时钟（秒），片段被移动 / 变速都不影响它。
 */
import type { Clip, CutKind, CutRecord, CutScope, Project } from "@/types/project";
import { findClip, sortClips, withTouch } from "@/core/ops/internal";

/** 浮点容差：一帧以内的时间差不算变化。 */
const EPS = 1e-6;

/** 两条剪口之间小于这个间隔就视为相邻（0.02 秒，与 BaoCut 一致）。 */
const MERGE_GAP = 0.02;

/** 文字片段：没有素材可截，剪口只能把它的时长压短（或还原时拉长）。 */
function isTextClip(clip: Clip): boolean {
  return clip.assetId === "" && typeof clip.text === "string";
}

/** 片段播放速度，夹到 0.1–4（与 ops 保持一致）。 */
function clipSpeed(clip: Clip): number {
  return Math.min(4, Math.max(0.1, clip.speed ?? 1));
}

/** 造一条剪口。 */
export function newCut(
  kind: CutKind,
  srcStart: number,
  srcEnd: number,
  text: string,
): CutRecord {
  return {
    id: crypto.randomUUID(),
    srcStart: Math.min(srcStart, srcEnd),
    srcEnd: Math.max(srcStart, srcEnd),
    kind,
    text,
    createdAt: Date.now(),
  };
}

/** 全部剪口组。 */
export function cutScopes(doc: Project): CutScope[] {
  return doc.cutScopes ?? [];
}

/** 按 id 取剪口组。 */
export function scopeById(doc: Project, scopeId: string): CutScope | undefined {
  return cutScopes(doc).find((scope) => scope.id === scopeId);
}

/** 某个片段属于哪一组剪口（`pieces` 里含它）。 */
export function scopeOfClip(doc: Project, clipId: string): CutScope | undefined {
  return cutScopes(doc).find((scope) => scope.pieces.includes(clipId));
}

/** 某个素材的剪口组；用于判断「这个素材剪过没有」。 */
export function scopeOfAsset(doc: Project, assetId: string): CutScope | undefined {
  return cutScopes(doc).find((scope) => scope.assetId === assetId);
}

/** 全部剪口，按素材时间排序。 */
export function allCuts(doc: Project): { scope: CutScope; cut: CutRecord }[] {
  const out: { scope: CutScope; cut: CutRecord }[] = [];
  for (const scope of cutScopes(doc)) {
    for (const cut of scope.cuts) out.push({ scope, cut });
  }
  return out.sort((a, b) => a.cut.srcStart - b.cut.srcStart);
}

/** 剪口在时间线上的起点（已折叠：扣掉它前面剪掉的那些秒）。 */
export function cutTimelineStart(scope: CutScope, cut: CutRecord): number {
  const removed = scope.cuts
    .filter((other) => other.srcEnd <= cut.srcStart + EPS && other.id !== cut.id)
    .reduce((sum, other) => sum + (other.srcEnd - other.srcStart), 0);
  return (
    scope.baseStart + (cut.srcStart - scope.baseIn - removed) / clipSpeed(scope.template)
  );
}

/** 剪口在时间线上的长度（秒）。 */
export function cutTimelineLength(scope: CutScope, cut: CutRecord): number {
  return (cut.srcEnd - cut.srcStart) / clipSpeed(scope.template);
}

/** 素材区间减去剪口后剩下的段落，按顺序。 */
export function keptSpans(
  baseIn: number,
  baseOut: number,
  cuts: CutRecord[],
): { start: number; end: number }[] {
  const ordered = cuts
    .map((cut) => ({
      start: Math.max(baseIn, Math.min(cut.srcStart, cut.srcEnd)),
      end: Math.min(baseOut, Math.max(cut.srcStart, cut.srcEnd)),
    }))
    .filter((cut) => cut.end - cut.start > EPS)
    .sort((a, b) => a.start - b.start);

  const spans: { start: number; end: number }[] = [];
  let cursor = baseIn;
  for (const cut of ordered) {
    if (cut.start > cursor + EPS) spans.push({ start: cursor, end: cut.start });
    cursor = Math.max(cursor, cut.end);
  }
  if (baseOut > cursor + EPS) spans.push({ start: cursor, end: baseOut });
  return spans;
}

/**
 * 从一条片段建一组剪口。**不改文档**：调用方把返回的 scope 连同后续 op 一起提交。
 */
export function scopeFromClip(clip: Clip): CutScope {
  const speed = clipSpeed(clip);
  return {
    id: crypto.randomUUID(),
    assetId: clip.assetId,
    trackId: clip.trackId,
    baseIn: clip.in,
    baseOut: clip.in + clip.duration * speed,
    baseStart: clip.start,
    template: { ...clip },
    pieces: [clip.id],
    cuts: [],
  };
}

/**
 * 在片段上剪掉一段素材时间。
 *
 * 已经剪过的区间再剪一次会直接返回原文档（幂等）；与已有剪口重叠时合并成一条，
 * 避免出现互相咬合的剪口。
 */
export function cutSourceRange(
  doc: Project,
  clipId: string,
  srcStart: number,
  srcEnd: number,
  kind: CutKind,
  text = "",
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const scope = scopeOfClip(doc, clipId) ?? scopeFromClip(found.clip);
  const start = Math.max(scope.baseIn, Math.min(srcStart, srcEnd));
  const end = Math.min(scope.baseOut, Math.max(srcStart, srcEnd));
  if (end - start <= EPS) return doc;

  // 与已有剪口重叠：合并，不新增。完全被覆盖时原样返回。
  const overlapping = scope.cuts.filter(
    (cut) => cut.srcStart <= end + MERGE_GAP && cut.srcEnd >= start - MERGE_GAP,
  );
  if (overlapping.length > 0) {
    const mergedStart = Math.min(start, ...overlapping.map((cut) => cut.srcStart));
    const mergedEnd = Math.max(end, ...overlapping.map((cut) => cut.srcEnd));
    if (
      overlapping.length === 1 &&
      Math.abs(overlapping[0].srcStart - mergedStart) < EPS &&
      Math.abs(overlapping[0].srcEnd - mergedEnd) < EPS
    ) {
      return doc;
    }
    let next = doc;
    for (const cut of overlapping) {
      next = removeCut(next, scope.id, cut.id);
    }
    // 重新取一次：removeCut 会重建，scope 引用已变。
    const current = scopeById(next, scope.id);
    if (!current) return next;
    return addCutToScope(next, current, newCut(kind, mergedStart, mergedEnd, text));
  }

  return addCutToScope(doc, scope, newCut(kind, start, end, text));
}

/** 在指定剪口组里加一条剪口（内部用，调用方已经算好范围）。 */
function addCutToScope(
  doc: Project,
  scope: CutScope,
  cut: CutRecord,
): Project {
  const withScope = ensureScope(doc, scope);
  const found = scopeById(withScope, scope.id);
  if (!found) return doc;
  const current = refreshTemplate(withScope, found);

  const t0 = cutTimelineStart(current, cut);
  const length = cutTimelineLength(current, cut);
  const nextCuts = sortCuts([...current.cuts, cut]);

  // 先摘掉这组剪口自己的片段，再把这段时间从其余片段上抽走，
  // 最后按新剪口重铺——中间产物不会和旧片段叠在一起。
  const detached = detachPieces(withScope, current.pieces);
  const rippled = rippleRemove(detached, t0, t0 + length, new Set());

  return projectScope(rippled, { ...current, cuts: nextCuts });
}

/** 删掉一条剪口，时间线还原。 */
export function removeCut(doc: Project, scopeId: string, cutId: string): Project {
  const scope = scopeById(doc, scopeId);
  if (!scope) return doc;
  const cut = scope.cuts.find((item) => item.id === cutId);
  if (!cut) return doc;

  const t0 = cutTimelineStart(scope, cut);
  const length = cutTimelineLength(scope, cut);
  const fresh = refreshTemplate(doc, scope);
  const detached = detachPieces(doc, fresh.pieces);
  const rippled = rippleInsert(detached, t0, length, new Set());
  const remaining = { ...fresh, cuts: fresh.cuts.filter((item) => item.id !== cutId) };
  // 还原后片段变长，重建时按剩下的剪口重新铺。
  return projectScope(rippled, remaining);
}

/**
 * 改一条剪口的范围（左右边界）。等价于「先还原，再按新范围剪」，
 * 但只在一次 dispatch 里完成，撤销时是一步。
 */
export function updateCutRange(
  doc: Project,
  scopeId: string,
  cutId: string,
  srcStart: number,
  srcEnd: number,
): Project {
  const scope = scopeById(doc, scopeId);
  const cut = scope?.cuts.find((item) => item.id === cutId);
  if (!scope || !cut) return doc;
  const start = Math.max(scope.baseIn, Math.min(srcStart, srcEnd));
  const end = Math.min(scope.baseOut, Math.max(srcStart, srcEnd));
  if (end - start <= EPS) return doc;
  if (Math.abs(start - cut.srcStart) < EPS && Math.abs(end - cut.srcEnd) < EPS) return doc;

  const restored = removeCut(doc, scopeId, cutId);
  const fresh = scopeById(restored, scopeId);
  if (!fresh) return restored;
  const anchor = fresh.pieces[0];
  if (!anchor) return restored;
  const next = addCutToScope(restored, fresh, {
    ...cut,
    srcStart: start,
    srcEnd: end,
  });
  return next;
}

/** 整组剪口一次性清空（「全部还原」）。 */
export function clearScope(doc: Project, scopeId: string): Project {
  const scope = scopeById(doc, scopeId);
  if (!scope || scope.cuts.length === 0) return doc;
  let next = doc;
  // 从后往前还原：后面的剪口先回来，位置不会互相影响。
  const ordered = scope.cuts.slice().sort((a, b) => b.srcStart - a.srcStart);
  for (const cut of ordered) {
    const current = scopeById(next, scopeId);
    if (!current) break;
    next = removeCut(next, scopeId, cut.id);
  }
  return next;
}

/**
 * 改写词表里的一个词（改错别字）。
 *
 * 只动文本、不动时间，也不会重铺片段——所以「改字」永远不触发剪切。
 */
export function updateScopeWords(
  doc: Project,
  scopeId: string,
  words: { text: string; start: number; end: number }[],
): Project {
  const scopes = cutScopes(doc);
  if (!scopes.some((scope) => scope.id === scopeId)) return doc;
  const next = scopes.map((scope) => (scope.id === scopeId ? { ...scope, words } : scope));
  return withTouch(doc, { cutScopes: next });
}

/** 摘掉一组片段（重建前先清场，避免中间产物与旧片段重叠）。 */
function detachPieces(doc: Project, ids: string[]): Project {
  if (ids.length === 0) return doc;
  const set = new Set(ids);
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    const clips = track.clips.filter((clip) => !set.has(clip.id));
    if (clips.length === track.clips.length) return track;
    changed = true;
    return { ...track, clips };
  });
  return changed ? withTouch(doc, { tracks }) : doc;
}

/** 重建前把模板刷新成当前第一段的属性（用户可能改过调色 / 变速）。 */
function refreshTemplate(doc: Project, scope: CutScope): CutScope {
  const track = doc.tracks.find((item) => item.id === scope.trackId);
  const template = track?.clips.find((clip) => clip.id === scope.pieces[0]);
  return template ? { ...scope, template } : scope;
}

/** 把 scope 写回文档（不存在就追加）。 */
function ensureScope(doc: Project, scope: CutScope): Project {
  const scopes = cutScopes(doc);
  if (scopes.some((item) => item.id === scope.id)) return doc;
  return withTouch(doc, { cutScopes: [...scopes, scope] });
}

function sortCuts(cuts: CutRecord[]): CutRecord[] {
  return cuts.slice().sort((a, b) => a.srcStart - b.srcStart);
}

/** 按剪口重铺片段。只动这组剪口自己的片段，不动其它轨道。 */
function projectScope(doc: Project, scope: CutScope): Project {
  const spans = keptSpans(scope.baseIn, scope.baseOut, scope.cuts);
  const track = doc.tracks.find((item) => item.id === scope.trackId);
  if (!track) return doc;

  // 模板取当前第一段（保留用户后调的调色 / 特效 / 变速），没有就用建组时的快照。
  const template = track.clips.find((clip) => clip.id === scope.pieces[0]) ?? scope.template;
  const speedNow = clipSpeed(template);
  const keptIds = scope.pieces.slice();

  let cursor = scope.baseStart;
  const pieces: Clip[] = spans.map((span, index) => {
    const duration = (span.end - span.start) / speedNow;
    const piece: Clip = {
      ...template,
      id: keptIds[index] ?? crypto.randomUUID(),
      trackId: scope.trackId,
      assetId: scope.assetId,
      start: cursor,
      duration,
      in: span.start,
    };
    cursor += duration;
    return piece;
  });

  const pieceIds = new Set(scope.pieces);
  const clips: Clip[] = [];
  for (const clip of track.clips) {
    if (pieceIds.has(clip.id)) continue;
    clips.push(clip);
  }
  // 同一素材的其它片段可能被剪口截断过，保留即可（它们不在 pieces 里）。
  const nextTrack = { ...track, clips: sortClips([...clips, ...pieces]) };
  const tracks = doc.tracks.map((item) => (item.id === nextTrack.id ? nextTrack : item));
  const nextScope: CutScope = {
    ...scope,
    template,
    pieces: pieces.map((piece) => piece.id),
  };
  const scopes = cutScopes(doc).map((item) => (item.id === scope.id ? nextScope : item));
  const known = scopes.some((item) => item.id === scope.id);
  return withTouch(doc, {
    tracks,
    cutScopes: known ? scopes : [...scopes, nextScope],
  });
}

/**
 * 从所有轨道抽掉 `[t0, t1)`，并把后面的片段左移。
 *
 * `excluded` 是这组剪口自己的片段：它们由重建接管，先跳过，避免被剪两次。
 */
function rippleRemove(
  doc: Project,
  t0: number,
  t1: number,
  excluded: Set<string>,
): Project {
  const length = t1 - t0;
  if (length <= EPS) return doc;
  let touched = false;
  const tracks = doc.tracks.map((track) => {
    const clips: Clip[] = [];
    let changed = false;
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) {
        clips.push(clip);
        continue;
      }
      const end = clip.start + clip.duration;
      if (isTextClip(clip)) {
        // 文字片段不切开：切开会让同一句字幕出现两次。改成整体压短，
        // 与后面左移的片段保持不重叠。
        if (end <= t0 + EPS) {
          clips.push(clip);
        } else if (clip.start >= t1 - EPS) {
          clips.push({ ...clip, start: Math.max(0, clip.start - length) });
          changed = true;
        } else {
          const overlap = Math.min(end, t1) - Math.max(clip.start, t0);
          const duration = Math.max(1 / 25, clip.duration - Math.max(0, overlap));
          const start = clip.start >= t0 - EPS ? Math.max(0, t0) : clip.start;
          clips.push({ ...clip, start, duration });
          changed = true;
        }
        continue;
      }
      if (end <= t0 + EPS) {
        clips.push(clip);
      } else if (clip.start >= t1 - EPS) {
        clips.push({ ...clip, start: Math.max(0, clip.start - length) });
        changed = true;
      } else {
        changed = true;
        const speed = clipSpeed(clip);
        const hasLeft = clip.start < t0 - EPS;
        const hasRight = end > t1 + EPS;
        if (hasLeft) {
          clips.push({ ...clip, duration: t0 - clip.start });
        }
        if (hasRight) {
          const consumed = (t1 - clip.start) * speed;
          clips.push({
            ...clip,
            id: hasLeft ? crypto.randomUUID() : clip.id,
            start: Math.max(0, t0),
            duration: end - t1,
            in: clip.in + consumed,
          });
        }
      }
    }
    if (!changed) return track;
    touched = true;
    return { ...track, clips: sortClips(clips) };
  });
  return touched ? withTouch(doc, { tracks }) : doc;
}

/**
 * 在 `at` 处撑开一段长 `length` 的空隙，后面的片段右移。还原剪口用。
 */
function rippleInsert(
  doc: Project,
  at: number,
  length: number,
  excluded: Set<string>,
): Project {
  if (length <= EPS) return doc;
  let touched = false;
  const tracks = doc.tracks.map((track) => {
    const clips: Clip[] = [];
    let changed = false;
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) {
        clips.push(clip);
        continue;
      }
      const end = clip.start + clip.duration;
      if (isTextClip(clip)) {
        // 还原时把文字片段拉回原来的长度，不拆成两段。
        if (end <= at + EPS) {
          clips.push(clip);
        } else if (clip.start >= at - EPS) {
          clips.push({ ...clip, start: clip.start + length });
          changed = true;
        } else {
          clips.push({ ...clip, duration: clip.duration + length });
          changed = true;
        }
        continue;
      }
      if (end <= at + EPS) {
        clips.push(clip);
      } else if (clip.start >= at - EPS) {
        clips.push({ ...clip, start: clip.start + length });
        changed = true;
      } else {
        changed = true;
        const speed = clipSpeed(clip);
        clips.push({ ...clip, duration: at - clip.start });
        clips.push({
          ...clip,
          id: crypto.randomUUID(),
          start: at + length,
          duration: end - at,
          in: clip.in + (at - clip.start) * speed,
        });
      }
    }
    if (!changed) return track;
    touched = true;
    return { ...track, clips: sortClips(clips) };
  });
  return touched ? withTouch(doc, { tracks }) : doc;
}

/**
 * 一次加多条剪口（识别结果整批落地）。
 *
 * 所有剪口的落点先按「还没剪」的版式算好，再**从后往前**抽出时间，
 * 这样前面的坐标不会被后面的删除影响；最后只重建一次片段。
 */
export function applyCuts(
  doc: Project,
  clipId: string,
  proposals: { kind: CutKind; srcStart: number; srcEnd: number; text: string }[],
  words: { text: string; start: number; end: number }[] = [],
  timed = true,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const base = scopeOfClip(doc, clipId) ?? scopeFromClip(found.clip);

  // 夹到素材范围，丢掉空区间和与已有剪口重叠的。
  const fresh: CutRecord[] = [];
  for (const proposal of proposals) {
    const start = Math.max(base.baseIn, Math.min(proposal.srcStart, proposal.srcEnd));
    const end = Math.min(base.baseOut, Math.max(proposal.srcStart, proposal.srcEnd));
    if (end - start <= EPS) continue;
    const overlaps = [...base.cuts, ...fresh].some(
      (cut) => cut.srcStart < end - MERGE_GAP && start < cut.srcEnd - MERGE_GAP,
    );
    if (overlaps) continue;
    fresh.push(newCut(proposal.kind, start, end, proposal.text));
  }
  if (fresh.length === 0) return doc;

  const scope: CutScope = {
    ...base,
    cuts: sortCuts([...base.cuts, ...fresh]),
    ...(words.length > 0 ? { words, timed } : {}),
  };
  // 落点按「只扣已有剪口」的版式算：这时文档还是这个版式，位置才对得上。
  const ranges = fresh
    .map((cut) => ({
      t0: cutTimelineStart(base, cut),
      t1: cutTimelineStart(base, cut) + cutTimelineLength(base, cut),
    }))
    .sort((a, b) => b.t0 - a.t0);

  let next = ensureScope(doc, scope);
  next = detachPieces(next, scope.pieces);
  for (const range of ranges) {
    next = rippleRemove(next, range.t0, range.t1, new Set());
  }
  return projectScope(next, scope);
}

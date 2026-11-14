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
import type { AssetKind, MediaAsset, Project } from "@/types/project";
import { applyCommandToDoc } from "@/core/commands";
import { parseProject, serializeProject } from "@/core/serialize";
import {
  assetsPage,
  clipDetail,
  findClips,
  markers,
  overview,
  resolveTrack,
  trackPage,
} from "@/core/projectView";
import { setTranslateLocale, t } from "@/i18n/translate";
// AI 产出物落位的纯函数：与桌面 `core/aiActions` 调的是同一份实现，
// 模型推理在 Rust 侧跑完，这里只负责"把结果接回文档"。
import { addAsset } from "@/core/ops/assets";
import { setClipGain, setClipMuted } from "@/core/ops/clips";
import { findClip } from "@/core/ops/internal";
import {
  addStemTracks,
  applyProcessedAudio,
  extractClipAudio,
  loudnessGain,
} from "@/core/audioEdit";
import { replaceClipVideo } from "@/core/videoEdit";
import { placeVoiceover } from "@/core/voiceover";
import { placeConvertedVoice } from "@/core/voiceEdit";
import { insertCueTrack, placeSubtitleCues } from "@/core/subtitleTrack";
import { parseSubtitleText, serializeSubtitles } from "@/core/subtitleFile";
import { newProject as makeProject } from "@/core/factory";
import { buildExportPlan } from "@/core/export/plan";
import { buildContactLayout } from "@/core/export/contactLayout";
import { changedSamples, parseSsimStats } from "@/core/export/ssim";
import { buildManifestCommands } from "@/core/film/import";
// eslint-disable-next-line
import { parseFilmManifest } from "@/core/film/manifest";
import { projectToManifest } from "@/core/film/export";
import type { ExportOptions } from "@/types/export";
import { setProjectOutput } from "@/core/ops";
import { mapCueToTimeline } from "@/core/subtitles";
import { scopeOfClip, applyCuts } from "@/core/cuts";
import { buildCutCues, placeCueTrack } from "@/core/cutSubtitles";
import {
  DEFAULT_PAUSE,
  DEFAULT_TRIM,
  detectFillers,
  detectPauses,
  mergeProposals,
  padFillerCuts,
  withWordIds,
} from "@/core/cutAnalysis";

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

/**
 * 撤销 / 重做栈。
 *
 * 领域层是**不可变更新**（每次命令换一个新的 `Project` 对象），所以历史里存的只是
 * 旧对象的引用，不需要深拷贝，内存代价很小。桌面端的撤销栈在 Pinia store 里；
 * 无头运行时（智能体 / MCP）没有 UI，就在引擎这边补一份——两边都是"快照式撤销"。
 */
const HISTORY_LIMIT = 50;
const undoStack: Project[] = [];
const redoStack: Project[] = [];

function remember(before: Project): void {
  undoStack.push(before);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

/** 撤销一步。 */
export function undo(): string {
  if (!doc) throw new Error("project not loaded");
  const previous = undoStack.pop();
  if (!previous) {
    return JSON.stringify({ ok: true, revision, changed: false, error: "没有可撤销的操作" });
  }
  redoStack.push(doc);
  doc = previous;
  revision += 1;
  return JSON.stringify({ ok: true, revision, changed: true });
}

/** 重做一步。 */
export function redo(): string {
  if (!doc) throw new Error("project not loaded");
  const next = redoStack.pop();
  if (!next) {
    return JSON.stringify({ ok: true, revision, changed: false, error: "没有可重做的操作" });
  }
  undoStack.push(doc);
  doc = next;
  revision += 1;
  return JSON.stringify({ ok: true, revision, changed: true });
}

/** 历史深度（诊断用）。 */
export function historyDepth(): string {
  return JSON.stringify({ undo: undoStack.length, redo: redoStack.length });
}

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
  undoStack.length = 0;
  redoStack.length = 0;
  return JSON.stringify({ ok: true, revision });
}

/**
 * 载入一份空白工程（无头进程启动时用）。
 *
 * 桌面壳总是有工程（前端新建/打开），无头进程没有——不预置的话，MCP 客户端一连上
 * 每个工具都会回 "project not loaded"。这里用同一个 `newProject()`，保证空白工程的
 * 默认规格与桌面「新建」逐字段一致。
 */
export function blank(): string {
  doc = makeProject();
  revision = 0;
  undoStack.length = 0;
  redoStack.length = 0;
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
    remember(doc);
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
  const args = argsJson && argsJson !== "null"
    ? (JSON.parse(argsJson) as Record<string, unknown>)
    : {};
  switch (method) {
    case "overview":
      return JSON.stringify(overview(doc, revision));
    case "clip":
      return JSON.stringify(clipDetail(doc, revision, String(args.clipId ?? "")));
    // 智能体的"渐进读取"：桌面 `tools.rs` 用同名视图，无头版直接复用同一份实现。
    case "track":
      return JSON.stringify(
        trackPage(
          doc,
          revision,
          (args.trackId ?? args.track ?? args.ref) as string | number | undefined,
          args.offset,
          args.limit,
        ),
      );
    case "find_clips":
      return JSON.stringify(findClips(doc, revision, args as never));
    case "assets":
      return JSON.stringify(assetsPage(doc, revision, args as never));
    case "markers":
      return JSON.stringify(markers(doc, revision, args as never));
    default:
      throw new Error(`unknown view: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// 写操作（AI 产出物落位）
// ---------------------------------------------------------------------------

/**
 * 一次领域写操作。
 *
 * 为什么要这一层：AI 工具的模型推理已经下沉到 daemon（Rust），但"结果怎么接回
 * 时间线"（新建分轨、替换片段音频、落字幕轨、剪口落地）是**领域代码**，桌面端
 * 走的是 `core/aiActions` 里那批纯函数。把它们原样暴露给无头运行时，两个形态
 * 就复用同一份落位逻辑——不会出现"桌面替换片段、容器另开一轨"这种静默漂移。
 *
 * 约定：
 * - `args` 是 JSON 对象；`assets` 字段（可选）先登记素材，再执行落位；
 * - 整个操作是原子的：抛错时不改文档、`revision` 不变；
 * - 只改一次文档 → 只 +1 revision（对应桌面的一次 `dispatch`）。
 */
interface OpWire {
  ok: boolean;
  revision: number;
  changed: boolean;
  result?: unknown;
  error?: string;
}

function opFail(revisionNow: number, error: string): string {
  const wire: OpWire = { ok: false, revision: revisionNow, changed: false, error };
  return JSON.stringify(wire);
}

/** 偶数化（ffmpeg 要求偶数宽高）。 */
function evenSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 分轨的展示名：有译名就用译名（`audio.stem.vocals`），没有就用模型给的英文名。 */
function stemLabel(name: string): string {
  const key = `audio.stem.${name}`;
  const label = t(key);
  return label === key ? name : label;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requireClip(docIn: Project, clipId: string): { clip: Project["tracks"][number]["clips"][number] } {
  const found = findClip(docIn, clipId);
  if (!found) throw new Error(`片段不存在：${clipId}`);
  return found;
}

export function op(kind: string, argsJson: string): string {
  if (!doc) return opFail(revision, "project not loaded");

  let args: Record<string, unknown>;
  try {
    args = argsJson && argsJson !== "null" ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch (error) {
    return opFail(revision, `invalid op json: ${errorText(error)}`);
  }

  const before = doc;
  try {
    let next = before;
    // 1) 先登记素材（模型输出落盘后由 daemon 探测元数据）
    for (const asset of Array.isArray(args.assets) ? (args.assets as MediaAsset[]) : []) {
      next = addAsset(next, asset);
    }
    let result: unknown = null;
    // 新建工程要丢掉旧历史（撤销不应该撤回到上一个工程）。
    let dropHistory = false;

    switch (kind) {
      // 素材内字幕 → 时间线字幕：帧吸附与"超出片段窗口丢弃"都在这里，
      // 换语言/改工程帧率时两个形态的换算结果一致（只读，不改文档）。
      case "map_cues": {
        const cues = (args.cues ?? []) as { start: number; end: number; text: string }[];
        const clipArg = args.clipId;
        const clip =
          typeof clipArg === "string" && clipArg ? (findClip(next, clipArg)?.clip ?? null) : null;
        const fps = numberOr(args.fps, next.fps);
        result = {
          cues: cues
            .map((cue) => mapCueToTimeline(cue, clip, fps))
            .filter((cue): cue is { start: number; duration: number; text: string } => cue !== null),
        };
        break;
      }
      // 字幕 / 译文字幕：顶部新建字幕轨，一次事务写入全部 cue。
      case "subtitle_track": {
        const cues = (args.cues ?? []) as { start: number; duration: number; text: string }[];
        const known = new Set(next.tracks.map((track) => track.id));
        next = insertCueTrack(
          next,
          cues,
          String(args.baseName || t(String(args.defaultName || "ai.subtitleTrack"))),
        );
        const created = next.tracks.filter((track) => !known.has(track.id));
        result = {
          track: created[0]
            ? { id: created[0].id, name: created[0].name, clipCount: created[0].clips.length }
            : null,
          inserted: cues.filter((cue) => cue.text.trim().length > 0).length,
        };
        break;
      }
      // 降噪 / DSP：音频片段就地换素材，视频片段静音后另开一轨（桌面语义）。
      case "processed_audio": {
        const { clip } = requireClip(next, String(args.clipId ?? ""));
        const known = new Set(next.tracks.map((track) => track.id));
        next = applyProcessedAudio(
          next,
          clip,
          String(args.assetId ?? ""),
          numberOr(args.duration, 0),
          String(args.sourceKind ?? "audio") as AssetKind,
          String(args.trackName ?? "AI 处理"),
        );
        result = {
          clipId: clip.id,
          tracks: next.tracks
            .filter((track) => !known.has(track.id))
            .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length })),
        };
        break;
      }
      // 音源分离：在源轨道下方逐条新建分轨，源片段静音。
      case "stem_tracks": {
        const { clip } = requireClip(next, String(args.clipId ?? ""));
        const stems = ((args.stems ?? []) as {
          name: string;
          label?: string;
          assetId: string;
          duration: number;
        }[]).map((stem) => ({
          label: stem.label ?? stemLabel(stem.name),
          assetId: stem.assetId,
          duration: stem.duration,
        }));
        const known = new Set(next.tracks.map((track) => track.id));
        next = addStemTracks(
          next,
          clip,
          stems,
          String(args.baseName || t("audio.stemTrack")),
          args.muteSource !== false,
        );
        result = {
          tracks: next.tracks
            .filter((track) => !known.has(track.id))
            .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length })),
        };
        break;
      }
      // 视频 AI（超分 / 补帧 / 裁剪）：用新素材替换片段引用，入点归零。
      case "replace_video": {
        const { clip } = requireClip(next, String(args.clipId ?? ""));
        next = replaceClipVideo(
          next,
          clip.id,
          String(args.assetId ?? ""),
          numberOr(args.duration, 0),
          clip.duration,
        );
        result = { clipId: clip.id, assetId: String(args.assetId ?? "") };
        break;
      }
      // 朗读 / 译制配音：按文字片段起点落轨，重叠自动开新轨。
      case "voiceover": {
        const muteClipId = args.muteClipId;
        if (typeof muteClipId === "string" && muteClipId) {
          next = setClipMuted(next, muteClipId, true);
        }
        const items = (args.items ?? []) as {
          id: string;
          assetId: string;
          start: number;
          duration: number;
        }[];
        const known = new Set(next.tracks.map((track) => track.id));
        next = placeVoiceover(
          next,
          items,
          String(args.baseName || t(String(args.defaultName || "ai.voiceoverTrack"))),
        );
        result = {
          tracks: next.tracks
            .filter((track) => !known.has(track.id))
            .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length })),
        };
        break;
      }
      // 变声：原片段静音，结果按原起点落轨。
      case "converted_voice": {
        const items = (args.items ?? []) as { clipId: string; assetId: string; duration: number }[];
        const known = new Set(next.tracks.map((track) => track.id));
        next = placeConvertedVoice(next, items, String(args.baseName || t("ai.voiceChangeTrack")));
        result = {
          tracks: next.tracks
            .filter((track) => !known.has(track.id))
            .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length })),
        };
        break;
      }
      // 智能剪口播：检测 + 落地 + 重铺「口播字幕」轨，全在一个事务里。
      case "cut_filler": {
        const clipId = String(args.clipId ?? "");
        const { clip } = requireClip(next, clipId);
        const words = withWordIds(
          (args.words ?? []) as { text: string; start: number; end: number }[],
        );
        const options = (args.options ?? {}) as Record<string, unknown>;
        const existing = scopeOfClip(next, clipId);
        const taken = (existing?.cuts ?? []).map((cut) => ({
          srcStart: cut.srcStart,
          srcEnd: cut.srcEnd,
        }));
        const fillerCuts = padFillerCuts(
          detectFillers(words, {
            includeSoft: options.includeSoft !== false,
            custom: stringList(options.custom),
            disabled: stringList(options.disabled),
          }),
          words,
          { pad: numberOr(options.pad, DEFAULT_TRIM.pad) },
        );
        const proposals = mergeProposals(
          [
            fillerCuts,
            detectPauses(words, {
              minPause: numberOr(options.minPause, DEFAULT_PAUSE.minPause),
              keep: numberOr(options.pauseKeep, DEFAULT_PAUSE.keep),
              sentenceKeep: numberOr(options.sentenceKeep, DEFAULT_PAUSE.sentenceKeep),
            }),
          ],
          taken,
        );
        const removed = proposals.reduce(
          (sum, proposal) => sum + (proposal.srcEnd - proposal.srcStart),
          0,
        );
        const timed = args.timed !== false;
        const summary = {
          clipId: clip.id,
          aligned: timed,
          wordCount: words.length,
          cutCount: proposals.length,
          removedSeconds: Math.round(removed * 100) / 100,
          proposals: proposals.map((proposal) => ({
            kind: proposal.kind,
            start: proposal.srcStart,
            end: proposal.srcEnd,
            text: proposal.text,
            reason: proposal.reason,
          })),
        };
        if (args.dryRun === true || proposals.length === 0 || words.length === 0) {
          result = { ...summary, applied: false };
          break;
        }
        next = applyCuts(
          next,
          clipId,
          proposals.map((proposal) => ({
            kind: proposal.kind,
            srcStart: proposal.srcStart,
            srcEnd: proposal.srcEnd,
            text: proposal.text,
          })),
          words.map((word) => ({ text: word.text, start: word.start, end: word.end })),
          timed,
        );
        // 剪完把剩下的词落成「口播字幕」，改字去时间线上改。
        const scope = scopeOfClip(next, clipId);
        if (scope) {
          const cues = buildCutCues(
            scope,
            words,
            next.tracks.flatMap((track) => track.clips),
            next.fps,
          );
          next = placeCueTrack(next, cues, String(args.cueTrackName || t("cutReview.cueTrack")));
        }
        result = { ...summary, applied: true };
        break;
      }
      // 文案查表：无头侧不重复维护一份词典，轨道名 / 标签直接用桌面那份 i18n。
      case "translate_keys": {
        const keys = stringList(args.keys);
        result = { labels: Object.fromEntries(keys.map((key) => [key, t(key)])) };
        break;
      }
      // 响度统一：由测量结果算非破坏性增益，看得上再写回片段。
      case "apply_loudness": {
        const clipId = String(args.clipId ?? "");
        requireClip(next, clipId);
        const report = (args.report ?? {}) as {
          integrated_lufs: number | null;
          true_peak_dbtp: number | null;
        };
        const target = numberOr(args.targetLufs, -14);
        const gain = loudnessGain(report as never, target);
        const apply = args.apply === true && gain !== null;
        if (apply) next = setClipGain(next, clipId, gain);
        result = {
          integratedLufs: report.integrated_lufs,
          truePeakDbtp: report.true_peak_dbtp,
          targetLufs: target,
          suggestedGainDb: gain,
          applied: apply,
        };
        break;
      }
      // 拆音轨：视频片段静音，声音另起一条音轨（复用同一素材与入点）。
      case "extract_audio": {
        const clipId = String(args.clipId ?? "");
        const { clip } = requireClip(next, clipId);
        const kind = next.assets.find((asset) => asset.id === clip.assetId)?.kind;
        if (kind !== "video") throw new Error(`片段 ${clipId} 不是视频素材`);
        if (clip.audioOnly) throw new Error(`片段 ${clipId} 已经是纯音频片段`);
        if (!(clip.duration > 0)) throw new Error(`片段 ${clipId} 时长无效`);
        const known = new Set(next.tracks.map((track) => track.id));
        const extracted = extractClipAudio(
          next,
          clip,
          String(args.baseName || t("inspector.extractAudioTrack")),
        );
        next = extracted.doc;
        result = {
          clipId: extracted.clipId,
          trackId: extracted.trackId,
          tracks: next.tracks
            .filter((track) => !known.has(track.id))
            .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length })),
        };
        break;
      }
      // 导入字幕：SRT / VTT 文本 → 置顶文字轨（重叠自动拆轨）。
      case "place_subtitles": {
        const text = String(args.text ?? "");
        if (!text.trim()) throw new Error("字幕文件是空的");
        const entries = parseSubtitleText(text, String(args.path ?? ""));
        const baseName = String(args.baseName || t("ai.subtitleTrack"));
        const known = new Set(next.tracks.map((track) => track.id));
        next = placeSubtitleCues(next, entries, baseName, numberOr(args.offset, 0));
        result = {
          count: entries.length,
          tracks: next.tracks
            .filter((track) => !known.has(track.id))
            .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length })),
        };
        break;
      }
      // 导出字幕：文字片段 → SRT / VTT 文本（写盘由调用方做）。
      case "serialize_subtitles": {
        const trackRef = args.trackId as string | number | undefined;
        const tracks =
          trackRef === undefined || trackRef === null
            ? next.tracks
            : (() => {
                const track = resolveTrack(next, trackRef);
                return track ? [track] : [];
              })();
        const entries = tracks
          .flatMap((track) => track.clips)
          .map((clip) => ({
            start: clip.start,
            end: clip.start + clip.duration,
            text: (clip.text ?? "").trim(),
            subtitle: clip.assetId === "",
          }))
          .filter((entry) => entry.subtitle && entry.text.length > 0)
          .sort((left, right) => left.start - right.start || left.end - right.end);
        const format = args.format === "vtt" ? "vtt" : "srt";
        result = {
          format,
          count: entries.length,
          text: serializeSubtitles(entries, format),
        };
        break;
      }
      // 新建工程：与桌面 `project.new` 同一个 `makeProject` 默认值 + 可选出图规格。
      case "new_project": {
        const created = makeProject(
          typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined,
        );
        next = setProjectOutput(created, {
          ...(typeof args.width === "number" ? { width: args.width } : {}),
          ...(typeof args.height === "number" ? { height: args.height } : {}),
          ...(typeof args.fps === "number" ? { fps: args.fps } : {}),
        });
        dropHistory = true;
        result = { name: next.name, width: next.width, height: next.height, fps: next.fps };
        break;
      }
      // 编译导出计划：与桌面「导出按钮」走同一个 `buildExportPlan`，
      // ffmpeg 滤镜图只在这里生成一次，无头侧只负责执行。
      case "compile_export": {
        const outputPath = String(args.outputPath ?? "");
        if (!outputPath.trim()) throw new Error("compile_export 需要 outputPath");
        const raw = (args.options ?? {}) as Record<string, unknown>;
        const options: ExportOptions = {
          format: (raw.format === "prores" || raw.format === "gif" ? raw.format : "mp4") as ExportOptions["format"],
          resolution: (raw.resolution ?? "project") as ExportOptions["resolution"],
          width: typeof raw.width === "number" ? raw.width : null,
          height: typeof raw.height === "number" ? raw.height : null,
          fps: typeof raw.fps === "number" ? raw.fps : null,
          quality: (raw.quality ?? "high") as ExportOptions["quality"],
          fit: (raw.fit === "cover" ? "cover" : "contain") as ExportOptions["fit"],
          fitAnchor: (raw.fitAnchor ?? "center") as ExportOptions["fitAnchor"],
          gifColors: typeof raw.gifColors === "number" ? raw.gifColors : 256,
          gifDither: (raw.gifDither ?? "sierra2_4a") as ExportOptions["gifDither"],
          gifLoop: typeof raw.gifLoop === "number" ? raw.gifLoop : 0,
          audio: raw.audio !== false,
        };
        const window = args.window as { start?: number; end?: number } | undefined;
        const plan = buildExportPlan(
          next,
          options,
          new Map(),
          outputPath,
          new Map(),
          window && typeof window.start === "number" && typeof window.end === "number"
            ? { start: window.start, end: window.end }
            : undefined,
          new Map(),
        );
        let outputArgs = plan.outputArgs;
        const frameTime = typeof args.frameTime === "number" ? args.frameTime : null;
        if (frameTime !== null) {
          // 静帧：与 `core/export/frame.ts` 完全一致的输出参数（只 map 视频 + 单帧）。
          const mapIndex = outputArgs.indexOf("-map");
          const videoLabel = mapIndex >= 0 ? outputArgs[mapIndex + 1] : null;
          if (!videoLabel) throw new Error("导出计划里没有视频输出");
          if (!(frameTime >= 0 && frameTime <= plan.duration)) {
            throw new Error(t("export.frameTimeInvalid"));
          }
          const at = Math.min(frameTime, Math.max(0, plan.duration - 1 / plan.fps));
          outputArgs = [
            "-map",
            videoLabel,
            "-an",
            "-ss",
            String(at),
            "-frames:v",
            "1",
            "-update",
            "1",
            outputPath,
          ];
        }
        result = { ...plan, outputArgs };
        break;
      }
      // film.json 导入：解析 + 生成命令 + 逐条应用（一个撤销步）。
      case "film_import": {
        const text = String(args.text ?? "");
        const path = String(args.path ?? "");
        if (!text.trim()) throw new Error("film_import 需要 text");
        if (!path.trim()) throw new Error("film_import 需要 path");
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch (error) {
          throw new Error(`film.json 不是合法 JSON：${errorText(error)}`);
        }
        const parsed = parseFilmManifest(raw, path);
        const plan = buildManifestCommands(next, parsed, {
          mode: args.mode === "merge" ? "merge" : "replace",
          trackName: String(args.trackName || "Scenes"),
          assets: (Array.isArray(args.assets) ? args.assets : []) as never,
          baseRevision: revision + 1,
          actor: "agent",
          ...(typeof args.label === "string" ? { label: args.label } : {}),
          ...(args.conform === true ? { conform: true } : {}),
        });
        let working = next;
        let applied = 0;
        for (const command of plan.commands) {
          const step = applyCommandToDoc(working, {
            ...command,
            baseRevision: revision + applied + 1,
          });
          working = step.doc;
          applied += 1;
        }
        next = working;
        result = { ...plan.summary, applied, changed: next !== before };
        break;
      }
      // film.json 里的场次表（逐场渲染用）。
      case "manifest_scenes": {
        const path = String(args.path ?? "");
        if (!path.trim()) throw new Error("manifest_scenes 需要 path");
        let raw: unknown;
        try {
          raw = JSON.parse(String(args.text ?? "{}"));
        } catch (error) {
          throw new Error(`film.json 不是合法 JSON：${errorText(error)}`);
        }
        const parsed = parseFilmManifest(raw, path);
        result = {
          fps: parsed.manifest.fps ?? null,
          scenes: parsed.manifest.scenes.map((scene) => ({
            id: scene.id,
            start: scene.t0,
            end: scene.t1,
          })),
        };
        break;
      }
      // film.json 导出：把工程重建为 manifest（写盘由调用方做）。
      case "film_export": {
        const manifest = projectToManifest(next, {
          baseDir: String(args.baseDir || "."),
          previous: (args.previous ?? null) as Record<string, unknown> | null,
        });
        result = { manifest };
        break;
      }
      // 接触表版面：格子尺寸 / 行数 / xstack layout 字符串（与导出共用一份算法）。
      case "contact_layout": {
        const count = Math.max(1, Math.round(numberOr(args.count, 1)));
        const cols = Math.min(
          6,
          Math.max(1, Math.round(numberOr(args.cols, Math.ceil(Math.sqrt(count))))),
        );
        const cellWidth = evenSize(numberOr(args.cellWidth, 480), 480);
        const cellHeight = evenSize(Math.round((cellWidth * 9) / 16), 270);
        const rows = Math.ceil(count / cols);
        const layout = buildContactLayout(count, cols, cellWidth, cellHeight);
        result = { cols, rows, cellWidth, cellHeight, layout: layout.layout, total: cols * rows };
        break;
      }
      // SSIM 统计解析 + 变化点（低于阈值）；同一份解析器，不另写一份。
      case "parse_ssim": {
        const text = String(args.text ?? "");
        const fps = numberOr(args.fps, 30);
        const start = numberOr(args.start, 0);
        const summary = parseSsimStats(text, fps, start);
        const threshold = numberOr(args.threshold, 0.98);
        result = {
          ssim: { mean: summary.mean, min: summary.min, samples: summary.samples },
          changed: changedSamples(summary, threshold),
          frames: summary.frames.slice(0, 200),
        };
        break;
      }
      // 只登记素材（导入素材 / 模型输出的通用路径）。
      case "add_assets": {
        result = { assets: next.assets.length - before.assets.length };
        break;
      }
      default:
        return opFail(revision, `unknown op: ${kind}`);
    }

    if (next !== before) {
      if (dropHistory) {
        undoStack.length = 0;
        redoStack.length = 0;
      } else {
        remember(before);
      }
      doc = next;
      revision += 1;
    }
    const wire: OpWire = { ok: true, revision, changed: next !== before, result };
    return JSON.stringify(wire);
  } catch (error) {
    return opFail(revision, errorText(error));
  }
}

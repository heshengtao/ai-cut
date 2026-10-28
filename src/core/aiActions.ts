/**
 * AI 能力的可复用编排层。
 *
 * 界面（AiPane / InspectorPane）和智能体/MCP 都通过这里调用模型：
 * - 明确定位素材与片段（不依赖当前选中项）；
 * - 复用现有的回填函数，产出物以 `actor: "agent"` 进入撤销历史；
 * - 长任务由 mcpBridge 包成 job，Rust 侧轮询状态，避免 20 秒桥接超时。
 */
import type { AudioDspEffect, AudioDspPreset, ModelFeature, ModelStatus } from "@/types/models";
import { EXPORT_ANCHORS, GIF_DITHERS } from "@/types/export";
import type {
  ExportAnchor,
  ExportFit,
  ExportFormat,
  ExportQuality,
  ExportResolution,
  GifDither,
} from "@/types/export";
import type { DispatchMeta } from "@/types/events";
import type { Clip, MediaAsset, Project } from "@/types/project";
import type { VideoAiAspect, VideoAiSubject, VideoDspOptions } from "@/types/video";
import { audioExtractReference } from "@/core/audioAiApi";
import { addStemTracks, applyProcessedAudio, loudnessGain } from "@/core/audioEdit";
import { createClip } from "@/core/factory";
import { importAssetAt } from "@/core/media";
import { addAsset, addClip, addTrackAt, setClipGain, setClipMuted } from "@/core/ops";
import { mapCueToTimeline } from "@/core/subtitles";
import { replaceClipVideo } from "@/core/videoEdit";
import { placeVoiceover } from "@/core/voiceover";
import { useAsrStore } from "@/stores/asr";
import { asrTranscribeWords } from "@/core/modelApi";
import {
  detectFillers,
  detectPauses,
  mergeProposals,
  withWordIds,
} from "@/core/cutAnalysis";
import { applyCuts, scopeOfClip } from "@/core/cuts";
import { buildCutCues, placeCueTrack } from "@/core/cutSubtitles";
import { useAudioAiStore } from "@/stores/audioAi";
import { useExportStore } from "@/stores/export";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import { useTtsStore } from "@/stores/tts";
import { useVideoAiStore } from "@/stores/videoAi";
import { useVideoDspStore } from "@/stores/videoDsp";
import { t } from "@/i18n";

export interface JobContext {
  cancelled(): boolean;
  /** 触发这次 AI 任务的操作者；默认按外部 AI 处理。 */
  actor?: "human" | "agent";
  /** `chat` = 内置剪辑智能体，其余为外部 MCP 会话。 */
  sessionId?: string;
}

/** AI 产出物落盘时用的历史元数据：操作者与来源会话一路带到操作记录面板。 */
function jobMeta(ctx: JobContext, label: string): DispatchMeta {
  return {
    kind: "ui.dispatch",
    actor: ctx.actor ?? "agent",
    label,
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  };
}

export interface TrackRef {
  id: string;
  name: string;
  clipCount: number;
}

function project() {
  return useProjectStore();
}

/** AI 工具也会改工程；把新 revision 回给模型，下一步命令才不会因旧版本被拒。 */
function revision(): number {
  return project().revision;
}

function findClip(clipId: string): { clip: Clip; asset: MediaAsset | null } {
  for (const track of project().doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;
    const asset =
      clip.assetId === ""
        ? null
        : project().doc.assets.find((candidate) => candidate.id === clip.assetId) ?? null;
    return { clip, asset };
  }
  throw new Error(`片段不存在：${clipId}`);
}

function requireMediaClip(clipId: string): { clip: Clip; asset: MediaAsset } {
  const found = findClip(clipId);
  if (!found.asset) throw new Error(`片段 ${clipId} 没有关联素材`);
  if (found.asset.offline) throw new Error(`素材离线：${found.asset.name}`);
  if (!(found.clip.duration > 0)) throw new Error(`片段 ${clipId} 时长无效`);
  return { clip: found.clip, asset: found.asset };
}

function requireVideoClip(clipId: string): { clip: Clip; asset: MediaAsset } {
  const found = requireMediaClip(clipId);
  if (found.asset.kind !== "video") throw new Error(`片段 ${clipId} 不是视频素材`);
  if (found.clip.audioOnly) throw new Error(`片段 ${clipId} 是纯音频片段`);
  return found;
}

function findAsset(assetId: string): MediaAsset {
  const asset = project().doc.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new Error(`素材不存在：${assetId}`);
  if (asset.offline) throw new Error(`素材离线：${asset.name}`);
  return asset;
}

async function ensureCatalog(): Promise<void> {
  const models = useModelsStore();
  if (models.catalog.length === 0) await models.load();
}

async function pickInstalledModel(
  feature: ModelFeature,
  modelId: string | undefined,
  label: string,
): Promise<ModelStatus> {
  const models = useModelsStore();
  await ensureCatalog();

  let model: ModelStatus | null = null;
  if (modelId) {
    model = models.byId(modelId);
    if (!model) throw new Error(`未知模型：${modelId}`);
    if (model.feature !== feature) {
      throw new Error(`${model.name} 不是${label}模型（feature=${model.feature}）`);
    }
  } else {
    model = models.catalog.find((entry) => entry.feature === feature && entry.installed) ?? null;
    if (!model) {
      const options = models.catalog
        .filter((entry) => entry.feature === feature)
        .map((entry) => `${entry.id}（${entry.name}）`)
        .join("、");
      throw new Error(
        `没有已安装的${label}模型。先调用 download_model，或从这些 id 里选一个：${options || "清单为空"}`,
      );
    }
  }

  if (!model.installed) {
    throw new Error(`${label}模型尚未安装：${model.name}（${model.id}）。先调用 download_model。`);
  }
  return model;
}

async function requireInstalled(feature: ModelFeature, label: string): Promise<ModelStatus> {
  const models = useModelsStore();
  await ensureCatalog();
  const model = models.catalog.find((entry) => entry.feature === feature && entry.installed);
  if (!model) {
    const options = models.catalog
      .filter((entry) => entry.feature === feature)
      .map((entry) => `${entry.id}（${entry.name}）`)
      .join("、");
    throw new Error(
      `${label}模型尚未安装。先调用 download_model，可选：${options || "清单为空"}`,
    );
  }
  return model;
}

function stemLabel(name: string): string {
  const key = `audio.stem.${name}`;
  const label = t(key);
  return label === key ? name : label;
}

function uniqueTrackName(doc: Project, base: string): string {
  let name = base;
  let index = 2;
  while (doc.tracks.some((track) => track.name === name)) name = `${base} ${index++}`;
  return name;
}

function createdTracks(before: Project): TrackRef[] {
  const previous = new Set(before.tracks.map((track) => track.id));
  return project()
    .doc.tracks.filter((track) => !previous.has(track.id))
    .map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }));
}

function affectedClip(clipId: string): Clip | null {
  for (const track of project().doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

async function importAsset(path: string, name?: string): Promise<MediaAsset> {
  const asset = await importAssetAt(path);
  return name ? { ...asset, name } : asset;
}

/** 字幕 / 译文字幕：在时间线顶部新建一条轨道，一次事务写入全部 cue。 */
function insertCueTrack(
  cues: { start: number; duration: number; text: string }[],
  baseName: string,
  label: string,
  ctx: JobContext,
): TrackRef | null {
  if (cues.length === 0) return null;
  const before = project().doc;
  project().dispatch(
    (doc) => {
      const name = uniqueTrackName(doc, baseName);
      let next = addTrackAt(doc, 0, name);
      const trackId = next.tracks[0].id;
      for (const cue of cues) {
        next = addClip(
          next,
          trackId,
          createClip({
            assetId: "",
            trackId,
            start: cue.start,
            duration: cue.duration,
            text: cue.text,
          }),
        );
      }
      return next;
    },
    jobMeta(ctx, label),
  );
  return createdTracks(before)[0] ?? null;
}

// ---------------------------------------------------------------------------
// 字幕 / 翻译
// ---------------------------------------------------------------------------

export interface TranscribeParams {
  clipId?: string;
  assetId?: string;
  language?: string;
  modelId?: string;
  insertSubtitles?: boolean;
  trackName?: string;
}

export async function transcribe(params: TranscribeParams, ctx: JobContext) {
  const model = await pickInstalledModel("asr", params.modelId, "语音识别");
  await requireInstalled("vad", "语音检测");

  const source = params.clipId
    ? findClip(params.clipId)
    : params.assetId
      ? { clip: null, asset: findAsset(params.assetId) }
      : (() => {
          throw new Error("需要 clipId 或 assetId");
        })();
  if (!source.asset) throw new Error("转写目标没有关联素材");

  const asr = useAsrStore();
  const cues = await asr.generate(source.asset.src, model.id, params.language ?? "auto");
  if (ctx.cancelled()) throw new Error("已取消");

  const fps = project().doc.fps;
  const mapped = cues
    .map((cue) => mapCueToTimeline(cue, source.clip, fps))
    .filter((cue): cue is { start: number; duration: number; text: string } => cue !== null);

  const track =
    params.insertSubtitles === false
      ? null
      : insertCueTrack(
          mapped,
          params.trackName?.trim() || t("ai.subtitleTrack"),
          "生成字幕",
          ctx,
        );

  return {
    model: model.id,
    cueCount: cues.length,
    inserted: track?.clipCount ?? 0,
    track,
    revision: revision(),
  };
}

const TRANSLATE_PROMPTS: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
};

export interface TranslateParams {
  clipId: string;
  target: string;
  dub?: boolean;
  asrModelId?: string;
  ttsModelId?: string;
  providerId?: string;
  voiceId?: string;
}

export async function translate(params: TranslateParams, ctx: JobContext) {
  const { clip, asset } = requireMediaClip(params.clipId);
  const asrModel = await pickInstalledModel("asr", params.asrModelId, "语音识别");
  await requireInstalled("vad", "语音检测");

  const prompt = TRANSLATE_PROMPTS[params.target] ?? params.target;
  const asr = useAsrStore();
  const audioAi = useAudioAiStore();
  const tts = useTtsStore();

  const cues = await asr.generate(asset.src, asrModel.id, "auto");
  if (ctx.cancelled()) throw new Error("已取消");

  const fps = project().doc.fps;
  const mapped = cues
    .map((cue) => mapCueToTimeline(cue, clip, fps))
    .filter((cue): cue is { start: number; duration: number; text: string } => cue !== null);
  if (mapped.length === 0) return { cueCount: 0, translated: 0, track: null, dubbed: 0 };

  const translated = await audioAi.translate(
    mapped.map((cue) => cue.text),
    prompt,
  );
  if (translated.length !== mapped.length) {
    throw new Error(`翻译结果数量不匹配：${translated.length} ≠ ${mapped.length}`);
  }
  if (ctx.cancelled()) throw new Error("已取消");

  const track = insertCueTrack(
    mapped.map((cue, index) => ({ ...cue, text: translated[index] })),
    t("audio.translatedSubtitleTrack"),
    "翻译音频",
    ctx,
  );

  let dubbed = 0;
  if (params.dub) {
    let providerId = params.providerId;
    let localModel: ModelStatus | null = null;
    if (!providerId) {
      localModel = await pickInstalledModel("tts", params.ttsModelId, "语音合成");
      if (localModel.family === "moss_tts_nano") await requireInstalled("tts-codec", "语音编解码");
    }
    if (localModel) await tts.watch();

    const referenceText = mapped
      .filter((cue) => cue.start - clip.start < 10)
      .map((cue) => cue.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    let referencePath: string | null = null;
    if (referenceText) {
      const reference = await audioExtractReference(
        asset.src,
        clip.in ?? 0,
        Math.min(clip.duration, 10),
      );
      referencePath = reference.path;
    }

    const items = translated.map((text, index) => ({ id: String(index), text }));
    const audios = providerId
      ? await tts.synthesizeCloud(providerId, items, params.voiceId ?? null)
      : await tts.synthesize(
          localModel!.id,
          items,
          null,
          referencePath,
          referenceText || null,
        );
    if (ctx.cancelled()) throw new Error("已取消");

    const imported: { audio: (typeof audios)[number]; asset: MediaAsset }[] = [];
    for (const audio of audios) {
      imported.push({ audio, asset: await importAsset(audio.path) });
    }
    const before = project().doc;
    project().dispatch(
      (doc) => {
        let next = doc;
        for (const item of imported) next = addAsset(next, item.asset);
        next = setClipMuted(next, clip.id, true);
        return placeVoiceover(
          next,
          imported.map(({ audio, asset: generated }) => ({
            id: audio.id,
            assetId: generated.id,
            start: mapped[Number(audio.id)]?.start ?? clip.start,
            duration: audio.duration,
          })),
          t("audio.dubTrack"),
        );
      },
      jobMeta(ctx, "译制配音"),
    );
    dubbed = imported.length;
    return {
      cueCount: cues.length,
      translated: translated.length,
      track,
      dubbed,
      tracks: createdTracks(before),
      revision: revision(),
    };
  }

  return {
    cueCount: cues.length,
    translated: translated.length,
    track,
    dubbed: 0,
    revision: revision(),
  };
}

// ---------------------------------------------------------------------------
// 音频 AI
// ---------------------------------------------------------------------------

export interface SeparateParams {
  clipId: string;
  modelId?: string;
}

export async function separate(params: SeparateParams, ctx: JobContext) {
  const { clip, asset } = requireMediaClip(params.clipId);
  const model = await pickInstalledModel("separate", params.modelId, "音源分离");
  const audioAi = useAudioAiStore();

  const stems = await audioAi.separate(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    model.id,
  );
  if (ctx.cancelled()) throw new Error("已取消");

  const imported: { name: string; asset: MediaAsset; duration: number }[] = [];
  for (const stem of stems) {
    imported.push({
      name: stem.name,
      asset: await importAsset(stem.path),
      duration: stem.duration,
    });
  }

  const before = project().doc;
  project().dispatch(
    (doc) => {
      let next = doc;
      for (const item of imported) next = addAsset(next, item.asset);
      return addStemTracks(
        next,
        clip,
        imported.map((item) => ({
          label: stemLabel(item.name),
          assetId: item.asset.id,
          duration: item.duration,
        })),
        t("audio.stemTrack"),
        true,
      );
    },
    jobMeta(ctx, "人声分离"),
  );

  return {
    model: model.id,
    stems: imported.map((item) => ({ name: item.name, assetId: item.asset.id })),
    tracks: createdTracks(before),
    revision: revision(),
  };
}

export interface DenoiseParams {
  clipId: string;
  modelId?: string;
}

export async function denoise(params: DenoiseParams, ctx: JobContext) {
  const { clip, asset } = requireMediaClip(params.clipId);
  const model = await pickInstalledModel("enhance", params.modelId, "音频降噪");
  const audioAi = useAudioAiStore();

  const result = await audioAi.denoise(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    model.id,
  );
  if (ctx.cancelled()) throw new Error("已取消");

  const generated = await importAsset(result.path);
  const before = project().doc;
  project().dispatch(
    (doc) => {
      const withAsset = addAsset(doc, generated);
      return applyProcessedAudio(
        withAsset,
        clip,
        generated.id,
        result.duration,
        asset.kind,
        t("audio.aiDenoiseTrack"),
      );
    },
    jobMeta(ctx, "AI 降噪"),
  );

  return {
    model: model.id,
    assetId: generated.id,
    duration: result.duration,
    tracks: createdTracks(before),
    clipAssetId: affectedClip(clip.id)?.assetId ?? null,
    revision: revision(),
  };
}

export interface ProcessAudioParams {
  clipId: string;
  effect: AudioDspEffect;
  preset: AudioDspPreset;
}

export async function processAudio(params: ProcessAudioParams, ctx: JobContext) {
  const { clip, asset } = requireMediaClip(params.clipId);
  const audioAi = useAudioAiStore();
  const result = await audioAi.dsp(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    params.effect,
    params.preset,
  );
  if (ctx.cancelled()) throw new Error("已取消");

  const generated = await importAsset(result.path);
  const before = project().doc;
  project().dispatch(
    (doc) => {
      const withAsset = addAsset(doc, generated);
      return applyProcessedAudio(
        withAsset,
        clip,
        generated.id,
        result.duration,
        asset.kind,
        params.effect === "denoise"
          ? t("audio.aiDenoiseTrack")
          : t("audio.beautifyTrack", { preset: params.preset }),
      );
    },
    jobMeta(ctx, "音频处理"),
  );

  return {
    assetId: generated.id,
    duration: result.duration,
    tracks: createdTracks(before),
    revision: revision(),
  };
}

export interface LoudnessParams {
  clipId: string;
  targetLufs?: number;
  apply?: boolean;
}

export async function measureLoudness(params: LoudnessParams, ctx: JobContext) {
  const { clip, asset } = requireMediaClip(params.clipId);
  const audioAi = useAudioAiStore();
  const report = await audioAi.loudness(asset.src, clip.in ?? 0, clip.duration);
  const target = Number.isFinite(params.targetLufs) ? Number(params.targetLufs) : -14;
  const gain = loudnessGain(report, target);

  if (params.apply && gain !== null) {
    project().dispatch(
      (doc) => setClipGain(doc, clip.id, gain),
      jobMeta(ctx, "响度统一"),
    );
  }

  return {
    integratedLufs: report.integrated_lufs,
    truePeakDbtp: report.true_peak_dbtp,
    targetLufs: target,
    suggestedGainDb: gain,
    applied: Boolean(params.apply && gain !== null),
    revision: revision(),
  };
}

// ---------------------------------------------------------------------------
// 语音合成
// ---------------------------------------------------------------------------

export interface VoiceoverParams {
  clipIds?: string[];
  text?: string;
  start?: number;
  modelId?: string;
  providerId?: string;
  voiceId?: string;
  referenceAssetId?: string;
  referenceText?: string;
}

export async function synthesizeVoiceover(params: VoiceoverParams, ctx: JobContext) {
  const tts = useTtsStore();
  let items: { id: string; text: string }[] = [];
  let starts = new Map<string, number>();

  if (params.clipIds && params.clipIds.length > 0) {
    const clips = params.clipIds
      .map((id) => findClip(id))
      .filter((found) => found.clip.assetId === "" && (found.clip.text ?? "").trim() !== "")
      .map((found) => found.clip)
      .sort((a, b) => a.start - b.start);
    if (clips.length === 0) throw new Error("给定的 clipIds 里没有可朗读的文字片段");
    items = clips.map((clip) => ({ id: clip.id, text: (clip.text ?? "").trim() }));
    starts = new Map(clips.map((clip) => [clip.id, clip.start]));
  } else if (params.text && params.text.trim()) {
    items = [{ id: "0", text: params.text.trim() }];
    starts = new Map([["0", params.start ?? 0]]);
  } else {
    throw new Error("需要 text，或包含文字的 clipIds");
  }

  let providerId = params.providerId;
  let localModel: ModelStatus | null = null;
  if (providerId) {
    await tts.loadProviders(true);
    if (!tts.providers.some((provider) => provider.id === providerId && provider.enabled)) {
      throw new Error(`云端 TTS 服务不可用：${providerId}`);
    }
  } else {
    localModel = await pickInstalledModel("tts", params.modelId, "语音合成");
    if (localModel.family === "moss_tts_nano") {
      await requireInstalled("tts-codec", "语音编解码");
    }
  }

  let referencePath: string | null = null;
  let referenceText: string | null = params.referenceText?.trim() || null;
  if (params.referenceAssetId) {
    const asset = findAsset(params.referenceAssetId);
    referencePath = asset.src;
    if (localModel?.family === "zipvoice" && !referenceText) {
      const asrModel = await pickInstalledModel("asr", undefined, "语音识别");
      await requireInstalled("vad", "语音检测");
      const cues = await useAsrStore().generate(asset.src, asrModel.id, "auto");
      referenceText =
        cues
          .map((cue) => cue.text.trim())
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim() || null;
    }
  }

  const audios = providerId
    ? await tts.synthesizeCloud(providerId, items, params.voiceId ?? null)
    : await tts.synthesize(
        localModel!.id,
        items,
        params.referenceAssetId ? null : params.voiceId ?? null,
        referencePath,
        referenceText,
      );
  if (ctx.cancelled()) throw new Error("已取消");
  if (audios.length === 0) throw new Error("语音合成没有产出音频");

  const imported: { audio: (typeof audios)[number]; asset: MediaAsset }[] = [];
  for (const audio of audios) {
    const text = items.find((item) => item.id === audio.id)?.text ?? "";
    imported.push({
      audio,
      asset: await importAsset(audio.path, text ? text.slice(0, 30) : undefined),
    });
  }

  const before = project().doc;
  project().dispatch(
    (doc) => {
      let next = doc;
      for (const item of imported) next = addAsset(next, item.asset);
      return placeVoiceover(
        next,
        imported.map(({ audio, asset }) => ({
          id: audio.id,
          assetId: asset.id,
          start: starts.get(audio.id) ?? 0,
          duration: audio.duration,
        })),
        t("ai.voiceoverTrack"),
      );
    },
    jobMeta(ctx, "AI 朗读"),
  );

  return {
    count: imported.length,
    assets: imported.map((item) => ({ assetId: item.asset.id, duration: item.audio.duration })),
    tracks: createdTracks(before),
    revision: revision(),
  };
}

// ---------------------------------------------------------------------------
// 视频 AI
// ---------------------------------------------------------------------------

async function replaceVideoWith(
  clipId: string,
  result: { path: string; duration: number },
  label: string,
  sourceName: string,
  ctx: JobContext,
) {
  const generated = await importAsset(result.path, `${sourceName} · ${label}`);
  const clipDuration = findClip(clipId).clip.duration;
  const before = project().doc;
  project().dispatch(
    (doc) => {
      const withAsset = addAsset(doc, generated);
      return replaceClipVideo(withAsset, clipId, generated.id, result.duration, clipDuration);
    },
    jobMeta(ctx, label),
  );
  return {
    assetId: generated.id,
    duration: result.duration,
    clipAssetId: affectedClip(clipId)?.assetId ?? null,
    tracks: createdTracks(before),
    revision: revision(),
  };
}

export interface UpscaleParams {
  clipId: string;
  modelId?: string;
  scale?: number;
}

export async function upscale(params: UpscaleParams, ctx: JobContext) {
  const { clip, asset } = requireVideoClip(params.clipId);
  const model = await pickInstalledModel("superres", params.modelId, "视频超分");
  const videoAi = useVideoAiStore();
  const result = await videoAi.upscale(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    asset.fps ?? project().doc.fps,
    model.id,
    params.scale === 4 ? 4 : 2,
  );
  if (ctx.cancelled()) throw new Error("已取消");
  return replaceVideoWith(params.clipId, result, t("videoAi.upscale"), asset.name, ctx);
}

export interface InterpolateParams {
  clipId: string;
  modelId?: string;
  factor?: number;
}

export async function interpolate(params: InterpolateParams, ctx: JobContext) {
  const { clip, asset } = requireVideoClip(params.clipId);
  const model = await pickInstalledModel("interpolate", params.modelId, "视频补帧");
  const videoAi = useVideoAiStore();
  const result = await videoAi.interpolate(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    asset.fps ?? project().doc.fps,
    model.id,
    params.factor === 4 ? 4 : 2,
  );
  if (ctx.cancelled()) throw new Error("已取消");
  return replaceVideoWith(params.clipId, result, t("videoAi.interpolate"), asset.name, ctx);
}

export interface ReframeParams {
  clipId: string;
  mode?: "crop" | "track";
  subject?: VideoAiSubject;
  aspect?: VideoAiAspect;
  height?: number;
  smooth?: number;
}

export async function reframe(params: ReframeParams, ctx: JobContext) {
  const { clip, asset } = requireVideoClip(params.clipId);
  const subject = params.subject ?? (params.mode === "track" ? "person" : "face");
  const aspect = params.aspect ?? "9:16";
  const height = Math.round(params.height ?? 1080);
  const smooth = params.smooth ?? 0.6;

  let trackModelId: string | null = null;
  let faceModelId: string | null = null;
  if (subject === "person" || subject === "auto") {
    trackModelId = (await pickInstalledModel("track", undefined, "人物检测")).id;
  }
  if (subject === "face" || subject === "auto") {
    faceModelId = (await pickInstalledModel("reframe", undefined, "人脸检测")).id;
  }

  const videoAi = useVideoAiStore();
  const result = await videoAi.reframe(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    asset.fps ?? project().doc.fps,
    trackModelId,
    faceModelId,
    subject,
    aspect,
    height,
    smooth,
  );
  if (ctx.cancelled()) throw new Error("已取消");
  const label = params.mode === "track" ? t("videoAi.track") : t("videoAi.crop");
  return replaceVideoWith(params.clipId, result, label, asset.name, ctx);
}

const VIDEO_DSP_LABEL = "视频处理";

export interface ProcessVideoParams {
  clipId: string;
  options: VideoDspOptions;
}

export async function processVideo(params: ProcessVideoParams, ctx: JobContext) {
  const { clip, asset } = requireVideoClip(params.clipId);
  const options = params.options ?? {};
  const enabled =
    options.stabilize ||
    options.denoise ||
    options.deflicker ||
    (options.motionBlur ?? 0) > 0 ||
    (options.upscale ?? 1) > 1;
  if (!enabled) throw new Error("options 里至少要启用一项视频处理");

  const videoDsp = useVideoDspStore();
  const result = await videoDsp.process(
    asset.src,
    clip.in ?? 0,
    clip.duration,
    asset.fps ?? project().doc.fps,
    options,
  );
  if (ctx.cancelled()) throw new Error("已取消");
  return replaceVideoWith(params.clipId, result, VIDEO_DSP_LABEL, asset.name, ctx);
}

// ---------------------------------------------------------------------------
// 导出 / 模型
// ---------------------------------------------------------------------------

export interface ExportParams {
  outputPath: string;
  format?: ExportFormat;
  resolution?: ExportResolution;
  width?: number | null;
  height?: number | null;
  fit?: ExportFit;
  fitAnchor?: ExportAnchor;
  fps?: number | null;
  quality?: ExportQuality;
  gif?: {
    colors?: number;
    dither?: GifDither;
    loop?: number;
  };
}

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  mp4: "mp4",
  prores: "mov",
  gif: "gif",
};

const EXPORT_FORMATS: ExportFormat[] = ["mp4", "prores", "gif"];
const EXPORT_RESOLUTIONS: ExportResolution[] = ["project", "1080p", "720p", "custom"];
const EXPORT_FITS: ExportFit[] = ["contain", "cover"];

function pathExtension(path: string): string | undefined {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

function inferExportFormat(path: string): ExportFormat | undefined {
  const extension = pathExtension(path);
  if (!extension) return undefined;
  return (Object.keys(EXPORT_EXTENSIONS) as ExportFormat[]).find(
    (format) => EXPORT_EXTENSIONS[format] === extension,
  );
}

export async function exportVideo(params: ExportParams, ctx: JobContext) {
  if (!params.outputPath?.trim()) throw new Error("需要 outputPath（绝对路径）");
  const store = useExportStore();
  const extension = pathExtension(params.outputPath);
  const inferred = inferExportFormat(params.outputPath);

  // MCP 的 JSON schema 只是提示，这里再兜一层运行时校验。
  if (params.format && !EXPORT_FORMATS.includes(params.format)) {
    throw new Error(`不支持的导出格式：${params.format}`);
  }
  if (params.resolution && !EXPORT_RESOLUTIONS.includes(params.resolution)) {
    throw new Error(`不支持的分辨率模式：${params.resolution}`);
  }
  if (params.fit && !EXPORT_FITS.includes(params.fit)) {
    throw new Error(`不支持的画面适配：${params.fit}`);
  }
  if (params.fitAnchor && !EXPORT_ANCHORS.includes(params.fitAnchor)) {
    throw new Error(`不支持的裁切锚点：${params.fitAnchor}`);
  }

  // 省略 format 时按扩展名推断，避免把 MP4 字节写进 .gif。
  if (params.format) {
    if (extension && extension !== EXPORT_EXTENSIONS[params.format]) {
      throw new Error(
        `格式与扩展名不匹配：${params.format} 需要 .${EXPORT_EXTENSIONS[params.format]}`,
      );
    }
    store.options.format = params.format;
  } else if (inferred) {
    store.options.format = inferred;
  }

  // 从 MP4 切到 GIF 时不要把 60fps 一起带过来，否则体积会失控。
  if (store.options.format === "gif" && (store.options.fps ?? 0) > 30) {
    store.options.fps = null;
  }

  if (params.width != null && (!Number.isFinite(params.width) || params.width <= 0)) {
    throw new Error("width 必须是正数");
  }
  if (params.height != null && (!Number.isFinite(params.height) || params.height <= 0)) {
    throw new Error("height 必须是正数");
  }

  if (params.resolution) store.options.resolution = params.resolution;
  if (params.width != null || params.height != null) {
    store.options.resolution = "custom";
  }
  if (params.width != null) store.options.width = params.width;
  if (params.height != null) store.options.height = params.height;
  if (params.fit) store.options.fit = params.fit;
  if (params.fitAnchor) store.options.fitAnchor = params.fitAnchor;
  if (params.fps !== undefined) store.options.fps = params.fps;
  if (params.quality) store.options.quality = params.quality;
  if (params.gif) {
    if (params.gif.colors !== undefined) {
      if (!Number.isFinite(params.gif.colors)) throw new Error("gif.colors 必须是数字");
      store.options.gifColors = Math.min(256, Math.max(2, Math.round(params.gif.colors)));
    }
    if (params.gif.dither !== undefined) {
      if (!GIF_DITHERS.includes(params.gif.dither)) {
        throw new Error(`不支持的 GIF 抖动：${params.gif.dither}`);
      }
      store.options.gifDither = params.gif.dither;
    }
    if (params.gif.loop !== undefined) {
      if (!Number.isFinite(params.gif.loop)) throw new Error("gif.loop 必须是数字");
      store.options.gifLoop = Math.max(-1, Math.round(params.gif.loop));
    }
  }

  const path = await store.start(params.outputPath);
  if (ctx.cancelled()) throw new Error("已取消");
  if (!path) {
    throw new Error(store.status === "idle" ? "已取消" : store.errorMessage || "导出失败");
  }
  const spec = store.outputSpec;
  return {
    path,
    duration: store.duration,
    warnings: store.warnings,
    format: store.options.format,
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    fit: store.options.fit,
    fitAnchor: store.options.fitAnchor,
  };
}

export async function listAiModels(params: { feature?: string }) {
  const models = useModelsStore();
  await ensureCatalog();
  return models.catalog
    .filter((model) => !params.feature || model.feature === params.feature)
    .map((model) => ({
      id: model.id,
      name: model.name,
      feature: model.feature,
      family: model.family,
      installed: model.installed,
      recommended: model.recommended,
      approxBytes: model.approx_bytes,
    }));
}

export async function downloadModel(params: { id: string }, ctx: JobContext) {
  const models = useModelsStore();
  await ensureCatalog();
  const model = models.byId(params.id);
  if (!model) throw new Error(`未知模型：${params.id}`);
  if (model.installed) return { id: model.id, installed: true };
  if (models.busyId !== null) throw new Error(`已有模型正在下载：${models.busyId}`);
  models.watchProgress();
  await models.download(model.id);
  if (ctx.cancelled()) throw new Error("已取消");
  return { id: model.id, installed: models.byId(model.id)?.installed ?? false };
}

export interface CutFillerParams {
  clipId?: string;
  assetId?: string;
  modelId?: string;
  /** 长停顿阈值（秒），默认 0.8。 */
  minPause?: number;
  /** 是否也剪「那个 / 就是」这类软口癖，默认 true。 */
  includeSoft?: boolean;
  /** 只返回建议、不改时间线。 */
  dryRun?: boolean;
}

/**
 * 智能剪口播：ASR 出文本 → 强制对齐器出词级时间 → 本地检测口癖/停顿 → 落成剪口。
 *
 * 对齐器是必选：没有它就只有估算时间，剪口会偏，所以直接拒绝执行。
 */
export async function cutFillerWords(params: CutFillerParams, ctx: JobContext) {
  const models = useModelsStore();
  await ensureCatalog();
  const model = await pickInstalledModel("asr", params.modelId, "语音识别");
  const aligner = models.byId("qwen3-aligner-0.6b-q4");
  if (!aligner?.installed) {
    throw new Error("剪口播需要强制对齐器：请先下载「Qwen3 强制对齐器」");
  }

  let clipId: string;
  let asset: MediaAsset;
  if (params.clipId) {
    const found = requireMediaClip(params.clipId);
    clipId = found.clip.id;
    asset = found.asset;
  } else if (params.assetId) {
    asset = findAsset(params.assetId);
    const clip = project()
      .doc.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.assetId === asset.id);
    if (!clip) throw new Error("素材还没有放到时间线上：先 append_clip");
    clipId = clip.id;
  } else {
    throw new Error("需要 clipId 或 assetId");
  }

  const result = await asrTranscribeWords(asset.src, model.id);
  if (ctx.cancelled()) throw new Error("已取消");

  const words = withWordIds(result.words);
  const existing = scopeOfClip(project().doc, clipId);
  const taken = (existing?.cuts ?? []).map((cut) => ({
    srcStart: cut.srcStart,
    srcEnd: cut.srcEnd,
  }));
  const proposals = mergeProposals(
    [
      detectFillers(words, { includeSoft: params.includeSoft ?? true }),
      detectPauses(words, { minPause: params.minPause ?? 0.8 }),
    ],
    taken,
  );

  const removed = proposals.reduce(
    (sum, proposal) => sum + (proposal.srcEnd - proposal.srcStart),
    0,
  );
  const summary = {
    model: model.id,
    aligned: result.timed,
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
  if (params.dryRun || proposals.length === 0 || words.length === 0) {
    return { ...summary, applied: false, revision: revision() };
  }

  project().dispatch(
    (doc) => {
      const cutDoc = applyCuts(
        doc,
        clipId,
        proposals.map((proposal) => ({
          kind: proposal.kind,
          srcStart: proposal.srcStart,
          srcEnd: proposal.srcEnd,
          text: proposal.text,
        })),
        words.map((word) => ({ text: word.text, start: word.start, end: word.end })),
        result.timed,
      );
      // 剪完把剩下的词落成「口播字幕」，改字去时间线上改。
      const scope = scopeOfClip(cutDoc, clipId);
      if (!scope) return cutDoc;
      const cues = buildCutCues(
        scope,
        words,
        cutDoc.tracks.flatMap((track) => track.clips),
        cutDoc.fps,
      );
      return placeCueTrack(cutDoc, cues, t("cutReview.cueTrack"));
    },
    jobMeta(ctx, t("cutReview.commandLabel", { count: proposals.length })),
  );

  return { ...summary, applied: true, revision: revision() };
}

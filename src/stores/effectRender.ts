/**
 * OFX 效果的整段预渲染（手动触发）。
 *
 * 逐帧实时渲染太慢（1080p 一帧几十到几百毫秒），所以**不在加特效时自动开烤**：
 * 用户在特效面板点「预渲染」后，才把这个片段按当前效果链烘焙成预览文件，
 * 完成后预览（含播放）直接用缓存文件当源。
 *
 * 参数 / 素材一变，旧结果立即作废（不能拿旧效果冒充新效果）；如果磁盘上已有
 * 同签名的缓存，会直接恢复成可用结果，不用重烤。
 */
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Clip, MediaAsset, Project } from "@/types/project";
import type { OfxEffectSpec } from "@/types/plugins";
import { clipEffectSpecs, clipHasEffects } from "@/core/effects";
import { isVisible } from "@/core/playback/activeClips";
import { cacheFilePath, pathExists } from "@/core/media";
import {
  ofxBakeClip,
  ofxBakeImage,
  ofxCancelBake,
  onOfxBakeProgress,
} from "@/core/ofxApi";
import { stableHash } from "@/utils/hash";
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { isTauri } from "@/utils/platform";
import { t } from "@/i18n";

export type EffectRenderStatus = "queued" | "rendering" | "ready" | "error";

export interface EffectRenderJob {
  clipId: string;
  signature: string;
  output: string;
  status: EffectRenderStatus;
  done: number;
  total: number;
  error: string | null;
  /** 最近一次状态 / 进度更新的时间，UI 用来判断“是不是卡住了”。 */
  updatedAt: number;
}

/** 预览烘焙的长边上限：画布上显示不到这个尺寸，按工程分辨率烤太浪费。 */
const PREVIEW_MAX_EDGE = 1280;
/** 文档变化后稍等再对齐队列：拖动参数时不要每个 input 都去查缓存文件。 */
const SYNC_DEBOUNCE_MS = 150;
/** 渲染中这么久没有一帧进度，就认为插件卡死（有些插件在预览尺寸下会假死）。 */
const STALL_TIMEOUT_MS = 120_000;

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 等比缩到预览尺寸（H.264 yuv420p 要求偶数边长）。 */
function previewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** 图片按自身画幅烘焙，避免把 4:3 图片塞进 16:9 画布后多出黑边。 */
function imagePreviewSize(asset: MediaAsset): { width: number; height: number } {
  const width = asset.width && asset.width > 0 ? asset.width : 1920;
  const height = asset.height && asset.height > 0 ? asset.height : 1080;
  return previewSize(width, height);
}

/** 参数对象的键顺序不稳定，先排序再参与哈希。 */
function canonicalSpecs(effects: OfxEffectSpec[]): unknown {
  return effects.map((effect) => ({
    bundle: effect.bundle,
    plugin: effect.plugin,
    context: effect.context ?? "",
    params: Object.entries(effect.params ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  }));
}

function signatureFor(project: Project, clip: Clip): string {
  const asset = project.assets.find((item) => item.id === clip.assetId);
  const size =
    asset?.kind === "image"
      ? imagePreviewSize(asset)
      : previewSize(project.width, project.height);
  return stableHash(
    JSON.stringify({
      clip: clip.id,
      source: asset?.src ?? "",
      sourceWidth: asset?.width ?? 0,
      sourceHeight: asset?.height ?? 0,
      in: clip.in ?? 0,
      duration: clip.duration,
      speed: clip.speed ?? 1,
      width: size.width,
      height: size.height,
      fps: project.fps,
      effects: canonicalSpecs(clipEffectSpecs(clip)),
    }),
  );
}

function findClip(project: Project, clipId: string): Clip | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return clip;
  }
  return null;
}

/** 能进 OFX 烘焙的片段：视频 / 图片、有素材、有启用中的效果。 */
function eligibleAsset(project: Project, clip: Clip): MediaAsset | null {
  if (!(clip.duration > 0) || clip.audioOnly || !clipHasEffects(clip)) return null;
  const asset = project.assets.find((item) => item.id === clip.assetId);
  if (!asset || asset.offline) return null;
  if (asset.kind !== "video" && asset.kind !== "image") return null;
  return asset;
}

export const useEffectRenderStore = defineStore("effectRender", () => {
  const project = useProjectStore();
  const jobs = ref<Record<string, EffectRenderJob>>({});
  /** 任意片段的预渲染完成时递增，播放引擎据此换源。 */
  const revision = ref(0);

  let running = false;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncToken = 0;
  let listening = false;

  const pendingJobs = computed(() =>
    Object.values(jobs.value).filter(
      (job) => job.status === "queued" || job.status === "rendering",
    ),
  );

  const rendering = computed(() => pendingJobs.value.length > 0);

  const progress = computed<{ done: number; total: number; pct: number } | null>(() => {
    const list = pendingJobs.value;
    if (list.length === 0) return null;
    const total = list.reduce((sum, job) => sum + Math.max(job.total, 0), 0);
    const done = list.reduce((sum, job) => sum + Math.max(job.done, 0), 0);
    if (total <= 0) return { done, total: 0, pct: 0 };
    return { done, total, pct: Math.min(100, Math.round((done / total) * 100)) };
  });

  const failed = computed<EffectRenderJob | null>(
    () => Object.values(jobs.value).find((job) => job.status === "error") ?? null,
  );

  function jobFor(clipId: string | null | undefined): EffectRenderJob | null {
    if (!clipId) return null;
    return jobs.value[clipId] ?? null;
  }

  /** 已烘焙完成的预览文件；播放引擎用它替换素材源。 */
  function sourceFor(clipId: string): string | null {
    const job = jobs.value[clipId];
    return job?.status === "ready" ? job.output : null;
  }

  /** 已就绪的源快照：用来判断引擎是否需要换源。 */
  function readyKey(jobs: Record<string, EffectRenderJob>): string {
    return Object.values(jobs)
      .filter((job) => job.status === "ready")
      .map((job) => `${job.clipId}:${job.output}`)
      .sort()
      .join("|");
  }

  function listenProgress(): void {
    if (listening || !isTauri()) return;
    listening = true;
    void onOfxBakeProgress((payload) => {
      if (!payload.id) return;
      const job = jobs.value[payload.id];
      if (!job || job.status !== "rendering") return;
      job.done = payload.done;
      if (payload.total > 0) job.total = payload.total;
      job.updatedAt = Date.now();
    });
  }

  /**
   * 插件假死时给出明确错误：某些插件在预览尺寸下会一直不返回帧，
   * 不能让它永远停在「渲染中 0%」。
   */
  function watchStalls(): void {
    if (!isTauri()) return;
    setInterval(() => {
      const now = Date.now();
      for (const job of Object.values(jobs.value)) {
        if (job.status !== "rendering") continue;
        if (now - job.updatedAt < STALL_TIMEOUT_MS) continue;
        void ofxCancelBake(job.clipId);
        job.status = "error";
        job.error = t("effects.renderStalled");
        job.updatedAt = now;
      }
    }, 5000);
  }

  async function outputFor(
    clip: Clip,
    asset: MediaAsset,
  ): Promise<{ signature: string; output: string }> {
    const signature = signatureFor(project.doc, clip);
    const extension = asset.kind === "image" ? "png" : "mp4";
    const output = await cacheFilePath(
      `ofx-preview-${safeId(clip.id)}-${signature}.${extension}`,
    );
    return { signature, output };
  }

  /**
   * 对齐当前工程：
   * - 参数没变的任务原样保留（正在渲染的也不会被打断）；
   * - 参数 / 素材变了的任务作废，避免播放时看到上一版效果；
   * - 磁盘上有同签名缓存时恢复成「已预渲染」，不必重烤。
   */
  async function syncJobs(): Promise<void> {
    if (!isTauri()) return;
    const token = ++syncToken;
    const doc = project.doc;
    const before = readyKey(jobs.value);
    const next: Record<string, EffectRenderJob> = {};

    for (const track of doc.tracks) {
      if (!isVisible(track)) continue;
      for (const clip of track.clips) {
        const asset = eligibleAsset(doc, clip);
        if (!asset) continue;
        const { signature, output } = await outputFor(clip, asset);
        if (token !== syncToken) return;

        const current = jobs.value[clip.id];
        if (current && current.signature === signature) {
          next[clip.id] = current;
          continue;
        }
        if (current?.status === "rendering") void ofxCancelBake(clip.id);

        if (await pathExists(output)) {
          next[clip.id] = {
            clipId: clip.id,
            signature,
            output,
            status: "ready",
            done: 1,
            total: 1,
            error: null,
            updatedAt: Date.now(),
          };
        }
      }
    }

    if (token !== syncToken) return;
    // 被移出队列（片段删了 / 轨道隐藏 / 参数变了）但还在烤的任务：一起停掉。
    for (const job of Object.values(jobs.value)) {
      if (job.status !== "rendering") continue;
      if (!next[job.clipId] || next[job.clipId].signature !== job.signature) {
        void ofxCancelBake(job.clipId);
      }
    }
    jobs.value = next;
    if (readyKey(next) !== before) revision.value += 1;
  }

  function scheduleSync(): void {
    if (!isTauri()) return;
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncJobs().catch((error) => {
        console.warn("OFX preview queue failed", error);
      });
    }, SYNC_DEBOUNCE_MS);
  }

  /** 用户点「预渲染」：把片段按当前效果链排队烘焙。 */
  async function request(clipId: string): Promise<void> {
    if (!isTauri()) return;
    const doc = project.doc;
    const clip = findClip(doc, clipId);
    if (!clip) return;
    const asset = eligibleAsset(doc, clip);
    if (!asset) return;

    const { signature, output } = await outputFor(clip, asset);
    const current = jobs.value[clipId];
    if (current && current.signature === signature) {
      // 已经在烤 / 已经烤好：不重复排队。
      if (
        current.status === "queued" ||
        current.status === "rendering" ||
        current.status === "ready"
      ) {
        return;
      }
    } else if (current?.status === "rendering") {
      void ofxCancelBake(clipId);
    }

    jobs.value = {
      ...jobs.value,
      [clipId]: {
        clipId,
        signature,
        output,
        status: "queued",
        done: 0,
        total: Math.max(1, Math.ceil(clip.duration * doc.fps)),
        error: null,
        updatedAt: Date.now(),
      },
    };
    void pump();
  }

  /** 取消排队 / 正在跑的烘焙；已有结果也会一并丢弃。 */
  function cancel(clipId: string): void {
    const job = jobs.value[clipId];
    if (!job) return;
    if (job.status === "rendering") void ofxCancelBake(clipId);
    const next = { ...jobs.value };
    delete next[clipId];
    jobs.value = next;
    if (job.status === "ready") revision.value += 1;
  }

  function finish(clipId: string, signature: string, output: string): void {
    const job = jobs.value[clipId];
    if (!job || job.signature !== signature) return;
    job.output = output;
    job.status = "ready";
    job.done = job.total;
    job.error = null;
    job.updatedAt = Date.now();
    revision.value += 1;
  }

  /** 取下一个要烘焙的任务：优先播放头所在（或最靠近）的片段。 */
  function nextQueuedJob(): EffectRenderJob | null {
    const queued = Object.values(jobs.value).filter((item) => item.status === "queued");
    if (queued.length <= 1) return queued[0] ?? null;

    const playhead = usePlaybackStore().playhead;
    let best: EffectRenderJob | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of queued) {
      const clip = findClip(project.doc, item.clipId);
      if (!clip) continue;
      const inside = playhead >= clip.start && playhead < clip.start + clip.duration;
      const distance = inside
        ? 0
        : Math.min(
            Math.abs(playhead - clip.start),
            Math.abs(playhead - (clip.start + clip.duration)),
          );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }
    return best ?? queued[0] ?? null;
  }

  /** 一次只跑一个烘焙：OFX host 内部本来就是串行的。 */
  async function pump(): Promise<void> {
    if (running) return;
    const job = nextQueuedJob();
    if (!job) return;

    running = true;
    const { clipId, signature } = job;
    try {
      // 同签名缓存已存在：直接当作完成，不重烤。
      if (await pathExists(job.output)) {
        finish(clipId, signature, job.output);
        return;
      }
      const current = jobs.value[clipId];
      if (!current || current.signature !== signature || current.status !== "queued") return;
      current.status = "rendering";
      current.updatedAt = Date.now();

      const clip = findClip(project.doc, clipId);
      const asset = clip
        ? project.doc.assets.find((item) => item.id === clip.assetId)
        : undefined;
      if (!clip || !asset) {
        current.status = "error";
        current.error = "片段已不存在";
        return;
      }

      if (asset.kind === "image") {
        current.total = 1;
        const output = await ofxBakeImage({
          id: clipId,
          source: asset.src,
          time: 0,
          duration: clip.duration,
          fps: project.doc.fps,
          ...imagePreviewSize(asset),
          fit: "stretch",
          effects: clipEffectSpecs(clip),
          output: current.output,
        });
        finish(clipId, signature, output);
        return;
      }

      const output = await ofxBakeClip({
        id: clipId,
        preview: true,
        source: asset.src,
        sourceIn: clip.in ?? 0,
        duration: clip.duration,
        speed: clip.speed ?? 1,
        fps: project.doc.fps,
        ...previewSize(project.doc.width, project.doc.height),
        isImage: false,
        sourceDuration: asset.duration,
        fit: "contain",
        fitAnchor: "center",
        timeOffset: 0,
        effects: clipEffectSpecs(clip),
        output: current.output,
      });
      finish(clipId, signature, output);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = jobs.value[clipId];
      if (current && current.signature === signature && !message.includes("已取消")) {
        current.status = "error";
        current.error = message;
        current.updatedAt = Date.now();
      }
    } finally {
      running = false;
      void pump();
    }
  }

  listenProgress();
  watchStalls();
  watch(() => project.doc, () => scheduleSync(), { immediate: true });

  return {
    jobs,
    revision,
    rendering,
    progress,
    failed,
    pendingJobs,
    jobFor,
    sourceFor,
    request,
    cancel,
  };
});

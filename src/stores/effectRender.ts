/**
 * OFX 效果的整段预渲染队列。
 *
 * 逐帧实时渲染太慢（1080p 一帧就要几十毫秒），所以打开效果后直接在后台把整个
 * 片段烘焙成 H.264 预览文件：期间显示进度，完成后播放引擎改用这个文件当源，
 * 播放和暂停都能看到效果，拖动也只取决于文件的 seek 速度。
 */
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Clip, Project } from "@/types/project";
import type { OfxEffectSpec } from "@/types/plugins";
import { clipEffectSpecs, clipHasEffects } from "@/core/effects";
import { isVisible } from "@/core/playback/activeClips";
import { cacheFilePath, pathExists } from "@/core/media";
import { ofxBakeClip, ofxCancelBake, onOfxBakeProgress } from "@/core/ofxApi";
import { stableHash } from "@/utils/hash";
import { useProjectStore } from "@/stores/project";
import { isTauri } from "@/utils/platform";

export type EffectRenderStatus = "queued" | "rendering" | "ready" | "error";

export interface EffectRenderJob {
  clipId: string;
  signature: string;
  output: string;
  status: EffectRenderStatus;
  done: number;
  total: number;
  error: string | null;
}

/** 参数拖动会连续触发签名变化，等手势停下来再排队。 */
const DEBOUNCE_MS = 1000;
/** 预览烘焙的长边上限：画布上显示不到这个尺寸，按工程分辨率烤太浪费。 */
const PREVIEW_MAX_EDGE = 1600;

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 等比缩到预览尺寸（H.264 yuv420p 要求偶数边长）。 */
function previewSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
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
  const size = previewSize(project.width, project.height);
  return stableHash(
    JSON.stringify({
      clip: clip.id,
      source: asset?.src ?? "",
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

export const useEffectRenderStore = defineStore("effectRender", () => {
  const project = useProjectStore();
  const jobs = ref<Record<string, EffectRenderJob>>({});
  /** 任意片段的预渲染完成时递增，播放引擎据此换源。 */
  const revision = ref(0);

  let running = false;
  let timer: number | null = null;
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
    const total = list.reduce((sum, job) => sum + Math.max(job.total, 1), 0);
    const done = list.reduce((sum, job) => sum + job.done, 0);
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
    return job && job.status === "ready" ? job.output : null;
  }

  function listenProgress(): void {
    if (listening || !isTauri()) return;
    listening = true;
    void onOfxBakeProgress((payload) => {
      if (!payload.id) return;
      const job = jobs.value[payload.id];
      if (!job || job.status !== "rendering") return;
      job.done = payload.done;
      job.total = payload.total;
    });
  }

  function schedule(): void {
    if (!isTauri()) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void reconcile();
    }, DEBOUNCE_MS);
  }

  /** 已就绪的源快照：用来判断引擎是否需要换源。 */
  function readyKey(jobs: Record<string, EffectRenderJob>): string {
    return Object.values(jobs)
      .filter((job) => job.status === "ready")
      .map((job) => `${job.clipId}:${job.output}`)
      .sort()
      .join("|");
  }

  /** 对齐当前工程：新增/失效的片段排队，删除的片段丢弃任务。 */
  async function reconcile(): Promise<void> {
    const doc = project.doc;
    const before = readyKey(jobs.value);
    const next: Record<string, EffectRenderJob> = {};
    for (const track of doc.tracks) {
      if (!isVisible(track)) continue;
      for (const clip of track.clips) {
        if (!(clip.duration > 0) || clip.audioOnly || !clipHasEffects(clip)) continue;
        const asset = doc.assets.find((item) => item.id === clip.assetId);
        if (!asset || asset.kind !== "video" || asset.offline) continue;

        const signature = signatureFor(doc, clip);
        const current = jobs.value[clip.id];
        if (current && current.signature === signature) {
          next[clip.id] = current;
          continue;
        }
        if (current?.status === "rendering") void ofxCancelBake(clip.id);
        const output = await cacheFilePath(
          `ofx-preview-${safeId(clip.id)}-${signature}.mp4`,
        );
        next[clip.id] = {
          clipId: clip.id,
          signature,
          output,
          status: "queued",
          done: 0,
          total: 0,
          error: null,
        };
      }
    }
    jobs.value = next;
    if (readyKey(next) !== before) revision.value += 1;
    void pump();
  }

  function finish(clipId: string, signature: string, output: string): void {
    const job = jobs.value[clipId];
    if (!job || job.signature !== signature) return;
    job.output = output;
    job.status = "ready";
    job.done = job.total;
    job.error = null;
    revision.value += 1;
  }

  /** 一次只跑一个烘焙：OFX host 内部本来就是串行的。 */
  async function pump(): Promise<void> {
    if (running) return;
    const job = Object.values(jobs.value).find((item) => item.status === "queued");
    if (!job) return;

    running = true;
    const { clipId, signature } = job;
    try {
      if (await pathExists(job.output)) {
        finish(clipId, signature, job.output);
        return;
      }
      const current = jobs.value[clipId];
      if (!current || current.signature !== signature) return;
      current.status = "rendering";

      const clip = findClip(project.doc, clipId);
      const asset = clip
        ? project.doc.assets.find((item) => item.id === clip.assetId)
        : undefined;
      if (!clip || !asset) {
        current.status = "error";
        current.error = "片段已不存在";
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
      }
    } finally {
      running = false;
      void pump();
    }
  }

  listenProgress();
  watch(() => project.doc, () => schedule(), { immediate: true });

  return {
    jobs,
    revision,
    rendering,
    progress,
    failed,
    pendingJobs,
    jobFor,
    sourceFor,
  };
});

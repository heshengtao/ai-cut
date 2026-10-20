/**
 * 预览引擎。
 *
 * 架构参考 OpenCut：
 * - **声音**：用 Web Audio 的 `decodeAudioData` 把素材解成 AudioBuffer，提前 2 秒用
 *   `AudioBufferSourceNode` 调度播放。播放中**绝不逐帧 seek**，因此不会因为 Tauri
 *   asset 协议的高延迟 seek 而卡顿/断音。
 * - **时钟**：播放头用 `performance.now()` 的 wall clock，与音频调度解耦。
 * - **画面**：只用一个常驻 `<video>`（静音）负责主视频轨画面；它只在自己播放，
 *   不在每帧被 seek。用户点播放的手势会解锁它。
 * - 片段删除 / 空档：清空 video 的 src 并 `load()`，画面回到黑场。
 * - 裁剪只改 `in` / `duration`，播放速度恒为 1。
 */
import type { Clip, MediaAsset, Project } from "@/types/project";
import { isAudible, mainVideoClipAt } from "./activeClips";
import { fileUrl } from "@/core/media";

/** 播放头 UI 更新间隔（毫秒）：30fps 足够，避免每帧触发整棵 Vue 树重绘。 */
const EMIT_INTERVAL_MS = 32;

/** 音频预调度窗口（秒）。 */
const AUDIO_LOOKAHEAD = 2;

/** 音频调度器运行间隔（毫秒）。 */
const AUDIO_SCHEDULE_INTERVAL_MS = 400;

/** 暂停时提前解码的时间窗口（秒）。 */
const PREROLL_AHEAD = 4;

/** 视频漂移容忍（秒）：超过才纠正，且每秒最多检查一次。 */
const VIDEO_DRIFT_TOLERANCE = 0.5;
const VIDEO_CHECK_INTERVAL_MS = 1000;

/** 时间线时间 → 素材内时间。 */
export function mediaTimeFor(clip: Clip, timelineTime: number): number {
  return clip.in + (timelineTime - clip.start);
}

/** 增益 dB → 线性音量（0..4，即最多 +12 dB 放大）。 */
export function gainToVolume(db: number | undefined): number {
  const linear = 10 ** ((db ?? 0) / 20);
  return Math.min(4, Math.max(0, linear));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface GainEnvelope {
  /** AudioContext 时间轴上开始播放的时刻。 */
  when: number;
  /** 播放起点相对片段起点的偏移（秒）。 */
  elapsed: number;
  /** 本次实际调度的时长（秒）。 */
  playDuration: number;
  /** 片段总时长（秒）。 */
  clipDuration: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

/** 把音量 + 淡入淡出写成 AudioParam 自动化曲线。 */
export function scheduleGainEnvelope(param: AudioParam, envelope: GainEnvelope): void {
  const { when, elapsed, playDuration, clipDuration, volume } = envelope;
  const fadeIn = clamp(envelope.fadeIn, 0, clipDuration);
  const fadeOut = clamp(envelope.fadeOut, 0, Math.max(0, clipDuration - fadeIn));

  const startValue = fadeIn > 0 ? volume * Math.min(1, elapsed / fadeIn) : volume;
  param.setValueAtTime(startValue, when);

  if (fadeIn > elapsed) {
    param.linearRampToValueAtTime(volume, when + (fadeIn - elapsed));
  }

  if (fadeOut > 0) {
    const fadeOutStart = clipDuration - fadeOut;
    const playedEnd = elapsed + playDuration;
    if (fadeOutStart < playedEnd) {
      const startAt = fadeOutStart <= elapsed ? when : when + (fadeOutStart - elapsed);
      const endAt = when + Math.max(0, Math.min(playDuration, clipDuration - elapsed));
      const startAtValue =
        fadeOutStart <= elapsed
          ? volume * Math.max(0, 1 - (elapsed - fadeOutStart) / fadeOut)
          : volume;
      param.setValueAtTime(startAtValue, startAt);
      if (endAt > startAt) param.linearRampToValueAtTime(0, endAt);
    }
  }
}

/** 素材是否带可播放的音频。 */
function hasAudio(asset: MediaAsset | undefined): asset is MediaAsset {
  if (!asset || asset.offline) return false;
  return asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio !== false);
}

interface ScheduledSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  clipId: string;
}

export interface PlaybackEngineOptions {
  container: HTMLElement;
  getDoc: () => Project;
  onTime: (seconds: number) => void;
  onEnded?: () => void;
}

export class PlaybackEngine {
  private readonly container: HTMLElement;
  private readonly getDoc: () => Project;
  private readonly onTime: (seconds: number) => void;
  private readonly onEnded: () => void;

  /** 常驻画面元素：同一时间只显示主视频轨的一个片段。 */
  private readonly video: HTMLVideoElement;
  private videoAssetId: string | null = null;
  private videoClipId: string | null = null;
  private lastVideoCheck = 0;
  private lastVideoPlayAttempt = 0;

  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** 素材 id → 解码后的 AudioBuffer（同一素材只解码一次）。 */
  private readonly bufferCache = new Map<string, Promise<AudioBuffer | null>>();
  private readonly sources = new Set<ScheduledSource>();
  /** 本次播放会话中已经调度过的片段 id。 */
  private readonly scheduled = new Set<string>();
  private session = 0;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;

  private raf = 0;
  private playing = false;
  /** 播放起点（时间线秒）与对应的 performance.now()。 */
  private base = 0;
  private wallStart = 0;
  private masterVolume = 1;
  private lastEmitMs = 0;
  /** 音频相关文档签名：只有它变化时才重排音频。 */
  private audioSignature = "";
  /** 画面相关文档签名：拖拽变换等非画面变化不触发视频 seek。 */
  private videoSignature = "";

  private readonly pendingSeek = new WeakMap<HTMLMediaElement, number>();

  constructor(options: PlaybackEngineOptions) {
    this.container = options.container;
    this.getDoc = options.getDoc;
    this.onTime = options.onTime;
    this.onEnded = options.onEnded ?? (() => undefined);

    this.video = document.createElement("video");
    this.video.className = "engine-video";
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.video.muted = true;
    this.video.style.position = "absolute";
    this.video.style.inset = "0";
    this.video.style.width = "100%";
    this.video.style.height = "100%";
    this.video.style.objectFit = "contain";
    this.video.style.visibility = "hidden";
    this.video.style.pointerEvents = "none";
    this.video.addEventListener("loadedmetadata", () => applyPendingSeek(this.video, this.pendingSeek));
    this.container.appendChild(this.video);
  }

  get currentTime(): number {
    if (!this.playing) return this.base;
    return this.base + Math.max(0, performance.now() - this.wallStart) / 1000;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setMasterVolume(value: number): void {
    this.masterVolume = Math.min(1, Math.max(0, value));
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume;
  }

  play(): void {
    if (this.playing) return;
    const end = this.projectEnd();
    if (end <= 0) {
      this.onEnded();
      return;
    }
    // 播放头在结尾时重新从头播放。
    if (this.base >= end - 1e-3) {
      this.base = 0;
      this.onTime(0);
    }

    this.playing = true;
    this.wallStart = performance.now();
    this.lastEmitMs = 0;
    this.audioSignature = this.computeAudioSignature(this.getDoc());
    this.session += 1;
    this.stopSources();
    this.syncVideo(this.base, true);
    this.kickAudio();
    this.startScheduleTimer();
    this.loop();
  }

  pause(): void {
    if (!this.playing) return;
    this.base = this.currentTime;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopScheduleTimer();
    this.session += 1;
    this.stopSources();
    this.video.pause();
    this.onTime(this.base);
  }

  seek(seconds: number): void {
    this.base = Math.max(0, seconds);
    this.wallStart = performance.now();
    this.lastVideoCheck = 0;
    if (this.playing) {
      this.session += 1;
      this.stopSources();
      this.syncVideo(this.base, true);
      this.kickAudio();
    } else {
      this.syncVideo(this.base, true);
      this.preroll(this.base);
    }
    this.onTime(this.base);
  }

  /**
   * 文档变化后调用：只有音频数据变化时才重排声音；
   * 只有画面数据变化时才重新同步视频（拖拽变换不会触发 seek）。
   */
  sync(): void {
    const audioSignature = this.computeAudioSignature(this.getDoc());
    const audioChanged = audioSignature !== this.audioSignature;
    this.audioSignature = audioSignature;

    const videoSignature = this.computeVideoSignature(this.getDoc());
    const videoChanged = videoSignature !== this.videoSignature;
    this.videoSignature = videoSignature;

    if (this.playing) {
      this.base = this.currentTime;
      this.wallStart = performance.now();
      if (audioChanged) {
        this.session += 1;
        this.stopSources();
        this.kickAudio();
      }
      if (videoChanged) this.syncVideo(this.base, true);
    } else {
      if (videoChanged) this.syncVideo(this.base, true);
      if (audioChanged) this.preroll(this.base);
    }
  }

  /** 用户手势兜底：WebKit 可能拒绝非手势触发的 `<video>.play()`。 */
  retryVideo(): void {
    if (!this.playing || this.videoAssetId === null) return;
    if (this.video.paused) {
      this.lastVideoPlayAttempt = 0;
      playMedia(this.video);
    }
  }

  /** 用户手势兜底：AudioContext 被浏览器挂起时重新唤醒并补排音频。 */
  retryAudio(): void {
    if (!this.playing || !this.audioContext) return;
    if (this.audioContext.state !== "suspended") return;
    const session = this.session;
    void this.audioContext
      .resume()
      .then(() => {
        if (this.session === session && this.playing) this.scheduleAudio(session);
      })
      .catch(() => undefined);
  }

  dispose(): void {
    this.pause();
    cancelAnimationFrame(this.raf);
    this.stopSources();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
      this.masterGain = null;
    }
    this.bufferCache.clear();
  }

  private loop = (): void => {
    if (!this.playing) return;
    const t = this.currentTime;
    const end = this.projectEnd();
    if (end > 0 && t >= end) {
      this.pause();
      this.base = end;
      this.onTime(end);
      this.onEnded();
      return;
    }
    this.syncVideo(t, false);
    const now = performance.now();
    if (now - this.lastEmitMs >= EMIT_INTERVAL_MS) {
      this.lastEmitMs = now;
      this.onTime(t);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private projectEnd(): number {
    let max = 0;
    for (const track of this.getDoc().tracks) {
      for (const clip of track.clips) max = Math.max(max, clip.start + clip.duration);
    }
    return max;
  }

  // ---------------------------------------------------------------------------
  // 声音：Web Audio 解码 + 预调度
  // ---------------------------------------------------------------------------

  private ensureContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = this.masterVolume;
      master.connect(context.destination);
      this.audioContext = context;
      this.masterGain = master;
      return context;
    } catch {
      return null;
    }
  }

  private kickAudio(): void {
    const context = this.ensureContext();
    if (!context) return;
    const session = this.session;
    const ready =
      context.state === "suspended" ? context.resume().catch(() => undefined) : Promise.resolve();
    void ready.then(() => {
      if (this.session !== session || !this.playing) return;
      this.scheduleAudio(session);
    });
  }

  private startScheduleTimer(): void {
    this.stopScheduleTimer();
    this.scheduleTimer = setInterval(() => {
      if (!this.playing) return;
      if (this.audioContext?.state === "running") this.scheduleAudio(this.session);
    }, AUDIO_SCHEDULE_INTERVAL_MS);
  }

  private stopScheduleTimer(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  /** 把即将进入（或正在进行）的音频片段排进 AudioContext 的时间轴。 */
  private scheduleAudio(session: number): void {
    if (session !== this.session || !this.playing) return;
    const context = this.audioContext;
    if (!context) return;

    const doc = this.getDoc();
    const nowTimeline = this.currentTime;
    const windowEnd = nowTimeline + AUDIO_LOOKAHEAD;

    for (const track of doc.tracks) {
      if (!isAudible(track)) continue;
      for (const clip of track.clips) {
        const clipEnd = clip.start + clip.duration;
        if (clipEnd <= nowTimeline) continue;
        if (clip.start > windowEnd) continue;
        if (this.scheduled.has(clip.id)) continue;

        const asset = doc.assets.find((a) => a.id === clip.assetId);
        if (!asset || !hasAudio(asset)) continue;

        this.scheduled.add(clip.id);
        void this.scheduleClip({ clip, asset, session });
      }
    }
  }

  private async scheduleClip(input: {
    clip: Clip;
    asset: MediaAsset;
    session: number;
  }): Promise<void> {
    const { clip, asset, session } = input;
    const buffer = await this.ensureBuffer(asset);
    if (!buffer || session !== this.session || !this.playing) return;

    const context = this.audioContext;
    if (!context) return;

    // 解码期间时间可能前进了：重新按当前时间计算偏移。
    const nowTimeline = this.currentTime;
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= nowTimeline) return;

    const startTimeline = Math.max(nowTimeline, clip.start);
    const offset = clip.in + (startTimeline - clip.start);
    if (offset >= buffer.duration) return;

    const duration = Math.min(
      clipEnd - startTimeline,
      buffer.duration - offset,
      clip.duration,
    );
    if (duration <= 0) return;

    // 未来片段按时间差排期；已在播放的片段立刻开始。
    const delay = Math.max(0, clip.start - nowTimeline);
    const when = context.currentTime + delay;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1;
    const pitch = clamp(clip.pitch ?? 0, -12, 12);
    if (pitch !== 0 && source.detune) source.detune.value = pitch * 100;

    const gain = context.createGain();
    scheduleGainEnvelope(gain.gain, {
      when,
      elapsed: Math.max(0, startTimeline - clip.start),
      playDuration: duration,
      clipDuration: clip.duration,
      volume: gainToVolume(clip.gain),
      fadeIn: clip.fadeIn ?? 0,
      fadeOut: clip.fadeOut ?? 0,
    });

    let panner: StereoPannerNode | null = null;
    const pan = clamp(clip.pan ?? 0, -1, 1);
    source.connect(gain);
    if (pan !== 0 && typeof context.createStereoPanner === "function") {
      panner = context.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.masterGain ?? context.destination);
    } else {
      gain.connect(this.masterGain ?? context.destination);
    }

    try {
      source.start(when, offset, duration);
    } catch {
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
      return;
    }

    const entry: ScheduledSource = { source, gain, panner, clipId: clip.id };
    this.sources.add(entry);
    source.addEventListener("ended", () => {
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
      this.sources.delete(entry);
    });
  }

  private stopSources(): void {
    for (const { source, gain, panner } of this.sources) {
      try {
        source.stop();
      } catch {
        /* 已经结束 */
      }
      try {
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.sources.clear();
    this.scheduled.clear();
  }

  /** 暂停时提前解码即将播放的素材，按下播放即可立即出声。 */
  private preroll(timelineTime: number): void {
    const doc = this.getDoc();
    if (!this.ensureContext()) return;

    for (const track of doc.tracks) {
      if (!isAudible(track)) continue;
      for (const clip of track.clips) {
        if (clip.start + clip.duration < timelineTime) continue;
        if (clip.start > timelineTime + PREROLL_AHEAD) continue;
        const asset = doc.assets.find((a) => a.id === clip.assetId);
        if (!asset || !hasAudio(asset)) continue;
        void this.ensureBuffer(asset);
      }
    }
  }

  private ensureBuffer(asset: MediaAsset): Promise<AudioBuffer | null> {
    const key = `${asset.id}:${asset.src}`;
    const cached = this.bufferCache.get(key);
    if (cached) return cached;

    const context = this.ensureContext();
    if (!context) return Promise.resolve(null);

    const promise = (async () => {
      try {
        const response = await fetch(fileUrl(asset.src));
        if (!response.ok) return null;
        const data = await response.arrayBuffer();
        return await context.decodeAudioData(data);
      } catch {
        return null;
      }
    })();

    this.bufferCache.set(key, promise);
    return promise;
  }

  /** 与画面有关的文档摘要：轨道可见性、片段位置 / 入点、素材源。 */
  private computeVideoSignature(doc: Project): string {
    return JSON.stringify({
      tracks: doc.tracks.map((track) => ({
        visible: track.visible,
        clips: track.clips.map((clip) => [
          clip.id,
          clip.assetId,
          clip.start,
          clip.duration,
          clip.in,
        ]),
      })),
      assets: doc.assets.map((asset) => [asset.id, asset.src, asset.kind, asset.offline ?? false]),
    });
  }

  /** 与声音有关的文档摘要：轨道静音、片段位置 / 入点 / 增益 / 淡入淡出 / 变调 / 声像。 */
  private computeAudioSignature(doc: Project): string {
    return JSON.stringify({
      tracks: doc.tracks.map((track) => ({
        muted: track.muted,
        clips: track.clips.map((clip) => [
          clip.id,
          clip.assetId,
          clip.start,
          clip.duration,
          clip.in,
          clip.gain ?? 0,
          clip.fadeIn ?? 0,
          clip.fadeOut ?? 0,
          clip.pitch ?? 0,
          clip.pan ?? 0,
        ]),
      })),
      assets: doc.assets.map((asset) => [asset.id, asset.src, asset.hasAudio, asset.offline ?? false]),
    });
  }

  // ---------------------------------------------------------------------------
  // 画面：常驻 <video>，不做逐帧 seek
  // ---------------------------------------------------------------------------

  private syncVideo(timelineTime: number, force: boolean): void {
    const doc = this.getDoc();
    const main = mainVideoClipAt(doc, timelineTime);
    const asset = main ? doc.assets.find((a) => a.id === main.clip.assetId) : undefined;
    const clip = main && asset && asset.kind === "video" && !asset.offline ? main.clip : null;

    if (clip && asset) {
      const expected = mediaTimeFor(clip, timelineTime);
      const freshAsset = this.videoAssetId !== asset.id;
      const freshClip = this.videoClipId !== clip.id;

      if (freshAsset) {
        this.videoAssetId = asset.id;
        this.video.src = fileUrl(asset.src);
        this.video.load();
        seekMedia(this.video, expected, this.pendingSeek);
      } else if (freshClip || force) {
        seekMedia(this.video, expected, this.pendingSeek);
      } else {
        // 正常播放时只做低频漂移检查，绝不每帧 seek。
        const now = performance.now();
        if (now - this.lastVideoCheck > VIDEO_CHECK_INTERVAL_MS) {
          this.lastVideoCheck = now;
          if (Math.abs(this.video.currentTime - expected) > VIDEO_DRIFT_TOLERANCE) {
            seekMedia(this.video, expected, this.pendingSeek);
          }
        }
      }

      this.videoClipId = clip.id;
      this.video.muted = true;
      this.video.style.visibility = "visible";

      if (this.playing && this.video.paused) {
        const now = performance.now();
        if (now - this.lastVideoPlayAttempt > VIDEO_CHECK_INTERVAL_MS) {
          this.lastVideoPlayAttempt = now;
          playMedia(this.video);
        }
      }
    } else {
      this.videoClipId = null;
      if (this.videoAssetId !== null) {
        this.videoAssetId = null;
        this.video.pause();
        this.video.removeAttribute("src");
        this.video.load();
        this.video.style.visibility = "hidden";
      }
    }
  }
}

function seekMedia(
  el: HTMLMediaElement,
  time: number,
  pending: WeakMap<HTMLMediaElement, number>,
): void {
  const target = Math.max(0, time);
  pending.set(el, target);
  if (el.readyState >= 1) applyPendingSeek(el, pending);
}

function applyPendingSeek(
  el: HTMLMediaElement,
  pending: WeakMap<HTMLMediaElement, number>,
): void {
  const target = pending.get(el);
  if (target === undefined) return;
  pending.delete(el);
  try {
    el.currentTime = target;
  } catch {
    pending.set(el, target);
  }
}

function playMedia(el: HTMLMediaElement): void {
  const result = el.play();
  if (result && typeof result.catch === "function") {
    void result.catch(() => undefined);
  }
}

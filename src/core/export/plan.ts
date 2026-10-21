/**
 * 把工程文档编译成一份确定性的 ffmpeg 导出作业。
 *
 * 合成规则：
 * - 黑底 + 所有发声视频轨自下而上叠加（图片按片段时长循环）。
 * - 文字片段用 Canvas 预渲染成透明 PNG，再按时间叠加（不依赖 ffmpeg drawtext）。
 * - 所有发声音频轨与带音频的视频片段按 gain / start 混音。
 */
import type { Clip, ClipTransform, MediaAsset, Project } from "@/types/project";
import { isAudible, isVisible, projectDuration } from "@/core/playback/activeClips";
import { isDefaultTransform, resolveTransform } from "@/core/transform";
import type { ExportOptions, ExportPlan } from "@/types/export";
import { t } from "@/i18n";
import { formatSeconds } from "./escape";

/** 宽高取偶数，最小 2。 */
function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** 按工程比例解析输出尺寸与帧率；GIF 最高 720p、固定 15fps。 */
export function resolveDimensions(
  project: Project,
  options: ExportOptions,
): { width: number; height: number; fps: number } {
  const aspect = project.width / project.height;
  let height =
    options.resolution === "720p" ? 720 : options.resolution === "1080p" ? 1080 : project.height;
  let width = options.resolution === "project" ? project.width : Math.round(height * aspect);
  if (options.format === "gif" && height > 720) {
    height = 720;
    width = Math.round(height * aspect);
  }
  const fps = options.format === "gif" ? 15 : Math.max(1, options.fps ?? project.fps);
  return { width: even(width), height: even(height), fps };
}

/** 所有会被导出使用的素材（画面取可见轨，声音取发声轨）。 */
export function collectUsedAssets(project: Project): MediaAsset[] {
  const ids = new Set<string>();
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const track of project.tracks) {
    const visible = isVisible(track);
    const audible = isAudible(track);
    for (const clip of track.clips) {
      if (!clip.assetId) continue;
      const asset = assets.get(clip.assetId);
      if (!asset) continue;
      const visual = visible && !clip.audioOnly && (asset.kind === "video" || asset.kind === "image");
      const audio =
        audible &&
        !clip.muted &&
        (asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio === true));
      if (visual || audio) ids.add(asset.id);
    }
  }
  return project.assets.filter((a) => ids.has(a.id));
}

/** 是否有需要烧录的文字片段。 */
export function hasExportableText(project: Project): boolean {
  return project.tracks.some(
    (track) =>
      isVisible(track) &&
      track.clips.some((clip) => (clip.text ?? "").trim() !== ""),
  );
}

interface PreparedVideo {
  clip: Clip;
  asset: MediaAsset;
  inputIndex: number;
}

interface PreparedAudio {
  clip: Clip;
  inputIndex: number;
}

/** 某个素材是否会参与音频混音。 */
function hasAudio(asset: MediaAsset): boolean {
  return asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio === true);
}

/** 输出格式对应的 CRF。 */
function crfOf(quality: ExportOptions["quality"]): string {
  return quality === "high" ? "18" : quality === "small" ? "28" : "23";
}

/** 缩放 / 旋转对应的 ffmpeg 滤镜（默认变换返回空数组）。 */
function transformFilters(transform: ClipTransform): string[] {
  const filters: string[] = [];
  if (transform.scale !== 1) {
    filters.push(`scale=iw*${transform.scale}:ih*${transform.scale}`);
  }
  if (transform.rotation !== 0) {
    const angle = `${transform.rotation}*PI/180`;
    filters.push(
      `rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none`,
    );
  }
  return filters;
}

/** 有位置偏移时，把叠层放在画布中心 + 偏移处。 */
function overlayPosition(transform: ClipTransform): string {
  if (isDefaultTransform(transform)) return "";
  return (
    `:x=(main_w-overlay_w)/2+${transform.x}*main_w/100` +
    `:y=(main_h-overlay_h)/2+${transform.y}*main_h/100`
  );
}

export function buildExportPlan(
  project: Project,
  options: ExportOptions,
  textImages: ReadonlyMap<string, string>,
  outputPath: string,
): ExportPlan {
  const duration = projectDuration(project);
  if (!(duration > 0)) throw new Error(t("export.emptyTimeline"));

  const { width, height, fps } = resolveDimensions(project, options);
  const warnings: string[] = [];
  const filters: string[] = [
    `color=c=black:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}[b0]`,
  ];

  const inputs: string[] = [];
  let inputCount = 0;

  function pushInput(args: string[]): number {
    const index = inputCount;
    inputs.push(...args);
    inputCount += 1;
    return index;
  }

  function assetOf(clip: Clip): MediaAsset | undefined {
    return project.assets.find((a) => a.id === clip.assetId);
  }

  function assertOnline(asset: MediaAsset): void {
    if (asset.offline) throw new Error(t("export.offlineAsset", { name: asset.name }));
  }

  // ---- 画面层：视频 / 图片 / 文字统一按轨道自下而上排序 ----
  // 先登记输入（保持视频输入在前、文字输入在后），再按轨道层级逐层叠加，
  // 避免所有文字被无条件压在所有视频之上。
  const visualTracks = project.tracks.filter((track) => isVisible(track));
  const preparedVideo: PreparedVideo[] = [];

  interface VisualLayer {
    clip: Clip;
    inputIndex: number;
    kind: "video" | "text";
    trackIndex: number;
  }

  const visualLayers: VisualLayer[] = [];

  for (const track of [...visualTracks].reverse()) {
    const trackIndex = project.tracks.indexOf(track);
    for (const clip of track.clips) {
      if (!(clip.duration > 0)) continue;
      // 分离出来的纯音频片段只参与混音，不再叠加一次画面。
      if (clip.audioOnly) continue;
      // 文字片段没有素材，交给下面的文字图层循环处理。
      if (!clip.assetId) continue;
      const asset = assetOf(clip);
      if (!asset) {
        warnings.push(t("export.warnMissingAsset"));
        continue;
      }
      if (asset.kind !== "video" && asset.kind !== "image") continue;
      assertOnline(asset);

      const args =
        asset.kind === "image"
          ? ["-loop", "1", "-t", formatSeconds(clip.duration), "-i", asset.src]
          : [
              "-ss",
              formatSeconds(clip.in),
              "-t",
              formatSeconds(clip.duration),
              "-i",
              asset.src,
            ];
      const inputIndex = pushInput(args);
      preparedVideo.push({ clip, asset, inputIndex });
      visualLayers.push({ clip, inputIndex, kind: "video", trackIndex });
    }
  }

  for (const track of [...visualTracks].reverse()) {
    const trackIndex = project.tracks.indexOf(track);
    for (const clip of track.clips) {
      const text = (clip.text ?? "").trim();
      if (text === "" || !(clip.duration > 0)) continue;
      const image = textImages.get(clip.id);
      if (!image) {
        warnings.push(t("export.warnMissingTextImage", { text }));
        continue;
      }
      const inputIndex = pushInput([
        "-loop",
        "1",
        "-t",
        formatSeconds(clip.duration),
        "-i",
        image,
      ]);
      visualLayers.push({ clip, inputIndex, kind: "text", trackIndex });
    }
  }

  // 轨道数组中靠下的轨道先画（index 越大越底层）。
  visualLayers.sort(
    (a, b) => b.trackIndex - a.trackIndex || a.clip.start - b.clip.start,
  );

  let videoLabel = "[b0]";
  let videoCount = 0;
  let textCount = 0;

  for (const layer of visualLayers) {
    const { clip, inputIndex } = layer;
    const start = formatSeconds(clip.start);
    const end = formatSeconds(clip.start + clip.duration);
    const transform = resolveTransform(clip);
    const opacity = Math.min(1, Math.max(0, clip.opacity ?? 1));

    if (layer.kind === "video") {
      filters.push(
        [
          `[${inputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease`,
          "format=yuva420p",
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
          "setsar=1",
          `fps=${fps}`,
          ...transformFilters(transform),
          `colorchannelmixer=aa=${opacity}`,
          `setpts=PTS-STARTPTS+${start}/TB[v${videoCount}]`,
        ].join(","),
      );
      filters.push(
        `${videoLabel}[v${videoCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'` +
          `${overlayPosition(transform)}[vout${videoCount}]`,
      );
      videoLabel = `[vout${videoCount}]`;
      videoCount += 1;
      continue;
    }

    filters.push(
      [
        `[${inputIndex}:v]format=yuva420p`,
        `fps=${fps}`,
        ...transformFilters(transform),
        ...(opacity !== 1 ? [`colorchannelmixer=aa=${opacity}`] : []),
        `setpts=PTS-STARTPTS+${start}/TB[t${textCount}]`,
      ].join(","),
    );
    filters.push(
      `${videoLabel}[t${textCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'` +
        `${overlayPosition(transform)}[vtext${textCount}]`,
    );
    videoLabel = `[vtext${textCount}]`;
    textCount += 1;
  }

  // ---- 音频 ----
  const wantsAudio = options.format !== "gif";
  const preparedAudio: PreparedAudio[] = [];
  const videoInputByClip = new Map(preparedVideo.map((p) => [p.clip.id, p.inputIndex]));

  if (wantsAudio) {
    for (const track of project.tracks) {
      if (!isAudible(track)) continue;
      for (const clip of track.clips) {
        if (!(clip.duration > 0)) continue;
        if (clip.muted) continue;
        const asset = assetOf(clip);
        if (!asset || !hasAudio(asset)) continue;
        assertOnline(asset);

        const reused = videoInputByClip.get(clip.id);
        const inputIndex =
          reused !== undefined
            ? reused
            : pushInput([
                "-ss",
                formatSeconds(clip.in),
                "-t",
                formatSeconds(clip.duration),
                "-i",
                asset.src,
              ]);
        preparedAudio.push({ clip, inputIndex });
      }
    }
  }

  preparedAudio.forEach(({ clip, inputIndex }, index) => {
    const gain = clip.gain ?? 0;
    const delayMs = Math.max(0, Math.round(clip.start * 1000));
    const fadeIn = Math.min(Math.max(clip.fadeIn ?? 0, 0), clip.duration);
    const fadeOut = Math.min(
      Math.max(clip.fadeOut ?? 0, 0),
      Math.max(0, clip.duration - fadeIn),
    );
    const pitch = Math.min(12, Math.max(-12, clip.pitch ?? 0));
    const pan = Math.min(1, Math.max(-1, clip.pan ?? 0));

    const chain: string[] = [
      `[${inputIndex}:a]atrim=duration=${formatSeconds(clip.duration)}`,
      "asetpts=PTS-STARTPTS",
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
    ];
    // 变调：先改采样率再补回时长，保持片段长度不变（±12 半音仍在 atempo 0.5..2 内）。
    if (pitch !== 0) {
      const ratio = 2 ** (pitch / 12);
      chain.push(
        `asetrate=${Math.round(48000 * ratio)}`,
        "aresample=48000",
        `atempo=${(1 / ratio).toFixed(6)}`,
      );
    }
    if (gain !== 0) chain.push(`volume=${gain}dB`);
    if (pan !== 0) {
      const left = pan > 0 ? 1 - pan : 1;
      const right = pan < 0 ? 1 + pan : 1;
      chain.push(`pan=stereo|c0=c0*${left.toFixed(3)}|c1=c1*${right.toFixed(3)}`);
    }
    if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${formatSeconds(fadeIn)}`);
    if (fadeOut > 0) {
      chain.push(
        `afade=t=out:st=${formatSeconds(Math.max(0, clip.duration - fadeOut))}:` +
          `d=${formatSeconds(fadeOut)}`,
      );
    }
    chain.push(`adelay=${delayMs}:all=1[a${index}]`);
    filters.push(chain.join(","));
  });

  let audioLabel = "";
  if (wantsAudio) {
    if (preparedAudio.length === 0) {
      filters.push(`anullsrc=r=48000:cl=stereo:d=${formatSeconds(duration)}[aout]`);
      audioLabel = "[aout]";
    } else if (preparedAudio.length === 1) {
      filters.push(`[a0]anull[aout]`);
      audioLabel = "[aout]";
    } else {
      const labels = preparedAudio.map((_, i) => `[a${i}]`).join("");
      filters.push(
        `${labels}amix=inputs=${preparedAudio.length}:duration=longest:dropout_transition=0:normalize=0[aout]`,
      );
      audioLabel = "[aout]";
    }
  }

  // ---- 输出 ----
  let finalVideoLabel = videoLabel;
  if (options.format === "gif") {
    filters.push(
      `${videoLabel}split[g0][g1]`,
      `[g0]palettegen=max_colors=256:stats_mode=diff[pal]`,
      `[g1][pal]paletteuse=dither=sierra2_4a[gifout]`,
    );
    finalVideoLabel = "[gifout]";
  }

  const tail = ["-t", formatSeconds(duration), outputPath];
  const outputArgs =
    options.format === "mp4"
      ? [
          "-map",
          finalVideoLabel,
          "-map",
          audioLabel,
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          crfOf(options.quality),
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(fps),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          ...tail,
        ]
      : options.format === "prores"
        ? [
            "-map",
            finalVideoLabel,
            "-map",
            audioLabel,
            "-c:v",
            "prores_ks",
            "-profile:v",
            "2",
            "-pix_fmt",
            "yuv422p10le",
            "-r",
            String(fps),
            "-c:a",
            "pcm_s16le",
            "-ar",
            "48000",
            ...tail,
          ]
        : ["-map", finalVideoLabel, "-loop", "0", "-an", ...tail];

  return {
    format: options.format,
    width,
    height,
    fps,
    duration,
    inputs,
    filterGraph: filters.join(";"),
    outputArgs,
    warnings,
  };
}

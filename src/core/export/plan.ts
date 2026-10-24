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
import { clipColorFilters } from "@/core/clipColor";
import { keyframeExpression } from "@/core/keyframes";
import { evenDimension, normalizeFps } from "@/core/projectOutput";
import { GIF_DITHERS } from "@/types/export";
import type { ExportAnchor, ExportOptions, ExportPlan } from "@/types/export";
import { t } from "@/i18n";
import { formatSeconds } from "./escape";

function clipSpeed(clip: Clip): number {
  return Math.min(4, Math.max(0.1, clip.speed ?? 1));
}

/** 只渲染时间线的一段；缺省时按全片处理。 */
export interface ExportWindow {
  start: number;
  end: number;
}

interface ClipWindow {
  /** 窗口内的时间线起点（秒）。 */
  localStart: number;
  /** 窗口内的时长（秒）。 */
  localDuration: number;
  /** 窗口起点对应的素材入点（秒）。 */
  localIn: number;
  /** 素材实际消耗量 = localDuration × speed。 */
  sourceDuration: number;
  /** 片头被窗口切掉的部分（秒）；用于关键帧与淡入淡出换算。 */
  offsetIntoClip: number;
  cutsHead: boolean;
  cutsTail: boolean;
}

/**
 * 把片段映射到窗口坐标系。
 * 不与窗口相交返回 null；无窗口时保持原片段时间，保证全片导出完全不变。
 */
export function clipWindowOf(
  clip: Clip,
  speed: number,
  window?: ExportWindow,
): ClipWindow | null {
  const clipEnd = clip.start + clip.duration;
  if (!window) {
    return {
      localStart: clip.start,
      localDuration: clip.duration,
      localIn: clip.in,
      sourceDuration: clip.duration * speed,
      offsetIntoClip: 0,
      cutsHead: false,
      cutsTail: false,
    };
  }
  const visibleStart = Math.max(clip.start, window.start);
  const visibleEnd = Math.min(clipEnd, window.end);
  if (!(visibleEnd > visibleStart + 1e-9)) return null;
  const offsetIntoClip = Math.max(0, visibleStart - clip.start);
  return {
    localStart: visibleStart - window.start,
    localDuration: visibleEnd - visibleStart,
    localIn: clip.in + offsetIntoClip * speed,
    sourceDuration: (visibleEnd - visibleStart) * speed,
    offsetIntoClip,
    cutsHead: offsetIntoClip > 1e-9,
    cutsTail: visibleEnd < clipEnd - 1e-9,
  };
}

/** 窗口切进淡入淡出时，v1 直接跳过该侧 fade 并告警，避免画出错误的斜坡。 */
function windowedFadeFilters(
  clip: Clip,
  localDuration: number,
  cutsHead: boolean,
  cutsTail: boolean,
  warnings: string[],
): string[] {
  const filters: string[] = [];
  const number = (value: number) => String(Number(value.toFixed(6)));
  if (clip.transitionIn?.type === "fade") {
    if (cutsHead) {
      warnings.push(`片段 ${clip.id} 的入场淡入被区间截断，已跳过`);
    } else {
      filters.push(
        `fade=t=in:st=0:d=${number(Math.min(clip.transitionIn.duration, localDuration))}:alpha=1`,
      );
    }
  }
  if (clip.transitionOut?.type === "fade") {
    if (cutsTail) {
      warnings.push(`片段 ${clip.id} 的出场淡出被区间截断，已跳过`);
    } else {
      filters.push(
        `fade=t=out:st=${number(Math.max(0, localDuration - clip.transitionOut.duration))}:` +
          `d=${number(Math.min(clip.transitionOut.duration, localDuration))}:alpha=1`,
      );
    }
  }
  return filters;
}

/** ffmpeg 的 atempo 单次只支持 0.5–2，超出范围时拆成多级。 */
function atempoFilters(speed: number): string[] {
  if (Math.abs(speed - 1) < 1e-6) return [];
  const out: string[] = [];
  let value = speed;
  while (value > 2) {
    out.push("atempo=2");
    value /= 2;
  }
  while (value < 0.5) {
    out.push("atempo=0.5");
    value /= 0.5;
  }
  if (Math.abs(value - 1) >= 1e-6) out.push(`atempo=${value.toFixed(6)}`);
  return out;
}

/** 按预设或自定义尺寸解析输出规格；缺一边时按工程比例补全。GIF 默认 15fps。 */
export function resolveDimensions(
  project: Project,
  options: ExportOptions,
): { width: number; height: number; fps: number } {
  const aspect = project.width / project.height;
  let width: number;
  let height: number;

  if (options.resolution === "custom") {
    const customWidth = options.width && options.width > 0 ? options.width : null;
    const customHeight = options.height && options.height > 0 ? options.height : null;
    if (customWidth !== null && customHeight !== null) {
      width = customWidth;
      height = customHeight;
    } else if (customWidth !== null) {
      width = customWidth;
      height = Math.round(customWidth / aspect);
    } else if (customHeight !== null) {
      height = customHeight;
      width = Math.round(customHeight * aspect);
    } else {
      width = project.width;
      height = project.height;
    }
  } else {
    height =
      options.resolution === "720p" ? 720 : options.resolution === "1080p" ? 1080 : project.height;
    width = options.resolution === "project" ? project.width : Math.round(height * aspect);
  }

  const fps =
    options.format === "gif"
      ? Math.min(120, Math.max(1, Math.round(options.fps ?? 15)))
      : normalizeFps(options.fps ?? project.fps);
  return { width: evenDimension(width), height: evenDimension(height), fps };
}

/** cover 裁切窗口在缩放后画面中的归一化位置。 */
const ANCHOR_OFFSETS: Record<ExportAnchor, [number, number]> = {
  "top-left": [0, 0],
  top: [0.5, 0],
  "top-right": [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  "bottom-left": [0, 1],
  bottom: [0.5, 1],
  "bottom-right": [1, 1],
};

/** 把素材缩放/裁切到输出画布；contain 加透明边，cover 按锚点裁切。 */
function fitFilters(
  width: number,
  height: number,
  fit: ExportOptions["fit"],
  anchor: ExportAnchor,
): string[] {
  if (fit === "cover") {
    const [x, y] = ANCHOR_OFFSETS[anchor] ?? ANCHOR_OFFSETS.center;
    const crop =
      x === 0.5 && y === 0.5
        ? `crop=${width}:${height}`
        : `crop=${width}:${height}:(iw-ow)*${x}:(ih-oh)*${y}`;
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      crop,
    ];
  }
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
  ];
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
  window: ClipWindow;
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
function transformFilters(
  clip: Clip,
  transform: ClipTransform,
  streamOffset = 0,
): string[] {
  const filters: string[] = [];
  const scaleExpr = keyframeExpression(clip.keyframes, "scale", "t", streamOffset);
  if (scaleExpr) {
    filters.push(
      `scale=w='iw*(${scaleExpr})':h='ih*(${scaleExpr})':eval=frame`,
    );
  } else if (transform.scale !== 1) {
    filters.push(`scale=iw*${transform.scale}:ih*${transform.scale}`);
  }
  const rotationExpr = keyframeExpression(clip.keyframes, "rotation", "t", streamOffset);
  if (rotationExpr) {
    filters.push(
      `rotate=angle='(${rotationExpr})*PI/180':ow=iw:oh=ih:c=none`,
    );
  } else if (transform.rotation !== 0) {
    const angle = `${transform.rotation}*PI/180`;
    filters.push(
      `rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none`,
    );
  }
  return filters;
}

/** 不透明度：有关键帧时用 geq 逐帧计算 alpha。 */
function opacityFilters(clip: Clip, opacity: number, streamOffset = 0): string[] {
  const expression = keyframeExpression(clip.keyframes, "opacity", "T", streamOffset);
  if (!expression) {
    return Math.abs(opacity - 1) < 1e-6
      ? []
      : [`colorchannelmixer=aa=${opacity}`];
  }
  return [
    "format=rgba",
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${expression})'`,
    "format=yuva420p",
  ];
}

function slideExpr(
  clip: Clip,
  edge: "in" | "out",
  timeShift = 0,
): { x: string; y: string } {
  const transition = edge === "in" ? clip.transitionIn : clip.transitionOut;
  if (transition?.type !== "slide") return { x: "0", y: "0" };
  const duration = formatSeconds(transition.duration);
  const start = formatSeconds(clip.start - timeShift);
  const end = formatSeconds(clip.start + clip.duration - timeShift);
  const direction = transition.direction ?? "left";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const expr =
    edge === "in"
      ? `if(between(t,${start},${start}+${duration}),${sign * 100}*(1-(t-${start})/${duration}),0)`
      : `if(between(t,${end}-${duration},${end}),${sign * 100}*(1-(${end}-t)/${duration}),0)`;
  return direction === "up" || direction === "down"
    ? { x: "0", y: expr }
    : { x: expr, y: "0" };
}

/** 有位置偏移或滑动转场时，把叠层放在画布中心 + 偏移处。 */
function overlayPosition(
  clip: Clip,
  transform: ClipTransform,
  localStart = clip.start,
  timeShift = 0,
): string {
  const enter = slideExpr(clip, "in", timeShift);
  const exit = slideExpr(clip, "out", timeShift);
  const xKey = keyframeExpression(clip.keyframes, "x", "t", localStart);
  const yKey = keyframeExpression(clip.keyframes, "y", "t", localStart);
  const hasMotion = xKey !== null || yKey !== null;
  const hasSlide =
    enter.x !== "0" || enter.y !== "0" || exit.x !== "0" || exit.y !== "0";
  if (!hasMotion && !hasSlide && isDefaultTransform(transform)) return "";
  const x = `${xKey ?? transform.x}+${enter.x}+${exit.x}`;
  const y = `${yKey ?? transform.y}+${enter.y}+${exit.y}`;
  return (
    `:x='(main_w-overlay_w)/2+(${x})*main_w/100'` +
    `:y='(main_h-overlay_h)/2+(${y})*main_h/100'`
  );
}

export function buildExportPlan(
  project: Project,
  options: ExportOptions,
  textImages: ReadonlyMap<string, string>,
  outputPath: string,
  effectVideos: ReadonlyMap<string, string> = new Map(),
  window?: ExportWindow,
): ExportPlan {
  const fullDuration = projectDuration(project);
  if (!(fullDuration > 0)) throw new Error(t("export.emptyTimeline"));

  let windowStart = 0;
  let duration = fullDuration;
  if (window) {
    windowStart = Math.max(0, window.start);
    const windowEnd = Math.min(window.end, fullDuration);
    duration = windowEnd - windowStart;
    if (!(duration > 0)) throw new Error(t("export.emptyTimeline"));
  }

  const { width, height, fps } = resolveDimensions(project, options);
  const warnings: string[] = [];
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(message);
  };
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

  /** 同一片段在画面与音频阶段共用一份窗口映射。 */
  const clipWindows = new Map<string, ClipWindow | null>();
  function windowOf(clip: Clip): ClipWindow | null {
    if (clipWindows.has(clip.id)) return clipWindows.get(clip.id) ?? null;
    const value = clipWindowOf(clip, clipSpeed(clip), window);
    clipWindows.set(clip.id, value);
    return value;
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
    window: ClipWindow;
  }

  const visualLayers: VisualLayer[] = [];
  /** 已用 ProRes 中间文件替换原始素材的片段：音轨仍要回到原素材。 */
  const bakedClipIds = new Set<string>();

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

      const win = windowOf(clip);
      if (!win) continue;
      const baked = effectVideos.get(clip.id);
      const args = baked
        ? [
            "-ss",
            formatSeconds(win.offsetIntoClip),
            "-t",
            formatSeconds(win.localDuration),
            "-i",
            baked,
          ]
        : asset.kind === "image"
          ? ["-loop", "1", "-t", formatSeconds(win.localDuration), "-i", asset.src]
          : [
              "-ss",
              formatSeconds(win.localIn),
              "-t",
              formatSeconds(win.sourceDuration),
              "-i",
              asset.src,
            ];
      const inputIndex = pushInput(args);
      if (baked) bakedClipIds.add(clip.id);
      preparedVideo.push({ clip, asset, inputIndex });
      visualLayers.push({
        clip,
        inputIndex,
        kind: "video",
        trackIndex,
        window: win,
      });
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
      const win = windowOf(clip);
      if (!win) continue;
      const inputIndex = pushInput([
        "-loop",
        "1",
        "-t",
        formatSeconds(win.localDuration),
        "-i",
        image,
      ]);
      visualLayers.push({ clip, inputIndex, kind: "text", trackIndex, window: win });
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
    const { clip, inputIndex, window: win } = layer;
    const start = formatSeconds(win.localStart);
    const end = formatSeconds(win.localStart + win.localDuration);
    const streamOffset = -win.offsetIntoClip;
    const transform = resolveTransform(clip);
    const opacity = Math.min(1, Math.max(0, clip.opacity ?? 1));
    const fades = windowedFadeFilters(
      clip,
      win.localDuration,
      win.cutsHead,
      win.cutsTail,
      warnings,
    );

    if (layer.kind === "video") {
      const speed = clipSpeed(clip);
      const baked = bakedClipIds.has(clip.id);
      const tail = [
        ...transformFilters(clip, transform, streamOffset),
        ...clipColorFilters(clip),
        ...opacityFilters(clip, opacity, streamOffset),
        ...fades,
        `setpts=PTS-STARTPTS+${start}/TB[v${videoCount}]`,
      ];
      const [scaleFilter, ...fitTail] = fitFilters(
        width,
        height,
        options.fit,
        options.fitAnchor,
      );
      const base = baked
        ? [`[${inputIndex}:v]format=yuva420p`, `fps=${fps}`]
        : [
            `[${inputIndex}:v]${scaleFilter}`,
            ...fitTail,
            "setsar=1",
            ...(speed === 1 ? [] : [`setpts=(PTS-STARTPTS)/${speed}`]),
            `fps=${fps}`,
          ];

      filters.push(
        [base[0], "format=yuva420p", ...base.slice(1), ...tail].join(","),
      );
      filters.push(
        `${videoLabel}[v${videoCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'` +
          `${overlayPosition(clip, transform, win.localStart - win.offsetIntoClip, windowStart)}[vout${videoCount}]`,
      );
      videoLabel = `[vout${videoCount}]`;
      videoCount += 1;
      continue;
    }

    filters.push(
      [
        `[${inputIndex}:v]format=yuva420p`,
        `fps=${fps}`,
        ...transformFilters(clip, transform, streamOffset),
        ...clipColorFilters(clip),
        ...opacityFilters(clip, opacity, streamOffset),
        ...fades,
        `setpts=PTS-STARTPTS+${start}/TB[t${textCount}]`,
      ].join(","),
    );
    filters.push(
      `${videoLabel}[t${textCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'` +
        `${overlayPosition(clip, transform, win.localStart - win.offsetIntoClip, windowStart)}[vtext${textCount}]`,
    );
    videoLabel = `[vtext${textCount}]`;
    textCount += 1;
  }

  // ---- 音频 ----
  // 静帧渲染只 map 视频：必须整段跳过音频链，否则未连接的 anullsrc/anull 会让 ffmpeg 报错。
  const wantsAudio = options.audio !== false && options.format !== "gif";
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

        const win = windowOf(clip);
        if (!win) continue;
        const reused = bakedClipIds.has(clip.id)
          ? undefined
          : videoInputByClip.get(clip.id);
        const inputIndex =
          reused !== undefined
            ? reused
            : pushInput([
                "-ss",
                formatSeconds(win.localIn),
                "-t",
                formatSeconds(win.sourceDuration),
                "-i",
                asset.src,
              ]);
        preparedAudio.push({ clip, inputIndex, window: win });
      }
    }
  }

  preparedAudio.forEach(({ clip, inputIndex, window: win }, index) => {
    const gain = clip.gain ?? 0;
    const delayMs = Math.max(0, Math.round(win.localStart * 1000));
    let fadeIn = Math.min(Math.max(clip.fadeIn ?? 0, 0), win.localDuration);
    if (win.cutsHead && fadeIn > 0) {
      warnOnce(`audio-fade-in:${clip.id}`, `片段 ${clip.id} 的音频淡入被区间截断，已跳过`);
      fadeIn = 0;
    }
    let fadeOut = Math.min(
      Math.max(clip.fadeOut ?? 0, 0),
      Math.max(0, win.localDuration - fadeIn),
    );
    if (win.cutsTail && fadeOut > 0) {
      warnOnce(`audio-fade-out:${clip.id}`, `片段 ${clip.id} 的音频淡出被区间截断，已跳过`);
      fadeOut = 0;
    }
    const pitch = Math.min(12, Math.max(-12, clip.pitch ?? 0));
    const pan = Math.min(1, Math.max(-1, clip.pan ?? 0));
    const speed = clipSpeed(clip);
    const sourceDuration = win.sourceDuration;

    const chain: string[] = [
      `[${inputIndex}:a]atrim=duration=${formatSeconds(sourceDuration)}`,
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
    chain.push(...atempoFilters(speed));
    if (gain !== 0) chain.push(`volume=${gain}dB`);
    if (pan !== 0) {
      const left = pan > 0 ? 1 - pan : 1;
      const right = pan < 0 ? 1 + pan : 1;
      chain.push(`pan=stereo|c0=c0*${left.toFixed(3)}|c1=c1*${right.toFixed(3)}`);
    }
    if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${formatSeconds(fadeIn)}`);
    if (fadeOut > 0) {
      chain.push(
        `afade=t=out:st=${formatSeconds(Math.max(0, win.localDuration - fadeOut))}:` +
          `d=${formatSeconds(fadeOut)}`,
      );
    }
    chain.push(`adelay=${delayMs}:all=1[a${index}]`);
    filters.push(chain.join(","));
  });

  if (window && visualLayers.length === 0 && preparedAudio.length === 0) {
    throw new Error(t("export.emptyTimeline"));
  }

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
  let gifLoop = 0;
  if (options.format === "gif") {
    const colors = Math.min(256, Math.max(2, Math.round(options.gifColors ?? 256)));
    const dither = GIF_DITHERS.includes(options.gifDither) ? options.gifDither : "sierra2_4a";
    gifLoop = Number.isFinite(options.gifLoop) ? Math.max(-1, Math.round(options.gifLoop)) : 0;
    filters.push(
      `${videoLabel}split[g0][g1]`,
      `[g0]palettegen=max_colors=${colors}:stats_mode=diff[pal]`,
      `[g1][pal]paletteuse=dither=${dither}[gifout]`,
    );
    finalVideoLabel = "[gifout]";
  }

  const tail = ["-t", formatSeconds(duration), outputPath];
  // 没有音频链时不能 emit `-map ""`；静帧 / 只出画面时用 `-an`。
  const audioMap = wantsAudio && audioLabel ? ["-map", audioLabel] : [];
  const outputArgs =
    options.format === "mp4"
      ? [
          "-map",
          finalVideoLabel,
          ...audioMap,
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
          ...(wantsAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
          "-movflags",
          "+faststart",
          ...tail,
        ]
      : options.format === "prores"
        ? [
            "-map",
            finalVideoLabel,
            ...audioMap,
            "-c:v",
            "prores_ks",
            "-profile:v",
            "2",
            "-pix_fmt",
            "yuv422p10le",
            "-r",
            String(fps),
            ...(wantsAudio ? ["-c:a", "pcm_s16le", "-ar", "48000"] : ["-an"]),
            ...tail,
          ]
        : ["-map", finalVideoLabel, "-loop", String(gifLoop), "-an", ...tail];

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

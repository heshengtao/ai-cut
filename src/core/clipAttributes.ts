/** 片段「效果属性」的复制、粘贴与重置：不涉及时间、素材与文字内容。 */
import type {
  BlendMode,
  Clip,
  ClipKeyframes,
  ClipShadow,
  ClipStroke,
  ClipTextStyle,
  ClipTransform,
  ClipEffect,
  ClipTransition,
  Project,
} from "@/types/project";
import {
  setClipBlendMode,
  setClipColor,
  setClipCornerRadius,
  setClipFadeIn,
  setClipFadeOut,
  setClipEffects,
  setClipGain,
  setClipKeyframes,
  setClipMuted,
  setClipOpacity,
  setClipPan,
  setClipPitch,
  setClipShadow,
  setClipStroke,
  setClipTextStyle,
  setClipTransform,
  setClipTransition,
  updateClip,
} from "@/core/ops";
import { resolveClipColor, type ResolvedClipColor } from "@/core/clipColor";
import {
  resolveBlendMode,
  resolveCornerRadius,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
} from "@/core/clipStyle";
import { resolveTransform } from "@/core/transform";
import { cloneClipEffects } from "@/core/effects";

export interface ClipAttributes {
  /** 粘贴时会保留原 id（同一片段内不重复即可）。 */
  effects: ClipEffect[];
  opacity: number;
  transform: ClipTransform;
  blendMode: BlendMode;
  stroke: ClipStroke;
  shadow: ClipShadow;
  cornerRadius: number;
  color: ResolvedClipColor;
  /** null：没有入 / 出转场。 */
  transitionIn: ClipTransition | null;
  transitionOut: ClipTransition | null;
  /** null：没有关键帧。 */
  keyframes: ClipKeyframes | null;
  textStyle: ClipTextStyle;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  pitch: number;
  pan: number;
  muted: boolean;
}

function copyKeyframes(clip: Clip): ClipKeyframes | null {
  return clip.keyframes ? clip.keyframes.map((frame) => ({ ...frame })) : null;
}

/** 取片段的实际外观参数（缺省值也会被解析出来），保证粘贴后与源片段一致。 */
export function copyClipAttributes(clip: Clip): ClipAttributes {
  return {
    effects: cloneClipEffects(clip.effects),
    opacity: clip.opacity ?? 1,
    transform: resolveTransform(clip),
    blendMode: resolveBlendMode(clip),
    stroke: resolveStroke(clip),
    shadow: resolveShadow(clip),
    cornerRadius: resolveCornerRadius(clip),
    color: resolveClipColor(clip),
    transitionIn: clip.transitionIn ? { ...clip.transitionIn } : null,
    transitionOut: clip.transitionOut ? { ...clip.transitionOut } : null,
    keyframes: copyKeyframes(clip),
    textStyle: resolveTextStyle(clip),
    gain: clip.gain ?? 0,
    fadeIn: clip.fadeIn ?? 0,
    fadeOut: clip.fadeOut ?? 0,
    pitch: clip.pitch ?? 0,
    pan: clip.pan ?? 0,
    muted: clip.muted ?? false,
  };
}

/** 把一份属性写到片段上；`null` 表示清除转场 / 关键帧。 */
export function applyClipAttributes(
  doc: Project,
  clipId: string,
  attrs: ClipAttributes,
): Project {
  let next = doc;
  next = setClipEffects(next, clipId, cloneClipEffects(attrs.effects));
  next = setClipOpacity(next, clipId, attrs.opacity);
  next = setClipTransform(next, clipId, attrs.transform);
  next = setClipBlendMode(next, clipId, attrs.blendMode);
  next = setClipStroke(next, clipId, attrs.stroke);
  next = setClipShadow(next, clipId, attrs.shadow);
  next = setClipCornerRadius(next, clipId, attrs.cornerRadius);
  next = setClipColor(next, clipId, attrs.color);
  next = setClipTransition(next, clipId, "in", attrs.transitionIn);
  next = setClipTransition(next, clipId, "out", attrs.transitionOut);
  next = setClipKeyframes(next, clipId, attrs.keyframes);
  next = setClipTextStyle(next, clipId, attrs.textStyle);
  next = setClipGain(next, clipId, attrs.gain);
  next = setClipFadeIn(next, clipId, attrs.fadeIn);
  next = setClipFadeOut(next, clipId, attrs.fadeOut);
  next = setClipPitch(next, clipId, attrs.pitch);
  next = setClipPan(next, clipId, attrs.pan);
  next = setClipMuted(next, clipId, attrs.muted);
  return next;
}

const RESET_PATCH: Partial<Clip> = {
  effects: undefined,
  opacity: undefined,
  transform: undefined,
  blendMode: undefined,
  stroke: undefined,
  shadow: undefined,
  cornerRadius: undefined,
  color: undefined,
  transitionIn: undefined,
  transitionOut: undefined,
  keyframes: undefined,
  textStyle: undefined,
  gain: undefined,
  fadeIn: undefined,
  fadeOut: undefined,
  pitch: undefined,
  pan: undefined,
  muted: undefined,
};

/** 清空所有效果属性，回到默认外观；文字内容、时长与播放速度保持不变。 */
export function resetClipAttributes(doc: Project, clipId: string): Project {
  return updateClip(doc, clipId, RESET_PATCH);
}

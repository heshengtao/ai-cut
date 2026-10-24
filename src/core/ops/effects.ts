/** OFX 效果链的不可变操作。 */
import type { ClipEffect, Project } from "@/types/project";
import type { OfxParamValue } from "@/types/plugins";
import { findClip } from "./internal";
import { updateClip } from "./clips";

export function setClipEffects(
  doc: Project,
  clipId: string,
  effects: ClipEffect[] | null,
): Project {
  return updateClip(doc, clipId, {
    effects: effects && effects.length > 0 ? effects : undefined,
  });
}

/** 添加效果；同 id 已存在时替换（多选应用时每个片段各自执行一次）。 */
export function addClipEffect(
  doc: Project,
  clipId: string,
  effect: ClipEffect,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const current = found.clip.effects ?? [];
  const exists = current.some((item) => item.id === effect.id);
  const next = exists
    ? current.map((item) => (item.id === effect.id ? effect : item))
    : [...current, effect];
  return setClipEffects(doc, clipId, next);
}

export function removeClipEffect(
  doc: Project,
  clipId: string,
  effectId: string,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  return setClipEffects(
    doc,
    clipId,
    (found.clip.effects ?? []).filter((effect) => effect.id !== effectId),
  );
}

export function updateClipEffect(
  doc: Project,
  clipId: string,
  effectId: string,
  patch: Partial<ClipEffect>,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  let changed = false;
  const next = (found.clip.effects ?? []).map((effect) => {
    if (effect.id !== effectId) return effect;
    changed = true;
    return { ...effect, ...patch, id: effect.id };
  });
  return changed ? setClipEffects(doc, clipId, next) : doc;
}

export function setClipEffectParams(
  doc: Project,
  clipId: string,
  effectId: string,
  patch: Record<string, OfxParamValue>,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  let changed = false;
  const next = (found.clip.effects ?? []).map((effect) => {
    if (effect.id !== effectId) return effect;
    changed = true;
    return { ...effect, params: { ...effect.params, ...patch } };
  });
  return changed ? setClipEffects(doc, clipId, next) : doc;
}

export function setClipEffectParam(
  doc: Project,
  clipId: string,
  effectId: string,
  name: string,
  value: OfxParamValue,
): Project {
  return setClipEffectParams(doc, clipId, effectId, { [name]: value });
}

export function setClipEffectEnabled(
  doc: Project,
  clipId: string,
  effectId: string,
  enabled: boolean,
): Project {
  return updateClipEffect(doc, clipId, effectId, { enabled });
}

/** 调整效果在链中的顺序；越界时保持不变。 */
export function moveClipEffect(
  doc: Project,
  clipId: string,
  effectId: string,
  delta: number,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const effects = [...(found.clip.effects ?? [])];
  const index = effects.findIndex((effect) => effect.id === effectId);
  if (index < 0) return doc;
  const target = Math.min(effects.length - 1, Math.max(0, index + delta));
  if (target === index) return doc;
  const [item] = effects.splice(index, 1);
  effects.splice(target, 0, item);
  return setClipEffects(doc, clipId, effects);
}

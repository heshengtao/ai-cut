/** OFX 片段效果的纯函数：归一化、默认值、导出规格。 */
import type { Clip, ClipEffect } from "@/types/project";
import type {
  OfxEffectSpec,
  OfxParamInfo,
  OfxParamValue,
  OfxPluginInfo,
} from "@/types/plugins";

/** 不是值参数的类型（用于跳过分组 / 按钮）。 */
const NON_VALUE_TYPES: ReadonlySet<string> = new Set([
  "group",
  "page",
  "pushbutton",
]);

/** 可以挂到片段效果链上的 context。 */
export const OFX_CLIP_EFFECT_CONTEXTS: ReadonlySet<string> = new Set([
  "OfxImageEffectContextFilter",
  "OfxImageEffectContextGeneral",
  "OfxImageEffectContextGenerator",
  "OfxImageEffectContextPaint",
  "OfxImageEffectContextRetimer",
]);

/** 转场 context 只能挂到片段边缘，需要两路输入。 */
export const OFX_TRANSITION_CONTEXT = "OfxImageEffectContextTransition";

export const OFX_RETIMER_CONTEXT = "OfxImageEffectContextRetimer";

/** 全部 6 种 image-effect context（含当前宿主可挂载 / 仅可探测的）。 */
export const OFX_ALL_CONTEXTS: ReadonlySet<string> = new Set([
  ...OFX_CLIP_EFFECT_CONTEXTS,
  OFX_TRANSITION_CONTEXT,
]);

/** 多 context 插件挂到片段时，优先选择能单片段渲染的 context。 */
export function preferredClipContext(plugin: OfxPluginInfo): string | null {
  const priority = [
    "OfxImageEffectContextFilter",
    "OfxImageEffectContextGeneral",
    "OfxImageEffectContextGenerator",
    "OfxImageEffectContextPaint",
    "OfxImageEffectContextRetimer",
  ];
  return (
    priority.find((context) => plugin.contexts.includes(context)) ??
    (plugin.context === "OfxImageEffectContextTransition"
      ? null
      : plugin.context || null)
  );
}

export function isClipEffectPlugin(plugin: OfxPluginInfo): boolean {
  if (plugin.contexts.length === 0) return true;
  return plugin.contexts.some((context) => OFX_CLIP_EFFECT_CONTEXTS.has(context));
}

export function isTransitionPlugin(plugin: OfxPluginInfo): boolean {
  return plugin.contexts.includes(OFX_TRANSITION_CONTEXT);
}

export function isRetimerPlugin(plugin: OfxPluginInfo): boolean {
  return plugin.contexts.includes(OFX_RETIMER_CONTEXT);
}

export function isPaintPlugin(plugin: OfxPluginInfo): boolean {
  return plugin.contexts.includes("OfxImageEffectContextPaint");
}

/**
 * 兼容旧调用：只要插件有任一可挂载 context 就返回 true。
 * 转场插件不再算“可挂到片段”，调用方应使用 isClipEffectPlugin。
 */
export function isMountablePlugin(plugin: OfxPluginInfo): boolean {
  return isClipEffectPlugin(plugin) || isTransitionPlugin(plugin);
}

export function isValueParam(param: OfxParamInfo): boolean {
  return !NON_VALUE_TYPES.has(param.type) && !param.secret;
}

export function isNumberArray(value: OfxParamValue | undefined): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isFinite(item));
}

/** 由宿主驱动、不应出现在用户参数表里的保留参数。 */
const HOST_DRIVEN_PARAMS: ReadonlySet<string> = new Set([
  "Transition",
  "SourceTime",
]);

/** 插件默认参数（仅值参数，跳过宿主驱动的保留参数）。 */
export function defaultEffectParams(
  plugin: OfxPluginInfo,
): Record<string, OfxParamValue> {
  const params: Record<string, OfxParamValue> = {};
  for (const param of plugin.params) {
    if (isValueParam(param) && !HOST_DRIVEN_PARAMS.has(param.name)) {
      params[param.name] = param.default;
    }
  }
  return params;
}

/** 从 JSON 里恢复单个效果；坏条目返回 null。 */
export function normalizeClipEffect(value: unknown): ClipEffect | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.plugin !== "string" || record.plugin === "") return null;
  if (typeof record.bundle !== "string" || record.bundle === "") return null;
  const params: Record<string, OfxParamValue> = {};
  if (typeof record.params === "object" && record.params !== null) {
    for (const [key, raw] of Object.entries(record.params)) {
      if (typeof raw === "number" && Number.isFinite(raw)) params[key] = raw;
      else if (typeof raw === "boolean") params[key] = raw;
      else if (typeof raw === "string") params[key] = raw;
      else if (Array.isArray(raw) && raw.every((v) => Number.isFinite(v))) {
        params[key] = raw as number[];
      }
    }
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
    plugin: record.plugin,
    name:
      typeof record.name === "string" && record.name ? record.name : record.plugin,
    bundle: record.bundle,
    ...(typeof record.context === "string" && record.context
      ? { context: record.context }
      : {}),
    params,
    enabled: record.enabled !== false,
  };
}

/** 从 JSON 里恢复效果数组；坏条目直接丢弃，避免坏工程文件拖垮界面。 */
export function normalizeClipEffects(value: unknown): ClipEffect[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeClipEffect(item))
    .filter((item): item is ClipEffect => item !== null);
}

export function cloneClipEffects(effects: ClipEffect[] | undefined): ClipEffect[] {
  return (effects ?? []).map((effect) => ({
    ...effect,
    params: Object.fromEntries(
      Object.entries(effect.params).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
  }));
}

export function enabledClipEffects(clip: Clip): ClipEffect[] {
  return (clip.effects ?? []).filter((effect) => effect.enabled !== false);
}

export function clipHasEffects(clip: Clip): boolean {
  return enabledClipEffects(clip).length > 0;
}

/** 转成 Rust host 需要的规格；只包含启用的效果。 */
export function clipEffectSpecs(clip: Clip): OfxEffectSpec[] {
  return enabledClipEffects(clip).map((effect) => ({
    bundle: effect.bundle,
    plugin: effect.plugin,
    context: effect.context ?? null,
    params: Object.fromEntries(
      Object.entries(effect.params).filter(
        ([name]) => !HOST_DRIVEN_PARAMS.has(name),
      ),
    ),
  }));
}

/** 判断两个参数值是否一致（数组按元素比较）。 */
export function sameParamValue(
  a: OfxParamValue | undefined,
  b: OfxParamValue | undefined,
): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}


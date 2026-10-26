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

/**
 * 当前宿主能正确挂到单个片段上并预览的 OFX context。
 *
 * - filter / general：单输入滤镜；
 * - generator：忽略输入、直接生成画面；
 * - transition 需要 SourceFrom / SourceTo 两路输入和重叠时间轴；
 *   paint / retimer 需要交互绘制或改变时基 —— 都不在挂载范围内。
 */
export const OFX_MOUNTABLE_CONTEXTS: ReadonlySet<string> = new Set([
  "OfxImageEffectContextFilter",
  "OfxImageEffectContextGeneral",
  "OfxImageEffectContextGenerator",
]);

export function isMountablePlugin(plugin: OfxPluginInfo): boolean {
  if (plugin.contexts.length === 0) return true;
  return plugin.contexts.some((context) => OFX_MOUNTABLE_CONTEXTS.has(context));
}

export function isValueParam(param: OfxParamInfo): boolean {
  return !NON_VALUE_TYPES.has(param.type) && !param.secret;
}

export function isNumberArray(value: OfxParamValue | undefined): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isFinite(item));
}

/** 插件默认参数（仅值参数）。 */
export function defaultEffectParams(
  plugin: OfxPluginInfo,
): Record<string, OfxParamValue> {
  const params: Record<string, OfxParamValue> = {};
  for (const param of plugin.params) {
    if (isValueParam(param)) params[param.name] = param.default;
  }
  return params;
}

/** 从 JSON 里恢复效果数组；坏条目直接丢弃，避免坏工程文件拖垮界面。 */
export function normalizeClipEffects(value: unknown): ClipEffect[] {
  if (!Array.isArray(value)) return [];
  const effects: ClipEffect[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.plugin !== "string" || record.plugin === "") continue;
    if (typeof record.bundle !== "string" || record.bundle === "") continue;
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
    effects.push({
      id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
      plugin: record.plugin,
      name:
        typeof record.name === "string" && record.name
          ? record.name
          : record.plugin,
      bundle: record.bundle,
      ...(typeof record.context === "string" && record.context
        ? { context: record.context }
        : {}),
      params,
      enabled: record.enabled !== false,
    });
  }
  return effects;
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
    params: { ...effect.params },
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


/** 云端生成服务的纯逻辑（能力判定 / 下拉选项 id），方便单测。 */
import type {
  CloudGenPreset,
  CloudGenProvider,
  GenCapability,
} from "@/types/cloudGen";

/** 下拉框里「打开设置」的操作项 id。 */
export const CLOUD_GEN_CONFIG_ACTION = "__configure__";

/** 本地模型 / 云端服务在同一个下拉框里的前缀。 */
export const SOURCE_LOCAL = "local:";
export const SOURCE_CLOUD = "cloud:";

/** 服务实际生效的能力：没显式配置就跟着类型预设走。 */
export function effectiveCapabilities(
  provider: CloudGenProvider,
  presets: CloudGenPreset[],
): GenCapability[] {
  if (provider.capabilities.length > 0) return provider.capabilities;
  return presets.find((preset) => preset.kind === provider.kind)?.capabilities ?? [];
}

export function supportsCapability(
  provider: CloudGenProvider,
  capability: GenCapability,
  presets: CloudGenPreset[],
): boolean {
  return effectiveCapabilities(provider, presets).includes(capability);
}

/** 能在当前模式（文生图 / 图生图 / 视频）里使用的服务。 */
export function providersForCapability(
  providers: CloudGenProvider[],
  capability: GenCapability,
  presets: CloudGenPreset[],
): CloudGenProvider[] {
  return providers.filter(
    (provider) => provider.enabled && supportsCapability(provider, capability, presets),
  );
}

/** `local:<id>` / `cloud:<id>` 拆开；非法值返回 null。 */
export function splitSourceId(
  value: string | null | undefined,
): { kind: "local" | "cloud"; id: string } | null {
  if (!value) return null;
  if (value.startsWith(SOURCE_CLOUD)) {
    const id = value.slice(SOURCE_CLOUD.length);
    return id ? { kind: "cloud", id } : null;
  }
  if (value.startsWith(SOURCE_LOCAL)) {
    const id = value.slice(SOURCE_LOCAL.length);
    return id ? { kind: "local", id } : null;
  }
  return null;
}

export function sourceIdFor(kind: "local" | "cloud", id: string): string {
  return `${kind === "cloud" ? SOURCE_CLOUD : SOURCE_LOCAL}${id}`;
}

/** 「文生图 · 图生图 · 视频」这类摘要（列表里显示）。 */
export function capabilitySummary(
  capabilities: GenCapability[],
  labels: Record<GenCapability | "video", string>,
): string {
  const parts: string[] = [];
  if (capabilities.includes("t2i")) parts.push(labels.t2i);
  if (capabilities.includes("i2i")) parts.push(labels.i2i);
  if (capabilities.includes("t2v") || capabilities.includes("i2v")) parts.push(labels.video);
  return parts.join(" · ");
}

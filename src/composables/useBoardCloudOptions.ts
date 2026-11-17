/**
 * 画布节点表单用的云端配置（只读）。
 *
 * 每个模型节点都有自己的模型下拉，如果各自调一次 `cloud_gen_config`，一张画布
 * 上十个节点就是十次 RPC。这里在模块级缓存同一个 Promise，节点共用一次请求；
 * 失败时返回空数组，节点只显示本地模型，不阻塞渲染。
 */
import { ref } from "vue";
import { cloudGenConfig, cloudGenPresets } from "@/core/cloudGenApi";
import { cloudAsrConfig } from "@/core/cloudAsrApi";
import { cloudTtsConfig } from "@/core/cloudTtsApi";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import type { CloudAsrProvider, CloudTtsProvider } from "@/types/models";

let providers: Promise<CloudGenProvider[]> | null = null;
let presets: Promise<CloudGenPreset[]> | null = null;
let ttsProviders: Promise<CloudTtsProvider[]> | null = null;
let asrProviders: Promise<CloudAsrProvider[]> | null = null;

/**
 * 已经加载好的云端生成服务（响应式）。
 *
 * 画布端口是**动态**的：视频节点选了 MiniMax 才展开 9 图 / 3 音频 / 3 视频，
 * 图像节点按服务类型决定能接几张参考图。`portsOf` 是纯函数，这里把「服务类型」
 * 作为查询回调传进去；列表加载完成时回调的读取会让端口重新计算。
 */
export const boardCloudProviderList = ref<CloudGenProvider[]>([]);
/** 服务类型预设（能力判定的兜底；和上面同一份缓存）。 */
export const boardCloudPresetList = ref<CloudGenPreset[]>([]);

export function boardCloudProviders(): Promise<CloudGenProvider[]> {
  providers ??= cloudGenConfig()
    .then((config) => {
      boardCloudProviderList.value = config.providers ?? [];
      return boardCloudProviderList.value;
    })
    .catch(() => []);
  return providers;
}

/** 云端服务 id → 服务类型（openai / gemini / minimax…）；没加载到就返回 null。 */
export function cloudKindOf(providerId: string): string | null {
  return boardCloudProviderList.value.find((provider) => provider.id === providerId)?.kind ?? null;
}

export function boardCloudPresets(): Promise<CloudGenPreset[]> {
  presets ??= cloudGenPresets()
    .then((list) => {
      boardCloudPresetList.value = list;
      return list;
    })
    .catch(() => []);
  return presets;
}

/** 语音合成节点用：设置 → 语音合成 里的云端服务（和图像 / 视频的不是同一份配置）。 */
export function boardCloudTtsProviders(): Promise<CloudTtsProvider[]> {
  ttsProviders ??= cloudTtsConfig()
    .then((config) => config.providers ?? [])
    .catch(() => []);
  return ttsProviders;
}

/** 语音识别节点用：设置 → 语音识别 里的云端服务。 */
export function boardCloudAsrProviders(): Promise<CloudAsrProvider[]> {
  asrProviders ??= cloudAsrConfig()
    .then((config) => config.providers ?? [])
    .catch(() => []);
  return asrProviders;
}

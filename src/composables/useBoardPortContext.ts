/**
 * 画布动态端口的上下文（多图参考 / H3 多模态 / 音频分离多轨）。
 *
 * 注册表是纯函数，拿不到 Pinia；这里把「本地模型家族」「云端服务类型与能力」
 * 两个查询包成回调传进去。读取的是响应式的模型清单与云端服务列表，模型加载
 * 完成后端口会自动重算。
 */
import { computed, type ComputedRef } from "vue";
import { useModelsStore } from "@/stores/models";
import {
  boardCloudPresetList,
  boardCloudProviderList,
} from "@/composables/useBoardCloudOptions";
import { effectiveCapabilities } from "@/utils/cloudGen";
import { cloudImageRefLimit, type BoardPortContext } from "@/core/board/registry";

/** 非组件环境（运行队列）也能用的同步上下文。 */
export function boardPortContext(): BoardPortContext {
  const models = useModelsStore();
  return {
    cloudKind: (id: string) =>
      boardCloudProviderList.value.find((provider) => provider.id === id)?.kind ?? null,
    modelFamily: (id: string) => models.byId(id)?.family ?? null,
    cloudVideoModel: (id: string) =>
      boardCloudProviderList.value.find((item) => item.id === id)?.video_model ?? null,
    cloudCapabilities: (id: string) => {
      const provider = boardCloudProviderList.value.find((item) => item.id === id);
      if (!provider) return null;
      return effectiveCapabilities(provider, boardCloudPresetList.value);
    },
    cloudImageRefs: (id: string) => {
      const provider = boardCloudProviderList.value.find((item) => item.id === id);
      // 服务列表还没加载：先按单张渲染，加载完再按能力展开。
      if (!provider) return 1;
      if (!provider.enabled) return 0;
      // 只支持文生图的服务不展开多图端口（接了也会被后端拒绝）。
      const capabilities = effectiveCapabilities(provider, boardCloudPresetList.value);
      if (!capabilities.includes("i2i")) return 0;
      return cloudImageRefLimit(provider.kind);
    },
  };
}

/** 组件里用的响应式版本。 */
export function useBoardPortContext(): ComputedRef<BoardPortContext> {
  return computed(() => boardPortContext());
}

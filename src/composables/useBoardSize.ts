/**
 * 画布模型节点的分辨率（输出尺寸）上下文。
 *
 * 注册表 / 纯函数拿不到 Pinia，这里把「本地模型家族」「云端服务类型与模型名」
 * 两个查询包成响应式上下文传给 `core/board/size.ts`；模型清单或云端服务加载
 * 完成后，卡片与检查器的选项会自动重算。
 */
import { computed, type ComputedRef } from "vue";
import { useModelsStore } from "@/stores/models";
import { boardCloudProviderList } from "@/composables/useBoardCloudOptions";
import {
  boardSizePatch,
  boardSizePixels,
  boardSizeSpec,
  boardSizeTier,
  boardSizeValue,
  type BoardSizeInput,
  type BoardSizeMode,
  type BoardSizeOption,
  type BoardSizeSpec,
} from "@/core/board/size";
import { splitModelValue } from "@/core/board/registry";
import type { BoardNode } from "@/types/board";

/** 节点 → 分辨率规格的输入（模型值 + 家族 / 服务类型）。 */
export function boardSizeInputFor(node: BoardNode): BoardSizeInput {
  const kind: "image" | "video" = node.type === "model.video" ? "video" : "image";
  const model = splitModelValue(node.data.params.model);
  if (!model) return { kind };
  if (model.kind === "local") {
    const models = useModelsStore();
    return {
      kind,
      model: node.data.params.model,
      family: models.byId(model.id)?.family ?? null,
    };
  }
  const provider = boardCloudProviderList.value.find((item) => item.id === model.id) ?? null;
  return {
    kind,
    model: node.data.params.model,
    providerKind: provider?.kind ?? null,
    cloudModel: provider
      ? kind === "video"
        ? provider.video_model
        : provider.image_model || provider.edit_model
      : null,
  };
}

/** 同步版：运行队列（非组件环境）也能用。 */
export function boardSizeSpecFor(node: BoardNode): BoardSizeSpec {
  return boardSizeSpec(boardSizeInputFor(node));
}

export interface BoardSizeState {
  spec: ComputedRef<BoardSizeSpec>;
  mode: ComputedRef<BoardSizeMode>;
  selectedId: ComputedRef<string>;
  pixels: ComputedRef<{ width: number; height: number }>;
  tier: ComputedRef<string | null>;
  /** 选中某一档要写回的参数补丁。 */
  patch: (id: string) => Record<string, unknown>;
}

/** 组件里用的响应式版本；`node` 为空时给一份安全的空规格。 */
export function useBoardSize(node: ComputedRef<BoardNode | null | undefined>): BoardSizeState {
  const spec = computed<BoardSizeSpec>(() =>
    node.value
      ? boardSizeSpecFor(node.value)
      : boardSizeSpec({ kind: "image" }),
  );
  const params = computed<Record<string, unknown>>(() => node.value?.data.params ?? {});
  const selectedId = computed(() => boardSizeValue(spec.value, params.value));
  const pixels = computed(() => boardSizePixels(spec.value, params.value));
  const tier = computed(() => boardSizeTier(spec.value, params.value));
  function patch(id: string): Record<string, unknown> {
    return boardSizePatch(spec.value, params.value, id);
  }
  return { spec, mode: computed(() => spec.value.mode), selectedId, pixels, tier, patch };
}

export type { BoardSizeMode, BoardSizeOption, BoardSizeSpec };

import { computed } from "vue";
import type { ModelStatus } from "@/types/models";
import { useModelsStore } from "@/stores/models";
import { useModelChoiceStore } from "@/stores/modelChoice";

/**
 * 一个 AI 功能的「模型档」选择：**记住用户选的那一档**。
 *
 * 以前每个功能各自 `ref<string | null>(null)` + 一个「优先选已装」的 watcher：
 * 用户点了第二档，watcher 一看它还没下载又把选择弹回第一档——「选了白选」，重启后更是全忘。
 * 这里把规则倒过来：用户选过就以它为准（装没装都算），只有它从清单里消失时才回落。
 *
 * @param feature  功能键（首次选择后持久化在这个键下）
 * @param options  候选档（调用方按 feature 过滤）
 * @param fallback 没选过时的默认规则（各功能不一样：推荐档 / UVR 优先 / 已装优先……）
 */
export function useModelChoice(
  feature: string,
  options: () => ModelStatus[],
  fallback?: (list: ModelStatus[]) => ModelStatus | null,
) {
  const store = useModelChoiceStore();
  const models = useModelsStore();

  const list = computed(options);

  /** 用户选过、且清单里还有的那一档。 */
  const chosen = computed(() => {
    const saved = store.get(feature);
    return saved ? (list.value.find((model) => model.id === saved) ?? null) : null;
  });

  /** 实际生效的那一档：用户选的 → 该功能的默认 → 已装的 → 第一个。 */
  const current = computed(
    () =>
      chosen.value ??
      (fallback ? fallback(list.value) : null) ??
      list.value.find((model) => model.installed) ??
      list.value[0] ??
      null,
  );

  /** 给 `v-model` 用的可写 id（写回持久化的选择）。 */
  const id = computed<string | null>({
    get: () => current.value?.id ?? null,
    set: (value) => store.set(feature, value),
  });

  const ready = computed(() => Boolean(current.value?.installed));
  const downloading = computed(() =>
    current.value ? models.busyId === current.value.id : false,
  );

  return { list, current, id, ready, downloading };
}

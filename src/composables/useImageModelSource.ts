/**
 * 图像生成 / 图像编辑各自的一套「模型来源」选择。
 *
 * 两页共用同一批 sd.cpp 图像模型，但**候选清单不同**：
 * - 画图页只列 `draw` 能力的家族；
 * - 图像编辑页只列 `edit` 能力的家族（FLUX Kontext / Qwen-Image-Edit 只在这里出现）。
 *
 * 本地的「用户上次选的那一档」也按页分别记住（`image-gen` / `image-edit`），
 * 所以从画图页切到编辑页不会把 SDXL 带过去。
 */
import { computed, type ComputedRef, type WritableComputedRef } from "vue";
import type { SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";
import { useModelChoice } from "@/composables/useModelChoice";
import { useModelChoiceStore } from "@/stores/modelChoice";
import { useModelsStore } from "@/stores/models";
import { humanSize, missingBytes } from "@/utils/size";
import {
  CLOUD_GEN_CONFIG_ACTION,
  providersForCapability,
  sourceIdFor,
  splitSourceId,
} from "@/utils/cloudGen";
import { imageModelSupports, type ImageGenMode } from "@/types/imageGen";
import type { CloudGenPreset, CloudGenProvider } from "@/types/cloudGen";
import type { ModelStatus } from "@/types/models";

export interface ImageModelSource {
  mode: ImageGenMode;
  /** 持久化键：`image-gen` / `image-edit`。 */
  featureKey: string;
  /** 云端服务选择的持久化键（`<featureKey>-cloud`）。 */
  cloudKey: string;
  /** 本页可用的本地模型（已按 draw / edit 过滤）。 */
  localModels: ComputedRef<ModelStatus[]>;
  choice: ReturnType<typeof useModelChoice>;
  cloudChoices: ComputedRef<CloudGenProvider[]>;
  cloudProvider: ComputedRef<CloudGenProvider | null>;
  cloudSelected: ComputedRef<boolean>;
  /** 下拉框统一值：`local:<id>` / `cloud:<id>`。 */
  sourceId: WritableComputedRef<string | null>;
  options: ComputedRef<SelectOption[]>;
  /** 当前本地模型还差多少字节（已装 = 0）。 */
  missing: ComputedRef<number>;
  downloading: ComputedRef<boolean>;
  ready: ComputedRef<boolean>;
}

export function useImageModelSource(config: {
  mode: ImageGenMode;
  providers: () => CloudGenProvider[];
  presets: () => CloudGenPreset[];
}): ImageModelSource {
  const i18n = useI18n();
  const models = useModelsStore();
  const modelChoice = useModelChoiceStore();
  const mode = config.mode;
  const featureKey = mode === "edit" ? "image-edit" : "image-gen";
  const cloudKey = `${featureKey}-cloud`;
  const capability = mode === "edit" ? "i2i" : "t2i";

  const localModels = computed(() =>
    models.catalog.filter(
      (model) =>
        model.feature === "image-gen" && imageModelSupports(model.family, mode),
    ),
  );

  const choice = useModelChoice(featureKey, () => localModels.value, (list) => {
    // 默认档对两页都友好：Z-Image 既会画图也能整图重绘；没装就优先已装。
    return (
      list.find((model) => model.id === "z-image-turbo") ??
      list.find((model) => model.installed) ??
      list[0] ??
      null
    );
  });

  const cloudChoices = computed(() =>
    providersForCapability(config.providers(), capability, config.presets()),
  );
  const cloudProvider = computed(
    () => cloudChoices.value.find((provider) => provider.id === modelChoice.get(cloudKey)) ?? null,
  );
  const cloudSelected = computed(() => cloudProvider.value !== null);

  const sourceId = computed<string | null>({
    get: () => {
      if (cloudProvider.value) return sourceIdFor("cloud", cloudProvider.value.id);
      return choice.current.value ? sourceIdFor("local", choice.current.value.id) : null;
    },
    set: (value) => {
      const parsed = splitSourceId(value);
      if (!parsed) return;
      if (parsed.kind === "cloud") {
        modelChoice.set(cloudKey, parsed.id);
      } else {
        modelChoice.set(cloudKey, null);
        choice.id.value = parsed.id;
      }
    },
  });

  /** 云端服务在编辑页优先用 edit_model，画图页用 image_model。 */
  function cloudModelOf(provider: CloudGenProvider): string {
    return mode === "edit"
      ? provider.edit_model || provider.image_model
      : provider.image_model;
  }

  const options = computed<SelectOption[]>(() => {
    const list: SelectOption[] = [
      {
        id: CLOUD_GEN_CONFIG_ACTION,
        label: i18n.t("aiImage.configure"),
        hint: i18n.t("aiImage.configureHint"),
        action: true,
      },
    ];
    for (const model of localModels.value) {
      list.push({
        id: sourceIdFor("local", model.id),
        label: model.name,
        group: i18n.t("aiImage.groupLocal"),
        hint: model.installed
          ? i18n.t("aiVideo.modelReady", { size: humanSize(model.approx_bytes) })
          : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
      });
    }
    for (const provider of cloudChoices.value) {
      const model = cloudModelOf(provider);
      list.push({
        id: sourceIdFor("cloud", provider.id),
        label: provider.name,
        group: i18n.t("aiImage.groupCloud"),
        hint: `${i18n.t(`settings.gen.kind.${provider.kind}`)}${model ? ` · ${model}` : ""}`,
      });
    }
    return list;
  });

  const missing = computed(() =>
    choice.current.value ? missingBytes(choice.current.value) : 0,
  );
  const downloading = computed(() =>
    choice.current.value ? models.busyId === choice.current.value.id : false,
  );
  const ready = computed(() => choice.current.value?.installed === true);

  return {
    mode,
    featureKey,
    cloudKey,
    localModels,
    choice,
    cloudChoices,
    cloudProvider,
    cloudSelected,
    sourceId,
    options,
    missing,
    downloading,
    ready,
  };
}

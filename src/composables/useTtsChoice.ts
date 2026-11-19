/**
 * **本地 / 云端 TTS 来源的统一选择**（AI 朗读、音频翻译配音共用）。
 *
 * 两处必须显示同一份列表：本地模型（带缺失体积提示）+ 已启用的云端服务，
 * 第一项是「配置 TTS 服务…」动作。选择按 `feature` 各记一份：
 * 朗读用 `tts`，翻译配音用 `tts-dub`，互不覆盖。
 */
import { computed } from "vue";
import type { SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";
import { useModelsStore } from "@/stores/models";
import { useModelChoiceStore } from "@/stores/modelChoice";
import { useTtsStore } from "@/stores/tts";
import { humanSize, missingBytes } from "@/utils/size";

export const LOCAL_TTS = "local:";
export const CLOUD_TTS = "cloud:";
export const TTS_SETTINGS_ACTION = "tts-settings";

export type TtsSourceKind = "local" | "cloud";

export function useTtsChoice(feature: string) {
  const i18n = useI18n();
  const models = useModelsStore();
  const tts = useTtsStore();
  const modelChoice = useModelChoiceStore();

  const list = computed(() => models.catalog.filter((model) => model.feature === "tts"));
  const codec = computed(
    () => models.catalog.find((model) => model.feature === "tts-codec") ?? null,
  );
  const providers = computed(() => tts.providers.filter((provider) => provider.enabled));

  /** 下拉里的全部候选 id（本地模型 / 云端服务用前缀区分）。 */
  const optionIds = computed(() => [
    ...list.value.map((model) => `${LOCAL_TTS}${model.id}`),
    ...providers.value.map((provider) => `${CLOUD_TTS}${provider.id}`),
  ]);

  /**
   * 选过的来源：选过哪个跨会话记住。
   * 没选过时：已装的本地模型 → 云端 → 第一个本地模型。
   */
  const selectedId = computed<string | null>({
    get: () => {
      const saved = modelChoice.get(feature);
      if (saved && optionIds.value.includes(saved)) return saved;
      const installed = list.value.find((model) => model.installed);
      if (installed) return `${LOCAL_TTS}${installed.id}`;
      const cloud = providers.value[0];
      if (cloud) return `${CLOUD_TTS}${cloud.id}`;
      return list.value[0] ? `${LOCAL_TTS}${list.value[0].id}` : null;
    },
    set: (value) => modelChoice.set(feature, value),
  });

  const kind = computed<TtsSourceKind>(() =>
    selectedId.value?.startsWith(CLOUD_TTS) ? "cloud" : "local",
  );
  const sourceId = computed(() => {
    const value = selectedId.value ?? "";
    if (value.startsWith(CLOUD_TTS)) return value.slice(CLOUD_TTS.length);
    if (value.startsWith(LOCAL_TTS)) return value.slice(LOCAL_TTS.length);
    return value;
  });
  const model = computed(() =>
    kind.value === "local"
      ? list.value.find((item) => item.id === sourceId.value) ?? null
      : null,
  );
  const provider = computed(() =>
    kind.value === "cloud"
      ? providers.value.find((item) => item.id === sourceId.value) ?? null
      : null,
  );

  /** MOSS 家族还需要音频编解码器；其它家族不依赖。 */
  const codecRequired = computed(
    () => kind.value === "local" && model.value?.family === "moss_tts_nano",
  );

  const missing = computed(() => {
    if (kind.value === "cloud") return 0;
    const modelMissing = model.value ? missingBytes(model.value) : 0;
    const codecMissing =
      codecRequired.value && codec.value ? missingBytes(codec.value) : 0;
    return modelMissing + codecMissing;
  });

  const ready = computed(() => {
    if (kind.value === "cloud") return Boolean(provider.value);
    return Boolean(
      model.value?.installed && (!codecRequired.value || codec.value?.installed),
    );
  });

  const downloading = computed(
    () =>
      kind.value === "local" &&
      (models.busyId === model.value?.id ||
        (codecRequired.value && codec.value !== null && models.busyId === codec.value.id)),
  );

  const options = computed<SelectOption[]>(() => {
    const items: SelectOption[] = [
      {
        id: TTS_SETTINGS_ACTION,
        label: i18n.t("ai.ttsSettings"),
        hint: i18n.t("ai.ttsSettingsHint"),
        action: true,
      },
    ];
    for (const item of list.value) {
      items.push({
        id: `${LOCAL_TTS}${item.id}`,
        label: item.name,
        group: i18n.t("ai.voiceoverLocal"),
        hint: item.installed
          ? i18n.t("ai.modelReady")
          : i18n.t("ai.modelNeedsDownload", { size: humanSize(missingBytes(item)) }),
      });
    }
    for (const item of providers.value) {
      items.push({
        id: `${CLOUD_TTS}${item.id}`,
        label: item.name,
        group: i18n.t("ai.voiceoverCloud"),
        hint: item.voice
          ? i18n.t("ai.voiceoverCloudVoice", { voice: item.voice })
          : i18n.t("ai.voiceoverCloudHint"),
      });
    }
    return items;
  });

  return {
    list,
    codec,
    providers,
    selectedId,
    kind,
    sourceId,
    model,
    provider,
    codecRequired,
    missing,
    ready,
    downloading,
    options,
  };
}

<script setup lang="ts">
/**
 * **AI 变声**：选音色 + 选模型，一次转换整批片段。
 *
 * 页面只收集参数；转换、进度、落位都在 `core/aiActions.convertVoice` 与后端
 * `voice_change_convert` 里。音色存在全局音色库（`<数据目录>/voices/`），
 * 参考音频由后端自动截取有声的 10 秒并算好 256 维向量。
 */
import { computed, onMounted, ref, watch } from "vue";
import { ArrowLeftIcon, TrashIcon } from "@heroicons/vue/24/outline";
import DownloadStrip from "@/components/ai/DownloadStrip.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import { useVoiceChangeStore } from "@/stores/voiceChange";
import { deleteVoice, importVoice, listVoices } from "@/core/voiceChangeApi";
import { convertVoice } from "@/core/aiActions";
import { toast } from "@/composables/useToast";
import { humanSize, missingBytes } from "@/utils/size";
import type { VoiceEntry } from "@/types/voiceChange";

const props = defineProps<{ clipIds?: string[] }>();
const emit = defineEmits<{ (e: "back"): void }>();

const i18n = useI18n();
const models = useModelsStore();
const project = useProjectStore();
const store = useVoiceChangeStore();

const voices = ref<VoiceEntry[]>([]);
const pending = ref<string[]>(props.clipIds ?? []);
/** 「从媒体库选…」下拉的临时值，导入后清空。 */
const importAssetId = ref<string | null>(null);

interface Row {
  id: string;
  name: string;
  start: number;
  duration: number;
}

const rows = computed<Row[]>(() => {
  const doc = project.doc;
  const out: Row[] = [];
  for (const id of pending.value) {
    for (const track of doc.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === id);
      if (!clip) continue;
      const asset = doc.assets.find((candidate) => candidate.id === clip.assetId);
      out.push({
        id,
        name: asset?.name ?? id,
        start: clip.start,
        duration: clip.duration,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
});

const audioAssets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === "audio" || asset.kind === "video"),
);

const audioOptions = computed<SelectOption[]>(() =>
  audioAssets.value.map((asset) => ({ id: asset.id, label: asset.name })),
);

const modelOptions = computed<SelectOption[]>(() =>
  models.ofFeature("voice-change").map((model) => ({
    id: model.id,
    label: model.name,
    hint: model.installed
      ? i18n.t("aiVideo.modelReady", { size: humanSize(model.approx_bytes) })
      : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
  })),
);

const model = computed(() => models.byId(store.modelId));
const modelReady = computed(() => model.value?.installed === true);
const modelMissing = computed(() => (model.value ? missingBytes(model.value) : 0));
const downloading = computed(() => models.busyId === store.modelId);
const canRun = computed(
  () => !store.running && modelReady.value && Boolean(store.voiceId) && rows.value.length > 0,
);

const statusLine = computed(() => {
  if (!rows.value.length) return i18n.t("ai.voiceEmpty");
  if (!modelReady.value) return i18n.t("ai.voiceEncoding");
  if (!store.voiceId) return i18n.t("ai.voiceNoVoice");
  return `${rows.value.length} · ${model.value?.name ?? ""}`;
});

async function refresh(): Promise<void> {
  try {
    voices.value = await listVoices();
    if (!store.voiceId && voices.value.length > 0) store.voiceId = voices.value[0].id;
  } catch (error) {
    toast(String(error), "error");
  }
}

async function importFrom(assetId: string | null): Promise<void> {
  if (!assetId) return;
  const asset = project.doc.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return;
  try {
    const entry = await importVoice(asset.src, asset.name.replace(/\.[^.]+$/, ""));
    await refresh();
    store.voiceId = entry.id;
    toast(i18n.t("ai.voiceImported", { name: entry.name }));
  } catch (error) {
    toast(String(error), "error", { timeout: 8000 });
  } finally {
    importAssetId.value = null;
  }
}

async function removeVoice(entry: VoiceEntry): Promise<void> {
  try {
    await deleteVoice(entry.id);
    if (store.voiceId === entry.id) store.voiceId = null;
    await refresh();
  } catch (error) {
    toast(String(error), "error");
  }
}

function removeRow(id: string): void {
  pending.value = pending.value.filter((candidate) => candidate !== id);
}

async function run(): Promise<void> {
  if (!canRun.value || !store.voiceId) return;
  store.start(rows.value.length);
  try {
    await convertVoice(
      { clipIds: pending.value, voiceId: store.voiceId, modelId: store.modelId },
      { cancelled: () => false, actor: "human" },
    );
    toast(i18n.t("menu.aiDone", { name: i18n.t("ai.voiceChange") }));
  } catch (error) {
    toast(String(error), "error", { timeout: 9000 });
  } finally {
    store.finish();
  }
}

onMounted(() => {
  void models.load();
  void refresh();
});

watch(
  () => props.clipIds,
  (ids) => {
    if (ids) pending.value = ids;
  },
);
</script>

<template>
  <div class="voice-page">
    <header class="head">
      <button
        class="icon-btn"
        type="button"
        :aria-label="i18n.t('common.back')"
        @click="emit('back')"
      >
        <ArrowLeftIcon class="w-[15px] h-[15px]" />
      </button>
      <div class="head-text">
        <h1 class="title">{{ i18n.t("ai.voiceChange") }}</h1>
        <p class="sub">{{ statusLine }}</p>
      </div>
      <span v-if="store.running" class="badge on">{{ store.index }}/{{ store.total }}</span>
    </header>

    <DownloadStrip />

    <section class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("ai.voiceLibrary") }}</span>
      </div>
      <ul class="voices">
        <li v-for="voice in voices" :key="voice.id" class="voice-row">
          <button
            class="voice"
            type="button"
            :class="{ on: store.voiceId === voice.id }"
            @click="store.voiceId = voice.id"
          >
            <span class="name">{{ voice.name }}</span>
            <span class="meta">{{ voice.duration.toFixed(1) }}s</span>
          </button>
          <button class="icon-btn" type="button" @click="removeVoice(voice)">
            <TrashIcon class="w-[14px] h-[14px]" />
          </button>
        </li>
      </ul>
      <Md3Select
        v-model="importAssetId"
        :options="audioOptions"
        :label="i18n.t('ai.voiceFromMedia')"
        :empty="i18n.t('ai.voiceNoAudio')"
        @update:model-value="importFrom"
      />
    </section>

    <section class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("ai.voiceModel") }}</span>
      </div>
      <Md3Select
        v-model="store.modelId"
        :options="modelOptions"
        :label="i18n.t('ai.voiceModel')"
        :disabled="store.running"
      />
      <p v-if="!modelReady" class="warn">
        {{ i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(modelMissing) }) }}
        <button
          class="link"
          type="button"
          :disabled="downloading"
          @click="void models.download(store.modelId)"
        >
          {{ i18n.t("ai.voiceDownload") }}
        </button>
      </p>
    </section>

    <section class="card">
      <div class="card-head">
        <span class="card-title">{{ i18n.t("ai.voicePickClips") }}</span>
      </div>
      <ul class="clips">
        <li v-for="row in rows" :key="row.id" class="clip-row">
          <span class="name">{{ row.name }}</span>
          <span class="meta">{{ row.start.toFixed(2) }}s · {{ row.duration.toFixed(2) }}s</span>
          <button class="icon-btn" type="button" @click="removeRow(row.id)">
            <TrashIcon class="w-[14px] h-[14px]" />
          </button>
        </li>
      </ul>
      <p v-if="rows.length === 0" class="warn">{{ i18n.t("ai.voiceEmpty") }}</p>
    </section>

    <footer class="dock">
      <progress :value="store.progress" max="1" />
      <button class="run" type="button" :disabled="!canRun" @click="run">
        {{ i18n.t("ai.voiceChangeRun") }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.voice-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-text {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 15px;
  font-weight: 600;
}

.sub {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: rgb(var(--md-on-surface-variant));
}

.icon-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
}

.badge.on {
  background-color: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container));
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--md-on-surface-variant));
}

.voices,
.clips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.voice-row,
.clip-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.voice {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background-color: rgb(var(--md-surface-container-high));
  text-align: left;
}

.voice.on {
  outline: 2px solid rgb(var(--md-primary) / 0.5);
  background-color: rgb(var(--md-primary-container) / 0.6);
}

.clip-row {
  padding: 6px 8px;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-high));
}

.name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
  flex-shrink: 0;
}

.warn {
  font-size: 12px;
  color: rgb(var(--md-error, 220 80 80));
}

.link {
  color: rgb(var(--md-primary));
  text-decoration: underline;
}

.dock {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
}

.dock progress {
  flex: 1;
  height: 6px;
}

.run {
  padding: 8px 16px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 13px;
  font-weight: 600;
}

.run:disabled {
  opacity: 0.5;
}
</style>

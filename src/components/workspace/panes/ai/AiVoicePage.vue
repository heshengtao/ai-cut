<script setup lang="ts">
/**
 * **AI 变声**：选音色 + 选模型，一次转换整批片段。
 *
 * 页面只收集参数；转换、进度、落位都在 `core/aiActions.convertVoice` 与后端
 * `voice_change_convert` 里。音色存在全局音色库（`<数据目录>/voices/`），
 * 参考音频由后端自动截取有声的 10 秒并算好 256 维向量。
 */
import { computed, onMounted, ref, watch } from "vue";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "@heroicons/vue/24/outline";
import AiSetupDialog from "@/components/ai/AiSetupDialog.vue";
import DownloadStrip from "@/components/ai/DownloadStrip.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import ModalShell from "@/components/common/ModalShell.vue";
import { confirm } from "@/composables/useConfirm";
import { useVoiceSetup } from "@/composables/useAiSetup";
import { useI18n } from "@/i18n";
import { useDeviceStore } from "@/stores/device";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useVoiceChangeStore } from "@/stores/voiceChange";
import { deleteVoice, importVoice, listVoices } from "@/core/voiceChangeApi";
import { convertVoice } from "@/core/aiActions";
import { toast } from "@/composables/useToast";
import { humanSize, missingBytes } from "@/utils/size";
import type { Clip, MediaAsset } from "@/types/project";
import type { VoiceEntry } from "@/types/voiceChange";

const props = defineProps<{ clipIds?: string[]; importClipId?: string }>();
const emit = defineEmits<{ (e: "back"): void }>();

const i18n = useI18n();

const models = useModelsStore();
const project = useProjectStore();
const selection = useSelectionStore();
const store = useVoiceChangeStore();
const device = useDeviceStore();
const setup = useVoiceSetup(() => store.modelId);
const setupOpen = setup.open;
const setupPlan = setup.plan;
const setupForced = setup.forced;

const voices = ref<VoiceEntry[]>([]);
const pending = ref<string[]>(props.clipIds ?? []);

// ---- 导入音色 -------------------------------------------------------------

const importOpen = ref(false);
const importBusy = ref(false);
const importAssetId = ref<string | null>(null);
const importName = ref("");
const importStart = ref<number | null>(null);
const importDuration = ref<number | null>(null);
/** 从片段导入时显示「素材 · 起点」，从媒体库整段导入时为 null。 */
const importClipLabel = ref<string | null>(null);

const audioAssets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === "audio" || asset.kind === "video"),
);
const audioOptions = computed<SelectOption[]>(() =>
  audioAssets.value.map((asset) => ({ id: asset.id, label: asset.name })),
);

const canConfirmImport = computed(
  () =>
    !importBusy.value &&
    importAssetId.value !== null &&
    importName.value.trim() !== "",
);

function clipAudioAsset(clipId: string): { clip: Clip; asset: MediaAsset } | null {
  for (const track of project.doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (!clip || clip.assetId === "") continue;
    const asset = project.doc.assets.find((candidate) => candidate.id === clip.assetId);
    if (!asset || (asset.kind !== "audio" && asset.kind !== "video")) return null;
    return { clip, asset };
  }
  return null;
}

function useClip(clipId: string): void {
  const found = clipAudioAsset(clipId);
  if (!found) return;
  importAssetId.value = found.asset.id;
  importName.value = found.asset.name.replace(/\.[^.]+$/, "");
  importStart.value = found.clip.in ?? 0;
  importDuration.value = found.clip.duration;
  importClipLabel.value = `${found.asset.name} · ${found.clip.start.toFixed(2)}s`;
}

function openImport(clipId?: string): void {
  importAssetId.value = null;
  importName.value = "";
  importStart.value = null;
  importDuration.value = null;
  importClipLabel.value = null;
  importOpen.value = true;
  if (clipId) useClip(clipId);
}

/** 媒体库选整段：清掉片段入点/时长，让后端自己找有声窗口。 */
function pickAsset(assetId: string | null): void {
  if (!assetId) return;
  const asset = project.doc.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return;
  importAssetId.value = asset.id;
  importName.value = asset.name.replace(/\.[^.]+$/, "");
  importStart.value = null;
  importDuration.value = null;
  importClipLabel.value = null;
}

function useSelection(): void {
  const clipId = selection.selectedClipIds.find((id) => clipAudioAsset(id) !== null);
  if (!clipId) {
    toast(i18n.t("ai.voicePickClips"));
    return;
  }
  openImport(clipId);
}

async function confirmImport(): Promise<void> {
  if (!canConfirmImport.value || !importAssetId.value) return;
  const asset = project.doc.assets.find((candidate) => candidate.id === importAssetId.value);
  if (!asset) return;
  importBusy.value = true;
  try {
    const entry = await importVoice(
      asset.src,
      importName.value.trim(),
      importStart.value,
      importDuration.value,
    );
    importOpen.value = false;
    await refresh();
    store.voiceId = entry.id;
    toast(i18n.t("ai.voiceImported", { name: entry.name }));
  } catch (error) {
    toast(String(error), "error", { timeout: 9000 });
  } finally {
    importBusy.value = false;
  }
}

async function removeVoice(entry: VoiceEntry): Promise<void> {
  const ok = await confirm({
    title: i18n.t("ai.voiceConfirmDelete", { name: entry.name }),
    confirmText: i18n.t("ai.voiceDelete"),
    destructive: true,
  });
  if (!ok) return;
  try {
    await deleteVoice(entry.id);
    if (store.voiceId === entry.id) store.voiceId = null;
    await refresh();
  } catch (error) {
    toast(String(error), "error");
  }
}

// ---- 待处理片段 / 模型 ----------------------------------------------------

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
/** 当前生效的 ONNX 后端是否齐了；CPU 是随包内置的，所以拿不到信息时按就绪处理。 */
const engineReady = computed(() => {
  const info = device.info;
  if (!info) return true;
  const option = info.options.find((item) => item.kind === info.preference);
  // 平台不支持的后端会回落到 CPU，不算缺引擎。
  return !option || !option.available || (option.runtime_installed && option.missing.length === 0);
});
const voiceReady = computed(() => engineReady.value && modelReady.value);
const canRun = computed(
  () => !store.running && voiceReady.value && Boolean(store.voiceId) && rows.value.length > 0,
);

const statusLine = computed(() => {
  if (!rows.value.length) return i18n.t("ai.voiceEmpty");
  if (!engineReady.value) return i18n.t("ai.voiceNeedRuntime");
  if (!modelReady.value) return i18n.t("ai.voiceEncoding");
  if (!store.voiceId) return i18n.t("ai.voiceNoVoice");
  return `${rows.value.length} · ${model.value?.name ?? ""}`;
});

/** 缺运行时 / 模型就弹和视频、画图同一套「准备」向导，装完留在本页继续。 */
function prepare(): void {
  void setup.ensure();
}

async function refresh(): Promise<void> {
  try {
    voices.value = await listVoices();
    if (!store.voiceId && voices.value.length > 0) store.voiceId = voices.value[0].id;
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

/** 主按钮：能跑就直接跑；缺运行时 / 模型先补依赖，和视频 / 画图页一致。 */
function runPrimary(): void {
  if (store.running) return;
  if (!voiceReady.value) {
    prepare();
    return;
  }
  if (!store.voiceId) {
    toast(i18n.t("ai.voiceNoVoice"));
    return;
  }
  if (rows.value.length === 0) {
    toast(i18n.t("ai.voiceEmpty"));
    return;
  }
  void run();
}

onMounted(async () => {
  void models.load();
  void device.load();
  await refresh();
  if (props.importClipId) openImport(props.importClipId);
});

watch(
  () => props.clipIds,
  (ids) => {
    if (ids) pending.value = ids;
  },
);

watch(
  () => props.importClipId,
  (id) => {
    if (id) openImport(id);
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
        <div class="card-actions">
          <button class="text-btn" type="button" :disabled="store.running" @click="useSelection">
            {{ i18n.t("ai.voiceUseSelection") }}
          </button>
          <button class="primary-btn" type="button" :disabled="store.running" @click="openImport()">
            <PlusIcon class="w-[13px] h-[13px]" />
            {{ i18n.t("ai.voiceImportTitle") }}
          </button>
        </div>
      </div>

      <ul v-if="voices.length > 0" class="voices">
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
          <button class="text-btn danger" type="button" @click="removeVoice(voice)">
            {{ i18n.t("ai.voiceDelete") }}
          </button>
        </li>
      </ul>
      <p v-else class="hint">{{ i18n.t("ai.voiceLibraryEmpty") }}</p>
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
      <p v-if="!engineReady" class="warn">
        {{ i18n.t("ai.voiceNeedRuntime") }}
        <button class="text-btn" type="button" @click="prepare">
          {{ i18n.t("ai.prepare") }}
        </button>
      </p>
      <p v-if="!modelReady" class="warn">
        {{ i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(modelMissing) }) }}
        <button class="text-btn" type="button" :disabled="downloading" @click="prepare">
          {{ i18n.t("ai.prepare") }}
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
      <!-- 只有真的在跑才画进度条：空闲时那条灰色轨道在按钮左边很突兀。 -->
      <div
        v-if="store.running"
        class="progress"
        role="progressbar"
        :aria-valuenow="store.progressPct"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="progress-fill" :style="{ width: `${store.progressPct}%` }" />
      </div>
      <button class="run" type="button" :disabled="store.running" @click="runPrimary">
        {{ i18n.t(voiceReady ? "ai.voiceChangeRun" : "ai.prepare") }}
      </button>
    </footer>

    <AiSetupDialog
      :open="setupOpen"
      :plan="setupPlan"
      :dismissible="!setupForced"
      @update:open="(value: boolean) => (value ? undefined : setup.cancel())"
      @cancel="setup.cancel()"
      @confirm="setup.confirm()"
      @background="setup.confirmBackground()"
      @cancel-download="setup.cancelDownload()"
      @choose="setup.choose"
    />

    <ModalShell
      :open="importOpen"
      :title="i18n.t('ai.voiceImportTitle')"
      width="460px"
      @update:open="importOpen = $event"
    >
      <div class="form">
        <label class="field">
          <span class="field-name">{{ i18n.t("ai.voiceSource") }}</span>
          <Md3Select
            :model-value="importAssetId"
            :options="audioOptions"
            :label="i18n.t('ai.voiceFromMedia')"
            :empty="i18n.t('ai.voiceNoAudio')"
            @update:model-value="pickAsset"
          />
        </label>
        <p v-if="importClipLabel" class="hint">{{ importClipLabel }}</p>
        <label class="field">
          <span class="field-name">{{ i18n.t("ai.voiceName") }}</span>
          <input v-model="importName" class="text-input" type="text" maxlength="40" />
        </label>
        <p class="hint">{{ i18n.t("ai.voiceImportHint") }}</p>
      </div>
      <template #foot>
        <button class="text-btn" type="button" @click="importOpen = false">
          {{ i18n.t("common.cancel") }}
        </button>
        <button class="primary-btn" type="button" :disabled="!canConfirmImport" @click="confirmImport">
          {{ i18n.t("ai.voiceImportTitle") }}
        </button>
      </template>
    </ModalShell>
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
  gap: 8px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
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

.hint {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}

.text-btn {
  font-size: 12px;
  color: rgb(var(--md-primary));
  padding: 4px 6px;
  border-radius: 8px;
}

.text-btn:hover {
  background-color: rgb(var(--md-primary) / var(--md-state-hover-alpha));
}

.text-btn.danger {
  color: rgb(var(--md-error, 220 80 80));
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}

.primary-btn:disabled {
  opacity: 0.5;
}

.dock {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
}

/* MD3 线性进度：圆角轨道 + 主色填充；空闲时整个元素不渲染。 */
.progress {
  flex: 1;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}

.run {
  margin-left: auto;
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

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-name {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}

.text-input {
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 13px;
  background-color: rgb(var(--md-surface-container-high));
  border: 1px solid rgb(var(--md-outline, 128 128 128) / 0.3);
  color: rgb(var(--md-on-surface));
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.text-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
</style>

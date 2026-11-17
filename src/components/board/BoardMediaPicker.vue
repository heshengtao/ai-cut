<script setup lang="ts">
/**
 * 画布素材选择器（MD3 对话框）。
 *
 * 对齐 ai-board 的 `AssetsPicker`：点「从素材库选择」不是开一个下拉，而是弹
 * 一个带搜索的对话框，用缩略图网格多选（图片）/ 单选（视频、音频）。
 * 节点卡片与节点检查器共用这一个组件。
 */
import { computed, ref, watch } from "vue";
import { CheckIcon, MagnifyingGlassIcon, MusicalNoteIcon, PhotoIcon, VideoCameraIcon } from "@heroicons/vue/24/outline";
import ModalShell from "@/components/common/ModalShell.vue";
import { useI18n } from "@/i18n";
import { assetThumbnailUrl } from "@/core/thumbnails";
import { useProjectStore } from "@/stores/project";
import type { AssetKind } from "@/types/project";

const props = withDefaults(
  defineProps<{
    open: boolean;
    kind: AssetKind;
    /** 图片输入可以多选；视频 / 音频单选。 */
    multiple?: boolean;
  }>(),
  { multiple: false },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "pick", ids: string[]): void;
}>();

const i18n = useI18n();
const project = useProjectStore();

const query = ref("");
const selected = ref<string[]>([]);

const kindIcon = computed(() => {
  if (props.kind === "video") return VideoCameraIcon;
  if (props.kind === "audio") return MusicalNoteIcon;
  return PhotoIcon;
});

const assets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === props.kind && !asset.offline),
);

const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return assets.value;
  return assets.value.filter((asset) => asset.name.toLowerCase().includes(text));
});

const titleKey = computed(() => {
  if (props.kind === "video") return "board.picker.videoTitle";
  if (props.kind === "audio") return "board.picker.audioTitle";
  return "board.picker.imageTitle";
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    query.value = "";
    selected.value = [];
  },
);

function close(): void {
  emit("update:open", false);
}

function toggle(id: string): void {
  if (!props.multiple) {
    selected.value = selected.value[0] === id ? [] : [id];
    return;
  }
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id];
}

function confirm(): void {
  if (selected.value.length === 0) return;
  emit("pick", [...selected.value]);
  close();
}

/** 缩略图：图片走缩略图；视频 / 音频没有缩略图时显示类型图标。 */
function thumbOf(id: string): string | null {
  const asset = project.doc.assets.find((item) => item.id === id);
  return asset ? assetThumbnailUrl(asset) : null;
}

function metaOf(id: string): string {
  const asset = project.doc.assets.find((item) => item.id === id);
  if (!asset) return "";
  return asset.width && asset.height ? `${asset.width} × ${asset.height}` : asset.kind;
}
</script>

<template>
  <ModalShell
    :open="open"
    :title="i18n.t(titleKey)"
    width="640px"
    @update:open="emit('update:open', $event)"
  >
    <div class="picker">
      <label class="picker-search">
        <MagnifyingGlassIcon class="picker-search-icon" />
        <input
          v-model="query"
          class="picker-search-input"
          data-autofocus
          :placeholder="i18n.t('board.picker.search')"
        />
      </label>

      <p v-if="assets.length === 0" class="picker-empty">
        <component :is="kindIcon" class="picker-empty-icon" />
        <strong>{{ i18n.t('board.picker.empty') }}</strong>
        <span>{{ i18n.t('board.picker.emptyHint') }}</span>
      </p>
      <p v-else-if="visible.length === 0" class="picker-empty">
        <strong>{{ i18n.t('board.picker.noMatch') }}</strong>
      </p>

      <div v-else class="picker-grid" :data-kind="kind">
        <button
          v-for="asset in visible"
          :key="asset.id"
          type="button"
          class="picker-tile"
          :data-active="selected.includes(asset.id) ? 'true' : 'false'"
          :title="asset.name"
          @click="toggle(asset.id)"
        >
          <img
            v-if="kind === 'image' && thumbOf(asset.id)"
            class="picker-tile-thumb"
            :src="thumbOf(asset.id)!"
            :alt="asset.name"
            loading="lazy"
          />
          <span v-else class="picker-tile-mark">
            <component :is="kindIcon" />
          </span>
          <span class="picker-tile-name">{{ asset.name }}</span>
          <span class="picker-tile-meta">{{ metaOf(asset.id) }}</span>
          <span v-if="selected.includes(asset.id)" class="picker-tile-check">
            <CheckIcon />
          </span>
        </button>
      </div>
    </div>

    <template #foot>
      <span class="picker-count">
        {{ multiple && selected.length > 0 ? i18n.t("board.picker.selected", { count: selected.length }) : "" }}
      </span>
      <button class="md-btn text" type="button" @click="close">
        {{ i18n.t("common.cancel") }}
      </button>
      <button class="md-btn filled" type="button" :disabled="selected.length === 0" @click="confirm">
        {{ i18n.t("board.picker.add") }}
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 280px;
}
.picker-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgb(var(--md-outline) / 0.45);
  background: rgb(var(--md-surface-container-lowest) / 0.55);
}
.picker-search-icon {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
}
.picker-search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 12px;
}
.picker-empty {
  flex: 1 1 auto;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 36px 12px;
  text-align: center;
  color: rgb(var(--md-on-surface-variant));
}
.picker-empty-icon {
  width: 28px;
  height: 28px;
  opacity: 0.7;
}
.picker-empty strong {
  font-size: 12px;
  font-weight: 600;
}
.picker-empty span {
  font-size: 11px;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 8px;
  max-height: min(52vh, 420px);
  overflow-y: auto;
  padding: 2px;
}
.picker-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 0 7px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.42);
  border-radius: 12px;
  background: rgb(var(--md-surface-container-low) / 0.5);
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}
.picker-tile:hover {
  border-color: rgb(var(--md-primary) / 0.5);
  background: rgb(var(--md-surface-container-high) / 0.9);
}
.picker-tile[data-active="true"] {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.18);
}
.picker-tile-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
  background: #000;
}
.picker-tile-mark {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  color: rgb(var(--md-primary));
  background:
    radial-gradient(120% 100% at 20% 0%, rgb(var(--md-primary) / 0.22), transparent 70%),
    rgb(var(--md-surface-container-highest));
}
.picker-tile-mark :deep(svg) {
  width: 26px;
  height: 26px;
}
.picker-tile-name {
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}
.picker-tile-meta {
  padding: 0 8px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 8.5px;
  color: rgb(var(--md-on-surface-variant));
}
.picker-tile-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: rgb(var(--md-on-primary));
  background: rgb(var(--md-primary));
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.4);
}
.picker-tile-check :deep(svg) {
  width: 12px;
  height: 12px;
}
.picker-count {
  flex: 1 1 auto;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.md-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: rgb(var(--md-primary));
  background: transparent;
}
.md-btn.text:hover {
  background: rgb(var(--md-on-surface-variant) / 0.1);
}
.md-btn.filled {
  color: rgb(var(--md-on-primary));
  background: rgb(var(--md-primary));
}
.md-btn.filled:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

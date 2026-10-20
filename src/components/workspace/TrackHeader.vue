<script setup lang="ts">
/** 轨道头：名称 + 静音/显示/锁定 + 删除（所有轨道外观一致）。 */
import { ref } from "vue";
import {
  TrashIcon,
  QueueListIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  LockClosedIcon,
  LockOpenIcon,
  EyeIcon,
  EyeSlashIcon,
} from "@heroicons/vue/24/outline";
import type { Track } from "@/types/project";
import { useI18n } from "@/i18n";

const props = defineProps<{ track: Track; dragging?: boolean }>();
const emit = defineEmits<{
  (e: "toggle-flag", trackId: string, flag: "muted" | "visible" | "locked"): void;
  (e: "remove", trackId: string): void;
  (e: "rename", trackId: string, name: string): void;
  (e: "reorder", trackId: string, event: PointerEvent): void;
}>();

const i18n = useI18n();

const editing = ref(false);
const draft = ref("");

/** 双击改名后自动聚焦输入框。 */
const vFocus = {
  mounted: (el: HTMLElement) => el.focus(),
};

function startEdit(): void {
  draft.value = props.track.name;
  editing.value = true;
}

function commit(): void {
  editing.value = false;
  const name = draft.value.trim();
  if (name && name !== props.track.name) emit("rename", props.track.id, name);
}
</script>

<template>
  <div class="track-head" :class="{ dragging }">
    <div class="th-main">
      <button
        class="th-grip"
        :aria-label="i18n.t('track.reorder')"
        :title="i18n.t('track.reorder')"
        @pointerdown.stop.prevent="emit('reorder', track.id, $event)"
      >
        <QueueListIcon class="th-icon" />
      </button>
      <input
        v-if="editing"
        v-model="draft"
        v-focus
        class="th-input"
        @blur="commit"
        @keydown.enter.prevent="commit"
        @keydown.escape.prevent="editing = false"
      />
      <span v-else class="th-name" @dblclick="startEdit">{{ track.name }}</span>
    </div>
    <div class="th-btns">
      <button
        class="th-btn"
        :class="{ on: track.muted }"
        :aria-pressed="track.muted"
        :aria-label="i18n.t('track.muteNamed', { name: track.name })"
        :title="track.muted ? i18n.t('track.unmute') : i18n.t('track.mute')"
        @click="emit('toggle-flag', track.id, 'muted')"
      >
        <SpeakerXMarkIcon v-if="track.muted" class="w-3 h-3" />
        <SpeakerWaveIcon v-else class="w-3 h-3" />
      </button>
      <button
        class="th-btn"
        :class="{ on: !track.visible }"
        :aria-pressed="!track.visible"
        :aria-label="i18n.t('track.showNamed', { name: track.name })"
        :title="track.visible ? i18n.t('track.hide') : i18n.t('track.show')"
        @click="emit('toggle-flag', track.id, 'visible')"
      >
        <EyeIcon v-if="track.visible" class="w-3 h-3" />
        <EyeSlashIcon v-else class="w-3 h-3" />
      </button>
      <button
        class="th-btn"
        :class="{ on: track.locked }"
        :aria-pressed="track.locked"
        :aria-label="i18n.t('track.lockNamed', { name: track.name })"
        :title="track.locked ? i18n.t('track.unlock') : i18n.t('track.lock')"
        @click="emit('toggle-flag', track.id, 'locked')"
      >
        <LockClosedIcon v-if="track.locked" class="w-3 h-3" />
        <LockOpenIcon v-else class="w-3 h-3" />
      </button>
      <button
        class="th-btn danger"
        :aria-label="i18n.t('track.deleteNamed', { name: track.name })"
        :title="i18n.t('track.delete')"
        @click="emit('remove', track.id)"
      >
        <TrashIcon class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.track-head {
  height: 54px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  padding: 0 7px 0 8px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.3);
  transition: opacity 0.15s ease, background-color 0.15s ease;
}
.track-head.dragging {
  opacity: 0.45;
  background-color: rgb(var(--md-primary) / 0.1);
}
.th-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.th-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-muted));
}
.th-grip {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: grab;
  touch-action: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.th-grip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.th-grip:hover .th-icon {
  color: rgb(var(--md-on-surface));
}
.th-grip:active {
  cursor: grabbing;
}
.th-grip:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.th-name {
  font-size: 11.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.th-input {
  width: 82px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgb(var(--md-primary) / 0.7);
  border-radius: 6px;
  background: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  outline: none;
}
.th-btns {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}
.th-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
  font-size: 9.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.th-btn:hover {
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
}
.th-btn.on {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.th-btn.danger:hover {
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}
</style>

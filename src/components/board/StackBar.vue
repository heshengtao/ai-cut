<script setup lang="ts">
/**
 * 多值节点的「牌堆」胶囊：‹ 2/5 ›，输入节点还能追加 / 删除。
 * 只做交互，值的读写由节点自己决定（文本 / 值 / 媒体各有一套字段）。
 */
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, XMarkIcon } from "@heroicons/vue/24/outline";

defineProps<{
  count: number;
  index: number;
  editable?: boolean;
}>();

const emit = defineEmits<{
  shift: [delta: number];
  add: [];
  remove: [];
}>();
</script>

<template>
  <div class="stack-bar nodrag" @pointerdown.stop @click.stop>
    <button
      class="stack-btn"
      type="button"
      :disabled="count < 2"
      @click="emit('shift', -1)"
    >
      <ChevronLeftIcon />
    </button>
    <span class="stack-count">{{ count === 0 ? 0 : index + 1 }}/{{ count }}</span>
    <button
      class="stack-btn"
      type="button"
      :disabled="count < 2"
      @click="emit('shift', 1)"
    >
      <ChevronRightIcon />
    </button>
    <template v-if="editable">
      <span class="stack-sep" aria-hidden="true" />
      <button class="stack-btn" type="button" @click="emit('add')">
        <PlusIcon />
      </button>
      <button
        class="stack-btn"
        type="button"
        :disabled="count === 0"
        @click="emit('remove')"
      >
        <XMarkIcon />
      </button>
    </template>
  </div>
</template>

<style scoped>
.stack-bar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 4px;
  border-radius: 999px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background: rgb(var(--md-surface-container) / 0.86);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}

.stack-btn {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
}

.stack-btn:hover:not(:disabled) {
  background: rgb(var(--md-on-surface) / 0.08);
  color: rgb(var(--md-on-surface));
}

.stack-btn:disabled {
  opacity: 0.35;
}

.stack-btn svg {
  width: 12px;
  height: 12px;
}

.stack-count {
  min-width: 34px;
  text-align: center;
  color: rgb(var(--md-on-surface-variant));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 9px;
}

.stack-sep {
  width: 1px;
  height: 12px;
  background: rgb(var(--md-outline-variant) / 0.6);
}
</style>

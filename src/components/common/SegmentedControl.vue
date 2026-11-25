<script setup lang="ts">
/**
 * MD3 Expressive Connected Button Group（连接按钮组）：
 * 首尾外侧大圆角、内部 8px 圆角 + 3px 缝隙；按压时横向弹簧扩张，选中项变形为完整胶囊。
 * 保持与既有 `SegmentedControl` 完全一致的 Props（modelValue / options / ariaLabel / size）。
 */
withDefaults(
  defineProps<{
    modelValue: string | null;
    options: { value: string; label: string; title?: string; disabled?: boolean }[];
    ariaLabel?: string;
    /** `md`（36px，设置页） / `sm`（28px，右侧 AI 面板）。 */
    size?: "md" | "sm";
  }>(),
  { size: "md" },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();
</script>

<template>
  <div class="m3-seg" :class="size" role="group" :aria-label="ariaLabel || undefined">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="m3-seg-btn"
      :class="{ on: modelValue === option.value }"
      :aria-pressed="modelValue === option.value"
      :disabled="option.disabled"
      :title="option.title"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.m3-seg {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  min-width: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.m3-seg::-webkit-scrollbar {
  display: none;
}
.m3-seg-btn {
  flex: 0 0 auto;
  height: 36px;
  padding: 0 15px;
  border: 0;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition:
    border-radius var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    padding var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    background-color var(--md-dur-effects-default) var(--md-spring-effects-default),
    color var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.m3-seg-btn:first-child {
  border-radius: 18px 8px 8px 18px;
}
.m3-seg-btn:last-child {
  border-radius: 8px 18px 18px 8px;
}
.m3-seg-btn:only-child {
  border-radius: 18px;
}
.m3-seg-btn:hover:not(:disabled):not(.on) {
  color: rgb(var(--md-on-surface));
  filter: brightness(1.06);
}
.m3-seg-btn:active:not(:disabled) {
  padding: 0 19px;
  border-radius: 13px;
}
.m3-seg-btn.on {
  border-radius: 18px;
  padding: 0 18px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-weight: 600;
}
.m3-seg-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.m3-seg-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}

/* 紧凑尺寸（右侧 AI 面板等高密度区） */
.m3-seg.sm {
  gap: 2px;
}
.m3-seg.sm .m3-seg-btn {
  height: 28px;
  padding: 0 11px;
  border-radius: 7px;
  font-size: 11.5px;
}
.m3-seg.sm .m3-seg-btn:first-child {
  border-radius: 14px 7px 7px 14px;
}
.m3-seg.sm .m3-seg-btn:last-child {
  border-radius: 7px 14px 14px 7px;
}
.m3-seg.sm .m3-seg-btn:only-child {
  border-radius: 14px;
}
.m3-seg.sm .m3-seg-btn:active:not(:disabled) {
  padding: 0 14px;
  border-radius: 10px;
}
.m3-seg.sm .m3-seg-btn.on {
  border-radius: 14px;
  padding: 0 13px;
}

@media (prefers-reduced-motion: reduce) {
  .m3-seg-btn {
    transition: none;
  }
}
</style>

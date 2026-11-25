<script setup lang="ts">
/**
 * M3 Expressive Connected Button Group：首尾外侧大圆角、内部 8px 圆角 + 3px 缝隙，
 * 按压时横向弹簧扩张，选中项变形为完整胶囊。
 */
export interface ButtonGroupOption {
  value: string;
  label: string;
  title?: string;
  disabled?: boolean;
}

defineProps<{
  modelValue: string | null;
  options: ButtonGroupOption[];
  ariaLabel?: string;
}>();

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();
</script>

<template>
  <div class="m3-btn-group" role="group" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      v-ripple
      type="button"
      class="m3-grp-btn"
      :class="{ selected: modelValue === opt.value }"
      :aria-pressed="modelValue === opt.value"
      :disabled="opt.disabled"
      :title="opt.title"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.m3-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.m3-grp-btn {
  height: 36px;
  padding: 0 15px;
  border: 0;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-high));
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
    background-color var(--md-dur-effects-default) var(--md-spring-effects-default),
    color var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.m3-grp-btn:first-child {
  border-radius: 18px 8px 8px 18px;
}
.m3-grp-btn:last-child {
  border-radius: 8px 18px 18px 8px;
}
.m3-grp-btn:only-child {
  border-radius: 18px;
}
.m3-grp-btn:hover:not(:disabled):not(.selected) {
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
}
.m3-grp-btn:active:not(:disabled) {
  padding: 0 19px;
  border-radius: 14px;
}
.m3-grp-btn.selected {
  border-radius: 18px;
  padding: 0 18px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-weight: 600;
}
.m3-grp-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.m3-grp-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .m3-grp-btn {
    transition: none;
  }
}
</style>

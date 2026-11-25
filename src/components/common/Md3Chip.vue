<script setup lang="ts">
/**
 * M3 Expressive Filter / Assist Chip：选中时对勾弹簧展开宽度，圆角从 10px 变形为完整胶囊。
 */
withDefaults(
  defineProps<{
    selected?: boolean;
    variant?: "filter" | "assist";
    size?: "sm" | "md";
    disabled?: boolean;
  }>(),
  { selected: false, variant: "filter", size: "md", disabled: false },
);

const emit = defineEmits<{ (e: "click", event: MouseEvent): void }>();
</script>

<template>
  <button
    type="button"
    class="m3-chip"
    :class="[variant, size, { selected }]"
    :aria-pressed="variant === 'filter' ? selected : undefined"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <span v-if="variant === 'filter'" class="m3-chip-check" aria-hidden="true">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    </span>
    <span class="m3-chip-label"><slot /></span>
  </button>
</template>

<style scoped>
.m3-chip {
  height: 32px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgb(var(--md-outline) / 0.75);
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition:
    border-radius var(--md-dur-effects-default) var(--md-spring-effects-default),
    padding var(--md-dur-effects-default) var(--md-spring-effects-default),
    gap var(--md-dur-effects-default) var(--md-spring-effects-default),
    transform var(--md-dur-effects-fast) var(--md-spring-effects-fast),
    background-color var(--md-dur-effects-default) var(--md-spring-effects-default),
    border-color var(--md-dur-effects-default) var(--md-spring-effects-default),
    color var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.m3-chip.sm {
  height: 27px;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 11.5px;
}
.m3-chip.sm.selected {
  padding: 0 11px 0 8px;
  gap: 4px;
}
.m3-chip.sm .m3-chip-check {
  height: 13px;
}
.m3-chip.sm .m3-chip-check svg {
  width: 13px;
  height: 13px;
}
.m3-chip.sm.selected .m3-chip-check {
  width: 13px;
}
.m3-chip:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.m3-chip:active:not(:disabled) {
  transform: scale(0.97);
}
.m3-chip:disabled {
  opacity: 0.45;
  cursor: default;
}
.m3-chip:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.m3-chip-check {
  width: 0;
  height: 15px;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  opacity: 0;
  transform: scale(0.6);
  transition:
    width var(--md-dur-effects-default) var(--md-spring-effects-default),
    opacity var(--md-dur-effects-fast) var(--md-spring-effects-fast),
    transform var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.m3-chip-check svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.m3-chip-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.m3-chip.selected {
  border-radius: 999px;
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  gap: 6px;
  padding: 0 14px 0 10px;
}
.m3-chip.selected .m3-chip-check {
  width: 15px;
  opacity: 1;
  transform: scale(1);
}
@media (prefers-reduced-motion: reduce) {
  .m3-chip,
  .m3-chip-check {
    transition: none;
  }
}
</style>

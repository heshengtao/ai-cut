<script setup lang="ts">
/**
 * M3 Expressive Split Button：左侧主动作 + 2px 间隙 + 右侧下拉触发键（展开时弹簧变为全圆并旋转箭头）。
 */
withDefaults(
  defineProps<{
    label: string;
    open?: boolean;
    disabled?: boolean;
    variant?: "filled" | "tonal";
    menuLabel?: string;
  }>(),
  { open: false, disabled: false, variant: "filled", menuLabel: "More options" },
);

const emit = defineEmits<{
  (e: "click", event: MouseEvent): void;
  (e: "toggle", event: MouseEvent): void;
}>();
</script>

<template>
  <div class="m3-split" :class="variant">
    <button
      v-ripple
      type="button"
      class="m3-split-lead"
      :disabled="disabled"
      @click="emit('click', $event)"
    >
      <slot name="icon" />
      <span>{{ label }}</span>
    </button>
    <button
      v-ripple="{ centered: true }"
      type="button"
      class="m3-split-trail"
      :class="{ open }"
      :aria-expanded="open"
      :aria-label="menuLabel"
      :disabled="disabled"
      @click="emit('toggle', $event)"
    >
      <svg class="m3-split-caret" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 8l5 5 5-5" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.m3-split {
  display: inline-flex;
  align-items: stretch;
  gap: 2px;
}
.m3-split-lead,
.m3-split-trail {
  height: 38px;
  border: 0;
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition:
    border-radius var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    width var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    background-color var(--md-dur-effects-fast) var(--md-spring-effects-fast);
}
.m3-split.filled .m3-split-lead,
.m3-split.filled .m3-split-trail {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.m3-split.tonal .m3-split-lead,
.m3-split.tonal .m3-split-trail {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.m3-split-lead {
  padding: 0 16px 0 18px;
  border-radius: 19px 6px 6px 19px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.m3-split-lead:active:not(:disabled) {
  border-radius: 11px 6px 6px 11px;
  transform: scale(0.97);
}
.m3-split-trail {
  width: 38px;
  padding: 0;
  border-radius: 6px 19px 19px 6px;
  display: inline-grid;
  place-items: center;
}
.m3-split-trail.open {
  width: 40px;
  border-radius: 19px;
}
.m3-split-caret {
  width: 15px;
  height: 15px;
  transition: transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy);
}
.m3-split-trail.open .m3-split-caret {
  transform: rotate(180deg);
}
.m3-split-lead:disabled,
.m3-split-trail:disabled {
  opacity: 0.42;
  cursor: default;
}
.m3-split-lead:focus-visible,
.m3-split-trail:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .m3-split-lead,
  .m3-split-trail,
  .m3-split-caret {
    transition: none;
  }
}
</style>

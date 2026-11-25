<script setup lang="ts">
/** MD3 Expressive 开关：内置对勾图标 + 按压拉伸（squishy stretch）+ 弹簧位移。 */
withDefaults(
  defineProps<{
    modelValue: boolean;
    label: string;
    disabled?: boolean;
    /** `sm`（44×26，检查器与节点） / `md`（52×32，设置页）。 */
    size?: "sm" | "md";
  }>(),
  { disabled: false, size: "sm" },
);

const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void }>();
</script>

<template>
  <button
    class="m3-toggle"
    :class="[size, { on: modelValue }]"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="thumb" aria-hidden="true">
      <svg
        class="check"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="2.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    </span>
  </button>
</template>

<style scoped>
.m3-toggle {
  position: relative;
  flex: 0 0 auto;
  padding: 0;
  border: 2px solid rgb(var(--md-outline));
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  cursor: pointer;
  transition:
    background-color var(--md-dur-effects-default) var(--md-spring-effects-default),
    border-color var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.m3-toggle.sm {
  width: 44px;
  height: 26px;
}
.m3-toggle.md {
  width: 52px;
  height: 32px;
}
.m3-toggle:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.m3-toggle:disabled {
  opacity: 0.45;
  cursor: default;
}
.thumb {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  border-radius: 999px;
  background-color: rgb(var(--md-outline));
  color: rgb(var(--md-surface-container-highest));
  transition:
    left var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    width var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    height var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy),
    background-color var(--md-dur-effects-default) var(--md-spring-effects-default);
}
.m3-toggle.sm .thumb {
  left: 4px;
  width: 13px;
  height: 13px;
}
.m3-toggle.md .thumb {
  left: 6px;
  width: 16px;
  height: 16px;
}
.check {
  width: 70%;
  height: 70%;
  opacity: 0;
  transform: scale(0.35) rotate(-25deg);
  transition:
    opacity var(--md-dur-effects-fast) var(--md-spring-effects-fast),
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy);
}

/* 按压拉伸（M3 标志性软弹触感） */
.m3-toggle.sm:active:not(:disabled) .thumb {
  width: 21px;
  height: 21px;
  left: 0;
}
.m3-toggle.md:active:not(:disabled) .thumb {
  width: 27px;
  height: 27px;
  left: 0;
}

.m3-toggle.on {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary));
}
.m3-toggle.on .thumb {
  background-color: rgb(var(--md-on-primary));
  color: rgb(var(--md-primary));
}
.m3-toggle.sm.on .thumb {
  left: 19px;
  width: 19px;
  height: 19px;
}
.m3-toggle.md.on .thumb {
  left: 22px;
  width: 24px;
  height: 24px;
}
.m3-toggle.on .check {
  opacity: 1;
  transform: scale(1) rotate(0deg);
}
.m3-toggle.sm.on:active:not(:disabled) .thumb {
  left: 17px;
  width: 21px;
  height: 21px;
}
.m3-toggle.md.on:active:not(:disabled) .thumb {
  left: 19px;
  width: 27px;
  height: 27px;
}

@media (prefers-reduced-motion: reduce) {
  .m3-toggle,
  .thumb,
  .check {
    transition: none;
  }
}
</style>

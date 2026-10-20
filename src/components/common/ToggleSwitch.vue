<script setup lang="ts">
/** MD3 开关：用于描边 / 阴影 / 背景 / 发光等开关。 */
withDefaults(
  defineProps<{
    modelValue: boolean;
    label: string;
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void }>();
</script>

<template>
  <button
    class="m3-toggle"
    :class="{ on: modelValue }"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="thumb" />
  </button>
</template>

<style scoped>
.m3-toggle {
  position: relative;
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  padding: 0;
  border: 2px solid rgb(var(--md-outline));
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  cursor: pointer;
  transition:
    background-color var(--md-ease-emphasized),
    border-color var(--md-ease-emphasized);
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
  left: 4px;
  width: 12px;
  height: 12px;
  margin-top: -6px;
  border-radius: 999px;
  background-color: rgb(var(--md-outline));
  transition:
    left var(--md-ease-emphasized-decel),
    width var(--md-ease-emphasized-decel),
    height var(--md-ease-emphasized-decel),
    margin-top var(--md-ease-emphasized-decel),
    background-color var(--md-ease-emphasized-decel);
}
.m3-toggle.on {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary));
}
.m3-toggle.on .thumb {
  left: 20px;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  background-color: rgb(var(--md-on-primary));
}
@media (prefers-reduced-motion: reduce) {
  .m3-toggle,
  .thumb {
    transition: none;
  }
}
</style>

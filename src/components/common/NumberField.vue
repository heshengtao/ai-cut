<script setup lang="ts">
/**
 * MD3 数字步进器：自绘 − / + 按钮，输入框无原生外观（type=text + inputmode，
 * 因此没有原生 number 控件的步进箭头）。
 *
 * `decimals > 0` 时允许小数；默认 0 只接受整数。
 */
import { ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { MinusIcon, PlusIcon } from "@heroicons/vue/24/outline";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    /** 允许的小数位数（0 = 只接受整数，默认）。 */
    decimals?: number;
    /** 药丸内左侧的可见标签。 */
    label?: string;
    /** 只给读屏用的名称：不渲染可见文字。 */
    srLabel?: string;
    inputWidth?: string;
    disabled?: boolean;
  }>(),
  { min: 0, max: 100, step: 1, decimals: 0, inputWidth: "44px", disabled: false },
);
const emit = defineEmits<{ (e: "update:modelValue", v: number): void }>();

const draft = ref(String(props.modelValue));
const i18n = useI18n();

watch(
  () => props.modelValue,
  (v) => {
    if (String(v) !== draft.value) draft.value = String(v);
  },
);

/** 夹到区间，并按 `decimals` 量化（0 位 = 取整）。 */
function clamp(n: number): number {
  const scale = 10 ** props.decimals;
  const quantized = Math.round(n * scale) / scale;
  return Math.min(props.max, Math.max(props.min, quantized));
}

/** 提交输入：非法值回退，合法值夹到区间后再向上报。 */
function commit(): void {
  if (props.disabled) return;
  const raw = draft.value.trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) {
    draft.value = String(props.modelValue);
    return;
  }
  const next = clamp(n);
  draft.value = String(next);
  if (next !== props.modelValue) emit("update:modelValue", next);
}

function bump(delta: number): void {
  if (props.disabled) return;
  emit("update:modelValue", clamp(props.modelValue + delta));
}
</script>

<template>
  <div class="step" :class="{ disabled }">
    <span v-if="label" class="step-label">{{ label }}</span>
    <button
      class="step-btn"
      :disabled="disabled"
      :aria-label="i18n.t('value.decrease', { name: srLabel ?? label ?? i18n.t('value.none') })"
      @click="bump(-step)"
    >
      <MinusIcon class="w-[13px] h-[13px]" />
    </button>
    <input
      v-model="draft"
      class="step-input"
      type="text"
      :inputmode="decimals > 0 ? 'decimal' : 'numeric'"
      autocomplete="off"
      spellcheck="false"
      :disabled="disabled"
      :aria-label="srLabel ?? label ?? i18n.t('value.none')"
      :style="{ width: inputWidth }"
      @change="commit"
      @blur="commit"
      @keydown.enter.prevent="commit"
    />
    <button
      class="step-btn"
      :disabled="disabled"
      :aria-label="i18n.t('value.increase', { name: srLabel ?? label ?? i18n.t('value.none') })"
      @click="bump(step)"
    >
      <PlusIcon class="w-[13px] h-[13px]" />
    </button>
  </div>
</template>

<style scoped>
.step {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 34px;
  padding: 0 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  border: 1px solid transparent;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.step:focus-within {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.step.disabled {
  opacity: 0.5;
}
.step.disabled .step-btn {
  cursor: default;
}
.step-label {
  font-size: 10px;
  letter-spacing: 0.7px;
  padding: 0 5px 0 7px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
}
.step-btn {
  width: 20px;
  height: 26px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.step-btn:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.step-btn:active {
  transform: scale(0.9);
}
.step-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.step-input {
  height: 26px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .step-btn:active {
    transform: none;
  }
}
</style>

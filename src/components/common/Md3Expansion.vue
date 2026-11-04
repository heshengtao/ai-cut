<script setup lang="ts">
/**
 * MD3 折叠面板：药丸标题栏 + 旋转箭头 + 高度过渡。
 *
 * 不用原生 `<details>`：原生控件没法做状态层、圆角、焦点环，箭头也是浏览器默认样式，
 * 在 MD3 界面里非常突兀。这里是受控 / 非受控都支持的纯 Vue 实现：
 *
 * - `open` 传了就受控，配合 `v-model:open`；
 * - 不传就自己管，`defaultOpen` 决定初始状态；
 * - 收起时内容置 `inert`：不可聚焦、不进无障碍树，但保留在 DOM 里以便做高度动画。
 */
import { computed, ref, useId } from "vue";
import { ChevronDownIcon } from "@heroicons/vue/24/outline";

const props = withDefaults(
  defineProps<{
    /** 标题（必填，同时作为 region 的无障碍名）。 */
    title: string;
    /** 收起时显示在右侧的摘要，例如「引擎未下载」。 */
    summary?: string;
    /** 受控展开状态；不传则内部管理。 */
    open?: boolean;
    /** 非受控时的初始状态。 */
    defaultOpen?: boolean;
    disabled?: boolean;
    /** `card`：独立卡片；`flat`：嵌在卡片里的分区（只有分隔线）。 */
    variant?: "card" | "flat";
  }>(),
  { summary: undefined, open: undefined, defaultOpen: false, disabled: false, variant: "card" },
);

const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const innerOpen = ref(props.defaultOpen);
const expanded = computed(() => props.open ?? innerOpen.value);
const panelId = useId();

function toggle(): void {
  if (props.disabled) return;
  const next = !expanded.value;
  innerOpen.value = next;
  emit("update:open", next);
}
</script>

<template>
  <section class="md3-expansion" :class="[variant, { expanded, disabled }]">
    <button
      :id="`${panelId}-header`"
      class="expansion-header"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="expansion-title">{{ title }}</span>
      <span v-if="summary" class="expansion-summary">{{ summary }}</span>
      <ChevronDownIcon class="expansion-caret" />
    </button>

    <div class="expansion-grid" :class="{ open: expanded }" :inert="expanded ? undefined : true">
      <div class="expansion-inner">
        <div
          :id="panelId"
          class="expansion-content"
          role="region"
          :aria-labelledby="`${panelId}-header`"
        >
          <slot />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.md3-expansion {
  min-width: 0;
}
.md3-expansion.card {
  border: 1px solid rgb(var(--md-outline-variant) / 0.55);
  border-radius: 16px;
  background-color: rgb(var(--md-surface-container));
  overflow: hidden;
}
.md3-expansion.flat {
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.45);
  border-radius: 0;
}

.expansion-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease;
}
.md3-expansion.card .expansion-header {
  border-radius: 16px;
}
.md3-expansion.flat .expansion-header {
  padding: 0 0 0 1px;
}
.md3-expansion.card.expanded .expansion-header {
  border-radius: 16px 16px 0 0;
}
.expansion-header:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / 0.06);
}
.expansion-header:active:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / 0.1);
}
.expansion-header:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: -2px;
}
.expansion-header:disabled {
  opacity: 0.5;
  cursor: default;
}
.expansion-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1px;
}
.expansion-summary {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.expansion-caret {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  margin-left: auto;
  color: rgb(var(--md-on-surface-variant));
  transition: transform 0.28s var(--md-ease-emphasized);
}
.expansion-summary + .expansion-caret {
  margin-left: 2px;
}
.md3-expansion.expanded .expansion-caret {
  transform: rotate(180deg);
}

/* 0fr → 1fr 的高度过渡：不需要测量 scrollHeight，窗口 / 字体变化也不会算错。 */
.expansion-grid {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s var(--md-ease-emphasized);
}
.expansion-grid.open {
  grid-template-rows: 1fr;
}
.expansion-inner {
  min-height: 0;
  overflow: hidden;
}
.expansion-content {
  padding: 2px 12px 12px;
}
.md3-expansion.flat .expansion-content {
  padding: 2px 0 10px;
}

@media (prefers-reduced-motion: reduce) {
  .expansion-grid,
  .expansion-caret {
    transition: none;
  }
}
</style>

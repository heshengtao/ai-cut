<script setup lang="ts">
/**
 * MD3 下拉框：药丸按钮 + 弹出菜单（**不是**原生 `<select>`）。
 *
 * 菜单 Teleport 到 body 并按 fixed 定位：预览底部是滚动/裁切容器，绝对定位会被裁掉。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";

export interface SelectOption {
  id: string;
  label: string;
  /** 第二行小字（可选）。 */
  hint?: string;
  /** 分组标题（可选）：同 group 的选项渲染在同一个标题下。 */
  group?: string;
  /** 比例预览（可选），例如 16 / 9。 */
  ratio?: number;
  /** 操作项：点击只触发 `action`，不会改变当前选中值。 */
  action?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | null;
    options: SelectOption[];
    /** 无障碍名（也是没选中时显示在按钮上的占位文案）。 */
    label: string;
    placeholder?: string;
    disabled?: boolean;
    /** 紧凑尺寸：预览底部工具条使用。 */
    compact?: boolean;
  }>(),
  { placeholder: "—", compact: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "select", value: string): void;
  (e: "action", id: string): void;
}>();

const { t } = useI18n();

/** 选项按 group 折叠成区块（保持与传入顺序一致）。 */
const groups = computed<{ title: string; items: SelectOption[] }[]>(() => {
  const out: { title: string; items: SelectOption[] }[] = [];
  const index = new Map<string, number>();
  for (const o of props.options) {
    const key = o.group ?? "";
    let at = index.get(key);
    if (at === undefined) {
      at = out.length;
      index.set(key, at);
      out.push({ title: key, items: [] });
    }
    out[at]!.items.push(o);
  }
  return out;
});

const open = ref(false);
const triggerEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

const selected = computed(() => props.options.find((o) => o.id === props.modelValue) ?? null);
const text = computed(() => selected.value?.label ?? props.placeholder);

/** 贴着触发器放；下方空间不够就翻到上方。 */
function place(): void {
  const el = triggerEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const width = Math.max(208, r.width);
  const spaceBelow = window.innerHeight - r.bottom - 12;
  const spaceAbove = r.top - 12;
  const openUp = spaceBelow < 190 && spaceAbove > spaceBelow;
  menuStyle.value = {
    left: `${Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(160, Math.min(360, openUp ? spaceAbove : spaceBelow))}px`,
    ...(openUp ? { bottom: `${window.innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` }),
  };
}

function toggle(): void {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) void nextTick(place);
}

function close(): void {
  open.value = false;
}

function pick(option: SelectOption): void {
  close();
  if (option.action) {
    emit("action", option.id);
    return;
  }
  if (option.id === props.modelValue) return;
  emit("update:modelValue", option.id);
  emit("select", option.id);
}

function ratioStyle(ratio: number): Record<string, string> {
  if (ratio >= 1) {
    return { width: "18px", height: `${Math.max(6, Math.round(18 / ratio))}px` };
  }
  return { width: `${Math.max(6, Math.round(16 * ratio))}px`, height: "16px" };
}

function onDocPointer(e: PointerEvent): void {
  if (!open.value) return;
  const target = e.target as Node;
  if (triggerEl.value?.contains(target) || menuEl.value?.contains(target)) return;
  close();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && open.value) {
    e.stopPropagation();
    close();
  }
}

function onViewportChange(): void {
  if (open.value) place();
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("resize", onViewportChange);
});

onMounted(() => {
  window.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
});
</script>

<template>
  <div class="md3-select-root">
    <button
      ref="triggerEl"
      class="md3-select"
      :class="{ compact }"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="label"
      @click="toggle"
    >
      <span class="value" :class="{ placeholder: !selected }">{{ text }}</span>
      <ChevronDownIcon class="caret" :class="{ up: open }" />
    </button>

    <Teleport to="body">
      <transition name="drop">
        <div
          v-if="open"
          ref="menuEl"
          class="md3-select-menu"
          :style="menuStyle"
          role="listbox"
          :aria-label="label"
        >
          <p v-if="options.length === 0" class="empty">{{ t("common.none") }}</p>
          <template v-for="g in groups" :key="g.title">
            <p v-if="g.title" class="group-title" role="presentation">{{ g.title }}</p>
            <button
              v-for="o in g.items"
              :key="o.id"
              class="item"
              :class="{ action: o.action }"
              type="button"
              role="option"
              :aria-selected="o.id === modelValue"
              @click="pick(o)"
            >
              <span class="item-main">
                <span class="item-label">{{ o.label }}</span>
                <span v-if="o.hint" class="item-hint">{{ o.hint }}</span>
              </span>
              <span
                v-if="o.ratio"
                class="ratio-icon"
                :style="ratioStyle(o.ratio)"
                aria-hidden="true"
              />
              <ArrowRightIcon v-if="o.action" class="item-arrow" />
              <CheckIcon v-else-if="o.id === modelValue" class="item-check" />
            </button>
          </template>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.md3-select-root {
  min-width: 0;
  flex: 0 0 auto;
}
.md3-select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  height: 34px;
  padding: 0 9px 0 12px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.md3-select.compact {
  height: 28px;
  gap: 4px;
  padding: 0 7px 0 10px;
  font-size: 10.5px;
  font-weight: 500;
}
.md3-select:hover:not(:disabled) {
  border-color: rgb(var(--md-primary) / 0.8);
}
.md3-select:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.md3-select:disabled {
  opacity: 0.5;
  cursor: default;
}
.value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value.placeholder {
  color: rgb(var(--md-on-surface-variant));
}
.caret {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
  transition: transform 0.18s ease;
}
.caret.up {
  transform: rotate(180deg);
}
</style>

<style>
/* 菜单 Teleport 到 body，所以不能写在 scoped 里 */
.md3-select-menu {
  position: fixed;
  z-index: 320;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  overflow-y: auto;
  border-radius: 18px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.md3-select-menu .group-title {
  margin: 4px 0 2px;
  padding: 2px 10px;
  font-size: 10px;
  letter-spacing: 0.6px;
  color: rgb(var(--md-on-surface-muted));
}
.md3-select-menu .item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.14s ease;
}
.md3-select-menu .item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.md3-select-menu .item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
.md3-select-menu .item-label {
  font-size: 12.5px;
}
.md3-select-menu .item-hint {
  font-size: 10.5px;
  line-height: 1.35;
  color: rgb(var(--md-on-surface-variant));
}
.md3-select-menu .item-check,
.md3-select-menu .item-arrow {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  color: rgb(var(--md-primary));
}
.md3-select-menu .item.action {
  color: rgb(var(--md-primary));
}
.md3-select-menu .item.action .item-label {
  font-weight: 500;
}
.md3-select-menu .item.action + .item:not(.action) {
  margin-top: 2px;
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.4);
  border-radius: 0 0 12px 12px;
  padding-top: 10px;
}
.md3-select-menu .ratio-icon {
  flex: 0 0 auto;
  border: 1.5px solid rgb(var(--md-on-surface-muted));
  border-radius: 3px;
}
.md3-select-menu .empty {
  margin: 0;
  padding: 14px 12px;
  font-size: 11.5px;
  line-height: 1.6;
  text-align: center;
  color: rgb(var(--md-on-surface-muted));
}
.drop-enter-active,
.drop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .drop-enter-active,
  .drop-leave-active {
    transition: opacity 0.12s ease;
  }
}
</style>

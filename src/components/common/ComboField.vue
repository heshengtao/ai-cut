<script setup lang="ts">
/**
 * 可输入的下拉框（combobox）：既能手打，也能从下拉里挑。
 *
 * 和 `Md3Select` 的区别是**允许自由输入**——`modelValue` 不必是候选项之一。输入时按当前文本
 * 过滤候选项；下拉菜单 Teleport 到 body 并用 fixed 定位（父容器是滚动区，绝对定位会被裁掉）。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDownIcon } from "@heroicons/vue/24/outline";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** 候选列表（可以为空——那就只能手打）。 */
    options: string[];
    /** 无障碍名。 */
    label: string;
    placeholder?: string;
    /** 候选为空时的提示文案。 */
    empty?: string;
    disabled?: boolean;
  }>(),
  { placeholder: "", empty: "—" },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

/** 按当前文本过滤候选项。 */
const filtered = computed(() => {
  const q = props.modelValue.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.toLowerCase().includes(q));
});

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});

/** 贴着输入框放；下方空间不够就翻到上方。 */
function place(): void {
  const el = rootEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const width = Math.max(220, r.width);
  const spaceBelow = window.innerHeight - r.bottom - 12;
  const spaceAbove = r.top - 12;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  menuStyle.value = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(120, Math.min(320, openUp ? spaceAbove : spaceBelow))}px`,
    ...(openUp ? { bottom: `${window.innerHeight - r.top + 6}px` } : { top: `${r.bottom + 6}px` }),
  };
}

function showMenu(): void {
  if (props.disabled) return;
  open.value = true;
  void nextTick(place);
}

function close(): void {
  open.value = false;
}

function toggle(): void {
  if (props.disabled) return;
  if (open.value) close();
  else showMenu();
}

function onInput(e: Event): void {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
  showMenu();
}

function pick(value: string): void {
  emit("update:modelValue", value);
  close();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
  else if (e.key === "Enter") {
    e.preventDefault();
    close();
  } else if (e.key === "ArrowDown" && !open.value) {
    showMenu();
  }
}

function onDocPointer(e: PointerEvent): void {
  if (!open.value) return;
  const target = e.target as Node;
  if (rootEl.value?.contains(target) || menuEl.value?.contains(target)) return;
  close();
}

function onViewportChange(): void {
  if (open.value) place();
}

watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
  } else {
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
  }
});

onMounted(() => window.addEventListener("pointerdown", onDocPointer, true));
onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("resize", onViewportChange);
});
</script>

<template>
  <div ref="rootEl" class="combo">
    <input
      class="combo-input"
      type="text"
      spellcheck="false"
      role="combobox"
      aria-autocomplete="list"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="label"
      :aria-expanded="open"
      @input="onInput"
      @keydown="onKeydown"
      @focus="showMenu"
    />
    <button
      class="combo-caret"
      type="button"
      tabindex="-1"
      :disabled="disabled"
      :aria-label="label"
      @click="toggle"
    >
      <ChevronDownIcon class="caret" :class="{ up: open }" />
    </button>
  </div>

  <Teleport to="body">
    <transition name="drop">
      <div v-if="open" ref="menuEl" class="combo-menu" :style="menuStyle" role="listbox" :aria-label="label">
        <p v-if="filtered.length === 0" class="combo-empty">{{ empty }}</p>
        <button
          v-for="o in filtered"
          :key="o"
          class="combo-item"
          type="button"
          role="option"
          :aria-selected="o === modelValue"
          @click="pick(o)"
        >
          <span class="combo-item-label">{{ o }}</span>
        </button>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.combo {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
}
.combo-input {
  width: 100%;
  height: 34px;
  padding: 0 32px 0 12px;
  border: 1px solid rgb(var(--md-outline) / 0.7);
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}
.combo-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.combo-input::placeholder {
  color: rgb(var(--md-on-surface-muted));
}
.combo-input:disabled {
  opacity: 0.5;
}
.combo-caret {
  position: absolute;
  right: 4px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.combo-caret:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.combo-caret:disabled {
  cursor: default;
}
.caret {
  width: 15px;
  height: 15px;
  transition: transform 0.18s ease;
}
.caret.up {
  transform: rotate(180deg);
}
</style>

<style>
/* 菜单 Teleport 到 body，不能写在 scoped 里。 */
.combo-menu {
  position: fixed;
  z-index: 320;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  overflow-y: auto;
  border-radius: 16px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.5);
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.combo-menu .combo-item {
  display: flex;
  align-items: center;
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
.combo-menu .combo-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.combo-menu .combo-item[aria-selected="true"] {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.combo-menu .combo-item-label {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.combo-menu .combo-empty {
  margin: 0;
  padding: 14px 12px;
  font-size: 11.5px;
  text-align: center;
  color: rgb(var(--md-on-surface-muted));
}
.combo-menu.drop-enter-active,
.combo-menu.drop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.combo-menu.drop-enter-from,
.combo-menu.drop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .combo-menu.drop-enter-active,
  .combo-menu.drop-leave-active {
    transition: opacity 0.12s ease;
  }
}
</style>

<script setup lang="ts">
/**
 * 一层菜单面板（根菜单或任意深度的子菜单）。
 *
 * 自己负责定位：根菜单贴着鼠标，子菜单贴着触发行的右侧；靠近窗口边缘时自动翻到左侧 /
 * 向上收。面板递归渲染自己，所以「分类 → 二级菜单」不需要在业务层关心层数。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { CheckIcon, ChevronRightIcon } from "@heroicons/vue/24/outline";
import type {
  MenuAction,
  MenuAnchor,
  MenuItem,
  MenuSubmenu,
} from "@/components/common/contextMenu";

defineOptions({ name: "MenuPanel" });

const props = defineProps<{
  items: MenuItem[];
  /** 0 = 根菜单。 */
  depth: number;
  x: number;
  y: number;
  anchor?: MenuAnchor | null;
}>();

const emit = defineEmits<{
  (e: "pick", item: MenuAction): void;
  (e: "close"): void;
  (e: "back"): void;
}>();

const panelEl = ref<HTMLElement | null>(null);
const position = ref({ left: props.x, top: props.y });
const placed = ref(false);
const activeId = ref<string | null>(null);
const subAnchor = ref<MenuAnchor | null>(null);
let hoverTimer: number | null = null;

const activeSub = computed<MenuSubmenu | null>(() => {
  const item = props.items.find((candidate) => candidate.id === activeId.value);
  return item && item.kind === "submenu" ? item : null;
});

/** 贴着锚点 / 鼠标落位，并夹在窗口内。 */
function measure(): void {
  const el = panelEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

  let left = props.anchor ? props.anchor.right + 2 : props.x;
  let top = props.anchor ? props.anchor.top - 6 : props.y;

  // 右侧放不下就翻到触发行左边，仍然优先保持与触发行同高。
  if (props.anchor && left + rect.width > window.innerWidth - margin) {
    left = props.anchor.left - rect.width - 2;
  }

  position.value = {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
  placed.value = true;
}

function rows(): HTMLElement[] {
  return Array.from(
    panelEl.value?.querySelectorAll<HTMLElement>(".menu-row:not(.is-disabled)") ?? [],
  );
}

function focusFirst(): void {
  rows()[0]?.focus({ preventScroll: true });
}

function moveFocus(delta: number): void {
  const list = rows();
  if (list.length === 0) return;
  const index = list.indexOf(document.activeElement as HTMLElement);
  const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
  const row = list[next];
  row?.focus();
  row?.scrollIntoView({ block: "nearest" });
}

onMounted(async () => {
  await nextTick();
  measure();
  // 等 `placed` 把面板从 visibility:hidden 切回来，再抢焦点。
  await nextTick();
  focusFirst();
});

onBeforeUnmount(() => {
  if (hoverTimer !== null) window.clearTimeout(hoverTimer);
});

function pick(item: MenuAction): void {
  if (item.disabled) return;
  emit("pick", item);
}

function openWithRect(item: MenuSubmenu, rect: MenuAnchor): void {
  if (item.disabled) return;
  subAnchor.value = rect;
  activeId.value = item.id;
}

function openNow(item: MenuSubmenu, event: Event): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  if (activeId.value === item.id) {
    activeId.value = null;
    return;
  }
  openWithRect(item, el.getBoundingClientRect());
}

/** 悬停一小会儿再展开，斜着划过子菜单时不会一路弹开。 */
function scheduleOpen(item: MenuSubmenu, event: MouseEvent): void {
  if (item.disabled) return;
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  if (activeId.value === item.id) return;
  if (hoverTimer !== null) window.clearTimeout(hoverTimer);
  const rect = el.getBoundingClientRect();
  hoverTimer = window.setTimeout(() => openWithRect(item, rect), 90);
}

function onRowEnter(item: MenuItem, event: MouseEvent): void {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (item.kind === "submenu") {
    scheduleOpen(item, event);
    return;
  }
  if (activeId.value !== null) activeId.value = null;
}

/** 子菜单按 ← 退回本层：关掉子菜单并把焦点还给触发它的那一行。 */
function closeSub(): void {
  const id = activeId.value;
  activeId.value = null;
  if (!id) return;
  void nextTick(() => {
    panelEl.value
      ?.querySelector<HTMLElement>(`[data-submenu-id="${id}"]`)
      ?.focus({ preventScroll: true });
  });
}

function onKeyDown(event: KeyboardEvent): void {
  // 子菜单的 DOM 嵌在父面板里，方向键必须只作用于当前这一层。
  event.stopPropagation();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "ArrowRight") {
    const el = document.activeElement as HTMLElement | null;
    const id = el?.dataset.submenuId;
    if (!id || !el) return;
    const item = props.items.find((candidate) => candidate.id === id);
    if (item && item.kind === "submenu" && !item.disabled) {
      event.preventDefault();
      openWithRect(item, el.getBoundingClientRect());
    }
    return;
  }
  if (event.key === "ArrowLeft" && props.depth > 0) {
    event.preventDefault();
    emit("back");
  }
}
</script>

<template>
  <div
    ref="panelEl"
    class="menu-panel"
    :class="{ submenu: depth > 0 }"
    role="menu"
    :style="{
      left: `${position.left}px`,
      top: `${position.top}px`,
      visibility: placed ? 'visible' : 'hidden',
    }"
    @contextmenu.prevent.stop
    @keydown="onKeyDown"
    @scroll.passive="activeId = null"
  >
    <template v-for="item in items" :key="item.id">
      <div v-if="item.kind === 'separator'" class="menu-sep" role="separator" />

      <div v-else-if="item.kind === 'label'" class="menu-label">{{ item.label }}</div>

      <template v-else>
        <div
          class="menu-row"
          :class="{
            'is-disabled': item.disabled,
            'is-danger': item.danger,
            'is-ai': item.ai,
            'is-active': item.kind === 'submenu' && activeId === item.id,
          }"
          role="menuitem"
          :tabindex="item.disabled ? -1 : 0"
          :aria-disabled="item.disabled || undefined"
          :data-submenu-id="item.kind === 'submenu' ? item.id : undefined"
          :title="item.hint"
          @mouseenter="onRowEnter(item, $event)"
          @click="item.kind === 'action' ? pick(item) : openNow(item, $event)"
          @keydown.enter.prevent="
            item.kind === 'action' ? pick(item) : openNow(item, $event)
          "
          @keydown.space.prevent="
            item.kind === 'action' ? pick(item) : openNow(item, $event)
          "
        >
          <component :is="item.icon" v-if="item.icon" class="row-icon" />
          <span v-else class="row-icon row-icon-empty" />

          <span class="row-label">{{ item.label }}</span>

          <CheckIcon v-if="item.checked" class="row-check" />

          <span v-if="item.badge" class="row-badge">{{ item.badge }}</span>

          <span v-if="item.keys?.length" class="row-keys">
            <template v-for="(key, index) in item.keys" :key="key">
              <span v-if="index > 0" class="plus">+</span>
              <kbd class="key">{{ key }}</kbd>
            </template>
          </span>

          <ChevronRightIcon v-if="item.kind === 'submenu'" class="row-chevron" />
        </div>

        <MenuPanel
          v-if="item.kind === 'submenu' && activeSub?.id === item.id && subAnchor"
          :items="item.items"
          :depth="depth + 1"
          :x="0"
          :y="0"
          :anchor="subAnchor"
          @pick="emit('pick', $event)"
          @close="emit('close')"
          @back="closeSub"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.menu-panel {
  position: fixed;
  z-index: 341;
  min-width: 238px;
  max-width: 330px;
  max-height: min(72vh, 620px);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3), 0 0 0 1px rgb(var(--md-outline-variant) / 0.3);
  user-select: none;
  scrollbar-width: thin;
}
.menu-panel::-webkit-scrollbar {
  width: 8px;
}
.menu-panel::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: rgb(var(--md-outline) / 0.5);
}

.menu-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 32px;
  padding: 0 8px 0 9px;
  border-radius: 9px;
  color: rgb(var(--md-on-surface));
  font-size: 12.5px;
  line-height: 1.3;
  cursor: pointer;
  outline: none;
  transition: background-color 0.1s ease, color 0.1s ease;
}
.menu-row:hover,
.menu-row:focus-visible,
.menu-row.is-active {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha, 0.08));
}
.menu-row:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--md-primary) / 0.7);
}
.menu-row.is-disabled {
  color: rgb(var(--md-on-surface-muted));
  cursor: default;
  opacity: 0.5;
}
.menu-row.is-disabled:hover {
  background-color: transparent;
}
.menu-row.is-danger {
  color: rgb(var(--md-error));
}
.menu-row.is-danger:not(.is-disabled):hover,
.menu-row.is-danger:not(.is-disabled):focus-visible {
  background-color: rgb(var(--md-error) / 0.12);
}
.menu-row.is-ai .row-icon {
  color: rgb(var(--md-primary));
}

.row-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  opacity: 0.9;
}
.row-icon-empty {
  display: block;
}
.row-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-check {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: rgb(var(--md-primary));
}
.row-badge {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3px;
  line-height: 14px;
}
.row-keys {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
}
.key {
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.plus {
  color: rgb(var(--md-on-surface-muted));
  font-size: 9px;
}
.row-chevron {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-muted));
}

.menu-sep {
  height: 1px;
  margin: 4px 6px;
  flex: 0 0 auto;
  background-color: rgb(var(--md-outline-variant) / 0.55);
}
.menu-label {
  padding: 5px 9px 2px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: rgb(var(--md-on-surface-muted));
}
</style>

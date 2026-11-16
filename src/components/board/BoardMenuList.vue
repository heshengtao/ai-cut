<script setup lang="ts">
/**
 * 画布菜单的一层（可递归）。
 *
 * 行为对齐 ai-board 的 MenuPanel：分组标签 / 分隔线 / 图标 / 快捷键提示 /
 * 危险项 / 勾选态 / 子菜单 / 可搜索。子菜单位置按触发行的实际矩形算，并夹在视口内。
 */
import { computed, nextTick, ref, watch } from "vue";
import { CheckIcon, ChevronRightIcon, MagnifyingGlassIcon } from "@heroicons/vue/24/outline";

export interface BoardMenuAction {
  kind: "action";
  id: string;
  label: string;
  icon?: unknown;
  hint?: string;
  keys?: string[];
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  /** 供搜索命中的额外文本（类型 id / 英文标题）。 */
  searchText?: string;
  run: () => void;
}

export interface BoardMenuSubmenu {
  kind: "submenu";
  id: string;
  label: string;
  icon?: unknown;
  items: BoardMenuItem[];
}

export interface BoardMenuSeparator {
  kind: "separator";
  id: string;
}

export interface BoardMenuLabel {
  kind: "label";
  id: string;
  label: string;
}

export type BoardMenuItem =
  | BoardMenuAction
  | BoardMenuSubmenu
  | BoardMenuSeparator
  | BoardMenuLabel;

const props = defineProps<{
  items: BoardMenuItem[];
  searchable?: boolean;
  searchPlaceholder?: string;
  noResults?: string;
  minWidth?: number;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const query = ref("");
const submenu = ref<{
  items: BoardMenuItem[];
  top: number;
  left: number;
} | null>(null);
const rowEls = new Map<string, HTMLElement>();

function matches(item: BoardMenuItem): boolean {
  const text = query.value.trim().toLowerCase();
  if (!text) return true;
  if (item.kind === "action") {
    return `${item.label} ${item.searchText ?? ""}`.toLowerCase().includes(text);
  }
  if (item.kind === "submenu") {
    return (
      item.label.toLowerCase().includes(text) || item.items.some((child) => matches(child))
    );
  }
  return false;
}

/**
 * 搜索时把子菜单**摊平**：直接列出命中的叶子节点，并带上分类前缀。
 * 不摊平的话用户得先猜节点在哪一层子菜单里，搜索就白做了。
 */
const rows = computed<BoardMenuItem[]>(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.items;
  const result: BoardMenuItem[] = [];
  const pushMatches = (items: BoardMenuItem[], prefix?: string): void => {
    for (const item of items) {
      if (item.kind === "action") {
        if (!matches(item)) continue;
        result.push(prefix ? { ...item, label: `${prefix} · ${item.label}` } : item);
      } else if (item.kind === "submenu") {
        const childHit = item.items.some((child) => child.kind === "action" && matches(child));
        if (childHit || item.label.toLowerCase().includes(text)) pushMatches(item.items, item.label);
      }
    }
  };
  pushMatches(props.items);
  return result;
});

const empty = computed(() => query.value.trim().length > 0 && rows.value.length === 0);

function setRow(id: string, el: Element | null): void {
  if (el instanceof HTMLElement) rowEls.set(id, el);
  else rowEls.delete(id);
}

function openSubmenu(item: BoardMenuSubmenu): void {
  const el = rowEls.get(item.id);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  void nextTick(() => {
    submenu.value = {
      items: item.items,
      top: Math.min(rect.top - 6, window.innerHeight - 320),
      left: rect.right + 2,
    };
  });
}

function closeSubmenu(): void {
  submenu.value = null;
}

function run(item: BoardMenuAction): void {
  if (item.disabled) return;
  item.run();
  emit("close");
}

watch(query, () => {
  submenu.value = null;
});
</script>

<template>
  <div class="board-menu-list" :style="minWidth ? { minWidth: `${minWidth}px` } : undefined" @contextmenu.prevent>
    <label v-if="searchable" class="bm-search">
      <MagnifyingGlassIcon />
      <input
        v-model="query"
        type="text"
        :placeholder="searchPlaceholder"
        autofocus
        @keydown.esc.stop="emit('close')"
      />
    </label>

    <p v-if="empty" class="bm-empty">{{ noResults }}</p>

    <template v-for="item in rows" :key="item.id">
      <div v-if="item.kind === 'separator'" class="bm-sep" role="separator" />
      <p v-else-if="item.kind === 'label'" class="bm-label">{{ item.label }}</p>

      <button
        v-else-if="item.kind === 'submenu'"
        :ref="(el) => setRow(item.id, el as Element | null)"
        type="button"
        class="bm-row"
        @mouseenter="openSubmenu(item)"
        @focus="openSubmenu(item)"
      >
        <component :is="item.icon" v-if="item.icon" class="bm-icon" />
        <span class="bm-text">{{ item.label }}</span>
        <ChevronRightIcon class="bm-chevron" />
      </button>

      <button
        v-else
        :ref="(el) => setRow(item.id, el as Element | null)"
        type="button"
        class="bm-row"
        :class="{ danger: item.danger, checked: item.checked }"
        :disabled="item.disabled"
        :title="item.hint"
        @mouseenter="closeSubmenu"
        @click="run(item)"
      >
        <component :is="item.icon" v-if="item.icon" class="bm-icon" />
        <span class="bm-text">{{ item.label }}</span>
        <CheckIcon v-if="item.checked" class="bm-check" />
        <span v-if="item.keys" class="bm-keys">
          <kbd v-for="key in item.keys" :key="key">{{ key }}</kbd>
        </span>
      </button>
    </template>

    <Teleport to="body">
      <div
        v-if="submenu"
        class="board-menu-floating"
        :style="{ left: `${submenu.left}px`, top: `${submenu.top}px` }"
        @mouseleave="closeSubmenu"
      >
        <BoardMenuList
          :items="submenu.items"
          :searchable="false"
          @close="emit('close')"
        />
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
export default { name: "BoardMenuList" };
</script>

<style scoped>
.board-menu-list {
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.24);
  max-height: min(70vh, 460px);
  overflow-y: auto;
}
.bm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 2px 6px;
  padding: 0 8px;
  height: 30px;
  border-radius: 8px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
}
.bm-search :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.bm-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
}
.bm-empty {
  margin: 4px 8px 8px;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.bm-label {
  margin: 8px 8px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-variant) / 0.85);
}
.bm-sep {
  height: 1px;
  margin: 5px 6px;
  background-color: rgb(var(--md-outline-variant) / 0.55);
}
.bm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  font-size: 12.5px;
  color: rgb(var(--md-on-surface));
  cursor: pointer;
}
.bm-row:hover:not(:disabled),
.bm-row:focus-visible {
  background-color: rgb(var(--md-on-surface-variant) / 0.12);
  outline: none;
}
.bm-row:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.bm-row.danger {
  color: rgb(var(--md-error));
}
.bm-row.checked .bm-text {
  font-weight: 600;
  color: rgb(var(--md-primary));
}
.bm-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  opacity: 0.85;
}
.bm-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bm-check {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: rgb(var(--md-primary));
}
.bm-chevron {
  width: 13px;
  height: 13px;
  opacity: 0.6;
}
.bm-keys {
  display: inline-flex;
  gap: 3px;
  flex: 0 0 auto;
}
.bm-keys kbd {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  color: rgb(var(--md-on-surface-variant));
  background-color: rgb(var(--md-on-surface-variant) / 0.14);
}
.board-menu-floating {
  position: fixed;
  z-index: 80;
}
</style>

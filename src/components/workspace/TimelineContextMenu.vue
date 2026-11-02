<script setup lang="ts">
/**
 * 时间线片段的右键菜单：复制 / 剪切 / 粘贴 / 删除。
 *
 * 位置贴着鼠标出现，超出视口时自动往回收；点空白处、滚轮、Esc 都会关闭。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ClipboardDocumentIcon,
  DocumentDuplicateIcon,
  ScissorsIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { isMacOS } from "@/utils/platform";
import { useI18n } from "@/i18n";

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  /** 剪贴板里有内容，「粘贴」才可用。 */
  canPaste: boolean;
  /** 当前有选中片段，「复制 / 剪切 / 删除」才可用。 */
  hasSelection: boolean;
}>();

const emit = defineEmits<{
  (e: "copy"): void;
  (e: "cut"): void;
  (e: "paste"): void;
  (e: "delete"): void;
  (e: "close"): void;
}>();

const i18n = useI18n();
const menuEl = ref<HTMLElement | null>(null);
const position = ref({ left: 0, top: 0 });

const mod = isMacOS() ? "⌘" : "Ctrl";

interface MenuItem {
  id: "copy" | "cut" | "paste" | "delete";
  label: string;
  keys: string[];
  disabled: boolean;
  destructive?: boolean;
}

const items = computed<MenuItem[]>(() => [
  {
    id: "copy",
    label: i18n.t("timeline.copy"),
    keys: [mod, "C"],
    disabled: !props.hasSelection,
  },
  {
    id: "cut",
    label: i18n.t("timeline.cut"),
    keys: [mod, "X"],
    disabled: !props.hasSelection,
  },
  {
    id: "paste",
    label: i18n.t("timeline.paste"),
    keys: [mod, "V"],
    disabled: !props.canPaste,
  },
  {
    id: "delete",
    label: i18n.t("timeline.deleteLabel"),
    keys: ["Delete"],
    disabled: !props.hasSelection,
    destructive: true,
  },
]);

/** 贴住鼠标出现，但不许超出窗口。 */
async function place(): Promise<void> {
  if (!props.open) return;
  // 先按鼠标位置落位，避免测量到实际尺寸前在左上角闪一下。
  position.value = { left: props.x, top: props.y };
  await nextTick();
  const el = menuEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(props.x, window.innerWidth - rect.width - margin);
  const top = Math.min(props.y, window.innerHeight - rect.height - margin);
  position.value = {
    left: Math.max(margin, left),
    top: Math.max(margin, top),
  };
}

watch(() => [props.open, props.x, props.y], () => void place(), { immediate: true });

function choose(id: MenuItem["id"]): void {
  if (!props.open) return;
  const item = items.value.find((candidate) => candidate.id === id);
  if (!item || item.disabled) return;
  if (id === "copy") emit("copy");
  else if (id === "cut") emit("cut");
  else if (id === "paste") emit("paste");
  else emit("delete");
  emit("close");
}

function onPointerDown(event: PointerEvent): void {
  if (!props.open) return;
  const el = menuEl.value;
  if (el && event.composedPath().includes(el)) return;
  emit("close");
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.open || event.key !== "Escape") return;
  event.preventDefault();
  emit("close");
}

function dismiss(): void {
  if (props.open) emit("close");
}

onMounted(() => {
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", dismiss);
  window.addEventListener("blur", dismiss);
  // 时间线滚动时菜单会脱离片段，直接关闭。
  window.addEventListener("wheel", dismiss, { passive: true, capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("resize", dismiss);
  window.removeEventListener("blur", dismiss);
  window.removeEventListener("wheel", dismiss, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuEl"
      class="clip-menu"
      role="menu"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.id"
        class="menu-item"
        :class="{ destructive: item.destructive }"
        :disabled="item.disabled"
        role="menuitem"
        @click="choose(item.id)"
      >
        <DocumentDuplicateIcon v-if="item.id === 'copy'" class="item-icon" />
        <ScissorsIcon v-else-if="item.id === 'cut'" class="item-icon" />
        <ClipboardDocumentIcon v-else-if="item.id === 'paste'" class="item-icon" />
        <TrashIcon v-else class="item-icon" />
        <span class="item-label">{{ item.label }}</span>
        <span class="item-keys">
          <template v-for="(key, index) in item.keys" :key="key">
            <span v-if="index > 0" class="plus">+</span>
            <kbd class="key">{{ key }}</kbd>
          </template>
        </span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.clip-menu {
  position: fixed;
  z-index: 320;
  min-width: 208px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3), 0 0 0 1px rgb(var(--md-outline-variant) / 0.3);
  user-select: none;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.menu-item:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha, 0.08));
}
.menu-item:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: -2px;
}
.menu-item:disabled {
  color: rgb(var(--md-on-surface-muted));
  cursor: default;
  opacity: 0.55;
}
.item-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  opacity: 0.85;
}
.item-label {
  flex: 1 1 auto;
  white-space: nowrap;
}
.item-keys {
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
.menu-item.destructive:not(:disabled) {
  color: rgb(var(--md-error));
}
.menu-item.destructive:hover:not(:disabled) {
  background-color: rgb(var(--md-error) / 0.12);
}
</style>

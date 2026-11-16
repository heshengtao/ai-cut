<script setup lang="ts">
/**
 * 画布弹层菜单：把一层列表按锚点摆好（工具栏按钮上方居中 / 鼠标右键处）。
 *
 * 位置在挂载后按面板实际尺寸算，并夹在视口内——这就是之前"菜单偏移"的根因：
 * 之前用的是 CSS `left:50%; bottom:64px`，工具栏宽度一变就偏。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import BoardMenuList, { type BoardMenuItem } from "./BoardMenuList.vue";

const props = withDefaults(
  defineProps<{
    items: BoardMenuItem[];
    /** 锚点（工具栏按钮的矩形）；给了就按 placement 贴它。 */
    anchor?: DOMRect | null;
    /** 鼠标位置（右键菜单）。 */
    x?: number;
    y?: number;
    placement?: "above" | "below" | "point";
    searchable?: boolean;
    searchPlaceholder?: string;
    noResults?: string;
    minWidth?: number;
  }>(),
  { placement: "point", searchable: false, minWidth: 180 },
);

const emit = defineEmits<{ (e: "close"): void }>();

const root = ref<HTMLElement | null>(null);
const position = ref({ left: 0, top: 0 });

const style = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
}));

function place(): void {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  let left = props.x ?? 0;
  let top = props.y ?? 0;

  if (props.anchor && props.placement !== "point") {
    const anchor = props.anchor;
    left = anchor.left + anchor.width / 2 - rect.width / 2;
    if (props.placement === "above") {
      top = anchor.top - rect.height - 8;
      if (top < margin) top = anchor.bottom + 8;
    } else {
      top = anchor.bottom + 8;
      if (top + rect.height > window.innerHeight - margin) top = anchor.top - rect.height - 8;
    }
  } else {
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
  }
  position.value = {
    left: Math.max(margin, left),
    top: Math.max(margin, top),
  };
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target && root.value?.contains(target)) return;
  // 用 click 而不是 pointerdown：否则点触发按钮时先被关掉、click 又把它打开，
  // 表现成"点一下不关"。
  emit("close");
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

let attachTimer: number | null = null;

onMounted(() => {
  place();
  // 延后一拍注册：本次点击（刚打开菜单的那次）不应该立刻把菜单关掉。
  attachTimer = window.setTimeout(() => {
    attachTimer = null;
    window.addEventListener("click", onDocumentClick);
  }, 0);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", place);
});

onBeforeUnmount(() => {
  // 必须清掉待注册的定时器：否则旧菜单卸载后才挂上的 listener 会把**下一个**菜单立刻关掉。
  if (attachTimer !== null) {
    clearTimeout(attachTimer);
    attachTimer = null;
  }
  window.removeEventListener("click", onDocumentClick);
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("resize", place);
});
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="board-menu" :style="style" @contextmenu.prevent>
      <BoardMenuList
        :items="items"
        :searchable="searchable"
        :search-placeholder="searchPlaceholder"
        :no-results="noResults"
        :min-width="minWidth"
        @close="emit('close')"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.board-menu {
  position: fixed;
  z-index: 70;
  max-width: min(320px, calc(100vw - 16px));
}
</style>

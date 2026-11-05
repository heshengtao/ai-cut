<script setup lang="ts">
/**
 * 通用右键菜单容器：Teleport 到 body，负责全局关闭与选择分发。
 *
 * 关闭时机：点空白、Esc、滚轮 / 滚动（菜单会脱离锚点）、窗口缩放或失焦。
 * 菜单自身滚动时保持打开，避免长菜单一滚就消失。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import MenuPanel from "@/components/common/MenuPanel.vue";
import type { MenuAction, MenuItem } from "@/components/common/contextMenu";

const props = defineProps<{
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const hostEl = ref<HTMLElement | null>(null);

function inside(event: Event): boolean {
  const host = hostEl.value;
  return Boolean(host && event.composedPath().includes(host));
}

function onPointerDown(event: PointerEvent): void {
  if (!props.open || inside(event)) return;
  emit("close");
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.open || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}

function onWheel(event: WheelEvent): void {
  if (!props.open || inside(event)) return;
  emit("close");
}

function onScroll(event: Event): void {
  if (!props.open || inside(event)) return;
  emit("close");
}

function dismiss(): void {
  if (props.open) emit("close");
}

function onPick(item: MenuAction): void {
  emit("close");
  item.run();
}

onMounted(() => {
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("wheel", onWheel, { passive: true, capture: true });
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", dismiss);
  window.addEventListener("blur", dismiss);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("wheel", onWheel, true);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", dismiss);
  window.removeEventListener("blur", dismiss);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="hostEl" class="cm-host">
      <MenuPanel
        :items="items"
        :depth="0"
        :x="x"
        :y="y"
        @pick="onPick"
        @close="emit('close')"
      />
    </div>
  </Teleport>
</template>

<style scoped>
/* 只做事件边界，不参与布局：菜单面板自己是 fixed。 */
.cm-host {
  display: contents;
}
</style>

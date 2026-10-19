<script setup lang="ts">
/** 应用根：布局初始化 + 窗口尺寸变化后夹紧面板宽度。 */
import { onMounted, onUnmounted } from "vue";
import AppShell from "@/components/layout/AppShell.vue";
import { useLayoutStore } from "@/stores/layout";

const layout = useLayoutStore();

function onWindowResize(): void {
  layout.clampPanes();
}

onMounted(() => {
  layout.clampPanes();
  window.addEventListener("resize", onWindowResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onWindowResize);
});
</script>

<template>
  <AppShell />
</template>

<script setup lang="ts">
/** 「删除并左移后续片段」图标：垃圾桶 + 向左箭头。 */
withDefaults(defineProps<{ size?: number }>(), {
  size: 16,
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 垃圾桶 -->
    <path d="M8.3 4.4h5.6" />
    <path d="M9.3 4.4V3.2h3.6v1.2" />
    <path d="M8.7 4.4v10.8a1.3 1.3 0 0 0 1.3 1.3h2.2a1.3 1.3 0 0 0 1.3-1.3V4.4" />
    <path d="M10.5 7.1v6.4M12.2 7.1v6.4" opacity=".65" />
    <!-- 左移箭头：删掉后后面的片段向左边补位 -->
    <path d="M6.4 10.4H2.7" />
    <path d="M4.5 8.5 2.6 10.4l1.9 1.9" />
  </svg>
</template>

<script setup lang="ts">
/** 关键帧图标：菱形，与时间线片段上的关键帧标记保持一致。 */
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
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2.8 17.2 10 10 17.2 2.8 10Z" />
  </svg>
</template>

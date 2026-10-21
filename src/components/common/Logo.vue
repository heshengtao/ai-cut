<script setup lang="ts">
/** 应用标识：紫色圆角方块 + 左侧圆角长条 + 圆角播放三角。 */
withDefaults(defineProps<{ size?: number }>(), { size: 28 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    class="logo"
  >
    <rect width="32" height="32" rx="7.25" fill="#6750A4" />
    <rect x="6.25" y="7.563" width="3.75" height="16.875" rx="1.875" fill="#FFB74D" />
    <path
      d="M 12.625 10.539 L 12.625 21.461 Q 12.625 24.438 15.129 22.828 L 23.624 17.367 Q 25.75 16 23.624 14.633 L 15.129 9.172 Q 12.625 7.563 12.625 10.539 Z"
      fill="#fff"
    />
  </svg>
</template>

<style scoped>
.logo {
  display: block;
  flex: 0 0 auto;
  filter: drop-shadow(0 2px 5px rgba(103, 80, 164, 0.24));
}
</style>

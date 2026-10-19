<script setup lang="ts">
/** 应用标识：MD3 圆角方块 + 播放三角 + 剪切线。 */
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
    <defs>
      <linearGradient id="ai-cut-mark" x1="2" y1="0" x2="30" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#8E7CC3" />
        <stop offset="0.55" stop-color="#A98BD6" />
        <stop offset="1" stop-color="#E3A1B8" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9.5" fill="url(#ai-cut-mark)" />
    <path d="M13.2 10.1 L22.6 16 L13.2 21.9 Z" fill="#fff" fill-opacity="0.96" />
    <path
      d="M9.1 9.4 L9.1 22.6"
      stroke="#fff"
      stroke-opacity="0.55"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-dasharray="1.4 3.4"
    />
  </svg>
</template>

<style scoped>
.logo {
  display: block;
  flex: 0 0 auto;
  filter: drop-shadow(0 2px 5px rgba(103, 80, 164, 0.28));
}
</style>

<script setup lang="ts">
/**
 * 面板开关图标（左侧/右侧/底部通用）。
 * `filled` 为真时高亮对应那一侧，用于表示「当前已展开」。
 */
withDefaults(defineProps<{ side?: "left" | "right" | "bottom"; filled?: boolean }>(), {
  side: "left",
  filled: false,
});
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2.8" y="4.8" width="18.4" height="14.4" rx="3" stroke="currentColor" stroke-width="1.6" />
    <template v-if="side === 'left'">
      <line x1="9.6" y1="4.8" x2="9.6" y2="19.2" stroke="currentColor" stroke-width="1.6" />
      <path
        v-if="filled"
        d="M5.8 4.8h3.8v14.4H5.8a3 3 0 0 1-3-3V7.8a3 3 0 0 1 3-3z"
        fill="currentColor"
      />
    </template>
    <template v-else-if="side === 'right'">
      <line x1="14.4" y1="4.8" x2="14.4" y2="19.2" stroke="currentColor" stroke-width="1.6" />
      <path
        v-if="filled"
        d="M14.4 4.8h3.8a3 3 0 0 1 3 3v8.4a3 3 0 0 1-3 3h-3.8z"
        fill="currentColor"
      />
    </template>
    <template v-else>
      <line x1="2.8" y1="13.9" x2="21.2" y2="13.9" stroke="currentColor" stroke-width="1.6" />
      <path
        v-if="filled"
        d="M2.8 13.9h18.4v2.3a3 3 0 0 1-3 3H5.8a3 3 0 0 1-3-3z"
        fill="currentColor"
      />
    </template>
  </svg>
</template>

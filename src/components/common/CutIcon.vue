<script setup lang="ts">
/** 剪映风格的分割 / 向左裁剪 / 向右裁剪图标。 */
withDefaults(
  defineProps<{
    mode?: "split" | "left" | "right";
    size?: number;
  }>(),
  {
    mode: "split",
    size: 16,
  },
);
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
    <template v-if="mode === 'split'">
      <path d="M3.5 4H8V16H3.5" />
      <path d="M16.5 4H12V16H16.5" />
    </template>
    <template v-else-if="mode === 'left'">
      <path d="M8 4V16" stroke-dasharray="2 2" />
      <path d="M16.5 4H12V16H16.5" />
    </template>
    <template v-else>
      <path d="M3.5 4H8V16H3.5" />
      <path d="M12 4V16" stroke-dasharray="2 2" />
    </template>
  </svg>
</template>

<script setup lang="ts">
/**
 * 轻量提示：纯 CSS 显示，不参与布局。
 * `align` 决定气泡相对按钮的锚点（顶栏最右侧的按钮要用 end，避免溢出窗口）。
 */
withDefaults(
  defineProps<{
    text: string;
    align?: "start" | "center" | "end";
    side?: "bottom" | "top";
    /** 弹层打开时把提示藏起来，避免和弹层叠在一起。 */
    disabled?: boolean;
  }>(),
  {
    align: "center",
    side: "bottom",
    disabled: false,
  },
);
</script>

<template>
  <span class="tt-wrap">
    <slot />
    <span
      v-if="!disabled"
      class="tt"
      :class="[`align-${align}`, `side-${side}`]"
      role="tooltip"
    >{{ text }}</span>
  </span>
</template>

<style scoped>
.tt-wrap {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
.tt {
  position: absolute;
  z-index: 90;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 8px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.2px;
  white-space: nowrap;
  color: rgb(var(--md-surface));
  background-color: rgb(var(--md-on-surface));
  box-shadow: var(--md-elevation-2);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.14s ease, transform 0.18s var(--md-ease-emphasized);
}
.tt.side-bottom {
  top: calc(100% + 7px);
}
.tt.side-top {
  bottom: calc(100% + 7px);
}
.tt.align-end {
  left: auto;
  right: 0;
  transform: none;
}
.tt.align-start {
  left: 0;
  transform: none;
}
.tt-wrap:hover > .tt,
.tt-wrap:focus-within > .tt {
  opacity: 1;
}
.tt.side-bottom:not(.align-end):not(.align-start) {
  transform: translate(-50%, -2px);
}
.tt-wrap:hover > .tt.side-bottom:not(.align-end):not(.align-start),
.tt-wrap:focus-within > .tt.side-bottom:not(.align-end):not(.align-start) {
  transform: translate(-50%, 0);
}

@media (prefers-reduced-motion: reduce) {
  .tt {
    transition: none;
  }
}
</style>

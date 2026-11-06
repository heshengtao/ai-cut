<script setup lang="ts">
/** 空时间线插图：标尺 + 一条虚线轨道 + 拖进来的片段 + 播放头。 */
</script>

<template>
  <svg class="art" viewBox="0 0 240 96" role="img" aria-hidden="true" focusable="false">
    <!-- 标尺刻度 -->
    <g style="stroke: rgb(var(--md-outline-variant)); stroke-width: 1; opacity: 0.55">
      <line x1="18" y1="14" x2="18" y2="21" />
      <line x1="66" y1="14" x2="66" y2="21" />
      <line x1="114" y1="10" x2="114" y2="21" />
      <line x1="162" y1="14" x2="162" y2="21" />
      <line x1="210" y1="14" x2="210" y2="21" />
    </g>

    <!-- 空轨道 -->
    <rect
      x="12"
      y="30"
      width="216"
      height="44"
      rx="12"
      style="fill: rgb(var(--md-primary)); fill-opacity: 0.035; stroke: rgb(var(--md-outline-variant)); stroke-width: 1.5; stroke-dasharray: 7 6"
    />

    <!-- 已落下的片段 -->
    <g class="ghost">
      <rect x="28" y="38" width="82" height="28" rx="8" style="fill: rgb(var(--md-primary)); fill-opacity: 0.2" />
      <rect x="28" y="38" width="4" height="28" rx="2" style="fill: rgb(var(--md-primary))" />
      <g style="fill: rgb(var(--md-primary)); opacity: 0.7">
        <rect x="40" y="50" width="14" height="4" rx="2" />
        <rect x="60" y="47" width="22" height="4" rx="2" />
        <rect x="60" y="55" width="34" height="4" rx="2" />
      </g>
    </g>

    <!-- 拖拽虚线 + 光标 -->
    <path
      d="M114 52h24"
      style="stroke: rgb(var(--md-primary)); stroke-width: 1.5; stroke-dasharray: 4 4; opacity: 0.7"
    />
    <g class="cursor" style="fill: rgb(var(--md-on-surface))">
      <path
        d="M140 44l16 6.6-6.6 1.9 3.6 7.3-3.6 1.8-3.6-7.4-5.4 4.2z"
        style="stroke: rgb(var(--md-surface-container-lowest)); stroke-width: 1.4; stroke-linejoin: round"
      />
    </g>

    <!-- 播放头 -->
    <g class="playhead">
      <path d="M182 24h12l-6 9z" style="fill: rgb(var(--md-primary))" />
      <line
        x1="188"
        y1="26"
        x2="188"
        y2="82"
        style="stroke: rgb(var(--md-primary)); stroke-width: 2; opacity: 0.85"
      />
    </g>
  </svg>
</template>

<style scoped>
.art {
  width: 100%;
  max-width: 250px;
  height: auto;
  display: block;
}
.ghost {
  animation: art-ghost 4.5s ease-in-out infinite alternate;
  transform-box: fill-box;
  transform-origin: left center;
}
.cursor {
  animation: art-cursor 4.5s ease-in-out infinite alternate;
}
.playhead {
  animation: art-playhead 5.5s ease-in-out infinite alternate;
}
@keyframes art-ghost {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}
@keyframes art-cursor {
  from {
    transform: translateX(-6px);
  }
  to {
    transform: translateX(0);
  }
}
@keyframes art-playhead {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 0.95;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ghost,
  .cursor,
  .playhead {
    animation: none;
  }
}
</style>

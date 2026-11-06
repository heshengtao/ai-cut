<script setup lang="ts">
/**
 * 欢迎页主插图：一台「正在剪片」的工作站。
 *
 * 纯 SVG + 主题 token，不引位图：亮 / 暗 / 五种强调色都会自动跟着变，
 * 打包体积也只有几 KB。几处慢速浮动由 CSS 驱动，`prefers-reduced-motion` 下自动停。
 */
</script>

<template>
  <svg class="hero" viewBox="0 0 440 360" role="img" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="cut-hero-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" style="stop-color: rgb(var(--md-primary-container))" />
        <stop offset="55%" style="stop-color: rgb(var(--md-surface-container-high))" />
        <stop offset="100%" style="stop-color: rgb(var(--md-tertiary-container))" />
      </linearGradient>
      <linearGradient id="cut-hero-frame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" style="stop-color: rgb(var(--md-primary)); stop-opacity: 0.5" />
        <stop offset="55%" style="stop-color: rgb(var(--md-tertiary)); stop-opacity: 0.38" />
        <stop offset="100%" style="stop-color: rgb(var(--md-secondary)); stop-opacity: 0.45" />
      </linearGradient>
      <linearGradient id="cut-hero-clip" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" style="stop-color: rgb(var(--md-primary)); stop-opacity: 0.4" />
        <stop offset="100%" style="stop-color: rgb(var(--md-primary)); stop-opacity: 0.16" />
      </linearGradient>
      <linearGradient id="cut-hero-clip2" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" style="stop-color: rgb(var(--md-tertiary)); stop-opacity: 0.38" />
        <stop offset="100%" style="stop-color: rgb(var(--md-tertiary)); stop-opacity: 0.14" />
      </linearGradient>
    </defs>

    <!-- 底：柔和的圆角画布 + 两团气氛色 -->
    <rect x="0" y="0" width="440" height="360" rx="28" fill="url(#cut-hero-bg)" />
    <circle cx="372" cy="54" r="88" style="fill: rgb(var(--md-tertiary)); opacity: 0.16" />
    <circle cx="52" cy="320" r="104" style="fill: rgb(var(--md-primary)); opacity: 0.14" />

    <!-- 工作站窗口 -->
    <g class="float">
      <rect
        x="44"
        y="104"
        width="352"
        height="196"
        rx="20"
        style="fill: rgb(var(--md-scrim)); opacity: 0.18"
      />
      <rect
        x="36"
        y="96"
        width="368"
        height="204"
        rx="20"
        style="fill: rgb(var(--md-surface-container-high)); stroke: rgb(var(--md-outline-variant)); stroke-opacity: 0.55"
        stroke-width="1.5"
      />

      <!-- 标题栏 -->
      <circle cx="58" cy="116" r="3.5" style="fill: rgb(var(--md-outline)); opacity: 0.5" />
      <circle cx="70" cy="116" r="3.5" style="fill: rgb(var(--md-outline)); opacity: 0.35" />
      <circle cx="82" cy="116" r="3.5" style="fill: rgb(var(--md-outline)); opacity: 0.25" />
      <rect x="300" y="110" width="64" height="12" rx="6" style="fill: rgb(var(--md-primary)); opacity: 0.18" />
      <rect x="108" y="111" width="46" height="10" rx="5" style="fill: rgb(var(--md-on-surface)); opacity: 0.12" />

      <line
        x1="36"
        y1="132"
        x2="404"
        y2="132"
        style="stroke: rgb(var(--md-outline-variant)); opacity: 0.4"
      />

      <!-- 左侧预览：黑色画面 + 播放按钮 -->
      <g class="preview">
        <rect x="50" y="146" width="126" height="82" rx="12" style="fill: rgb(var(--md-scrim)); opacity: 0.82" />
        <rect x="50" y="146" width="126" height="82" rx="12" fill="url(#cut-hero-frame)" opacity="0.55" />
        <circle cx="113" cy="187" r="17" style="fill: rgb(var(--md-surface-container-lowest)); opacity: 0.92" />
        <path d="M108 179l14 8-14 8z" style="fill: rgb(var(--md-primary))" />
        <rect x="60" y="210" width="34" height="4" rx="2" style="fill: rgb(var(--md-on-surface)); opacity: 0.28" />
        <rect x="60" y="218" width="54" height="3" rx="1.5" style="fill: rgb(var(--md-on-surface)); opacity: 0.16" />
      </g>

      <!-- 右侧时间线：标尺 + 三条轨道 -->
      <g>
        <g style="stroke: rgb(var(--md-outline-variant)); stroke-width: 1; opacity: 0.5">
          <line x1="192" y1="146" x2="192" y2="152" />
          <line x1="228" y1="146" x2="228" y2="152" />
          <line x1="264" y1="142" x2="264" y2="152" />
          <line x1="300" y1="146" x2="300" y2="152" />
          <line x1="336" y1="146" x2="336" y2="152" />
          <line x1="372" y1="146" x2="372" y2="152" />
        </g>

        <line x1="192" y1="178" x2="392" y2="178" style="stroke: rgb(var(--md-outline-variant)); opacity: 0.38" />
        <line x1="192" y1="206" x2="392" y2="206" style="stroke: rgb(var(--md-outline-variant)); opacity: 0.38" />
        <line x1="192" y1="234" x2="392" y2="234" style="stroke: rgb(var(--md-outline-variant)); opacity: 0.38" />

        <!-- 第一轨：两块片段 -->
        <g class="pop-a">
          <rect x="198" y="156" width="76" height="18" rx="7" fill="url(#cut-hero-clip)" />
          <rect x="198" y="156" width="4" height="18" rx="2" style="fill: rgb(var(--md-primary))" />
          <rect x="284" y="156" width="100" height="18" rx="7" fill="url(#cut-hero-clip)" />
          <rect x="284" y="156" width="4" height="18" rx="2" style="fill: rgb(var(--md-primary))" />
        </g>

        <!-- 第二轨：音频波形 -->
        <g class="pop-b">
          <rect x="198" y="184" width="128" height="18" rx="7" fill="url(#cut-hero-clip2)" />
          <rect x="198" y="184" width="4" height="18" rx="2" style="fill: rgb(var(--md-tertiary))" />
          <g style="fill: rgb(var(--md-tertiary)); opacity: 0.85">
            <rect
              v-for="(h, i) in [6, 11, 15, 8, 13, 5, 10, 16, 7, 12, 4, 9, 14, 6, 11, 8]"
              :key="i"
              :x="210 + i * 7"
              :y="193 - h / 2"
              width="3"
              :height="h"
              rx="1.5"
            />
          </g>
        </g>

        <!-- 第三轨：文字 / 字幕块 -->
        <g class="pop-c">
          <rect x="198" y="212" width="70" height="18" rx="7" style="fill: rgb(var(--md-secondary)); opacity: 0.2" />
          <g style="fill: rgb(var(--md-secondary)); opacity: 0.8">
            <rect x="208" y="219" width="30" height="4" rx="2" />
            <rect x="244" y="219" width="14" height="4" rx="2" />
          </g>
          <rect x="276" y="212" width="110" height="18" rx="7" style="fill: rgb(var(--md-secondary)); opacity: 0.14" />
          <g style="fill: rgb(var(--md-secondary)); opacity: 0.6">
            <rect x="286" y="219" width="24" height="4" rx="2" />
            <rect x="316" y="219" width="40" height="4" rx="2" />
          </g>
        </g>

        <!-- 播放头 -->
        <g class="playhead">
          <rect x="272" y="138" width="2" height="108" style="fill: rgb(var(--md-primary)); opacity: 0.9" />
          <path d="M265 138h16l-8 11z" style="fill: rgb(var(--md-primary))" />
        </g>
      </g>

      <!-- 底部传输条 -->
      <rect x="50" y="246" width="126" height="20" rx="10" style="fill: rgb(var(--md-surface-container-lowest)); opacity: 0.5" />
      <circle cx="61" cy="256" r="5" style="fill: rgb(var(--md-primary)); opacity: 0.7" />
      <rect x="72" y="254" width="52" height="4" rx="2" style="fill: rgb(var(--md-on-surface)); opacity: 0.2" />
      <rect x="132" y="254" width="32" height="4" rx="2" style="fill: rgb(var(--md-on-surface)); opacity: 0.12" />
    </g>

    <!-- AI 标记：主色圆 + 四角星 -->
    <g class="spark spark-1">
      <circle cx="372" cy="82" r="24" style="fill: rgb(var(--md-primary))" />
      <path
        d="M372 66l4.4 11.6L388 82l-11.6 4.4L372 98l-4.4-11.6L356 82l11.6-4.4z"
        style="fill: rgb(var(--md-on-primary))"
      />
    </g>
    <g class="spark spark-2">
      <path
        d="M318 52l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"
        style="fill: rgb(var(--md-tertiary)); opacity: 0.85"
      />
    </g>
    <g class="spark spark-3">
      <path
        d="M410 134l2.4 6.4 6.6 2.4-6.6 2.4-2.4 6.4-2.4-6.4-6.6-2.4 6.6-2.4z"
        style="fill: rgb(var(--md-primary)); opacity: 0.6"
      />
    </g>

    <!-- 两枚飘在外面的小胶片，压住四角 -->
    <g class="reel reel-1" style="fill: rgb(var(--md-primary)); opacity: 0.42">
      <rect x="12" y="52" width="46" height="32" rx="8" />
      <g style="fill: rgb(var(--md-surface-container-high))">
        <rect x="18" y="58" width="5" height="5" rx="1.5" />
        <rect x="47" y="58" width="5" height="5" rx="1.5" />
        <rect x="18" y="73" width="5" height="5" rx="1.5" />
        <rect x="47" y="73" width="5" height="5" rx="1.5" />
      </g>
    </g>
    <g class="reel reel-2" style="fill: rgb(var(--md-tertiary)); opacity: 0.4">
      <rect x="386" y="292" width="42" height="30" rx="8" />
      <g style="fill: rgb(var(--md-surface-container-high))">
        <rect x="392" y="298" width="5" height="5" rx="1.5" />
        <rect x="417" y="298" width="5" height="5" rx="1.5" />
        <rect x="392" y="311" width="5" height="5" rx="1.5" />
        <rect x="417" y="311" width="5" height="5" rx="1.5" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.hero {
  width: 100%;
  height: auto;
  display: block;
}

/* 窗口整体上下轻浮；音符 / 胶片反向慢慢飘：幅度只有 6px，不抢文字。 */
.float {
  animation: hero-float 7s ease-in-out infinite alternate;
}
.reel-1 {
  animation: hero-drift 9s ease-in-out infinite alternate;
}
.reel-2 {
  animation: hero-drift 11s ease-in-out infinite alternate-reverse;
}
.spark {
  transform-box: fill-box;
  transform-origin: center;
}
.spark-1 {
  animation: hero-twinkle 3.6s ease-in-out infinite;
}
.spark-2 {
  animation: hero-twinkle 3.6s ease-in-out 0.7s infinite;
}
.spark-3 {
  animation: hero-twinkle 4.4s ease-in-out 1.4s infinite;
}
.preview {
  transform-box: fill-box;
  transform-origin: center;
  animation: hero-preview 5s ease-in-out infinite alternate;
}
.playhead {
  animation: hero-playhead 5.5s ease-in-out infinite alternate;
}

@keyframes hero-float {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-6px);
  }
}
@keyframes hero-drift {
  from {
    transform: translateY(0) rotate(0deg);
  }
  to {
    transform: translateY(-8px) rotate(3deg);
  }
}
@keyframes hero-twinkle {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}
@keyframes hero-preview {
  from {
    opacity: 0.9;
  }
  to {
    opacity: 1;
  }
}
@keyframes hero-playhead {
  from {
    opacity: 0.65;
  }
  to {
    opacity: 0.95;
  }
}

@media (prefers-reduced-motion: reduce) {
  .float,
  .reel-1,
  .reel-2,
  .spark,
  .preview,
  .playhead {
    animation: none;
  }
}
</style>

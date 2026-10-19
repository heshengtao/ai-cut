<script setup lang="ts">
/** 媒体库面板：搜索 + 筛选 + 素材网格（原型占位，无真实数据）。 */
import { ref } from "vue";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
} from "@heroicons/vue/24/outline";

type Kind = "video" | "audio" | "image";

const filters: { id: "all" | Kind; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "image", label: "图片" },
];

const activeFilter = ref<"all" | Kind>("all");

const assets: {
  name: string;
  info: string;
  duration: string;
  kind: Kind;
  grad: string;
}[] = [
  {
    name: "海边日落.mp4",
    info: "1920 × 1080 · 30fps",
    duration: "00:12",
    kind: "video",
    grad: "linear-gradient(140deg, #2c1f4d 0%, #7c4a76 45%, #e79a76 100%)",
  },
  {
    name: "城市夜景.mp4",
    info: "3840 × 2160 · 60fps",
    duration: "00:24",
    kind: "video",
    grad: "linear-gradient(140deg, #101b33 0%, #274b74 50%, #6fa8c9 100%)",
  },
  {
    name: "产品特写.mp4",
    info: "1920 × 1080 · 30fps",
    duration: "00:08",
    kind: "video",
    grad: "linear-gradient(140deg, #3d2a1c 0%, #9c6b3f 55%, #f0cf9a 100%)",
  },
  {
    name: "人物访谈.mp4",
    info: "1920 × 1080 · 25fps",
    duration: "01:36",
    kind: "video",
    grad: "linear-gradient(140deg, #1f2a24 0%, #46604f 55%, #a9c4a2 100%)",
  },
  {
    name: "背景音乐.wav",
    info: "48 kHz · 立体声",
    duration: "02:10",
    kind: "audio",
    grad: "linear-gradient(140deg, #2b2140 0%, #5b4a86 55%, #b6a1e0 100%)",
  },
  {
    name: "片头标题.png",
    info: "2400 × 1350 · 透明",
    duration: "—",
    kind: "image",
    grad: "linear-gradient(140deg, #3a2230 0%, #8c4f68 55%, #e7a9bd 100%)",
  },
];

const kindIcon = {
  video: FilmIcon,
  audio: MusicalNoteIcon,
  image: PhotoIcon,
};

function visibleAssets(): typeof assets {
  if (activeFilter.value === "all") return assets;
  return assets.filter((a) => a.kind === activeFilter.value);
}
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">媒体库</h2>
        <p class="pane-sub">6 个素材 · 已同步到项目</p>
      </div>
      <button class="icon-btn" aria-label="导入素材">
        <PlusIcon class="w-[17px] h-[17px]" />
      </button>
    </header>

    <div class="search-row">
      <div class="search">
        <MagnifyingGlassIcon class="search-icon" />
        <input class="md3-field search-field" placeholder="搜索素材" />
      </div>
    </div>

    <div class="chips" role="group" aria-label="素材类型">
      <button
        v-for="f in filters"
        :key="f.id"
        class="chip"
        :class="{ on: activeFilter === f.id }"
        :aria-pressed="activeFilter === f.id"
        @click="activeFilter = f.id"
      >
        {{ f.label }}
      </button>
    </div>

    <div class="pane-scroll">
      <div class="grid">
        <article v-for="a in visibleAssets()" :key="a.name" class="asset">
          <div class="thumb" :style="{ background: a.grad }">
            <component :is="kindIcon[a.kind]" class="thumb-icon" />
            <span class="duration tabular">{{ a.duration }}</span>
          </div>
          <div class="asset-text">
            <span class="asset-name">{{ a.name }}</span>
            <span class="asset-info">{{ a.info }}</span>
          </div>
        </article>
      </div>

      <button class="import">
        <PlusIcon class="w-4 h-4" />
        导入媒体
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-row {
  padding: 0 16px 10px;
}
.search {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 11px;
  width: 15px;
  height: 15px;
  color: rgb(var(--md-on-surface-muted));
  pointer-events: none;
}
.search-field {
  width: 100%;
  padding-left: 33px;
}
.chips {
  display: flex;
  gap: 6px;
  padding: 0 16px 12px;
  flex-wrap: wrap;
}
.chip {
  height: 26px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.8);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.chip:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.chip.on {
  border-color: transparent;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.asset {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.asset:hover {
  background-color: rgb(var(--md-on-surface) / 0.05);
}
.thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
}
.thumb::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.35), transparent 55%);
}
.thumb-icon {
  width: 18px;
  height: 18px;
  color: rgba(255, 255, 255, 0.82);
  z-index: 1;
}
.duration {
  position: absolute;
  right: 5px;
  bottom: 5px;
  z-index: 1;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.asset-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 0 2px;
}
.asset-name {
  font-size: 11.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-info {
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.import {
  width: 100%;
  margin-top: 14px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed rgb(var(--md-outline) / 0.65);
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.import:hover {
  background-color: rgb(var(--md-primary) / 0.07);
  border-color: rgb(var(--md-primary) / 0.7);
}
</style>

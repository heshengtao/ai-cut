/** 播放状态：播放头、是否播放、时间线缩放。 */
import { ref } from "vue";
import { defineStore } from "pinia";

/** 时间线缩放（px/秒）范围。 */
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 400;
const DEFAULT_ZOOM = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const usePlaybackStore = defineStore("playback", () => {
  const playhead = ref(0);
  const playing = ref(false);
  const zoom = ref(DEFAULT_ZOOM);
  const loop = ref(false);

  function setPlayhead(seconds: number): void {
    playhead.value = Math.max(0, seconds);
  }

  function setZoom(pxPerSecond: number): void {
    zoom.value = clamp(pxPerSecond, MIN_ZOOM, MAX_ZOOM);
  }

  return { playhead, playing, zoom, loop, setPlayhead, setZoom };
});

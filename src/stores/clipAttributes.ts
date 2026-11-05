/**
 * 片段「效果属性」剪贴板。
 *
 * 检查器与时间线右键菜单共用同一份：在一边复制、另一边粘贴也成立。
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { Clip } from "@/types/project";
import { copyClipAttributes, type ClipAttributes } from "@/core/clipAttributes";

export const useClipAttributesStore = defineStore("clipAttributes", () => {
  const clipboard = ref<ClipAttributes | null>(null);
  const hasClipboard = computed(() => clipboard.value !== null);

  function copy(clip: Clip): void {
    clipboard.value = copyClipAttributes(clip);
  }

  function clear(): void {
    clipboard.value = null;
  }

  return { clipboard, hasClipboard, copy, clear };
});

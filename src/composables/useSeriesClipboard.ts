/**
 * 剧集剪贴板：跨视图保留一份分P 快照（纯数据拷贝，不引用工程里的对象）。
 */
import { computed, ref } from "vue";
import type { Episode } from "@/types/project";

const snapshot = ref<Episode | null>(null);

/** 深拷贝一份纯数据快照：工程里的对象可能被后续编辑替换。 */
function snapshotOf(episode: Episode): Episode {
  return JSON.parse(JSON.stringify(episode)) as Episode;
}

export function useSeriesClipboard() {
  return {
    hasContent: computed(() => snapshot.value !== null),
    copy(episode: Episode): void {
      snapshot.value = snapshotOf(episode);
    },
    read(): Episode | null {
      return snapshot.value;
    },
    clear(): void {
      snapshot.value = null;
    },
  };
}

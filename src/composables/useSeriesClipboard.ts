/**
 * 剧集剪贴板：跨视图保留一份分P 快照（纯数据拷贝，不引用工程里的对象）。
 *
 * 支持多选：画布的复制 / 剪切可以一次带多个分P。
 */
import { computed, ref } from "vue";
import type { Episode } from "@/types/project";

const snapshot = ref<Episode[]>([]);

/** 深拷贝一份纯数据快照：工程里的对象可能被后续编辑替换。 */
function snapshotOf(episode: Episode): Episode {
  return JSON.parse(JSON.stringify(episode)) as Episode;
}

export function useSeriesClipboard() {
  return {
    hasContent: computed(() => snapshot.value.length > 0),
    count: computed(() => snapshot.value.length),
    copy(episodes: Episode[]): void {
      snapshot.value = episodes.map(snapshotOf);
    },
    read(): Episode[] {
      return snapshot.value;
    },
    clear(): void {
      snapshot.value = [];
    },
  };
}

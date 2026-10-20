/** 时间线上的「动词」：分割、裁剪与删除。工具栏与快捷键共用。 */
import { computed, reactive } from "vue";
import { removeClips, splitClips, trimClip } from "@/core/ops";
import { covers } from "@/core/playback/activeClips";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { toast } from "@/composables/useToast";
import { t } from "@/i18n";

export function useTimelineActions() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();

  const allClips = computed(() => project.doc.tracks.flatMap((t) => t.clips));

  /** 播放头严格落在内部的可分割片段：已选中的（若选中了）或全部片段。 */
  const splittableIds = computed(() => {
    const at = playback.playhead;
    const selected = selection.selectedClipIds;
    const pool = selected.length > 0 ? allClips.value.filter((c) => selected.includes(c.id)) : allClips.value;
    return pool.filter((c) => at > c.start && at < c.start + c.duration).map((c) => c.id);
  });

  /** 已选中且播放头严格落在内部的片段（裁剪需要两端都有余量）。 */
  const trimmableIds = computed(() => {
    const at = playback.playhead;
    const selected = new Set(selection.selectedClipIds);
    return allClips.value
      .filter((c) => selected.has(c.id) && at > c.start && at < c.start + c.duration)
      .map((c) => c.id);
  });

  const canSplit = computed(() => splittableIds.value.length > 0);
  const canTrim = computed(() => trimmableIds.value.length > 0);
  const canDelete = computed(() => selection.selectedClipIds.length > 0);

  function splitAtPlayhead(): void {
    const ids = splittableIds.value;
    if (ids.length === 0) {
      toast(t("timeline.nothingToSplit"));
      return;
    }
    project.dispatch((doc) => splitClips(doc, ids, playback.playhead));
    // 分割产生的新片段与左半段都保留选中，方便接着操作
    const after = project.doc.tracks.flatMap((t) => t.clips);
    selection.selectMany(
      after.filter((c) => covers(c, playback.playhead) || ids.includes(c.id)).map((c) => c.id),
    );
  }

  /** 把选中片段的起点 / 终点裁剪到播放头（剪映的左右裁剪）。 */
  function trimToPlayhead(edge: "start" | "end"): void {
    const ids = trimmableIds.value;
    if (ids.length === 0) {
      toast(t("timeline.selectForTrim"));
      return;
    }
    project.dispatch((doc) =>
      ids.reduce((next, id) => trimClip(next, id, edge, playback.playhead), doc),
    );
  }

  function deleteSelected(): void {
    const ids = [...selection.selectedClipIds];
    if (ids.length === 0) return;
    project.dispatch((doc) => removeClips(doc, ids));
    selection.clear();
  }

  // `reactive` 会自动解包 computed，模板里直接写 `actions.canSplit` 即可。
  return reactive({
    splitAtPlayhead,
    trimToPlayhead,
    deleteSelected,
    canSplit,
    canTrim,
    canDelete,
  });
}

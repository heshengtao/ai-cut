/** 时间线上的「动词」：分割、裁剪与删除。工具栏与快捷键共用。 */
import { computed, reactive } from "vue";
import {
  addMarker,
  duplicateClips,
  insertClipKeyframe,
  removeClips,
  rippleDeleteClips,
  splitClips,
  trimClip,
} from "@/core/ops";
import { createMarker } from "@/core/factory";
import { snapToFrame } from "@/core/time";
import { covers } from "@/core/playback/activeClips";
import {
  clipboardCount,
  copyClipsToClipboard,
  pasteFromClipboard,
} from "@/core/clipClipboard";
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
  const canDuplicate = computed(() => selection.selectedClipIds.length > 0);
  const canPaste = computed(() => clipboardCount.value > 0);

  /** 选中且覆盖播放头的画面片段：可以在这里打关键帧（纯音频片段没有可动画参数）。 */
  const keyframableClips = computed(() => {
    const at = playback.playhead;
    const selected = new Set(selection.selectedClipIds);
    if (selected.size === 0) return [];
    const assets = new Map(project.doc.assets.map((asset) => [asset.id, asset]));
    return allClips.value.filter((clip) => {
      if (!selected.has(clip.id)) return false;
      if (at < clip.start - 1e-6 || at > clip.start + clip.duration + 1e-6) return false;

      if (clip.audioOnly) return false;
      if (clip.assetId === "") return true;
      return assets.get(clip.assetId)?.kind !== "audio";
    });
  });
  const canAddKeyframe = computed(() => keyframableClips.value.length > 0);

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

  /** 复制选中片段到剪贴板（不改变时间线）。 */
  function copySelected(): void {
    const ids = [...selection.selectedClipIds];
    if (ids.length === 0) return;
    copyClipsToClipboard(project.doc, ids);
  }

  /** 剪切：一次 dispatch 里「先存快照、再删除」，只留一步撤销。 */
  function cutSelected(): void {
    const ids = [...selection.selectedClipIds];
    if (ids.length === 0) return;
    if (copyClipsToClipboard(project.doc, ids) === 0) return;
    project.dispatch((doc) => removeClips(doc, ids), {
      kind: "ui.dispatch",
      actor: "human",
      label: t("timeline.cutLabel"),
    });
    selection.clear();
  }

  /** 粘贴到播放头：保持组内相对位置，冲突时顺延；粘贴后选中新片段。 */
  function pasteClipboard(): void {
    if (clipboardCount.value === 0) return;
    const at = snapToFrame(playback.playhead, project.doc.fps);
    const holder: { ids: string[] } = { ids: [] };
    project.dispatch(
      (doc) => {
        const result = pasteFromClipboard(doc, at);
        holder.ids = result.ids;
        return result.doc;
      },
      {
        kind: "ui.dispatch",
        actor: "human",
        label: t("timeline.pasteLabel"),
      },
    );
    if (holder.ids.length > 0) selection.selectMany(holder.ids);
  }

  /** 复制选中片段，默认落到当前选区之后；位置冲突时保持原文档不变。 */
  function duplicateSelected(): void {
    const ids = [...selection.selectedClipIds];
    if (ids.length === 0) return;
    const clips = allClips.value.filter((clip) => ids.includes(clip.id));
    if (clips.length === 0) return;

    const start = Math.min(...clips.map((clip) => clip.start));
    const end = Math.max(...clips.map((clip) => clip.start + clip.duration));
    const offset = Math.max(1 / project.doc.fps, end - start);
    const before = new Set(allClips.value.map((clip) => clip.id));

    try {
      project.dispatch((doc) => duplicateClips(doc, ids, offset), {
        kind: "clip.duplicate",
        payload: { clipIds: ids, offset },
        label: t("timeline.duplicateLabel"),
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : t("timeline.duplicateLabel"));
      return;
    }

    const created = allClips.value
      .filter((clip) => !before.has(clip.id))
      .map((clip) => clip.id);
    if (created.length > 0) selection.selectMany(created);
  }

  function rippleDeleteSelected(): void {
    const ids = [...selection.selectedClipIds];
    if (ids.length === 0) return;
    project.dispatch((doc) => rippleDeleteClips(doc, ids), {
      kind: "clip.ripple_delete",
      payload: { clipIds: ids },
      label: t("timeline.rippleDeleteLabel"),
    });
    selection.clear();
  }

  /** 在播放头给选中的画面片段打关键帧：已有同刻关键帧则更新。 */
  function addKeyframeAtPlayhead(): void {
    const clips = keyframableClips.value;
    if (clips.length === 0) {
      toast(t("timeline.selectForKeyframe"));
      return;
    }
    const at = playback.playhead;
    project.dispatch(
      (doc) =>
        clips.reduce(
          (next, clip) => insertClipKeyframe(next, clip.id, at - clip.start),
          doc,
        ),
      { actor: "human", label: t("timeline.addKeyframeLabel") },
    );
  }

  function addMarkerAtPlayhead(): void {
    const time = Math.max(0, snapToFrame(playback.playhead, project.doc.fps));
    project.dispatch(
      (doc) =>
        addMarker(
          doc,
          createMarker({
            time,
            name: t("marker.defaultName", { n: doc.markers.length + 1 }),
          }),
        ),
      {
        kind: "marker.add",
        payload: { time },
        label: t("marker.addLabel"),
      },
    );
  }

  // `reactive` 会自动解包 computed，模板里直接写 `actions.canSplit` 即可。
  return reactive({
    splitAtPlayhead,
    trimToPlayhead,
    deleteSelected,
    copySelected,
    cutSelected,
    pasteClipboard,
    duplicateSelected,
    rippleDeleteSelected,
    addKeyframeAtPlayhead,
    addMarkerAtPlayhead,
    canSplit,
    canTrim,
    canDelete,
    canDuplicate,
    canPaste,
    canAddKeyframe,
  });
}

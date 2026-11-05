/**
 * 时间线插入动作：文字片段与「在播放头加文字」。
 *
 * 拖放与右键菜单共用这一套，保证落点、避让与后续选中行为一致。
 */
import { useProjectStore } from "@/stores/project";
import { usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { useLayoutStore } from "@/stores/layout";
import { useTextPresetsStore } from "@/stores/textPresets";
import { addClip, addTrack } from "@/core/ops";
import { createClip } from "@/core/factory";
import { resolveTextStyle } from "@/core/clipStyle";
import { TEXT_PRESET_SECONDS } from "@/core/textPresets";
import {
  placeWithoutOverlap,
  resolveDropTrack,
  type DropPlacement,
} from "@/core/timelinePlacement";
import { toast } from "@/composables/useToast";
import type { Clip, ClipTextStyle } from "@/types/project";
import { t } from "@/i18n";

export function useTimelineInsert() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();
  const layout = useLayoutStore();
  const textPresets = useTextPresetsStore();

  /**
   * 在指定时间插入文字片段，并打开属性面板。
   * 有落点时严格落到目标轨道（越界则新建）；否则用第一条未锁定轨道，必要时新建。
   */
  function insertTextClip(
    rawStart: number,
    text: string,
    duration = TEXT_PRESET_SECONDS,
    placement?: DropPlacement,
    textStyle?: ClipTextStyle,
  ): void {
    const holder: { clip: Clip | null } = { clip: null };
    let locked = false;

    project.dispatch((doc) => {
      let next = doc;
      let trackId: string | null = null;

      if (placement) {
        const resolved = resolveDropTrack(next, placement);
        next = resolved.doc;
        trackId = resolved.trackId;
      } else {
        const track = next.tracks.find((candidate) => !candidate.locked);
        if (track) {
          trackId = track.id;
        } else {
          next = addTrack(next);
          trackId = next.tracks[next.tracks.length - 1].id;
        }
      }

      if (!trackId) {
        locked = true;
        return doc;
      }

      const track = next.tracks.find((candidate) => candidate.id === trackId);
      if (!track) return doc;

      const start = placeWithoutOverlap(rawStart, duration, track.clips, next.fps);
      const clip = createClip({
        assetId: "",
        trackId: track.id,
        start,
        duration,
        text,
        ...(textStyle ? { textStyle } : {}),
      });
      holder.clip = clip;
      return addClip(next, track.id, clip);
    });

    if (locked) {
      toast(t("timeline.locked"), "error");
      return;
    }
    if (holder.clip) {
      if (textStyle) textPresets.rememberStyle(textStyle);
      selection.select(holder.clip.id);
      layout.openTab("inspector");
    }
  }

  /** 在指定时间加一个文字片段：优先复用当前选中文字片段的样式，其次上一次操作的样式。 */
  function addTextAt(rawStart: number): void {
    const selectedText =
      selection.selectedClipIds.length === 1
        ? project.doc.tracks
            .flatMap((track) => track.clips)
            .find(
              (clip) => clip.id === selection.selectedClipIds[0] && clip.assetId === "",
            )
        : undefined;
    const style = selectedText ? resolveTextStyle(selectedText) : textPresets.lastStyle;
    insertTextClip(
      rawStart,
      t("textPreset.default.text"),
      TEXT_PRESET_SECONDS,
      undefined,
      style,
    );
  }

  function addTextAtPlayhead(): void {
    addTextAt(playback.playhead);
  }

  return { insertTextClip, addTextAt, addTextAtPlayhead };
}

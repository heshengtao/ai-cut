/**
 * 剧集播放：沿连线自动连播、分叉时给出选项、无选项的环就停下。
 *
 * `visited` 只在「按下播放」与「切换播放模式」时重置——自动连播切集也会 `setPlayhead(0)`，
 * 若按播放头变化重置，循环判定永远看不到环。
 */
import { nextTick, ref } from "vue";
import { episodeDuration } from "@/core/ops/episodes";
import { stepOf } from "@/core/series/graph";
import { useI18n } from "@/i18n";
import { useLayoutStore } from "@/stores/layout";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { toast } from "./useToast";
import type { SeriesOption } from "@/types/project";

interface PendingChoices {
  episodeId: string;
  options: SeriesOption[];
}

/** 本集播完、等待用户点选项。 */
const pending = ref<PendingChoices | null>(null);
/** 本轮自动连播已经过的分P（含起点）。 */
let visited = new Set<string>();
/** 程序自己把播放头挪到尾帧时，不要被当成「用户拖动」清掉选项浮层。 */
let programmaticSeek = false;

export function useSeriesPlayback() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const layout = useLayoutStore();
  const i18n = useI18n();

  function nameOf(id: string): string {
    return project.doc.episodes.find((episode) => episode.id === id)?.name ?? "";
  }

  /** 开始新一轮：清空选项浮层，访问记录只剩当前分P。 */
  function resetRun(): void {
    pending.value = null;
    visited = new Set([project.doc.activeEpisodeId]);
  }

  /** 用户拖动播放头：只清掉选项浮层，不动访问记录。 */
  function onUserSeek(): void {
    if (programmaticSeek) return;
    pending.value = null;
  }

  /** 停在尾帧：把播放头挪到最后一帧，画面保持住，选项浮层才出现。 */
  function holdLastFrame(): void {
    const episode = project.doc.episodes.find((item) => item.id === project.doc.activeEpisodeId);
    const duration = episode ? episodeDuration(episode) : 0;
    if (duration <= 0) return;
    const fps = project.doc.fps || 30;
    programmaticSeek = true;
    playback.setPlayhead(Math.max(0, duration - 1 / (fps * 2)));
    void nextTick(() => {
      programmaticSeek = false;
    });
  }

  function onEnded(): "stop" | "advance" | "choices" {
    if (layout.seriesPlayMode !== "series") return "stop";
    const from = project.doc.activeEpisodeId;
    const step = stepOf(project.doc, from, visited);
    if (step.kind === "auto") {
      if (!project.switchEpisode(step.to)) return "stop";
      visited.add(from);
      visited.add(step.to);
      playback.setPlayhead(0);
      return "advance";
    }
    if (step.kind === "choices") {
      pending.value = { episodeId: from, options: step.options };
      holdLastFrame();
      return "choices";
    }
    if (step.kind === "loop") {
      toast(i18n.t("series.playback.loop", { name: nameOf(step.to) }));
      return "stop";
    }
    toast(i18n.t("series.playback.ended"));
    return "stop";
  }

  /** 点选项：切到目标分P 并继续播（手动选择不做循环拦截）。 */
  function choose(edgeId: string): boolean {
    const option = pending.value?.options.find((item) => item.edgeId === edgeId);
    if (!option) return false;
    const switched = project.switchEpisode(option.to);
    pending.value = null;
    if (!switched) return false;
    visited.add(project.doc.activeEpisodeId);
    playback.setPlayhead(0);
    return true;
  }

  return { pending, resetRun, onUserSeek, onEnded, choose };
}

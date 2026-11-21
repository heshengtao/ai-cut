/** 进入某个分P 的预览：切分P + 播放头归零 + 回到预览界面。 */
import { nextTick } from "vue";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useViewStore } from "@/stores/view";

export function useEpisodeOpen(): (episodeId: string) => void {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const view = useViewStore();

  return (episodeId: string): void => {
    if (episodeId !== project.doc.activeEpisodeId) project.switchEpisode(episodeId);
    playback.setPlayhead(0);
    view.setView("preview");
  };
}

/**
 * 从画布节点直接播放：进预览后立刻开始播。
 *
 * 必须等一拍再置 `playing`：`PreviewStage` 是在这次视图切换里挂载的，它的播放引擎
 * 在 onMounted 里创建；提前置 true 的话引擎还没就绪。
 */
export function useEpisodePlay(): (episodeId: string) => void {
  const open = useEpisodeOpen();
  const playback = usePlaybackStore();

  return (episodeId: string): void => {
    open(episodeId);
    void nextTick(() => {
      playback.setPlayhead(0);
      playback.playing = true;
    });
  };
}

/** 进入某个分P 的预览：切分P + 播放头归零 + 回到预览界面。 */
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

/**
 * 预览舞台把拖动 / 缩放的结果写回文档。
 *
 * 单独抽出来是为了能被测试固定住：片段可能在**任意一条轨道**上，
 * 遍历时找不到片段的轨道必须 `continue`，不能提前 `return doc`
 * （早期版本提前返回，于是只有第一条轨道上的片段能拖，其余全部静默失败）。
 */
import type { ClipTransform, Project } from "@/types/project";
import { setClipKeyframes, setClipTransform } from "@/core/ops";
import { upsertKeyframe } from "@/core/keyframes";

/**
 * 给片段写入变换：没有关键帧时直接改基础变换，有关键帧时写当前时间的那一帧。
 *
 * @param time 播放头时间线时间（秒）
 */
export function patchClipTransform(
  doc: Project,
  clipId: string,
  patch: Partial<ClipTransform>,
  time: number,
): Project {
  for (const track of doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (!clip) continue;
    if (!clip.keyframes?.length) return setClipTransform(doc, clipId, patch);
    const local = Math.max(0, Math.min(clip.duration, time - clip.start));
    return setClipKeyframes(doc, clipId, upsertKeyframe(clip, local, patch));
  }
  return doc;
}

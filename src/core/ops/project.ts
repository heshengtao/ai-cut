/** 工程级 ops：名字与输出设置（分辨率 / 帧率）。 */
import type { Project } from "@/types/project";
import { evenDimension, normalizeFps } from "@/core/projectOutput";
import { withTouch } from "./internal";

export function renameProject(doc: Project, name: string): Project {
  if (doc.name === name) return doc;
  return withTouch(doc, { name });
}

/** 更新工程输出设置；宽高取偶数，帧率夹到合法范围。 */
export function setProjectOutput(
  doc: Project,
  patch: { width?: number; height?: number; fps?: number },
): Project {
  const width = patch.width === undefined ? doc.width : evenDimension(patch.width);
  const height = patch.height === undefined ? doc.height : evenDimension(patch.height);
  const fps = patch.fps === undefined ? doc.fps : normalizeFps(patch.fps);
  if (width === doc.width && height === doc.height && fps === doc.fps) return doc;
  return withTouch(doc, { width, height, fps });
}

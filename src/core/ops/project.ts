/** 工程级 ops：整体属性（目前只有名字）。 */
import type { Project } from "@/types/project";
import { withTouch } from "./internal";

export function renameProject(doc: Project, name: string): Project {
  if (doc.name === name) return doc;
  return withTouch(doc, { name });
}

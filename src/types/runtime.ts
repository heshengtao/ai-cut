/** 本地 AI 运行时（ONNX Runtime 构建）的清单与下载进度。 */
export interface RuntimeStatus {
  id: string;
  /** i18n key（`runtime.<id>`）。 */
  label: string;
  /** i18n key（`runtime.<id>.note`）。 */
  note: string;
  /** `ort` = ONNX Runtime 本体；`cuda12` / `cuda13` = 两套 CUDA 组件。 */
  group: "ort" | "cuda12" | "cuda13";
  /** 是否是运行时本体。 */
  core: boolean;
  /** 需要下载的字节数；随包基线为 0。 */
  bytes: number;
  installed: boolean;
  /** 随安装包分发：不下载、不可删除。 */
  bundled: boolean;
  license: string;
  /** 已安装目录（「显示位置」用）；随包基线为空串。 */
  dir: string;
}

export interface RuntimeProgress {
  id: string;
  state: "downloading" | "done" | "error";
  received: number;
  total: number;
  message: string | null;
}

export const EVENT_RUNTIME = "runtime-progress";

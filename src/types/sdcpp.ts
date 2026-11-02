/** stable-diffusion.cpp 引擎（视频生成运行时）：清单、下载进度、后端选择。 */

export interface SdcppStatus {
  id: string;
  /** i18n key（`sdcpp.<device>`）。 */
  label: string;
  /** i18n key（`sdcpp.<device>.note`）。 */
  note: string;
  /** `cpu` / `vulkan` / `cuda12` / `metal`。 */
  device: string;
  bytes: number;
  installed: boolean;
  /** 用户挑的那一份（没挑过时是自动挑中的那一份）。 */
  selected: boolean;
  automatic: boolean;
  license: string;
  dir: string;
}

export interface SdcppProgress {
  id: string;
  state: "downloading" | "done" | "error";
  received: number;
  total: number;
  message: string | null;
}

export interface SdcppOption {
  kind: string;
  label: string;
  note: string;
  available: boolean;
  installed: boolean;
  bytes: number;
}

export interface SdcppInfo {
  preference: string;
  current: string;
  recommended: string;
  platform: string;
  options: SdcppOption[];
}

export const EVENT_SDCPP = "sdcpp-progress";

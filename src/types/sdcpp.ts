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
  /** 本机能不能跑这份构建（AMD 机器上的 CUDA = false）。 */
  usable: boolean;
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
  /** 平台有没有这份构建（Windows 上 CUDA 恒为 true）。 */
  available: boolean;
  /** 本机能不能跑：CUDA 要求 NVIDIA 显卡，Metal 要求 Apple Silicon。 */
  usable: boolean;
  /** 本机最优选择（与装没装无关）。 */
  recommended: boolean;
  installed: boolean;
  bytes: number;
}

export interface SdcppInfo {
  preference: string;
  current: string;
  /** 本机最优的引擎（**不看装没装**）：NVIDIA → `cuda12`；macOS → `metal`；其余 → `vulkan` / `cpu`。 */
  recommended: string;
  platform: string;
  options: SdcppOption[];
}

export const EVENT_SDCPP = "sdcpp-progress";

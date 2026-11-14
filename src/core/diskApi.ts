/** 磁盘剩余空间探测（下载前的尽力预检）。 */
import { invoke } from "@/platform/tauri";
import { isTauri } from "@/utils/platform";

/**
 * 应用数据目录所在卷还剩多少字节；读不到返回 `null`（当作「不知道」，不拦下载）。
 *
 * 只做**预检**：CUDA 一整套 2~3 GB、视频模型 6 GB，装到一半磁盘满会留下半个目录，
 * 不如在开始前就说清楚还差多少。
 */
export function diskFreeBytes(): Promise<number | null> {
  if (!isTauri()) return Promise.resolve(null);
  return invoke<number | null>("disk_free_bytes").catch(() => null);
}

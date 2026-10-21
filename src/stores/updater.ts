/**
 * 自动更新：共享状态（检查 / 下载 / 安装 / 重启）。
 *
 * 启动时由主窗口静默查一次；设置页「关于」里可以手动查、看进度、下载安装并重启。
 * 真正的网络与安装都在 `src/core/updater.ts`，这里只管状态机与界面要用的派生值。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  checkUpdate,
  currentVersion,
  downloadAndInstall,
  relaunchApp,
  type UpdateInfo,
} from "@/core/updater";

/** 更新流程所处的阶段。 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export const useUpdaterStore = defineStore("updater", () => {
  const phase = ref<UpdatePhase>("idle");
  const info = ref<UpdateInfo | null>(null);
  const error = ref("");
  const downloaded = ref(0);
  const total = ref(0);
  /** 当前运行版本号（启动时读一次）。 */
  const version = ref("");

  /** 下载进度 0..1（总长未知时为 0）。 */
  const progress = computed(() => (total.value > 0 ? downloaded.value / total.value : 0));

  /** 读一次当前版本号（设置页加载时调用）。 */
  async function loadVersion(): Promise<void> {
    try {
      version.value = await currentVersion();
    } catch {
      version.value = "";
    }
  }

  /**
   * 查一次更新；返回是否有新版本。
   *
   * `silent` 用于启动时的后台检查：查不到 / 连不上（例如还没发过 release，端点 404）
   * 不在界面上留下错误态，只当作「已是最新」。
   */
  async function check(silent = false): Promise<boolean> {
    phase.value = "checking";
    error.value = "";
    try {
      const found = await checkUpdate();
      info.value = found;
      phase.value = found ? "available" : "idle";
      return found !== null;
    } catch (err) {
      error.value = String(err);
      phase.value = silent ? "idle" : "error";
      return false;
    }
  }

  /** 下载并安装已发现的更新。 */
  async function install(): Promise<void> {
    if (!info.value) return;
    phase.value = "downloading";
    error.value = "";
    downloaded.value = 0;
    total.value = 0;
    try {
      await downloadAndInstall((done, all) => {
        downloaded.value = done;
        total.value = all;
      });
      phase.value = "ready";
    } catch (err) {
      error.value = String(err);
      phase.value = "error";
    }
  }

  /** 重启到新版本。 */
  async function restart(): Promise<void> {
    try {
      await relaunchApp();
    } catch (err) {
      error.value = String(err);
      phase.value = "error";
    }
  }

  return {
    phase,
    info,
    error,
    downloaded,
    total,
    version,
    progress,
    loadVersion,
    check,
    install,
    restart,
  };
});

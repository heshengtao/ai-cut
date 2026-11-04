/** 本机设备画像（显卡厂商 / 推荐后端）：设置页、AI 引导弹窗共用一份。 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { aiBackendInfo } from "@/core/agentApi";
import type { BackendInfo, DeviceProfile } from "@/types/agent";

export const useDeviceStore = defineStore("device", () => {
  const info = ref<BackendInfo | null>(null);
  const loading = ref(false);
  let pending: Promise<void> | null = null;

  /** 显卡画像（还没取到时给一个空兜底，界面不至于读到 undefined）。 */
  const device = computed<DeviceProfile>(
    () => info.value?.device ?? { vendor: "none", name: "", driver: null },
  );
  const recommended = computed(() => info.value?.recommended ?? "cpu");
  const nvidia = computed(() => device.value.vendor === "nvidia");

  /**
   * 拉一次后端信息（含显卡画像）。
   *
   * 这个调用会顺带探测一次显卡（进程内缓存），不要在渲染函数里反复调；
   * 并发调用会合并成同一个请求。
   */
  async function load(force = false): Promise<void> {
    if (!force && info.value) return;
    if (pending) return pending;
    loading.value = true;
    pending = aiBackendInfo()
      .then((value) => {
        info.value = value;
      })
      .catch(() => {
        // 预览 / 旧版桌面端：保持 `null`，界面按 CPU 兜底。
      })
      .finally(() => {
        loading.value = false;
        pending = null;
      });
    return pending;
  }

  return { info, loading, device, recommended, nvidia, load };
});

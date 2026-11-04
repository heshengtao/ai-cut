<script setup lang="ts">
/**
 * **全局下载条**：AI 页面里任意位置都能看到「正在下什么、下到哪、还剩几项」。
 *
 * 为什么不是每条卡片各画一根进度条：一次「准备运行环境」会同时下引擎和权重，
 * 进度会分散在卡片 A / 卡片 B；给用户一组始终在顶部的条，比让他在两处之间找更清楚。
 *
 * **一行 = 一条车道**（运行库 / 引擎 / 模型）。三条车道可以同时跑（后端也是三个
 * 独立 downloader），所以这里不再假设「同一时刻只有一项」——每行有自己的取消按钮。
 */
import { useDownloadsStore, type DownloadActive } from "@/stores/downloads";
import { useI18n } from "@/i18n";

const downloads = useDownloadsStore();
const i18n = useI18n();

/** 一行的文字：`第 1/2 项 · 43%`（本车道只有一项时省掉序号）。 */
function stepOf(item: DownloadActive): string {
  const pct = item.pct === null ? "…" : `${item.pct}%`;
  if (item.total <= 1) return pct;
  return i18n.t("setup.busyStep", { index: item.index, total: item.total, pct });
}
</script>

<template>
  <div v-if="downloads.active.length > 0" class="strips" role="status">
    <div v-for="item in downloads.active" :key="item.section" class="strip">
      <div class="bar">
        <div
          class="fill"
          :class="{ indeterminate: item.pct === null }"
          :style="item.pct === null ? undefined : { width: `${item.pct}%` }"
        />
      </div>
      <span class="text" :title="item.task.label">
        {{ stepOf(item) }} · {{ item.task.label }}
      </span>
      <button class="cancel" type="button" @click="downloads.cancel(item.section)">
        {{ i18n.t("models.cancel") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.strips {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background-color: rgb(var(--md-primary) / 0.08);
}
.bar {
  width: 72px;
  height: 4px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.fill {
  height: 100%;
  border-radius: inherit;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}
.fill.indeterminate {
  width: 35%;
  animation: strip-slide 1.2s ease-in-out infinite;
}
@keyframes strip-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.text {
  flex: 1;
  overflow: hidden;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cancel {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 10px;
  cursor: pointer;
}
.cancel:hover {
  text-decoration: underline;
}
</style>

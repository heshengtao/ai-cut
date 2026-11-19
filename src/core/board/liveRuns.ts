/**
 * 节点运行态内存表：进度 / 消息 / 流式文本。
 *
 * 从 `useBoardRun` 的模块级 `liveRuns` 抽出来，因为插件节点的进度要由
 * `AdapterIO.progress` 直接写进来，而那不是 composable 的职责。
 * 仍然用 `reactive`：节点卡片依赖它的响应式。
 */
import { reactive } from "vue";

export interface LiveRun {
  startedAt: number;
  /** 0..1；null 表示还没有可解析的进度（显示不确定进度环）。 */
  progress: number | null;
  /** 当前步骤 / 状态说明，例如 `12 / 20` 或云端排队信息。 */
  message: string | null;
  text: string;
  reasoning: string;
}

export const liveRuns = reactive<Record<string, LiveRun>>({});

export function beginLiveRun(nodeId: string): LiveRun {
  const run: LiveRun = {
    startedAt: Date.now(),
    progress: null,
    message: null,
    text: "",
    reasoning: "",
  };
  liveRuns[nodeId] = run;
  // 返回响应式代理而不是原始对象：调用方拿到的必须和画布读到的是同一个。
  return liveRuns[nodeId]!;
}

export function updateLiveRun(
  nodeId: string,
  patch: Partial<Pick<LiveRun, "progress" | "message" | "text" | "reasoning">>,
): void {
  const run = liveRuns[nodeId];
  if (!run) return;
  if (patch.progress !== undefined && patch.progress !== null) {
    run.progress = Math.min(1, Math.max(0, patch.progress));
  }
  if (patch.message !== undefined) run.message = patch.message;
  if (patch.text !== undefined) run.text = patch.text;
  if (patch.reasoning !== undefined) run.reasoning = patch.reasoning;
}

export function liveRun(nodeId: string): LiveRun | undefined {
  return liveRuns[nodeId];
}

export function endLiveRun(nodeId: string): void {
  delete liveRuns[nodeId];
}

export function clearLiveRuns(): void {
  for (const nodeId of Object.keys(liveRuns)) delete liveRuns[nodeId];
}

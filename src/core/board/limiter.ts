/**
 * 运行资源闸门（泳道 + 显存/内存预算）。
 *
 * 主工作流的调度器按拍放行节点；迭代节点的每一行是**并行**的，不能各自直接调本地
 * 模型，否则显存会溢出。这里给两类运行提供同一份闸门：
 *
 * - `gpu`：本地 sd.cpp / ONNX 生成。daemon 是单进程引擎，默认并发 1；
 * - `api`：云端生成 / 文本模型，可以并行（默认 4，避免被服务商限流）；
 * - `cpu`：ffmpeg 这类本地 CPU 任务（默认 2）；
 * - `instant`：输入 / 显示 / 控制节点，不占资源，直接放行。
 *
 * 预算：`gpu` 节点还会按 `vramMb` / `ramMb` 记账，超出预算就排队。
 */
import type { NodeCost, RunLane, RunLimits } from "./scheduler";

interface Waiter {
  lane: RunLane;
  vramMb: number;
  ramMb: number;
  resolve: () => void;
}

export interface RunLimiter {
  acquire(cost: NodeCost): Promise<() => void>;
  release(cost: NodeCost): void;
  reset(): void;
}

export function createRunLimiter(limits: RunLimits): RunLimiter {
  const active: Record<RunLane, { count: number; vramMb: number; ramMb: number }> = {
    instant: { count: 0, vramMb: 0, ramMb: 0 },
    api: { count: 0, vramMb: 0, ramMb: 0 },
    gpu: { count: 0, vramMb: 0, ramMb: 0 },
    cpu: { count: 0, vramMb: 0, ramMb: 0 },
  };
  const waiters: Waiter[] = [];

  const capacity = (lane: RunLane): number =>
    lane === "api" ? limits.api : lane === "gpu" ? limits.gpu : lane === "cpu" ? limits.cpu : Infinity;

  function fits(lane: RunLane, vramMb: number, ramMb: number): boolean {
    const state = active[lane];
    if (state.count >= capacity(lane)) return false;
    if (lane === "gpu") {
      if (state.vramMb + vramMb > limits.vramMb) return false;
      if (state.ramMb + ramMb > limits.ramMb) return false;
    }
    return true;
  }

  function pump(): void {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index]!;
      if (!fits(waiter.lane, waiter.vramMb, waiter.ramMb)) continue;
      waiters.splice(index, 1);
      index -= 1;
      reserve(waiter.lane, waiter.vramMb, waiter.ramMb);
      waiter.resolve();
    }
  }

  function reserve(lane: RunLane, vramMb: number, ramMb: number): void {
    const state = active[lane];
    state.count += 1;
    state.vramMb += vramMb;
    state.ramMb += ramMb;
  }

  function release(cost: NodeCost): void {
    const state = active[cost.lane];
    state.count = Math.max(0, state.count - 1);
    state.vramMb = Math.max(0, state.vramMb - cost.vramMb);
    state.ramMb = Math.max(0, state.ramMb - cost.ramMb);
    pump();
  }

  function acquire(cost: NodeCost): Promise<() => void> {
    if (cost.lane === "instant") {
      reserve(cost.lane, 0, 0);
      return Promise.resolve(() => release(cost));
    }
    if (fits(cost.lane, cost.vramMb, cost.ramMb)) {
      reserve(cost.lane, cost.vramMb, cost.ramMb);
      return Promise.resolve(() => release(cost));
    }
    return new Promise((resolve) => {
      waiters.push({ lane: cost.lane, vramMb: cost.vramMb, ramMb: cost.ramMb, resolve: () => resolve(() => release(cost)) });
    });
  }

  return {
    acquire,
    release,
    reset() {
      waiters.length = 0;
      for (const lane of Object.keys(active) as RunLane[]) {
        active[lane] = { count: 0, vramMb: 0, ramMb: 0 };
      }
    },
  };
}

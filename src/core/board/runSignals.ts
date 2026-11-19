/**
 * 每节点一个 AbortSignal。
 *
 * 原来全画布只有一个 `cancelled` 布尔：停一个节点会连带把并行分支的后续也停掉，
 * 而且已发出的请求无法中断。插件节点必须能真正取消，所以按节点发信号。
 */
export interface RunSignals {
  begin(nodeId: string): AbortSignal;
  abort(nodeId: string): void;
  abortAll(): void;
  active(): string[];
  end(nodeId: string): void;
}

export function createRunSignals(): RunSignals {
  const controllers = new Map<string, AbortController>();
  return {
    begin(nodeId) {
      controllers.get(nodeId)?.abort();
      const controller = new AbortController();
      controllers.set(nodeId, controller);
      return controller.signal;
    },
    abort(nodeId) {
      controllers.get(nodeId)?.abort();
      controllers.delete(nodeId);
    },
    abortAll() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
    active() {
      return [...controllers.keys()];
    },
    end(nodeId) {
      controllers.delete(nodeId);
    },
  };
}

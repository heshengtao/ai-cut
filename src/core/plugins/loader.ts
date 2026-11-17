/**
 * 插件客户端半的挂载器。
 *
 * 纪律：**先建 disposer 栈，再 apply，失败逆序回滚**。这样「注册了节点但
 * apply 抛错」不会在内核里留下半个插件（DSH 第一代 loader 最痛的地方）。
 */
import { createPluginContext, type PluginContext } from "./context";

export interface PluginClientModule {
  /** 必须与清单 id 一致；不一致直接拒绝，避免「装的是 A、跑的是 B」。 */
  id: string;
  apply(ctx: PluginContext): void | (() => void);
}

export interface LoadedPlugin {
  id: string;
  dispose(): void;
}

const LOADED = new Map<string, LoadedPlugin>();

export function loadPluginModule(
  entry: { id: string; url: string },
  module: PluginClientModule,
): LoadedPlugin {
  const id = module.id;
  if (!id) throw new Error(`插件模块缺少 id（来源 ${entry.url}）`);
  if (id !== entry.id) {
    throw new Error(`插件模块 id（${id}）与清单 id（${entry.id}）不一致`);
  }
  if (LOADED.has(id)) throw new Error(`插件 ${id} 已经加载过`);
  const stack: (() => void)[] = [];
  const ctx = createPluginContext(id, (dispose) => stack.push(dispose));
  let cleanup: (() => void) | undefined;
  try {
    cleanup = module.apply(ctx) ?? undefined;
  } catch (error) {
    for (const dispose of [...stack].reverse()) dispose();
    throw error;
  }
  if (cleanup) stack.push(cleanup);
  const loaded: LoadedPlugin = {
    id,
    dispose() {
      for (const dispose of [...stack].reverse()) dispose();
      LOADED.delete(id);
    },
  };
  LOADED.set(id, loaded);
  return loaded;
}

export function disposeAll(): void {
  for (const loaded of [...LOADED.values()]) loaded.dispose();
}

/** 当前已加载的插件 id（面板与测试用）。 */
export function loadedPluginIds(): string[] {
  return [...LOADED.keys()];
}

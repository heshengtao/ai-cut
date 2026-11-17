/**
 * 插件的注册面：插件唯一能碰内核的入口。
 *
 * 每个 register 都往宿主给的 disposer 栈里压一条——卸载时逆序回滚，
 * 半装载（注册了节点但 apply 抛错）不会在内核里留垃圾。
 */
import { registerAdapter, type AdapterFn } from "@/core/board/adapters";
import { registerNodeDefinition } from "@/core/board/registry";
import { registerCommand, type CommandSpec } from "@/core/commandTable";
import { registerPluginMessages, type Locale } from "@/i18n/translate";
import type { BoardNodeDefinition } from "@/types/board";

export interface PluginContext {
  id: string;
  nodes: { register(definition: BoardNodeDefinition, run: AdapterFn): void };
  commands: { register(spec: CommandSpec): void };
  i18n: { register(dicts: Partial<Record<Locale, Record<string, string>>>): void };
  log(message: string): void;
}

export function createPluginContext(
  pluginId: string,
  push: (dispose: () => void) => void,
): PluginContext {
  return {
    id: pluginId,
    nodes: {
      register(definition, run) {
        push(registerNodeDefinition(definition, pluginId));
        push(registerAdapter(definition.type, run, pluginId));
      },
    },
    commands: {
      register(spec) {
        push(registerCommand({ ...spec, owner: spec.owner ?? pluginId }));
      },
    },
    i18n: {
      register(dicts) {
        push(registerPluginMessages(pluginId, dicts));
      },
    },
    log(message) {
      console.info(`[plugin ${pluginId}] ${message}`);
    },
  };
}

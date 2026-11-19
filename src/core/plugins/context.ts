/**
 * 插件的注册面：插件唯一能碰内核的入口。
 *
 * 每个 register 都往宿主给的 disposer 栈里压一条——卸载时逆序回滚，
 * 半装载（注册了节点但 apply 抛错）不会在内核里留垃圾。
 */
import { registerAdapter, type AdapterFn } from "@/core/board/adapters";
import { registerNodeDefinition } from "@/core/board/registry";
import { registerDataType } from "@/core/board/dataTypes";
import { registerCommand, type CommandSpec } from "@/core/commandTable";
import { registerControl, type ControlSpec } from "@/core/plugins/controls";
import { registerPane, type PaneSpec } from "@/core/plugins/panes";
import { registerPluginMessages, type Locale } from "@/i18n/translate";
import { pluginHostInvoke } from "@/core/pluginHostApi";
import type { BoardNodeDefinition, DataTypeSpec } from "@/types/board";

export interface PluginContext {
  id: string;
  nodes: { register(definition: BoardNodeDefinition, run: AdapterFn): void };
  /**
   * 自定义数据类型：注册后可以出现在端口、值节点的类型下拉和连线判定里。
   * 类型 id 必须唯一（内置类型不可覆盖），卸载插件时自动注销。
   */
  dataTypes: { register(spec: DataTypeSpec): void };
  commands: { register(spec: CommandSpec): void };
  i18n: { register(dicts: Partial<Record<Locale, Record<string, string>>>): void };
  /** 参数控件（`board.inspector` 注入点）。 */
  controls: { register(spec: ControlSpec): void };
  /** AI 面板页（`ai.pane` 注入点）。 */
  panes: { register(spec: PaneSpec): void };
  /**
   * 宿主半（`host.js`）的调用口。
   *
   * 客户端半只负责「把画布参数翻译成一次调用」，真正的网络 / 持久化 / 产物落盘
   * 都在宿主半里做——这样密钥与二进制都不进渲染进程。
   */
  host: { run(input: string): Promise<string> };
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
    dataTypes: {
      register(spec) {
        push(registerDataType(pluginId, spec));
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
    controls: {
      register(spec) {
        push(registerControl(pluginId, spec));
      },
    },
    panes: {
      register(spec) {
        push(registerPane(pluginId, spec));
      },
    },
    host: {
      run(input) {
        return pluginHostInvoke(pluginId, input);
      },
    },
    log(message) {
      console.info(`[plugin ${pluginId}] ${message}`);
    },
  };
}

/**
 * 画布插件宿主的调用封装。
 *
 * 命令名与 daemon 的 `/rpc/<cmd>` 一一对应；桌面与浏览器走同一组函数
 * （`@/platform/tauri` 负责切换传输）。
 */
import { invoke, listen, type UnlistenFn } from "@/platform/tauri";
import type { PluginHostProgress, PluginStatus } from "@/types/pluginHost";

export async function pluginHostList(): Promise<PluginStatus[]> {
  const result = await invoke<{ plugins: PluginStatus[] }>("plugin_host_list");
  return result.plugins;
}

export async function pluginHostInstallLocal(path: string): Promise<PluginStatus> {
  const result = await invoke<{ plugin: PluginStatus }>("plugin_host_install_local", { path });
  return result.plugin;
}

export async function pluginHostSetEnabled(
  id: string,
  enabled: boolean,
): Promise<PluginStatus[]> {
  const result = await invoke<{ plugins: PluginStatus[] }>("plugin_host_set_enabled", {
    id,
    enabled,
  });
  return result.plugins;
}

export async function pluginHostRemove(id: string): Promise<PluginStatus[]> {
  const result = await invoke<{ plugins: PluginStatus[] }>("plugin_host_remove", { id });
  return result.plugins;
}

export function onPluginHostProgress(
  handler: (progress: PluginHostProgress) => void,
): Promise<UnlistenFn> {
  return listen<PluginHostProgress>("plugin-host-progress", (event) => handler(event.payload));
}

export async function pluginHostStart(id: string): Promise<void> {
  await invoke<{ running: boolean }>("plugin_host_start", { id });
}

export async function pluginHostInvoke(id: string, input: string): Promise<string> {
  const result = await invoke<{ output: string }>("plugin_host_invoke", { id, input });
  return result.output;
}

export async function pluginHostStop(id: string): Promise<string[]> {
  const result = await invoke<{ stopped: boolean; running: string[] }>("plugin_host_stop", { id });
  return result.running;
}

/**
 * 取消**正在跑的那次** `run()`：宿主半看到 `ctx.cancelled()` 变 true 就应尽快返回。
 *
 * 与 `pluginHostStop` 的区别：宿主半继续活着，下一次调用照常能跑。
 */
export async function pluginHostCancel(id: string): Promise<boolean> {
  const result = await invoke<{ cancelled: boolean }>("plugin_host_cancel", { id });
  return result.cancelled;
}

/** OFX 插件注册表、安装与本地导入的 Tauri 调用封装。 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  PluginProgress,
  PluginRegistryConfig,
  PluginStatus,
  RegistryResponse,
} from "@/types/plugins";
import { EVENT_PLUGIN } from "@/types/plugins";
import { isTauri } from "@/utils/platform";

function offline(): RegistryResponse {
  return { source: "bundled", fetched_at: null, plugins: [] };
}

export function pluginRegistry(force = false): Promise<RegistryResponse> {
  if (!isTauri()) return Promise.resolve(offline());
  return invoke<RegistryResponse>("plugin_registry", { force });
}

export function pluginInstalled(): Promise<PluginStatus[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<PluginStatus[]>("plugin_installed");
}

export function pluginInstall(slug: string): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error("插件安装需要在桌面应用中使用"));
  return invoke<void>("plugin_install", { slug });
}

export function pluginCancel(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("plugin_cancel");
}

export function pluginRemove(slug: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("plugin_remove", { slug });
}

export function pluginImport(path: string): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error("插件导入需要在桌面应用中使用"));
  return invoke<void>("plugin_import", { path });
}

export function pluginReveal(slug: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("plugin_reveal", { slug });
}

export function pluginOpen(slug: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("plugin_open", { slug });
}

export function pluginRegistryConfig(): Promise<PluginRegistryConfig> {
  if (!isTauri()) return Promise.resolve({ url: "", mirrors: [] });
  return invoke<PluginRegistryConfig>("plugin_registry_config");
}

export function pluginSetRegistryConfig(
  url: string,
  mirrors: string[],
): Promise<PluginRegistryConfig> {
  if (!isTauri()) return Promise.resolve({ url, mirrors });
  return invoke<PluginRegistryConfig>("plugin_set_registry_config", { url, mirrors });
}

export function onPluginProgress(
  handler: (progress: PluginProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<PluginProgress>(EVENT_PLUGIN, (event) => handler(event.payload));
}

/** 选择一个 .ofx.bundle 目录。 */
export async function pickPluginBundle(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false });
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked ?? null;
}

/** 选择一个 .ofx 文件或插件归档。 */
export async function pickPluginFile(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "OFX", extensions: ["ofx", "zip", "gz", "tgz"] }],
  });
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked ?? null;
}

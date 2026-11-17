/**
 * 插件的真实模块导入：把「名册里的入口路径」变成可 `import()` 的 URL。
 *
 * 桌面走 asset 协议（`csp: null` + `assetProtocol: **` 已允许），浏览器走 daemon
 * 的 `/plugins/{id}/{file}?rev=` 路由。两条路都只指向名册登记过的目录。
 */
import { apiBase, isWebRuntime } from "@/platform/env";
import { convertFileSrc } from "@/platform/tauri";
import type { PluginClientModule } from "./loader";

/**
 * 拼出可 import 的 URL。
 *
 * - 桌面：`convertFileSrc(绝对路径)` → `asset://…`；
 * - 浏览器：`<base>plugins/<编码后的 id>/<文件名>?rev=<rev>`（`rev` 只破缓存）。
 */
export function pluginModuleUrl(
  clientPath: string,
  id: string,
  rev: string,
  options: { desktop: boolean; base?: string },
): string {
  if (options.desktop) return convertFileSrc(clientPath);
  const base = options.base ?? apiBase();
  const file = clientPath.split(/[\\/]/).pop() ?? "client.js";
  return `${base}plugins/${encodeURIComponent(id)}/${file}?rev=${encodeURIComponent(rev)}`;
}

export async function importPluginModule(entry: {
  id: string;
  client: string;
  rev: string;
}): Promise<PluginClientModule> {
  const url = pluginModuleUrl(entry.client, entry.id, entry.rev, {
    desktop: !isWebRuntime(),
  });
  const module = (await import(/* @vite-ignore */ url)) as { default?: PluginClientModule };
  if (!module.default) {
    throw new Error(`插件 ${entry.id} 的客户端入口没有 default 导出`);
  }
  return module.default;
}

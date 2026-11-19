/**
 * 插件清单的前端镜像。
 *
 * 规则与 `crates/daemon/src/plugin_host/manifest.rs` 一致；这里只负责
 * 「加载前先自查一遍」和给 UI 提供类型，真正的准入仍以 daemon 为准。
 */
export interface PluginManifest {
  format: number;
  id: string;
  version: string;
  client?: string;
  host?: string;
  engines: { aicut: string };
  inject: string[];
  external: string[];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`清单字段 ${field} 必须是非空字符串`);
  }
  return value;
}

export function parseManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null) throw new Error("清单必须是对象");
  const value = raw as Record<string, unknown>;
  if (value.format !== 1) {
    throw new Error(`清单 format 必须是 1，实际是 ${String(value.format)}`);
  }
  const id = asString(value.id, "id");
  const version = asString(value.version, "version");
  const client = typeof value.client === "string" && value.client ? value.client : undefined;
  const host = typeof value.host === "string" && value.host ? value.host : undefined;
  if (!client && !host) throw new Error(`清单 ${id} 既没有 client 也没有 host`);
  const engines = value.engines as { aicut?: unknown } | undefined;
  return {
    format: 1,
    id,
    version,
    client,
    host,
    engines: { aicut: typeof engines?.aicut === "string" ? engines.aicut : "*" },
    inject: Array.isArray(value.inject)
      ? value.inject.filter((item): item is string => typeof item === "string")
      : [],
    external: Array.isArray(value.external)
      ? value.external.filter((item): item is string => typeof item === "string")
      : [],
  };
}

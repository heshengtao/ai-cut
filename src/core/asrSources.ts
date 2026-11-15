/**
 * 语音识别下拉的候选来源：本地模型 / 云端服务 / 「配置服务…」操作项。
 *
 * 纯函数，组件只管取数据与文案，选项顺序和前缀解析在这里锁住。
 */
import type { SelectOption } from "@/components/common/Md3Select.vue";

/** 下拉首项的操作项 id：点击跳设置页，不改变当前选中值。 */
export const ASR_SETTINGS_ACTION = "asr-settings";
/** 云端服务在模型 id 里的前缀，与 daemon 的 `cloud_provider_id` 对应。 */
export const CLOUD_ASR_PREFIX = "cloud:";

export type AsrSourceRef =
  | { kind: "action" }
  | { kind: "local"; id: string }
  | { kind: "cloud"; id: string };

export interface AsrOptionRow {
  id: string;
  label: string;
  hint?: string;
  group?: string;
}

export function parseAsrModelId(id: string | null | undefined): AsrSourceRef | null {
  if (!id) return null;
  if (id === ASR_SETTINGS_ACTION) return { kind: "action" };
  if (id.startsWith(CLOUD_ASR_PREFIX)) {
    return { kind: "cloud", id: id.slice(CLOUD_ASR_PREFIX.length) };
  }
  return { kind: "local", id };
}

export function buildAsrOptions(
  rows: AsrOptionRow[],
  settings: { label: string; hint: string },
): SelectOption[] {
  const options: SelectOption[] = [
    { id: ASR_SETTINGS_ACTION, label: settings.label, hint: settings.hint, action: true },
  ];
  for (const row of rows) {
    options.push({ id: row.id, label: row.label, hint: row.hint, group: row.group });
  }
  return options;
}

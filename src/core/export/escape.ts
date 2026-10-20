/** 导出滤镜里的数字与文件名工具。 */
import { t } from "@/i18n";

/** 秒 → 滤镜里的数字字符串（最多 6 位小数，去掉尾零）。 */
export function formatSeconds(seconds: number): string {
  return String(Number(seconds.toFixed(6)));
}

/** 文件名清洗：去掉路径分隔符与常见非法字符。 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, " ").trim();
  return cleaned || t("project.untitled");
}

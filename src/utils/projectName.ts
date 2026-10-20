/** 工程名辅助：未命名工程的哨兵值在多语言下显示为本地化名称。 */
import { t } from "@/i18n";

const UNTITLED = new Set(["", "untitled", "未命名项目"]);

export function isUntitled(name: string | undefined | null): boolean {
  return UNTITLED.has((name ?? "").trim());
}

export function displayProjectName(name: string | undefined | null): string {
  return isUntitled(name) ? t("project.untitled") : (name ?? "");
}

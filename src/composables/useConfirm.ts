/** 全局 MD3 确认框：用 Promise 替代原生 window.confirm。 */
import { computed, shallowRef } from "vue";
import { t } from "@/i18n";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作用 error 色强调确认按钮。 */
  destructive?: boolean;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  destructive: boolean;
  resolve: (accepted: boolean) => void;
}

const queue = shallowRef<ConfirmRequest[]>([]);

/** 当前正在展示的确认框。 */
export const currentConfirm = computed(() => queue.value[0] ?? null);

/** 打开确认框，返回用户的选择。 */
export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { title: options } : options;
  return new Promise((resolve) => {
    queue.value = [
      ...queue.value,
      {
        title: opts.title,
        message: opts.message ?? "",
        confirmText: opts.confirmText ?? t("common.confirm"),
        cancelText: opts.cancelText ?? t("common.cancel"),
        destructive: opts.destructive ?? false,
        resolve,
      },
    ];
  });
}

/** 关闭当前确认框并结算 Promise。 */
export function answerConfirm(accepted: boolean): void {
  const [head, ...rest] = queue.value;
  if (!head) return;
  queue.value = rest;
  head.resolve(accepted);
}

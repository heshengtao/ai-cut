/** 全局 toast 队列：任何地方调用 `toast()` 即可。 */
import { ref, type Ref } from "vue";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  /** 提示里的操作按钮（例如「查看更新日志」）。 */
  action?: ToastAction;
  /** 自动消失时间（毫秒）；0 表示只能手动关闭。 */
  timeout?: number;
}

export interface ToastItem {
  id: string;
  message: string;
  tone: "info" | "error";
  action?: ToastAction;
}

const items = ref<ToastItem[]>([]);

/** 显示一条提示；默认 3 秒后自动消失。 */
export function toast(
  message: string,
  tone: "info" | "error" = "info",
  options: ToastOptions = {},
): void {
  const id = crypto.randomUUID();
  items.value = [...items.value, { id, message, tone, action: options.action }];
  const timeout = options.timeout ?? 3000;
  if (timeout > 0) window.setTimeout(() => dismiss(id), timeout);
}

export function dismiss(id: string): void {
  items.value = items.value.filter((item) => item.id !== id);
}

export function useToastItems(): Ref<ToastItem[]> {
  return items;
}

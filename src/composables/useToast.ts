/** 全局 toast 队列：任何地方调用 `toast()` 即可。 */
import { ref, type Ref } from "vue";

export interface ToastItem {
  id: string;
  message: string;
  tone: "info" | "error";
}

const items = ref<ToastItem[]>([]);

/** 显示一条提示；默认 3 秒后自动消失。 */
export function toast(message: string, tone: "info" | "error" = "info"): void {
  const id = crypto.randomUUID();
  items.value = [...items.value, { id, message, tone }];
  window.setTimeout(() => dismiss(id), 3000);
}

export function dismiss(id: string): void {
  items.value = items.value.filter((item) => item.id !== id);
}

export function useToastItems(): Ref<ToastItem[]> {
  return items;
}

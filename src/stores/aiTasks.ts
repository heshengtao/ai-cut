/**
 * 时间线右键菜单直接触发的 AI 任务。
 *
 * 这些任务不在 AI 面板里，需要一个全局的「正在处理」提示；这里只记录展示信息与取消回调，
 * 真正的进度仍由 asr / tts / audioAi / videoAi 各自的 store 事件驱动。
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";

export interface AiTaskEntry {
  id: string;
  label: string;
  startedAt: number;
  /** 对应的后端取消命令（没有可取消的实现时为空）。 */
  cancel?: () => void;
}

export const useAiTasksStore = defineStore("aiTasks", () => {
  const tasks = ref<AiTaskEntry[]>([]);
  const busy = computed(() => tasks.value.length > 0);

  function begin(label: string, cancel?: () => void): string {
    const id = crypto.randomUUID();
    tasks.value = [...tasks.value, { id, label, startedAt: Date.now(), cancel }];
    return id;
  }

  function end(id: string): void {
    tasks.value = tasks.value.filter((task) => task.id !== id);
  }

  return { tasks, busy, begin, end };
});

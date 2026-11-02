import { ref, watch } from "vue";
import { defineStore } from "pinia";

/**
 * **每个 AI 功能上次选的那一档模型 / 音色**（跨会话记住）。
 *
 * 为什么需要它：清单里常有好几档（ASR / TTS / 超分 / 分离各有好几档），用户通常只装一档。
 * 以前选中项是组件内的 `ref(null)`，再被「优先选已装」的 watcher 覆盖，切页面或重启就全忘。
 *
 * 语义：
 * - **用户显式选过**就以它为准，**不管装没装**（没装就显示下载，这正是用户要的）；
 * - 只有它从候选项里彻底消失时才回落到默认规则；
 * - 没选过（没有条目）时保持各功能自己的默认（已装的优先 / 推荐档）。
 */
const KEY = "ai-cut-model-choice";

/** 读持久化的选择；坏数据 / 无痕模式都退回空表，不让它影响启动。 */
function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [feature, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === "string" && id.length > 0) out[feature] = id;
    }
    return out;
  } catch {
    return {};
  }
}

export const useModelChoiceStore = defineStore("modelChoice", () => {
  /** 功能（或「功能:来源」）→ 选项 id。没有条目 = 还没选过。 */
  const map = ref<Record<string, string>>(read());

  watch(
    map,
    (value) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(value));
      } catch {
        // 无痕模式 / 存储被禁用：只影响「记住」，不影响本次使用。
      }
    },
    { deep: true },
  );

  function get(feature: string): string | null {
    return map.value[feature] ?? null;
  }

  function set(feature: string, id: string | null): void {
    const next = { ...map.value };
    if (id) next[feature] = id;
    else delete next[feature];
    map.value = next;
  }

  return { map, get, set };
});

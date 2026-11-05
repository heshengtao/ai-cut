/**
 * AI 生成页的「带参数打开」请求。
 *
 * 时间线右键菜单不直接生成，而是把「文生视频 / 图生视频 / 改图」的意图交给 AI 面板：
 * AI 面板负责缺引擎 / 缺模型的准备向导，生成页负责表单与结果落回时间线。
 */
import { ref } from "vue";
import { defineStore } from "pinia";

export type AiLaunchPage = "video" | "image";

export interface AiLaunchRequest {
  /** 每次请求的新 id：AI 面板用它给生成页做 `key`，重复请求也会重新预填。 */
  id: number;
  page: AiLaunchPage;
  prompt?: string;
  /** 仅图像页：画图 / 改图。 */
  mode?: "draw" | "edit";
  /** 仅图像页：以哪张素材作为改图源。 */
  sourceAssetId?: string;
  /** 仅视频页：以哪张图片作为首帧参考。 */
  imageAssetId?: string;
}

export const useAiLaunchStore = defineStore("aiLaunch", () => {
  const pending = ref<AiLaunchRequest | null>(null);
  let nextId = 1;

  function open(
    page: AiLaunchPage,
    options: Omit<AiLaunchRequest, "id" | "page"> = {},
  ): void {
    pending.value = { id: nextId, page, ...options };
    nextId += 1;
  }

  /** 消费掉请求：同一个请求只预填一次。 */
  function consume(id: number): void {
    if (pending.value?.id === id) pending.value = null;
  }

  function clear(): void {
    pending.value = null;
  }

  return { pending, open, consume, clear };
});

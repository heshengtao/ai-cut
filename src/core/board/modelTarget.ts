/**
 * 节点里「模型」参数的定位与解读。
 *
 * 卡片副标题（当前是哪个模型）和左下角的类型标签（本地模型 / 云端服务 /
 * 文本模型 / 未配置）必须和**运行时实际会用的模型**一致，否则会出现
 * 「卡片上明明已经显示模型，左下角却说未配置」这种矛盾。有两条例外规则：
 *
 * - 文本生成节点的模型留空时，运行时用「第一家启用的文本供应商」兜底；
 * - 画面增强没有 `model` 参数，模型随「处理方式」在 `upscaleModel` /
 *   `interpModel` 之间切换。
 *
 * 规则集中在这里，卡片和检查器都从这里取，不要再各写一套 `params.model`。
 */
import { nodeDefinition, splitModelValue } from "./registry";
import type { BoardNode } from "@/types/board";

export interface ModelTarget {
  /** 决定这个节点后端的参数 id；`null` = 这个节点没有模型参数（视频音频分离）。 */
  paramId: string | null;
  /** 参数值是不是「文本模型」（值形如 `<供应商 id>::<模型>`）。 */
  text: boolean;
}

/** 节点当前生效的模型参数。 */
export function modelTarget(node: BoardNode): ModelTarget {
  const params = nodeDefinition(node.type)?.params ?? [];
  if (params.some((param) => param.llm)) return { paramId: "model", text: true };
  if (!params.some((param) => param.id === "model" || param.model)) {
    return { paramId: null, text: false };
  }
  if (node.type === "model.enhance") {
    const interpolate = node.data.params.op === "interpolate";
    return { paramId: interpolate ? "interpModel" : "upscaleModel", text: false };
  }
  return { paramId: "model", text: false };
}

/** 左下角类型标签要显示的后端；`unconfigured` = 有模型参数但还没有可用值。 */
export type ModelBackend = "text" | "local" | "cloud" | "unconfigured" | "none";

/**
 * 按「实际生效的模型值」判断后端类型。
 *
 * `effective` 是卡片上显示的那个值：文本节点参数留空时由调用方传入兜底的
 * 供应商模型，这样下拉框、左下角标签和运行时三者不会互相打架。
 */
export function modelBackend(node: BoardNode, effective: string): ModelBackend {
  const target = modelTarget(node);
  if (!target.paramId) return "none";
  if (target.text) return effective ? "text" : "unconfigured";
  const model = splitModelValue(effective);
  return model ? model.kind : "unconfigured";
}

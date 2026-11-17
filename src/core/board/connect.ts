/**
 * 拖线建节点：给定锚点节点的端口，列出「可以接上」的节点定义。
 *
 * 纯函数，不依赖 Vue / store —— 画布层只负责把结果渲染成菜单。
 *
 * 两个方向：
 * - `forward`（从输出端拖出）：锚点的**输出** → 候选节点的**输入**；
 * - `backward`（从输入端拖出）：候选节点的**输出** → 锚点的**输入**。
 *
 * 锚点的输入端口可能不止一个（视频首尾帧、H3 的 9 图 / 3 音频 / 3 视频），
 * 调用方把「还没被占用的端口」排在前面即可按顺序占用。
 */
import { portsCompatible } from "./schema";
import type { BoardNodeDefinition, BoardPortSpec } from "@/types/board";

export type ConnectDirection = "forward" | "backward";

export interface ConnectCandidate {
  definition: BoardNodeDefinition;
  /** 锚点这一侧真正要连的端口：forward = 输出，backward = 输入。 */
  anchorPort: BoardPortSpec;
  /** 新节点这一侧真正要连的端口：forward = 输入，backward = 输出。 */
  port: BoardPortSpec;
}

export function connectCandidates(args: {
  direction: ConnectDirection;
  /** 锚点节点的输入端口（backward 用；调用方按「未占用优先」排序）。 */
  anchorInputs: BoardPortSpec[];
  /** 锚点节点的输出端口（forward 用第一个）。 */
  anchorOutputs: BoardPortSpec[];
  definitions: BoardNodeDefinition[];
}): ConnectCandidate[] {
  const { direction, anchorInputs, anchorOutputs, definitions } = args;
  const result: ConnectCandidate[] = [];

  if (direction === "forward") {
    const anchorPort = anchorOutputs[0];
    if (!anchorPort) return result;
    for (const definition of definitions) {
      const port = definition.inputs.find((input) =>
        portsCompatible(anchorPort.type, input.type),
      );
      if (port) result.push({ definition, anchorPort, port });
    }
    return result;
  }

  for (const definition of definitions) {
    const port = definition.outputs.find((output) =>
      anchorInputs.some((input) => portsCompatible(output.type, input.type)),
    );
    if (!port) continue;
    // 锚点可能有多个同类型输入：取第一个能接的（调用方已经把未占用的排前面）。
    const anchorPort = anchorInputs.find((input) => portsCompatible(port.type, input.type));
    if (anchorPort) result.push({ definition, anchorPort, port });
  }
  return result;
}

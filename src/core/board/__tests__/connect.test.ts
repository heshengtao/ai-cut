import { describe, expect, it } from "vitest";
import { connectCandidates } from "@/core/board/connect";
import { nodeDefinition } from "@/core/board/registry";
import type { BoardPortSpec } from "@/types/board";

function definition(type: string) {
  const found = nodeDefinition(type);
  if (!found) throw new Error(`missing definition: ${type}`);
  return found;
}

const imageGen = definition("model.image");
const textGen = definition("model.text");
const tts = definition("model.tts");
const displayImage = definition("display.image");
const inputText = definition("input.text");
const displayText = definition("display.text");

describe("connectCandidates", () => {
  it("从输出端拖出：只列能消费该输出的节点，并给出候选的输入端口", () => {
    const candidates = connectCandidates({
      direction: "forward",
      anchorInputs: [],
      anchorOutputs: imageGen.outputs,
      definitions: [displayImage, displayText, textGen],
    });
    expect(candidates.map((item) => item.definition.type)).toEqual([
      "display.image",
      // 文本生成现在也有可选的图片输入（多模态）。
      "model.text",
    ]);
    expect(candidates[0].anchorPort.id).toBe("image");
    expect(candidates[0].port.id).toBe("in");
    expect(candidates[1].port.id).toBe("image");
  });

  it("从输入端拖出：只列能喂这个输入的节点，并给出候选的输出端口", () => {
    const candidates = connectCandidates({
      direction: "backward",
      anchorInputs: textGen.inputs,
      anchorOutputs: textGen.outputs,
      definitions: [displayImage, inputText, displayText, tts, textGen],
    });
    // 显示节点现在也把输入透传到输出，所以它们同样能当上游；
    // model.text 有 text / image / video 三个输入，图片与文本上游都能接。
    expect(candidates.map((item) => item.definition.type)).toEqual([
      "display.image",
      "input.text",
      "display.text",
      "model.text",
    ]);
    const textCandidate = candidates.find((item) => item.definition.type === "input.text");
    expect(textCandidate?.anchorPort.id).toBe("text");
    expect(textCandidate?.port.id).toBe("text");
    expect(candidates.find((item) => item.definition.type === "display.image")?.anchorPort.id).toBe("image");
  });

  it("多路输入按传入顺序占用：图片输出接图片口，音频输出接音频口", () => {
    const inputs: BoardPortSpec[] = [
      { id: "refAudio1", type: "audio", labelKey: "board.port.refAudio" },
      { id: "refImage1", type: "image", labelKey: "board.port.refImage" },
    ];
    const candidates = connectCandidates({
      direction: "backward",
      anchorInputs: inputs,
      anchorOutputs: [],
      definitions: [imageGen, tts],
    });
    const image = candidates.find((item) => item.definition.type === "model.image");
    const audio = candidates.find((item) => item.definition.type === "model.tts");
    expect(image?.anchorPort.id).toBe("refImage1");
    expect(audio?.anchorPort.id).toBe("refAudio1");
  });

  it("没有兼容输入时返回空列表", () => {
    const audioAnchor = definition("model.tts");
    const candidates = connectCandidates({
      direction: "forward",
      anchorInputs: [],
      anchorOutputs: audioAnchor.outputs,
      definitions: [displayImage, textGen],
    });
    expect(candidates).toEqual([]);
  });

  it("锚点没有输出端口时不列任何候选", () => {
    expect(
      connectCandidates({
        direction: "forward",
        anchorInputs: [],
        anchorOutputs: [],
        definitions: [displayImage],
      }),
    ).toEqual([]);
  });
});

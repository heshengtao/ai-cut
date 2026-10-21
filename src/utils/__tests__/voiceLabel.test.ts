import { describe, expect, it } from "vitest";
import { ttsVoiceGroup, ttsVoiceName } from "@/utils/voiceLabel";
import type { TtsVoice } from "@/types/models";

const zh: Record<string, string> = {
  "ai.voiceName.junhao": "俊豪",
  "ai.voiceName.leijun": "Leijun（默认）",
  "ai.voiceGroup.chinese-male": "中文男声",
  "ai.voiceGroup.other": "其他音色",
};

const t = (key: string): string => zh[key] ?? key;

function voice(id: string, group: string): TtsVoice {
  return { id, name: "CN 欢迎关注模思智能", group };
}

describe("voiceLabel", () => {
  it("replaces the upstream ad-like display name with a readable label", () => {
    expect(ttsVoiceName(t, voice("Junhao", "Chinese Male"))).toBe("俊豪");
  });

  it("keeps the stable id for voices without a localized name", () => {
    expect(ttsVoiceName(t, voice("Ava", "English Female"))).toBe("Ava");
  });

  it("labels the ZipVoice default voice", () => {
    expect(ttsVoiceName(t, voice("leijun", "Chinese Male"))).toBe("Leijun（默认）");
  });

  it("localizes male/female groups", () => {
    expect(ttsVoiceGroup(t, "Chinese Male")).toBe("中文男声");
  });

  it("falls back to the raw group when unknown", () => {
    expect(ttsVoiceGroup(t, "Klingon Male")).toBe("Klingon Male");
  });

  it("handles an empty group", () => {
    expect(ttsVoiceGroup(t, "  ")).toBe("其他音色");
  });
});

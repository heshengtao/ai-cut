import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@/utils/platform", () => ({ isTauri: () => true }));

import { convertVoiceBatch, importVoice } from "@/core/voiceChangeApi";

describe("voice change api", () => {
  it("passes camelCase payload to the command", async () => {
    await convertVoiceBatch(
      [{ clipId: "c1", path: "/a.wav", start: 1, duration: 2 }],
      "v-1",
      "meanvc2-int8",
    );
    expect(invoke).toHaveBeenCalledWith("voice_change_convert", {
      clips: [{ clipId: "c1", path: "/a.wav", start: 1, duration: 2 }],
      voiceId: "v-1",
      modelId: "meanvc2-int8",
    });
  });

  it("imports a voice with the speaker model id", async () => {
    await importVoice("/a.wav", "张三");
    expect(invoke).toHaveBeenCalledWith("voice_change_voice_import", {
      assetPath: "/a.wav",
      name: "张三",
      start: null,
      duration: null,
      speakerModelId: "meanvc2-speaker",
    });
  });
});

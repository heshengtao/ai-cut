/**
 * 回归测试：声音走 Web Audio 的 AudioBuffer 调度，而不是 <audio> 元素逐帧 seek。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addClip, removeClips } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";
import { PlaybackEngine } from "@/core/playback/engine";
import type { Project } from "@/types/project";

vi.mock("@/core/media", () => ({
  fileUrl: (path: string) => `file://${path}`,
}));

interface Started {
  when: number;
  offset: number;
  duration: number;
}

let starts: Started[] = [];
let stops = 0;
let gains: Array<{ gain: { value: number } }> = [];

class FakeParam {
  value = 1;
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeGainNode {
  gain = new FakeParam();
  connect(): this {
    return this;
  }
  disconnect(): void {}
}

class FakeStereoPannerNode {
  pan = new FakeParam();
  connect(): this {
    return this;
  }
  disconnect(): void {}
}

class FakeBufferSource {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  detune = new FakeParam();
  connect(): this {
    return this;
  }
  disconnect(): void {}
  start(when: number, offset: number, duration: number): void {
    starts.push({ when, offset, duration });
  }
  stop(): void {
    stops += 1;
  }
  addEventListener(): void {}
}

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    gains.push(node);
    return node;
  }
  createStereoPanner(): FakeStereoPannerNode {
    return new FakeStereoPannerNode();
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource();
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({
      duration: 10,
      numberOfChannels: 2,
      sampleRate: 48000,
      length: 480000,
    });
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeVideo {
  style: Record<string, string> = {};
  className = "";
  playsInline = false;
  preload = "";
  muted = true;
  paused = true;
  currentTime = 0;
  readyState = 4;
  src = "";
  readonly tag = "video";
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  load(): void {}
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  remove(): void {}
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

let videos: FakeVideo[] = [];

function fixture(): { doc: Project; clipId: string } {
  const base = addTrack(newProject());
  const track = base.tracks[0];
  const asset = createAsset({
    name: "a.mp4",
    kind: "video",
    src: "/a.mp4",
    duration: 10,
    hasAudio: true,
  });
  const clip = createClip({
    assetId: asset.id,
    trackId: track.id,
    start: 0,
    duration: 10,
    in: 0,
  });
  const doc = addClip(addAsset(base, asset), track.id, clip);
  return { doc, clipId: clip.id };
}

beforeEach(() => {
  starts = [];
  stops = 0;
  gains = [];
  videos = [];
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(16),
  }));
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "video") {
        const video = new FakeVideo();
        videos.push(video);
        return video;
      }
      return {};
    },
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlaybackEngine audio scheduling", () => {
  it("schedules the clip as an AudioBufferSource with the right offset", async () => {
    const { doc } = fixture();
    const engine = new PlaybackEngine({
      container: { appendChild: () => undefined } as unknown as HTMLElement,
      getDoc: () => doc,
      onTime: () => undefined,
    });
    engine.setMasterVolume(0.5);
    engine.sync();
    engine.play();

    await vi.waitFor(() => expect(starts.length).toBeGreaterThan(0));
    expect(starts[0].offset).toBeCloseTo(0);
    expect(starts[0].duration).toBeCloseTo(10);
    // 第一个 gain 是主音量，第二个是片段增益。
    expect(gains[0].gain.value).toBeCloseTo(0.5);
    expect(gains.some((g) => g.gain.value === 1)).toBe(true);
    // 画面元素保持静音，声音只来自 Web Audio。
    expect(videos[0].muted).toBe(true);

    engine.pause();
    engine.dispose();
  });

  it("stops scheduled sources when the clip is deleted", async () => {
    const { doc, clipId } = fixture();
    let current = doc;
    const engine = new PlaybackEngine({
      container: { appendChild: () => undefined } as unknown as HTMLElement,
      getDoc: () => current,
      onTime: () => undefined,
    });
    engine.sync();
    engine.play();
    await vi.waitFor(() => expect(starts.length).toBeGreaterThan(0));

    current = removeClips(current, [clipId]);
    engine.sync();

    expect(stops).toBeGreaterThan(0);
    engine.dispose();
  });
});

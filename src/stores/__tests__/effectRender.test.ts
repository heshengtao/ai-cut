import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 缓存文件是否存在可控。 */
const cacheFiles = new Set<string>();
/** 捕获进度事件处理函数，测试里手动触发。 */
let progressHandler:
  | ((payload: { id?: string | null; phase: string; done: number; total: number }) => void)
  | null = null;
/** 手动结束 / 失败一次烘焙。 */
let resolveBake: ((path: string) => void) | null = null;
let rejectBake: ((error: Error) => void) | null = null;

vi.mock("@/utils/platform", () => ({ isTauri: () => true }));

vi.mock("@/core/media", () => ({
  cacheFilePath: vi.fn(async (name: string) => `/cache/${name}`),
  pathExists: vi.fn(async (path: string) => cacheFiles.has(path)),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
}));

vi.mock("@/core/ofxApi", () => ({
  ofxBakeClip: vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        resolveBake = resolve;
        rejectBake = reject;
      }),
  ),
  ofxBakeImage: vi.fn(async () => "/cache/image.png"),
  ofxCancelBake: vi.fn(async () => undefined),
  onOfxBakeProgress: vi.fn((handler: NonNullable<typeof progressHandler>) => {
    progressHandler = handler;
    return Promise.resolve(() => undefined);
  }),
}));

import { useProjectStore } from "@/stores/project";
import { useEffectRenderStore } from "@/stores/effectRender";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addClip } from "@/core/ops/clips";
import { addClipEffect, setClipEffectParam } from "@/core/ops/effects";
import { addTrack } from "@/core/ops/tracks";
import { ofxCancelBake } from "@/core/ofxApi";

function setup(): string {
  let doc = addTrack(newProject(), "视频");
  const trackId = doc.tracks[0].id;
  doc = addAsset(
    doc,
    createAsset({
      id: "a1",
      name: "v.mp4",
      kind: "video",
      src: "/tmp/v.mp4",
      duration: 10,
      hasAudio: true,
    }),
  );
  doc = addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 10 }));
  const clipId = doc.tracks[0].clips[0].id;
  doc = addClipEffect(doc, clipId, {
    id: "e1",
    plugin: "com.test.fx",
    name: "Test FX",
    bundle: "/plugins/test.ofx.bundle",
    params: { amount: 0.5 },
    enabled: true,
  });
  useProjectStore().reset(doc, null);
  return clipId;
}

/** 等一次文档同步（150ms 防抖）跑完，避免和 request 抢队列。 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 220));
}

beforeEach(() => {
  cacheFiles.clear();
  progressHandler = null;
  resolveBake = null;
  rejectBake = null;
  setActivePinia(createPinia());
});

describe("OFX 预渲染队列", () => {
  it("request 才开始渲染，进度事件驱动百分比，完成后可直接当预览源", async () => {
    const store = useEffectRenderStore();
    const clipId = setup();

    // 加特效本身不排队：等一个同步周期后仍然没有任务。
    await settle();
    expect(store.jobFor(clipId)).toBeNull();

    await store.request(clipId);
    await vi.waitFor(() => expect(store.jobFor(clipId)?.status).toBe("rendering"));

    const job = store.jobFor(clipId)!;
    expect(job.total).toBe(300); // 10s * 30fps
    expect(store.sourceFor(clipId)).toBeNull();

    progressHandler?.({ id: clipId, phase: "rendering", done: 90, total: 300 });
    expect(store.jobFor(clipId)?.done).toBe(90);
    expect(store.progress?.pct).toBe(30);

    resolveBake?.("/cache/preview.mp4");
    await vi.waitFor(() => expect(store.jobFor(clipId)?.status).toBe("ready"));
    expect(store.sourceFor(clipId)).toBe("/cache/preview.mp4");
  });

  it("参数一改，旧预渲染结果立即作废", async () => {
    const store = useEffectRenderStore();
    const clipId = setup();
    await settle();

    await store.request(clipId);
    await vi.waitFor(() => expect(store.jobFor(clipId)?.status).toBe("rendering"));
    resolveBake?.("/cache/preview.mp4");
    await vi.waitFor(() => expect(store.sourceFor(clipId)).toBe("/cache/preview.mp4"));

    useProjectStore().dispatch((doc) =>
      setClipEffectParam(doc, clipId, "e1", "amount", 0.9),
    );
    await vi.waitFor(() => expect(store.jobFor(clipId)).toBeNull());
    expect(store.sourceFor(clipId)).toBeNull();
  });

  it("取消会停掉烘焙并清空结果", async () => {
    const store = useEffectRenderStore();
    const clipId = setup();
    await settle();

    await store.request(clipId);
    await vi.waitFor(() => expect(store.jobFor(clipId)?.status).toBe("rendering"));

    store.cancel(clipId);
    expect(store.jobFor(clipId)).toBeNull();
    expect(ofxCancelBake).toHaveBeenCalledWith(clipId);

    // 已经取消的任务结束时不会把结果写回来。
    resolveBake?.("/cache/late.mp4");
    await settle();
    expect(store.sourceFor(clipId)).toBeNull();
  });

  it("磁盘上已有同签名缓存时，再次 request 直接完成，不重新烘焙", async () => {
    const store = useEffectRenderStore();
    const clipId = setup();
    await settle();

    await store.request(clipId);
    await vi.waitFor(() => expect(store.jobFor(clipId)?.status).toBe("rendering"));
    const output = store.jobFor(clipId)!.output;

    store.cancel(clipId);
    resolveBake?.("/cache/ignored.mp4");
    await settle();

    cacheFiles.add(output);
    await store.request(clipId);
    await vi.waitFor(() => expect(store.jobFor(clipId)?.status).toBe("ready"));
    expect(store.sourceFor(clipId)).toBe(output);
  });
});

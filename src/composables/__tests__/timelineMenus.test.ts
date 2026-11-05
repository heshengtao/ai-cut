/**
 * 右键菜单的「按块裁剪」规则：
 * - AI 永远第一组；
 * - 音频块只有音频 AI，视频块同时有音频 / 画面，图片块只有图片项，文字块只有朗读 / 文案；
 * - 空白区域才有「凭空生成」的入口。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { addAsset, addClip, addMarker, addTrack } from "@/core/ops";
import { createAsset, createClip, createMarker, newProject } from "@/core/factory";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useTimelineMenus } from "@/composables/useTimelineMenus";
import type { MenuItem } from "@/components/common/contextMenu";
import type { Clip } from "@/types/project";

beforeEach(() => {
  setActivePinia(createPinia());
});

function allLabels(items: MenuItem[]): string[] {
  const labels: string[] = [];
  for (const item of items) {
    if (item.kind === "separator") continue;
    labels.push(item.label);
    if (item.kind === "submenu") labels.push(...allLabels(item.items));
  }
  return labels;
}

function findSubmenu(items: MenuItem[], id: string): MenuItem | undefined {
  return items.find((item) => item.kind === "submenu" && item.id === id);
}

function findAction(items: MenuItem[], id: string): Extract<MenuItem, { kind: "action" }> | undefined {
  return items.find(
    (item): item is Extract<MenuItem, { kind: "action" }> =>
      item.kind === "action" && item.id === id,
  );
}

function setupProject(kind: "video" | "audio" | "image" | "text"): {
  clip: Clip;
  trackId: string;
  project: ReturnType<typeof useProjectStore>;
  selection: ReturnType<typeof useSelectionStore>;
} {
  let doc = addTrack(newProject());
  const track = doc.tracks[0];
  let clip: Clip;

  if (kind === "text") {
    clip = createClip({
      assetId: "",
      trackId: track.id,
      start: 0,
      duration: 4,
      text: "你好世界",
    });
  } else {
    const asset = createAsset({
      name: `${kind}.dat`,
      kind,
      src: `C:/media/${kind}.dat`,
      duration: kind === "image" ? 0 : 10,
      ...(kind === "video" ? { hasAudio: true } : {}),
    });
    doc = addAsset(doc, asset);
    clip = createClip({ assetId: asset.id, trackId: track.id, start: 0, duration: 4 });
  }

  doc = addClip(doc, track.id, clip);
  const project = useProjectStore();
  project.reset(doc, null);
  const selection = useSelectionStore();
  selection.select(clip.id);
  return { clip, trackId: track.id, project, selection };
}

describe("片段右键菜单", () => {
  it("AI 是第一组，视频块同时有字幕与画面增强", () => {
    const { clip } = setupProject("video");
    const items = useTimelineMenus().build({ kind: "clip", clipId: clip.id });

    expect(items[0]).toMatchObject({ kind: "submenu", id: "clip-ai" });
    const labels = allLabels(items);
    expect(labels).toContain("一键生成字幕");
    expect(labels).toContain("AI 超分 2×");
    expect(findSubmenu(items, "clip-audio")).toBeDefined();
    expect(findSubmenu(items, "clip-visual")).toBeDefined();
  });

  it("音频块只出现音频菜单，不出现画面增强", () => {
    const { clip } = setupProject("audio");
    const items = useTimelineMenus().build({ kind: "clip", clipId: clip.id });

    const labels = allLabels(items);
    expect(labels).toContain("一键生成字幕");
    expect(labels).toContain("人声提取");
    expect(labels).not.toContain("AI 超分 2×");
    expect(findSubmenu(items, "clip-audio")).toBeDefined();
    expect(findSubmenu(items, "clip-visual")).toBeUndefined();
  });

  it("图片块只出现图片相关项，不出现字幕", () => {
    const { clip } = setupProject("image");
    const items = useTimelineMenus().build({ kind: "clip", clipId: clip.id });

    const labels = allLabels(items);
    expect(labels).toContain("用这张图改图…");
    expect(labels).toContain("用这张图生成视频…");
    expect(labels).not.toContain("一键生成字幕");
    expect(findSubmenu(items, "clip-audio")).toBeUndefined();
  });

  it("文字块出现朗读与文案生成，不出现音视频 AI", () => {
    const { clip } = setupProject("text");
    const items = useTimelineMenus().build({ kind: "clip", clipId: clip.id });

    const labels = allLabels(items);
    expect(labels).toContain("AI 朗读");
    expect(labels).toContain("用这段文案生成视频…");
    expect(labels).not.toContain("AI 超分 2×");
    expect(findSubmenu(items, "clip-text")).toBeDefined();
  });
});

describe("空白区域右键菜单", () => {
  it("AI 生成在最前，并有文生视频 / 图生视频 / 文生图", () => {
    const { trackId } = setupProject("video");
    const items = useTimelineMenus().build({
      kind: "lane",
      trackId,
      index: 1,
      time: 2,
    });

    expect(items[0]).toMatchObject({ kind: "submenu", id: "lane-ai" });
    const labels = allLabels(items);
    expect(labels).toContain("文生视频…");
    expect(labels).toContain("图生视频…");
    expect(labels).toContain("文生图…");
    expect(findSubmenu(items, "lane-track")).toBeDefined();
  });

  it("没有轨道时仍能新建轨道 / 生成", () => {
    const project = useProjectStore();
    project.reset(newProject(), null);
    const items = useTimelineMenus().build({
      kind: "lane",
      trackId: null,
      index: 0,
      time: 0,
    });

    expect(findSubmenu(items, "lane-ai")).toBeDefined();
    expect(findAction(items, "lane-new-track")?.label).toBe("新建轨道");
    expect(findSubmenu(items, "lane-track")).toBeUndefined();
  });
});

describe("标尺 / 标记 / 轨道头", () => {
  it("标尺在片段内部可分割，在空白处禁用", () => {
    const menus = useTimelineMenus();
    setupProject("video");

    const inside = menus.build({ kind: "ruler", time: 2 });
    expect(inside[0]).toMatchObject({ kind: "submenu", id: "ruler-ai" });
    expect(findAction(inside, "ruler-split")?.disabled).toBe(false);

    const outside = menus.build({ kind: "ruler", time: 8 });
    expect(findAction(outside, "ruler-split")?.disabled).toBe(true);
  });

  it("标记菜单由宿主提供编辑与删除；没有宿主时禁用危险项", () => {
    const project = useProjectStore();
    const marker = createMarker({ time: 1, name: "开场" });
    project.reset(addMarker(addTrack(newProject()), marker), null);

    const withoutHost = useTimelineMenus().build({
      kind: "marker",
      markerId: marker.id,
    });
    expect(findAction(withoutHost, "marker-delete")?.disabled).toBe(true);

    const withHost = useTimelineMenus({
      editMarker: () => undefined,
      removeMarker: () => undefined,
    }).build({ kind: "marker", markerId: marker.id });
    expect(findAction(withHost, "marker-delete")?.disabled).toBe(false);
    expect(findAction(withHost, "marker-edit")?.disabled).toBe(false);
  });

  it("轨道头菜单包含开关、选中与删除", () => {
    const { trackId } = setupProject("video");
    const items = useTimelineMenus().build({ kind: "track", trackId });

    expect(findAction(items, "track-mute")).toBeDefined();
    expect(findAction(items, "track-select-clips")).toBeDefined();
    expect(findAction(items, "track-remove")?.danger).toBe(true);
    expect(findAction(items, "track-new-below")).toBeDefined();
  });
});

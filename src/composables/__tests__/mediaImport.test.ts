import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  toasts: [] as string[],
  picked: [] as string[],
}));

vi.mock("@/composables/useToast", () => ({
  toast: (message: string) => {
    mocks.toasts.push(message);
  },
}));

vi.mock("@/core/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/media")>();
  return {
    ...actual,
    pickMediaFiles: vi.fn(async () => mocks.picked),
    importAssetAt: vi.fn(async (path: string) => ({
      id: `asset:${path}`,
      name: path,
      kind: "video" as const,
      src: path,
      duration: 4,
      addedAt: 1,
    })),
  };
});

import { useMediaImport } from "@/composables/useMediaImport";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useLayoutStore } from "@/stores/layout";

describe("useMediaImport", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mocks.toasts.length = 0;
    mocks.picked = ["C:/media/a.mp4"];
  });

  it("imports into the library and reveals it in the right sidebar", async () => {
    const project = useProjectStore();
    const layout = useLayoutStore();
    layout.activeTab = "inspector";

    const added = await useMediaImport().importMedia();

    expect(added).toBe(1);
    expect(project.doc.assets).toHaveLength(1);
    expect(project.doc.tracks).toHaveLength(0);
    expect(layout.activeTab).toBe("media");
    expect(layout.showPanel).toBe(true);
    expect(mocks.toasts.at(-1)).toBe("已导入 1 个素材");
  });

  it("puts imported media on the timeline in one step when asked", async () => {
    mocks.picked = ["C:/media/a.mp4", "C:/media/b.mp4"];
    const project = useProjectStore();
    const selection = useSelectionStore();

    const added = await useMediaImport().importMedia({ insertToTimeline: true });

    expect(added).toBe(2);
    expect(project.doc.tracks).toHaveLength(1);
    const clips = project.doc.tracks[0].clips;
    expect(clips.map((clip) => [clip.start, clip.duration])).toEqual([
      [0, 4],
      [4, 4],
    ]);
    // 最后一段被选中，接着按 Delete 或打开检查器都顺手。
    expect(selection.selectedClipIds).toEqual([clips[1].id]);
    expect(mocks.toasts.at(-1)).toBe("已导入 2 个素材，并放到时间线");
  });

  it("can insert to the timeline without stealing the sidebar", async () => {
    const layout = useLayoutStore();
    layout.activeTab = "inspector";

    await useMediaImport().importMedia({
      insertToTimeline: true,
      revealInLibrary: false,
    });

    expect(layout.activeTab).toBe("inspector");
  });

  it("commits the whole import as one undo step", async () => {
    mocks.picked = ["C:/media/a.mp4", "C:/media/b.mp4"];
    const project = useProjectStore();

    await useMediaImport().importMedia({ insertToTimeline: true });
    expect(project.canUndo).toBe(true);

    project.undo();

    expect(project.doc.assets).toHaveLength(0);
    expect(project.doc.tracks).toHaveLength(0);
  });

  it("does nothing when the file picker is cancelled", async () => {
    mocks.picked = [];
    const project = useProjectStore();

    const added = await useMediaImport().importMedia({ insertToTimeline: true });

    expect(added).toBe(0);
    expect(project.doc.assets).toHaveLength(0);
    expect(project.doc.tracks).toHaveLength(0);
    expect(mocks.toasts).toHaveLength(0);
  });
});

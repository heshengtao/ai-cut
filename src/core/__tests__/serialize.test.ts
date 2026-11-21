import { describe, expect, it } from "vitest";
import { newProject, createClip } from "@/core/factory";
import { addTrack } from "@/core/ops";
import { addEpisode } from "@/core/ops/episodes";
import { parseProject, serializeProject } from "@/core/serialize";
import type { Project } from "@/types/project";

describe("newProject", () => {
  it("creates a versioned project without tracks", () => {
    const p = newProject("测试");
    expect(p.version).toBe(2);
    expect(p.name).toBe("测试");
    expect(p.fps).toBe(30);
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
    expect(p.tracks).toEqual([]);
    expect(p.assets).toEqual([]);
    expect(p.episodes).toHaveLength(1);
    expect(p.activeEpisodeId).toBe(p.episodes[0].id);
  });

  it("gives every entity a distinct id", () => {
    let p = newProject();
    p = addTrack(p);
    p = addTrack(p);
    const ids = new Set(p.tracks.map((t) => t.id));
    expect(ids.size).toBe(2);
  });
});

describe("工作流随工程保存", () => {
  it("画布节点 / 连线 / 组员 / 旁路都能往返", () => {
    const p = newProject("画布");
    const board = {
      version: 1 as const,
      nodes: [
        {
          id: "g1",
          type: "group",
          position: { x: 0, y: 0 },
          size: { width: 500, height: 400 },
          data: { params: {}, bindings: {}, children: ["n1", "n2"] },
        },
        {
          id: "n1",
          type: "model.text",
          position: { x: 40, y: 60 },
          data: {
            params: { model: "p::m", system: "", temperature: 0.7, maxTokens: 0 },
            bindings: {},
            bypassed: true,
            status: "skipped" as const,
          },
        },
        {
          id: "n2",
          type: "model.text",
          position: { x: 240, y: 60 },
          data: { params: { model: "p::m2", system: "", temperature: 0.7, maxTokens: 0 }, bindings: {} },
        },
      ],
      edges: [
        { id: "e1", source: "n1", sourcePort: "text", target: "n2", targetPort: "text" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: 1,
    };
    const saved = parseProject(serializeProject({ ...p, board }));
    expect(saved.board?.nodes.map((node) => node.id)).toEqual(["g1", "n1", "n2"]);
    expect(saved.board?.nodes[0].data.children).toEqual(["n1", "n2"]);
    expect(saved.board?.nodes[1].data.bypassed).toBe(true);
    expect(saved.board?.nodes[1].data.status).toBe("skipped");
    expect(saved.board?.edges).toHaveLength(1);
  });
});

describe("serialize / parse round trip", () => {
  it("preserves the document through JSON", () => {
    let p = newProject("往返");
    p = addTrack(p);
    const clip = createClip({ assetId: "a1", trackId: p.tracks[0].id, start: 1, duration: 2 });
    p.tracks[0].clips.push(clip);

    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
  });
});

describe("parseProject validation", () => {
  it("fills visible for old tracks and drops the legacy solo field", () => {
    const p = addTrack(newProject());
    const legacyTrack = { ...p.tracks[0], visible: undefined, solo: true };
    const parsed = parseProject(JSON.stringify({ ...p, tracks: [legacyTrack] }));
    expect(parsed.tracks[0].visible).toBe(true);
    expect("solo" in parsed.tracks[0]).toBe(false);
  });

  it("migrates legacy per-property keyframes and drops masks", () => {
    const p = addTrack(newProject());
    const legacy = {
      ...createClip({
        assetId: "a1",
        trackId: p.tracks[0].id,
        start: 0,
        duration: 4,
      }),
      mask: { shape: "rect", x: 0, y: 0, width: 1, height: 1 },
      keyframes: {
        opacity: [
          { time: 0, value: 0 },
          { time: 2, value: 1 },
        ],
        x: [{ time: 1, value: 10 }],
      },
    };
    p.tracks[0].clips.push(legacy as never);

    const parsed = parseProject(JSON.stringify(p));
    const clip = parsed.tracks[0].clips[0];
    expect("mask" in clip).toBe(false);
    expect(clip.keyframes).toEqual([
      { time: 0, opacity: 0, x: 10, y: 0, scale: 1, rotation: 0 },
      { time: 1, opacity: 0.5, x: 10, y: 0, scale: 1, rotation: 0 },
      { time: 2, opacity: 1, x: 10, y: 0, scale: 1, rotation: 0 },
    ]);
  });

  it("rejects a document with the wrong version", () => {
    expect(() => parseProject(JSON.stringify({ ...newProject(), version: 99 }))).toThrow(/version/i);
  });

  it("rejects non-object json", () => {
    expect(() => parseProject("[]")).toThrow();
  });

  it("rejects a track whose clips are missing", () => {
    // v1 形态：根级 tracks 才会在校验阶段被检查。
    const p = addTrack(newProject());
    const broken = JSON.stringify({
      ...p,
      version: 1,
      episodes: undefined,
      activeEpisodeId: undefined,
      tracks: [{ ...p.tracks[0], clips: undefined }],
    });
    expect(() => parseProject(broken)).toThrow(/clips/i);
  });
});

describe("cut scopes", () => {
  it("往返后剪口与词表都还在", () => {
    let p = newProject("剪口");
    p = addTrack(p);
    const trackId = p.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 10 });
    p = {
      ...p,
      cutScopes: [
        {
          id: "s1",
          assetId: "a1",
          trackId,
          baseIn: 0,
          baseOut: 10,
          baseStart: 0,
          template: clip,
          pieces: [clip.id],
          cuts: [
            { id: "c1", srcStart: 2, srcEnd: 3, kind: "filler", text: "嗯", createdAt: 1 },
          ],
          words: [{ text: "嗯", start: 2, end: 3 }],
          timed: true,
        },
      ],
    };
    const parsed = parseProject(serializeProject(p));
    expect(parsed.cutScopes).toHaveLength(1);
    expect(parsed.cutScopes?.[0].cuts[0].kind).toBe("filler");
    expect(parsed.cutScopes?.[0].words).toEqual([{ text: "嗯", start: 2, end: 3 }]);
  });

  it("坏掉的剪口组会被丢掉，不拖垮整个工程", () => {
    let p = newProject("坏剪口");
    p = addTrack(p);
    const raw = JSON.parse(serializeProject(p));
    raw.cutScopes = [{ id: "x" }, null, { id: "y", cuts: "nope" }];
    const parsed = parseProject(JSON.stringify(raw));
    expect(parsed.cutScopes).toBeUndefined();
  });
});

describe("剧集图往返", () => {
  it("写盘保留 seriesGraph，读盘归一化后仍是自定义图", () => {
    const base = newProject("剧集图");
    const doc = addEpisode(addEpisode(base, "第二集"), "第三集");
    const [first, second, third] = doc.episodes;
    const withGraph = {
      ...doc,
      seriesGraph: {
        custom: true,
        edges: [
          { id: "a", from: first.id, to: second.id },
          { id: "b", from: first.id, to: third.id, label: "逃" },
        ],
        positions: { [first.id]: { x: 12, y: 34 } },
      },
    } as Project;

    const json = serializeProject(withGraph);
    expect(json).toContain('"seriesGraph"');

    const parsed = parseProject(json);
    expect(parsed.seriesGraph).toEqual(withGraph.seriesGraph);
  });

  it("坏数据的剧集图降级，不影响其余字段", () => {
    const base = newProject("坏图");
    const raw = JSON.parse(serializeProject(base)) as Record<string, unknown>;
    raw.seriesGraph = { custom: "yes", edges: [{ id: "x" }], positions: { a: { x: "bad", y: 1 } } };
    const parsed = parseProject(JSON.stringify(raw));
    expect(parsed.seriesGraph).toEqual({ custom: false, edges: [], positions: {} });
    expect(parsed.name).toBe("坏图");
  });

  it("旧工程没有 seriesGraph 也能读", () => {
    const parsed = parseProject(serializeProject(newProject("旧工程")));
    expect(parsed.seriesGraph).toBeUndefined();
  });
});

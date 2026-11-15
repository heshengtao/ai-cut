# 工程文档 v2（分P）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Project` 从"单时间线"改成"工程 → 多分P（Episode）"，时间线数据按分P 独立、素材/画布/输出设置工程级共享，同时让 300+ 处 `doc.tracks` 调用零改动。

**Architecture:** `doc.episodes[]` 是唯一真相，`doc.tracks` / `doc.markers` 是由 `attachEpisodeView()` 定义的**不可枚举访问器**（getter 返回当前分P 的真实数组引用，setter 整体替换）。所有文档产出点（`withTouch`、store 赋值、`parseProject`/`serializeProject`、会话合并）都必须经过 `attachEpisodeView()` 折返，否则 `{...doc}` 展开会丢掉访问器。

**Tech Stack:** Vue 3 + Pinia + TypeScript + Vitest；领域代码同时被 esbuild 打进 QuickJS（`crates/daemon/assets/domain.js`），所以 `src/core/**` 不能 import Vue / store。

## Global Constraints

- `PROJECT_VERSION = 2`；读取必须同时接受 1 与 2，保存一律写 2。
- 投影纪律：`tracks` / `markers` **不可枚举**，不进 JSON；真相在 `episodes`。
- 所有 JSON 入口（打开工程、历史恢复、会话快照、domain 引擎、MCP 桥）只能走 `parseProject`（内部 `normalizeProject` → `attachEpisodeView`）。
- 所有文档返回点只能走 `withTouch` / `attachEpisodeView`，禁止裸 `{ ...doc, ...patch }` 返回给调用方。
- `src/core/**` 不得 import Vue / `src/stores/**`（`scripts/build-domain.mjs` 会直接构建失败）。
- i18n：每条新文案同时写进 `src/i18n/zh.ts` 与 `src/i18n/en.ts`。
- 测试文件位置固定在 `src/**/__tests__/**/*.test.ts`（`vite.config.ts` 的 `test.include`）。
- 提交信息风格：`feat(core): …` / `refactor(project): …` / `test(core): …`。
- 全量检查：`pnpm test`、`pnpm build`；动了领域代码后 `pnpm domain:golden` + `cargo test --manifest-path crates/daemon/Cargo.toml`。

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/types/project.ts` | 修改 | 新增 `Episode`；`Project` 增 `episodes`/`activeEpisodeId`，`PROJECT_VERSION = 2` |
| `src/core/episodes.ts` | 新建 | 分P 纯函数：迁移、投影、取当前分P、切分P。**不含 Vue / store** |
| `src/core/factory.ts` | 修改 | `newEpisode()`、`newProject()` 建默认分P 并折返投影 |
| `src/core/ops/internal.ts` | 修改 | `withTouch()` 折返投影（所有 ops 的唯一出口） |
| `src/core/serialize.ts` | 修改 | 校验 1/2、按分P 归一化、`parseProject`/`serializeProject` 折返 |
| `src/stores/project.ts` | 修改 | 8 个 `doc.value =` 赋值点折返；新增 `switchEpisode()` |
| `src/core/sessionMerge.ts` | 修改 | 按分P 合并 |
| `src/types/events.ts` | 修改 | `Affected` 增 `episodeId?` |
| `src/i18n/zh.ts` / `en.ts` | 修改 | `episode.*`、`error.serialize.*` 新文案 |
| `crates/daemon/assets/domain.js` | 重新生成 | `pnpm domain:golden` 产物 |
| `crates/daemon/tests/fixtures/expected.json` | 重新生成 | golden 期望值 |

---

### Task 1: 文档 v2 读写通道（类型 + 分P 视图 + 序列化 + ops 折返）

**Files:**
- Create: `src/core/episodes.ts`
- Create: `src/core/__tests__/episodes.test.ts`
- Modify: `src/types/project.ts`（`Episode`、`Project`、`PROJECT_VERSION`）
- Modify: `src/core/factory.ts`（`newEpisode`、`newProject`）
- Modify: `src/core/ops/internal.ts`（`withTouch`）
- Modify: `src/core/serialize.ts`（`assertProjectShape`、`normalizeProject`、`parseProject`、`serializeProject`）
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`
- Modify: `src/core/__tests__/serialize.test.ts`（`version` 断言 1 → 2）

**Interfaces:**
- Produces（后续任务依赖，签名必须一致）:
  - `activeEpisode(doc: Project): Episode`
  - `attachEpisodeView(doc: Project): Project`
  - `isEpisodeViewAttached(doc: Project): boolean`
  - `migrateToEpisodes(doc: Project): Project`
  - `switchActiveEpisode(doc: Project, episodeId: string): Project | null`
  - `newEpisode(name: string, order: number): Episode`
- Consumes: 无（这是第一个任务）。

- [ ] **Step 1: 写失败测试 `src/core/__tests__/episodes.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  activeEpisode,
  attachEpisodeView,
  isEpisodeViewAttached,
  switchActiveEpisode,
} from "@/core/episodes";
import { newProject } from "@/core/factory";
import { renameProject } from "@/core/ops";
import type { Episode, Marker, Project, Track } from "@/types/project";

function track(id: string): Track {
  return { id, name: id, muted: false, visible: true, locked: false, clips: [] };
}

/** 一份 v1 形态的文档：根级 tracks / markers，没有 episodes。 */
function legacyDoc(): Project {
  const marker: Marker = { id: "m1", time: 0, name: "起点" };
  return {
    version: 1,
    name: "旧工程",
    createdAt: 1,
    updatedAt: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    tracks: [track("t1")],
    markers: [marker],
  } as unknown as Project;
}

describe("attachEpisodeView", () => {
  it("把 v1 文档迁移成一个分P", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(doc.version).toBe(2);
    expect(doc.episodes).toHaveLength(1);
    expect(doc.episodes[0].tracks.map((item) => item.id)).toEqual(["t1"]);
    expect(doc.episodes[0].markers.map((item) => item.id)).toEqual(["m1"]);
    expect(doc.activeEpisodeId).toBe(doc.episodes[0].id);
  });

  it("tracks / markers 是不可枚举访问器，getter 返回当前分P 的真实数组", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(Object.prototype.hasOwnProperty.call(doc, "tracks")).toBe(false);
    expect(Object.keys(doc)).not.toContain("tracks");
    expect(doc.tracks).toBe(activeEpisode(doc).tracks);
    const wire = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    expect(wire.tracks).toBeUndefined();
    expect(wire.markers).toBeUndefined();
    expect(Array.isArray(wire.episodes)).toBe(true);
  });

  it("展开后的新文档把 tracks 折回当前分P，且不改动旧文档", () => {
    const before = attachEpisodeView(legacyDoc());
    const replacement = [track("t2")];
    const after = attachEpisodeView({ ...before, tracks: replacement } as Project);
    expect(after.tracks).toBe(replacement);
    expect(activeEpisode(before).tracks.map((item) => item.id)).toEqual(["t1"]);
  });

  it("setter 整体替换当前分P 的轨道", () => {
    const doc = attachEpisodeView(legacyDoc());
    const next: Track[] = [];
    doc.tracks = next;
    expect(doc.tracks).toBe(next);
    expect(activeEpisode(doc).tracks).toBe(next);
  });

  it("对同一个文档重复 attach 返回原对象（幂等）", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(isEpisodeViewAttached(doc)).toBe(true);
    expect(attachEpisodeView(doc)).toBe(doc);
  });

  it("ops 的结果仍带 tracks 投影（withTouch 已折返）", () => {
    const doc = renameProject(newProject("改名前"), "改名后");
    expect(doc.name).toBe("改名后");
    expect(isEpisodeViewAttached(doc)).toBe(true);
    expect(Array.isArray(doc.tracks)).toBe(true);
  });
});

describe("switchActiveEpisode", () => {
  const second: Episode = {
    id: "e2",
    name: "分P 2",
    order: 1,
    tracks: [],
    markers: [],
    createdAt: 2,
    updatedAt: 2,
  };

  it("切分P 只换 activeEpisodeId，tracks 指向目标分P", () => {
    const base = attachEpisodeView(legacyDoc());
    const doc = attachEpisodeView({ ...base, episodes: [...base.episodes, second] } as Project);
    const switched = switchActiveEpisode(doc, "e2");
    expect(switched).not.toBeNull();
    expect(switched!.activeEpisodeId).toBe("e2");
    expect(switched!.tracks).toBe(switched!.episodes[1].tracks);
  });

  it("未知 id 或同一个 id 返回 null", () => {
    const doc = attachEpisodeView(legacyDoc());
    expect(switchActiveEpisode(doc, "nope")).toBeNull();
    expect(switchActiveEpisode(doc, doc.activeEpisodeId)).toBeNull();
  });
});

describe("newProject", () => {
  it("自带一个默认分P，且 tracks 已挂投影", () => {
    const doc = newProject("测试");
    expect(doc.version).toBe(2);
    expect(doc.episodes).toHaveLength(1);
    expect(doc.activeEpisodeId).toBe(doc.episodes[0].id);
    expect(doc.tracks).toHaveLength(0);
    expect(doc.episodes[0].name).toBe("分P 1");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test episodes`
Expected: FAIL —— `Cannot find module '@/core/episodes'`（或 `newProject` 无 `episodes`）。

- [ ] **Step 3: 改类型 `src/types/project.ts`**

在 `Marker` 定义之后、`Project` 之前插入：

```ts
/** 一个分P：工程内的一条独立时间线。 */
export interface Episode {
  id: string;
  name: string;
  /** 在剧集界面里的顺序，从 0 开始。 */
  order: number;
  tracks: Track[];
  markers: Marker[];
  createdAt: number;
  updatedAt: number;
  /** 互动分支预留：本阶段只保留字段，不实现。 */
  transitions?: { choice: string; toEpisodeId: string }[];
}
```

把 `Project` 改成：

```ts
/** 工程文档，可直接序列化为 .json。 */
export interface Project {
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  fps: number;
  width: number;
  height: number;
  /** 素材库：工程级共享，所有分P 共用。 */
  assets: MediaAsset[];
  /** 分P 列表：时间线数据的唯一真相。 */
  episodes: Episode[];
  activeEpisodeId: string;
  /**
   * 当前分P 的轨道投影。运行期由 `attachEpisodeView()` 定义为**不可枚举**访问器，
   * 序列化时不存在——真相永远在 `episodes[activeEpisodeId].tracks` 里。
   */
  tracks: Track[];
  /** 当前分P 的标记投影，规则同 `tracks`。 */
  markers: Marker[];
  /** 剪口组。缺省表示这个工程没剪过口播。工程级共享。 */
  cutScopes?: CutScope[];
}

/** 当前工程文档版本。 */
export const PROJECT_VERSION = 2;
```

- [ ] **Step 4: 新建 `src/core/episodes.ts`**

```ts
/**
 * 工程分P（Episode）的文档视图。
 *
 * 真相在 `doc.episodes`；`doc.tracks` / `doc.markers` 是指向**当前分P**的
 * 不可枚举访问器：getter 返回真实数组引用（所以 `doc.tracks.push(…)` 这类原地
 * 修改天然正确），setter 整体替换。这样 300 多处 `doc.tracks` 调用不必改动。
 *
 * 纪律：任何 `{ ...doc, tracks }` 展开都会丢掉访问器，所以每个文档产出点
 * （`withTouch`、store 赋值、`parseProject`、会话合并）都必须调用
 * `attachEpisodeView()` 折返。本文件不许 import Vue / store。
 */
import type { Episode, Marker, Project, Track } from "@/types/project";
import { t } from "@/i18n/translate";

/** 已挂过投影的文档对象（同一个对象只挂一次）。 */
const attached = new WeakSet<object>();

/** 该文档上的投影是否已就绪。 */
export function isEpisodeViewAttached(doc: Project): boolean {
  return attached.has(doc);
}

function hasEpisodes(doc: Project): boolean {
  const episodes = (doc as Partial<Project>).episodes;
  return Array.isArray(episodes) && episodes.length > 0;
}

/** 当前分P；`activeEpisodeId` 失效时回落到第一个。 */
export function activeEpisode(doc: Project): Episode {
  const found = doc.episodes.find((episode) => episode.id === doc.activeEpisodeId);
  return found ?? doc.episodes[0];
}

/** 新建一个空分P。 */
export function newEpisode(name: string, order: number): Episode {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    order,
    tracks: [],
    markers: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** v1 工程（根级 tracks / markers）包成一个分P。已是 v2 时原样返回。 */
export function migrateToEpisodes(doc: Project): Project {
  if (hasEpisodes(doc)) return doc;
  const episode: Episode = {
    id: crypto.randomUUID(),
    name: t("episode.defaultName", { index: 1 }),
    order: 0,
    tracks: Array.isArray(doc.tracks) ? doc.tracks : [],
    markers: Array.isArray(doc.markers) ? doc.markers : [],
    createdAt: doc.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  return { ...doc, version: 2, episodes: [episode], activeEpisodeId: episode.id };
}

function replaceActiveEpisode(doc: Project, patch: Partial<Episode>): void {
  const target = activeEpisode(doc);
  doc.episodes = doc.episodes.map((episode) =>
    episode.id === target.id ? { ...episode, ...patch, updatedAt: Date.now() } : episode,
  );
}

function defineView(doc: Project): Project {
  Object.defineProperties(doc, {
    tracks: {
      enumerable: false,
      configurable: true,
      get: () => activeEpisode(doc).tracks,
      set: (value: Track[]) => replaceActiveEpisode(doc, { tracks: value }),
    },
    markers: {
      enumerable: false,
      configurable: true,
      get: () => activeEpisode(doc).markers,
      set: (value: Marker[]) => replaceActiveEpisode(doc, { markers: value }),
    },
  });
  attached.add(doc);
  return doc;
}

/**
 * 把文档折回「episodes 是真相 + 访问器就绪」的形态。
 *
 * - v1 文档 → 先迁移成一个分P；
 * - 被 `{ ...doc }` 展开过（有自有 `tracks` / `markers`）→ 折回当前分P，
 *   并替换而不是原地修改分P 对象，保证撤销快照里的旧文档不被改到；
 * - 已就绪 → 返回原对象（幂等，`dispatch` 的 `next === before` 判断依赖它）。
 */
export function attachEpisodeView(input: Project): Project {
  let doc = hasEpisodes(input) ? input : migrateToEpisodes(input);
  const target = activeEpisode(doc);
  const ownTracks = Object.prototype.hasOwnProperty.call(doc, "tracks");
  const ownMarkers = Object.prototype.hasOwnProperty.call(doc, "markers");

  if (attached.has(doc) && doc.activeEpisodeId === target.id && !ownTracks && !ownMarkers) {
    return doc;
  }

  const tracks = ownTracks ? (doc.tracks as Track[]) : target.tracks;
  const markers = ownMarkers ? (doc.markers as Marker[]) : target.markers;
  const episodes = doc.episodes.map((episode) =>
    episode.id === target.id ? { ...episode, tracks, markers } : episode,
  );
  const next = { ...doc, episodes, activeEpisodeId: target.id } as Project;
  delete (next as Partial<Project>).tracks;
  delete (next as Partial<Project>).markers;
  return defineView(next);
}

/** 切到另一个分P；id 不存在或已经是当前分P 时返回 null。 */
export function switchActiveEpisode(doc: Project, episodeId: string): Project | null {
  if (!hasEpisodes(doc)) return null;
  if (doc.activeEpisodeId === episodeId) return null;
  if (!doc.episodes.some((episode) => episode.id === episodeId)) return null;
  return attachEpisodeView({ ...doc, activeEpisodeId: episodeId } as Project);
}
```

- [ ] **Step 5: 改工厂 `src/core/factory.ts`**

`newProject` 之前补 import 并再导出 `newEpisode`（定义在 `core/episodes.ts`，这里只 re-export，避免两份实现）：

```ts
import { attachEpisodeView, newEpisode } from "@/core/episodes";
export { newEpisode };
```

把 `newProject` 改成：

```ts
export function newProject(name = "untitled"): Project {
  const now = Date.now();
  const episode = newEpisode(t("episode.defaultName", { index: 1 }), 0);
  return attachEpisodeView({
    version: PROJECT_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    episodes: [episode],
    activeEpisodeId: episode.id,
    tracks: episode.tracks,
    markers: episode.markers,
  } as Project);
}
```

同时把文件里已有的 `t` / `PROJECT_VERSION` import 补齐（`import { t } from "@/i18n/translate";`、`attachEpisodeView, newEpisode`）。

- [ ] **Step 6: 让 `withTouch` 成为折返点 `src/core/ops/internal.ts`**

```ts
import type { Clip, Project, Track } from "@/types/project";
import { attachEpisodeView } from "@/core/episodes";

/**
 * 更新时间戳并覆盖指定字段。
 *
 * 所有 ops 都经过这里，所以这里也是分P 投影的**唯一折返点**：`{ ...doc }` 展开会
 * 丢掉 `tracks` / `markers` 的访问器，必须在返回前重新挂上，否则调用方拿到的
 * 文档 `doc.tracks` 会是 `undefined`。
 */
export function withTouch(doc: Project, patch: Partial<Project>): Project {
  return attachEpisodeView({ ...doc, ...patch, updatedAt: Date.now() });
}
```

- [ ] **Step 7: 改序列化 `src/core/serialize.ts`**

`assertProjectShape` 换成接受 1 / 2：

```ts
function assertProjectShape(value: unknown): asserts value is Project {
  if (!isObject(value)) throw new Error(t("error.serialize.notObject"));
  if (value.version !== 1 && value.version !== PROJECT_VERSION) {
    throw new Error(
      t("error.serialize.version", {
        expected: PROJECT_VERSION,
        actual: String(value.version),
      }),
    );
  }
  if (typeof value.name !== "string") throw new Error(t("error.serialize.missingName"));
  if (!isNumber(value.fps) || value.fps <= 0) throw new Error(t("error.serialize.badFps"));
  if (!isNumber(value.width) || !isNumber(value.height))
    throw new Error(t("error.serialize.badResolution"));
  if (!Array.isArray(value.assets)) throw new Error(t("error.serialize.badAssets"));

  if (value.version === 1) {
    if (!Array.isArray(value.tracks)) throw new Error(t("error.serialize.badTracks"));
    assertTracks(value.tracks as unknown[]);
    return;
  }

  if (!Array.isArray(value.episodes) || value.episodes.length === 0)
    throw new Error(t("error.serialize.badEpisodes"));
  if (typeof value.activeEpisodeId !== "string" || !value.activeEpisodeId)
    throw new Error(t("error.serialize.badActiveEpisode"));
  for (const episode of value.episodes) {
    if (!isObject(episode) || typeof episode.id !== "string" || !episode.id)
      throw new Error(t("error.serialize.badEpisode"));
    if (!Array.isArray(episode.tracks) || !Array.isArray(episode.markers))
      throw new Error(t("error.serialize.badEpisode"));
    assertTracks(episode.tracks as unknown[]);
  }
}

/** 轨道 / 片段的形状校验（1 与 2 共用）。 */
function assertTracks(tracks: unknown[]): void {
  for (const track of tracks) {
    if (!isObject(track)) throw new Error(t("error.serialize.badTrack"));
    if (!Array.isArray(track.clips)) throw new Error(t("error.serialize.badClips"));
    for (const clip of track.clips) {
      if (!isObject(clip)) throw new Error(t("error.serialize.badClip"));
      if (!isNumber(clip.start) || !isNumber(clip.duration) || !isNumber(clip.in)) {
        throw new Error(t("error.serialize.badClipTime"));
      }
    }
  }
}
```

把 `normalizeProject` 改造：原来的轨道 / 标记归一化逻辑抽成两个函数，按分P 应用。

```ts
/** 轨道归一化（兼容旧工程：缺省 visible 视为 true，丢弃 solo / mask，迁移关键帧）。 */
function normalizeTracks(tracks: Track[]): Track[] {
  return tracks.map((track) => {
    const record = { ...(track as unknown as Record<string, unknown>) };
    const visible = record.visible !== false;
    delete record.solo;
    const clips = track.clips.map((clip) => {
      const next = { ...(clip as unknown as Record<string, unknown>) };
      delete next.mask;
      const normalized = next as unknown as Clip;
      const keyframes = migrateClipKeyframes(normalized);
      if (keyframes) normalized.keyframes = keyframes;
      else delete normalized.keyframes;

      const effects = normalizeClipEffects(normalized.effects);
      if (effects.length === 0) delete normalized.effects;
      else normalized.effects = effects;

      for (const edge of ["in", "out"] as const) {
        const key = edge === "in" ? "transitionIn" : "transitionOut";
        const current = normalized[key];
        if (!current) continue;
        const transition = normalizeClipTransition(current, normalized.duration);
        if (transition) normalized[key] = transition;
        else delete normalized[key];
      }
      return normalized;
    });
    return { ...(record as unknown as Track), visible, clips };
  });
}

/** 标记归一化（原来的逻辑原样搬进来）。 */
function normalizeMarkers(markers: Marker[]): Marker[] {
  /* 原 normalizeProject 里对 markers 的那段 map 原样搬到这里，返回结果 */
}

function normalizeProject(input: Project): Project {
  const migrated = attachEpisodeView(migrateToEpisodes(input));
  const episodes = migrated.episodes.map((episode) => ({
    ...episode,
    tracks: normalizeTracks(episode.tracks),
    markers: normalizeMarkers(episode.markers),
  }));
  const doc = attachEpisodeView({ ...migrated, episodes } as Project);
  const cutScopes = normalizeCutScopes(doc);
  return attachEpisodeView({ ...doc, cutScopes } as Project);
}
```

`parseProject` / `serializeProject` 收尾：

```ts
export function serializeProject(project: Project): string {
  // 折返一次：即使调用方从 ops 拿到的是展开过的对象，写出前也补回投影。
  return JSON.stringify(attachEpisodeView(project), null, 2);
}

export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(t("error.serialize.badJson"));
  }
  assertProjectShape(raw);
  return normalizeProject(raw as Project);
}
```

补 import：`import { attachEpisodeView, migrateToEpisodes } from "@/core/episodes";`；`import type { Clip, Marker, Project, Track } from "@/types/project";`。

- [ ] **Step 8: 补文案（两份词典都要）**

`src/i18n/zh.ts`：

```ts
  // ---- 分P ----
  "episode.defaultName": "分P {index}",
  "error.serialize.badEpisodes": "工程缺少分P 数据",
  "error.serialize.badActiveEpisode": "工程缺少当前分P",
  "error.serialize.badEpisode": "分P 数据损坏",
```

`src/i18n/en.ts`：

```ts
  // ---- Episodes ----
  "episode.defaultName": "Part {index}",
  "error.serialize.badEpisodes": "Project has no episodes",
  "error.serialize.badActiveEpisode": "Project has no active episode",
  "error.serialize.badEpisode": "Episode data is corrupted",
```

- [ ] **Step 9: 更新既有断言 `src/core/__tests__/serialize.test.ts`**

把 `expect(p.version).toBe(1)` 改成 `expect(p.version).toBe(2)`，并在同一用例补一行：

```ts
    expect(p.episodes).toHaveLength(1);
    expect(p.activeEpisodeId).toBe(p.episodes[0].id);
```

- [ ] **Step 10: 跑测试**

Run: `pnpm test`
Expected: PASS（全绿）。若 `clipClipboard.test.ts` / `filmImport.test.ts` / `plan.test.ts` / `sessionMerge.test.ts` 里出现 `episodes` 缺失的**类型**错误，先用 `pnpm build` 复核；纯字面量构造的 v1 文档加 `as unknown as Project`，或用 `{ ...newProject(), tracks: [...] }` 的写法。

- [ ] **Step 11: 类型检查**

Run: `pnpm build`
Expected: 通过（`vue-tsc --noEmit` + vite build）。

- [ ] **Step 12: 提交**

```bash
git add src/core/episodes.ts src/core/__tests__/episodes.test.ts src/types/project.ts \
  src/core/factory.ts src/core/ops/internal.ts src/core/serialize.ts \
  src/core/__tests__/serialize.test.ts src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(core): 工程文档 v2（多分P），tracks/markers 走不可枚举投影"
```

---

### Task 2: store 接入与切分P

**Files:**
- Modify: `src/stores/project.ts`（8 个 `doc.value =` 赋值点 + `switchEpisode` + 导出）
- Create: `src/stores/__tests__/projectEpisodes.test.ts`

**Interfaces:**
- Consumes: `attachEpisodeView`、`switchActiveEpisode`（Task 1 的签名）。
- Produces: `useProjectStore().switchEpisode(episodeId: string): boolean`。

- [ ] **Step 1: 写失败测试 `src/stores/__tests__/projectEpisodes.test.ts`**

```ts
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/media", () => ({
  readProjectFile: vi.fn(async () => ""),
  writeProjectFile: vi.fn(async () => undefined),
  pickProjectFile: vi.fn(async () => null),
  pickSaveProjectPath: vi.fn(async () => null),
  pathExists: vi.fn(async () => true),
}));

import { useProjectStore } from "@/stores/project";
import { attachEpisodeView, newEpisode } from "@/core/episodes";
import { createClip, newProject } from "@/core/factory";
import { addAsset, addTrack } from "@/core/ops";
import type { MediaAsset, Project } from "@/types/project";

beforeEach(() => {
  setActivePinia(createPinia());
});

/** 建一份带两个分P 的工程并重置进 store。 */
function setupTwoEpisodes() {
  const base = newProject("两集");
  const second = newEpisode("分P 2", 1);
  const doc = attachEpisodeView({
    ...base,
    episodes: [...base.episodes, second],
  } as Project);
  const store = useProjectStore();
  store.reset(doc, null);
  return { store, firstId: doc.episodes[0].id, secondId: second.id };
}

describe("switchEpisode", () => {
  it("切分P 后 tracks 指向目标分P 并清空撤销栈", () => {
    const { store, secondId } = setupTwoEpisodes();
    store.dispatch((doc) => addTrack(doc));
    expect(store.canUndo).toBe(true);
    expect(store.doc.tracks).toHaveLength(1);

    expect(store.switchEpisode(secondId)).toBe(true);
    expect(store.doc.activeEpisodeId).toBe(secondId);
    expect(store.doc.tracks).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });

  it("切回原分P 时之前的轨道还在，且投影仍可用", () => {
    const { store, firstId, secondId } = setupTwoEpisodes();
    store.dispatch((doc) => addTrack(doc));
    store.switchEpisode(secondId);
    store.switchEpisode(firstId);
    expect(store.doc.tracks).toHaveLength(1);
    expect(store.doc.tracks[0].clips).toEqual([]);
  });

  it("未知分P 或当前分P 返回 false，文档不变", () => {
    const { store, secondId } = setupTwoEpisodes();
    const before = store.doc;
    expect(store.switchEpisode("nope")).toBe(false);
    expect(store.switchEpisode(store.doc.activeEpisodeId)).toBe(false);
    expect(store.doc).toBe(before);
    expect(secondId).toBeTruthy();
  });
});

describe("分P 之间共享的数据", () => {
  it("素材是工程级的：切分P 后仍在", () => {
    const { store, secondId } = setupTwoEpisodes();
    store.dispatch((doc) =>
      addAsset(doc, {
        id: "a1",
        kind: "video",
        src: "/tmp/a.mp4",
        name: "a.mp4",
        duration: 2,
      } as unknown as MediaAsset),
    );
    store.switchEpisode(secondId);
    expect(store.doc.assets.map((asset) => asset.id)).toEqual(["a1"]);
  });

  it("剪辑只落在当前分P，不影响另一集", () => {
    const { store, firstId, secondId } = setupTwoEpisodes();
    store.dispatch((doc) => addTrack(doc));
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) => {
      const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 1 });
      return {
        ...doc,
        tracks: doc.tracks.map((track) =>
          track.id === trackId ? { ...track, clips: [...track.clips, clip] } : track,
        ),
      } as Project;
    });
    store.switchEpisode(secondId);
    expect(store.doc.tracks).toHaveLength(0);
    store.switchEpisode(firstId);
    expect(store.doc.tracks[0].clips).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test projectEpisodes`
Expected: FAIL —— `store.switchEpisode is not a function`。

- [ ] **Step 3: 改 `src/stores/project.ts`**

import 补：

```ts
import { attachEpisodeView, switchActiveEpisode } from "@/core/episodes";
```

新增 action（放在 `markSaved` 之后、`setAssetWaveform` 之前）：

```ts
  /**
   * 切到另一个分P。
   *
   * 只换 `activeEpisodeId`：时间线真相在 `episodes` 里，素材 / 画布 / 输出设置都是
   * 工程级的，切分P 不复制也不移动它们。
   *
   * 撤销栈按分P 隔离：切分P 时清空撤销 / 重做，避免「撤销上一集的操作」把当前集
   * 改坏。播放头 / 选择的复位由 UI 层负责（P1 接入视图切换时再做）。
   */
  function switchEpisode(episodeId: string): boolean {
    if (readOnly.value) return false;
    const next = switchActiveEpisode(doc.value, episodeId);
    if (!next) return false;
    flushCoalesce();
    undoStack.value = [];
    redoStack.value = [];
    doc.value = next;
    dirty.value = true;
    return true;
  }
```

把 8 处赋值折返（逐个改）：

| 位置（改前） | 改成 |
| --- | --- |
| `commitBefore` 里 `doc.value = after;` | `doc.value = attachEpisodeView(after);` |
| `dispatchCoalesced` 里 `doc.value = next;` | `doc.value = attachEpisodeView(next);` |
| `undoOne` 里 `doc.value = step.before;` | `doc.value = attachEpisodeView(step.before);` |
| `redoOne` 里 `doc.value = step.after;` | `doc.value = attachEpisodeView(step.after);` |
| `reset` 里 `doc.value = project;` | `doc.value = attachEpisodeView(project);` |
| `setAssetWaveform` 里 `if (next !== doc.value) doc.value = next;` | `if (next !== doc.value) doc.value = attachEpisodeView(next);` |
| `setAssetThumbnail` 同上一行 | 同上 |
| `applyRemote` 里 `doc.value = mergeRemoteProject(...)` | `doc.value = attachEpisodeView(mergeRemoteProject(...));` |

导出表里加 `switchEpisode,`（放在 `newProject` 之后）。

- [ ] **Step 4: 运行测试**

Run: `pnpm test projectEpisodes`
Expected: PASS。

- [ ] **Step 5: 跑全量，确认没有回退**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/stores/project.ts src/stores/__tests__/projectEpisodes.test.ts
git commit -m "feat(project): store 接入分P 投影与切分P"
```

---

### Task 3: 会话合并按分P

**Files:**
- Modify: `src/types/events.ts`（`Affected.episodeId?`）
- Modify: `src/core/sessionMerge.ts`（按分P 合并）
- Modify: `src/core/__tests__/sessionMerge.test.ts`（改写成 v2 文档）

**Interfaces:**
- Consumes: `attachEpisodeView`（测试里用）、`Affected`（新字段）。
- Produces: `mergeRemoteProject(current, incoming, affected, full)` 语义不变，行为按分P 生效。

- [ ] **Step 1: 改 `src/types/events.ts`**

```ts
export interface Affected {
  clipIds: string[];
  trackIds: string[];
  assetIds: string[];
  /** 受影响的区间（秒）。 */
  range?: [number, number];
  /** 受影响的分P；缺省视为发送方的当前分P。 */
  episodeId?: string;
}
```

- [ ] **Step 2: 重写 `src/core/__tests__/sessionMerge.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { mergeRemoteProject } from "@/core/sessionMerge";
import { attachEpisodeView, newEpisode } from "@/core/episodes";
import { newProject } from "@/core/factory";
import type { Affected } from "@/types/events";
import type { Project, Track } from "@/types/project";

function track(id: string, name = id): Track {
  return { id, name, muted: false, locked: false, visible: true, clips: [] };
}

function docWith(name: string, tracks: Track[]): Project {
  const base = newProject(name);
  return attachEpisodeView({
    ...base,
    episodes: [{ ...base.episodes[0], tracks }],
  } as Project);
}

describe("mergeRemoteProject", () => {
  it("同一分P：只替换受影响轨道，保留另一条本地轨道", () => {
    const local = docWith("local", [track("t1", "local-t1"), track("t2", "local-t2")]);
    const incoming = docWith("remote", [track("t1", "remote-t1"), track("t2", "remote-t2")]);
    const merged = mergeRemoteProject(local, incoming, {
      clipIds: [],
      trackIds: ["t1"],
      assetIds: [],
      episodeId: local.activeEpisodeId,
    }, false);
    expect(merged.name).toBe("remote");
    expect(merged.tracks[0].name).toBe("remote-t1");
    expect(merged.tracks[1].name).toBe("local-t2");
  });

  it("不同分P 的补丁不动当前分P 的轨道", () => {
    const localBase = newProject("local");
    const second = newEpisode("分P 2", 1);
    const local = attachEpisodeView({
      ...localBase,
      episodes: [
        { ...localBase.episodes[0], tracks: [track("t1", "local-t1")] },
        { ...second, tracks: [track("r1", "local-r1")] },
      ],
    } as Project);
    const incoming = attachEpisodeView({
      ...local,
      episodes: local.episodes.map((episode) =>
        episode.id === second.id
          ? { ...episode, tracks: [track("r1", "remote-r1")] }
          : { ...episode, tracks: [track("t1", "remote-t1")] },
      ),
    } as Project);

    const merged = mergeRemoteProject(local, incoming, {
      clipIds: [],
      trackIds: ["r1"],
      assetIds: [],
      episodeId: second.id,
    }, false);

    expect(merged.activeEpisodeId).toBe(local.activeEpisodeId);
    expect(merged.tracks[0].name).toBe("local-t1");
    const other = merged.episodes.find((episode) => episode.id === second.id)!;
    expect(other.tracks[0].name).toBe("remote-r1");
  });

  it("远端新建的分P 会被带过来", () => {
    const local = docWith("local", []);
    const extra = newEpisode("远端新集", 1);
    const incoming = attachEpisodeView({
      ...local,
      episodes: [...local.episodes, extra],
    } as Project);
    const merged = mergeRemoteProject(local, incoming, {
      clipIds: [],
      trackIds: [],
      assetIds: [],
      episodeId: local.activeEpisodeId,
    }, false);
    expect(merged.episodes.some((episode) => episode.id === extra.id)).toBe(true);
  });

  it("full 或没有 affected 时整份替换", () => {
    const local = docWith("local", []);
    const incoming = docWith("remote", []);
    expect(mergeRemoteProject(local, incoming, null, false)).toBe(incoming);
    expect(mergeRemoteProject(local, incoming, null, true)).toBe(incoming);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test sessionMerge`
Expected: FAIL —— 不同分P 的补丁会覆盖当前分P（`merged.tracks[0].name` 是 `remote-t1`）。

- [ ] **Step 4: 重写 `src/core/sessionMerge.ts`**

```ts
/**
 * 多端会话的工程合并。
 *
 * 每个客户端都持有完整文档；一次编辑只广播「受影响的对象 + 分P」：
 * 同一分P 内轨道按整条替换、素材按条替换，工程级字段（名称 / 帧率 / 分辨率）以后到者为准；
 * 不同分P 的补丁互不覆盖，当前分P 由本地决定（远端不会把你从正在剪的那一集踢走）。
 * 远端新建的分P 会被带过来。
 */
import { attachEpisodeView } from "@/core/episodes";
import type { Affected } from "@/types/events";
import type { Episode, MediaAsset, Project, Track } from "@/types/project";

function owningTrackIds(tracks: Track[], clipIds: Set<string>): string[] {
  const ids: string[] = [];
  for (const track of tracks) {
    if (track.clips.some((clip) => clipIds.has(clip.id))) ids.push(track.id);
  }
  return ids;
}

/** 在一个分P 内合并轨道：只替换受影响的轨道，其余保留本地版本。 */
function mergeEpisodeTracks(
  local: Episode,
  incoming: Episode,
  trackIds: Set<string>,
): Episode {
  const incomingTracks = new Map(incoming.tracks.map((track) => [track.id, track]));
  const tracks = local.tracks.filter(
    (track) => !trackIds.has(track.id) || incomingTracks.has(track.id),
  );
  for (const [index, track] of incoming.tracks.entries()) {
    if (!trackIds.has(track.id)) continue;
    const localIndex = tracks.findIndex((item) => item.id === track.id);
    if (localIndex >= 0) tracks[localIndex] = track;
    else tracks.splice(Math.min(index, tracks.length), 0, track);
  }
  return { ...incoming, tracks };
}

function mergeAssets(
  local: MediaAsset[],
  incoming: MediaAsset[],
  assetIds: Set<string>,
): MediaAsset[] {
  const incomingAssets = new Map(incoming.assets.map((asset) => [asset.id, asset]));
  const assets = local.assets.filter(
    (asset) => !assetIds.has(asset.id) || incomingAssets.has(asset.id),
  );
  for (const [index, asset] of incoming.assets.entries()) {
    if (!assetIds.has(asset.id)) continue;
    const localIndex = assets.findIndex((item) => item.id === asset.id);
    if (localIndex >= 0) assets[localIndex] = asset;
    else assets.splice(Math.min(index, assets.length), 0, asset);
  }
  return assets;
}

/** 把远端快照合并进当前文档；`full` 或没有 affected 时整份替换。 */
export function mergeRemoteProject(
  current: Project,
  incoming: Project,
  affected: Affected | null | undefined,
  full: boolean,
): Project {
  if (full || !affected) return attachEpisodeView(incoming);

  const clipIds = new Set(affected.clipIds);
  const patchEpisodeId = affected.episodeId ?? incoming.activeEpisodeId;
  const incomingEpisode = incoming.episodes.find((episode) => episode.id === patchEpisodeId);
  const clipOwners = new Set([
    ...owningTrackIds(current.tracks, clipIds),
    ...(incomingEpisode ? owningTrackIds(incomingEpisode.tracks, clipIds) : []),
  ]);
  const trackIds = new Set([...affected.trackIds, ...clipOwners]);

  const episodes = current.episodes.map((episode) => {
    if (episode.id !== patchEpisodeId || !incomingEpisode) return episode;
    return mergeEpisodeTracks(episode, incomingEpisode, trackIds);
  });
  const known = new Set(current.episodes.map((episode) => episode.id));
  for (const episode of incoming.episodes) {
    if (!known.has(episode.id)) episodes.push(episode);
  }

  return attachEpisodeView({
    ...incoming,
    episodes,
    activeEpisodeId: current.activeEpisodeId,
    assets: mergeAssets(current.assets, incoming.assets, new Set(affected.assetIds)),
  } as Project);
}
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test sessionMerge`
Expected: PASS。

- [ ] **Step 6: 全量 + 提交**

```bash
pnpm test
git add src/types/events.ts src/core/sessionMerge.ts src/core/__tests__/sessionMerge.test.ts
git commit -m "feat(session): 会话合并按分P 隔离，远端不夺走当前分P"
```

---

### Task 4: domain golden 重新生成与 Rust 校验

**Files:**
- Modify: `crates/daemon/assets/domain.js`（脚本产物）
- Modify: `crates/daemon/tests/fixtures/expected.json`（脚本产物）
- 只读确认: `crates/daemon/tests/fixtures/project.json`（保持 v1 形态，用来证明迁移不改变行为）

**Interfaces:**
- Consumes: Task 1 的 `parseProject` / `serializeProject` 折返。
- Produces: 无新 API。

- [ ] **Step 1: 生成 domain bundle**

Run: `pnpm build:domain`
Expected: 输出 `domain bundle: crates/daemon/assets/domain.js (… KiB, … inputs)`，且没有 "domain bundle 不能依赖 Vue / store" 报错。

- [ ] **Step 2: 跑 Node 侧基准（golden）**

Run: `node scripts/domain-golden.mjs`
Expected: 写出 `crates/daemon/tests/fixtures/expected.json`。

- [ ] **Step 3: 确认 fixture 仍是 v1 形态**

Run: `grep -c '"tracks"' crates/daemon/tests/fixtures/project.json; grep -c '"episodes"' crates/daemon/tests/fixtures/project.json || true`
Expected: 第一条输出 ≥1（根级 `tracks` 仍在），第二条输出 `0`（fixture 仍是 v1 形态，不改）。

- [ ] **Step 4: 确认 expected 已升级为 v2**

Run: `grep -c '"episodes"' crates/daemon/tests/fixtures/expected.json; grep -c '"activeEpisodeId"' crates/daemon/tests/fixtures/expected.json`
Expected: 两条都 ≥1（golden 已升级为 v2）。

- [ ] **Step 5: 跑 Rust 侧一致性测试**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml`
Expected: PASS。若 golden 比对失败，检查是否漏跑 Step 1（bundle 未更新）。

- [ ] **Step 6: 提交产物**

```bash
git add crates/daemon/assets/domain.js crates/daemon/tests/fixtures/expected.json
git commit -m "chore(domain): 重新生成 golden（工程文档 v2）"
```

---

### Task 5: 回归收尾（受影响的既有测试 + 文档）

**Files:**
- Modify: `src/core/__tests__/clipClipboard.test.ts`、`src/core/__tests__/filmImport.test.ts`、`src/core/export/__tests__/plan.test.ts`（仅在类型/断言需要时）
- Modify: `src/types/project.ts` 注释（如与实现不符）
- Modify: `docs/superpowers/specs/2026-11-16-canvas-views-design.md`（§4.5 撤销栈语义按实现措辞校正）

**Interfaces:**
- Consumes: Task 1–4 的全部产出。
- Produces: 无。

- [ ] **Step 1: 跑全量测试**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 2: 跑类型检查 + 构建**

Run: `pnpm build`
Expected: PASS。

- [ ] **Step 3: 逐个修掉类型报错**

如果 `pnpm build` 报 `Project` 缺 `episodes` / `activeEpisodeId`（纯字面量构造的旧文档），按这个规则改：

- 想测 **v2 文档** → 用 `{ ...newProject(), tracks: [...] }` 或 `attachEpisodeView({...base, episodes: [...]})`；
- 想测 **v1 兼容** → 保留原字面量，末尾加 `as unknown as Project`。

- [ ] **Step 4: 校正 spec 措辞**

`docs/superpowers/specs/2026-11-16-canvas-views-design.md` §4.5 的「撤销栈按分P 独立」改成与实现一致的表述：

```
2. **撤销栈按分P 隔离**：切分P 时清空撤销 / 重做栈，避免跨集撤销把当前集改坏
   （后续如需跨分P 保留历史，再引入以 episodeId 为键的分P 维度栈）；
```

- [ ] **Step 5: 跑一次无头引擎回归（防止 core 误引 Vue）**

Run: `pnpm build:domain`
Expected: 成功，无 forbidden 依赖告警。

- [ ] **Step 6: 提交**

```bash
git add src/core/__tests__ src/core/export/__tests__   docs/superpowers/specs/2026-11-16-canvas-views-design.md
git commit -m "test(project): 分P 文档 v2 回归与 spec 措辞校正"
```

---

## Self-Review

**1. Spec 覆盖**

| Spec 章节 | 覆盖任务 |
| --- | --- |
| §4.1 结构（Project / Episode） | Task 1 Step 3 |
| §4.2 非枚举投影 + 纪律 | Task 1 Step 4/6/7、Task 2 Step 3 |
| §4.3 迁移与兼容（v1→v2） | Task 1 Step 4/7、Task 4 Step 3 |
| §4.4 domain 引擎与 golden | Task 4 |
| §4.5 切分P（撤销隔离） | Task 2 Step 3 |
| §4.6 会话合并按分P | Task 3 |
| §4.7 画布文档 | **本计划不含**，随 P2 画布计划落地（`board?` 为可选字段，不阻塞） |
| §3 三视图外壳 / §5 画布 / §6 节点 / §7 H3 / §8 剧集界面 | **不在本计划**，各子系统单独出计划 |
| §9 测试 / §10 分阶段 P0 | Task 1–5 即 P0 全部内容 |

**2. 占位符扫描**：无 TBD / TODO。Task 1 Step 7 的 `normalizeMarkers` 标注了"原逻辑原样搬"，同时给出了搬运来源（原 `normalizeProject` 的 markers 段），实现者不需要凭空发明。

**3. 类型一致性**：`attachEpisodeView` / `switchActiveEpisode` / `newEpisode` / `activeEpisode` / `isEpisodeViewAttached` 五个名字在 Task 1 定义、Task 2/3 原样引用；`Affected.episodeId` 在 Task 3 定义并在测试中使用；store 的 `switchEpisode` 在 Task 2 定义并被测试调用。

**4. 已知取舍**：切分P 清空撤销栈（而非分P 维度栈）——实现成本低、语义安全，代价是跨集不可撤销；已在 Task 5 Step 4 回写 spec。

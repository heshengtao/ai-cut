# AI Cut 核心剪辑引擎 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ai-cut 的静态原型变成真正可用的视频剪辑器——导入素材、在时间线上移动/裁剪/分割/删除、播放预览、保存并重开工程。

**Architecture:** 前端（Vue 3 + Pinia）持有整份响应式工程文档，所有剪辑操作是纯函数 `(doc) => doc`；撤销/重做用文档快照历史。Rust 侧只提供前端做不了的能力：原生文件框、ffprobe/ffmpeg（以 sidecar 打包）探测元数据与生成缩略图/波形、读写工程 JSON。预览用原生 `<video>` 播放单主视频轨，其余轨道用 `<img>`/DOM/`<audio>` 叠层。

**Tech Stack:** Tauri 2 (Rust) · Vue 3 + TypeScript (strict) · Vite 6 · Vitest · Tailwind 3 · Pinia 3 · @heroicons/vue · ffmpeg/ffprobe sidecar

## Global Constraints

- **时间单位**：一律秒（`number`，double）。落点用 `snapToFrame(sec, fps)` 吸附到帧网格；本期内工程帧率为整数（默认 30）。
- **片段归属**：片段挂在轨道下（`track.clips[]`），轨内按 `start` 升序。禁止跨轨共享同一个 Clip 对象。
- **同轨禁止重叠**：见 Task 7 的明确策略。
- **ops 不可变**：每个 op `(doc, ...) => Project` 返回新对象；**输入非法或无实际变化时，必须返回传入的同一个 `doc` 引用**（`===`），上层以此判断「无需记入历史」。
- **ops 不修改入参**：不得原地改动 `doc` 任何嵌套对象。
- **撤销历史**：快照式，上限 100 步。
- **工程文件**：普通 `.json`，内容即 `Project` 的序列化，无自定义后缀。
- **工程版本**：`version: 1`（`PROJECT_VERSION`）。
- **注释与命名**：代码注释用**中文**、JSDoc 风格，与现有代码库一致；标识符用英文。不要在未被要求的地方添加注释。
- **TS 严格度**：`strict` + `noUnusedLocals` + `noUnusedParameters` + `verbatimModuleSyntax`（类型导入必须写 `import type`）。
- **路径别名**：`@/` → `src/`。
- **开发端口**：1430（`vite.config.ts` 与 `src-tauri/tauri.conf.json` 的 `devUrl` 必须一致）。
- **设计语言**：Material You / MD3，复用 `src/assets/main.css` 的令牌与 `.btn-*` `.pane-*` `.icon-btn` `.md3-range` 等类，不引入新设计体系。
- **门槛**：`npm run build`（`vue-tsc --noEmit` + `vite build`）、`cargo check`、`npx vitest run` 全绿。

## File Structure

**新增（前端）**

| 文件 | 职责 |
| --- | --- |
| `src/types/project.ts` | 领域类型与常量（`Project`/`Track`/`Clip`/`MediaAsset`/`PROJECT_VERSION`） |
| `src/core/time.ts` | 帧↔秒换算、`snapToFrame`、`formatTimecode` |
| `src/core/factory.ts` | 构造器：`newProject()`、`createTrack()`、`createClip()`、`createAsset()`（id 生成） |
| `src/core/serialize.ts` | `Project` ↔ JSON：`serializeProject`、`parseProject`（含校验） |
| `src/core/ops/internal.ts` | ops 内部助手：`mapTrack`/`mapClip`/`findClip`/`withTouch` 等 |
| `src/core/ops/assets.ts` | 素材 ops |
| `src/core/ops/tracks.ts` | 轨道 ops |
| `src/core/ops/clips.ts` | 片段 ops |
| `src/core/ops/index.ts` | 统一再导出 |
| `src/core/ops/project.ts` | 工程级 ops（`renameProject`） |
| `src/core/playback/activeClips.ts` | 时间→片段映射：`activeClipsAt`、`mainVideoTrack`、`mainVideoClipAt`、`projectDuration`、`isAudible` |
| `src/core/playback/engine.ts` | 预览引擎：时钟 + `<video>`/`<audio>` 池同步 |
| `src/core/snapping.ts` | 时间线吸附（`snapTargets`/`snapMove`/`snapEdge`） |
| `src/core/media.ts` | webview URL 转换 + Tauri 命令封装 + ffmpeg 可用性 |
| `src/core/autosave.ts` | autosave 写入 + 启动恢复检测 |
| `src/core/shortcuts.ts` | 全局快捷键注册/注销 |
| `src/stores/project.ts` | 工程文档 + dispatch + 撤销/重做 + 保存/打开 |
| `src/stores/selection.ts` | 选中片段与当前轨道 |
| `src/stores/playback.ts` | 播放头、播放状态、时间线缩放 |
| `src/components/common/Toast.vue` | MD3 toast 通知 |
| `src/composables/useToast.ts` | 全局 toast 队列 |
| `src/composables/useTimelineActions.ts` | 时间线动词（分割/删除），工具栏与快捷键共用 |
| `src/components/workspace/TimelineRuler.vue` | 时间线标尺（从 TimelinePane 拆出） |
| `src/components/workspace/TrackHeader.vue` | 轨道头（从 TimelinePane 拆出） |
| `src/components/workspace/TimelineClip.vue` | 单个片段块（渲染 + 拖拽/裁剪把手） |

**新增（Rust）**

| 文件 | 职责 |
| --- | --- |
| `src-tauri/src/sidecar.rs` | 调用 ffmpeg/ffprobe sidecar 的封装 |
| `src-tauri/src/media.rs` | `probe_media` / `make_thumbnail` / `make_waveform` 命令 |
| `src-tauri/src/project_io.rs` | `read_project` / `write_project` 命令 |
| `src-tauri/binaries/ffmpeg-<triple>`、`ffprobe-<triple>` | 打包的 sidecar 二进制（由脚本生成，不入库） |
| `scripts/fetch-sidecars.sh` | 从系统 PATH 取 ffmpeg/ffprobe 并按 target-triple 命名 |

**修改**

`vite.config.ts`（vitest 配置）· `package.json`（依赖 + `test` 脚本）· `tsconfig.json`（排除测试？不，纳入）·
`src-tauri/Cargo.toml` · `src-tauri/src/lib.rs` · `src-tauri/tauri.conf.json` · `src-tauri/capabilities/default.json` ·
`src/components/workspace/PreviewStage.vue` · `src/components/workspace/TimelinePane.vue` ·
`src/components/workspace/panes/MediaPane.vue` · `src/components/workspace/panes/InspectorPane.vue` ·
`src/components/layout/TopBar.vue` · `src/App.vue`

**测试**

`src/core/__tests__/` 与 `src/core/ops/__tests__/` 下的 `*.test.ts`（与实现同目录的 `__tests__/` 子目录）。

---

### Task 1: 测试与构建基础设施

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/core/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `npx vitest run` 可跑；`@/` 别名在测试中可用。

- [ ] **Step 1: 安装依赖**

```bash
pnpm add -D vitest
```

若 pnpm 因沙箱拒绝链接而失败，退回 `npm install -D vitest`（见风险 R5）。

- [ ] **Step 2: 配置 vitest（复用 vite 配置）**

把 `vite.config.ts` 第 1 行的 import 换成 vitest 的 `defineConfig`，并追加 `test` 段：

```ts
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: 加 test 脚本**

`package.json` 的 `scripts` 增加一行：

```json
"test": "vitest run"
```

- [ ] **Step 3b: 把测试文件排除出构建期类型检查**

`tsconfig.json` 开启 `noUnusedLocals`，而测试里常有多余的解构变量（例如 fixture 返回 5 个字段、某个用例只用 3 个），会让 `vue-tsc` 报错。测试文件不参与打包，把它排除出 `tsconfig.json`：

```json
"exclude": ["src-tauri", "dist", "node_modules", "src/**/__tests__/**"]
```

（测试的类型安全由 vitest 在运行时覆盖；类型错误仍然会在 IDE 里以 tsconfig.json 之外的推断显示。若后续想单独类型检查测试，再加一个 `tsconfig.test.json`。）

- [ ] **Step 4: 写冒烟测试验证别名可用**

`src/core/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PROJECT_VERSION } from "@/types/project";

describe("toolchain", () => {
  it("resolves the @/ alias and reads project constants", () => {
    expect(PROJECT_VERSION).toBe(1);
  });
});
```

> 注意：本步依赖 Task 2 的 `src/types/project.ts`。若先做本任务，则临时把断言改成 `expect(true).toBe(true)` 并在 Task 2 后改回；建议按编号顺序执行，Task 2 紧跟其后。

- [ ] **Step 5: 运行**

```bash
npx vitest run src/core/__tests__/smoke.test.ts
```

Expected: PASS。若报 `Cannot find module '@/types/project'`，说明 Task 2 尚未完成。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/core/__tests__/smoke.test.ts
git commit -m "test: add vitest with @/ alias support"
```

---

### Task 2: 领域类型与时间工具

**Files:**
- Create: `src/types/project.ts`
- Create: `src/core/time.ts`
- Test: `src/core/__tests__/time.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type AssetKind = "video" | "audio" | "image"`；`type TrackKind = "video" | "audio" | "text"`
  - `interface MediaAsset { id, name, kind, src, duration, width?, height?, fps?, hasAudio?, thumb?, wave?, offline?, addedAt }`
  - `interface Clip { id, assetId, trackId, start, duration, in, text?, gain?, opacity? }`
  - `interface Track { id, kind, name, muted, solo, locked, clips }`
  - `interface Project { version, name, createdAt, updatedAt, fps, width, height, assets, tracks }`
  - `const PROJECT_VERSION = 1`
  - `secToFrame(sec, fps): number`、`frameToSec(frame, fps): number`、`snapToFrame(sec, fps): number`、`formatTimecode(sec, fps): string`

- [ ] **Step 1: 写时间工具测试**

`src/core/__tests__/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTimecode, frameToSec, secToFrame, snapToFrame } from "@/core/time";

describe("secToFrame / frameToSec", () => {
  it("converts both ways at integer fps", () => {
    expect(secToFrame(1, 30)).toBe(30);
    expect(frameToSec(45, 30)).toBeCloseTo(1.5);
  });
});

describe("snapToFrame", () => {
  it("snaps to the nearest frame boundary", () => {
    expect(snapToFrame(1.004, 30)).toBeCloseTo(1.0);
    expect(snapToFrame(1.02, 30)).toBeCloseTo(1.033333, 5);
  });

  it("is stable on already-snapped input", () => {
    const once = snapToFrame(2.5, 30);
    expect(snapToFrame(once, 30)).toBe(once);
  });
});

describe("formatTimecode", () => {
  it("formats as HH:MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(12 + 8 / 30, 30)).toBe("00:00:12:08");
    expect(formatTimecode(3661.5, 30)).toBe("01:01:01:15");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimecode(-5, 30)).toBe("00:00:00:00");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/__tests__/time.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/time'`。

- [ ] **Step 3: 写 `src/types/project.ts`**

```ts
/** AI Cut 的领域类型：工程文档及其组成部分。 */

/** 素材类型。 */
export type AssetKind = "video" | "audio" | "image";

/** 轨道类型。图片素材放在 `video` 轨，文字片段放在 `text` 轨。 */
export type TrackKind = "video" | "audio" | "text";

/** 导入的素材：只记录源文件路径引用，不拷贝文件。 */
export interface MediaAsset {
  id: string;
  name: string;
  kind: AssetKind;
  /** 源文件绝对路径。 */
  src: string;
  /** 秒；图片为 0。 */
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  /** 缩略图缓存文件名（应用数据目录 cache/）。 */
  thumb?: string;
  /** 波形峰值 0..100。 */
  wave?: number[];
  /** 载入工程时源文件缺失。 */
  offline?: boolean;
  addedAt: number;
}

/** 片段：对某素材某区间的引用，放在某轨道的某时刻。 */
export interface Clip {
  id: string;
  /** 文字片段为空串。 */
  assetId: string;
  trackId: string;
  /** 时间线起点（秒）。 */
  start: number;
  /** 时长（秒），出点 = in + duration。 */
  duration: number;
  /** 素材入点（秒）。 */
  in: number;
  /** 文字片段的文案。 */
  text?: string;
  /** 音量增益 dB，默认 0。 */
  gain?: number;
  /** 不透明度 0..1，默认 1。 */
  opacity?: number;
}

/** 轨道：轨内片段按 start 升序且互不重叠。 */
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  clips: Clip[];
}

/** 工程文档，可直接序列化为 .json。 */
export interface Project {
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  fps: number;
  width: number;
  height: number;
  assets: MediaAsset[];
  tracks: Track[];
}

/** 当前工程文档版本。 */
export const PROJECT_VERSION = 1;
```

- [ ] **Step 4: 写 `src/core/time.ts`**

```ts
/** 时间换算：工程内部一律用秒，UI 落点吸附到帧网格。 */

/** 秒 → 帧号（四舍五入）。 */
export function secToFrame(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

/** 帧号 → 秒。 */
export function frameToSec(frame: number, fps: number): number {
  return frame / fps;
}

/** 把秒吸附到最近的帧边界。 */
export function snapToFrame(sec: number, fps: number): number {
  return frameToSec(secToFrame(sec, fps), fps);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 秒 → `HH:MM:SS:FF` 时间码（负数按 0 处理）。 */
export function formatTimecode(sec: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round(sec * rate));
  const frames = totalFrames % rate;
  const totalSec = Math.floor(totalFrames / rate);
  return [
    pad2(Math.floor(totalSec / 3600)),
    pad2(Math.floor(totalSec / 60) % 60),
    pad2(totalSec % 60),
    pad2(frames),
  ].join(":");
}
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run src/core/__tests__/time.test.ts
```

Expected: PASS（3 个 describe，5 个 it）。

- [ ] **Step 6: 提交**

```bash
git add src/types/project.ts src/core/time.ts src/core/__tests__/time.test.ts
git commit -m "feat(core): add project domain types and time utilities"
```

---

### Task 3: 工程工厂与序列化

**Files:**
- Create: `src/core/factory.ts`
- Create: `src/core/serialize.ts`
- Test: `src/core/__tests__/serialize.test.ts`

**Interfaces:**
- Consumes: Task 2 的类型
- Produces:
  - `createTrack(kind: TrackKind, name?: string): Track`
  - `createClip(input: { assetId: string; trackId: string; start: number; duration: number; in?: number; text?: string }): Clip`
  - `createAsset(input: Omit<MediaAsset, "id" | "addedAt"> & { id?: string; addedAt?: number }): MediaAsset`
  - `newProject(name?: string): Project` —— 默认含「视频 1」「音频 1」「文字 1」三条轨道
  - `serializeProject(p: Project): string`
  - `parseProject(json: string): Project`（校验失败抛 `Error`）

- [ ] **Step 1: 写序列化测试**

`src/core/__tests__/serialize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newProject, createClip } from "@/core/factory";
import { parseProject, serializeProject } from "@/core/serialize";

describe("newProject", () => {
  it("creates a versioned project with three default tracks", () => {
    const p = newProject("测试");
    expect(p.version).toBe(1);
    expect(p.name).toBe("测试");
    expect(p.fps).toBe(30);
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
    expect(p.tracks.map((t) => t.kind)).toEqual(["video", "audio", "text"]);
    expect(p.assets).toEqual([]);
  });

  it("gives every entity a distinct id", () => {
    const p = newProject();
    const ids = new Set([...p.tracks.map((t) => t.id)]);
    expect(ids.size).toBe(3);
  });
});

describe("serialize / parse round trip", () => {
  it("preserves the document through JSON", () => {
    const p = newProject("往返");
    const clip = createClip({ assetId: "a1", trackId: p.tracks[0].id, start: 1, duration: 2 });
    p.tracks[0].clips.push(clip);

    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
  });
});

describe("parseProject validation", () => {
  it("rejects a document with the wrong version", () => {
    expect(() => parseProject(JSON.stringify({ ...newProject(), version: 99 }))).toThrow(/version/i);
  });

  it("rejects non-object json", () => {
    expect(() => parseProject("[]")).toThrow();
  });

  it("rejects a track whose clips are missing", () => {
    const p = newProject();
    const broken = JSON.stringify({ ...p, tracks: [{ ...p.tracks[0], clips: undefined }] });
    expect(() => parseProject(broken)).toThrow(/clips/i);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/__tests__/serialize.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/factory'`。

- [ ] **Step 3: 写 `src/core/factory.ts`**

```ts
/** 领域对象构造器：统一 id 生成与默认值。 */
import type { Clip, MediaAsset, Project, Track, TrackKind } from "@/types/project";
import { PROJECT_VERSION } from "@/types/project";

function newId(): string {
  return crypto.randomUUID();
}

const TRACK_NAMES: Record<TrackKind, string> = {
  video: "视频",
  audio: "音频",
  text: "文字",
};

/** 某类型轨道的下一个默认名，如「视频 2」。 */
export function nextTrackName(project: Project, kind: TrackKind): string {
  const count = project.tracks.filter((t) => t.kind === kind).length + 1;
  return `${TRACK_NAMES[kind]} ${count}`;
}

export function createTrack(kind: TrackKind, name?: string): Track {
  return {
    id: newId(),
    kind,
    name: name ?? TRACK_NAMES[kind],
    muted: false,
    solo: false,
    locked: false,
    clips: [],
  };
}

export function createClip(input: {
  assetId: string;
  trackId: string;
  start: number;
  duration: number;
  in?: number;
  text?: string;
}): Clip {
  return {
    id: newId(),
    assetId: input.assetId,
    trackId: input.trackId,
    start: input.start,
    duration: input.duration,
    in: input.in ?? 0,
    ...(input.text !== undefined ? { text: input.text } : {}),
  };
}

export function createAsset(
  input: Omit<MediaAsset, "id" | "addedAt"> & { id?: string; addedAt?: number },
): MediaAsset {
  const { id, addedAt, ...rest } = input;
  return { ...rest, id: id ?? newId(), addedAt: addedAt ?? Date.now() };
}

/** 新建空工程：默认视频 / 音频 / 文字三条轨道。 */
export function newProject(name = "未命名项目"): Project {
  const now = Date.now();
  return {
    version: PROJECT_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    tracks: [createTrack("video"), createTrack("audio"), createTrack("text")],
  };
}
```

- [ ] **Step 4: 写 `src/core/serialize.ts`**

```ts
/** 工程文档 ↔ JSON。解析时做结构校验，避免坏文件把内存里的工程搞崩。 */
import type { Project } from "@/types/project";
import { PROJECT_VERSION } from "@/types/project";

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function assertProjectShape(value: unknown): asserts value is Project {
  if (!isObject(value)) throw new Error("工程文件格式错误：根节点不是对象");
  if (value.version !== PROJECT_VERSION) {
    throw new Error(`工程版本不支持：期望 version ${PROJECT_VERSION}，实际为 ${String(value.version)}`);
  }
  if (typeof value.name !== "string") throw new Error("工程文件格式错误：缺少 name");
  if (!isNumber(value.fps) || value.fps <= 0)
    throw new Error("工程文件格式错误：fps 非法");
  if (!isNumber(value.width) || !isNumber(value.height))
    throw new Error("工程文件格式错误：分辨率非法");
  if (!Array.isArray(value.assets)) throw new Error("工程文件格式错误：assets 不是数组");
  if (!Array.isArray(value.tracks)) throw new Error("工程文件格式错误：tracks 不是数组");

  for (const track of value.tracks) {
    if (!isObject(track)) throw new Error("工程文件格式错误：轨道不是对象");
    if (!Array.isArray(track.clips)) throw new Error("工程文件格式错误：轨道的 clips 不是数组");
    for (const clip of track.clips) {
      if (!isObject(clip)) throw new Error("工程文件格式错误：片段不是对象");
      if (!isNumber(clip.start) || !isNumber(clip.duration) || !isNumber(clip.in)) {
        throw new Error("工程文件格式错误：片段的时间字段非法");
      }
    }
  }
}

export function parseProject(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("工程文件不是合法 JSON");
  }
  assertProjectShape(raw);
  return raw;
}
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run src/core/__tests__/serialize.test.ts
```

Expected: PASS（6 个 it）。

- [ ] **Step 6: 提交**

```bash
git add src/core/factory.ts src/core/serialize.ts src/core/__tests__/serialize.test.ts
git commit -m "feat(core): add project factory and JSON (de)serialization with validation"
```

### Task 4: ops 内部助手与素材 ops

**Files:**
- Create: `src/core/ops/internal.ts`
- Create: `src/core/ops/assets.ts`
- Create: `src/core/ops/index.ts`
- Test: `src/core/ops/__tests__/assets.test.ts`

**Interfaces:**
- Consumes: Task 2 类型、Task 3 `createAsset`
- Produces:
  - `withTouch(doc, patch): Project`、`replaceTrack(doc, trackId, next): Project`、`mapTrack(doc, trackId, fn): Project`、`mapTrackClips(doc, trackId, fn): Project`、`findClip(doc, clipId): { track, clip } | null`、`sortClips(clips): Clip[]`
  - `addAsset(doc, asset): Project`、`removeAsset(doc, assetId): Project`、`updateAsset(doc, assetId, patch): Project`、`relinkAsset(doc, assetId, newSrc): Project`

- [ ] **Step 1: 写素材 ops 测试**

`src/core/ops/__tests__/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset, relinkAsset, removeAsset, updateAsset } from "@/core/ops/assets";

function projectWithVideo() {
  const doc = newProject();
  const asset = createAsset({
    name: "a.mp4",
    kind: "video",
    src: "/tmp/a.mp4",
    duration: 10,
    hasAudio: true,
  });
  const trackId = doc.tracks[0].id;
  const clip = createClip({ assetId: asset.id, trackId, start: 0, duration: 4 });
  const withAsset = addAsset(doc, asset);
  const withClip = {
    ...withAsset,
    tracks: withAsset.tracks.map((t) => (t.id === trackId ? { ...t, clips: [clip] } : t)),
  };
  return { doc: withClip, asset, trackId, clip };
}

describe("addAsset", () => {
  it("appends the asset and returns a new document", () => {
    const doc = newProject();
    const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 5 });
    const next = addAsset(doc, asset);
    expect(next.assets).toHaveLength(1);
    expect(next).not.toBe(doc);
    expect(doc.assets).toHaveLength(0);
  });

  it("is a no-op (same reference) when the id already exists", () => {
    const doc = newProject();
    const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 5 });
    const once = addAsset(doc, asset);
    expect(addAsset(once, asset)).toBe(once);
  });
});

describe("removeAsset", () => {
  it("removes the asset and every clip that referenced it", () => {
    const { doc, asset } = projectWithVideo();
    const next = removeAsset(doc, asset.id);
    expect(next.assets).toHaveLength(0);
    expect(next.tracks[0].clips).toHaveLength(0);
  });

  it("returns the same reference for an unknown id", () => {
    const { doc } = projectWithVideo();
    expect(removeAsset(doc, "nope")).toBe(doc);
  });
});

describe("updateAsset", () => {
  it("merges the patch and bumps updatedAt", () => {
    const { doc, asset } = projectWithVideo();
    const next = updateAsset(doc, asset.id, { thumb: "x.png", wave: [1, 2, 3] });
    expect(next.assets[0].thumb).toBe("x.png");
    expect(next.assets[0].wave).toEqual([1, 2, 3]);
    expect(next.updatedAt).toBeGreaterThanOrEqual(doc.updatedAt);
  });
});

describe("relinkAsset", () => {
  it("sets the new src and clears the offline flag", () => {
    const { doc, asset } = projectWithVideo();
    const offline = updateAsset(doc, asset.id, { offline: true });
    const next = relinkAsset(offline, asset.id, "/new/path.mp4");
    expect(next.assets[0].src).toBe("/new/path.mp4");
    expect(next.assets[0].offline).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/assets.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/ops/assets'`。

- [ ] **Step 3: 写 `src/core/ops/internal.ts`**

```ts
/** ops 的内部助手：不可变地替换轨道/片段，并统一维护 updatedAt。 */
import type { Clip, Project, Track } from "@/types/project";

/** 更新时间戳并覆盖指定字段。 */
export function withTouch(doc: Project, patch: Partial<Project>): Project {
  return { ...doc, ...patch, updatedAt: Date.now() };
}

/** 按 id 替换整条轨道；找不到或引用未变时返回原 doc。 */
export function replaceTrack(doc: Project, trackId: string, next: Track): Project {
  const index = doc.tracks.findIndex((t) => t.id === trackId);
  if (index < 0 || doc.tracks[index] === next) return doc;
  const tracks = doc.tracks.slice();
  tracks[index] = next;
  return withTouch(doc, { tracks });
}

/** 对某条轨道做映射；`fn` 返回同一引用即视为无变化。 */
export function mapTrack(doc: Project, trackId: string, fn: (track: Track) => Track): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return doc;
  return replaceTrack(doc, trackId, fn(track));
}

/** 对某条轨道的 clips 数组做映射。 */
export function mapTrackClips(
  doc: Project,
  trackId: string,
  fn: (clips: Clip[]) => Clip[],
): Project {
  return mapTrack(doc, trackId, (track) => {
    const clips = fn(track.clips);
    return clips === track.clips ? track : { ...track, clips };
  });
}

/** 在整份文档中定位片段。 */
export function findClip(doc: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** 轨内按 start 升序（不修改入参）。 */
export function sortClips(clips: Clip[]): Clip[] {
  return clips.slice().sort((a, b) => a.start - b.start);
}

/** 数值夹紧。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
```

- [ ] **Step 4: 写 `src/core/ops/assets.ts`**

```ts
/** 素材 ops：工程里的素材表，以及素材与片段的引用关系。 */
import type { MediaAsset, Project } from "@/types/project";
import { withTouch } from "./internal";

export function addAsset(doc: Project, asset: MediaAsset): Project {
  if (doc.assets.some((a) => a.id === asset.id)) return doc;
  return withTouch(doc, { assets: [...doc.assets, asset] });
}

/** 删除素材，并连带删除所有引用它的片段。 */
export function removeAsset(doc: Project, assetId: string): Project {
  const assets = doc.assets.filter((a) => a.id !== assetId);
  if (assets.length === doc.assets.length) return doc;
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    const clips = track.clips.filter((c) => c.assetId !== assetId);
    if (clips.length === track.clips.length) return track;
    changed = true;
    return { ...track, clips };
  });
  return withTouch(doc, changed ? { assets, tracks } : { assets });
}

/** 局部更新素材（缩略图/波形/离线标记等）。 */
export function updateAsset(doc: Project, assetId: string, patch: Partial<MediaAsset>): Project {
  const index = doc.assets.findIndex((a) => a.id === assetId);
  if (index < 0) return doc;
  const assets = doc.assets.slice();
  assets[index] = { ...assets[index], ...patch };
  return withTouch(doc, { assets });
}

/** 重新链接离线素材。 */
export function relinkAsset(doc: Project, assetId: string, newSrc: string): Project {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (!asset) return doc;
  if (asset.src === newSrc && !asset.offline) return doc;
  return updateAsset(doc, assetId, { src: newSrc, offline: false });
}
```

- [ ] **Step 5: 写 `src/core/ops/index.ts`**

```ts
/** 剪辑操作统一出口。所有 op 均为不可变纯函数。 */
export * from "./assets";
export * from "./tracks";
export * from "./clips";
```

> 本步之后 `tracks.ts` / `clips.ts` 尚不存在，`index.ts` 会报错——由 Task 5、Task 6 补齐。若想保持每步可编译，可先只写 `export * from "./assets";`，Task 5、Task 6 各自追加一行。

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/assets.test.ts
```

Expected: PASS（6 个 it）。

- [ ] **Step 7: 提交**

```bash
git add src/core/ops/internal.ts src/core/ops/assets.ts src/core/ops/index.ts src/core/ops/__tests__/assets.test.ts
git commit -m "feat(ops): add ops helpers and asset operations"
```

---

### Task 5: 轨道 ops

**Files:**
- Create: `src/core/ops/tracks.ts`
- Test: `src/core/ops/__tests__/tracks.test.ts`

**Interfaces:**
- Consumes: Task 3 `createTrack`/`nextTrackName`、Task 4 `internal.ts`
- Produces:
  - `addTrack(doc, kind: TrackKind, name?: string): Project`
  - `removeTrack(doc, trackId): Project`（至少保留一条轨道）
  - `renameTrack(doc, trackId, name): Project`
  - `setTrackFlag(doc, trackId, flag: "muted" | "solo" | "locked", value: boolean): Project`

- [ ] **Step 1: 写测试**

`src/core/ops/__tests__/tracks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { addTrack, removeTrack, renameTrack, setTrackFlag } from "@/core/ops/tracks";

describe("addTrack", () => {
  it("appends a track with an auto-incremented name", () => {
    const doc = newProject();
    const next = addTrack(doc, "video");
    expect(next.tracks).toHaveLength(4);
    expect(next.tracks[3].kind).toBe("video");
    expect(next.tracks[3].name).toBe("视频 2");
  });
});

describe("removeTrack", () => {
  it("removes the track and its clips", () => {
    const doc = newProject();
    const next = removeTrack(doc, doc.tracks[0].id);
    expect(next.tracks.map((t) => t.kind)).toEqual(["audio", "text"]);
  });

  it("refuses to remove the last remaining track", () => {
    let doc = newProject();
    doc = removeTrack(doc, doc.tracks[0].id);
    doc = removeTrack(doc, doc.tracks[0].id);
    expect(doc.tracks).toHaveLength(1);
    expect(removeTrack(doc, doc.tracks[0].id)).toBe(doc);
  });
});

describe("renameTrack", () => {
  it("sets the name and is a no-op for the same name", () => {
    const doc = newProject();
    const id = doc.tracks[0].id;
    const next = renameTrack(doc, id, "主镜头");
    expect(next.tracks[0].name).toBe("主镜头");
    expect(renameTrack(next, id, "主镜头")).toBe(next);
  });
});

describe("setTrackFlag", () => {
  it("toggles muted / solo / locked", () => {
    const doc = newProject();
    const id = doc.tracks[0].id;
    const muted = setTrackFlag(doc, id, "muted", true);
    expect(muted.tracks[0].muted).toBe(true);
    const solo = setTrackFlag(muted, id, "solo", true);
    expect(solo.tracks[0].solo).toBe(true);
    const locked = setTrackFlag(solo, id, "locked", true);
    expect(locked.tracks[0].locked).toBe(true);
    expect(setTrackFlag(locked, id, "locked", true)).toBe(locked);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/tracks.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/ops/tracks'`。

- [ ] **Step 3: 写 `src/core/ops/tracks.ts`**

```ts
/** 轨道 ops：增删改名与静音/独奏/锁定。 */
import type { Project, Track, TrackKind } from "@/types/project";
import { createTrack, nextTrackName } from "@/core/factory";
import { replaceTrack, withTouch } from "./internal";

export function addTrack(doc: Project, kind: TrackKind, name?: string): Project {
  const track = createTrack(kind, name ?? nextTrackName(doc, kind));
  return withTouch(doc, { tracks: [...doc.tracks, track] });
}

/** 删除轨道；只剩一条时拒绝（返回原 doc）。 */
export function removeTrack(doc: Project, trackId: string): Project {
  if (doc.tracks.length <= 1) return doc;
  const tracks = doc.tracks.filter((t) => t.id !== trackId);
  if (tracks.length === doc.tracks.length) return doc;
  return withTouch(doc, { tracks });
}

export function renameTrack(doc: Project, trackId: string, name: string): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track.name === name) return doc;
  return replaceTrack(doc, trackId, { ...track, name });
}

export function setTrackFlag(
  doc: Project,
  trackId: string,
  flag: "muted" | "solo" | "locked",
  value: boolean,
): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track[flag] === value) return doc;
  const next: Track =
    flag === "muted"
      ? { ...track, muted: value }
      : flag === "solo"
        ? { ...track, solo: value }
        : { ...track, locked: value };
  return replaceTrack(doc, trackId, next);
}
```

- [ ] **Step 4: 在 `src/core/ops/index.ts` 追加导出**

若 Task 4 Step 5 只写了 assets 一行，此时追加：

```ts
export * from "./tracks";
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/tracks.test.ts
```

Expected: PASS（5 个 it）。

- [ ] **Step 6: 提交**

```bash
git add src/core/ops/tracks.ts src/core/ops/index.ts src/core/ops/__tests__/tracks.test.ts
git commit -m "feat(ops): add track operations"
```

---

### Task 6: 片段 ops — 增删

**Files:**
- Create: `src/core/ops/clips.ts`
- Test: `src/core/ops/__tests__/clips.test.ts`

**Interfaces:**
- Consumes: Task 3 `createClip`、Task 4 `internal.ts`
- Produces（本任务只实现前两个，其余在同文件后续任务补）:
  - `addClip(doc, trackId: string, clip: Clip): Project`（轨内按 start 排序）
  - `removeClips(doc, clipIds: string[]): Project`
  - `updateClip(doc, clipId: string, patch: Partial<Clip>): Project`

- [ ] **Step 1: 写测试**

`src/core/ops/__tests__/clips.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import type { Project } from "@/types/project";
import { addClip, removeClips, updateClip } from "@/core/ops/clips";

/** 视频轨 / 音频轨各放一个片段，并返回它们的 id。 */
function fixture(): { doc: Project; vTrack: string; aTrack: string; c1: string; c2: string } {
  const base = newProject();
  const vTrack = base.tracks[0].id;
  const aTrack = base.tracks[1].id;
  const clip1 = createClip({ assetId: "a1", trackId: vTrack, start: 2, duration: 3 });
  const clip2 = createClip({ assetId: "a2", trackId: vTrack, start: 0, duration: 1 });
  let doc = addClip(base, vTrack, clip1);
  doc = addClip(doc, vTrack, clip2);
  return { doc, vTrack, aTrack, c1: clip1.id, c2: clip2.id };
}

describe("addClip", () => {
  it("inserts clips sorted by start", () => {
    const { doc, vTrack, c1, c2 } = fixture();
    const order = doc.tracks[0].clips.map((c) => c.id);
    expect(order).toEqual([c2, c1]);
    expect(doc.tracks[0].id).toBe(vTrack);
    expect(doc.tracks[0].clips).toHaveLength(2);
  });

  it("stamps the clip's trackId to the target track", () => {
    const base = newProject();
    const trackId = base.tracks[0].id;
    const clip = { ...createClip({ assetId: "a1", trackId: "wrong", start: 0, duration: 1 }) };
    const doc = addClip(base, trackId, clip);
    expect(doc.tracks[0].clips[0].trackId).toBe(trackId);
  });

  it("is a no-op for an unknown track", () => {
    const base = newProject();
    const clip = createClip({ assetId: "a1", trackId: "x", start: 0, duration: 1 });
    expect(addClip(base, "missing", clip)).toBe(base);
  });
});

describe("removeClips", () => {
  it("removes across multiple tracks", () => {
    const { doc, vTrack, aTrack, c1 } = fixture();
    const audio = createClip({ assetId: "a3", trackId: aTrack, start: 0, duration: 5 });
    const withAudio = addClip(doc, aTrack, audio);
    const next = removeClips(withAudio, [c1, audio.id]);
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[1].clips).toHaveLength(0);
    expect(next.tracks[0].clips[0].id).not.toBe(c1);
    expect(vTrack).toBe(doc.tracks[0].id);
  });

  it("returns the same reference for an empty list or unknown ids", () => {
    const { doc } = fixture();
    expect(removeClips(doc, [])).toBe(doc);
    expect(removeClips(doc, ["nope"])).toBe(doc);
  });
});

describe("updateClip", () => {
  it("patches only the target clip, leaving the document immutable", () => {
    const { doc, c1 } = fixture();
    const next = updateClip(doc, c1, { opacity: 0.5, gain: -3 });
    const found = next.tracks[0].clips.find((c) => c.id === c1)!;
    expect(found.opacity).toBe(0.5);
    expect(found.gain).toBe(-3);
    expect(doc.tracks[0].clips.find((c) => c.id === c1)!.opacity).toBeUndefined();
  });

  it("is a no-op for an unknown clip", () => {
    const { doc } = fixture();
    expect(updateClip(doc, "nope", { opacity: 0.5 })).toBe(doc);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/clips.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/ops/clips'`。

- [ ] **Step 3: 写 `src/core/ops/clips.ts`（本任务部分）**

```ts
/** 片段 ops：增删、移动、裁剪、分割与属性。全部不可变。 */
import type { Clip, Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { findClip, mapTrack, mapTrackClips, sortClips, withTouch, clamp } from "./internal";

export function addClip(doc: Project, trackId: string, clip: Clip): Project {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track || track.clips.some((c) => c.id === clip.id)) return doc;
  return mapTrack(doc, trackId, (t) => ({
    ...t,
    clips: sortClips([...t.clips, { ...clip, trackId }]),
  }));
}

export function removeClips(doc: Project, clipIds: string[]): Project {
  if (clipIds.length === 0) return doc;
  const ids = new Set(clipIds);
  let changed = false;
  const tracks = doc.tracks.map((track) => {
    const clips = track.clips.filter((c) => !ids.has(c.id));
    if (clips.length === track.clips.length) return track;
    changed = true;
    return { ...track, clips };
  });
  return changed ? withTouch(doc, { tracks }) : doc;
}

export function updateClip(doc: Project, clipId: string, patch: Partial<Clip>): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const next: Clip = { ...found.clip, ...patch, id: found.clip.id, trackId: found.clip.trackId };
  return mapTrackClips(doc, found.track.id, (clips) =>
    clips.map((c) => (c.id === clipId ? next : c)),
  );
}
```

- [ ] **Step 4: 在 `src/core/ops/index.ts` 追加导出**

```ts
export * from "./clips";
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/clips.test.ts
```

Expected: PASS（7 个 it）。

- [ ] **Step 6: 提交**

```bash
git add src/core/ops/clips.ts src/core/ops/index.ts src/core/ops/__tests__/clips.test.ts
git commit -m "feat(ops): add clip insert/remove/update operations"
```

---

### Task 7: 片段 ops — 移动与同轨重叠约束

**Files:**
- Modify: `src/core/ops/clips.ts`
- Test: `src/core/ops/__tests__/move.test.ts`

**Interfaces:**
- Consumes: Task 6 `clips.ts`、Task 4 `internal.ts`
- Produces:
  - `moveClips(doc, clipIds: string[], deltaSec: number, targetTrackId?: string): Project`
  - `constrainAgainst(moving: Clip, stationary: Clip[]): Clip`（内部导出一份便于测试）

**重叠策略（本任务实现的明确规则）**：被拖动片段若与同轨的**未拖动**片段重叠，就顶到阻挡片段的边缘——取「左顶（贴其右缘）」「右顶（贴其左缘）」中位移更小的一侧；若左顶会越过 0，则强制右顶。多选拖动时，被拖片段之间保持相对偏移，只对未拖动片段做约束。

- [ ] **Step 1: 写测试**

`src/core/ops/__tests__/move.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import type { Clip } from "@/types/project";
import { addClip, moveClips } from "@/core/ops/clips";

function clip(start: number, duration: number, trackId: string, assetId = "a1"): Clip {
  return createClip({ assetId, trackId, start, duration });
}

function fixture() {
  const base = newProject();
  const v = base.tracks[0].id;
  const a = base.tracks[1].id;
  const left = clip(0, 2, v, "a1"); // [0,2)
  const mid = clip(3, 2, v, "a2"); // [3,5)
  const right = clip(6, 2, v, "a3"); // [6,8)
  let doc = addClip(base, v, left);
  doc = addClip(doc, v, mid);
  doc = addClip(doc, v, right);
  return { doc, v, a, left, mid, right };
}

function starts(doc: ReturnType<typeof newProject>, trackId: string): number[] {
  const track = doc.tracks.find((t) => t.id === trackId)!;
  return track.clips.map((c) => c.start);
}

describe("moveClips", () => {
  it("translates a clip within its track", () => {
    const { doc, v, mid } = fixture();
    const next = moveClips(doc, [mid.id], 1);
    expect(starts(next, v)).toEqual([0, 4, 6]);
  });

  it("clamps at zero", () => {
    const { doc, v, mid } = fixture();
    const next = moveClips(doc, [mid.id], -99);
    // 无法左移到负时间；会被左邻片段顶住
    expect(starts(next, v)[1]).toBeGreaterThanOrEqual(2);
  });

  it("pushes the dragged clip back against the blocking neighbour", () => {
    const { doc, v, left } = fixture();
    // 把 [0,2) 右移 2.5 → 落点 [2.5,4.5) 与 mid [3,5) 重叠。
    // 左顶到 mid 左缘：start = 3-2 = 1（位移 1.5）；右顶到 mid 右缘：start = 5（位移 2.5）。
    // 取更近的一侧 → start = 1，即最终 [1,3)，停在阻挡片段前。
    const next = moveClips(doc, [left.id], 2.5);
    expect(starts(next, v)).toEqual([1, 3, 6]);
  });

  it("pushes to the left edge when that is closer", () => {
    const { doc, v, right } = fixture();
    // 把 [6,8) 左移 1.5 → [4.5,6.5) 与 [3,5) 重叠；左顶到 5 只需 0.5，右顶到 3 需 1.5
    const next = moveClips(doc, [right.id], -1.5);
    expect(starts(next, v)).toContain(5);
  });

  it("moves clips to another track and stamps trackId", () => {
    const { doc, v, a, mid } = fixture();
    const next = moveClips(doc, [mid.id], 0, a);
    expect(next.tracks.find((t) => t.id === v)!.clips).toHaveLength(2);
    const audioClips = next.tracks.find((t) => t.id === a)!.clips;
    expect(audioClips).toHaveLength(1);
    expect(audioClips[0].trackId).toBe(a);
    expect(audioClips[0].start).toBe(3);
  });

  it("returns the same reference for a zero move with no track change", () => {
    const { doc, mid } = fixture();
    expect(moveClips(doc, [mid.id], 0)).toBe(doc);
  });

  it("returns the same reference for an unknown track id", () => {
    const { doc, mid } = fixture();
    expect(moveClips(doc, [mid.id], 1, "missing")).toBe(doc);
  });

  it("keeps relative offsets when moving a multi-selection", () => {
    const { doc, v, mid, right } = fixture();
    const next = moveClips(doc, [mid.id, right.id], 1);
    const byId = new Map(next.tracks.find((t) => t.id === v)!.clips.map((c) => [c.id, c.start]));
    expect(byId.get(mid.id)! - byId.get(right.id)!).toBe(-3);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/move.test.ts
```

Expected: FAIL —— `moveClips is not a function`。

- [ ] **Step 3: 在 `src/core/ops/clips.ts` 追加实现**

```ts
/**
 * 把被拖动的片段约束到不与 `stationary` 重叠：顶到阻挡片段的边缘。
 * 取位移更小的一侧；左顶会越过 0 时强制右顶。
 */
export function constrainAgainst(moving: Clip, stationary: Clip[]): Clip {
  let start = moving.start;
  const duration = moving.duration;
  for (const other of stationary) {
    const otherEnd = other.start + other.duration;
    const overlaps = start < otherEnd && other.start < start + duration;
    if (!overlaps) continue;
    const rightEdge = otherEnd; // 贴其右缘
    const leftEdge = other.start - duration; // 贴其左缘
    if (leftEdge < 0) {
      start = rightEdge;
      continue;
    }
    start = Math.abs(rightEdge - start) <= Math.abs(leftEdge - start) ? rightEdge : leftEdge;
  }
  return { ...moving, start: Math.max(0, start) };
}

/**
 * 平移（并可跨轨）一组片段。
 * - `deltaSec` 为时间增量；结果 `start ≥ 0`。
 * - 未指定 `targetTrackId` 时保持原轨道。
 * - 对目标轨上的未拖动片段做重叠约束，被拖片段之间保持相对偏移。
 */
export function moveClips(
  doc: Project,
  clipIds: string[],
  deltaSec: number,
  targetTrackId?: string,
): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return doc;
  if (targetTrackId && !doc.tracks.some((t) => t.id === targetTrackId)) return doc;

  const moving: Clip[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) if (ids.has(clip.id)) moving.push(clip);
  }
  if (moving.length === 0) return doc;
  if (deltaSec === 0 && (!targetTrackId || moving.every((c) => c.trackId === targetTrackId))) {
    return doc;
  }

  // 每条轨道上「未拖动」的片段，作为约束参考
  const stationaryByTrack = new Map<string, Clip[]>();
  for (const track of doc.tracks) {
    stationaryByTrack.set(track.id, track.clips.filter((c) => !ids.has(c.id)));
  }

  // 逐轨累积结果，从当前内容里剔除被拖动片段
  const resultByTrack = new Map<string, Clip[]>();
  for (const track of doc.tracks) resultByTrack.set(track.id, [...(stationaryByTrack.get(track.id) ?? [])]);

  const moved = sortClips(
    moving.map((c) => ({ ...c, trackId: targetTrackId ?? c.trackId, start: Math.max(0, c.start + deltaSec) })),
  );

  for (const clip of moved) {
    const list = resultByTrack.get(clip.trackId) ?? [];
    const constrained = constrainAgainst(clip, list);
    resultByTrack.set(clip.trackId, sortClips([...list, constrained]));
  }

  const tracks = doc.tracks.map((track) => {
    const clips = resultByTrack.get(track.id);
    return clips ? { ...track, clips } : track;
  });
  return withTouch(doc, { tracks });
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/move.test.ts
```

Expected: PASS（8 个 it）。

> 若「左顶会越过 0 时强制右顶」导致某个断言不符，先确认测试里的期望值是按本任务的重叠策略手算出来的，而不是照抄实现——策略以本任务 Interfaces 段为准。

- [ ] **Step 5: 提交**

```bash
git add src/core/ops/clips.ts src/core/ops/__tests__/move.test.ts
git commit -m "feat(ops): add clip move with same-track overlap constraint"
```

---

### Task 8: 片段 ops — 裁剪

**Files:**
- Modify: `src/core/ops/clips.ts`
- Test: `src/core/ops/__tests__/trim.test.ts`

**Interfaces:**
- Consumes: Task 6/7 `clips.ts`
- Produces: `trimClip(doc, clipId: string, edge: "start" | "end", newTimeSec: number): Project`

**约束**：`duration ≥ 1 帧`；`in ≥ 0`；`in + duration ≤ asset.duration`（图片素材不限）；不得与同轨左右邻居重叠。

- [ ] **Step 1: 写测试**

`src/core/ops/__tests__/trim.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAsset, createClip, newProject } from "@/core/factory";
import { addAsset } from "@/core/ops/assets";
import { addClip, trimClip } from "@/core/ops/clips";

/** 一个 10 秒素材、单个片段 [2,6)（即 in=1, duration=4）。 */
function fixture(withNeighbours = false) {
  const base = newProject();
  const v = base.tracks[0].id;
  const asset = createAsset({ name: "a.mp4", kind: "video", src: "/a.mp4", duration: 10 });
  const target = createClip({ assetId: asset.id, trackId: v, start: 2, duration: 4, in: 1 });
  let doc = addAsset(base, asset);
  doc = addClip(doc, v, target);
  if (withNeighbours) {
    doc = addClip(doc, v, createClip({ assetId: asset.id, trackId: v, start: 0, duration: 2, in: 0 }));
    doc = addClip(doc, v, createClip({ assetId: asset.id, trackId: v, start: 6, duration: 2, in: 0 }));
  }
  return { doc, v, target: target.id, assetId: asset.id };
}

function clipById(doc: ReturnType<typeof newProject>, id: string) {
  for (const t of doc.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  throw new Error("clip not found");
}

describe("trimClip — start edge", () => {
  it("moves the start later, shortening duration and advancing in-point", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "start", 3);
    const c = clipById(next, target);
    expect(c.start).toBeCloseTo(3);
    expect(c.duration).toBeCloseTo(3);
    expect(c.in).toBeCloseTo(2);
  });

  it("moves the start earlier, limited by the in-point (in >= 0)", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "start", 0.5);
    const c = clipById(next, target);
    expect(c.in).toBeGreaterThanOrEqual(0);
    expect(c.start).toBeCloseTo(1); // 最多回退 in=1 秒
    expect(c.duration).toBeCloseTo(5);
  });

  it("refuses to swallow the previous neighbour", () => {
    const { doc, target } = fixture(true);
    const next = trimClip(doc, target, "start", 0);
    const c = clipById(next, target);
    expect(c.start).toBeGreaterThanOrEqual(2); // 左邻 [0,2) 挡住
    expect(c.start).toBeCloseTo(2);
  });

  it("never shrinks below one frame", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "start", 999);
    const c = clipById(next, target);
    expect(c.duration).toBeCloseTo(1 / 30, 6);
  });
});

describe("trimClip — end edge", () => {
  it("extends the end, limited by the source duration", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "end", 999);
    const c = clipById(next, target);
    expect(c.in + c.duration).toBeCloseTo(10);
  });

  it("shortens the end", () => {
    const { doc, target } = fixture();
    const next = trimClip(doc, target, "end", 4);
    expect(clipById(next, target).duration).toBeCloseTo(2);
  });

  it("refuses to swallow the next neighbour", () => {
    const { doc, target } = fixture(true);
    const next = trimClip(doc, target, "end", 99);
    expect(clipById(next, target).start + clipById(next, target).duration).toBeCloseTo(6);
  });

  it("allows images to extend beyond their (zero) duration", () => {
    const base = newProject();
    const v = base.tracks[0].id;
    const image = createAsset({ name: "p.png", kind: "image", src: "/p.png", duration: 0 });
    const clip = createClip({ assetId: image.id, trackId: v, start: 0, duration: 3 });
    let doc = addAsset(base, image);
    doc = addClip(doc, v, clip);
    const next = trimClip(doc, clip.id, "end", 30);
    expect(clipById(next, clip.id).duration).toBeCloseTo(30);
  });
});

describe("trimClip — no-ops", () => {
  it("returns the same reference when the edge does not move", () => {
    const { doc, target } = fixture();
    expect(trimClip(doc, target, "start", 2)).toBe(doc);
    expect(trimClip(doc, target, "end", 6)).toBe(doc);
  });

  it("returns the same reference for an unknown clip", () => {
    const { doc } = fixture();
    expect(trimClip(doc, "nope", "end", 5)).toBe(doc);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/trim.test.ts
```

Expected: FAIL —— `trimClip is not a function`。

- [ ] **Step 3: 在 `src/core/ops/clips.ts` 追加实现**

```ts
/** 同轨内紧邻 `clip` 的左右边界（未计自己）。 */
function neighbourBounds(track: { clips: Clip[] }, clip: Clip): { prevEnd: number; nextStart: number } {
  let prevEnd = 0;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    if (other.start + other.duration <= clip.start) {
      prevEnd = Math.max(prevEnd, other.start + other.duration);
    } else if (other.start >= clip.start + clip.duration) {
      nextStart = Math.min(nextStart, other.start);
    }
  }
  return { prevEnd, nextStart };
}

/**
 * 裁剪片段的一端。
 * - `edge === "start"`：改 `start`/`in`，出点不动。
 * - `edge === "end"`：改 `duration`，起点与入点不动。
 */
export function trimClip(
  doc: Project,
  clipId: string,
  edge: "start" | "end",
  newTimeSec: number,
): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const { track, clip } = found;
  const asset = doc.assets.find((a) => a.id === clip.assetId);
  const minDuration = 1 / doc.fps;
  const snapped = Math.round(newTimeSec * doc.fps) / doc.fps;
  const { prevEnd, nextStart } = neighbourBounds(track, clip);

  let next: Clip;
  if (edge === "start") {
    // 起点最早不能早于：时间线零点、素材入点回退极限、左邻片段右缘
    const minStart = Math.max(0, prevEnd, clip.start - clip.in);
    const maxStart = clip.start + clip.duration - minDuration;
    const start = clamp(snapped, Math.min(minStart, maxStart), maxStart);
    if (start === clip.start) return doc;
    const delta = start - clip.start;
    next = { ...clip, start, duration: clip.duration - delta, in: clip.in + delta };
  } else {
    const sourceLimit = asset && asset.kind !== "image" ? clip.start + (asset.duration - clip.in) : Infinity;
    const maxEnd = Math.min(sourceLimit, nextStart);
    const minEnd = clip.start + minDuration;
    const end = clamp(snapped, Math.min(minEnd, maxEnd), maxEnd);
    if (end === clip.start + clip.duration) return doc;
    next = { ...clip, duration: end - clip.start };
  }

  return mapTrackClips(doc, track.id, (clips) => clips.map((c) => (c.id === clipId ? next : c)));
}
```

> `clamp(value, min, max)` 在 `min > max` 时返回 `max`（因为实现是 `Math.min(max, Math.max(min, value))`）。上面的调用点已用 `Math.min(...)` 保证 `min ≤ max`。

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/trim.test.ts
```

Expected: PASS（10 个 it）。

- [ ] **Step 5: 提交**

```bash
git add src/core/ops/clips.ts src/core/ops/__tests__/trim.test.ts
git commit -m "feat(ops): add clip trimming with source and neighbour limits"
```

### Task 9: 片段 ops — 分割

**Files:**
- Modify: `src/core/ops/clips.ts`
- Test: `src/core/ops/__tests__/split.test.ts`

**Interfaces:**
- Consumes: Task 4 `internal.ts`
- Produces: `splitClips(doc, clipIds: string[], atSec: number): Project`

**规则**：只在**严格落在片段内部**（`start < atSec < start + duration`）时分割；分割点先 `snapToFrame`。前段 `duration = atSec - start`，后段 `id` 新生成、`start = atSec`、`duration = 原时长 - 前段时长`、`in = 原 in + 前段时长`。

- [ ] **Step 1: 写测试**

`src/core/ops/__tests__/split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip, splitClips } from "@/core/ops/clips";

function fixture() {
  const base = newProject();
  const v = base.tracks[0].id;
  const clip = createClip({ assetId: "a1", trackId: v, start: 1, duration: 4, in: 0.5 });
  const doc = addClip(base, v, clip);
  return { doc, v, clipId: clip.id };
}

describe("splitClips", () => {
  it("splits into two contiguous halves that preserve the source range", () => {
    const { doc, v, clipId } = fixture();
    const next = splitClips(doc, [clipId], 3);
    const clips = next.tracks.find((t) => t.id === v)!.clips;
    expect(clips).toHaveLength(2);

    const [left, right] = clips;
    expect(left.start).toBeCloseTo(1);
    expect(left.duration).toBeCloseTo(2);
    expect(left.in).toBeCloseTo(0.5);
    expect(right.start).toBeCloseTo(3);
    expect(right.duration).toBeCloseTo(2);
    expect(right.in).toBeCloseTo(2.5);
    expect(right.id).not.toBe(left.id);
  });

  it("snaps the split point to the frame grid", () => {
    const { doc, clipId } = fixture();
    const next = splitClips(doc, [clipId], 3.02); // 30fps → 吸附到 3.0333…
    const clips = next.tracks[0].clips;
    expect(clips[0].start + clips[0].duration).toBeCloseTo(3.033333, 5);
    expect(clips[1].start).toBeCloseTo(3.033333, 5);
  });

  it("ignores a split point on or outside the clip boundary", () => {
    const { doc, v, clipId } = fixture();
    expect(splitClips(doc, [clipId], 1)).toBe(doc); // 恰在起点
    expect(splitClips(doc, [clipId], 5)).toBe(doc); // 恰在终点
    expect(splitClips(doc, [clipId], 0)).toBe(doc); // 片段之外
    const after = splitClips(doc, [clipId], 3);
    expect(after.tracks.find((t) => t.id === v)!.clips).toHaveLength(2);
  });

  it("only splits the listed clips", () => {
    const { doc, v, clipId } = fixture();
    const other = createClip({ assetId: "a2", trackId: v, start: 10, duration: 4 });
    const withOther = addClip(doc, v, other);
    const next = splitClips(withOther, [clipId], 3);
    const clips = next.tracks.find((t) => t.id === v)!.clips;
    expect(clips.filter((c) => c.assetId === "a2")).toHaveLength(1);
    expect(clips.filter((c) => c.assetId === "a1")).toHaveLength(2);
  });

  it("returns the same reference for an unknown clip id", () => {
    const { doc } = fixture();
    expect(splitClips(doc, ["nope"], 3)).toBe(doc);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/split.test.ts
```

Expected: FAIL —— `splitClips is not a function`。

- [ ] **Step 3: 在 `src/core/ops/clips.ts` 追加实现**

```ts
/**
 * 在 `atSec` 处分割指定片段（分割点先吸附到帧网格）。
 * 只处理分割点严格落在内部的片段；无命中时返回原 doc。
 */
export function splitClips(doc: Project, clipIds: string[], atSec: number): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return doc;
  const at = Math.round(atSec * doc.fps) / doc.fps;
  let changed = false;

  const tracks = doc.tracks.map((track) => {
    const targets = track.clips.filter(
      (c) => ids.has(c.id) && at > c.start && at < c.start + c.duration,
    );
    if (targets.length === 0) return track;
    const targetIds = new Set(targets.map((c) => c.id));
    changed = true;

    const clips: Clip[] = [];
    for (const clip of track.clips) {
      if (!targetIds.has(clip.id)) {
        clips.push(clip);
        continue;
      }
      const leftDuration = at - clip.start;
      clips.push({ ...clip, duration: leftDuration });
      clips.push({
        ...clip,
        id: crypto.randomUUID(),
        start: at,
        duration: clip.duration - leftDuration,
        in: clip.in + leftDuration,
      });
    }
    return { ...track, clips: sortClips(clips) };
  });

  return changed ? withTouch(doc, { tracks }) : doc;
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/split.test.ts
```

Expected: PASS（5 个 it）。

- [ ] **Step 5: 提交**

```bash
git add src/core/ops/clips.ts src/core/ops/__tests__/split.test.ts
git commit -m "feat(ops): add clip splitting"
```

---

### Task 10: 片段 ops — 文字、增益、不透明度

**Files:**
- Modify: `src/core/ops/clips.ts`
- Test: `src/core/ops/__tests__/clip-props.test.ts`

**Interfaces:**
- Consumes: Task 6 `updateClip`、Task 3 `createClip`
- Produces:
  - `addTextClip(doc, trackId: string, start: number, duration: number, text: string): Project`
  - `setClipText(doc, clipId: string, text: string): Project`
  - `setClipGain(doc, clipId: string, db: number): Project`（夹到 −60..12 dB）
  - `setClipOpacity(doc, clipId: string, value: number): Project`（夹到 0..1）

- [ ] **Step 1: 写测试**

`src/core/ops/__tests__/clip-props.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip, addTextClip, setClipGain, setClipOpacity, setClipText } from "@/core/ops/clips";

function withClip() {
  const base = newProject();
  const v = base.tracks[0].id;
  const clip = createClip({ assetId: "a1", trackId: v, start: 0, duration: 4 });
  return { doc: addClip(base, v, clip), v, id: clip.id };
}

function find(doc: ReturnType<typeof newProject>, id: string) {
  for (const t of doc.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return c;
  }
  throw new Error("not found");
}

describe("addTextClip", () => {
  it("creates a text clip with an empty assetId", () => {
    const base = newProject();
    const textTrack = base.tracks[2].id;
    const next = addTextClip(base, textTrack, 1, 3, "夏天，海边的风");
    const clip = next.tracks[2].clips[0];
    expect(clip.assetId).toBe("");
    expect(clip.text).toBe("夏天，海边的风");
    expect(clip.start).toBe(1);
    expect(clip.duration).toBe(3);
  });

  it("is a no-op for an unknown track", () => {
    const base = newProject();
    expect(addTextClip(base, "missing", 0, 1, "x")).toBe(base);
  });
});

describe("setClipText", () => {
  it("updates the text and is a no-op when unchanged", () => {
    const base = newProject();
    const textTrack = base.tracks[2].id;
    const doc = addTextClip(base, textTrack, 0, 2, "旧");
    const id = doc.tracks[2].clips[0].id;
    const next = setClipText(doc, id, "新");
    expect(find(next, id).text).toBe("新");
    expect(setClipText(next, id, "新")).toBe(next);
  });
});

describe("setClipGain", () => {
  it("stores the value and clamps to the -60..12 dB range", () => {
    const { doc, id } = withClip();
    expect(find(setClipGain(doc, id, -3), id).gain).toBe(-3);
    expect(find(setClipGain(doc, id, 999), id).gain).toBe(12);
    expect(find(setClipGain(doc, id, -999), id).gain).toBe(-60);
  });
});

describe("setClipOpacity", () => {
  it("stores the value and clamps to 0..1", () => {
    const { doc, id } = withClip();
    expect(find(setClipOpacity(doc, id, 0.4), id).opacity).toBeCloseTo(0.4);
    expect(find(setClipOpacity(doc, id, 5), id).opacity).toBe(1);
    expect(find(setClipOpacity(doc, id, -5), id).opacity).toBe(0);
  });

  it("is a no-op when the value is unchanged", () => {
    const { doc, id } = withClip();
    const once = setClipOpacity(doc, id, 0.5);
    expect(setClipOpacity(once, id, 0.5)).toBe(once);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/ops/__tests__/clip-props.test.ts
```

Expected: FAIL —— `setClipGain is not a function`。

- [ ] **Step 3: 在 `src/core/ops/clips.ts` 追加实现**

```ts
export function addTextClip(
  doc: Project,
  trackId: string,
  start: number,
  duration: number,
  text: string,
): Project {
  if (!doc.tracks.some((t) => t.id === trackId)) return doc;
  const clip = createClip({ assetId: "", trackId, start, duration, text });
  return addClip(doc, trackId, clip);
}

export function setClipText(doc: Project, clipId: string, text: string): Project {
  const found = findClip(doc, clipId);
  if (!found || found.clip.text === text) return doc;
  return updateClip(doc, clipId, { text });
}

export function setClipGain(doc: Project, clipId: string, db: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const value = clamp(db, -60, 12);
  if (found.clip.gain === value) return doc;
  return updateClip(doc, clipId, { gain: value });
}

export function setClipOpacity(doc: Project, clipId: string, value: number): Project {
  const found = findClip(doc, clipId);
  if (!found) return doc;
  const opacity = clamp(value, 0, 1);
  if (found.clip.opacity === opacity) return doc;
  return updateClip(doc, clipId, { opacity });
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/ops/__tests__/clip-props.test.ts
```

Expected: PASS（6 个 it）。

- [ ] **Step 5: 跑一遍全部 ops 测试，确认无回归**

```bash
npx vitest run src/core
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/core/ops/clips.ts src/core/ops/__tests__/clip-props.test.ts
git commit -m "feat(ops): add text/gain/opacity clip operations"
```

---

### Task 11: 时间 → 片段映射

**Files:**
- Create: `src/core/playback/activeClips.ts`
- Test: `src/core/playback/__tests__/activeClips.test.ts`

**Interfaces:**
- Consumes: Task 2 类型、Task 3 `createClip`
- Produces:
  - `activeClipsAt(doc, t: number): Map<string, Clip | null>`（键为 trackId）
  - `mainVideoTrack(doc): Track | null`
  - `mainVideoClipAt(doc, t): { track: Track; clip: Clip } | null`
  - `isAudible(doc, track): boolean`
  - `projectDuration(doc): number`

**规则**：片段覆盖 `t` 的判定是 `start ≤ t < start + duration`（左闭右开）。`mainVideoTrack` 取自上而下第一条 `kind === "video"` 且未被静音（若工程里有任一 `solo` 轨道，则只有 solo 轨道算发声）的轨道。

- [ ] **Step 1: 写测试**

`src/core/playback/__tests__/activeClips.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { setTrackFlag } from "@/core/ops/tracks";
import { activeClipsAt, isAudible, mainVideoClipAt, mainVideoTrack, projectDuration } from "@/core/playback/activeClips";

function fixture() {
  const base = newProject();
  const v1 = base.tracks[0].id;
  const a1 = base.tracks[1].id;
  const c1 = createClip({ assetId: "a1", trackId: v1, start: 0, duration: 4 });
  const c2 = createClip({ assetId: "a2", trackId: v1, start: 6, duration: 2 });
  const music = createClip({ assetId: "a3", trackId: a1, start: 1, duration: 10 });
  let doc = addClip(base, v1, c1);
  doc = addClip(doc, v1, c2);
  doc = addClip(doc, a1, music);
  return { doc, v1, a1, c1, c2, music };
}

describe("activeClipsAt", () => {
  it("returns the covering clip per track", () => {
    const { doc, v1, a1, c1 } = fixture();
    const at1 = activeClipsAt(doc, 1);
    expect(at1.get(v1)!.id).toBe(c1.id);
    expect(at1.get(a1)!.assetId).toBe("a3");
  });

  it("treats the interval as half-open [start, start+duration)", () => {
    const { doc, v1, c1, c2 } = fixture();
    expect(activeClipsAt(doc, 0).get(v1)!.id).toBe(c1.id);
    expect(activeClipsAt(doc, 4).get(v1)).toBeNull(); // 恰好是 c1 的终点、c2 之前
    expect(activeClipsAt(doc, 6).get(v1)!.id).toBe(c2.id);
  });

  it("returns null for tracks with nothing under the playhead", () => {
    const { doc } = fixture();
    const map = activeClipsAt(doc, 5);
    expect([...map.values()].every((v) => v === null)).toBe(true);
  });
});

describe("mainVideoTrack", () => {
  it("picks the topmost unmuted video track", () => {
    const { doc, v1 } = fixture();
    expect(mainVideoTrack(doc)!.id).toBe(v1);
  });

  it("skips muted tracks", () => {
    const { doc, v1 } = fixture();
    const muted = setTrackFlag(doc, v1, "muted", true);
    expect(mainVideoTrack(muted)).toBeNull();
  });

  it("honours solo across the project", () => {
    const { doc, v1, a1 } = fixture();
    const soloed = setTrackFlag(doc, a1, "solo", true);
    expect(mainVideoTrack(soloed)).toBeNull(); // 唯一的 video 轨没有 solo
    expect(isAudible(soloed, soloed.tracks[1])).toBe(true);
    expect(isAudible(soloed, soloed.tracks[0])).toBe(false);
    expect(v1).toBe(doc.tracks[0].id);
  });
});

describe("mainVideoClipAt", () => {
  it("returns the covering clip on the main video track", () => {
    const { doc, c1 } = fixture();
    expect(mainVideoClipAt(doc, 2)!.clip.id).toBe(c1.id);
  });

  it("returns null when the main track has no coverage", () => {
    const { doc } = fixture();
    expect(mainVideoClipAt(doc, 5)).toBeNull();
  });
});

describe("projectDuration", () => {
  it("is the maximum clip end across all tracks", () => {
    const { doc } = fixture();
    expect(projectDuration(doc)).toBe(11); // 音频 [1,11)
  });

  it("is zero for an empty project", () => {
    expect(projectDuration(newProject())).toBe(0);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/playback/__tests__/activeClips.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/playback/activeClips'`。

- [ ] **Step 3: 写 `src/core/playback/activeClips.ts`**

```ts
/** 播放查询：给定时间点，找出各轨道上「正在播」的片段。纯函数，供预览与时间线共用。 */
import type { Clip, Project, Track } from "@/types/project";

/** 片段是否覆盖时间点 t：左闭右开 [start, start+duration)。 */
export function covers(clip: Clip, t: number): boolean {
  return t >= clip.start && t < clip.start + clip.duration;
}

/** 每条轨道上覆盖 t 的片段；无则为 null。 */
export function activeClipsAt(doc: Project, t: number): Map<string, Clip | null> {
  const result = new Map<string, Clip | null>();
  for (const track of doc.tracks) {
    result.set(track.id, track.clips.find((clip) => covers(clip, t)) ?? null);
  }
  return result;
}

/** 工程里是否存在 solo 轨道。 */
function anySolo(doc: Project): boolean {
  return doc.tracks.some((t) => t.solo);
}

/** 轨道此刻是否发声（静音规则 + 全局 solo 规则）。 */
export function isAudible(doc: Project, track: Track): boolean {
  if (track.muted) return false;
  return anySolo(doc) ? track.solo : true;
}

/** 主视频轨：自上而下第一条发声的 video 轨。 */
export function mainVideoTrack(doc: Project): Track | null {
  const solo = anySolo(doc);
  return doc.tracks.find((t) => t.kind === "video" && !t.muted && (!solo || t.solo)) ?? null;
}

/** 主视频轨上覆盖 t 的片段。 */
export function mainVideoClipAt(doc: Project, t: number): { track: Track; clip: Clip } | null {
  const track = mainVideoTrack(doc);
  if (!track) return null;
  const clip = track.clips.find((c) => covers(c, t));
  return clip ? { track, clip } : null;
}

/** 工程总时长 = 所有片段结束时间的最大值。 */
export function projectDuration(doc: Project): number {
  let max = 0;
  for (const track of doc.tracks) {
    for (const clip of track.clips) max = Math.max(max, clip.start + clip.duration);
  }
  return max;
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/playback/__tests__/activeClips.test.ts
```

Expected: PASS（10 个 it）。

- [ ] **Step 5: 提交**

```bash
git add src/core/playback/activeClips.ts src/core/playback/__tests__/activeClips.test.ts
git commit -m "feat(playback): add time-to-clip lookup helpers"
```

### Task 12: ffmpeg sidecar 打包与 `probe_media`

**Files:**
- Create: `scripts/fetch-sidecars.sh`
- Create: `src-tauri/binaries/ffmpeg-<triple>`、`src-tauri/binaries/ffprobe-<triple>`（脚本生成，**不入库**）
- Create: `src-tauri/src/sidecar.rs`
- Create: `src-tauri/src/media.rs`（本任务只含 `probe_media` 与 `MediaMeta`）
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces:
  - `sidecar::run_sidecar(app, name, args) -> Result<(Option<i32>, Vec<u8>), String>`
  - `media::MediaMeta { duration: f64, width: Option<u32>, height: Option<u32>, fps: Option<f64>, has_video: bool, has_audio: bool }`
  - Tauri 命令 `probe_media(path: string): MediaMeta`

> **与 spec 的差异（有意）**：spec §12 让 `probe_media` 直接返回 `kind`。实现改为返回 `has_video` / `has_audio` 等事实，**由前端按扩展名判定 `kind`**——ffprobe 对「图片」和「单帧视频」的区分很脆，交给扩展名更可靠。

- [ ] **Step 1: 写取 sidecar 的脚本**

`scripts/fetch-sidecars.sh`：

```bash
#!/usr/bin/env bash
# 把系统 PATH 上的 ffmpeg / ffprobe 拷进 src-tauri/binaries/，并按 Tauri 要求加上 target-triple 后缀。
# 分发前应替换为体积更小的自建 ffmpeg（见计划风险 R3）。
set -euo pipefail

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TRIPLE" ]; then
  echo "无法确定 target triple（rustc 不可用？）" >&2
  exit 1
fi

DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
mkdir -p "$DEST"

for bin in ffmpeg ffprobe; do
  src="$(command -v "$bin" || true)"
  if [ -z "$src" ]; then
    echo "缺少 $bin：请先安装 ffmpeg（macOS: brew install ffmpeg）" >&2
    exit 1
  fi
  cp -L "$src" "$DEST/$bin-$TRIPLE"
  chmod +x "$DEST/$bin-$TRIPLE"
  echo "已放置 $DEST/$bin-$TRIPLE"
done
```

```bash
chmod +x scripts/fetch-sidecars.sh
./scripts/fetch-sidecars.sh
```

Expected: 打印两行「已放置 …/ffmpeg-aarch64-apple-darwin」「已放置 …/ffprobe-aarch64-apple-darwin」。

- [ ] **Step 2: 忽略二进制（体积原因）**

`.gitignore` 追加：

```
# Bundled ffmpeg sidecars (fetched via scripts/fetch-sidecars.sh)
src-tauri/binaries/
```

- [ ] **Step 3: 加依赖**

```bash
pnpm add @tauri-apps/plugin-dialog
cd src-tauri && cargo add tauri-plugin-dialog tauri-plugin-shell
```

- [ ] **Step 4: 声明 externalBin**

`src-tauri/tauri.conf.json` 的 `bundle` 增加：

```json
"externalBin": ["binaries/ffmpeg", "binaries/ffprobe"],
```

完整 `bundle` 段应为：

```json
"bundle": {
  "active": true,
  "targets": "all",
  "externalBin": ["binaries/ffmpeg", "binaries/ffprobe"],
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

- [ ] **Step 5: 写 `src-tauri/src/sidecar.rs`**

```rust
//! 调用打包进来的 ffmpeg / ffprobe sidecar。
//!
//! 一律从 Rust 侧 spawn，不经前端 JS——这样 capabilities 无需开放 shell 执行权限。

use tauri::{AppHandle, Runtime};
use tauri_plugin_shell::ShellExt;

/// 运行 sidecar 并等待结束，返回 `(退出码, stdout 字节)`。
pub async fn run_sidecar<R: Runtime>(
    app: &AppHandle<R>,
    name: &str,
    args: &[String],
) -> Result<(Option<i32>, Vec<u8>), String> {
    let command = app
        .shell()
        .sidecar(name)
        .map_err(|e| format!("sidecar {name} 不可用：{e}"))?;

    let output = command
        .args(args)
        .output()
        .await
        .map_err(|e| format!("执行 {name} 失败：{e}"))?;

    if !output.stderr.is_empty() {
        // 只记日志，不当作失败：ffmpeg 会把正常信息写到 stderr。
        eprintln!("[{name}] {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok((output.status.code(), output.stdout))
}
```

- [ ] **Step 6: 写 `src-tauri/src/media.rs`（仅 probe）**

```rust
//! 媒体探测与派生产物（缩略图 / 波形）。

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::sidecar::run_sidecar;

/// ffprobe 探测结果。`kind` 由前端按扩展名判定。
#[derive(Serialize, Default)]
pub struct MediaMeta {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub has_video: bool,
    pub has_audio: bool,
}

/// 解析 ffprobe 的 `r_frame_rate`（形如 `30/1`）。
fn parse_frame_rate(raw: &str) -> Option<f64> {
    let (num, den) = raw.split_once('/').unwrap_or((raw, "1"));
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

#[tauri::command]
pub async fn probe_media<R: Runtime>(app: AppHandle<R>, path: String) -> Result<MediaMeta, String> {
    let args: Vec<String> = vec![
        "-v".into(),
        "quiet".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        path.clone(),
    ];

    let (code, stdout) = run_sidecar(&app, "ffprobe", &args).await?;
    if code != Some(0) {
        return Err(format!("ffprobe 无法读取：{path}"));
    }

    let json: serde_json::Value =
        serde_json::from_slice(&stdout).map_err(|e| format!("ffprobe 输出解析失败：{e}"))?;
    let streams = json
        .get("streams")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let codec_of = |s: &serde_json::Value| s.get("codec_type").and_then(|c| c.as_str()).unwrap_or("");
    // attached_pic 是封面图，不算真正的视频轨。
    let is_attached_pic = |s: &serde_json::Value| {
        s.get("disposition")
            .and_then(|d| d.get("attached_pic"))
            .and_then(|a| a.as_i64())
            .unwrap_or(0)
            == 1
    };

    let video = streams
        .iter()
        .find(|s| codec_of(s) == "video" && !is_attached_pic(s));

    let mut meta = MediaMeta {
        has_video: video.is_some(),
        has_audio: streams.iter().any(|s| codec_of(s) == "audio"),
        ..Default::default()
    };

    if let Some(v) = video {
        meta.width = v.get("width").and_then(|x| x.as_u64()).map(|x| x as u32);
        meta.height = v.get("height").and_then(|x| x.as_u64()).map(|x| x as u32);
        meta.fps = v
            .get("r_frame_rate")
            .and_then(|x| x.as_str())
            .and_then(parse_frame_rate);
    }

    meta.duration = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    // 单帧图片（无时长）在 ffprobe 里可能给不出 duration：当成 0。
    if !meta.duration.is_finite() {
        meta.duration = 0.0;
    }

    Ok(meta)
}

/// 应用数据目录下的 cache/，用于缩略图与波形缓存。
pub(crate) fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?
        .join("cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
    Ok(dir)
}
```

- [ ] **Step 7: 在 `src-tauri/src/lib.rs` 注册**

在文件顶部的 `#![forbid(unsafe_code)]` 之后加模块声明，并改造 `run()`：

```rust
mod media;
mod project_io;
mod sidecar;
```

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            media::probe_media,
            media::make_thumbnail,
            media::make_waveform,
            project_io::read_project,
            project_io::write_project,
        ])
        .setup(|app| {
            build_main_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

> `project_io` 与后两个 media 命令在 Task 13、Task 14 落地。若想让本任务即可 `cargo check` 通过，先只注册 `media::probe_media`，Task 13/14 再补 `generate_handler!` 的其余项。

- [ ] **Step 8: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 通过（`warning` 可接受）。

- [ ] **Step 9: 提交**

```bash
git add scripts/fetch-sidecars.sh .gitignore src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json src-tauri/src/lib.rs src-tauri/src/sidecar.rs src-tauri/src/media.rs \
        package.json pnpm-lock.yaml
git commit -m "feat(native): bundle ffmpeg/ffprobe as sidecars and add probe_media"
```

---

### Task 13: 缩略图与波形命令

**Files:**
- Modify: `src-tauri/src/media.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Task 12 `run_sidecar`、`cache_dir`
- Produces:
  - `make_thumbnail(path: string, assetId: string, atSec: number): string`（返回缓存文件名，如 `<assetId>.png`）
  - `make_waveform(path: string, assetId: string): number[]`（峰值 0..100，同时写 `<assetId>.wave.json`）

- [ ] **Step 1: 在 `src-tauri/src/media.rs` 追加实现**

```rust
/// 波形分桶数：时间线上片段块约 56 根柱子，取同一个量级即可。
const WAVE_BUCKETS: usize = 64;

#[tauri::command]
pub async fn make_thumbnail<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    asset_id: String,
    at_sec: f64,
) -> Result<String, String> {
    let file = format!("{asset_id}.png");
    let out = cache_dir(&app)?.join(&file);

    let args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        format!("{at_sec}"),
        "-i".into(),
        path,
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=320:-1".into(),
        out.to_string_lossy().to_string(),
    ];

    let (code, _) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) || !out.exists() {
        return Err("生成缩略图失败".into());
    }
    Ok(file)
}

#[tauri::command]
pub async fn make_waveform<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    asset_id: String,
) -> Result<Vec<u8>, String> {
    // 解码成 8kHz 单声道 s16le 走 stdout：数据量小，且不产生临时文件。
    let args: Vec<String> = vec![
        "-v".into(),
        "quiet".into(),
        "-i".into(),
        path,
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "8000".into(),
        "-f".into(),
        "s16le".into(),
        "-".into(),
    ];

    let (code, stdout) = run_sidecar(&app, "ffmpeg", &args).await?;
    if code != Some(0) {
        return Err("提取音频失败".into());
    }

    let peaks = compute_peaks(&stdout, WAVE_BUCKETS);
    if peaks.is_empty() {
        return Err("音频为空".into());
    }

    let cache = cache_dir(&app)?.join(format!("{asset_id}.wave.json"));
    if let Ok(json) = serde_json::to_string(&peaks) {
        let _ = std::fs::write(cache, json);
    }
    Ok(peaks)
}

/// 把 s16le PCM 分桶成 0..100 的峰值。
fn compute_peaks(pcm: &[u8], buckets: usize) -> Vec<u8> {
    if buckets == 0 || pcm.len() < 2 {
        return Vec::new();
    }
    let samples: Vec<i16> = pcm
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    if samples.is_empty() {
        return Vec::new();
    }

    let per_bucket = (samples.len() / buckets).max(1);
    let mut peaks = Vec::with_capacity(buckets);
    let mut start = 0;
    while start < samples.len() && peaks.len() < buckets {
        let end = (start + per_bucket).min(samples.len());
        let peak = samples[start..end]
            .iter()
            .map(|s| s.unsigned_abs() as u32)
            .max()
            .unwrap_or(0);
        let scaled = (f64::from(peak) / 32768.0 * 100.0).round();
        peaks.push(scaled.clamp(0.0, 100.0) as u8);
        start = end;
    }
    peaks
}
```

- [ ] **Step 2: 注册命令**

`src-tauri/src/lib.rs` 的 `generate_handler!` 增加：

```rust
            media::make_thumbnail,
            media::make_waveform,
```

- [ ] **Step 3: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/media.rs src-tauri/src/lib.rs
git commit -m "feat(native): add thumbnail and waveform generation"
```

---

### Task 14: 工程读写命令与 dialog 权限

**Files:**
- Create: `src-tauri/src/project_io.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: 无
- Produces:
  - `read_project(path: string): string`
  - `write_project(path: string, json: string): void`

- [ ] **Step 1: 写 `src-tauri/src/project_io.rs`**

```rust
//! 工程文件的读写。内容就是 JSON 文本，解析与校验放在前端。

use std::path::Path;

#[tauri::command]
pub fn read_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取工程失败：{e}"))
}

#[tauri::command]
pub fn write_project(path: String, json: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&path, json).map_err(|e| format!("写入工程失败：{e}"))
}
```

- [ ] **Step 2: 注册命令与模块**

`src-tauri/src/lib.rs`：

- 模块声明加 `mod project_io;`（Task 12 Step 7 已加，若已存在则跳过）。
- `generate_handler!` 加：

```rust
            project_io::read_project,
            project_io::write_project,
```

- [ ] **Step 3: 开放 dialog 权限**

`src-tauri/capabilities/default.json` 的 `permissions` 数组追加一项：

```json
"dialog:default"
```

改完后完整文件：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "core:window:allow-toggle-maximize",
    "core:window:allow-minimize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "dialog:default"
  ]
}
```

- [ ] **Step 4: 验证编译**

```bash
cd src-tauri && cargo check
```

Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/project_io.rs src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(native): add project read/write commands and dialog permission"
```

### Task 15: 前端媒体层 `src/core/media.ts`

**Files:**
- Create: `src/core/media.ts`
- Test: `src/core/__tests__/media.test.ts`

**Interfaces:**
- Consumes: Task 2 类型、Task 3 `createAsset`、Task 12–14 的 Tauri 命令
- Produces:
  - `kindFromPath(path: string): AssetKind | null`
  - `baseName(path: string): string`
  - `fileUrl(path: string): string`（`convertFileSrc` 封装）
  - `probeMedia(path): Promise<MediaMeta>`、`makeThumbnail(path, assetId, atSec): Promise<string>`、`makeWaveform(path, assetId): Promise<number[]>`
  - `readProjectFile(path): Promise<string>`、`writeProjectFile(path, json): Promise<void>`、`pathExists(path): Promise<boolean>`
  - `pickMediaFiles(): Promise<string[]>`、`pickProjectFile(): Promise<string | null>`、`pickSaveProjectPath(defaultName: string): Promise<string | null>`
  - `importAssetAt(path: string): Promise<MediaAsset>`
  - `recoveryPath(): Promise<string>`、`recoveryRead(): Promise<string | null>`、`recoveryWrite(json: string): Promise<void>`

- [ ] **Step 1: 写纯函数测试**

`src/core/__tests__/media.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { baseName, kindFromPath } from "@/core/media";

describe("kindFromPath", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(kindFromPath("/a/b/clip.MP4")).toBe("video");
    expect(kindFromPath("/a/b/song.wav")).toBe("audio");
    expect(kindFromPath("/a/b/cover.PNG")).toBe("image");
    expect(kindFromPath("/a/b/motion.mov")).toBe("video");
    expect(kindFromPath("/a/b/loop.gif")).toBe("image");
  });

  it("returns null for unsupported extensions", () => {
    expect(kindFromPath("/a/b/notes.txt")).toBeNull();
    expect(kindFromPath("/a/b/noext")).toBeNull();
  });
});

describe("baseName", () => {
  it("handles posix and windows separators", () => {
    expect(baseName("/a/b/c.mp4")).toBe("c.mp4");
    expect(baseName("C:\\videos\\c.mp4")).toBe("c.mp4");
    expect(baseName("c.mp4")).toBe("c.mp4");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/__tests__/media.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/media'`。

- [ ] **Step 3: 写 `src/core/media.ts`**

```ts
/** 前端媒体层：Tauri 命令封装 + webview 可用的文件 URL。 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { AssetKind, MediaAsset } from "@/types/project";

/** `probe_media` 的返回。 */
export interface MediaMeta {
  duration: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_video: boolean;
  has_audio: boolean;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic", "tiff"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg", "wmv", "flv", "ts"]);
const AUDIO_EXTS = new Set(["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif"]);

/** 取路径中的文件名（兼容 `\\` 与 `/`）。 */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/** 按扩展名判定素材类型；不支持的类型返回 null。 */
export function kindFromPath(path: string): AssetKind | null {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

/** 绝对路径 → webview 可直接用于 <video>/<img>/<audio> 的 URL。 */
export function fileUrl(path: string): string {
  return convertFileSrc(path);
}

export function probeMedia(path: string): Promise<MediaMeta> {
  return invoke<MediaMeta>("probe_media", { path });
}

export function makeThumbnail(path: string, assetId: string, atSec: number): Promise<string> {
  return invoke<string>("make_thumbnail", { path, assetId, atSec });
}

export function makeWaveform(path: string, assetId: string): Promise<number[]> {
  return invoke<number[]>("make_waveform", { path, assetId });
}

export function readProjectFile(path: string): Promise<string> {
  return invoke<string>("read_project", { path });
}

export function writeProjectFile(path: string, json: string): Promise<void> {
  return invoke<void>("write_project", { path, json });
}

export function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { path });
}

const MEDIA_FILTER = {
  name: "媒体文件",
  extensions: [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS],
};

/** 原生文件框：选一个或多个素材。取消返回空数组。 */
export async function pickMediaFiles(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: true, filters: [MEDIA_FILTER] });
  if (picked === null) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** 原生文件框：打开工程。取消返回 null。 */
export async function pickProjectFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, filters: [{ name: "AI Cut 工程", extensions: ["json"] }] });
  return typeof picked === "string" ? picked : null;
}

/** 原生文件框：另存为工程路径。取消返回 null。 */
export async function pickSaveProjectPath(defaultName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: `${defaultName}.json`,
    filters: [{ name: "AI Cut 工程", extensions: ["json"] }],
  });
  return picked ?? null;
}

/**
 * 导入一个素材文件：探测元数据、尽力生成缩略图与波形。
 * 缩略图/波形是「尽力而为」——失败不影响素材可用。
 */
export async function importAssetAt(path: string): Promise<MediaAsset> {
  const kind = kindFromPath(path);
  if (!kind) throw new Error(`不支持的文件类型：${baseName(path)}`);

  const meta = await probeMedia(path);
  const name = baseName(path);
  const duration = kind === "image" ? 0 : meta.duration;
  if (kind !== "image" && !(duration > 0)) throw new Error(`无法读取时长：${name}`);

  const id = crypto.randomUUID();
  const asset: MediaAsset = {
    id,
    name,
    kind,
    src: path,
    duration,
    addedAt: Date.now(),
    ...(meta.width !== null ? { width: meta.width } : {}),
    ...(meta.height !== null ? { height: meta.height } : {}),
    ...(meta.fps !== null ? { fps: meta.fps } : {}),
    hasAudio: meta.has_audio,
  };

  const thumbAt = kind === "image" ? 0 : Math.min(1, duration / 2);
  try {
    asset.thumb = await makeThumbnail(path, id, thumbAt);
  } catch {
    /* 缩略图失败：卡片退化为纯色占位 */
  }
  if (meta.has_audio) {
    try {
      asset.wave = await makeWaveform(path, id);
    } catch {
      /* 波形失败：片段块不画波形 */
    }
  }
  return asset;
}

/** 自动保存/恢复草稿的路径（应用数据目录下 recovery/autosave.json）。 */
export async function recoveryPath(): Promise<string> {
  const dir = await join(await appDataDir(), "recovery");
  return join(dir, "autosave.json");
}

/** 读恢复草稿；不存在返回 null。 */
export async function recoveryRead(): Promise<string | null> {
  try {
    return await readProjectFile(await recoveryPath());
  } catch {
    return null;
  }
}

export async function recoveryWrite(json: string): Promise<void> {
  await writeProjectFile(await recoveryPath(), json);
}
```

- [ ] **Step 4: 补 `path_exists` 命令（Rust）**

`src-tauri/src/project_io.rs` 追加：

```rust
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}
```

`src-tauri/src/lib.rs` 的 `generate_handler!` 追加：

```rust
            project_io::path_exists,
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
npx vitest run src/core/__tests__/media.test.ts
```

Expected: PASS（4 个 it）。

> 若报错说 `@tauri-apps/api/core` 或 `@tauri-apps/api/path` 在 node 环境下不可用，在测试文件顶部加一层 mock（这两个包只在调用时读 `window.__TAURI_INTERNALS__`，本用例只测纯函数）：
>
> ```ts
> vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p, invoke: vi.fn() }));
> vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn(), join: vi.fn() }));
> ```
>
> 并把 `vi` 加进 `vitest` 的 import。

- [ ] **Step 6: 验证 Rust 编译**

```bash
cd src-tauri && cargo check
```

Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add src/core/media.ts src/core/__tests__/media.test.ts src-tauri/src/project_io.rs src-tauri/src/lib.rs
git commit -m "feat(core): add frontend media layer over Tauri commands"
```

---

### Task 16: project store（文档 + dispatch + 撤销/重做 + 保存/打开）

**Files:**
- Create: `src/core/ops/project.ts`
- Modify: `src/core/ops/index.ts`
- Create: `src/stores/project.ts`
- Test: `src/core/ops/__tests__/project.test.ts`
- Test: `src/stores/__tests__/project.test.ts`

**Interfaces:**
- Consumes: Task 3 `newProject`/`parseProject`/`serializeProject`、Task 4 `updateAsset`、Task 15 `media.ts`
- Produces:
  - `renameProject(doc: Project, name: string): Project`（`src/core/ops/project.ts`）
  - `useProjectStore()` 暴露：`doc: Ref<Project>`、`dirty: Ref<boolean>`、`filePath: Ref<string | null>`、`canUndo`/`canRedo: ComputedRef<boolean>`、`dispatch(mutate): boolean`、`undo()`、`redo()`、`reset(project, path)`、`newProject(name?)`、`open()`、`openPath(path)`、`save()`、`saveAs()`、`markSaved()`

> **新增文件说明**：`src/core/ops/project.ts` 不在 spec §18 的清单里，是本次实现补充的——工程级属性（名字等）需要一个归属明确的 op 模块。

- [ ] **Step 1: 写 `renameProject` 测试**

`src/core/ops/__tests__/project.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newProject } from "@/core/factory";
import { renameProject } from "@/core/ops/project";

describe("renameProject", () => {
  it("sets the name and bumps updatedAt", () => {
    const doc = newProject("旧名");
    const next = renameProject(doc, "新名");
    expect(next.name).toBe("新名");
    expect(next).not.toBe(doc);
    expect(doc.name).toBe("旧名");
  });

  it("is a no-op for the same name", () => {
    const doc = newProject("同名");
    expect(renameProject(doc, "同名")).toBe(doc);
  });
});
```

- [ ] **Step 2: 写 `src/core/ops/project.ts`**

```ts
/** 工程级 ops：整体属性（目前只有名字）。 */
import type { Project } from "@/types/project";
import { withTouch } from "./internal";

export function renameProject(doc: Project, name: string): Project {
  if (doc.name === name) return doc;
  return withTouch(doc, { name });
}
```

并在 `src/core/ops/index.ts` 追加：

```ts
export * from "./project";
```

- [ ] **Step 3: 写 store 测试**

`src/stores/__tests__/project.test.ts`:

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
import { createClip } from "@/core/factory";
import { addClip } from "@/core/ops/clips";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("dispatch", () => {
  it("applies the mutation, marks dirty and pushes history", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });

    const changed = store.dispatch((doc) => addClip(doc, trackId, clip));

    expect(changed).toBe(true);
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    expect(store.dirty).toBe(true);
    expect(store.canUndo).toBe(true);
  });

  it("ignores a no-op mutation (same reference) and records no history", () => {
    const store = useProjectStore();
    const changed = store.dispatch((doc) => doc);
    expect(changed).toBe(false);
    expect(store.canUndo).toBe(false);
    expect(store.dirty).toBe(false);
  });
});

describe("undo / redo", () => {
  it("round-trips a sequence of edits", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });

    store.dispatch((doc) => addClip(doc, trackId, clip));
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a2", trackId, start: 5, duration: 2 })));
    expect(store.doc.tracks[0].clips).toHaveLength(2);

    store.undo();
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    store.undo();
    expect(store.doc.tracks[0].clips).toHaveLength(0);
    expect(store.canUndo).toBe(false);

    store.redo();
    expect(store.doc.tracks[0].clips).toHaveLength(1);
    store.redo();
    expect(store.doc.tracks[0].clips).toHaveLength(2);
    expect(store.canRedo).toBe(false);
  });

  it("drops the redo stack when a new edit lands after an undo", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 1 })));
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a2", trackId, start: 2, duration: 1 })));
    store.undo();
    expect(store.canRedo).toBe(true);
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a3", trackId, start: 9, duration: 1 })));
    expect(store.canRedo).toBe(false);
  });

  it("caps history at 100 entries", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    for (let i = 0; i < 130; i += 1) {
      const start = i * 2;
      store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: `a${i}`, trackId, start, duration: 1 })));
    }
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(100);
  });
});

describe("reset", () => {
  it("clears history and the dirty flag", () => {
    const store = useProjectStore();
    const trackId = store.doc.tracks[0].id;
    store.dispatch((doc) => addClip(doc, trackId, createClip({ assetId: "a1", trackId, start: 0, duration: 1 })));
    store.reset(store.doc, "/tmp/x.json");
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.filePath).toBe("/tmp/x.json");
  });
});
```

- [ ] **Step 4: 运行，确认失败**

```bash
npx vitest run src/stores/__tests__/project.test.ts src/core/ops/__tests__/project.test.ts
```

Expected: FAIL —— `Cannot find module '@/stores/project'`。

- [ ] **Step 5: 写 `src/stores/project.ts`**

```ts
/**
 * 工程文档 store：唯一写入口是 `dispatch`。
 * 撤销/重做采用文档快照（纯 JSON、体积小、最稳），上限 100 步。
 */
import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { Project } from "@/types/project";
import { newProject as makeProject } from "@/core/factory";
import { parseProject, serializeProject } from "@/core/serialize";
import { updateAsset } from "@/core/ops";
import {
  pathExists,
  pickProjectFile,
  pickSaveProjectPath,
  readProjectFile,
  writeProjectFile,
} from "@/core/media";

/** 快照历史上限。 */
export const HISTORY_LIMIT = 100;

export const useProjectStore = defineStore("project", () => {
  const doc = shallowRef<Project>(makeProject());
  const dirty = ref(false);
  const filePath = ref<string | null>(null);
  const undoStack = shallowRef<Project[]>([]);
  const redoStack = shallowRef<Project[]>([]);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  /**
   * 唯一写入口。`mutate` 返回同一引用即视为无变化（不记历史、不置 dirty）。
   * 返回是否真的发生了修改。
   */
  function dispatch(mutate: (current: Project) => Project): boolean {
    const next = mutate(doc.value);
    if (next === doc.value) return false;

    const stack = undoStack.value.slice();
    stack.push(doc.value);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    undoStack.value = stack;
    redoStack.value = [];
    doc.value = next;
    dirty.value = true;
    return true;
  }

  function undo(): void {
    const stack = undoStack.value.slice();
    const previous = stack.pop();
    if (!previous) return;
    redoStack.value = [...redoStack.value, doc.value];
    undoStack.value = stack;
    doc.value = previous;
    dirty.value = true;
  }

  function redo(): void {
    const stack = redoStack.value.slice();
    const next = stack.pop();
    if (!next) return;
    undoStack.value = [...undoStack.value, doc.value];
    redoStack.value = stack;
    doc.value = next;
    dirty.value = true;
  }

  /** 用一份新文档替换当前工程，并清空历史。 */
  function reset(project: Project, path: string | null): void {
    doc.value = project;
    filePath.value = path;
    dirty.value = false;
    undoStack.value = [];
    redoStack.value = [];
  }

  function newProject(name?: string): void {
    reset(makeProject(name), null);
  }

  function markSaved(path: string): void {
    filePath.value = path;
    dirty.value = false;
  }

  /** 载入时把源文件已缺失的素材标为离线。 */
  async function markOfflineAssets(project: Project): Promise<Project> {
    let next = project;
    for (const asset of project.assets) {
      if (asset.kind === "text") continue;
      const exists = await pathExists(asset.src);
      if (!exists) next = updateAsset(next, asset.id, { offline: true });
    }
    return next;
  }

  async function openPath(path: string): Promise<void> {
    const json = await readProjectFile(path);
    const parsed = parseProject(json);
    reset(await markOfflineAssets(parsed), path);
  }

  /** 打开工程（原生文件框）。取消则什么都不做。 */
  async function open(): Promise<boolean> {
    const path = await pickProjectFile();
    if (!path) return false;
    await openPath(path);
    return true;
  }

  async function save(): Promise<boolean> {
    if (!filePath.value) return saveAs();
    await writeProjectFile(filePath.value, serializeProject(doc.value));
    dirty.value = false;
    return true;
  }

  async function saveAs(): Promise<boolean> {
    const path = await pickSaveProjectPath(doc.value.name);
    if (!path) return false;
    await writeProjectFile(path, serializeProject(doc.value));
    markSaved(path);
    return true;
  }

  return {
    doc,
    dirty,
    filePath,
    canUndo,
    canRedo,
    dispatch,
    undo,
    redo,
    reset,
    newProject,
    markSaved,
    open,
    openPath,
    save,
    saveAs,
  };
});
```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run src/stores/__tests__/project.test.ts src/core/ops/__tests__/project.test.ts
```

Expected: PASS（2 + 5 个 it）。

> 若 `@/core/media` 的 mock 报错，确认 `vi.mock` 工厂列出了 store 用到的全部导出（`readProjectFile`/`writeProjectFile`/`pickProjectFile`/`pickSaveProjectPath`/`pathExists`）。

- [ ] **Step 7: 提交**

```bash
git add src/core/ops/project.ts src/core/ops/index.ts src/stores/project.ts \
        src/core/ops/__tests__/project.test.ts src/stores/__tests__/project.test.ts
git commit -m "feat(store): add project document store with snapshot undo/redo and file IO"
```

---

### Task 17: selection 与 playback stores

**Files:**
- Create: `src/stores/selection.ts`
- Create: `src/stores/playback.ts`
- Test: `src/stores/__tests__/selection.test.ts`

**Interfaces:**
- Consumes: 无（纯状态）
- Produces:
  - `useSelectionStore()`：`selectedClipIds: Ref<string[]>`、`activeTrackId: Ref<string | null>`、`isSelected(id): boolean`、`select(id, additive?)`、`selectMany(ids)`、`toggle(id)`、`clear()`、`setActiveTrack(id)`
  - `usePlaybackStore()`：`playhead: Ref<number>`、`playing: Ref<boolean>`、`zoom: Ref<number>`（px/秒）、`loop: Ref<boolean>`、`setPlayhead(t)`、`setZoom(z)`

> 选中集合用**数组**而非 `Set`：便于 Vue 响应式追踪与快照比较，规模很小（片段数级别）。

- [ ] **Step 1: 写测试**

`src/stores/__tests__/selection.test.ts`:

```ts
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "@/stores/selection";
import { usePlaybackStore } from "@/stores/playback";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("selection", () => {
  it("replaces the selection by default", () => {
    const s = useSelectionStore();
    s.select("a");
    s.select("b");
    expect(s.selectedClipIds).toEqual(["b"]);
    expect(s.isSelected("a")).toBe(false);
    expect(s.isSelected("b")).toBe(true);
  });

  it("adds to the selection when additive", () => {
    const s = useSelectionStore();
    s.select("a");
    s.select("b", true);
    expect(s.selectedClipIds).toEqual(["a", "b"]);
  });

  it("does not duplicate an additive re-select", () => {
    const s = useSelectionStore();
    s.select("a");
    s.select("a", true);
    expect(s.selectedClipIds).toEqual(["a"]);
  });

  it("toggles membership", () => {
    const s = useSelectionStore();
    s.toggle("a");
    expect(s.selectedClipIds).toEqual(["a"]);
    s.toggle("a");
    expect(s.selectedClipIds).toEqual([]);
  });

  it("clears the selection", () => {
    const s = useSelectionStore();
    s.selectMany(["a", "b"]);
    s.clear();
    expect(s.selectedClipIds).toEqual([]);
  });
});

describe("playback", () => {
  it("clamps the playhead to >= 0", () => {
    const p = usePlaybackStore();
    p.setPlayhead(-3);
    expect(p.playhead).toBe(0);
    p.setPlayhead(12.5);
    expect(p.playhead).toBe(12.5);
  });

  it("clamps zoom into a sane range", () => {
    const p = usePlaybackStore();
    p.setZoom(0);
    expect(p.zoom).toBeGreaterThan(0);
    p.setZoom(1e6);
    expect(p.zoom).toBeLessThanOrEqual(400);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/stores/__tests__/selection.test.ts
```

Expected: FAIL —— `Cannot find module '@/stores/selection'`。

- [ ] **Step 3: 写 `src/stores/selection.ts`**

```ts
/** 选中状态：当前选中的片段与「活跃轨道」。 */
import { ref } from "vue";
import { defineStore } from "pinia";

export const useSelectionStore = defineStore("selection", () => {
  const selectedClipIds = ref<string[]>([]);
  const activeTrackId = ref<string | null>(null);

  function isSelected(id: string): boolean {
    return selectedClipIds.value.includes(id);
  }

  /** 选中单个片段；`additive` 为 true 时并入现有选择（⇧ 点击）。 */
  function select(id: string, additive = false): void {
    if (!additive) {
      selectedClipIds.value = [id];
      return;
    }
    if (!selectedClipIds.value.includes(id)) selectedClipIds.value = [...selectedClipIds.value, id];
  }

  function selectMany(ids: string[]): void {
    selectedClipIds.value = [...ids];
  }

  function toggle(id: string): void {
    selectedClipIds.value = selectedClipIds.value.includes(id)
      ? selectedClipIds.value.filter((x) => x !== id)
      : [...selectedClipIds.value, id];
  }

  function clear(): void {
    selectedClipIds.value = [];
  }

  function setActiveTrack(id: string | null): void {
    activeTrackId.value = id;
  }

  return {
    selectedClipIds,
    activeTrackId,
    isSelected,
    select,
    selectMany,
    toggle,
    clear,
    setActiveTrack,
  };
});
```

- [ ] **Step 4: 写 `src/stores/playback.ts`**

```ts
/** 播放状态：播放头、是否播放、时间线缩放。 */
import { ref } from "vue";
import { defineStore } from "pinia";

/** 时间线缩放（px/秒）范围。 */
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 400;
const DEFAULT_ZOOM = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const usePlaybackStore = defineStore("playback", () => {
  const playhead = ref(0);
  const playing = ref(false);
  const zoom = ref(DEFAULT_ZOOM);
  const loop = ref(false);

  function setPlayhead(seconds: number): void {
    playhead.value = Math.max(0, seconds);
  }

  function setZoom(pxPerSecond: number): void {
    zoom.value = clamp(pxPerSecond, MIN_ZOOM, MAX_ZOOM);
  }

  return { playhead, playing, zoom, loop, setPlayhead, setZoom };
});
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run src/stores/__tests__/selection.test.ts
```

Expected: PASS（7 个 it）。

- [ ] **Step 6: 提交**

```bash
git add src/stores/selection.ts src/stores/playback.ts src/stores/__tests__/selection.test.ts
git commit -m "feat(store): add selection and playback stores"
```

### Task 18: Toast 通知

**Files:**
- Create: `src/composables/useToast.ts`
- Create: `src/components/common/Toast.vue`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: 无
- Produces:
  - `toast(message: string, tone?: "info" | "error"): void`
  - `useToastItems(): Ref<ToastItem[]>`，`interface ToastItem { id: string; message: string; tone: "info" | "error" }`

> 组件清单里只写了 `Toast.vue`；这里额外加一个 `composables/useToast.ts` 放模块级队列，组件只负责渲染。

- [ ] **Step 1: 写 `src/composables/useToast.ts`**

```ts
/** 全局 toast 队列：任何地方调用 `toast()` 即可。 */
import { ref, type Ref } from "vue";

export interface ToastItem {
  id: string;
  message: string;
  tone: "info" | "error";
}

const items = ref<ToastItem[]>([]);

/** 显示一条提示；默认 3 秒后自动消失。 */
export function toast(message: string, tone: "info" | "error" = "info"): void {
  const id = crypto.randomUUID();
  items.value = [...items.value, { id, message, tone }];
  window.setTimeout(() => dismiss(id), 3000);
}

export function dismiss(id: string): void {
  items.value = items.value.filter((item) => item.id !== id);
}

export function useToastItems(): Ref<ToastItem[]> {
  return items;
}
```

- [ ] **Step 2: 写 `src/components/common/Toast.vue`**

```vue
<script setup lang="ts">
/** Toast 渲染层：右下角堆叠，MD3 风格。 */
import { dismiss, useToastItems } from "@/composables/useToast";

const items = useToastItems();
</script>

<template>
  <div class="toast-layer" aria-live="polite">
    <transition-group name="toast">
      <button
        v-for="item in items"
        :key="item.id"
        class="toast"
        :class="item.tone"
        @click="dismiss(item.id)"
      >
        {{ item.message }}
      </button>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-layer {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  max-width: 320px;
  padding: 11px 15px;
  border: 0;
  border-radius: 14px;
  text-align: left;
  font-size: 12.5px;
  line-height: 1.45;
  cursor: pointer;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
  box-shadow: var(--md-elevation-3);
}
.toast.error {
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.24s cubic-bezier(0.34, 1.42, 0.5, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}
</style>
```

- [ ] **Step 3: 在 `App.vue` 挂上**

`src/App.vue` 的 `<template>` 改为：

```vue
<template>
  <AppShell />
  <Toast />
</template>
```

并在 `<script setup>` 里加 import：

```ts
import Toast from "@/components/common/Toast.vue";
```

- [ ] **Step 4: 验证类型与构建**

```bash
npx vue-tsc --noEmit -p tsconfig.json
```

Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/composables/useToast.ts src/components/common/Toast.vue src/App.vue
git commit -m "feat(ui): add toast notifications"
```

---

### Task 19: 媒体库接真实数据

**Files:**
- Modify: `src/components/workspace/panes/MediaPane.vue`

**Interfaces:**
- Consumes: Task 16 `useProjectStore`、Task 15 `importAssetAt`/`fileUrl`/`pickMediaFiles`、Task 18 `toast`
- Produces: 媒体库渲染真实素材；`dataTransfer.setData("application/x-ai-cut-asset", asset.id)` 供时间线接收拖入。

- [ ] **Step 1: 重写 `MediaPane.vue` 的 script**

```vue
<script setup lang="ts">
/** 媒体库面板：真实素材列表 + 原生导入 + 拖拽到时间线。 */
import { computed, ref } from "vue";
import {
  MagnifyingGlassIcon,
  PlusIcon,
  FilmIcon,
  MusicalNoteIcon,
  PhotoIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import type { AssetKind, MediaAsset } from "@/types/project";
import { fileUrl, importAssetAt, pickMediaFiles } from "@/core/media";
import { useProjectStore } from "@/stores/project";
import { toast } from "@/composables/useToast";

const project = useProjectStore();

const filters: { id: "all" | AssetKind; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "video", label: "视频" },
  { id: "audio", label: "音频" },
  { id: "image", label: "图片" },
];

const activeFilter = ref<"all" | AssetKind>("all");
const query = ref("");
const importing = ref(false);

const visibleAssets = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return project.doc.assets.filter((asset) => {
    if (activeFilter.value !== "all" && asset.kind !== activeFilter.value) return false;
    if (keyword && !asset.name.toLowerCase().includes(keyword)) return false;
    return true;
  });
});

const kindIcon = { video: FilmIcon, audio: MusicalNoteIcon, image: PhotoIcon };

/** 素材缩略图 / 占位渐变。 */
function thumbStyle(asset: MediaAsset): Record<string, string> {
  if (asset.thumb) return { backgroundImage: `url("${fileUrl(asset.thumb)}")` };
  return { background: "linear-gradient(140deg, #2c1f4d 0%, #7c4a76 45%, #e79a76 100%)" };
}

function durationLabel(asset: MediaAsset): string {
  if (asset.kind === "image") return "—";
  const total = Math.round(asset.duration);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function infoLabel(asset: MediaAsset): string {
  if (asset.kind === "audio") return asset.hasAudio === false ? "无音频流" : "音频";
  if (asset.kind === "image") return asset.width ? `${asset.width} × ${asset.height}` : "图片";
  const size = asset.width && asset.height ? `${asset.width} × ${asset.height}` : "视频";
  return asset.fps ? `${size} · ${Math.round(asset.fps)}fps` : size;
}

async function importMedia(): Promise<void> {
  if (importing.value) return;
  const paths = await pickMediaFiles();
  if (paths.length === 0) return;

  importing.value = true;
  let added = 0;
  for (const path of paths) {
    try {
      const asset = await importAssetAt(path);
      project.dispatch((doc) => addAsset(doc, asset));
      added += 1;
    } catch (error) {
      toast(`导入失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }
  importing.value = false;
  if (added > 0) toast(`已导入 ${added} 个素材`);
}

function onDragStart(event: DragEvent, asset: MediaAsset): void {
  event.dataTransfer?.setData("application/x-ai-cut-asset", asset.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
}
</script>
```

> 注意 import 区要加 `import { addAsset } from "@/core/ops";`（Step 1 的代码块里 `importAssetAt` 之后用到了它），并逐项确认 `noUnusedLocals` 下没有多余 import。

- [ ] **Step 2: 改模板**

把头部计数换成真实统计，删掉硬编码的「6 个素材」：

```vue
<header class="pane-head">
  <div>
    <h2 class="pane-title">媒体库</h2>
    <p class="pane-sub">{{ project.doc.assets.length }} 个素材 · 已同步到项目</p>
  </div>
  <button class="icon-btn" :disabled="importing" aria-label="导入素材" @click="importMedia">
    <PlusIcon class="w-[17px] h-[17px]" />
  </button>
</header>
```

搜索框接 `v-model="query"`：

```vue
<input v-model="query" class="md3-field search-field" placeholder="搜索素材" />
```

网格改为真实素材，并加上拖拽与离线标记：

```vue
<div class="pane-scroll">
  <p v-if="visibleAssets.length === 0" class="empty-hint">
    {{ project.doc.assets.length === 0 ? "还没有素材，点右上角导入" : "没有匹配的素材" }}
  </p>

  <div class="grid">
    <article
      v-for="asset in visibleAssets"
      :key="asset.id"
      class="asset"
      :class="{ offline: asset.offline }"
      draggable="true"
      @dragstart="onDragStart($event, asset)"
    >
      <div class="thumb" :style="thumbStyle(asset)">
        <component :is="kindIcon[asset.kind]" class="thumb-icon" />
        <span class="duration tabular">{{ durationLabel(asset) }}</span>
        <span v-if="asset.offline" class="offline-badge">
          <ExclamationTriangleIcon class="w-3 h-3" />
          离线
        </span>
      </div>
      <div class="asset-text">
        <span class="asset-name">{{ asset.name }}</span>
        <span class="asset-info">{{ infoLabel(asset) }}</span>
      </div>
    </article>
  </div>

  <button class="import" :disabled="importing" @click="importMedia">
    <PlusIcon class="w-4 h-4" />
    {{ importing ? "导入中…" : "导入媒体" }}
  </button>
</div>
```

- [ ] **Step 3: 补样式**

在 `<style scoped>` 追加：

```css
.empty-hint {
  margin: 4px 0 14px;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-muted));
}
.thumb {
  background-size: cover;
  background-position: center;
}
.asset.offline .thumb {
  filter: grayscale(1) brightness(0.7);
}
.offline-badge {
  position: absolute;
  left: 5px;
  bottom: 5px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgb(var(--md-error) / 0.85);
  color: rgb(var(--md-on-error));
  font-size: 9.5px;
  font-weight: 600;
}
```

- [ ] **Step 4: 类型检查**

```bash
npx vue-tsc --noEmit -p tsconfig.json
```

Expected: 通过。若报 `addAsset` 未定义或未使用变量，按 Step 1 的提示修正 import。

- [ ] **Step 5: 提交**

```bash
git add src/components/workspace/panes/MediaPane.vue
git commit -m "feat(ui): wire media library to real assets with import and drag-out"
```

---

### Task 20: 时间线渲染真实文档

**Files:**
- Create: `src/components/workspace/TimelineRuler.vue`
- Create: `src/components/workspace/TrackHeader.vue`
- Create: `src/components/workspace/TimelineClip.vue`
- Modify: `src/components/workspace/TimelinePane.vue`
- Modify: `src/assets/main.css`（新增少量时间线样式，若原本在 TimelinePane 的 scoped 里）

**Interfaces:**
- Consumes: Task 16/17 stores、Task 11 `projectDuration`、Task 15 `fileUrl`
- Produces（供 Task 21–24 使用）:
  - `TimelinePane` 暴露给子组件的方法：`timeFromClientX(clientX: number): number`、`xFromTime(t: number): number`
  - `TimelineClip` props：`{ clip: Clip; asset?: MediaAsset; selected: boolean; pxPerSecond: number }`；emits：`pointerdown(clipId, event: PointerEvent, mode: "move" | "trim-start" | "trim-end")`
  - `TrackHeader` props：`{ track: Track }`；emits：`toggle-flag(trackId, flag)`、`remove(trackId)`、`rename(trackId, name)`
  - `TimelineRuler` props：`{ duration: number; pxPerSecond: number }`；emits：`seek(seconds: number)`

本任务的交付物是**只读的真实渲染**：轨道、片段（真实位置/宽度）、标尺、首帧图与波形。拖拽交互在 Task 22–24。

- [ ] **Step 1: 写 `TimelineClip.vue`**

```vue
<script setup lang="ts">
/** 单个片段块：显示首帧/文字/波形，并提供左右裁剪把手（交互由父层处理）。 */
import { computed } from "vue";
import { DocumentTextIcon } from "@heroicons/vue/24/outline";
import type { Clip, MediaAsset } from "@/types/project";
import { fileUrl } from "@/core/media";

const props = defineProps<{
  clip: Clip;
  asset: MediaAsset | undefined;
  selected: boolean;
  pxPerSecond: number;
}>();

const emit = defineEmits<{
  (e: "grab", payload: { clipId: string; event: PointerEvent; mode: "move" | "trim-start" | "trim-end" }): void;
}>();

const left = computed(() => props.clip.start * props.pxPerSecond);
const width = computed(() => Math.max(2, props.clip.duration * props.pxPerSecond));
const thumbUrl = computed(() =>
  props.asset?.thumb ? fileUrl(props.asset.thumb) : null,
);
const isText = computed(() => props.clip.assetId === "");
const isUnavailable = computed(() => props.asset !== undefined && props.asset.offline === true);
const tone = computed(() => {
  if (isText.value) return "tone-text";
  if (props.asset?.kind === "audio") return "tone-audio";
  if (props.asset?.kind === "image") return "tone-image";
  if (props.asset?.kind === "video") return "tone-primary";
  return "tone-primary";
});
</script>

<template>
  <div
    class="clip"
    :class="[tone, { selected, unavailable: isUnavailable }]"
    :style="{ left: `${left}px`, width: `${width}px` }"
    @pointerdown="emit('grab', { clipId: clip.id, event: $event, mode: 'move' })"
  >
    <img v-if="thumbUrl" class="clip-frame" :src="thumbUrl" alt="" draggable="false" />

    <template v-if="isText">
      <DocumentTextIcon class="clip-kind-icon" />
      <span class="clip-text">{{ clip.text }}</span>
    </template>
    <span v-else class="clip-name">{{ asset?.name ?? "（缺失素材）" }}</span>

    <div v-if="asset?.wave?.length" class="wave">
      <span v-for="(h, i) in asset.wave" :key="i" :style="{ height: `${h}%` }" />
    </div>

    <span
      class="handle handle-start"
      @pointerdown.stop="emit('grab', { clipId: clip.id, event: $event, mode: 'trim-start' })"
    />
    <span
      class="handle handle-end"
      @pointerdown.stop="emit('grab', { clipId: clip.id, event: $event, mode: 'trim-end' })"
    />
  </div>
</template>

<style scoped>
.clip {
  position: absolute;
  top: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border-radius: 9px;
  overflow: hidden;
  cursor: grab;
  border: 1px solid transparent;
  user-select: none;
}
.clip.selected {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: -1px;
}
.clip.unavailable {
  background-image: repeating-linear-gradient(
    45deg,
    rgb(var(--md-error) / 0.18) 0 6px,
    transparent 6px 12px
  );
}
.tone-primary {
  background-color: rgb(var(--md-primary-container));
  color: rgb(var(--md-on-primary-container));
  border-color: rgb(var(--md-primary) / 0.28);
}
.tone-audio {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  border-color: rgb(var(--md-secondary) / 0.28);
}
.tone-image {
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  border-color: rgb(var(--md-outline-variant) / 0.55);
}
.tone-text {
  background-color: rgb(var(--md-tertiary-container) / 0.92);
  color: rgb(var(--md-on-tertiary-container));
  border-color: rgb(var(--md-tertiary) / 0.32);
}
.clip-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.95;
  pointer-events: none;
}
.clip-kind-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  opacity: 0.75;
}
.clip-text,
.clip-name {
  position: relative;
  z-index: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.clip-name {
  text-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  color: rgb(255 255 255 / 0.95);
}
.tone-audio .clip-name,
.tone-text .clip-text {
  color: inherit;
  text-shadow: none;
}
.wave {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 50%;
  bottom: 4px;
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0.5;
  pointer-events: none;
}
.wave span {
  flex: 1;
  min-width: 1px;
  border-radius: 1px;
  background-color: currentColor;
}
.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  background: transparent;
}
.handle-start {
  left: 0;
}
.handle-end {
  right: 0;
}
.clip:hover .handle {
  background: rgb(var(--md-primary) / 0.45);
}
</style>
```

- [ ] **Step 2: 写 `TrackHeader.vue`**

```vue
<script setup lang="ts">
/** 轨道头：名称 + 静音/独奏/锁定 + 删除。双击改名。 */
import { ref } from "vue";
import { TrashIcon, FilmIcon, MusicalNoteIcon, DocumentTextIcon } from "@heroicons/vue/24/outline";
import type { Track } from "@/types/project";

const props = defineProps<{ track: Track }>();
const emit = defineEmits<{
  (e: "toggle-flag", trackId: string, flag: "muted" | "solo" | "locked"): void;
  (e: "remove", trackId: string): void;
  (e: "rename", trackId: string, name: string): void;
}>();

const editing = ref(false);
const draft = ref("");

const ICONS = { video: FilmIcon, audio: MusicalNoteIcon, text: DocumentTextIcon };

function startEdit(): void {
  draft.value = props.track.name;
  editing.value = true;
}

function commit(): void {
  editing.value = false;
  const name = draft.value.trim();
  if (name && name !== props.track.name) emit("rename", props.track.id, name);
}
</script>

<template>
  <div class="track-head">
    <div class="th-main">
      <component :is="ICONS[track.kind]" class="th-icon" />
      <input
        v-if="editing"
        v-model="draft"
        class="th-input"
        @blur="commit"
        @keydown.enter.prevent="commit"
        @keydown.escape.prevent="editing = false"
        v-focus
      />
      <span v-else class="th-name" @dblclick="startEdit">{{ track.name }}</span>
    </div>
    <div class="th-btns">
      <button
        class="th-btn"
        :class="{ on: track.muted }"
        :aria-pressed="track.muted"
        :aria-label="`${track.name} 静音`"
        @click="emit('toggle-flag', track.id, 'muted')"
      >
        M
      </button>
      <button
        class="th-btn"
        :class="{ on: track.solo }"
        :aria-pressed="track.solo"
        :aria-label="`${track.name} 独奏`"
        @click="emit('toggle-flag', track.id, 'solo')"
      >
        S
      </button>
      <button
        class="th-btn"
        :class="{ on: track.locked }"
        :aria-pressed="track.locked"
        :aria-label="`${track.name} 锁定`"
        @click="emit('toggle-flag', track.id, 'locked')"
      >
        L
      </button>
      <button class="th-btn danger" :aria-label="`删除${track.name}`" @click="emit('remove', track.id)">
        <TrashIcon class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.track-head {
  height: 54px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.th-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.th-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-muted));
}
.th-name {
  font-size: 11.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.th-input {
  width: 92px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid rgb(var(--md-primary) / 0.7);
  border-radius: 6px;
  background: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  outline: none;
}
.th-btns {
  display: flex;
  gap: 3px;
  flex: 0 0 auto;
}
.th-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-muted));
  font-size: 9.5px;
  font-weight: 700;
  cursor: pointer;
}
.th-btn.on {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.th-btn.danger:hover {
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}
</style>
```

`v-focus` 指令需要注册。在 `TimelinePane.vue` 里不要用它；改用 `TrackHeader` 内联一个局部指令：

```ts
const vFocus = {
  mounted: (el: HTMLElement) => el.focus(),
};
```

（`<script setup>` 中局部自定义指令名以 `v` 开头即可使用 `v-focus`。）

- [ ] **Step 3: 写 `TimelineRuler.vue`**

```vue
<script setup lang="ts">
/** 时间线标尺：按缩放生成刻度，点击/拖动定位播放头。 */
import { computed } from "vue";
import { formatTimecode } from "@/core/time";

const props = defineProps<{ duration: number; pxPerSecond: number }>();
const emit = defineEmits<{ (e: "seek", seconds: number): void }>();

/** 刻度间隔：随缩放自适应，取 1/2/5/10/30/60 秒里最合适的一档。 */
const step = computed(() => {
  const targetPx = 72;
  const candidates = [0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  return candidates.find((s) => s * props.pxPerSecond >= targetPx) ?? 600;
});

const ticks = computed(() => {
  const count = Math.ceil(props.duration / step.value) + 1;
  return Array.from({ length: count }, (_, i) => {
    const seconds = i * step.value;
    return { seconds, x: seconds * props.pxPerSecond, label: formatTimecode(seconds, 30) };
  });
});

function seekFromEvent(event: PointerEvent): void {
  const host = event.currentTarget as HTMLElement;
  const x = event.clientX - host.getBoundingClientRect().left;
  emit("seek", Math.max(0, x / props.pxPerSecond));
}
</script>

<template>
  <div class="ruler" @pointerdown="seekFromEvent" @pointermove="($event.buttons & 1) === 1 && seekFromEvent($event)">
    <div v-for="tick in ticks" :key="tick.seconds" class="tick" :style="{ left: `${tick.x}px` }">
      <span class="tick-label tabular">{{ tick.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.ruler {
  position: relative;
  height: 28px;
  flex: 0 0 auto;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.35);
  background-color: rgb(var(--md-surface-container-low) / 0.5);
  cursor: pointer;
  user-select: none;
  touch-action: none;
}
.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: rgb(var(--md-outline) / 0.4);
}
.tick-label {
  position: absolute;
  top: 5px;
  left: 3px;
  font-size: 9.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface-muted));
  white-space: nowrap;
}
</style>
```

> 标尺标签里的 `formatTimecode(seconds, 30)` 硬编码 30fps——刻度是秒级的，帧位恒为 `00`。若想跟随工程帧率，把 `30` 换成 `project.doc.fps` 并通过 prop 传入。

- [ ] **Step 4: 重写 `TimelinePane.vue`**

```vue
<script setup lang="ts">
/** 时间线：标尺 + 轨道头 + 片段车道 + 播放头。数据来自 project store。 */
import { computed, ref } from "vue";
import {
  CursorArrowRaysIcon,
  ScissorsIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from "@heroicons/vue/24/outline";
import TimelineRuler from "./TimelineRuler.vue";
import TrackHeader from "./TrackHeader.vue";
import TimelineClip from "./TimelineClip.vue";
import { useProjectStore } from "@/stores/project";
import { MAX_ZOOM, MIN_ZOOM, usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { projectDuration } from "@/core/playback/activeClips";
import { formatTimecode } from "@/core/time";
import type { MediaAsset, Project } from "@/types/project";

const project = useProjectStore();
const playback = usePlaybackStore();
const selection = useSelectionStore();

/** 横向滚动容器：缩放锚点与滚动位置都以它为准。 */
const scrollEl = ref<HTMLElement | null>(null);

/**
 * 拖拽期间的临时文档。非空时时间线渲染它而非真实文档——
 * 这样预览用的是与提交完全相同的 ops，所见即所得。
 */
const draft = ref<Project | null>(null);
/** 渲染用文档。 */
const shownDoc = computed(() => draft.value ?? project.doc);

/** 时间线可视总时长：至少留 30 秒空白，方便往后拖。 */
const duration = computed(() => Math.max(30, projectDuration(shownDoc.value) + 10));
const contentWidth = computed(() => duration.value * playback.zoom);

const playheadX = computed(() => playback.playhead * playback.zoom);

function assetOf(assetId: string): MediaAsset | undefined {
  return shownDoc.value.assets.find((a) => a.id === assetId);
}

/** 播放头位置的时间码。 */
const playheadLabel = computed(() => formatTimecode(playback.playhead, project.doc.fps));

/** 缩放滑杆值：把对数刻度映射回 0..100。 */
const zoomSlider = computed(
  () => (Math.log(playback.zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)) * 100,
);

function zoomBy(factor: number): void {
  playback.setZoom(playback.zoom * factor);
}

function onZoomInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  // 滑杆 0..100 映射到对数刻度，低倍率也有足够行程。
  playback.setZoom(MIN_ZOOM * (MAX_ZOOM / MIN_ZOOM) ** (value / 100));
}
</script>
```

模板：

```vue
<template>
  <section class="timeline">
    <header class="tl-head">
      <span class="tl-title">时间线</span>
      <div class="tl-tools">
        <button class="icon-btn on" aria-label="选择工具">
          <CursorArrowRaysIcon class="w-[16px] h-[16px]" />
        </button>
        <button class="icon-btn" aria-label="切割工具">
          <ScissorsIcon class="w-[16px] h-[16px]" />
        </button>
      </div>
      <div class="tl-spacer" />
      <span class="tl-time tabular">{{ playheadLabel }}</span>
      <div class="zoom">
        <button class="icon-btn" aria-label="缩小" @click="zoomBy(1 / 1.4)">
          <MagnifyingGlassMinusIcon class="w-[16px] h-[16px]" />
        </button>
        <input
          class="md3-range zoom-range"
          type="range"
          min="0"
          max="100"
          :value="zoomSlider"
          aria-label="时间线缩放"
          @input="onZoomInput"
        />
        <button class="icon-btn" aria-label="放大" @click="zoomBy(1.4)">
          <MagnifyingGlassPlusIcon class="w-[16px] h-[16px]" />
        </button>
      </div>
    </header>

    <div class="tl-body">
      <div class="headers">
        <div class="corner"><span>轨道</span></div>
        <TrackHeader
          v-for="track in shownDoc.tracks"
          :key="track.id"
          :track="track"
        />
      </div>

      <div ref="scrollEl" class="scroll">
        <div class="content" :style="{ width: `${contentWidth}px` }">
          <TimelineRuler
            :duration="duration"
            :px-per-second="playback.zoom"
            @seek="playback.setPlayhead"
          />

          <div class="lanes">
            <div v-for="track in shownDoc.tracks" :key="track.id" class="lane">
              <TimelineClip
                v-for="clip in track.clips"
                :key="clip.id"
                :clip="clip"
                :asset="assetOf(clip.assetId)"
                :selected="selection.isSelected(clip.id)"
                :px-per-second="playback.zoom"
              />
            </div>
          </div>

          <div class="playhead" :style="{ left: `${playheadX}px` }">
            <span class="ph-cap" />
            <span class="ph-line" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
```

样式：把原 `TimelinePane.vue` 里 `.timeline` / `.tl-*` / `.headers` / `.corner` / `.scroll` / `.lane` / `.playhead` 的规则保留，并新增：

```css
.scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.content {
  position: relative;
  min-height: 100%;
}
.lane {
  position: relative;
  height: 54px;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.lane:nth-child(odd) {
  background-color: rgb(var(--md-surface-container-low) / 0.35);
}
```

- [ ] **Step 5: 手动验证**

```bash
pnpm tauri dev
```

Expected：应用启动后时间线显示**三条空轨道**（视频 1 / 音频 1 / 文字 1），标尺刻度随缩放滑杆变化；媒体库还是空的。

> 本环境里 `pnpm install` 可能被沙箱拒绝（见 `.workbuddy-ai/memory/2026-10-19.md`）。若 `pnpm tauri dev` 因依赖校验失败，改用 `pnpm --config.verify-deps-before-run=none tauri dev`。

- [ ] **Step 6: 提交**

```bash
git add src/components/workspace/TimelineRuler.vue src/components/workspace/TrackHeader.vue \
        src/components/workspace/TimelineClip.vue src/components/workspace/TimelinePane.vue \
        src/assets/main.css
git commit -m "feat(ui): render timeline from the real project document"
```

---

### Task 21: 播放头定位与 ⌘滚轮缩放

**Files:**
- Modify: `src/components/workspace/TimelinePane.vue`

**Interfaces:**
- Consumes: Task 20 的 `TimelinePane`
- Produces: `onWheelZoom(event)`（⌘/Ctrl + 滚轮以光标为锚点缩放）

- [ ] **Step 1: 在 script 增加锚点缩放**

```ts
/** ⌘/Ctrl + 滚轮：以光标处为锚点缩放，光标下的时间保持不动。 */
function onWheelZoom(event: WheelEvent): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  event.preventDefault();
  const host = scrollEl.value;
  if (!host) return;

  const rect = host.getBoundingClientRect();
  const x = event.clientX - rect.left + host.scrollLeft;
  const anchorSeconds = x / playback.zoom;

  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  playback.setZoom(playback.zoom * factor);

  // 缩放后把同一时间点挪回光标下
  const after = host.getBoundingClientRect();
  const cursorX = event.clientX - after.left;
  host.scrollLeft = anchorSeconds * playback.zoom - cursorX;
}
```

- [ ] **Step 2: 在 `.scroll` 上挂监听**

```vue
<div class="scroll" @wheel="onWheelZoom">
```

注意：`@wheel` 默认是冒泡阶段且非 passive（Vue 会按需 `preventDefault`），无需额外配置。

- [ ] **Step 3: 手动验证**

```bash
pnpm tauri dev
```

Expected：按住 ⌘ 滚轮时时间线以光标位置为锚点缩放；未按 ⌘ 时滚轮正常滚动。

- [ ] **Step 4: 提交**

```bash
git add src/components/workspace/TimelinePane.vue
git commit -m "feat(ui): add anchored cmd-scroll timeline zoom"
```

### Task 22: 吸附工具与片段拖拽（移动 / 裁剪）

**Files:**
- Create: `src/core/snapping.ts`
- Test: `src/core/__tests__/snapping.test.ts`
- Modify: `src/components/workspace/TimelinePane.vue`

**Interfaces:**
- Consumes: Task 7 `moveClips`、Task 8 `trimClip`、Task 11 `projectDuration`、Task 17 stores、Task 2 `snapToFrame`
- Produces:
  - `snapTargets(doc, excludeClipIds: Set<string>, playhead: number): number[]`
  - `snapMove(doc, movingIds: Set<string>, rawDelta: number, thresholdSec: number, playhead: number): { delta: number; guide: number | null }`
  - `snapEdge(doc, clipId: string, rawTime: number, thresholdSec: number, playhead: number): { time: number; guide: number | null }`
  - `TimelinePane` 内部：`onClipGrab(payload)`、`onDragMove`、`onDragEnd`

**关键设计**：拖拽期间**不改真实文档**，只把 `moveClips`/`trimClip` 的结果放进 `draft`（Task 20 已定义）用作预览；`pointerup` 时用**同一个 op** 提交一次。因此预览必然等于结果，且一次拖拽只产生**一步**历史。

- [ ] **Step 1: 写吸附测试**

`src/core/__tests__/snapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { snapEdge, snapMove, snapTargets } from "@/core/snapping";

function fixture() {
  const base = newProject();
  const v = base.tracks[0].id;
  const anchor = createClip({ assetId: "a1", trackId: v, start: 10, duration: 4 }); // 边：10 / 14
  const moving = createClip({ assetId: "a2", trackId: v, start: 0, duration: 2 });
  let doc = addClip(base, v, anchor);
  doc = addClip(doc, v, moving);
  return { doc, anchor, moving, playhead: 20 };
}

describe("snapTargets", () => {
  it("collects zero, the playhead and every non-moving clip edge", () => {
    const { doc, moving, playhead } = fixture();
    const targets = snapTargets(doc, new Set([moving.id]), playhead);
    expect(targets).toContain(0);
    expect(targets).toContain(playhead);
    expect(targets).toContain(10);
    expect(targets).toContain(14);
    expect(targets).not.toContain(0 + 2); // 被拖动片段的终点不算候选
  });
});

describe("snapMove", () => {
  it("snaps the group's start onto a nearby clip edge", () => {
    const { doc, moving, playhead } = fixture();
    // 想移动到 9.9 → 距锚点起点 10 只有 0.1，阈值内应吸附
    const result = snapMove(doc, new Set([moving.id]), 9.9, 0.3, playhead);
    expect(result.delta).toBeCloseTo(10);
    expect(result.guide).toBe(10);
  });

  it("snaps the group's end onto a nearby edge", () => {
    const { doc, moving, playhead } = fixture();
    // 位移 8 → 片段变 [8,10)，终点正好贴锚点起点 10
    const result = snapMove(doc, new Set([moving.id]), 8.04, 0.3, playhead);
    expect(result.delta).toBeCloseTo(8);
  });

  it("leaves the delta untouched outside the threshold", () => {
    const { doc, moving, playhead } = fixture();
    const result = snapMove(doc, new Set([moving.id]), 5, 0.3, playhead);
    expect(result.delta).toBeCloseTo(5);
    expect(result.guide).toBeNull();
  });

  it("returns the raw delta when nothing is moving", () => {
    const { doc, playhead } = fixture();
    expect(snapMove(doc, new Set(), 3, 0.3, playhead)).toEqual({ delta: 3, guide: null });
  });
});

describe("snapEdge", () => {
  it("snaps a trim edge onto a neighbour's edge", () => {
    const { doc, moving, playhead } = fixture();
    const result = snapEdge(doc, moving.id, 9.95, 0.3, playhead);
    expect(result.time).toBeCloseTo(10);
    expect(result.guide).toBe(10);
  });

  it("excludes the clip being trimmed from the candidates", () => {
    const { doc, moving, playhead } = fixture();
    // 被裁剪片段自己的起点是 0，但不应把自己吸回去
    const result = snapEdge(doc, moving.id, 0.05, 0.3, playhead);
    expect(result.guide).not.toBe(0);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/__tests__/snapping.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/snapping'`。

- [ ] **Step 3: 写 `src/core/snapping.ts`**

```ts
/** 时间线吸附：拖拽时把片段的边对齐到候选点。纯函数，便于单测。 */
import type { Clip, Project } from "@/types/project";

/** 收集吸附候选点：零点、播放头，以及其他片段的起止时间。 */
export function snapTargets(
  doc: Project,
  excludeClipIds: Set<string>,
  playhead: number,
): number[] {
  const targets = new Set<number>([0, playhead]);
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (excludeClipIds.has(clip.id)) continue;
      targets.add(clip.start);
      targets.add(clip.start + clip.duration);
    }
  }
  return [...targets];
}

export interface SnapMoveResult {
  delta: number;
  guide: number | null;
}

/** 为一组正在拖动的片段求吸附后的位移：在阈值内取位移最小的候选边。 */
export function snapMove(
  doc: Project,
  movingIds: Set<string>,
  rawDelta: number,
  thresholdSec: number,
  playhead: number,
): SnapMoveResult {
  const moving: Clip[] = [];
  for (const track of doc.tracks) {
    for (const clip of track.clips) if (movingIds.has(clip.id)) moving.push(clip);
  }
  if (moving.length === 0) return { delta: rawDelta, guide: null };

  const start = Math.min(...moving.map((c) => c.start + rawDelta));
  const end = Math.max(...moving.map((c) => c.start + c.duration + rawDelta));
  const targets = snapTargets(doc, movingIds, playhead);

  let best: SnapMoveResult = { delta: rawDelta, guide: null };
  let bestDistance = thresholdSec;
  for (const target of targets) {
    for (const edge of [start, end]) {
      const distance = Math.abs(target - edge);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { delta: rawDelta + (target - edge), guide: target };
      }
    }
  }
  return best;
}

export interface SnapEdgeResult {
  time: number;
  guide: number | null;
}

/** 裁剪时把新的边缘时间吸附到候选点。 */
export function snapEdge(
  doc: Project,
  clipId: string,
  rawTime: number,
  thresholdSec: number,
  playhead: number,
): SnapEdgeResult {
  const targets = snapTargets(doc, new Set([clipId]), playhead);
  let best: SnapEdgeResult = { time: rawTime, guide: null };
  let bestDistance = thresholdSec;
  for (const target of targets) {
    const distance = Math.abs(target - rawTime);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { time: target, guide: target };
    }
  }
  return best;
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/__tests__/snapping.test.ts
```

Expected: PASS（8 个 it）。

- [ ] **Step 5: 在 `TimelinePane.vue` 增加拖拽处理**

在 script 追加（顶部 import 补 `moveClips, trimClip` 自 `@/core/ops`，`onBeforeUnmount`、`snapToFrame` 自 `@/core/time`，`snapEdge, snapMove` 自 `@/core/snapping`）：

```ts
/** 吸附阈值（屏幕像素）。 */
const SNAP_THRESHOLD_PX = 6;
/** 轨道行高，需与 CSS 的 .lane 高度一致。 */
const LANE_HEIGHT = 54;

interface DragState {
  mode: "move" | "trim-start" | "trim-end";
  clipId: string;
  movingIds: string[];
  clientX0: number;
  originDoc: Project;
  targetTrackId: string | null;
  delta: number;
  edgeTime: number;
  guide: number | null;
}

const drag = ref<DragState | null>(null);

/** 指针 X → 时间线时间（秒）。 */
function timeFromClientX(clientX: number): number {
  const host = scrollEl.value;
  if (!host) return 0;
  const rect = host.getBoundingClientRect();
  return Math.max(0, (clientX - rect.left + host.scrollLeft) / playback.zoom);
}

/** 指针 Y → 命中的轨道 id。 */
function trackIdFromClientY(clientY: number): string | null {
  const lanes = scrollEl.value?.querySelector<HTMLElement>(".lanes");
  if (!lanes) return null;
  const rect = lanes.getBoundingClientRect();
  const index = Math.floor((clientY - rect.top) / LANE_HEIGHT);
  return shownDoc.value.tracks[index]?.id ?? null;
}

function onClipGrab(payload: {
  clipId: string;
  event: PointerEvent;
  mode: "move" | "trim-start" | "trim-end";
}): void {
  const { clipId, event, mode } = payload;
  if (event.button !== 0) return;

  const track = shownDoc.value.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!track || track.locked) return;

  // 未选中 → 单击选中；已选中且按 ⇧ → 切换；否则保持现有多选（便于整体拖动）
  if (!selection.isSelected(clipId)) selection.select(clipId, event.shiftKey);
  else if (event.shiftKey) selection.toggle(clipId);

  const movingIds =
    mode === "move" && selection.isSelected(clipId) ? [...selection.selectedClipIds] : [clipId];

  const moving = shownDoc.value.tracks
    .flatMap((t) => t.clips)
    .filter((c) => movingIds.includes(c.id));
  const edgeTime = mode === "trim-start" ? moving[0].start : moving[0].start + moving[0].duration;

  drag.value = {
    mode,
    clipId,
    movingIds,
    clientX0: event.clientX,
    originDoc: project.doc,
    targetTrackId: track.id,
    delta: 0,
    edgeTime,
    guide: null,
  };
  draft.value = project.doc;

  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd, { once: true });
  event.preventDefault();
}

function onDragMove(event: PointerEvent): void {
  const state = drag.value;
  if (!state) return;
  const thresholdSec = SNAP_THRESHOLD_PX / playback.zoom;
  const fps = state.originDoc.fps;

  if (state.mode === "move") {
    const rawDelta = (event.clientX - state.clientX0) / playback.zoom;
    const snapped = snapMove(state.originDoc, new Set(state.movingIds), rawDelta, thresholdSec, playback.playhead);
    // 落点统一吸附到帧网格
    state.delta = snapToFrame(snapped.delta, fps);
    state.guide = snapped.guide;
    state.targetTrackId = trackIdFromClientY(event.clientY) ?? state.targetTrackId;
    draft.value = moveClips(
      state.originDoc,
      state.movingIds,
      state.delta,
      state.targetTrackId ?? undefined,
    );
    return;
  }

  const rawTime = timeFromClientX(event.clientX);
  const snapped = snapEdge(state.originDoc, state.clipId, rawTime, thresholdSec, playback.playhead);
  state.guide = snapped.guide;
  state.edgeTime = snapToFrame(snapped.time, fps);
  draft.value = trimClip(
    state.originDoc,
    state.clipId,
    state.mode === "trim-start" ? "start" : "end",
    state.edgeTime,
  );
}

function onDragEnd(): void {
  const state = drag.value;
  drag.value = null;
  draft.value = null;
  window.removeEventListener("pointermove", onDragMove);
  if (!state) return;

  // 用与预览完全相同的 op 提交一次 → 一步历史
  project.dispatch((doc) =>
    state.mode === "move"
      ? moveClips(doc, state.movingIds, state.delta, state.targetTrackId ?? undefined)
      : trimClip(doc, state.clipId, state.mode === "trim-start" ? "start" : "end", state.edgeTime),
  );
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onDragMove);
});
```

- [ ] **Step 6: 模板接线**

`TimelineClip` 加监听：

```vue
<TimelineClip
  v-for="clip in track.clips"
  :key="clip.id"
  :clip="clip"
  :asset="assetOf(clip.assetId)"
  :selected="selection.isSelected(clip.id)"
  :px-per-second="playback.zoom"
  @grab="onClipGrab"
/>
```

播放头层后追加吸附参考线：

```vue
<div v-if="drag?.guide !== null && drag?.guide !== undefined" class="snap-guide" :style="{ left: `${drag.guide * playback.zoom}px` }" />
```

样式追加：

```css
.snap-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background-color: rgb(var(--md-tertiary));
  z-index: 6;
  pointer-events: none;
}
```

- [ ] **Step 7: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：导入一个视频拖入视频轨后——拖动片段可平移并可拖到别的轨道；靠近相邻片段边缘时出现吸附参考线；拖左右把手可裁剪；松手后 `⌘Z` 一次撤销整次拖拽。

- [ ] **Step 8: 提交**

```bash
git add src/core/snapping.ts src/core/__tests__/snapping.test.ts src/components/workspace/TimelinePane.vue
git commit -m "feat(ui): add clip drag/trim with snapping and single-step undo"
```

---

### Task 23: 分割与删除操作

**Files:**
- Create: `src/composables/useTimelineActions.ts`
- Modify: `src/components/workspace/TimelinePane.vue`

**Interfaces:**
- Consumes: Task 9 `splitClips`、Task 6 `removeClips`、Task 16/17 stores
- Produces:
  - `useTimelineActions()` 返回 `{ splitAtPlayhead(): void; deleteSelected(): void; canSplit: ComputedRef<boolean>; canDelete: ComputedRef<boolean> }`

> 抽成 composable 是为了让工具栏按钮（本任务）与快捷键（Task 30）共用同一套逻辑，避免两处实现漂移。

- [ ] **Step 1: 写 `src/composables/useTimelineActions.ts`**

```ts
/** 时间线上的「动词」：分割与删除。工具栏与快捷键共用。 */
import { computed } from "vue";
import { removeClips, splitClips } from "@/core/ops";
import { covers } from "@/core/playback/activeClips";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { toast } from "@/composables/useToast";

export function useTimelineActions() {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();

  /** 播放头处可分割的片段：已选中的（若选中了）或播放头所在的所有片段。 */
  const splittableIds = computed(() => {
    const at = playback.playhead;
    const selected = selection.selectedClipIds;
    const all = project.doc.tracks.flatMap((t) => t.clips);
    const pool = selected.length > 0 ? all.filter((c) => selected.includes(c.id)) : all;
    return pool.filter((c) => covers(c, at)).map((c) => c.id);
  });

  const canSplit = computed(() => splittableIds.value.length > 0);
  const canDelete = computed(() => selection.selectedClipIds.length > 0);

  function splitAtPlayhead(): void {
    const ids = splittableIds.value;
    if (ids.length === 0) {
      toast("播放头处没有可分割的片段");
      return;
    }
    project.dispatch((doc) => splitClips(doc, ids, playback.playhead));
    // 分割产生的新片段与左半段都保留选中，方便接着操作
    const after = project.doc.tracks.flatMap((t) => t.clips);
    selection.selectMany(
      after.filter((c) => covers(c, playback.playhead) || ids.includes(c.id)).map((c) => c.id),
    );
  }

  function deleteSelected(): void {
    const ids = [...selection.selectedClipIds];
    if (ids.length === 0) return;
    project.dispatch((doc) => removeClips(doc, ids));
    selection.clear();
  }

  return { splitAtPlayhead, deleteSelected, canSplit, canDelete };
}
```

- [ ] **Step 2: 在 `TimelinePane.vue` 接工具栏**

script 追加：

```ts
import { useTimelineActions } from "@/composables/useTimelineActions";
import { TrashIcon } from "@heroicons/vue/24/outline";

const actions = useTimelineActions();
```

工具栏替换为「选择 / 分割 / 删除」并接上禁用态：

```vue
<div class="tl-tools">
  <Tooltip text="选择工具">
    <button class="icon-btn on" aria-label="选择工具">
      <CursorArrowRaysIcon class="w-[16px] h-[16px]" />
    </button>
  </Tooltip>
  <Tooltip text="在播放头处分割 (S)">
    <button
      class="icon-btn"
      :disabled="!actions.canSplit"
      aria-label="分割"
      @click="actions.splitAtPlayhead"
    >
      <ScissorsIcon class="w-[16px] h-[16px]" />
    </button>
  </Tooltip>
  <Tooltip text="删除选中片段 (Delete)">
    <button
      class="icon-btn"
      :disabled="!actions.canDelete"
      aria-label="删除"
      @click="actions.deleteSelected"
    >
      <TrashIcon class="w-[16px] h-[16px]" />
    </button>
  </Tooltip>
</div>
```

（`Tooltip` 需 `import Tooltip from "@/components/common/Tooltip.vue";`。）

车道空白处点击清除选择——在 `.lanes` 上挂：

```vue
<div class="lanes" @pointerdown.self="selection.clear()">
```

样式追加（禁用态）：

```css
.icon-btn:disabled {
  opacity: 0.35;
  pointer-events: none;
}
```

- [ ] **Step 3: 类型检查**

```bash
npx vue-tsc --noEmit -p tsconfig.json
```

Expected: 通过。

- [ ] **Step 4: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：点片段选中（高亮）；把播放头放在片段中间点「分割」→ 变成两段且都保持选中；点「删除」→ 片段消失；点空白处 → 取消选中；无操作对象时两个按钮为禁用态。

- [ ] **Step 5: 提交**

```bash
git add src/composables/useTimelineActions.ts src/components/workspace/TimelinePane.vue
git commit -m "feat(ui): add split and delete actions to the timeline toolbar"
```

---

### Task 24: 轨道头接线、增删轨道、媒体库拖入

**Files:**
- Modify: `src/components/workspace/TimelinePane.vue`
- Modify: `src/components/workspace/TrackHeader.vue`

**Interfaces:**
- Consumes: Task 5 tracks ops、Task 6 `addClip`、Task 3 `createClip`、Task 19 媒体库拖出的 `application/x-ai-cut-asset`
- Produces: 轨道头可静音/独奏/锁定/改名/删除；可新增轨道；素材可拖入轨道生成片段。

- [ ] **Step 1: 轨道头事件接线**

`TimelinePane.vue` script 追加（import 区补 `addClip`、`addTrack`、`removeTrack`、`renameTrack`、`setTrackFlag` 自 `@/core/ops`，`createClip` 自 `@/core/factory`，`TrackKind` 类型自 `@/types/project`）：

```ts
function onToggleFlag(trackId: string, flag: "muted" | "solo" | "locked"): void {
  const track = project.doc.tracks.find((t) => t.id === trackId);
  if (!track) return;
  project.dispatch((doc) => setTrackFlag(doc, trackId, flag, !track[flag]));
}

function onRemoveTrack(trackId: string): void {
  const track = project.doc.tracks.find((t) => t.id === trackId);
  if (!track) return;
  const count = track.clips.length;
  if (count > 0 && !window.confirm(`「${track.name}」上有 ${count} 个片段，删除轨道会一并删除。继续？`)) {
    return;
  }
  const removed = project.dispatch((doc) => removeTrack(doc, trackId));
  if (!removed) toast("至少要保留一条轨道", "error");
  else selection.clear();
}

function onRenameTrack(trackId: string, name: string): void {
  project.dispatch((doc) => renameTrack(doc, trackId, name));
}

function onAddTrack(kind: TrackKind): void {
  project.dispatch((doc) => addTrack(doc, kind));
}
```

模板里给 `TrackHeader` 接上事件：

```vue
<TrackHeader
  v-for="track in shownDoc.tracks"
  :key="track.id"
  :track="track"
  @toggle-flag="onToggleFlag"
  @remove="onRemoveTrack"
  @rename="onRenameTrack"
/>
```

`TrackHeader.vue` 里用到的 `v-focus` 需要在 `<script setup>` 内定义局部指令：

```ts
/** 双击改名后自动聚焦输入框。 */
const vFocus = {
  mounted: (el: HTMLElement) => el.focus(),
};
```

- [ ] **Step 2: 轨道头部加「新增轨道」按钮**

`corner` 一行右侧放三个按钮：

```vue
<div class="corner">
  <span>轨道</span>
  <div class="corner-add">
    <button class="th-btn" aria-label="新增视频轨" @click="onAddTrack('video')">＋V</button>
    <button class="th-btn" aria-label="新增音频轨" @click="onAddTrack('audio')">＋A</button>
    <button class="th-btn" aria-label="新增文字轨" @click="onAddTrack('text')">＋T</button>
  </div>
</div>
```

样式追加：

```css
.corner {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.corner-add {
  display: flex;
  gap: 2px;
}
.corner-add .th-btn {
  width: auto;
  padding: 0 5px;
}
```

> `.th-btn` 的样式定义在 `TrackHeader.vue` 的 scoped 块里，父组件用不到。请在 `TimelinePane.vue` 的 scoped 块里为 `.corner-add .th-btn` 补一份同样的按钮样式（宽高、圆角、底色、字号）。

- [ ] **Step 3: 媒体库拖入生成片段**

`TimelinePane.vue` script 追加（import 区补 `import { baseName } from "@/core/media";`）：

```ts
/** 素材拖入的默认时长：取素材时长与 5 秒中的较小者；图片固定 5 秒。 */
const DEFAULT_INSERT_SECONDS = 5;

function onLaneDragOver(event: DragEvent): void {
  if (!event.dataTransfer?.types.includes("application/x-ai-cut-asset")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function onLaneDrop(trackId: string, event: DragEvent): void {
  const assetId = event.dataTransfer?.getData("application/x-ai-cut-asset");
  if (!assetId) return;
  event.preventDefault();

  const asset = project.doc.assets.find((a) => a.id === assetId);
  const track = project.doc.tracks.find((t) => t.id === trackId);
  if (!asset || !track) return;
  if (track.locked) {
    toast(`「${track.name}」已锁定`, "error");
    return;
  }

  const fps = project.doc.fps;
  let start = Math.max(0, snapToFrame(timeFromClientX(event.clientX), fps));
  // 落点若落在已有片段内部，就顺延到该片段之后，避免一落地就重叠。
  const occupied = track.clips.find((c) => start >= c.start && start < c.start + c.duration);
  if (occupied) start = snapToFrame(occupied.start + occupied.duration, fps);

  const duration =
    asset.kind === "image" ? DEFAULT_INSERT_SECONDS : Math.min(DEFAULT_INSERT_SECONDS, asset.duration);
  if (!(duration > 0)) {
    toast(`${baseName(asset.src)} 没有可用时长`, "error");
    return;
  }

  const clip = createClip({ assetId: asset.id, trackId, start, duration });
  if (project.dispatch((doc) => addClip(doc, trackId, clip))) selection.select(clip.id);
}
```

模板：给每个 `.lane` 挂拖放：

```vue
<div
  v-for="track in shownDoc.tracks"
  :key="track.id"
  class="lane"
  @dragover="onLaneDragOver"
  @drop="onLaneDrop(track.id, $event)"
>
```

- [ ] **Step 4: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：把媒体库里的视频拖到某条轨道 → 生成片段并选中；点 M/S/L 生效；双击轨道名可改名；`＋V/＋A/＋T` 新增轨道；删除轨道有确认框且最后一条删不掉。

- [ ] **Step 5: 提交**

```bash
git add src/components/workspace/TimelinePane.vue src/components/workspace/TrackHeader.vue
git commit -m "feat(ui): wire track flags, add/remove tracks and media drag-in"
```

### Task 25: 预览引擎

**Files:**
- Create: `src/core/playback/engine.ts`
- Test: `src/core/playback/__tests__/engine-helpers.test.ts`

**Interfaces:**
- Consumes: Task 11 `mainVideoClipAt`/`activeClipsAt`/`isAudible`/`projectDuration`、Task 15 `fileUrl`、Task 2 类型
- Produces:
  - `mediaTimeFor(clip: Clip, timelineTime: number): number` —— `clip.in + (t - clip.start)`
  - `gainToVolume(db: number | undefined): number` —— dB → 0..1 线性音量
  - `class PlaybackEngine`，构造参数 `{ container, getDoc, onTime, onEnded? }`，方法 `play()`、`pause()`、`seek(seconds)`、`sync()`、`setMasterVolume(v)`、`dispose()`，只读 `currentTime`

**设计**：引擎**自己持有时钟**（`performance.now()` 推算），`<video>`/`<audio>` 元素是被时钟驱动的从属者。这样即使主轨没有片段（纯音频/纯图片工程）播放头也能正常走。元素只在漂移超过阈值时 seek，避免每帧抖动。

- [ ] **Step 1: 写纯函数测试**

`src/core/playback/__tests__/engine-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createClip } from "@/core/factory";
import { gainToVolume, mediaTimeFor } from "@/core/playback/engine";

describe("mediaTimeFor", () => {
  it("maps timeline time to media time through the clip's in-point", () => {
    const clip = createClip({ assetId: "a1", trackId: "t1", start: 10, duration: 4, in: 2 });
    expect(mediaTimeFor(clip, 10)).toBeCloseTo(2);
    expect(mediaTimeFor(clip, 12)).toBeCloseTo(4);
    expect(mediaTimeFor(clip, 13.5)).toBeCloseTo(5.5);
  });
});

describe("gainToVolume", () => {
  it("treats undefined gain as 0 dB", () => {
    expect(gainToVolume(undefined)).toBeCloseTo(1);
  });

  it("converts dB to linear and clamps to 0..1", () => {
    expect(gainToVolume(0)).toBeCloseTo(1);
    expect(gainToVolume(-6)).toBeCloseTo(0.5012, 3);
    expect(gainToVolume(-60)).toBeLessThan(0.01);
    expect(gainToVolume(12)).toBe(1); // 放大在 <video>.volume 上只能截到 1
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run src/core/playback/__tests__/engine-helpers.test.ts
```

Expected: FAIL —— `Cannot find module '@/core/playback/engine'`。

- [ ] **Step 3: 写 `src/core/playback/engine.ts`**

```ts
/**
 * 预览引擎：驱动 `playhead` 时钟，并把 <video>/<audio> 元素同步到时钟上。
 *
 * 时钟由引擎自己持有（`performance.now()`），媒体元素是「从属者」——
 * 这样即使主轨没有片段（纯音频 / 纯图片工程），播放头也能正常前进。
 * 元素只在漂移超过阈值时才 seek，避免逐帧抖动。
 */
import type { Clip, Project } from "@/types/project";
import { isAudible, mainVideoClipAt } from "./activeClips";
import { fileUrl } from "@/core/media";

/** 允许的影音漂移（秒），超过才纠正。 */
const DRIFT_TOLERANCE = 0.08;

/** 时间线时间 → 素材内时间。 */
export function mediaTimeFor(clip: Clip, timelineTime: number): number {
  return clip.in + (timelineTime - clip.start);
}

/** 增益 dB → `<audio>`/`<video>` 的 volume（0..1）。 */
export function gainToVolume(db: number | undefined): number {
  const linear = 10 ** ((db ?? 0) / 20);
  return Math.min(1, Math.max(0, linear));
}

export interface PlaybackEngineOptions {
  /** 承载媒体元素的容器。 */
  container: HTMLElement;
  /** 取当前文档（每次调用都拿最新的）。 */
  getDoc: () => Project;
  /** 每帧回调，用于把时间写回播放头。 */
  onTime: (seconds: number) => void;
  /** 播放到工程末尾时回调。 */
  onEnded?: () => void;
}

export class PlaybackEngine {
  private readonly container: HTMLElement;
  private readonly getDoc: () => Project;
  private readonly onTime: (seconds: number) => void;
  private readonly onEnded: () => void;

  private readonly video: HTMLVideoElement;
  private readonly audioEls = new Map<string, HTMLAudioElement>();
  /** 音频元素当前的素材 id；换素材时要重设 src。 */
  private readonly audioSources = new Map<string, string>();

  private raf = 0;
  private playing = false;
  /** 播放起点（秒）与起点对应的 performance.now()。 */
  private base = 0;
  private startedAt = 0;
  private mainClipId: string | null = null;
  private masterVolume = 1;

  constructor(options: PlaybackEngineOptions) {
    this.container = options.container;
    this.getDoc = options.getDoc;
    this.onTime = options.onTime;
    this.onEnded = options.onEnded ?? (() => undefined);

    this.video = document.createElement("video");
    this.video.className = "engine-video";
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.video.addEventListener("ended", () => this.onEnded());
    this.container.appendChild(this.video);
  }

  get currentTime(): number {
    if (!this.playing) return this.base;
    return this.base + (performance.now() - this.startedAt) / 1000;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setMasterVolume(value: number): void {
    this.masterVolume = Math.min(1, Math.max(0, value));
    this.applyVolumes();
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.startedAt = performance.now();
    this.syncElements(this.base, true);
    void this.video.play().catch(() => undefined);
    for (const el of this.audioEls.values()) void el.play().catch(() => undefined);
    this.loop();
  }

  pause(): void {
    if (!this.playing) return;
    this.base = this.currentTime;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.video.pause();
    for (const el of this.audioEls.values()) el.pause();
  }

  /** 定位：暂停状态下的拖动播放头走这里。 */
  seek(seconds: number): void {
    this.base = Math.max(0, seconds);
    this.startedAt = performance.now();
    this.syncElements(this.base, true);
    this.onTime(this.base);
  }

  /** 文档变化后调用：重建音频元素、刷新当前主片段。 */
  sync(): void {
    this.syncElements(this.currentTime, true);
  }

  dispose(): void {
    this.pause();
    this.video.remove();
    for (const el of this.audioEls.values()) el.remove();
    this.audioEls.clear();
  }

  private loop = (): void => {
    if (!this.playing) return;
    const t = this.currentTime;
    const total = this.projectEnd();
    if (total > 0 && t >= total) {
      this.pause();
      this.seek(total);
      this.onEnded();
      return;
    }
    this.syncElements(t, false);
    this.onTime(t);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** 工程总时长（这里只用于判断播放到末尾）。 */
  private projectEnd(): number {
    let max = 0;
    for (const track of this.getDoc().tracks) {
      for (const clip of track.clips) max = Math.max(max, clip.start + clip.duration);
    }
    return max;
  }

  private syncElements(timelineTime: number, force: boolean): void {
    const doc = this.getDoc();

    // ---- 主视频 ----
    const main = mainVideoClipAt(doc, timelineTime);
    if (!main) {
      if (this.mainClipId !== null) {
        this.mainClipId = null;
        this.video.pause();
        this.video.removeAttribute("src");
      }
    } else {
      const { clip } = main;
      const asset = doc.assets.find((a) => a.id === clip.assetId);
      const expected = asset ? mediaTimeFor(clip, timelineTime) : 0;

      if (this.mainClipId !== clip.id) {
        this.mainClipId = clip.id;
        if (asset) {
          this.video.src = fileUrl(asset.src);
          this.video.currentTime = Math.max(0, expected);
          this.video.style.opacity = String(clip.opacity ?? 1);
          if (this.playing) void this.video.play().catch(() => undefined);
        }
      } else if (asset && (force || Math.abs(this.video.currentTime - expected) > DRIFT_TOLERANCE)) {
        this.video.currentTime = Math.max(0, expected);
      }
      this.video.style.opacity = String(clip.opacity ?? 1);
      this.video.muted = !isAudible(doc, main.track);
      this.video.volume = gainToVolume(clip.gain) * this.masterVolume;
    }

    // ---- 音频轨 ----
    const audibleTracks = doc.tracks.filter((t) => t.kind === "audio" && isAudible(doc, t));
    const activeIds = new Set<string>();

    for (const track of audibleTracks) {
      const clip = track.clips.find((c) => timelineTime >= c.start && timelineTime < c.start + c.duration);
      if (!clip) continue;
      const asset = doc.assets.find((a) => a.id === clip.assetId);
      if (!asset) continue;

      activeIds.add(track.id);
      let el = this.audioEls.get(track.id);
      if (!el) {
        el = document.createElement("audio");
        el.preload = "auto";
        this.container.appendChild(el);
        this.audioEls.set(track.id, el);
      }
      if (this.audioSources.get(track.id) !== clip.assetId) {
        this.audioSources.set(track.id, clip.assetId);
        el.src = fileUrl(asset.src);
        force = true;
      }
      el.volume = gainToVolume(clip.gain) * this.masterVolume;
      const expected = mediaTimeFor(clip, timelineTime);
      if (force || Math.abs(el.currentTime - expected) > DRIFT_TOLERANCE) {
        el.currentTime = Math.max(0, expected);
      }
      if (this.playing && el.paused) void el.play().catch(() => undefined);
    }

    // 不再发声的音频元素暂停掉
    for (const [trackId, el] of this.audioEls) {
      if (!activeIds.has(trackId)) el.pause();
    }
  }

  private applyVolumes(): void {
    const doc = this.getDoc();
    for (const track of doc.tracks) {
      const el = this.audioEls.get(track.id);
      if (!el) continue;
      const clip = track.clips.find(
        (c) => this.currentTime >= c.start && this.currentTime < c.start + c.duration,
      );
      el.volume = gainToVolume(clip?.gain) * this.masterVolume;
    }
  }
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run src/core/playback/__tests__/engine-helpers.test.ts
```

Expected: PASS（5 个 it）。

- [ ] **Step 5: 提交**

```bash
git add src/core/playback/engine.ts src/core/playback/__tests__/engine-helpers.test.ts
git commit -m "feat(playback): add playback engine with clock-driven media sync"
```

---

### Task 26: 预览区接真实播放

**Files:**
- Modify: `src/components/workspace/PreviewStage.vue`

**Interfaces:**
- Consumes: Task 25 `PlaybackEngine`、Task 11 `activeClipsAt`/`isAudible`/`projectDuration`、Task 16/17 stores、Task 15 `fileUrl`
- Produces: 预览区播放主视频轨、叠加图片与文字、走带按钮生效、时间码真实。

- [ ] **Step 1: 重写 script**

```vue
<script setup lang="ts">
/** 视频预览：主视频轨用 <video> 播放，图片/文字按当前时间叠加。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  PlayIcon,
  PauseIcon,
  BackwardIcon,
  ForwardIcon,
  SpeakerWaveIcon,
  ArrowsPointingOutIcon,
  Squares2X2Icon,
} from "@heroicons/vue/24/outline";
import type { Clip } from "@/types/project";
import { activeClipsAt, isAudible, projectDuration } from "@/core/playback/activeClips";
import { PlaybackEngine } from "@/core/playback/engine";
import { fileUrl } from "@/core/media";
import { formatTimecode } from "@/core/time";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";

const project = useProjectStore();
const playback = usePlaybackStore();

const mediaLayer = ref<HTMLElement | null>(null);
const masterVolume = ref(0.8);

let engine: PlaybackEngine | null = null;

onMounted(() => {
  if (!mediaLayer.value) return;
  engine = new PlaybackEngine({
    container: mediaLayer.value,
    getDoc: () => project.doc,
    onTime: (seconds) => playback.setPlayhead(seconds),
    onEnded: () => {
      playback.playing = false;
    },
  });
  engine.setMasterVolume(masterVolume.value);
  engine.sync();
});

onBeforeUnmount(() => {
  engine?.dispose();
  engine = null;
});

// 播放/暂停由 store 驱动
watch(
  () => playback.playing,
  (playing) => {
    if (!engine) return;
    if (playing) engine.play();
    else engine.pause();
  },
);

// 拖动播放头（暂停时）才真正 seek；播放中由引擎反向驱动 playhead，不能回灌
watch(
  () => playback.playhead,
  (seconds) => {
    if (!engine || playback.playing) return;
    engine.seek(seconds);
  },
);

// 文档变化：换片段、静音状态、素材都靠 sync 反映
watch(() => project.doc, () => engine?.sync());

watch(masterVolume, (value) => engine?.setMasterVolume(value));

/** 当前时间点各轨道上的片段。 */
const active = computed(() => activeClipsAt(project.doc, playback.playhead));

/** 叠在上层的图片片段（发声音/可见的视频轨上的图片）。 */
const imageOverlays = computed(() => {
  const out: { clip: Clip; src: string }[] = [];
  for (const track of project.doc.tracks) {
    if (track.kind !== "video" || !isAudible(project.doc, track)) continue;
    const clip = active.value.get(track.id);
    if (!clip || clip.assetId === "") continue;
    const asset = project.doc.assets.find((a) => a.id === clip.assetId);
    if (asset?.kind === "image") out.push({ clip, src: fileUrl(asset.src) });
  }
  return out;
});

/** 叠在上层的文字片段。 */
const textOverlays = computed(() => {
  const out: { clip: Clip }[] = [];
  for (const track of project.doc.tracks) {
    if (track.kind !== "text") continue;
    const clip = active.value.get(track.id);
    if (clip?.text) out.push({ clip });
  }
  return out;
});

const total = computed(() => projectDuration(project.doc));
const fps = computed(() => project.doc.fps);
const nowLabel = computed(() => formatTimecode(playback.playhead, fps.value));
const totalLabel = computed(() => formatTimecode(total.value, fps.value));

function togglePlay(): void {
  playback.playing = !playback.playing;
}

function stepFrame(direction: 1 | -1): void {
  playback.playing = false;
  playback.setPlayhead(playback.playhead + direction / fps.value);
}
</script>
```

- [ ] **Step 2: 改模板**

画面区改成「媒体层 + 叠层」，并把走带接上：

```vue
<template>
  <section class="preview">
    <header class="preview-head">
      <div class="head-left">
        <span class="head-title">预览</span>
        <span class="res-chip tabular">{{ project.doc.width }} × {{ project.doc.height }} · {{ fps }} fps</span>
      </div>
      <div class="head-actions">
        <button class="icon-btn" aria-label="参考线">
          <Squares2X2Icon class="w-[17px] h-[17px]" />
        </button>
        <button class="icon-btn" aria-label="全屏预览" @click="togglePlay">
          <ArrowsPointingOutIcon class="w-[17px] h-[17px]" />
        </button>
      </div>
    </header>

    <div class="stage-wrap">
      <div class="stage">
        <div class="frame">
          <!-- 引擎把 <video>/<audio> 挂在这里 -->
          <div ref="mediaLayer" class="media-layer" />

          <img
            v-for="overlay in imageOverlays"
            :key="overlay.clip.id"
            class="overlay-image"
            :src="overlay.src"
            :style="{ opacity: String(overlay.clip.opacity ?? 1) }"
            alt=""
          />

          <div
            v-for="overlay in textOverlays"
            :key="overlay.clip.id"
            class="overlay-text"
            :style="{ opacity: String(overlay.clip.opacity ?? 1) }"
          >
            {{ overlay.clip.text }}
          </div>

          <div v-if="!mediaLayerHasContent" class="black-frame">
            <span>{{ project.doc.assets.length === 0 ? "导入素材后拖到时间线" : "此处没有画面" }}</span>
          </div>
        </div>
      </div>
    </div>

    <footer class="transport">
      <div class="tc-block">
        <span class="tc-now tabular">{{ nowLabel }}</span>
        <span class="tc-total tabular">/ {{ totalLabel }}</span>
      </div>

      <div class="transport-center">
        <button class="icon-btn" aria-label="上一帧" @click="stepFrame(-1)">
          <BackwardIcon class="w-[17px] h-[17px]" />
        </button>
        <button class="play-btn" :aria-label="playback.playing ? '暂停' : '播放'" @click="togglePlay">
          <PauseIcon v-if="playback.playing" class="w-[19px] h-[19px]" />
          <PlayIcon v-else class="w-[19px] h-[19px]" />
        </button>
        <button class="icon-btn" aria-label="下一帧" @click="stepFrame(1)">
          <ForwardIcon class="w-[17px] h-[17px]" />
        </button>
      </div>

      <div class="transport-right">
        <SpeakerWaveIcon class="vol-icon" />
        <input
          v-model.number="masterVolume"
          class="md3-range vol-range"
          type="range"
          min="0"
          max="1"
          step="0.01"
          aria-label="音量"
        />
        <button class="icon-btn" aria-label="全屏">
          <ArrowsPointingOutIcon class="w-[17px] h-[17px]" />
        </button>
      </div>
    </footer>
  </section>
</template>
```

`mediaLayerHasContent` 用一个简单计算属性：当前是否有主视频片段或图片叠层：

```ts
const mediaLayerHasContent = computed(() => {
  const main = project.doc.tracks.find((t) => t.kind === "video" && isAudible(project.doc, t));
  return main ? active.value.get(main.id) !== null : false;
});
```

- [ ] **Step 3: 换样式**

删掉原来那套假帧样式（`.sky` `.sun` `.sun-glow` `.sea` `.sea-line` `.hill` `.vignette` `.frame-top` `.frame-bottom` `.frame-name` `.big-play` `.frame-chip`），新增：

```css
.frame {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #0b0910;
  overflow: hidden;
}
.media-layer {
  position: absolute;
  inset: 0;
}
/* 引擎注入的元素铺满画面 */
.media-layer :deep(video) {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.media-layer :deep(audio) {
  display: none;
}
.overlay-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.overlay-text {
  position: absolute;
  left: 6%;
  right: 6%;
  bottom: 12%;
  text-align: center;
  font-size: clamp(14px, 3.2cqw, 34px);
  font-weight: 600;
  color: #fff;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.75);
  pointer-events: none;
}
.black-frame {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(255 255 255 / 0.42);
  font-size: 12px;
  pointer-events: none;
}
```

> `.overlay-text` 用了 `cqw`，因此 `.frame` 或其祖先需要 `container-type: size`——`.stage-wrap` 上已经有了。

- [ ] **Step 4: 类型检查**

```bash
npx vue-tsc --noEmit -p tsconfig.json
```

Expected: 通过。

- [ ] **Step 5: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：导入一个带声音的视频拖到视频轨 → 空格播放，预览区播画面、听得到声音、时间码走动；`←/→` 逐帧；拖动时间线播放头时画面跟着定格到对应时刻；把音频轨静音后声音消失；纯图片工程也能播放（黑底 + 图片）。

- [ ] **Step 6: 提交**

```bash
git add src/components/workspace/PreviewStage.vue
git commit -m "feat(ui): play real media in the preview with image/text overlays"
```

### Task 27: 属性面板接真实数据

**Files:**
- Modify: `src/stores/project.ts`
- Modify: `src/components/workspace/panes/InspectorPane.vue`
- Test: `src/stores/__tests__/coalesce.test.ts`

**Interfaces:**
- Consumes: Task 10 `setClipOpacity`/`setClipGain`/`setClipText`、Task 4 `relinkAsset`、Task 16/17 stores、Task 15 `pickMediaFiles`
- Produces:
  - store 新增 `dispatchCoalesced(mutate, key: string): boolean` 与 `endCoalesce(): void`
  - 属性面板显示选中片段真实属性；不透明度/音量/文字滑杆与输入框写回文档

**为什么需要 `dispatchCoalesced`**：滑杆拖动会连续触发 `input`。若每次都走 `dispatch`，一次拖动会塞进几十步历史。合并规则：**相同 key 的连续调用只记第一步历史**，后续直接替换当前文档；换 key 或调用普通 `dispatch`/`undo`/`redo` 即结束合并。

- [ ] **Step 1: 写合并历史测试**

`src/stores/__tests__/coalesce.test.ts`:

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
import { createClip } from "@/core/factory";
import { addClip, setClipOpacity } from "@/core/ops";

beforeEach(() => {
  setActivePinia(createPinia());
});

function setup() {
  const store = useProjectStore();
  const trackId = store.doc.tracks[0].id;
  const clip = createClip({ assetId: "a1", trackId, start: 0, duration: 2 });
  store.dispatch((doc) => addClip(doc, trackId, clip));
  return { store, clipId: clip.id };
}

describe("dispatchCoalesced", () => {
  it("records a single history entry for a run of same-key updates", () => {
    const { store, clipId } = setup();
    const before = store.doc.tracks[0].clips[0].opacity;

    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.8), `opacity:${clipId}`);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.6), `opacity:${clipId}`);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.4), `opacity:${clipId}`);

    expect(store.doc.tracks[0].clips[0].opacity).toBeCloseTo(0.4);
    // 一次撤销应回到拖动之前，而不是回退一格
    store.undo();
    expect(store.doc.tracks[0].clips[0].opacity).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it("starts a new history entry when the key changes", () => {
    const { store, clipId } = setup();
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.5), `opacity:${clipId}`);
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.5), `gain:${clipId}`);
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(2);
  });

  it("ends coalescing after a plain dispatch", () => {
    const { store, clipId } = setup();
    store.dispatchCoalesced((doc) => setClipOpacity(doc, clipId, 0.5), `opacity:${clipId}`);
    store.dispatch((doc) => setClipOpacity(doc, clipId, 0.2));
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(3); // addClip + 两次不透明度修改
  });
});
```

- [ ] **Step 2: 在 `src/stores/project.ts` 增加合并提交**

在 `dispatch` 内**开头**加一行结束合并：

```ts
  function dispatch(mutate: (current: Project) => Project): boolean {
    coalesceKey.value = null;
    const next = mutate(doc.value);
    // …其余不变
  }
```

在 `undo`/`redo` 的开头同样加 `coalesceKey.value = null;`。

新增：

```ts
  /** 连续同类操作（滑杆拖动）的合并键；不同键则另记一步历史。 */
  const coalesceKey = ref<string | null>(null);

  /**
   * 合并提交：同一 `key` 的连续调用只记第一步历史。
   * 用于滑杆这类高频输入，避免一次拖动产生几十步撤销。
   */
  function dispatchCoalesced(mutate: (current: Project) => Project, key: string): boolean {
    const next = mutate(doc.value);
    if (next === doc.value) return false;

    if (coalesceKey.value !== key) {
      const stack = undoStack.value.slice();
      stack.push(doc.value);
      if (stack.length > HISTORY_LIMIT) stack.shift();
      undoStack.value = stack;
      redoStack.value = [];
      coalesceKey.value = key;
    }
    doc.value = next;
    dirty.value = true;
    return true;
  }

  /** 显式结束合并（滑杆松开时调用）。 */
  function endCoalesce(): void {
    coalesceKey.value = null;
  }
```

并把 `dispatchCoalesced`、`endCoalesce` 加进 return。

- [ ] **Step 3: 运行，确认通过**

```bash
npx vitest run src/stores/__tests__/coalesce.test.ts
```

Expected: PASS（3 个 it）。

- [ ] **Step 4: 重写 `InspectorPane.vue`**

```vue
<script setup lang="ts">
/** 属性面板：显示选中片段的真实属性，并把不透明度/音量/文字写回文档。 */
import { computed } from "vue";
import { EllipsisHorizontalIcon, FilmIcon, ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import { relinkAsset, setClipGain, setClipOpacity, setClipText } from "@/core/ops";
import { fileUrl, pickMediaFiles } from "@/core/media";
import { formatTimecode } from "@/core/time";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { toast } from "@/composables/useToast";

const project = useProjectStore();
const selection = useSelectionStore();

const clip = computed(() => {
  const ids = new Set(selection.selectedClipIds);
  for (const track of project.doc.tracks) {
    const found = track.clips.find((c) => ids.has(c.id));
    if (found) return found;
  }
  return null;
});

const asset = computed(() =>
  clip.value && clip.value.assetId !== ""
    ? project.doc.assets.find((a) => a.id === clip.value!.assetId)
    : undefined,
);

const track = computed(() =>
  clip.value ? project.doc.tracks.find((t) => t.id === clip.value!.trackId) : undefined,
);

const isText = computed(() => clip.value?.assetId === "");

function numberFromEvent(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

function onOpacityInput(event: Event): void {
  const target = clip.value;
  if (!target) return;
  const value = numberFromEvent(event);
  project.dispatchCoalesced((doc) => setClipOpacity(doc, target.id, value), `opacity:${target.id}`);
}

function onGainInput(event: Event): void {
  const target = clip.value;
  if (!target) return;
  const value = numberFromEvent(event);
  project.dispatchCoalesced((doc) => setClipGain(doc, target.id, value), `gain:${target.id}`);
}

function onTextInput(event: Event): void {
  const target = clip.value;
  if (!target) return;
  const value = (event.target as HTMLTextAreaElement).value;
  project.dispatchCoalesced((doc) => setClipText(doc, target.id, value), `text:${target.id}`);
}

async function relink(): Promise<void> {
  const target = asset.value;
  if (!target) return;
  const picked = await pickMediaFiles();
  if (picked.length === 0) return;
  project.dispatch((doc) => relinkAsset(doc, target.id, picked[0]));
  toast("已重新链接素材");
}
</script>
```

模板：

```vue
<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">属性</h2>
        <p class="pane-sub">
          {{ clip ? (isText ? "当前选中：文字片段" : "当前选中：媒体片段") : "未选中片段" }}
        </p>
      </div>
      <button class="icon-btn" aria-label="更多操作">
        <EllipsisHorizontalIcon class="w-[18px] h-[18px]" />
      </button>
    </header>

    <div class="pane-scroll">
      <p v-if="!clip" class="hint-empty">在时间线上点一个片段，这里会显示它的参数。</p>

      <template v-else>
        <div class="selected">
          <div
            class="selected-thumb"
            :style="asset?.thumb ? { backgroundImage: `url('${fileUrl(asset.thumb)}')` } : undefined"
          >
            <FilmIcon v-if="!asset?.thumb" class="w-4 h-4" />
          </div>
          <div class="selected-text">
            <span class="selected-name">{{ isText ? (clip.text || "文字片段") : (asset?.name ?? "缺失素材") }}</span>
            <span class="selected-meta">
              {{ track?.name }} · {{ formatTimecode(clip.duration, project.doc.fps) }}
            </span>
          </div>
        </div>

        <p v-if="asset?.offline" class="offline-row">
          <ExclamationTriangleIcon class="w-4 h-4" />
          源文件已丢失
          <button class="btn-text" @click="relink">重新链接</button>
        </p>

        <template v-if="isText">
          <div class="section-label">文字</div>
          <textarea
            class="text-input"
            rows="3"
            :value="clip.text ?? ''"
            @input="onTextInput"
            @change="project.endCoalesce()"
          />
        </template>

        <div class="section-label">合成</div>
        <div class="group">
          <div class="prop-row">
            <span>不透明度</span>
            <span class="prop-value">{{ Math.round((clip.opacity ?? 1) * 100) }}%</span>
          </div>
          <input
            class="md3-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="clip.opacity ?? 1"
            aria-label="不透明度"
            @input="onOpacityInput"
            @change="project.endCoalesce()"
          />
        </div>

        <template v-if="!isText">
          <div class="section-label">音频</div>
          <div class="group">
            <div class="prop-row">
              <span>音量</span>
              <span class="prop-value">{{ (clip.gain ?? 0).toFixed(1) }} dB</span>
            </div>
            <input
              class="md3-range"
              type="range"
              min="-60"
              max="12"
              step="0.5"
              :value="clip.gain ?? 0"
              aria-label="音量"
              @input="onGainInput"
              @change="project.endCoalesce()"
            />
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
```

样式追加：

```css
.hint-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.selected-thumb {
  background-size: cover;
  background-position: center;
}
.offline-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
  font-size: 11.5px;
}
.text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.text-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
```

- [ ] **Step 5: 类型检查 + 手动验证**

```bash
npx vue-tsc --noEmit -p tsconfig.json
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：选中片段后属性面板显示真实时长与轨道名；拖不透明度滑杆时预览实时变化，松手后 `⌘Z` **一次**回到拖动前；音量滑杆同理；选中文字片段出现文字输入框，输入即生效；素材离线时出现「重新链接」。

- [ ] **Step 6: 提交**

```bash
git add src/stores/project.ts src/components/workspace/panes/InspectorPane.vue src/stores/__tests__/coalesce.test.ts
git commit -m "feat(ui): wire inspector to selected clip with coalesced slider edits"
```

---

### Task 28: 顶栏接工程名与文件操作

**Files:**
- Modify: `src/components/layout/TopBar.vue`
- Modify: `src/components/layout/SettingsMenu.vue`

**Interfaces:**
- Consumes: Task 16 `useProjectStore`、Task 18 `toast`
- Produces: 顶栏显示真实工程名与未保存标记；设置菜单提供 新建 / 打开 / 保存 / 另存为。

- [ ] **Step 1: `TopBar.vue` 绑定真实工程状态**

script 追加：

```ts
import { useProjectStore } from "@/stores/project";

const project = useProjectStore();

/** 显示用工程名：没存过盘显示「未命名项目」。 */
const projectName = computed(() => project.doc.name || "未命名项目");
```

模板里替换工程名区块：

```vue
<div class="name-block">
  <span class="name-strong">{{ projectName }}</span>
  <span v-if="project.dirty" class="name-dirty" title="有未保存的改动" aria-hidden="true" />
</div>
<span class="name-meta tabular">{{ project.doc.width }}×{{ project.doc.height }} · {{ project.doc.fps }}fps</span>
```

`useProjectStore` 已 import 时不要重复 import；`computed` 需在 import 列表里。

- [ ] **Step 2: `SettingsMenu.vue` 加文件操作**

script 追加：

```ts
import { useProjectStore } from "@/stores/project";
import { toast } from "@/composables/useToast";

const project = useProjectStore();

async function runFileAction(action: "new" | "open" | "save" | "saveAs"): Promise<void> {
  open.value = false;
  try {
    if (action === "new") {
      if (project.dirty && !window.confirm("当前工程有未保存的改动，确定新建？")) return;
      project.newProject();
      return;
    }
    if (action === "open") {
      if (project.dirty && !window.confirm("当前工程有未保存的改动，确定打开别的工程？")) return;
      await project.open();
      return;
    }
    if (action === "save") {
      const saved = await project.save();
      if (saved) toast("已保存");
      return;
    }
    const saved = await project.saveAs();
    if (saved) toast("已另存为");
  } catch (error) {
    toast(`操作失败：${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
```

模板：把原来禁用的「偏好设置 / 快捷键」区替换为文件操作：

```vue
<div class="menu-divider" />

<button class="menu-item" role="menuitem" @click="runFileAction('new')">
  <span>新建工程</span>
  <span class="menu-kbd">⌘N</span>
</button>
<button class="menu-item" role="menuitem" @click="runFileAction('open')">
  <span>打开工程…</span>
  <span class="menu-kbd">⌘O</span>
</button>
<button class="menu-item" role="menuitem" @click="runFileAction('save')">
  <span>保存</span>
  <span class="menu-kbd">⌘S</span>
</button>
<button class="menu-item" role="menuitem" @click="runFileAction('saveAs')">
  <span>另存为…</span>
  <span class="menu-kbd">⌘⇧S</span>
</button>

<div class="menu-divider" />
```

- [ ] **Step 3: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：编辑后顶栏工程名旁出现小圆点；设置菜单里「保存」弹出原生保存框；保存后圆点消失；「新建工程」在脏状态下会先确认。

- [ ] **Step 4: 提交**

```bash
git add src/components/layout/TopBar.vue src/components/layout/SettingsMenu.vue
git commit -m "feat(ui): show project state in the top bar and add file actions"
```

---

### Task 29: 自动保存与崩溃恢复

**Files:**
- Create: `src/core/autosave.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: Task 16 store、Task 15 `recoveryRead`/`recoveryWrite`、Task 3 `parseProject`/`serializeProject`、Task 18 `toast`
- Produces:
  - `startAutosave(): void` —— 监听文档变化，debounce 2s 写 `recovery/autosave.json`
  - `checkRecovery(): Promise<void>` —— 启动时若草稿比磁盘工程新，询问是否恢复

- [ ] **Step 1: 写 `src/core/autosave.ts`**

```ts
/**
 * 自动保存与崩溃恢复。
 *
 * 写入的是应用数据目录下的 `recovery/autosave.json`，与用户显式保存的工程文件分开——
 * 草稿永远不覆盖用户的工程文件。
 */
import { watch } from "vue";
import { parseProject, serializeProject } from "@/core/serialize";
import { baseName, recoveryRead, recoveryWrite } from "@/core/media";
import { useProjectStore } from "@/stores/project";
import { toast } from "@/composables/useToast";

/** 自动保存的防抖时长（毫秒）。 */
const AUTOSAVE_DEBOUNCE_MS = 2000;

export function startAutosave(): void {
  const project = useProjectStore();
  let timer: number | undefined;

  watch(
    () => project.doc,
    () => {
      if (!project.dirty) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void recoveryWrite(serializeProject(project.doc)).catch(() => {
          // 自动保存失败不打扰用户：写不进去（磁盘满/权限）时静默跳过
        });
      }, AUTOSAVE_DEBOUNCE_MS);
    },
  );
}

/** 启动时检查是否有比当前工程更新的恢复草稿。 */
export async function checkRecovery(): Promise<void> {
  const project = useProjectStore();

  if (project.dirty) return; // 已经有未保存的工作，不打断

  let draft: ReturnType<typeof parseProject> | null = null;
  try {
    const json = await recoveryRead();
    if (!json) return;
    draft = parseProject(json);
  } catch {
    return; // 草稿损坏：忽略
  }

  const newer = project.filePath === null || draft.updatedAt > project.doc.updatedAt;
  if (!newer || draft.tracks.every((t) => t.clips.length === 0)) return;

  const when = new Date(draft.updatedAt).toLocaleString();
  if (!window.confirm(`检测到 ${when} 的未保存草稿，是否恢复？`)) return;

  project.reset(draft, project.filePath);
  project.dirty = true;
  toast("已恢复草稿，记得保存");
}

/** 供调试用：草稿文件的显示名。 */
export function recoveryLabel(path: string): string {
  return baseName(path);
}
```

> `recoveryLabel` 目前没有调用方。若 `noUnusedLocals` 不报（导出函数不算本地未使用），可以留着；否则删掉它和 `baseName` 的 import。

- [ ] **Step 2: 在 `App.vue` 启动**

```vue
<script setup lang="ts">
/** 应用根：布局初始化 + 自动保存 + 启动时检查恢复草稿。 */
import { onMounted, onUnmounted } from "vue";
import AppShell from "@/components/layout/AppShell.vue";
import Toast from "@/components/common/Toast.vue";
import { useLayoutStore } from "@/stores/layout";
import { checkRecovery, startAutosave } from "@/core/autosave";

const layout = useLayoutStore();

function onWindowResize(): void {
  layout.clampPanes();
}

onMounted(() => {
  layout.clampPanes();
  window.addEventListener("resize", onWindowResize);
  startAutosave();
  void checkRecovery();
});

onUnmounted(() => {
  window.removeEventListener("resize", onWindowResize);
});
</script>

<template>
  <AppShell />
  <Toast />
</template>
```

- [ ] **Step 2b: 忽略草稿目录**

`recovery/` 写在系统应用数据目录里，不在仓库内，无需改 `.gitignore`。

- [ ] **Step 3: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：导入素材、拖入时间线，等 2 秒以上，然后**强制退出**应用；重新打开 → 弹出「检测到 … 的未保存草稿，是否恢复？」→ 确认后工程结构完整回来。再验证一次：不新建任何内容时启动**不**弹窗。

- [ ] **Step 4: 提交**

```bash
git add src/core/autosave.ts src/App.vue
git commit -m "feat(core): add autosave and crash recovery"
```

---

### Task 30: 全局快捷键

**Files:**
- Create: `src/core/shortcuts.ts`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: Task 23 `useTimelineActions`、Task 16/17 stores
- Produces: `installShortcuts(): () => void`（返回卸载函数）

- [ ] **Step 1: 写 `src/core/shortcuts.ts`**

```ts
/** 全局快捷键。返回卸载函数。 */
import { useLayoutStore } from "@/stores/layout";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useTimelineActions } from "@/composables/useTimelineActions";
import { toast } from "@/composables/useToast";

/** 焦点在输入类元素上时不抢快捷键。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function installShortcuts(): () => void {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();
  const layout = useLayoutStore();
  const actions = useTimelineActions();

  async function save(): Promise<void> {
    try {
      const saved = await project.save();
      if (saved) toast("已保存");
    } catch (error) {
      toast(`保存失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function open(): Promise<void> {
    try {
      if (project.dirty && !window.confirm("当前工程有未保存的改动，确定打开别的工程？")) return;
      await project.open();
    } catch (error) {
      toast(`打开失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;

    // 带 ⌘ 的组合键即使在输入框里也应生效（保存/撤销是全局语义）
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void (event.shiftKey ? project.saveAs().then((ok) => ok && toast("已另存为")) : save());
      return;
    }
    if (mod && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void open();
      return;
    }
    if (mod && event.key.toLowerCase() === "n") {
      event.preventDefault();
      if (!project.dirty || window.confirm("当前工程有未保存的改动，确定新建？")) project.newProject();
      return;
    }
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) project.redo();
      else project.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "\\") {
      event.preventDefault();
      layout.showPanel = !layout.showPanel;
      return;
    }

    if (isTypingTarget(event.target)) return;

    switch (event.key) {
      case " ":
        event.preventDefault();
        playback.playing = !playback.playing;
        break;
      case "s":
      case "S":
        event.preventDefault();
        actions.splitAtPlayhead();
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        actions.deleteSelected();
        break;
      case "ArrowLeft":
        event.preventDefault();
        playback.playing = false;
        playback.setPlayhead(playback.playhead - 1 / project.doc.fps);
        break;
      case "ArrowRight":
        event.preventDefault();
        playback.playing = false;
        playback.setPlayhead(playback.playhead + 1 / project.doc.fps);
        break;
      case "Escape":
        selection.clear();
        break;
      default:
        break;
    }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
```

- [ ] **Step 2: 在 `App.vue` 安装**

```ts
import { installShortcuts } from "@/core/shortcuts";
```

`onMounted` 里：

```ts
const uninstall = installShortcuts();
```

`onUnmounted` 里：

```ts
uninstall();
```

- [ ] **Step 3: 手动验证**

```bash
pnpm --config.verify-deps-before-run=none tauri dev
```

Expected：空格播放/暂停；`←/→` 逐帧；选中片段后 `S` 分割、`Delete` 删除；`⌘Z`/`⇧⌘Z` 撤销重做；`⌘S` 保存、`⌘O` 打开、`⌘N` 新建、`⌘\` 收起/展开右栏；在属性面板的文字输入框里打字时**不会**触发分割与删除。

- [ ] **Step 4: 提交**

```bash
git add src/core/shortcuts.ts src/App.vue
git commit -m "feat(core): add global keyboard shortcuts"
```

---

### Task 31: 端到端验收

**Files:**
- 无新增（只做验证与收尾）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 验收结论；`docs/superpowers/plans/` 下的执行记录（如需）

- [ ] **Step 1: 跑完整测试与构建门槛**

```bash
npx vitest run
npx vue-tsc --noEmit -p tsconfig.json
npm run build
cd src-tauri && cargo check
```

Expected：四项全绿。

- [ ] **Step 2: 逐条对照 spec §19 的验收标准**

启动 `pnpm --config.verify-deps-before-run=none tauri dev`，依次确认：

1. 新建工程含默认 3 轨（视频/音频/文字）。
2. 「导入媒体」选一个真实 mp4 → 媒体库出现卡片，带真实时长与缩略图（有音频则生成波形缓存）。
3. 把素材拖到视频轨 → 生成片段，显示真实首帧与波形。
4. 拖拽移动片段（含跨轨）、拖边缘裁剪、`S` 分割、`Delete` 删除，均即时正确；靠近边缘有吸附参考线。
5. 空格播放：预览区播放主视频轨片段，时间码走动；`←/→` 逐帧；拖动播放头可定位。
6. 音频轨在播放时出声；M/S 生效。
7. `⌘Z` / `⇧⌘Z` 能逐步撤销/重做上述操作；一次拖拽 = 一步撤销。
8. `⌘S` 保存为 `.json`；`⌘O` 重新打开 → 工程结构、片段位置完全还原。
9. 强制退出后重开 → 提示恢复 autosave 草稿。
10. 把工程引用的源文件改名 → 重开工程显示离线占位 + 可重新链接。
11. 门槛命令全绿（Step 1）。

- [ ] **Step 3: 记录未达标项**

任何一条没通过，**不要**直接改代码蒙混——在 `docs/superpowers/plans/2026-10-19-ai-cut-core-editor.md` 末尾追加一条 `## 验收记录`，写清哪条、现象、复现步骤，然后回到对应任务修正。

- [ ] **Step 4: 收尾提交**

```bash
git add -A
git commit -m "chore: complete core editing engine acceptance pass"
```

---

## 与 spec 的差异汇总

实现过程中有意偏离 spec 的地方（均已在上文任务内标注）：

| 项 | spec | 实现 | 原因 |
| --- | --- | --- | --- |
| `probe_media` 返回 | 带 `kind` | 返回 `has_video`/`has_audio`，前端按扩展名判 `kind` | ffprobe 区分「图片」与「单帧视频」不可靠 |
| 新增 `src/core/ops/project.ts` | 未列出 | 新增 | 工程级属性需要一个归属明确的 op 模块 |
| 新增 `src/core/snapping.ts` | 未列出 | 新增 | 吸附是纯函数，单独测比塞进组件好 |
| 新增 `src/composables/useToast.ts` | 只列了 `Toast.vue` | 拆出队列模块 | 组件只做渲染 |
| 新增 `src/composables/useTimelineActions.ts` | 未列出 | 新增 | 工具栏与快捷键共用「分割/删除」，避免两份实现 |
| 新增 `scripts/fetch-sidecars.sh` | 未列出 | 新增 | sidecar 二进制不入库，需要可复现的获取方式 |
| 时间线拆成 3 个子组件 | 只列 `TimelinePane.vue` | 拆出 `TimelineRuler`/`TrackHeader`/`TimelineClip` | 原组件过大，拆分后每块职责单一 |
| store 新增 `dispatchCoalesced` | 未提及 | 新增 | 滑杆实时预览与「一次手势一步历史」需要它 |

## 风险

| 编号 | 风险 | 缓解 |
| --- | --- | --- |
| R1 | webview 对多路音频与冷门格式解码支持不一 | 音频元素池化；不支持的格式在导入时即报错（`probe_media` 失败） |
| R2 | 主片段切换处的 seek 抖动/短暂黑帧 | 漂移阈值 80ms 内不纠正；切换时先设 `currentTime` 再 play |
| R3 | ffmpeg sidecar 体积（数十 MB）与 GPL 许可 | 已 gitignore，不入库；正式分发前评估瘦身与合规 |
| R4 | 大工程快照深拷贝开销 | 文档为纯 JSON 且规模有限；历史上限 100 步 |
| R5 | 沙箱内 `pnpm install` 可能失败 | 用既有 `node_modules`；必要时 `npm install` 兜底 |
| R6 | 素材按路径引用，源文件移动即失效 | 载入时检测并标为离线，支持重新链接（v1 接受） |
| R7 | 轨道头与车道的垂直滚动未联动 | v1 轨道数少（默认 3 条），超出时先接受；后续统一到一个滚动容器 |

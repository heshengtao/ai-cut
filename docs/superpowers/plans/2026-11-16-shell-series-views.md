# 三视图外壳 + 剧集界面 实现计划（P1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 顶栏加「预览 / 画布 / 剧集」三视图切换，只换主窗口内容；剧集界面能看到本工程所有分P（封面 / 时长 / 轨道数），并支持新建、复制、改名、排序、删除、点击跳回预览。

**Architecture:** 视图状态独立成 `stores/view.ts`（hash 优先 + localStorage 兜底）；`AppShell.vue` 只对 `<main>` 分支；分P 的增删改排序做成 `core/ops/episodes.ts` 的不可变纯函数，走 `dispatch` 进撤销栈。画布视图本阶段先给骨架（P2 填内核）。

**Tech Stack:** Vue 3 + Pinia + TypeScript + Vitest + Tailwind/MD3 组件。

## Global Constraints

- 分P 操作是 ops：不可变、经 `dispatch` 进撤销栈，不许直接改 `doc.episodes`。
- 任何改工程级字段的 ops 必须走 `patchProjectMeta`（P0 回写 §2）。
- 至少保留一个分P；删除最后一个直接返回原文档（由 UI 禁用按钮）。
- 新文案同时写 `src/i18n/zh.ts` 与 `en.ts`。
- 快捷键进 `src/core/shortcuts.ts`，焦点在输入框或模态框打开时不触发。
- 检查：`pnpm test`、`pnpm build`。

---

### Task 1: 分P 操作 `core/ops/episodes.ts`

**Files**
- Create: `src/core/ops/episodes.ts`
- Create: `src/core/ops/__tests__/episodes.test.ts`
- Modify: `src/core/ops/index.ts`（`export * from "./episodes";`）

**Interfaces**
- Produces:
  - `addEpisode(doc: Project, name: string): Project`（追加到末尾，`order = max+1`，不切换当前分P）
  - `renameEpisode(doc: Project, episodeId: string, name: string): Project`
  - `removeEpisode(doc: Project, episodeId: string): Project`（只剩一个时原样返回）
  - `moveEpisode(doc: Project, episodeId: string, toIndex: number): Project`
  - `duplicateEpisode(doc: Project, episodeId: string, name: string): Project`（轨道 / 片段 / 标记全部换新 id）
  - `episodeDuration(episode: Episode): number`

- [ ] 测试：新增后 `episodes` 长度 +1、`order` 递增、`activeEpisodeId` 不变；重名/改名只改目标；删到最后一个不生效；`moveEpisode` 顺序正确且 `order` 重排；复制后轨道/片段 id 不重复、`tracks` 内容等价；`episodeDuration` 取最大 `start+duration`。
- [ ] 实现（全部 `withTouch`，`withTouch` 已折返投影）。
- [ ] `pnpm test episodes` 通过；提交 `feat(ops): 分P 增删改排序与复制`。

---

### Task 2: 视图 store

**Files**
- Create: `src/stores/view.ts`
- Create: `src/stores/__tests__/view.test.ts`
- Modify: `src/components/layout/AppShell.vue`（分支，见 Task 3）

**Interfaces**
- Produces: `type AppView = "preview" | "board" | "series"`；`useViewStore()` 暴露 `view`、`setView(v)`、`restoreFromHash()`。
- 持久化：`localStorage["ai-cut-view"]`；hash `#/board`、`#/series` 优先；非法值回落 `preview`。

- [ ] 测试：默认 preview；`setView("board")` 改 state + 写 localStorage；hash 优先；非法 hash 不改变状态。
- [ ] 实现（`typeof window === "undefined"` 时全部跳过，方便 node 测试）。
- [ ] 提交 `feat(view): 三视图状态与持久化`。

---

### Task 3: 顶栏切换 + 主窗口分支 + 剧集界面

**Files**
- Create: `src/components/series/SeriesView.vue`（卡片网格 + 工具条）
- Create: `src/components/board/BoardView.vue`（骨架：点阵背景 + 空态 + 工具栏占位，P2 填内核）
- Modify: `src/components/layout/TopBar.vue`（分段控件）
- Modify: `src/components/layout/AppShell.vue`（三分支）
- Modify: `src/core/shortcuts.ts`（⌘1/⌘2/⌘3）
- Modify: `src/i18n/zh.ts`、`en.ts`

**Interfaces**
- Consumes: `useViewStore`（Task 2）、`switchEpisode`（P0）、ops（Task 1）、`useProjectStore().dispatch`。
- Produces: 三个视图可切换；剧集卡片点击 = `setView("preview")` + `switchEpisode(id)` + 播放头归零。

- [ ] 顶栏插 `SegmentedControl`（size="sm"），竖屏放标签栏左侧；`NO_DRAG_SELECTOR` 已含 button/role=tab，无需改。
- [ ] `AppShell` `<main>` 三分支：preview 原样 / board 全高 / series 全高；竖屏同样。
- [ ] `SeriesView`：工具条（新建 / 搜索 / 排序）、卡片（封面 / 名字 / 时长 / 轨道·片段数 / ⋯ 菜单）、点击跳转。
- [ ] i18n：`view.preview|board|series`、`series.*`、`board.*`。
- [ ] 提交 `feat(shell): 顶栏三视图切换与剧集界面`。

---

### Task 4: 回归

- [ ] `pnpm test`（全绿）
- [ ] `pnpm build`（vue-tsc + vite）
- [ ] 提交剩余修正

---

## Self-Review

- 分P 操作全部走 ops → 撤销 / 自动保存 / 会话广播自动生效（无需额外接线）。
- 剧集界面的"当前分P"高亮用 `doc.activeEpisodeId`；点击非当前分P 才 `switchEpisode`。
- 画布视图本轮只到骨架，验收标准是"切换不报错、主窗口不被时间线挤压"；内核在 P2 计划里。

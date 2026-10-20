# AI Cut — AI 协作路线图

> 更新时间：2026-10-19
> 当前阶段：**A —— AI 操作时，Tauri 界面实时可见。**
> 本文是产品与架构路线图，不替代 `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 里的具体实现文档。

## 0. 一句话定位

**AI 剪，人审片。**

AI Cut 的定位是 AI 与人对同一条时间线的共享操作台：AI 负责生成素材、提出剪辑、执行操作；人负责实时看见、随时判断、必要时接管。

## 1. 产品判断

AI 视频链路可以拆成三层：

| 层 | 谁在做 | AI Cut 的位置 |
| --- | --- | --- |
| 生成层：模型、浏览器、HTML/Canvas 场景、素材 | Harness / 各家模型 | 交给外部 Harness |
| 执行层：时间线、剪辑、合成、导出 | CapCut / Resolve / Premiere / Descript | 保留轻量、可数据化的核心原语 |
| **交接层：AI 提案 → 人看见 → 人判断 → AI 继续** | 几乎没有成熟方案 | **主战场** |

由此得到三条产品原则：

- 生成交给外部 Harness，执行保留轻量原语，交接层做深。
- AI 能力由外部 Harness 提供，AI Cut 保持本地、轻量、可审阅。
- 所有 AI 操作走 typed command，便于归因、撤销、回放和审阅。
- 核心范围只收可数据表达、可被人类看懂的操作。

## 2. 当前阶段：A —— 实时可见

### 2.1 目标

AI 通过 MCP 对当前工程执行操作时，Tauri 界面无需刷新即可看到：

1. AI 当前在做什么（会话、阶段、任务）。
2. 每一步操作发生在哪（时间、轨道、片段）。
3. 操作的结果（时间线实时变化、画面/选区高亮）。
4. 操作的历史（活动流、操作者、耗时、错误）。

### 2.2 范围

- 可序列化的命令总线与操作日志。
- 单一写入口 `applyCommand`，所有人类与 Agent 操作统一归因。
- 最小 MCP 入口（本地 HTTP + token），只暴露必要工具。
- Agent 会话、阶段、焦点与活动流。
- 时间线上的 Agent 光标、受影响片段高亮、操作反馈。
- 人类继续正常编辑；命令串行化，不丢更新。
- 按命令粒度的撤销/重做。

### 2.3 完成标志

- AI 通过 MCP 提交命令后，UI 在一个渲染帧内反映时间线变化。
- 人类能看出“谁改了什么、改在哪里、什么时候改的”。
- Agent 与人类的操作都经过同一条命令总线，可归因、可撤销。

## 3. 核心架构决策

### 3.1 Op Log 是唯一真相流

现状：`src/stores/project.ts` 的 `dispatch(mutate)` 是唯一写入口，ops 是不可变纯函数，撤销是文档快照。这是很好的地基，但快照只够“回滚”，不够“看见”。

本期改为：

```
UI 操作 ─┐
MCP 操作 ─┼─▶ applyCommand(Command) ─▶ 纯函数 ops ─▶ Project
          │                              │
          └────────────── OpEvent ◀──────┘
                                   │
                                   ├─▶ Agent 活动流
                                   ├─▶ 时间线高亮
                                   └─▶ 撤销/重做（按命令分组）
```

关键原则：

- **所有写操作都必须携带 `actor`、`label`、`sessionId`。**
- **Agent 只能发命令，不能直接改内存或 UI。**
- **一条命令 = 一个撤销步骤。** 连续拖拽通过 `coalesceKey` 合并成一条命令。
- **事件日志有界**（内存环形缓冲，默认 1000 条），避免长时间会话吃内存。

### 3.2 状态权威仍在 webview

当前阶段采用最小形态：

```
外部 Harness ──MCP──▶ Rust（本地 HTTP + token）
                         │  command / result
                         ▼
                   Tauri Webview（Pinia，权威状态）
                         │
                         ▼
                   Tauri UI（实时渲染）
```

- 工程状态仍然只在 webview 的 Pinia store 里。
- Rust 负责 MCP 接入、命令转发、现有 ffmpeg / 文件 IO。
- 媒体继续走 Tauri asset 协议，服务对象只有 Tauri webview。
- 这样 ops 只有一份 TypeScript 实现，状态层保持在 webview。

### 3.3 命令必须是数据，不是函数

`dispatch(mutate)` 接收的是函数，无法跨进程、无法序列化、无法审计。Agent 入口需要一层可序列化的命令：

```ts
type CommandKind =
  | "asset.add"
  | "clip.add"
  | "clip.update"
  | "clip.remove"
  | "clip.split"
  | "clip.trim"
  | "track.add"
  | "track.update"
  | "track.remove"
  | "project.rename";
```

- 每个 `kind` 在 `src/core/commands/` 注册一个 reducer，内部调用现有 `core/ops` 纯函数。
- reducer 返回 `{ doc, affected }`；`affected` 用于 UI 高亮和活动流。
- 人类 UI 逐步迁移到同一套命令；迁移完成前，`dispatch` 保留为内部快捷方式，并默认 `actor: "human"`。

### 3.4 Rust 与 webview 的请求/响应

MCP 工具调用需要同步拿到结果：

1. Rust 生成 `commandId`，向前端 emit `agent-command`。
2. 前端 `applyCommand` 成功后 emit `agent-command-result`，带上 `commandId`、`revision`、`affected`、`error`。
3. Rust 用 `commandId` 关联等待中的请求，超时返回明确错误。
4. 同一会话的命令串行执行；并发调用排队，避免乱序。

长任务（素材导入、渲染）立即返回 `accepted`，进度通过 `agent-status` 事件推送。

## 4. 数据模型

新增 `src/types/events.ts`（或并入 `src/types/project.ts`）：

```ts
type Actor = "human" | "agent";

interface Command {
  id: string;
  /** 命令基于的文档版本；过期则拒绝或要求重新读取。 */
  baseRevision: number;
  actor: Actor;
  /** Agent 会话 id；人类操作为空。 */
  sessionId?: string;
  kind: CommandKind;
  payload: unknown;
  /** 人类可读，例如「在 00:12 插入 B-roll」。 */
  label: string;
  timestamp: number;
}

interface Affected {
  clipIds: string[];
  trackIds: string[];
  assetIds: string[];
  /** 受影响的时间区间（秒），用于时间线定位。 */
  range?: [number, number];
}

interface OpEvent {
  revision: number;
  command: Command;
  affected: Affected;
  durationMs: number;
  error?: string;
}

type AgentPhase =
  | "idle"
  | "reading"
  | "planning"
  | "generating"
  | "importing"
  | "applying"
  | "rendering"
  | "done"
  | "error";

interface AgentSession {
  id: string;
  title: string;
  phase: AgentPhase;
  /** 当前动作的人类可读描述。 */
  detail?: string;
  /** Agent 当前关注的时间点 / 片段。 */
  focus?: { time: number; clipId?: string; trackId?: string };
  startedAt: number;
  updatedAt: number;
}
```

版本策略：

- `revision` 先放在 store 与 Op Log 中，不改 `PROJECT_VERSION`。
- 后续需要跨会话回放时，再把 `revision` 作为可选字段写入工程 JSON，由 `parseProject` 归一化为 `0`。

## 5. 实时 UI

### 5.1 Agent 面板

把现有 `AiPane.vue` 从占位改成实时活动面板：

- 会话标题、阶段、当前任务、开始时间。
- 活动流：每条包含操作者、命令 label、受影响片段、耗时、错误。
- 点击一条事件：播放头跳到对应时间，选中受影响片段。
- 错误以可读文案展示，不吞异常。

### 5.2 时间线

- **Agent 光标**：与人类播放头不同颜色，显示 Agent 当前 focus。
- **受影响片段高亮**：收到 `OpEvent` 后短暂描边/脉冲，`prefers-reduced-motion` 下取消动画。
- **操作反馈**：新增片段淡入、移动片段用 CSS transform 过渡；避免触发布局抖动。
- **Follow 模式**：默认关闭；开启后时间线自动滚动到 Agent focus，人类拖动即退出跟随。

### 5.3 顶栏

- 一个轻量状态 chip：`AI 空闲 / AI 正在编辑 / AI 等待 / AI 出错`。
- 不弹 toast，不打断人类操作；错误进入活动流和状态 chip。

### 5.4 高频事件的节流

- 拖拽 / 滑杆：只记录最终命令，不记录每一帧。
- Agent 光标与播放头：最多 30fps 更新。
- 活动流：同一 `coalesceKey` 的连续操作合并展示。
- 事件 payload 只带 `affected`，不重复传整份 Project。

## 6. A 阶段里程碑

### A0 — 命令与事件地基

**目标**：所有写操作都能被描述、排序、归因、回放。

- [ ] 定义 `Actor` / `Command` / `Affected` / `OpEvent` / `AgentSession` / `AgentPhase`。
- [ ] 建立 `src/core/commands/` 命令注册表，覆盖现有 UI 用到的 op。
- [ ] `project store` 增加 `revision`、`applyCommand`、`opLog`、`subscribe`。
- [ ] 校验 `baseRevision`；过期命令拒绝并返回可读错误。
- [ ] 按命令粒度撤销/重做；连续拖拽合并为一条命令。
- [ ] 现有 UI 操作逐步迁移到 `applyCommand`，未迁移的 `dispatch` 默认记 `actor: "human"`。
- [ ] 单元测试：revision 顺序、并发队列、命令校验、撤销分组、日志上限。

**验收**：任意一次剪辑操作都会产生一条可读的 `OpEvent`；撤销一次回到上一条命令之前。

### A1 — 最小 MCP 入口

**目标**：外部 Harness 能安全、可预期地驱动当前工程。

- [ ] Rust 侧启动本地 MCP HTTP 服务（`127.0.0.1`，随机端口，启动 token）。
- [ ] 写入发现文件（端口、token、pid），供 Harness 读取。
- [ ] 工具集最小化：
  - `project.get`：返回当前 revision、工程摘要、可选片段列表。
  - `timeline.apply`：提交一条 `Command`。
  - `agent.setStatus`：更新会话/阶段/焦点。
- [ ] Rust ↔ webview 的 `agent-command` / `agent-command-result` 桥接，带超时与错误传播。
- [ ] 同一会话命令串行；同一时刻只允许一个 Agent 写者。
- [ ] 工具参数做 schema 校验；拒绝未知 `kind`、超大 payload、越权路径。
- [ ] 安全：仅 localhost、token 校验、无 shell、无任意文件访问。

**验收**：本地 MCP 客户端能读取工程、提交一条移动/插入命令，并在 UI 中看到结果。

### A2 — 实时可见

**目标**：人类不需要刷新或询问，就能看懂 AI 在做什么。

- [ ] 新增 `src/stores/agent.ts`：会话、阶段、focus、最近事件。
- [ ] `AiPane.vue` 改为实时活动面板。
- [ ] 顶栏状态 chip。
- [ ] 时间线 Agent 光标 + 受影响片段高亮 + 片段变化过渡。
- [ ] Follow 模式（默认关闭，可随时退出）。
- [ ] 事件节流与合并，避免拖拽/高频操作刷屏。
- [ ] 错误状态：MCP 超时、命令校验失败、webview 忙，都有明确文案。

**验收**：Agent 提交命令后，UI 在一个渲染帧内反映时间线变化；活动流出现对应条目；Agent 光标定位到受影响区间。

### A3 — 验收与打磨

- [ ] 端到端脚本：Agent 连续提交 3 条命令（插入、裁剪、改名），UI 全部实时可见。
- [ ] 人类在 Agent 操作期间继续编辑，命令串行且无丢失。
- [ ] 撤销/重做在混合操作下正确。
- [ ] 1000 条事件下无内存增长、无明显卡顿。
- [ ] `npm run build`、`cargo check`、`npx vitest run` 全绿。
- [ ] 手动验收：macOS 深/浅色、1440×900 与最小窗口尺寸。

## 7. 后续阶段

A 完成后，R / S / M / H 可以并行推进；K 依赖前面的工具面与素材能力稳定。

| 阶段 | 主题 | 依赖 |
| --- | --- | --- |
| R | 审阅、提案与接管 | A |
| S | 字幕与转写校对 | A；与 R 联动 |
| M | 多视频层与合成原语 | A |
| H | HTML 场景素材 | A、M |
| K | Skills | R / S / M / H 稳定后 |

### R — 审阅、提案与接管

**目标**：AI 先提案，人逐条审阅、批准或接管，AI 再继续。

**关键能力**

- Change Set：Agent 默认提交 pending 变更，不直接落盘。
- 时间线 diff：新增、删除、移动、裁剪、变速、字幕修改。
- 改前/改后对比播放；逐条接受或拒绝。
- 评论锚定到片段或时间区间，可回复、可 resolve。
- 单写者租约：Agent 与人类不同时写；人可暂停 Agent、接管、再交回。
- 版本历史与恢复。

**验收**：Agent 提交 3 条变更；人接受 2 条、拒绝 1 条并留言；Agent 基于新 revision 重提；接管与交回不丢状态。

### S — 字幕与转写校对

**目标**：字幕作为结构化数据，支持 AI 提案 + 人工校对。

**关键能力**

- 转写模型：词级 `text / start / end / confidence / speaker`。
- 独立字幕轨；点击词跳转、低置信度高亮、查找替换、术语一致性检查。
- 改词不破时间；改时间可 ripple；字幕样式是数据。
- AI 通过命令/提案纠错，人逐条接受。
- 导出 SRT / VTT 与烧录两种路径。

**验收**：导入转写 → 校对 → 接受 AI 纠错 → 导出，时间与文本始终对齐。

### M — 多视频层与合成原语

**目标**：同屏多视频、变速、静态蒙版、转场素材叠加，预览与导出行为一致。

**关键能力**

- 预览从单个常驻 `<video>` 升级为 video pool；按轨道/片段管理元素、层级、透明度与变换。
- `Clip.speed`：预览用 `playbackRate` + Web Audio rate，导出用 `setpts` + `atempo`。
- 静态蒙版素材：`mask: { assetId, mode }`；预览用 CSS `mask-image`，导出用 `alphamerge` / `maskedmerge`。
- 转场作为素材：AI/Harness 生成带 alpha 的转场片段或 PNG 序列，App 负责 overlay；转场能力通过素材扩展。
- Alpha 约束：优先预合成场景或 PNG 序列，规避 WKWebView 对 alpha 视频支持不稳定的问题。
- 多视频层预览的 proxy / 转码，保证时间线拖动流畅。
- 扩展导出计划并补齐“预览 vs 导出”一致性测试。

**验收**：两条视频轨同屏可见；透明度叠化生效；0.5x / 2x 变速预览与导出一致；静态蒙版生效；转场素材可叠加。

### H — HTML 场景素材

**目标**：AI 生成的 HTML/JS/CSS 场景作为一等素材，可预览，也能进入最终成片。

**关键能力**

- 新增场景素材类型（`kind: "scene"`）：引用一个场景目录，包含 HTML / JS / CSS / 本地资源。
- 预览用 sandbox iframe，通过 `postMessage` 驱动 `seek(t)`；只在时间线覆盖时挂载。
- 确定性契约：`duration`、`ready()`、`seek(t)`、可选 `renderFrame(t)`；禁用网络、`Date.now`、`Math.random` 和不受控动画。
- 场景运行时 shim：固定字体、资源加载、时间与随机数注入、错误上报。
- 两条渲染路径：
  - **烘焙优先**：Harness 用浏览器把场景渲染成视频 / PNG 序列，App 作为普通素材导入。
  - **场景自渲染**：canvas / WebGL 场景实现 `renderFrame(t)`，App 批量取帧后交给 ffmpeg。
- 场景生命周期：编辑、重新烘焙、重新链接、来源记录（prompt / 场景路径 / 产物 hash）。
- 工程内使用相对路径，保证场景与工程可一起移动。

**验收**：场景片段在时间线上可预览；多个时间点的 `seek(t)` 结果一致；烘焙产物可导入并正常导出。

### K — Skills

**目标**：把可复用的剪辑工作流沉淀成 Harness 侧的 playbook，让 AI 按项目约定稳定执行。

**关键能力**

- 工程级 `skills/` 目录：Markdown playbook、示例、工具说明、项目约定。
- 稳定的 MCP 工具面与文档：读取工程、提交命令、导入素材、查询转写、启动烘焙/导出。
- Skill 覆盖典型流程：生成 B-roll 并插入、统一节奏、字幕校对、生成转场素材、批量套用片头片尾。
- 项目约定：帧率、分辨率、命名、素材目录、字幕样式、输出规格。
- Skill 发现、校验与版本记录；同一输入可重复得到同一结果。
- 与 R 的提案模式配合：Skill 默认产出提案，人批准后落盘。

**验收**：一个 Skill 文件可以通过 MCP 驱动一段可重复的多步剪辑；换一个工程仍按约定执行；结果可审阅、可回滚。

## 8. A 阶段验收标准

1. AI 通过 MCP 执行操作时，Tauri 界面无需刷新即可看到时间线变化。
2. 人类能看出“谁改了什么、改在哪里、什么时候改的”。
3. Agent 与人类的操作都经过同一条命令总线，可归因、可撤销。
4. 命令总线与活动流完全在本地进程内完成，不依赖外部服务。
5. 媒体继续走 Tauri asset 协议，工程状态保持在 webview。

## 9. 设计约束

- 复用现有 `core/ops` 纯函数，不复制剪辑逻辑。
- 复用 MD3 设计令牌与现有组件，不引入新设计体系。
- 注释用中文、JSDoc 风格；标识符用英文。
- TypeScript `strict`，类型导入写 `import type`。
- 事件与命令的 payload 必须可 JSON 序列化。
- 不把派生数据（缩略图、波形）写进 Op Log。
- 不在 UI 线程做重活；导入/渲染继续走 Rust 与 sidecar。

## 10. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 命令注册表改造面大 | 现有 UI 调用点需要迁移 | `dispatch` 保留为人类快捷方式；按面板逐步迁移；先覆盖高频 op |
| Rust ↔ webview 桥接超时/死锁 | MCP 调用挂起 | 命令串行队列、明确超时、webview 忙时快速失败 |
| 高频操作刷屏 | 活动流不可读、性能下降 | `coalesceKey` 合并、30fps 节流、只记最终命令 |
| Agent 与人类并发写 | 丢更新 | 单写者队列 + `baseRevision` 校验；过期命令拒绝并提示重读 |
| 事件 payload 过大 | IPC 卡顿 | 只传 `affected` 与元数据；快照按需拉取 |
| Agent 操作不可撤销 | 人类不敢让 AI 动手 | 一条命令一个撤销步骤；活动流提供单条撤销入口 |
| MCP 暴露面过大 | 本地安全问题 | localhost + token + 工具白名单 + 参数校验 + 无 shell |
| App 未运行导致 MCP 不可用 | 外部 Harness 报错 | 明确错误文案；提示先启动 AI Cut |
| 预览与导出保真度差异 | 审阅结论不可靠 | A 阶段只做可见性；M/H 阶段补齐一致性测试 |

## 11. 文件影响（A 阶段预估）

**新增**

| 文件 | 职责 |
| --- | --- |
| `src/types/events.ts` | `Command` / `OpEvent` / `AgentSession` 等类型 |
| `src/core/commands/index.ts` | 命令注册表与 reducer |
| `src/core/commands/__tests__/` | 命令、revision、日志测试 |
| `src/stores/agent.ts` | Agent 会话、阶段、focus、最近事件 |
| `src-tauri/src/mcp.rs` | 本地 MCP HTTP 服务与桥接 |

**修改**

| 文件 | 改动 |
| --- | --- |
| `src/stores/project.ts` | `revision`、`applyCommand`、`opLog`、`subscribe`、按命令撤销 |
| `src/components/workspace/panes/AiPane.vue` | 占位改为实时活动面板 |
| `src/components/workspace/TimelinePane.vue` | Agent 光标、跟随滚动 |
| `src/components/workspace/TimelineClip.vue` | 受影响片段高亮与过渡 |
| `src/components/layout/TopBar.vue` | Agent 状态 chip |
| `src-tauri/src/lib.rs` | 注册 MCP 服务与应用生命周期 |
| `src-tauri/Cargo.toml` | MCP / HTTP 相关依赖 |
| `src-tauri/capabilities/default.json` | 如有新的窗口/事件权限 |

**保持稳定**

- `src/core/ops/*` 的纯函数语义。
- `src/core/export/*` 的导出管线。
- `src/core/playback/*` 的播放模型。
- `PROJECT_VERSION`（A 阶段不升版本）。

## 12. 下一步

1. 确认 A0 的命令清单：先覆盖 UI 当前实际用到的 op（移动、裁剪、分割、删除、增删轨道、素材、改名）。
2. 先做 `applyCommand` + `OpEvent`，不改 UI；用测试和临时调试面板验证事件流。
3. 再接 MCP，最后接实时 UI。
4. 每完成一个里程碑，更新本文的复选框与验收记录。

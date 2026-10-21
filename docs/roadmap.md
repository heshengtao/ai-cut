# AI Cut — AI 协作路线图

> 更新时间：2026-10-20
> 当前阶段：**A — 剪辑智能体 + MCP + CLI/Skills 基础设施**
> 本文是产品与架构路线图，不替代 `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 里的具体实现文档。

## 0. 一句话定位

**AI 剪，人审片。**

AI Cut 是一个本地优先、轻量的剪辑工作台：AI 通过 MCP 工具或 `aicut` 命令行驱动时间线，人在应用里实时看到结果、随时接管；内置的「剪辑智能体」提供对话式入口，但不是唯一的 AI 入口。

## 1. 产品结构

AI 视频链路拆成三层：

| 层 | 谁在做 | AI Cut 的位置 |
| --- | --- | --- |
| 生成层：模型、浏览器、HTML/Canvas 场景、素材 | 外部 Harness / 各家模型 | 交给外部 Harness |
| 执行层：时间线、剪辑、合成、导出 | CapCut / Resolve / Premiere | 保留轻量、可数据化的核心原语 |
| **交接层：AI 操作 → 人看见 → 人判断 → AI 继续** | 几乎没有成熟方案 | **主战场** |

AI Cut 提供三个面：

1. **剪辑智能体**：应用内对话式剪辑，流式回答、工具调用、会话树与分支。
2. **AI 功能**：MCP 服务器、CLI/Skills 入口，以及后续 AI 能力的统一列表。
3. **设置**：AI 与 MCP、网络代理、命令行挂载。

## 2. 当前架构

### 2.1 唯一写入口：命令总线

```
界面操作 ─┐
MCP 工具 ─┼─▶ apply_command / project.apply ─▶ 纯函数 ops ─▶ Project
内置智能体 ┘                                      │
                                                  └─▶ OpEvent / 撤销历史
```

- `src/core/commands/`：可序列化命令注册表（素材、片段、轨道、改名）。
- `src/stores/project.ts`：`revision`、`applyCommand`、`opLog`、按命令撤销。
- 所有写操作都进入同一套撤销历史；MCP 和智能体与鼠标操作不可区分。
- 过期 `baseRevision` 会被拒绝，保证单写者语义。

### 2.2 Rust ↔ webview 桥接

- `src-tauri/src/bridge.rs`：`ProjectBridge` 发 `project-request`，前端执行后 `bridge_respond`。
- `src/core/mcpBridge.ts`：前端桥接，处理 `project.get` / `project.apply` / `project.undo` / `project.redo`。

### 2.3 MCP 服务器

- `src-tauri/src/mcp.rs`：本地 Streamable HTTP / JSON-RPC，绑定 `127.0.0.1`。
- 配置 `mcp.json`（`enabled` / `port`，默认 50563）；运行时把实际地址写入 `mcp-url`。
- 工具面与内置智能体共用 `src-tauri/src/tools.rs`。

### 2.4 剪辑智能体

- `src-tauri/src/agent/`：OpenAI 兼容 Chat Completions、SSE 流式、工具调用、会话树持久化。
- `src/stores/agent.ts`：流式正文 / 思考 / 工具卡片、分支、历史。
- `src/components/workspace/agent/`：`ClipAgentPanel`、`AgentTurn`、`AgentComposer`、工具卡片等。
- 会话落盘为 `agent/sessions/<id>.json`；配置落盘为 `ai.json`。

### 2.5 CLI 与 Skills

- `crates/aicut`：薄 MCP 客户端，子命令 `tools` / `call` / `status` / `start`。
- `aicut` 按名转发 MCP 工具；新增工具不需要改 CLI。
- 发现顺序：`AICUT_MCP_URL` → `<配置目录>/mcp-url` → 默认端口。
- `cli-path` 每次启动写入包内二进制全路径；设置页可控是否挂载到 PATH。
- `skills/aicut/SKILL.md` + `references/*.md` 通过 `include_str!` 嵌入，`aicut_help` 按域取用。

### 2.6 网络

- `src-tauri/src/network.rs`：直连 / 系统代理 / 手动代理，落在 `network.json`。
- 代理应用到剪辑智能体的 HTTP 客户端；系统代理优先读环境变量，macOS 额外读取 `scutil --proxy`。
- 设置页可测试代理连通性，测试不写盘。

## 3. 当前阶段已完成

### A0 — 命令与事件地基

- [x] 可序列化命令、revision、事件日志、按命令撤销。
- [x] 人类 UI 走 `dispatch` 兼容路径，MCP / 智能体走 `applyCommand`。
- [x] 过期命令拒绝、同轨重叠校验、命令参数校验。
- [x] 单元测试覆盖命令、revision、撤销分组、日志上限。

### A1 — 剪辑智能体

- [x] OpenAI 兼容配置（base URL / API key / model）、模型列表、连通性测试。
- [x] SSE 流式正文与思考、工具调用、工具结果卡片。
- [x] 会话树、分支切换、历史列表、编辑后重答。
- [x] 工具面与 MCP 共用：`get_project` / `apply_command` / `import_asset` / `undo` / `redo` / `aicut_help`。

### A2 — MCP 服务器

- [x] 设置页启用 / 端口 / 状态 / 端点复制。
- [x] `mcp.json` 持久化、`mcp-url` 运行时发现、端口占用自动回退。
- [x] JSON 与 SSE 两种响应，兼容外部 MCP 客户端与 `aicut`。
- [x] 仅监听回环地址。

### A3 — CLI / Skills / 设置

- [x] `aicut` 薄客户端与构建脚本；Tauri `externalBin` 打包。
- [x] 命令行设置：挂载开关、状态、命令、全路径、手工命令。
- [x] Skills 文档、`aicut_help` 渐进式披露、智能体系统提示注入索引。
- [x] 网络代理设置与代理测试。

### 验证

- `npm run build` 通过。
- `npx vitest run` 通过（165 个测试）。
- `cargo check`、`cargo test --lib` 通过。
- 真实实例验证：`aicut status`、`aicut tools`、`get_project`、`apply_command`、`aicut_help`。
- 浏览器渲染检查：剪辑智能体、AI 功能、AI 与 MCP / 网络 / 命令行设置。

## 4. 工具面

| 工具 | 用途 |
| --- | --- |
| `get_project` | 读取工程、revision、轨道/片段/素材 id |
| `apply_command` | 执行可序列化命令（track / clip / asset / project） |
| `import_asset` | ffprobe 探测并加入素材库 |
| `undo` / `redo` | 撤销 / 重做 |
| `aicut_help` | 按域取技能文档；留空给索引 |

命令 kind：`project.rename`、`project.output`、`track.add/update/remove/move`、`asset.add/remove/update`、`clip.add/update/remove/move/trim/split`。

## 5. 后续阶段

| 阶段 | 主题 | 依赖 |
| --- | --- | --- |
| R | 审阅、提案与接管：变更集、时间线 diff、逐条批准、评论 | A 的命令总线 |
| S | 字幕与转写校对：词级时间戳、置信度、SRT/VTT、烧录 | A + R |
| M | 多视频层与合成原语：video pool、变速、静态蒙版、转场素材 | A |
| H | HTML 场景素材：sandbox iframe、确定性 seek、烘焙导入 | A、M |
| K | Skills 扩展：更多能力域、项目约定、可复用 playbook | A 的工具面 |

## 6. 风险与约束

| 风险 | 应对 |
| --- | --- |
| 端口/多实例冲突 | `mcp-url` 记录实际地址；端口占用自动回退；建议单实例运行 |
| 本机进程可连 MCP | 仅回环 + 设置页安全提示；只运行可信 Harness |
| 模型端点不稳定/不支持工具 | 设置页测试连通性；智能体错误进入事件流与通知 |
| 智能体一次改太多 | 一条命令一个撤销步；Skills 明确要求拆小步 |
| 预览/导出保真度差异 | 本期只保证时间线可见；渲染统一放到后续阶段 |
| 会话事件在切面板时丢失 | 事件订阅放在根组件，面板切换不取消 |

## 7. 文件地图

**前端**

- `src/types/events.ts`、`src/types/agent.ts`
- `src/core/commands/`、`src/core/mcpBridge.ts`、`src/core/agentApi.ts`
- `src/stores/project.ts`、`src/stores/agent.ts`
- `src/components/workspace/agent/`（智能体面板与消息组件）
- `src/components/workspace/panes/AiPane.vue`（AI 功能）
- `src/components/settings/SettingsView.vue`（AI/MCP、网络、命令行）
- `src/components/workspace/PanelTabs.vue`、`RightPanel.vue`

**Rust**

- `src-tauri/src/bridge.rs`、`tools.rs`、`mcp.rs`
- `src-tauri/src/agent/{mod,config,store,openai}.rs`
- `src-tauri/src/network.rs`、`cli.rs`
- `crates/aicut/`（薄客户端）
- `skills/aicut/`（技能文档）

## 8. 下一步

1. 在真实窗口里做一次深/浅色、1440×900 与最小尺寸的目视验收。
2. 配置一个支持工具调用的 OpenAI 兼容端点，跑一次「读工程 → 加轨 → 插片段」闭环。
3. 进入 R / S / M / H 前确定优先级；R（审阅/提案）最贴近「人审片」的定位。

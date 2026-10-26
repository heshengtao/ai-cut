# AI Cut — 路线图

> 更新时间：2026-10-21
> 当前阶段：**收尾验收**（P0–P5 已完成）
> 本文是产品与架构路线图，不替代 `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 里的具体实现文档。

## 0. 一句话定位

**AI 剪，人审片。**

AI Cut 是一个本地优先、轻量的剪辑工作台：AI 通过 MCP 工具或 `aicut` 命令行驱动时间线，人在应用里实时看到结果、随时接管；内置「剪辑智能体」提供对话式入口，但不是唯一的 AI 入口。

## 1. 当前状态

### 1.1 唯一写入口：命令总线

```
界面操作 ─┐
MCP 工具 ─┼─▶ apply_command / apply_commands ─▶ 纯函数 ops ─▶ Project
内置智能体 ┘                                      │
                                                 └─▶ OpEvent / 撤销历史
```

- `src/core/commands/`：可序列化命令注册表（素材、片段、轨道、标记、工程）。
- `src/stores/project.ts`：`revision`、单条 / 批量命令、`opLog`、快照撤销。
- 批量命令在草稿上顺序执行，全部成功才提交一次 `revision` / 一个撤销步；失败整批回滚。
- 过期 `baseRevision` 会被拒绝，保证单写者语义。

### 1.2 Rust ↔ webview 桥接

- `src-tauri/src/bridge.rs`：`ProjectBridge` 发 `project-request`，前端执行后 `bridge_respond`。
- `src/core/mcpBridge.ts`：前端桥接，按方法返回概览、轨道页、单片段、检索结果或写入结果。
- 读取是渐进的：桥接只回传当前关注的那一片，不再把整份工程送到 Rust 再截断。

### 1.3 MCP 服务器与工具面

- `src-tauri/src/mcp.rs`：本地 Streamable HTTP / JSON-RPC，绑定 `127.0.0.1`。
- 配置 `mcp.json`（`enabled` / `port`，默认 50563）；运行时把实际地址写入 `mcp-url`。
- 工具面与内置智能体共用 `src-tauri/src/tools.rs`。
- `crates/aicut`：薄 MCP 客户端，子命令 `tools` / `call` / `status` / `start`。
- `skills/aicut/`：`SKILL.md` + `references/*.md`，通过 `include_str!` 嵌入，`aicut_help` 按域取用。

### 1.4 已完成能力

**地基**

- [x] 可序列化命令、revision、事件日志、快照撤销。
- [x] 人类 UI 走 `dispatch`，MCP / 智能体走 `applyCommand`。
- [x] 过期命令拒绝、同轨重叠校验、片段范围 / 素材存在 / 时长校验。
- [x] 批量事务 `apply_commands`。
- [x] 轨道名、`trackId` 支持 id 或 1 起始 index。

**自动化剪辑**

- [x] 确定性宏：`append_clip`、`duplicate_clips`、`ripple_delete`、`extract_audio`。
- [x] 工程生命周期：`new_project`、`open_project`、`save_project`。
- [x] 渐进式读取：`get_project` 概览、`get_context`、`get_track`、`get_clip`、`find_clips`、`get_assets`。
- [x] AI 工具：转写、翻译配音、朗读、分离、降噪、响度、超分、补帧、重构、视频 DSP、导出、模型管理。

**界面能力**

- [x] 轨道重命名；轨道头显示真实名称。
- [x] 片段复制（⌘D / 工具栏）。
- [x] 波纹删除（Shift+Delete / 工具栏）。
- [x] 多选批量编辑常见属性（不透明度、混合模式、变换、文字样式、描边、阴影、圆角、增益、淡入淡出、变调、声像、静音）。
- [x] 变速（0.1–4x），预览、导出、裁剪、分割保持一致。
- [x] SRT / VTT 导入导出；时间线标记（增删改、双击重命名、右键删除）。
- [x] 静帧渲染：`render_frame` + 预览面板“导出当前帧”。
- [x] 分割、左右裁剪、普通删除、吸附、拖动排序、文本预设。

### 1.5 当前工具面

| 类别 | 工具 |
| --- | --- |
| 读取 | `get_project`、`get_context`、`get_track`、`get_clip`、`find_clips`、`get_assets`、`get_markers`、`list_ai_models`、`aicut_help` |
| 剪辑 | `apply_command`、`apply_commands`、`append_clip`、`set_clip_speed`、`set_clip_color`、`set_clip_transition`、`set_clip_keyframes`、`duplicate_clips`、`ripple_delete`、`extract_audio`、`import_asset`、`undo`、`redo` |
| 字幕 | `import_subtitles`、`export_subtitles` |
| 标记 | `add_marker`、`update_marker`、`remove_marker`；审片用 `add_review_note`、`list_review_notes`、`update_review_note`、`remove_review_note` |
| 工程 | `new_project`、`open_project`、`save_project` |
| 音频 AI | `transcribe`、`translate_audio`、`synthesize_voiceover`、`separate_stems`、`denoise_audio`、`process_audio`、`measure_loudness` |
| 视频 AI | `upscale_video`、`interpolate_video`、`reframe_video`、`process_video` |
| 产出 | `export_video`、`render_frame`、`render_storyboard`、`download_model`、`cancel_ai` |
| 审片 / 增量渲染 | `import_film_manifest`、`export_film_manifest`、`render_status`、`render_range`、`render_manifest`、`compare_takes`、`render_contact_sheet` |
| 异步 | `job_start`、`job_status`、`job_cancel` |

### 1.6 已知边界

- 预览只保证时间线可见与当前属性一致；复杂合成以导出结果为准。
- 字幕可以 SRT/VTT 交换，但时间线里仍是文字片段，不是独立实体。
- 长任务可以用 `job_start` 异步跑；同一时间只允许一个 AI 任务，没有并行队列。
- 转场是片段入场/出场动画，不是相邻片段重叠式交叉淡化。
- 调色在预览中是近似效果，最终以导出结果为准。
- 单轨片段不允许重叠；插入冲突需要顺延或换轨。

## 2. 路线图

### P0 — 能力对齐（已完成）

目标：让界面具备 agent 已经能做的操作，避免“AI 能改、人看不见/改不了”。

- [x] 轨道名显示与双击重命名。
- [x] `track.update` 支持 `name`。
- [x] 片段复制：⌘D、工具栏、复制后自动选中新片段。
- [x] 波纹删除：Shift+Delete、工具栏。
- [x] Inspector 多选批量编辑常见属性。
- [x] 单元测试覆盖重命名、复制、波纹删除、批量事务。

### P1 — 字幕与标记（已完成）

目标：把字幕从“文字片段”升级为可交换的数据，并给时间线加可定位的标记。

- [x] SRT / VTT 解析与序列化纯函数。
- [x] 字幕导入：选择 `.srt` / `.vtt`，在置顶文字轨生成片段。
- [x] 字幕导出：从文字轨导出 SRT / VTT。
- [x] MCP：`import_subtitles` / `export_subtitles`。
- [x] 标记模型：`Marker { id, time, name, color }`。
- [x] 标记命令：`marker.add` / `marker.update` / `marker.remove`。
- [x] 标记 UI：标尺显示标记、点击定位、双击重命名、右键删除；`M` 在播放头添加。
- [x] MCP：`get_markers` / `add_marker` / `update_marker` / `remove_marker`。
- [x] 测试：字幕往返、时间映射、标记增删改。

### P2 — 时间重映射（已完成）

目标：支持变速 / 慢动作，并保证预览与导出一致。

- [x] `Clip.speed`（默认 1，范围 0.1–4）。
- [x] 时间线时长与素材区间解耦：`duration * speed <= asset.duration - in`。
- [x] 播放引擎：视频 `playbackRate`、音频 `playbackRate` 与调度偏移。
- [x] 导出滤镜：视频 `setpts`、音频 `atempo` 多级拆分。
- [x] Inspector 变速控件；`clip.speed` 命令与 `set_clip_speed` 工具。
- [x] 裁剪 / 分割在变速下的边界。
- [x] 测试：模型、裁剪、分割、播放映射、导出计划。

### P3 — 画面自检（已完成）

目标：让 agent 能“看一眼”时间线，而不是只读 JSON。

- [x] 复用导出滤镜链路实现 `render_frame`（指定时间、分辨率、输出路径）。
- [x] 复用现有 `export_video` Tauri 命令输出单帧 PNG，不新增重复的 ffmpeg 执行器。
- [x] MCP 工具 `render_frame`。
- [x] 预览面板“导出当前帧”按钮。
- [x] 测试：单片段、时间边界、输出参数。
- [x] `render_storyboard`：按多个时间点连续输出 PNG 自检。

### P4 — 合成原语（已完成）

目标：补齐真正需要渲染模型的功能。

- [x] 调色：亮度 / 对比度 / 饱和度 / 色温 / 色调；预览用 CSS filter，导出用 `eq` / `colorbalance`。
- [x] 转场：片段入/出转场（淡化、滑动），预览与导出共用同一套时间曲线。
- [x] 关键帧：每个关键帧记录全部画面参数（opacity / x / y / scale / rotation）；预览线性插值，导出用 ffmpeg 表达式与 `geq`。
- [x] 每个原语都走命令总线，并提供 MCP 工具与 Inspector UI 入口。
- [x] 测试：调色/转场/关键帧的归一化、命令与导出计划。
- [ ] 重叠式交叉淡化（需要允许受控片段重叠）留到后续；当前转场是片段的入场/出场动画。
- [ ] 关键帧不透明度导出使用 `geq`，大项目性能需要实测；必要时改为分段烘焙。

### P5 — 异步任务 API（已完成，单任务）

目标：长任务不再阻塞 MCP 客户端。

- [x] `job_start` / `job_status` / `job_cancel` 工具。
- [x] 复用前端现有 AI job 系统与进度，不在 Rust 重复维护任务表。
- [ ] 并行排队：当前同一时间只允许一个 AI 任务，后续需要拆开各 AI store 的单例状态。
- [x] Skills 文档说明何时用同步工具、何时用异步任务。

### P6 — 审片闭环与增量渲染（已完成）

目标：让 AI Cut 成为 agent 的“眼睛和耳朵”，而不是又一个剪辑器。

- [x] `film.json` 共享清单：`import_film_manifest` / `export_film_manifest`，写回时保留 AI DAW 的 `music`。
- [x] 结构化审片：marker 增加 `kind` / `sceneId` / `note` / `severity` / `resolved` / `bbox` / `screenshot` / `tags`，配套 `add_review_note` / `list_review_notes` / `update_review_note` / `remove_review_note`。
- [x] 窗口化导出计划：`buildExportPlan` 支持 `{start,end}`，只编译窗口内片段，全片路径保持逐字节回归。
- [x] 内容哈希缓存：键 = 窗口内工程 + 素材 `{size,mtimeMs}` + 输出规格；`render_status` 只算脏段。
- [x] `render_range` / `render_manifest` 走异步 job，修掉 `render_storyboard` 的 20s 桥接超时隐患。
- [x] `compare_takes`（SSIM + 并排帧）与 `render_contact_sheet`（接触表 + 图例 JSON）。
- [x] UI：marker 按 severity 着色、tooltip 显示备注、双击打开审片对话框。
- [x] 文档：`docs/film-manifest.md`、`skills/aicut/references/render.md`。
- [ ] M2：AI DAW 消费 `film.json`（cue sheet 导入、stems 导出、instrument map）。

### P7 — OFX 宿主（已完成）

目标：把插件管理器接上真正的 OpenFX 渲染，而不是只做下载。

- [x] `crates/ofx-host`：OFX 1.5.1 ABI、属性 / 参数 / 图像 / 多线程套件，按输入尺寸渲染（无 720×576 硬编码）。
- [x] `ofx-host` CLI：`probe <bundle>` 输出插件与参数表（类型 / 范围 / 默认值 / 枚举）；`render <bundle> <plugin> <input.ppm|rgba> <params.json> <output.ppm|rgba>`。
- [x] Rust 命令：`ofx_probe` / `ofx_render_frame` / `ofx_render_preview` / `ofx_bake_clip`。
- [x] `Clip.effects[]`、检查器效果链、独立「参数」面板、应用到选中片段、多选混合值。
- [x] 预览：暂停时渲染当前帧并叠加；播放时隐藏。
- [x] 导出：带效果片段先烘焙成 ProRes 4444 中间文件，再进入现有 ffmpeg 计划；音轨仍读原素材。
- [x] 兼容性加固：参数 / 片段句柄不再因扩容失效；参数描述补齐 hint 等默认属性；支持 8/16/32 位像素深度；渲染前调用 `SyncPrivateData`；bundle 内可执行文件不再要求 `*.ofx` 后缀；安装时跳过 `__MACOSX` / AppleDouble 垃圾。
- [x] 回归样例：Stoatworks 9 件套、FsPlugins、ME_OpenDRT、ODT N6、Anime Smoother、Nikita Blend、QR Coder、MakeHDR、Boilify、Macroblock、DomeWarp 均通过 probe + render。
- [x] OFX image effect context 支持矩阵：
  - `filter` / `general`：单输入，可挂载到片段、暂停预览、整段烘焙、导出。
  - `generator`：可挂载到有画面的片段（生成器覆盖画面），预览 / 烘焙流程相同；暂不支持单独创建「生成器片段」。
  - `transition`：需要 `SourceFrom` / `SourceTo` 两路输入和重叠时间轴，当前不支持；添加入口会跳过并提示。
  - `paint` / `retimer`：需要交互绘制或改变片段时基，当前不支持。

## 3. 非目标

以下方向明确不在当前路线图内，相关文档和入口应逐步移除或标注为不实现：

- HTML / iframe 场景素材与 HyperFrames 集成。
- 云端协作、账号体系、多人实时编辑。
- 移动端 / Web 版编辑器。
- 插件市场与第三方 UI 扩展。
- 提案 / 变更集审阅面板（当前用撤销历史 + 事件流替代）。
- 内置转场素材库、字幕烧录模板市场。

## 4. 验证基线

每次阶段完成至少跑：

- `pnpm test`：前端单元测试。
- `pnpm exec vue-tsc --noEmit -p tsconfig.json`：类型检查。
- `pnpm build`：生产构建。
- `cargo test --manifest-path src-tauri/Cargo.toml tools:: --no-fail-fast`：工具层测试。
- 真实实例：`scripts/mcp-smoke.sh`、`aicut status` / `aicut tools`。

## 5. 文件地图

**前端**

- `src/types/`：工程、事件、AI、导出类型。
- `src/core/ops/`：不可变领域操作。
- `src/core/commands/`：可序列化命令注册表。
- `src/core/projectView.ts`：渐进式读取视图。
- `src/core/mcpBridge.ts`：MCP / 智能体 ↔ webview 桥接。
- `src/stores/project.ts`：revision、批量事务、撤销、事件流。
- `src/components/workspace/`：时间线、检查器、预览、AI 面板。
- `src/components/settings/`：AI / MCP、网络、命令行。
- `src/i18n/`：中英文文案。

**Rust**

- `src-tauri/src/bridge.rs`、`tools.rs`、`mcp.rs`
- `src-tauri/src/agent/{mod,config,store,openai}.rs`
- `src-tauri/src/export.rs`、`media.rs`
- `src-tauri/src/ofx.rs`（OFX 探测 / 预览 / 烘焙命令）
- `src-tauri/src/network.rs`、`cli.rs`
- `crates/ofx-host/`（OFX 1.5.1 宿主 + `ofx-host` CLI）
- `crates/aicut/`（薄客户端）
- `skills/aicut/`（技能文档）

## 6. 收尾验收

- 在真实窗口里做一次深/浅色、1440×900 与最小尺寸的目视验收。
- 跑一次同时包含调色、转场、关键帧与变速的完整导出，检查预览与成片差异。
- 用 `render_frame` / `render_storyboard` 对比关键帧中间帧。
- 实测关键帧不透明度的 `geq` 导出耗时；大项目若过慢，改为分段烘焙。
- 后续若要真正的相邻片段交叉淡化，需要先引入受控重叠模型。
- P5 的并行 AI 队列需要拆开各 AI store 的单例状态，当前仍是单任务。

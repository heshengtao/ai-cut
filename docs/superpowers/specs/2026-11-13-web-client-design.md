# Web 客户端与无头守护进程设计

- 日期：2026-11-13
- 状态：**M0 已通过（2026-11-13，见 §13.1）**，M1–M4 待实现
- 目标形态：**桌面版内嵌守护进程，浏览器可打开同一会话；同一份守护进程能脱离窗口运行（`aicutd`），直接进 Docker**
- 参考：`ai-daw/docs/superpowers/specs/2026-11-13-web-client-design.md`（下称"DAW 方案"）
- 不在本设计范围：公网部署、多租户、多人实时协同（OT/CRDT）、纯浏览器 WASM 独立版、像素串流

---

## 1. 问题与目标

AI Cut 现在是 Tauri 桌面应用：界面、**工程文档、编辑命令、撤销、播放引擎全在 webview 里**，
Rust 只负责外设（文件、ffmpeg、AI 运行时、网络、字体、插件、MCP 桥）。

想要的是：

> 1. 桌面版开着，平板上用浏览器打开就能看、能改；
> 2. 没有图形界面的机器上也能跑（服务器 / NAS / 容器），用浏览器或 MCP 驱动；
> 3. 同一套代码，不要"桌面一个后端、服务器一个后端"。

明确目标：

1. **一份后端**：桌面版、浏览器版、`aicutd` 跑同一套命令实现，不允许行为分叉。
2. **一份文档引擎**：编辑命令只有一份实现，客户端和无头共用。
3. **完整编辑**：浏览器里能导入、剪辑、导出，不是只读监视器。
4. **渐进迁移**：每一步落地后桌面版都能正常发布。
5. **明确降级**：浏览器拿不到的能力（原生对话框、OFX 原生窗口、自动更新、数据目录迁移）显式 403 + 提示，不静默失败。

非目标：

- 公网访问与账号体系；一个会话只有**一个写者**（§6.1）。
- 多人同时编辑。多客户端看到的是同一个会话，但同时只有一个人能改。
- 纯浏览器（无本机进程）的独立版；那是另一条长线。

---

## 2. 为什么不能照抄 DAW 方案

DAW 方案的核心动作是"把 Rust 里的状态与命令抽成 `crates/daemon`，前端变成纯渲染器"。
AI Cut 的现状正好相反：

| 维度 | AI DAW | AI Cut |
| --- | --- | --- |
| 业务状态 | 在 Rust（`AppState`） | 在 webview（Pinia，`stores/project.ts`） |
| 编辑逻辑 | Rust 命令 | 纯 TS：`core/ops` + `core/commands` 约 1.9k 行，连同 `serialize`/`keyframes`/`effects` 约 2.9k 行 |
| 后端职责 | 音频引擎、插件宿主、工程 | 文件、ffmpeg、AI 运行时、网络、字体 |
| 实时内容 | 混音 PCM（必须由服务端产生） | 媒体文件（客户端自己解码即可） |
| Rust 侧耦合 | 239 命令 / 489 处 `AppHandle` | 144 命令 / 286 处 `AppHandle`（30 文件） |

结论：**能照样搬的是"抽 daemon + Host trait + 双 Channel"，不能搬的是"把状态放进 Rust"**。
后者对 AI Cut 意味着重写 3k 行领域代码并长期维护两份实现，这是本设计拒绝的。

所以本设计要解决两个 AI Cut 特有的问题：

1. 没有 webview 时，谁来执行编辑命令？（§6.3：内嵌 JS 运行时，跑**同一份** TS 源码）
2. 浏览器怎么"看"时间线？（§7：HTTP Range 拉媒体 + 播放头同步，**不推像素**）

---

## 3. 落地路径的选择

| 路径 | 做法 | 判断 |
| --- | --- | --- |
| ① 进程内网桥 | 在 `src-tauri` 里起 axum，命令转发给 webview | 两周可验证，但无头永远依赖 webview；Docker 里要 xvfb + WebKitGTK，不采纳 |
| ② 抽 `crates/daemon` + `Host`（**采纳**） | 命令实现只依赖 `Host`；桌面壳与 `aicutd` 都是外壳 | 终态干净，一条后端两种外壳 |
| ③ 先①后② | 先网桥验证，再按域迁移 | 中间态会被长期保留，不采纳 |

采纳 ② 的理由和 DAW 方案一致：**重构是机械的、可验证的；不确定的只有文档引擎与媒体同步**，
所以先用 M0 把文档引擎的不确定性打掉（§13），再按域迁移。

---

## 4. 进程与部署拓扑

```
crates/daemon（库，Tauri-free）                 桌面 App（Tauri 外壳）
┌──────────────────────────────┐               ┌──────────────────────────────┐
│ DocHost（文档快照 + 控制器）   │               │ 同一份 daemon（进程内嵌）      │
│ DocEngine（QuickJS，无头时用） │               │ + webview 窗口（= 一个客户端） │
│ ffmpeg / AI / 字体 / MCP      │               │ + 原生对话框 / 更新 / 窗口控制  │
│ HTTP /rpc  WS /events         │               └──────────────────────────────┘
│ GET /media  GET /fonts        │
│ 静态托管 dist                  │
└──────────────────────────────┘
      ▲                    ▲
      │ http（浏览器）       │ http（MCP / CLI / aicutd 客户端）
   平板 / 第二台机器       自动化
```

硬约束：

1. **`crates/daemon` 不依赖 `tauri`**。`paths.rs` 现在的解析顺序保留，但桌面壳把结果通过
   `Host::data_dir()` 注入；无头时用 `--data-dir` / `AICUT_DATA_DIR` / XDG 默认值。
2. **桌面壳只提供能力差异**：原生文件框、外链、reveal、更新、窗口控制、数据目录迁移。
3. **`aicutd` 与桌面 App 链接同一份 `daemon`**；`aicutd` 不链接 GTK/WebKit，镜像才能小。
4. 端口默认 `127.0.0.1:28440`（vite 28430 / HMR 28431，MCP 50563 都不冲突）；
   `--lan` 或设置页开关才绑 `0.0.0.0`。
5. 静态资源由 daemon 托管 `dist/`；前端已是 hash 路由，不需要 fallback 规则。

---

## 5. 后端改造：`Host` trait

### 5.1 现状

Rust 侧对 Tauri 的依赖只有四类（286 处 `AppHandle`）：

| 用途 | 约计数 | 改造后 |
| --- | --- | --- |
| `app.state::<T>()` / `State<'_, T>` | 多数 | 显式传入 `&AppCtx` |
| `app.emit(…)`（进度、AI 流） | 45 | `host.emit(event, payload)` |
| `shell().sidecar("ffmpeg")` | 36 | `host.run("ffmpeg", args, opts)` |
| `app.path()` / `app.config()` / 窗口 | 8 + 少量 | `host.data_dir()` / `host.ui()` |

```rust
pub trait Host: Send + Sync + 'static {
    fn data_dir(&self) -> &Path;
    fn config_dir(&self) -> &Path;
    fn emit(&self, event: &'static str, payload: serde_json::Value);
    /// 跑外部程序（ffmpeg / ffprobe）。桌面=sidecar，无头=可执行文件/ PATH。
    fn run(&self, bin: &str, args: &[String], opts: RunOptions) -> BoxFuture<'_, Result<Output, String>>;
    /// 只有桌面壳提供；无头返回 None。
    fn ui(&self) -> Option<&dyn UiHost>;
}

pub trait UiHost {
    fn pick_file(&self, req: PickRequest) -> Result<Option<PathBuf>, String>;
    fn open_external(&self, url: &str) -> Result<(), String>;
    fn reveal(&self, path: &Path) -> Result<(), String>;
    fn webview_alive(&self) -> bool;
}
```

### 5.2 迁移分域（每步以"桌面版可发布"为硬门槛）

1. `project_io` / `history` / `paths` / `fonts`
2. `media`（probe / thumbnail / waveform / proxy / copy）
3. `export` / `video_dsp`
4. `network` / `cloud_tts` / `cloud_gen`
5. `asr` / `tts` / `audio_ai` / `video_ai` / `image_gen` / `video_gen` / `sdcpp` / `runtime` / `models`
6. `plugins` / `ofx`（桌面宿主保留，daemon 里只留"不可用"桩 + 403）
7. `mcp` / `cli` / `tools`（工具层改为依赖 `DocHost`，不再依赖 webview 桥）

命令层只搬一次：把 `#[tauri::command]` 的函数体移进 `daemon::commands::<domain>`，
`lib.rs` 里保留一行转发的 `#[tauri::command]` 壳。144 个壳可以用宏消掉重复。

### 5.3 ffmpeg 的两种来源

- **桌面**：沿用 `tauri-plugin-shell` 的 sidecar（`binaries/ffmpeg`），打包与签名不变；
- **无头/Docker**：镜像内安装 ffmpeg（或 `AICUT_FFMPEG` 指定路径），`host.run` 走 `tokio::process`。

两条路径共用同一份 `args` 构造与进度解析（现有 `export.rs` 的 `-progress` 解析不动）。

### 5.4 桌面壳保留

原生对话框、外链、reveal、自动更新、窗口控制、数据目录迁移/清理、托盘（将来）。
这些命令在 daemon 里返回 `Err("此操作需要桌面端")`，前端按 §10 隐藏入口。

### 5.5 为什么值得做

`FakeHost` 让 144 个命令**第一次能在没有 Tauri、没有窗口、没有 ffmpeg 的 CI 里跑单测**；
现在 `cargo test --lib` 只覆盖纯函数层。这次重构的真实回报在这里，不只为了 web。

---

## 6. 文档权威与同步（AI Cut 特有）

### 6.1 单写者模型

一个会话只有**一个控制器（controller）**：

- 桌面 webview 打开时，它默认是控制器（行为与今天完全一致：本地 `dispatch` 同步执行）；
- 浏览器可以作为"查看者"加入，也可以**请求控制权**，拿到文档后成为控制器；
- 无头时控制器是 daemon 内的文档引擎（`aicutd` 或 MCP 写入）。

这样避免了双向乐观合并、命令冲突与 ID 分叉，代价是"不能两个人同时剪"。
对视频剪辑这是合理取舍（同一工程通常一个人剪），先把可用性做出来，协同以后再说。

### 6.2 复制快照，不复制命令

**不采用**命令复制，原因很具体：`core/commands` 会在命令执行时生成 ID
（`crypto.randomUUID()`，见 `commands/index.ts`、`ops/clips.ts`、`serialize.ts`），
两个运行时各跑一遍会得到不同的 ID，文档立刻分叉。

采用快照复制：

| 数据 | 频率 | 说明 |
| --- | --- | --- |
| 文档快照 | 控制器每次提交后 debounce 150ms，最多 4Hz | 紧凑 JSON + gzip，版本号单调递增 |
| 播放头 / 播放状态 | 30Hz | 小消息，独立通道 |
| 选中 / 当前面板 | 变化时 | 可选，查看者跟随 |
| 进度事件 | 原生节奏 | export / 下载 / AI，走 SSE |

`serializeProject()` 是 2 空格缩进的（给文件看），**线上传输用 `JSON.stringify(doc)`**，
再用应用层 gzip（或 WS 压缩扩展）。十万级 JSON 压缩后约几 KB～几十 KB，局域网无压力。

### 6.3 无头时的文档引擎

没有 webview 时，daemon 必须能自己执行命令。**不重写**，而是把现有 TS 领域代码
（`ops` / `commands` / `serialize` / `factory` / `keyframes` / `effects` / `projectView`）
用 esbuild 打成一个 bundle，嵌进 Rust 里的 **QuickJS**（`rquickjs`）运行：

```
src/domain/host.ts  ──esbuild──▶  crates/daemon/assets/domain.js  ──include_str!──▶  QuickJS
```

可行性已经用 M0 跑通：bundle 352 KiB / 26 个输入，**不含任何 `node_modules` 依赖**。
为此做了几处小改造（都已落地）：

- `crypto.randomUUID()` → 宿主注入 `__aicut_uuid()`（桌面用真 uuid，测试用计数器）；
- 时钟：`Date.now` → 宿主注入 `__aicut_now()`，否则 `updatedAt` / `addedAt` 在两个运行时对不上；
- `i18n`：纯查表部分抽成 `src/i18n/translate.ts`，`index.ts` 只留 Vue 响应式外壳；
- 字体：`clipStyle` 原本经 `installedFonts` 拖进 Vue + Tauri，改为
  `src/core/fontStack.ts` 的可注入解析器；无头不注入，`fontStackOf` 回退内置字体栈。

QuickJS 侧只保留一份文档对象，边界只传 JSON：

```ts
// src/domain/host.ts —— esbuild 以 IIFE + globalName=AICUT 输出，全局对象即这些导出
export function load(snapshot: string): string;              // {ok, revision}
export function snapshot(): string;
export function apply(command: string): string;              // {ok, revision, changed, affected, error}
export function view(method: string, args: string): string;  // MCP 读取：overview / clip
export function currentRevision(): number;
export function setLocale(locale: "zh" | "en"): string;      // 默认命名 / 错误文案的语言
```

**只传命令与结果，不每帧传整份文档**：`apply` 返回 `{ok, revision, affected}`，
文档留在 JS 堆里；只有加入 / 重新同步时才 `snapshot()`。

选择 QuickJS 而不是 V8/`deno_core`：单二进制、约 1MB、没有额外构建链；
如果 M0 发现兼容性问题（现代语法、正则、JSON 大对象），备选是 `deno_core`（+30–40MB）。

### 6.4 为什么不是"用 Rust 重写 ops"

1. 客户端要保留**本地乐观执行**（拖动、滑杆 60Hz 提交），所以 TS 领域代码必须留在前端；
2. 一旦 Rust 再实现一份，就是两份实现、两套测试、长期分叉——正是 DAW 方案要避免的事；
3. 把前端命令改成全程 await 服务端，会重写约 100 处同步 `dispatch` 调用，UI 手感回退。

### 6.5 控制权移交

```
        ┌────────── 控制器（唯一写者）──────────┐
        │  浏览器 A / 桌面 webview / DocEngine  │
        └───────────────┬──────────────────────┘
                        │ snapshot（debounce）
                    ┌───▼────┐
                    │ daemon │──▶ 查看者 B/C（只读 + 播放头）
                    └────────┘
```

- 移交时：daemon 先让当前控制器 `flush` 快照，再把它交给新控制器，其余降为查看者；
- 控制器掉线：保留最后一份快照，新控制器从它继续（未提交的 <150ms 改动会丢，可接受）；
- **撤销历史属于控制器**：移交后历史清空（查看者不能撤销别人的操作），UI 要提示。

---

## 7. 媒体与预览通道（对应 DAW 方案的 §6）

### 7.1 不推像素

AI Cut 的预览是 DOM 图层（`PreviewStage.vue` 的 `<video>` / `<img>` / 文字层），
**不是 canvas 合成器**。所以浏览器只要拿到"文档 + 媒体 URL + 播放头"，就能自己渲染出
和桌面一致的画面，画质是原始码流，没有重编码。

像素串流（WebRTC / 屏幕捕获）只在必须逐像素一致时才有价值（OFX 预览、HDR 调色），
成本 2–3 个月，本阶段不做。

### 7.2 端点

| 端点 | 用途 |
| --- | --- |
| `GET /media/{assetId}` | Range 读取原始素材（`Accept-Ranges`、`ETag`） |
| `GET /media/{assetId}/proxy` | 冷门容器（mkv/avi/wmv）按需转 H.264/AAC 预览，复用 `make_video_preview` |
| `GET /media/{assetId}/thumb`、`/wave` | 缩略图 / 波形（daemon 生成并缓存） |
| `GET /fonts/{fontId}/*` | 已安装字体（`@font-face` 需要，否则文字层排版全变） |
| `POST /import` | 浏览器作控制器时上传本地文件（流式落盘到 `imports/`） |
| `GET /export/{jobId}/file` | 导出产物下载 |

**白名单**：`/media` 只接受快照里出现过的 `assetId`，路径在服务端解析；
不接受客户端传任意路径。解析后 `canonicalize` 并校验前缀（工程目录、`imports/`、数据目录缓存），
防符号链接逃逸。

### 7.3 播放头与时钟

- 控制器 30Hz 广播 `{time, playing, serverTime}`；
- 查看者用 ping/pong 估 `offset`，把服务端时间换算成本地墙钟后推进播放头；
- 音频由查看者本地 `decodeAudioData` 调度（现有引擎已经是这样），不需要服务端混音；
- 播放中每 1s 校正一次，偏差 >0.5s 才 seek（引擎已有 `VIDEO_DRIFT_TOLERANCE`）。

### 7.4 带宽

每个查看者独立拉原始码流（单播），局域网常见 1080p H.264 5–10 Mbps；
多个查看者时建议 `--lan` + 有线/5G WiFi。代理文件由 daemon 缓存，第二个查看者不重复转码。

### 7.5 顺带得到"第二屏"

同一个浏览器客户端加一个 `?mode=program`（只看预览 + 播放控制）就是上一轮讨论的第二屏模式，
不需要另做一套。

---

## 8. 前端传输层

```ts
// src/platform/types.ts
export interface Channel {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(event: string, cb: (payload: unknown) => void): () => void;
  /** 媒体 URL 解析：tauri → convertFileSrc，http → /media/{id} */
  mediaUrl(assetId: string): string;
}
```

- `tauriChannel`：现有 `invoke` / `listen`；
- `httpChannel`：`POST /rpc/{cmd}` + `GET /events`（SSE）+ `WS /session`（快照/播放头）；
- 改造面：`src/core/*Api.ts` 里 21 个文件的 `invoke` 换成 `channel.invoke`。命令名与参数
  本来就与 Rust 一一对应，属于机械替换，可脚本化 + 类型检查兜底；
- 组件里只有 6 处直接碰 Tauri（`TopBar`、`WindowControls`、`BarActions`、`MediaPane`、
  `FontLibraryDialog`、`HfAuthDialog`），改成 `hasNativeUi()` 判断；
- 平台判断保留 `isTauri()`，新增 `hasNativeUi`（桌面壳才有）与 `caps`（能力位，§10）。

---

## 9. 鉴权、文件与会话

| 项 | 决定 |
| --- | --- |
| token | 启动生成 256-bit，写到 `<data dir>/web-token`；`/rpc`、`/events`、`/session`、`/media` 全部校验。WS/SSE 与 `<video>` 都带不了 header，token 走 query |
| 绑定 | 默认 `127.0.0.1`；设置页/`--lan` 才 `0.0.0.0`，启动日志打印 `http://<ip>:28440/#token=…` |
| Origin | HTTP 与 WS 握手校验白名单，防 DNS rebinding / CSWSH，复用 `mcp.rs` 的既有判断 |
| 危险操作 | 数据目录迁移、插件安装/扫描、删除撤销历史、自动更新：浏览器一律 403，提示"需要桌面端" |
| 文件 | 工程仍在服务端磁盘；`GET /projects` 只列数据目录下的工程；导入走上传，不接受任意路径 |
| 会话 | 多客户端共享同一快照；控制权单写（§6.5）；不装多租户 |
| 关闭 | 设置页"停止 Web 访问"立即释放端口；`aicutd` 由 `SIGTERM` 优雅退出 |

---

## 10. 降级矩阵

| 能力 | 桌面 | 浏览器 / 无头 |
| --- | --- | --- |
| 工程打开/保存 | 原生对话框 | 服务端工程列表 + 上传/下载 |
| 媒体导入 | 原生对话框 + 本地路径 | 上传到 `imports/` |
| 预览播放 | 本机 `<video>` + WebAudio | 同左，媒体走 HTTP Range |
| 缩略图/波形/代理 | ffmpeg sidecar | daemon ffmpeg（同一实现） |
| 导出 | ffmpeg sidecar | daemon ffmpeg（同一实现） |
| 本地 AI | ORT / CUDA / sherpa / sd.cpp | 服务端跑，浏览器只触发与显示进度 |
| 云端 AI | 服务端请求（可直连） | 同样走服务端，避免 CORS 与 key 落浏览器 |
| OFX 插件 | dylib + 原生渲染 | 不可用，片段显示占位 + 提示 |
| 字体库 | 本机安装 | 服务端已安装字体经 `/fonts` 提供 |
| 自动更新 / 数据目录迁移 | 有 | 403 |
| CLI / MCP | 本机 | 走 daemon HTTP，不再依赖 webview |

---

## 11. 无头与 Docker

### 11.1 `aicutd`

```
crates/daemon/        # Tauri-free：Host、命令实现、文档引擎、HTTP/WS、静态托管
crates/daemon/src/bin/aicutd.rs   # bin：只解析参数 → http::serve()
src-tauri/            # 桌面壳：TauriHost（sidecar/dialog/updater/window）+ 内嵌 daemon
```

- `Daemon::start(Config) -> Handle`，桌面壳与 `aicutd` 共用；
- 不引入根 workspace：`aicutd` 用 `cargo build --manifest-path crates/daemon/Cargo.toml`
  独立构建（Docker 里只需要它），桌面壳通过 path 依赖共用同一份 `daemon` 源码；
- 无头启动打印 `http://0.0.0.0:28440/#token=…`，日志沿用现有 `eprintln!("[backend] …")` 前缀风格；
- `--data-dir`、`--lan`、`--port`、`--token`（不给就读文件/生成）；
- 不加载 ONNX / CUDA，直到第一次 AI 调用（现有延迟加载逻辑保留）。

### 11.2 镜像

```dockerfile
FROM node:22-slim AS web
COPY . /src && RUN pnpm i --frozen-lockfile && pnpm build

FROM rust:slim AS build
WORKDIR /src
COPY . .
# 只编 daemon + aicutd，不带 tauri/gtk/webkit
RUN cargo build --manifest-path crates/daemon/Cargo.toml --release --bin aicutd

FROM debian:bookworm-slim
RUN apt-get install -y ffmpeg fonts-noto-cjk
COPY --from=build /src/target/release/aicutd /usr/local/bin/
COPY --from=web /src/dist /opt/aicut/dist
VOLUME /data
ENV AICUT_DATA_DIR=/data
EXPOSE 28440
ENTRYPOINT ["aicutd", "--lan"]
```

- 模型 / ORT / 字体 / 工程都在 `/data`（对应现有 `paths.rs` 的数据目录语义）；
- GPU：CUDA 版 ORT 与组件仍按现有逻辑下载到 `/data/runtime/ort/cuda*`，容器需
  `--gpus all` + nvidia-container-toolkit；镜像里不预装 NVIDIA 库；
- 无音频设备、无显示器、无 WebKit —— 这正是"daemon 必须 Tauri-free"的原因。

### 11.3 已知缺口：文字图层的服务端渲染

现在导出时文字片段由 **Canvas** 栅格化成 PNG（`core/export/textLayer.ts` → `write_export_text_image`）。

- 有客户端时：控制器（浏览器/桌面）渲染 PNG 并上传，daemon 只负责 ffmpeg —— 无缺口；
- 纯无头（MCP 触发导出）时：没有 Canvas。

处理顺序：

1. M3/M4 先支持"无文字片段"的无头导出，并在结果里明确提示；
2. 再评估 Rust 栅格化（`cosmic-text` + `tiny-skia`，按现有样式参数绘制），
   用**像素对比测试**（同一片段在 webview 与 Rust 各渲染一次，SSIM ≥ 阈值）验收；
3. 不引入 headless Chromium（镜像 +500MB，维护成本高于收益）。

---

## 12. 错误处理与可观测性

- **断线重连**：SSE 自动重连；重连后重新拉快照，不做事件回放；
- **快照版本落后**：查看者收到 `revision` 跳变时整份替换，不尝试合并；
- **命令失败**：沿用现有错误字符串协议；`/rpc` 返回 HTTP 500 + `{"error": "…"}`，
  前端走现有 catch 分支，不新增错误模型；
- **控制器掉线**：查看者提示"等待控制器"，MCP 写入自动回退到文档引擎；
- **`/health`**：版本、数据目录、ffmpeg 版本、文档 revision、控制器、客户端数、AI 运行时状态；
- **日志**：启动/绑定/鉴权失败/导出失败/引擎异常都走现有日志格式，不引新框架。

---

## 13. 里程碑

| 阶段 | 内容 | 出口标准 |
| --- | --- | --- |
| **M0（✅ 2026-11-13）** | esbuild 打 `src/domain`，QuickJS 跑通 `load/apply/snapshot`，Node 与 QuickJS 同一份 fixture 对拍 | 已达成：13 条命令（含生成 id、分割、错误、过期 revision）逐字段一致，`cargo test` 3/3 通过；不需要 `deno_core` / Rust 重写 |
| **M1（✅ 2026-11-13）** | `crates/daemon` + `Host` + project/media/export 域 + `/rpc` + `/file` + `/upload` + 静态托管 + token；桌面内嵌 | 已达成：`curl` 能开工程、跑 ffmpeg / 导出；桌面 `pnpm test` 532 + `cargo test --lib` 252 全绿 |
| **M2（✅ 2026-11-14）** | 传输层 + 浏览器文件框/上传 + SSE + **共享会话（文档补丁 + 播放头 + 双向读写）**；字体下发仍未做 | 桌面与浏览器打开同一份工程，双方编辑实时同步 |
| **M3（🟡 大部分）** | `aicutd` + 引擎（`doc_open/apply/snapshot/save/view`）+ 导出 + 会话广播；**未完成**：MCP/CLI 走 HTTP、AI/字体域迁移 | 无窗口机器上能开工程、改文档、导出、多浏览器实时同步 |
| **M4（✅ 2026-11-13）** | Alpine 多阶段镜像（node 仅构建阶段、不装 CJK 字体）、`/data` 卷、文档 | `docker build` 实机构建通过（176 MB），容器内 UI / ffmpeg / RPC / 局域网访问均验证 |

总计约 9–11 周（1 人）。M0 是唯一的"继续/改道"决策点。

### 13.1 M0 结论（2026-11-13）

- **产物**：`src/domain/host.ts` → `crates/daemon/assets/domain.js`（352 KiB，26 个输入，**零 `node_modules` 依赖**）。
- **引擎**：`crates/daemon`（`rquickjs 0.14`，QuickJS 源码内置编译），
  `DocEngine::{new, load, apply, snapshot, view}`；uuid / 时钟由 Rust 注入
  （`IdSource::Real` / `IdSource::Deterministic`）。
- **对拍**：同一份 fixture（13 条命令：建轨、加素材、加片段、移动、调色、marker、分割、
  改名、改输出、静音、非法片段、过期 revision）在 Node `vm`（V8）与 QuickJS 下：
  11 条成功、2 条预期失败，**最终文档与每条 `{ok, revision, affected}` 逐字段相同**。
- **语言**：引擎默认中文；会话建立时由客户端同步一次 `set_locale`，保证「轨道 2 / Track 2」
  这类默认命名与错误文案两边一致（否则 MCP 写入的默认名会跟界面语言不符）。
- **结论**：**不需要 `deno_core`，也不需要 Rust 重写**；M1 可以按 §5.2 直接抽 `Host`。
- **命令**：`pnpm domain:golden` 重建 bundle + golden；
  `cargo test --manifest-path crates/daemon/Cargo.toml` 跑对拍。
- **约束**：`assets/domain.js` 是生成物但必须提交（Rust 用 `include_str!`）；
  CI 要跑 `pnpm domain:golden && git diff --exit-code`，防止领域代码改了而 bundle/golden 没更新。

### 13.2 已落地（M1–M3 部分，2026-11-13）

- **crates/daemon（Tauri-free）**：`Host` / `HeadlessHost`、`paths`、`project`、`media`
  （probe / 缩略图 / 波形 / 代理 / 整理素材）、`export`（与桌面同一份 ffmpeg 执行器、
  进度、取消）、`events`（SSE 总线）。
- **HTTP**：`/health`、`/rpc/<cmd>`（token）、`/events`（SSE，含 `export-progress`）、
  `/file`（Range）、`/upload`（流式落盘）、静态托管 `dist`。
- **桌面**：内嵌 daemon（默认 `127.0.0.1:28440`）；`src-tauri` 的 media / project / export
  改为调用 daemon 实现（一份实现两种外壳）；设置页「Web 访问」显示地址 / 令牌 / 局域网开关，
  `web.json` 控制绑定（重启生效）。
- **无头**：`aicutd --data-dir … --port … [--lan] [--dist …]`，启动打印带 token 的地址。
- **前端**：`src/platform/tauri.ts` 统一 `invoke` / `listen` / `convertFileSrc`
  （Tauri 与 HTTP 双实现）；浏览器文件框走 `<input type=file>` + `/upload`，
  会话与草稿存 localStorage，导出路径由 daemon 分配。
- **验证**：headless Chrome 加载 SPA → RPC ping / 上传 / 写读工程 / `probe_media` /
  缩略图 `<img>` 全部通过，控制台无异常；RPC 导出产出 2s mp4；SSE 收到 `export-progress`。
- **会话镜像**：`GET /session`（WebSocket）转发 `hello/doc/playhead`；桌面通过
  `session_publish` / `session_playhead` 推送，浏览器自动只读跟随并显示横幅，
  「以副本编辑」退出跟随转为独立会话（控制权移交仍未做）。
- **无头文档引擎**：`doc_open / doc_load / doc_apply / doc_snapshot / doc_save / doc_view`
  由专属线程里的 QuickJS 执行，命令结果与浏览器端逐字段一致（M0 对拍保证）；
  每次写入后把快照广播到 `/session`，浏览器跟随端能实时看到无头侧（如 MCP）的修改。
- **Docker**：Alpine 多阶段（node 只出现在构建阶段、运行阶段不装 CJK 字体），
  实机构建 **176 MB**；容器内 UI、ffmpeg 探测/缩略图、RPC、局域网地址访问全部验证。
- **仍未完成**：控制权移交、MCP/CLI 走 HTTP、字体下发、本地 AI 域迁移。

---

## 14. 测试策略

| 层 | 测什么 |
| --- | --- |
| 领域一致性 | **已实现**：同一 fixture 在 Node `vm`（V8）与 QuickJS 下跑，快照与每条结果逐字段比对（`crates/daemon/tests/parity.rs`） |
| Rust 单测 | `FakeHost` 下跑命令：文件、ffmpeg 参数构造、错误路径 |
| RPC 集成 | 临时端口起 daemon，覆盖：鉴权失败、错误 token、跨域拒绝、危险操作 403、路径逃逸 |
| 媒体 | Range 请求边界（头/尾/超范围）、ETag/304、代理缓存命中 |
| 同步 | 假会话注入快照乱序/revision 跳变，查看者状态仍收敛 |
| 端到端 | Playwright：浏览器打开 → 导入 → 剪辑 → 撤销 → 导出（容器内跑） |
| 回归 | 每个里程碑都跑现有 74 个前端测试文件 + `pnpm build` + `cargo test --lib` |

---

## 15. 风险与未决

1. **QuickJS 的兼容性与可维护性**（最大风险）：先做 M0 门；不通过就换 `deno_core`，
   领域代码与契约不变，只换宿主。
2. **单写者模型的体验**：多人想同时剪时不支持；用"请求控制权"按钮 + 明确提示，
   不做假协同。
3. **无头导出的文字图层**：见 §11.3，先限制、后补 Rust 栅格化。
4. **局域网暴露**：默认关闭、token、Origin、路径白名单、危险操作 403；
   文档要写清"开启后同网段可访问"。
5. **桌面双身份（控制器/查看者）的状态机**：只允许一个控制器，切换时清历史并提示。
6. **迁移期双入口回归**：每域迁移完桌面版必须能发版；`pnpm build` 与 Rust 单测进 CI。
7. **未决**：桌面 webview 是否改为直接加载 `http://127.0.0.1:28440`（统一 origin、去掉
   `asset://`），还是保留 `tauri://localhost` + invoke。先保留现状，M3 后再评估。

---

## 16. 与上一轮"纯浏览器 web 版"的关系

本设计**不是**那条路线：纯浏览器版要 ffmpeg.wasm + OPFS + WebCodecs，2–3 个月且功能永久降级。
本设计是"本机引擎 + 浏览器 UI"，Docker 只是把引擎放进容器，功能与桌面一致。
如果将来真要做纯前端独立版，本设计的 `Channel`、`/media`、能力位都能复用，
但不要现在就为它付出代价。

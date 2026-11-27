<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="AI Cut —— 本地优先、AI 可操作的视频剪辑工作台">
</p>

<p align="center">
  <a href="https://github.com/heshengtao/ai-cut/releases"><img src="https://img.shields.io/github/v/release/heshengtao/ai-cut?style=flat-square&color=1A6CFF" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A6CFF?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20/%20macOS%20/%20Linux%20/%20Web-1A6CFF?style=flat-square" alt="Platforms: Windows, macOS, Linux, Web">
  <a href="https://hub.docker.com/r/ailm32442/ai-cut"><img src="https://img.shields.io/docker/pulls/ailm32442/ai-cut?style=flat-square&color=1A6CFF" alt="Docker pulls"></a>
</p>

<p align="center">
  <a href="README_zh.md"><b>简体中文</b></a> ·
  <a href="README_zh-TW.md">繁體中文</a> ·
  <a href="README.md">English</a> ·
  <a href="README_ja.md">日本語</a> ·
  <a href="README_ko.md">한국어</a> ·
  <a href="README_es.md">Español</a> ·
  <a href="README_fr.md">Français</a> ·
  <a href="README_de.md">Deutsch</a> ·
  <a href="README_ru.md">Русский</a> ·
  <a href="README_ar.md">العربية</a>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/ailm32442/ai-cut"><b>Docker Hub</b></a> ·
  <a href="https://github.com/heshengtao/ai-cut/releases">Download</a>
</p>

## AI Cut 是什么？

**AI Cut 是一款小巧、AI 原生的桌面视频剪辑器**——剪辑、字幕、配音、混音、导出都在一个轻量应用里完成，同时还能让 AI 代理和你在同一条时间线上干活。

它是一款真正的剪辑器：多轨道时间线、**用于节点工作流的无限画布**、**可分叉的剧集图**、素材库、检查器、文字片段、字幕、朗读、音频与视频 AI 工具、**OpenFX（OFX）特效插件**，以及 MP4 / ProRes / GIF 导出。时间线、画布和剧集图只是同一份工程的三个视图。它同时也是**为被模型操控而设计的**——随仓库附带的 Skill 能教会任意 AI Harness 通过 MCP 驱动正在运行的软件，代理可以导入素材、建轨、摆放与裁剪片段、改写文字、搭画布或改剧集连线、读取工程，而你在界面上实时看着它发生。

一切都在你自己的电脑上运行。不要账号、不上传素材，编辑器本身也不需要 API Key。

<p align="center">
  <img src="./assets/screenshots/00-editor.jpg" width="100%" alt="AI Cut 工作区：顶部是预览 / 画布 / 剧集三视图；时间线上是一部三段式概念片，带标题、字幕与音乐轨，右侧检查器正在编辑标题文字样式">
</p>

## 为什么这件事值得做

模型之所以学会写代码，是因为它们能通过编程智能体框架**真的把代码跑起来**；模型之所以学会 3D 建模，是因为它们能通过 Blender MCP 操控真实的建模软件。这两者都让模型拿到了真实的工具、真实的结果和真实的反馈闭环——快速迭代正是从这里来的。

视频领域一直缺这个闭环。模型可以生成一段画面，但它没法像剪辑师一样**在一个工程上工作**：没有可编辑的编排、没有可调平衡的轨道、没有撤销历史，也无从判断自己上一刀是不是把节奏剪坏了。

**AI Cut 就是为填上这个缺口做的一次小巧而认真的尝试。** 它是一款真正的剪辑器，AI 代理可以通过 Skill 与 MCP 来操作它，因此它可以用来：

- **检验模型到底懂不懂剪辑**——不是看它能不能生成画面，而是看它能不能搭起一条片子、选出合适的镜头、把节奏修好。
- **采集真实的剪辑轨迹**——代理的每一次修改都落在正常的工程里、进入正常的撤销历史，于是一次会话就成了「模型如何思考视频」的数据。
- **朝着「模型能像写代码一样剪视频」再走一步**——给它一条会回话的时间线。

## 轻量化是设计目标

小巧不是妥协，而是特性。

- **体积小**——没有 Electron、不依赖云、不打包模型全家桶。应用是 Tauri 构建，ffmpeg / ffprobe 以静态二进制随包分发，用户不需要自己装 ffmpeg。
- **启动快**——启动时不加载任何重东西，AI 模型只在你用到时才引入。
- **高算力的活交给该干的地方**——生成环节**刻意放在外部**。由你的 AI Harness 生成或寻找素材，再把文件交给 AI Cut 做剪辑、字幕、混音与导出。
- **生来可扩展**——每一次修改都是一条可序列化命令，新增剪辑操作不需要改 CLI 或 MCP 工具；画布跑在同一套命令模型上，应用扩展可以注册自己的节点、数据类型、面板与命令。
- **OFX 插件管理器**——下载管理器负责「已安装 / 外部 / 可下载」、搜索、导入、更新与删除；OFX 插件面板负责打开已安装插件的界面。免费/开源条目来自 [AI Cut OFX Registry](https://github.com/heshengtao/ai-cut-ofx-registry)，带 SHA-256 校验。GPL/AGPL 条目可以从作者的上游 release 下载，但 App 不托管、不随包分发它们的二进制。原生宿主（`crates/ofx-host`，CLI `ofx-host probe|render`）按输入尺寸加载 OFX 1.5.1 插件，支持全部 6 种 image-effect context：filter / general / generator / paint / retimer 挂到片段 `effects[]` 链，transition 挂到片段边缘并烘焙成整帧叠加视频。检查器负责链管理，独立的「参数」面板负责调参；挂上特效即开始后台预烘焙并显示进度，视频和图片预览在播放中也能常驻显示效果；导出前按最终尺寸烘焙（paint 只支持参数驱动，retimer 通过 `SourceTime` 询问插件源时间）。

## 用任意 AI Harness 驱动它

AI Cut 附带一个 **Skill**（`skills/aicut`），它教会 AI 代理如何操作正在运行的软件——读写工程、导入素材、增删轨道与片段、移动 / 裁剪 / 分割、修改文字与片段属性、撤销重做，并按需加载生产、分镜、框架、审阅与素材文档。它通过内置的 **MCP** 服务器工作，因此任何支持 Agent Skill 的 Harness 都能直接用。

**方式一 · 命令行安装**

```bash
npx skills add heshengtao/ai-cut
```

**方式二 · 让你的代理自己装**

```
Install this Skill: https://github.com/heshengtao/ai-cut
```

应用还附带 `aicut`，一个可以在设置里挂到 `PATH` 的薄 MCP 客户端。命令面就是工具面：

```bash
aicut status
aicut tools
aicut call get_project
```

代理做的每一次修改都走与界面完全相同的命令管线：进入撤销历史、显示在界面上、并署名给代理——所以你随时能看到它做了什么，也能随时撤销。

## 功能

### 时间线剪辑 —— 在真正的时间线上剪辑

怎么想的就怎么摆。跨轨道拖拽片段，在故事变化处切分，修整两端，吸附与帧网格让一切保持对齐。视频、音频、图片与文字片段共用同一条时间线，每一次修改都是同一条撤销历史里的一条命令。

- **多轨道编排** —— 视频、音频、图片、文字片段并排；跨轨道拖放；框选
- **完整的编辑工具** —— 移动、分割、裁剪、吸附、帧网格
- **懂手势的撤销** —— 拖动与滑杆合并成一步，撤销直接回到手势之前
- **工程更安全** —— 自动保存、崩溃后草稿恢复、历史工程
- **时间线上的文字** —— 标题与字幕片段，样式可编辑

<p align="center">
  <img src="./assets/screenshots/01-timeline.jpg" width="100%" alt="时间线：三段视频、标题与字幕轨、音乐轨；选中的视频片段在右侧显示变换、时长与调色控制">
</p>

### 素材与检查器 —— 读懂素材，塑造镜头

导入文件后立即探测：时长、分辨率、帧率与音轨。素材库显示缩略图与波形；检查器给出选中片段背后的参数，让构图、图层与声音就地编辑，而不是散落在另一个对话框里。

- **拖入即导入** —— ffprobe 元数据、缩略图、波形与预览缓存
- **画面变换** —— 位置、缩放、旋转、不透明度、混合模式、圆角
- **片段音频** —— 增益、淡入淡出、变调、声道平衡、静音
- **文字样式** —— 字体、字号、颜色、字距、背景、描边、阴影、发光
- **工程输出** —— 修改分辨率与帧率时，片段按比例重新适配
- **交付辅助** —— 一键整理工程素材到 `<工程名>-media/`，工程换机器也能打开

<p align="center">
  <img src="./assets/screenshots/02-media.jpg" width="100%" alt="素材库：三段视频、两张海报与一段音乐，带缩略图与元数据">
</p>

### 画布与工作流 —— 先把镜头想清楚，再落到时间线

画布视图是一块无限节点画布，适合处理那些「画出来比拖时间线更顺手」的部分。把海报、参考片段或一句文案放到画布上，接到模型或显示节点，运行整条链，再一键送进当前分P。

- **一个工程，多张画布** —— 每张画布都是工程里的一份具名文档；打开、重命名、复制或清空其中一张，不影响剪辑本身。
- **每一步都有节点** —— 图片 / 视频 / 音频 / 文本 / 值输入，显示与值读出，本地与云端模型节点，工作流开始 / 结束、循环与分组。
- **一进一出** —— 每张卡只有一根输入线和一根输出线；具体传哪个逻辑端口在检查器里选，所以重排画布不用重新接线。
- **后台运行** —— 手动、自动或重复运行，节点状态、进度与耗时实时可见；产物自动进素材库，也能一键插入当前分P。
- **工作流可以复用** —— 用开始 / 结束节点声明签名，存进工作流库、发布成 API，或在另一张画布里调用（最多嵌套 8 层）。
- **对插件开放** —— 应用扩展可以注册节点类型、数据类型、面板、控件与命令；同一张图也能通过画布 MCP 工具在无头形态下读写。

完整设计说明：[`docs/canvas-workflow.md`](docs/canvas-workflow.md) · 插件开发指南：[`docs/plugins.md`](docs/plugins.md)。

<p align="center">
  <img src="./assets/screenshots/07-canvas.jpg" width="100%" alt="画布工作区：无限节点画布上是一张海报输入、一段文字输入、显示节点与工作流边界，右侧打开节点检查器">
</p>

### 剧集与分叉 —— 一个工程，多条片

一个工程不止一条片。它可以包含多个分P，共享同一份素材库与画布；分P 之间的播放关系由剧集图决定。走到有分叉的分P 结尾，预览会停在最后一帧，把出边变成画面里的选项按钮——选哪条，也只是工程里的一次编辑。

- **分P 共享其余一切** —— 素材、画布与设置属于工程；每个分P 只保留自己的轨道与标记。
- **两种看故事的方式** —— 平铺视图是分镜网格；连线视图是一张自由画布，每个分P 一张卡。
- **真正的分叉与选项** —— 把一个分P 连到两个分P，给每条线起名，名字就是画面上的选项。
- **单集播放或剧集连播** —— 播一条就停，或者沿剧集图一路走完每条分支。
- **分P 管理很快** —— 重命名、复制、删除、多选、复制 / 粘贴、拖动换序；从连接点拖到空白处，会新建一集并自动接好线。
- **时间线还是时间线** —— 分叉只改变下一集播什么，不改变一集怎么剪、怎么撤销、怎么导出。

<p align="center">
  <img src="./assets/screenshots/08-episodes.jpg" width="100%" alt="剧集工作区的连线视图：四个分P 通过带选项的连线串成一条分叉故事，卡片显示封面与时长">
</p>

### OFX 插件 —— 带你自己的特效

AI Cut 支持 **OpenFX（OFX）1.5.1** 插件，你已有的调色、模糊、辉光、抠像、变形、转场工具都能直接带过来：既可以从 [AI Cut OFX Registry](https://github.com/heshengtao/ai-cut-ofx-registry) 搜索安装（带 SHA-256 校验），也能直接用本机别处装好的插件。

- **六种 OFX context 全支持** —— filter / general / generator / paint / retimer 挂到片段的特效链，transition 挂到片段边缘
- **自带界面或参数面板** —— 打开插件自己的界面，或在独立的「参数」面板里调参
- **预览常驻** —— 挂上特效即开始后台预烘焙，视频与图片预览在播放中也能保留效果
- **导出时烘焙** —— 渲染按最终尺寸应用全部特效（paint 只支持参数驱动，retimer 通过 `SourceTime` 询问插件源时间）
- **注册表 + 本地导入** —— 搜索、一键安装 / 更新 / 删除，或指向本地插件包

<p align="center">
  <img src="./assets/screenshots/03-ofx.jpg" width="100%" alt="OFX 下载管理器：列出可安装的 OpenFX 插件，附许可证、平台支持与一键安装">
</p>

### AI 与自动化 —— 把素材变成还能继续改的东西

这些 AI 功能是为真实的工程准备的，不是演示品。把一段素材交给它，拿回来的是能接着编辑的东西：可以校对的字幕轨、对齐原时间点的朗读、更干净的人声、可以重新配比的分轨。本地工具跑在你自己的硬件上。

- **字幕** —— 本地语音识别生成可编辑字幕轨
- **朗读** —— 本地 TTS，以及 OpenAI、ElevenLabs、Azure、Google、百度、MiniMax、火山引擎或自定义 HTTP
- **智能剪口播** —— 词级时间戳找出口癖与长停顿，一键剪掉；过滤词、停顿阈值和切点扩展在同一个设置里调，切点会向静音多切一点，不会残留半声「嗯」；文稿里剪掉的字划掉显示，点一下就能还原，时间轴同步标注每处剪口
- **音频 AI** —— 响度统一、降噪、人声美化、人声分离、音频翻译
- **视频 AI** —— 超分、补帧、智能裁剪、镜头追踪
- **素材预检** —— 一次调用返回元数据、运动/切点、人脸/人物框与本地转写
- **审片闭环** —— `film.json` 导入、结构化审片批注（`severity` / `sceneId` / `resolved`）、脏段检测、带内容哈希缓存的区间重渲、take 对比（SSIM + 并排帧）与接触表
- **生来离线** —— 编辑器与本地模型不要账号、不上传素材

<p align="center">
  <img src="./assets/screenshots/04-ai.jpg" width="100%" alt="AI 功能：字幕生成、AI 朗读，以及本地出图 / 出视频，带模型下载与安装入口">
</p>

### MCP 服务器与剪辑智能体 —— 让智能体在你的工程里干活

打开一个开关，你的工程就变成 AI 助手可以操作的对象。内置的 **MCP（Model Context Protocol）服务器**把会话通过只监听 `127.0.0.1` 的 HTTP 端点开放出去——接上你的代理、给它一个任务，就能看它建轨、放片段、改文字，界面实时跟着变。同一套工具定义也驱动内置的**剪辑智能体**：一个 OpenAI 兼容的对话面板，支持流式回答、工具调用与会话树分支。

- **MCP over HTTP** —— 只监听回环地址的接入点，JSON 与 SSE 双协议
- **工程生命周期** —— `new_project` / `open_project` / `save_project` 直接读写工程 JSON，不弹保存/打开对话框
- **实时改工程** —— 代理的操作会立刻以正常的工程改动出现
- **`aicut` 命令行** —— 薄客户端；新增工具不需要改 CLI
- **`aicut start`** —— 自动查找本机安装位置，并脱离启动器的 Job Object（含 Windows）
- **剪辑智能体** —— OpenAI 兼容端点、流式回答、工具卡片、会话分支
- **画布工具** —— 创建画布、执行画布操作、列出并运行已发布的工作流，都走同一个端点
- **Skills** —— 剪辑与生产文档，由智能体按需加载

<p align="center">
  <img src="./assets/screenshots/05-mcp.jpg" width="100%" alt="MCP 服务器已启用并显示回环端点，旁边是剪辑智能体入口与 aicut 命令行">
</p>

### 导出与更新 —— 完成并交付

剪好了就渲染。选一个交付格式，AI Cut 在后台写出可发布的文件，你可以继续干活。已安装的应用会检查 GitHub Releases 上的签名更新，新版本一键即达。

- **格式** —— MP4 / H.264、ProRes 422、GIF
- **输出控制** —— 预设或自定义宽高、contain/cover 画面适配、帧率与质量；GIF 颜色数、抖动与循环
- **后台导出** —— 实时进度与取消
- **签名自动更新** —— 启动时静默检查、手动检查、下载、安装、重启
- **更新包校验** —— 公钥内置于应用，私钥只存在于发布环境

<p align="center">
  <img src="./assets/screenshots/06-export.jpg" width="100%" alt="导出对话框：MP4、ProRes 与 GIF 预设，以及分辨率、帧率、画面适配、质量与音频设置">
</p>

## 安装

预编译安装包发布在 [GitHub Releases](https://github.com/heshengtao/ai-cut/releases) 页面。

### 环境要求

- Rust（stable）与 Cargo
- Node.js ≥ 20 与 [pnpm](https://pnpm.io/)（推荐 pnpm 11）
- Tauri v2 所需的系统依赖 —— 见 <https://tauri.app/start/prerequisites/>

### 从源码构建

```bash
git clone https://github.com/heshengtao/ai-cut.git
cd ai-cut

pnpm install
pnpm tauri dev        # 开发模式运行
pnpm tauri build      # 打包发布版本
```

其它常用命令：

```bash
pnpm build            # 对前端做类型检查并构建
pnpm test             # 单元测试（Vitest）
pnpm fetch:sidecars   # 准备 ffmpeg / ffprobe sidecar
pnpm build:aicut      # 构建 aicut CLI
```

ffmpeg 与 ffprobe 以静态二进制随包分发，用户不需要自己安装。模型文件位于 `src-tauri/resources/models/`；较大的模型按需下载。

### 数据目录

模型、ONNX Runtime、OFX 插件、工程历史与设置文件默认放在用户数据目录（Windows 上是 `%APPDATA%\com.aicut.editor`），加起来可能有好几个 GB。不想让它们占系统盘，有两条路：

- **安装时选**：Windows 的 NSIS 安装包会在**首次安装**时询问数据目录（静默安装与自动更新不会弹窗）。选择结果写入注册表 `HKCU\Software\AI Cut\DataDir`。
- **装完之后搬**：**设置 → 存储 → 选择目录并迁移**。应用会把当前数据复制到新目录、写好指针文件，**重启后生效**；旧目录留到重启后再一键清理，迁移过程中不删任何东西。

解析优先级：`--data-dir <path>` ＞ 环境变量 `AICUT_DATA_DIR` ＞ 设置页写的指针文件 `data-dir.json` ＞ 安装器注册表 ＞ 系统默认。前两者属于「便携模式」，设置页会禁用迁移。

少数文件故意不跟着搬：`cli-path` / `app-path` / `mcp-url` 是给 `aicut` CLI 与外部 AI Harness 按 bundle id 查找的发现文件（见 [`skills/aicut/SKILL.md`](skills/aicut/SKILL.md)），它们只有几十字节，留在默认目录里。

### 平台支持

| 平台 | 状态 |
| --- | --- |
| Windows (x86_64) |  支持 |
| macOS（Apple Silicon） |  支持（.dmg 首次打开见「App 已损坏」说明） |
| Linux (x86_64 / arm64) |  支持 |

> **macOS 提示「App 已损坏，无法打开」？** 应用为自签名（未公证），从网络下载会带上隔离属性。在终端执行下面这行命令后即可正常打开：
>
> ```bash
> xattr -cr "/Applications/AI Cut.app"
> ```

> **当前发布流程暂不支持 Intel Mac。** 发布构建只为 Apple Silicon
> （`aarch64-apple-darwin`）产出安装包。

## 浏览器访问与无头运行

桌面端内嵌一个只监听回环的 HTTP 服务：**设置 → 通用 → 网页访问**，把地址复制到浏览器打开
就是同一个编辑器。**没有登录、没有令牌**：打开地址就能用。访问控制交给部署侧（局域网 / 容器网络 / 反向代理）。

浏览器端与桌面端共享同一个实时会话：两边都可写，改动会合并到同一个工程里。
打开「局域网访问」并重启，就能从平板或同一网络的第二台机器访问。

### Docker

```bash
docker build -t ai-cut .
docker run -d --name ai-cut -p 28440:28440 -p 50563:50563 -v aicut-data:/data ai-cut
```

镜像基于 Debian slim（多阶段，约 434 MB），自带与桌面同款的静态 ffmpeg/ffprobe、随包 5 个模型与 ONNX Runtime（按目标架构下载，构建期会做 ELF 架构自检与 `libonnxruntime.so` 别名）；浏览器打开 <http://localhost:28440> 即可。

MCP 在容器里绑 `0.0.0.0`（`--lan` 的语义），所以把 `50563` 一起发布后，宿主上的 Claude Desktop / IDE 可以直接接 `http://<宿主>:50563/mcp`，工具面与桌面同一份 62 个。

**容器里的能力与桌面基本一致**（差异只来自物理条件）：

| 功能 | 桌面 | 容器 / 浏览器 |
| --- | --- | --- |
| 剪辑 / 字幕 / 导出 / 字体 | ✅ | ✅ 同一份 daemon 实现 |
| 本地推理：字幕识别、AI 朗读、降噪、音源分离、超分、补帧、变声 | ✅ | ✅ 同一份 daemon 实现（CPU 上跑，慢一些） |
| 模型与运行库管理、云端出图 / 朗读、响度、视频处理 | ✅ | ✅ |
| 智能体 / MCP | ✅ 62 个工具 | ✅ 同一份 62 个工具（含编辑宏、片段级 AI、导出渲染、工程生命周期、撤销重做、审片批注、影片结构、后台任务） |
| OFX 效果 | ✅ 含整段烘焙 | ✅ 单帧 / 图片 / 转场预览 + **整段烘焙**（片段与转场，单进程顺序烘焙） |
| 插件安装 / 导入 / 删除 | ✅ | ✅（「在文件管理器里显示」需要桌面） |
| 原生插件 GUI、系统级文件框 / 浏览器拉起 | ✅ | ⛔ 物理上没有窗口系统 / 桌面会话 |
| 本地出图 / 出视频（sd.cpp） | ✅ | ✅ 同一份 daemon 实现：引擎与权重按需下载，容器里可用 CPU / Vulkan / ROCm（上游没有 Linux 的 CUDA 构建） |

**插件二进制必须和镜像架构一致。** 镜像按构建机架构产出（Apple Silicon 上默认 arm64），
而 OFX 插件是原生二进制：只提供 x86_64 构建的插件（例如 Flame LTX AlphaGen）在 arm64
容器里加载不了，界面会直接提示「插件二进制架构不匹配」，而不是含糊的
`cannot open shared object file`。这类插件请改用 amd64 镜像：

```bash
docker build --platform linux/amd64 -t ai-cut .
docker run -d --platform linux/amd64 -p 28440:28440 -v aicut-data:/data ai-cut
```

（在 Apple Silicon 上走 Rosetta 模拟，会慢一些；x86_64 Linux 宿主上则不需要。）

模型第一次使用时才下载（设置 → 模型），下载会走网络代理配置；随包的 5 个模型开箱可用。

### 无头二进制

```bash
cargo run --manifest-path crates/daemon/Cargo.toml --bin aicutd -- \
  --data-dir ./data --port 28440 --lan --dist dist
```

### 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `AICUT_DATA_DIR` | `./data` | 工程、导入素材、导出结果 |
| `AICUT_NO_AUDIO` | 未设置 | 跳过打开音频设备 |

### HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/rpc/{command}` | 编辑命令，名字与应用内 IPC 一致 |
| `GET` | `/events` | SSE：文档与任务进度 |
| `GET` | `/session` | WebSocket：会话实时同步 |
| `GET` | `/file` · `POST /upload` | 素材读取 / 导入 |
| `GET` | `/health` | 存活状态 |

## 架构

```
src-tauri/          Tauri 外壳：窗口、原生对话框、自动更新
crates/daemon/      后端：文档模型、素材、渲染引擎、HTTP
crates/aicut/       命令行
src/                Vue 3 前端 —— 桌面与浏览器是同一份
```

`src/platform/` 把传输层（`Tauri IPC` ↔ `HTTP + WebSocket`）藏在同一套 API 后面，
所以每个界面在两种壳里都能用；浏览器版是同一个应用通过网络访问同一个后端。

无头模式下工程、导入素材与导出结果都在数据目录里，ffmpeg 由镜像提供。

本地 AI（ASR / TTS / 降噪 / 分离 / 超分 / 变声）、模型与运行时管理、插件与 OFX、
剪辑智能体目前**还没有接进无头后端**——这是待还的迁移债，不是产品边界。
`GET /rpc/capabilities` 会逐项声明每个能力在当时的形态里是可用、缺组件还是
"尚未接入"，前端按它显示入口，不再用 `isTauri()` 猜。

## 常见问题

### AI Cut 是免费的吗？

是。AI Cut 以 Apache 2.0 开源，没有付费档位，也没有功能阉割。

### 能离线使用吗？

能。剪辑、导出与本地 AI 模型都在本机运行。只有在你发起模型下载、检查更新，或配置 OpenAI 兼容的智能体端点、云端 TTS 等云服务时，才会联网。

### 需要显卡吗？

不需要。内置 AI 模型走 CPU，不需要 CUDA 或额外驱动。机器慢一些时大模型会跑得久一点，但不要求显卡。有 NVIDIA 显卡时，可以到「设置 → AI → 执行后端」选择 CUDA 12 或 CUDA 13 加速：两者都会在下载管理器里按需下载整套匹配的 ONNX Runtime + CUDA 组件，不依赖系统里装没装 CUDA（装完重启生效）。

### 哪些 AI 模型随应用一起提供？

小模型随包分发，装好即可使用。较大的模型——语音识别、TTS、音源分离、超分与补帧——由应用内的模型管理器按需下载，存放在源码树之外。各模型的许可（包括社区许可的视频模型与**仅限非商业**的 FLUX.1 [dev]）见 [MODELS.md](MODELS.md)。

### 支持哪些特效插件格式？

**OpenFX（OFX）1.5.1** —— 全部六种 image-effect context（filter、general、generator、paint、retimer、transition）。插件可以来自内置仓库，也可以来自你自己的磁盘。音频特效格式（VST3 / AU / CLAP）不托管：增益、淡入淡出、变调与混音由 AI Cut 自己的音频工具覆盖。

### 要让智能体驱动它，需要 App 一直开着吗？

需要。Skill 和 `aicut` CLI 通过 MCP 与正在运行的 AI Cut 通信，所以先启动应用（`aicut status` 能看出它是否在跑）。

### 能做成可分支的视频吗？

可以。一个工程里可以放多个分P；剧集视图用带名字的连线把它们连起来，预览切到「剧集」模式后就会沿连线播放。走到有分叉的分P 结尾时，出边的名字会变成画面上的选项按钮，下一集在画面里选。

### 不用模型也能用画布吗？

能。输入、显示、值、循环与工作流节点都不依赖模型。模型节点需要本地模型或配置好的云端服务；在模型就绪之前，画布其余部分照样能编辑和保存。

### 智能体能导出成片吗？

可以。`export_video` 通过 MCP 渲染时间线——MP4、ProRes 或 GIF。`outputPath` 是可选的：不传时 AI Cut 会写到工程文件旁边（未保存的工程写到下载目录），并返回最终路径。字幕、配音、音频 / 视频 AI 与导出都是可调用的工具，所以智能体可以准备好时间线、渲染、再把文件交回来审阅。

## 支持

### 请给我们点个 Star！
⭐ 你的支持是我们前进的动力！

### 欢迎打赏！
<div align="center" style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap;">

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/agentparty)
[![爱发电](https://img.shields.io/badge/爱发电-支持我们-946ce6?style=for-the-badge&logo=affine&logoColor=white)](https://afdian.com/a/agentparty)

</div>

### 关注我们
<div align="center">
  <a href="https://space.bilibili.com/26978344">
    <img src="screenshots/B.png" width="100" height="100" style="border-radius: 80%; overflow: hidden;" alt="bilibili"/>
  </a>
  <a href="https://www.youtube.com/@agentParty">
    <img src="screenshots/YT.png" width="100" height="100" style="border-radius: 80%; overflow: hidden;" alt="youtube"/>
  </a>
</div>

### 加入社区
如果你在使用过程中遇到任何问题，欢迎加入我们的社区交流。

1. QQ 群：`931057213`（1群已满） `902882342`（2群）

2. Discord: [Discord 链接](https://discord.gg/f2dsAKKr2V)

## 贡献者

<a href="https://github.com/heshengtao/ai-cut/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=heshengtao/ai-cut" alt="heshengtao/ai-cut 的贡献者" />
</a>

## 许可

**代码**是 Apache-2.0，见 [LICENSE](LICENSE)。

模型**权重**是另一层：仓库与安装包里只有随包分发的五个小型宽松许可模型，其余权重由应用
按需从发布方下载（并逐个校验 `sha256`），各自沿用发布方的许可。完整的模型 / 许可 / 来源
对照表见 **[MODELS.md](MODELS.md)**，其中包括社区许可（LTX-2、混元、MiniMax-H3）、
CreativeML Open RAIL 系列，以及**仅限非商业**的 FLUX.1 [dev] 权重。

## 第三方许可

本项目建立在第三方开源软件之上。依赖许可见 `package.json`、`src-tauri/Cargo.toml` 与
`crates/` 下的清单。随包分发的 FFmpeg 二进制保留各自上游许可；模型权重（随包与按需下载）
的许可、来源与限制见 [MODELS.md](MODELS.md)，随包模型的许可原文在
`src-tauri/resources/models/LICENSES/`。

# 域：框架与工具选型

目标不是「收集所有工具」，而是**按交付物选一条最省事、最可控、可交付的链路**。先定路线，再定框架，最后才写代码或调模型。

> 版本、价格与可用性变化很快。本文是 2026-10 的调研快照；执行前以官方仓库/文档为准，不要凭记忆写 API。

## 0. 先回答五个问题

1. **画面从哪来？** 已有实拍 / 屏幕录制 / 代码动效 / 生成式模型 / 混合。
2. **是否需要逐帧确定？** 数据、文字、品牌模板、批量变体 → 代码渲染；不可控的写实镜头 → 生成式模型。
3. **谁来剪？** 有对白、采访、口播 → 时间线剪辑（AI Cut / CapCut / Resolve）；纯动效 → 渲染成片后只需拼接。
4. **交付到哪里？** 16:9 长视频、9:16 短视频、1:1 信息流、4K 母版、GIF/透明叠加。
5. **成本与许可证？** 渲染算力、模型调用、素材授权、字体/音乐、框架商用条款。

## 1. 三条路线

| 路线 | 适合 | 代表工具 | 优点 | 代价 |
| --- | --- | --- | --- | --- |
| **A. 实拍/录屏 + 时间线剪辑** | 口播、访谈、Vlog、产品演示、课程 | AI Cut、CapCut、DaVinci Resolve、Premiere、Descript | 真实、可控、剪辑直觉强 | 依赖素材质量；动效包装需另做 |
| **B. 代码/浏览器渲染** | 产品宣传、解释视频、数据可视化、动态字、片头、批量模板 | Remotion、HyperFrames、Motion Canvas、Revideo、Manim、Three.js、Blender | 确定性、可复用、可版本控制、易批量 | 需要工程能力；复杂 3D/合成成本高 |
| **C. 生成式模型** | 写实镜头、概念片、补拍、风格化画面、配音/音乐 | Veo、Kling、Runway、Seedance、Wan、Nano Banana、ElevenLabs、Suno | 不存在的东西也能拍 | 不可控、需多次抽卡、一致性与版权风险 |

**最常见的高质量组合是 B + C + A：** 代码做包装与确定性画面，生成模型补不存在的镜头，AI Cut 负责组装、字幕、配音、人审与导出。

## 2. 代码 / 浏览器渲染框架

| 框架 | 授权模型 | 最适合 | 渲染 | Agent skills | 注意 |
| --- | --- | --- | --- | --- | --- |
| **Remotion** | React 组件，每帧 = 组件 | 数据驱动视频、模板批量、产品/营销、图表动画 | 无头 Chrome + FFmpeg；本地 / Lambda / Cloud Run | 官方 `remotion-dev/skills`（12 个） | 商用许可按公司规模；需要 React/TS；必须用 `useCurrentFrame` / `interpolate` / `spring`，不能靠 CSS 时钟 |
| **HyperFrames** | HTML + CSS + data-* 属性 + 可 seek 动画 | 产品发布、解释视频、社媒短片、HTML 原生动效 | 无头 Chrome + FFmpeg；本地 / AWS Lambda | 官方 21 个 skills + `/hyperframes` 路由 | Apache-2.0；动画必须可 seek；适合 agent 直接写 HTML |
| **Motion Canvas** | TypeScript generator，`yield` 分镜 | 精细手工动效、讲解型动画 | 自带编辑器 + 渲染 | 社区 skill 少 | MIT；偏交互式创作，无头批处理需验证 |
| **Revideo** | Motion Canvas 分支，保留顺序动画 | 可自托管的批量动效 | Node.js 渲染 | 社区 skill 少 | 生态较小；核对许可证与无头渲染成熟度 |
| **Manim / ManimCE** | Python 场景 | 数学、物理、算法、3Blue1Brown 风格 | Python 渲染 MP4 | `adithya-s-k/manim_skill`、`Yusuke710/manim-skill`、`Math-To-Manim` | MIT；LaTeX/字体依赖；不适合实拍剪辑 |
| **Three.js / R3F** | WebGL/WebGPU 3D 库 | 3D 产品、空间场景、粒子、着色器 | 无头浏览器逐帧截图 | `emalorenzo/three-agent-skills`（Three + R3F） | 不是视频框架；要自己做确定性 seek；内存/资源释放是坑 |
| **Babylon.js** | 全栈 3D 引擎 | 复杂 3D、PBR、物理 | 无头浏览器 | 以官方文档为主 | Apache-2.0；包体与启动成本高 |
| **PixiJS** | 2D WebGL 渲染器 | 2D 游戏感、粒子、交互式动画 | 无头浏览器 | 社区 | MIT；文本/滤镜注意跨平台差异 |
| **p5.js** | 创意编程 | 手绘/生成艺术/教学 | 无头浏览器 | 社区 skill | LGPL-2.1；逐帧确定性要自己保证 |
| **GSAP** | JS 动画库 | 时间线补间、SVG、滚动叙事 | 配合 HyperFrames/Remotion/浏览器 | HyperFrames 的动画 skill 覆盖 | 商用条款核对；必须暂停时间线并按帧 seek |
| **Anime.js / Motion One / WAAPI** | JS/CSS 动画 | 轻量 UI 动效、文字 | 浏览器 | HyperFrames 适配 | 避免 wall-clock 动画，渲染时会漂移 |
| **Lottie / dotLottie** | AE 导出 JSON + 运行时 | 图标、logo、UI 动效、透明叠加 | lottie-web / 播放器 / 渲染器 | `diffusionstudio/lottie` 等 | 复杂表达式/字体可能丢失；透明视频适合叠加 |
| **Rive** | 状态机动画 + 运行时 | 交互式角色、UI、游戏感动效 | Rive runtime / 渲染 | 社区 | 编辑器订阅；runtime 开源；导出视频需自建管线 |
| **Blender（Python/bpy）** | 3D 建模/渲染 | 电影感 3D、产品、场景、角色 | Cycles/Eevee 离线渲染 | `sunxiayi/make-blender-education-video-skill`、Slopcamera | GPL；渲染慢；输出文件本身不受 GPL 传染 |
| **After Effects（ExtendScript/UXP）** | 合成/动效 | 传统 MG、模板、复杂合成 | aerender / 插件 | `after-effects-mcp`、`aftr` 等社区 | 商业软件；自动化接口脆弱；适合已有 AE 管线 |

### 代码渲染的硬规则

- **确定性**：同一输入必须产出同一帧。禁止 `Date.now()`、随机数、`requestAnimationFrame` 时钟、网络字体竞态。
- **可 seek**：动画要能按时间 `t` 求出状态，而不是「播放到哪算哪」。Remotion 用 frame，HyperFrames 用 data-* + timeline seek。
- **资源就绪再渲染**：字体 `document.fonts.ready`、图片 decode、视频 metadata、3D 模型加载完成；否则首帧会闪。
- **固定画布**：分辨率、fps、像素比写死；不要依赖窗口大小。
- **音频单独混**：渲染器只出画面，音频用 FFmpeg/DAW 混，最后 mux；口型/卡点再对齐。

## 3. 托管渲染 API

| 服务 | 模型 | 适合 | 注意 |
| --- | --- | --- | --- |
| **Creatomate** | 模板 + JSON 变量 | 固定版式的批量视频、电商 | 版式受模板限制；按渲染计费 |
| **Shotstack** | JSON 时间线 | 拼接、裁剪、叠加、幻灯片 | 动效受平台能力限制 |
| **Bannerbear** | 模板 + 动态文字/图片 | 简单品牌叠加、批量图/短视频 | 不适合多场景叙事 |
| **JSON2Video** | JSON 场景 | 快速程序化视频 | 同上 |
| **Editframe** | API 优先的合成 | 产品/社交视频 | 生态较小 |
| **GenMotion** | 代码/模板 | 动效与发布视频 | 需核对当前能力 |
| **Rendi** | FFmpeg 云 API | 纯转码/拼接/滤镜 | 不做创意合成 |

托管 API 的价值是「不用管渲染基础设施」；代价是表达力、锁定和按量计费。**需要复杂动效或大批量时，自托管代码框架通常更划算。**

## 4. 生成式视频模型（写实/概念镜头）

| 模型 | 强项 | 适合 | 注意 |
| --- | --- | --- | --- |
| **Google Veo 3.1** | 物理、镜头语言、原生音频 | 电影感镜头、带声音的片段 | 访问方式/区域受限；核对当前 API |
| **Kling 3.0 / 2.6** | 人体动作、面部、图生视频一致性 | 人物镜头、产品图动起来 | 时长有限；长镜头要拼接 |
| **Runway Gen-4.5** | 运动控制、创意工具、编辑工作流 | 广告、风格化、VFX | 价格高；单段短 |
| **Seedance 2.5** | 质量/成本平衡、图生视频 | 社媒、广告、批量镜头 | 通过服务商接入；核对条款 |
| **Wan 2.5** | 开源、可自托管 | 私有部署、成本敏感 | 需要 GPU；质量/速度看配置 |
| **Sora（OpenAI）** | 物理与提示词遵循 | 概念片 | 2026 年产品/API 可用性有变动，使用前查官方 |
| **Hailuo / MiniMax** | 自然人体、表情、口型 | 人物、日常场景 | 时长较短 |
| **Pika** | 风格化、特效 | 创意短片、社媒 | 写实较弱 |
| **Luma Ray** | 3D 空间感、运镜 | 空间镜头、产品 | 生态较小 |
| **LTX-2** | 开源、带同步音频 | 自托管、实验 | 显存要求高 |

**生成式视频的正确用法：**

1. 先用图像模型出**关键帧**（构图、角色、光线定死）。
2. 用图生视频（image-to-video）让关键帧动起来，而不是纯文生视频抽卡。
3. 每个镜头生成 2–4 个 take，按「构图 / 动作 / 一致性 / 伪影」打分选一个。
4. 角色一致性靠 character sheet + reference image + 固定 seed + 固定风格 token。
5. 单段控制在 4–8 秒；长镜头拆成多个镜头，用剪辑和声音连接。
6. 生成片段**不要直接当最终画面**：进 AI Cut 做节奏、调色、稳定、补帧、字幕与混音。

## 5. 图像 / 关键帧 / 视觉素材模型

| 工具 | 强项 | 适合 |
| --- | --- | --- |
| **Nano Banana Pro（Google）** | 指令遵循、文字渲染、参考图编辑 | 关键帧、分镜、海报、产品图 |
| **GPT Image** | 语义理解、图文排版 | 信息图、封面、带文字的图 |
| **FLUX 2** | 写实、风格控制、开源生态 | 写实关键帧、批量风格 |
| **Midjourney** | 审美、风格化 | 概念图、风格帧、moodboard |
| **Ideogram** | 图中文字 | 标题卡、海报、社媒图 |
| **Stable Diffusion / SDXL** | 本地、可控、LoRA | 私有部署、角色一致性 |
| **Figma / Spline** | 设计稿、3D 场景 | 品牌资产、UI 动效、3D 插画 |

## 6. 音频：配音、音乐、音效、口型

| 类别 | 工具 | 适合 | 注意 |
| --- | --- | --- | --- |
| **TTS / 配音** | ElevenLabs、Cartesia、MiniMax、Azure、Google、OpenAI TTS | 多语言旁白、情绪、音色克隆 | 商用授权与声音克隆同意书 |
| **本地 TTS** | **MOSS TTS Nano**、**ZipVoice**、Kokoro、Piper | 离线、隐私、零边际成本 | AI Cut 已内置 MOSS / ZipVoice 模型管理 |
| **音乐** | Suno、Udio、ElevenLabs Music、Stable Audio | BGM、主题曲、情绪铺底 | 版权/商用条款差异大；Suno/Udio 有授权风险 |
| **音效** | ElevenLabs SFX、FAL、ThinkSound、Freesound | whoosh、hit、环境声 | 记录来源与许可证 |
| **口型/数字人** | HeyGen、Hedra Character-3、Sync.so、D-ID、LivePortrait | 口播、译制、虚拟主播 | 肖像权/声音权；长视频成本高 |
| **音频后期** | FFmpeg、iZotope RX、Adobe Podcast、Demucs/UVR | 降噪、分离、响度、母带 | AI Cut 内置 LocalVQE / UVR / HTDemucs |

### 混音基线

- 对白/旁白：峰值约 **-6 dBFS**，平均 **-16 ~ -12 LUFS**（按平台）。
- 音乐铺底：比对白低 **12–18 dB**；有旁白时做 sidechain/ducking。
- 成片：社媒/流媒体常用 **-14 LUFS integrated**，广播 **-23 LUFS**， cinema **-27 LKFS**（以交付方为准）。
- 真峰值控制在 **-1 dBTP** 以内；短视频平台会二次压缩，留余量。

## 7. 素材来源与版权

| 来源 | 内容 | 注意 |
| --- | --- | --- |
| Pexels / Pixabay / Unsplash | 免费图/视频/音乐 | 核对单条许可与署名要求 |
| Storyblocks / Artgrid / Envato | 订阅素材库 | 保留授权凭证 |
| Freesound | 音效/环境声 | CC 许可类型差异大 |
| Wikimedia Commons / Internet Archive / NASA | 历史/公共领域 | 逐条核对权利人 |
| 自行拍摄 / 屏幕录制 | 最可控 | 注意肖像、商标、隐私、场地 |
| 生成式模型 | 不存在或补拍镜头 | 平台商用条款；记录 prompt 与模型版本 |

**每个素材都要有 provenance：** 文件、来源 URL、作者、许可证、是否允许商用、是否允许修改、是否需署名。写进 `manifest.json`，不要事后补。

## 8. Agent Skills 地图

Agent Skills 是 `SKILL.md` + 脚本/模板的目录；`npx skills add <repo>` 或 `npx add-skill <repo>` 安装，也可作为 Claude Code / Codex / Cursor / Gemini CLI 插件使用。

### 官方 / 一等公民

| Skill 包 | 内容 | 安装 |
| --- | --- | --- |
| **Remotion 官方 skills** | `remotion-best-practices` / `create` / `markup` / `studio` / `render` / `maps` / `captions` / `saas` / `interactivity` / `docs` / `upgrade` / `multimedia` | `npx skills add remotion-dev/skills` 或项目内 `npx remotion skills add` |
| **HyperFrames 官方 skills** | `/hyperframes` 路由 + 21 个：`product-launch-video`、`faceless-explainer`、`pr-to-video`、`embedded-captions`、`talking-head-recut`、`motion-graphics`、`music-to-video`、`slideshow`、`general-video`、`remotion-to-hyperframes`；域 skills：core / animation / keyframes / creative / media-use / cli / audio / registry / figma | `npx skills add heygen-com/hyperframes` 或 `claude plugin marketplace add heygen-com/hyperframes` |
| **Three.js / R3F 社区 skills** | `three-best-practices`（17 类 100+ 规则）、`r3f-best-practices`（11 类 60+ 规则） | `npx add-skill three-agent-skills` |
| **Manim skills** | 场景规划、代码、渲染、反馈迭代；Math-To-Manim 多管线 | `adithya-s-k/manim_skill` / `Yusuke710/manim-skill` |

### 任务型 skills

| 任务 | Skill / 项目 | 说明 |
| --- | --- | --- |
| 产品宣传片（从 URL/截图） | `Vincentwei1021/video-shotcraft`、`liyupi/ai-promo-video-maker`、`op7418/guizang-product-video-skill` | 镜头配方库、真实 UI 捕获、Remotion 渲染 |
| 解释视频 | `Vincentwei1021/anything2explainer`、`iart-ai/explainer-video-skills`、`vincentsch/explainroo` | 旁白 + 字幕 + 动效 |
| 剪辑真实素材 | `browser-use/video-use`、`OpenChatCut`、`digitalsamba/claude-code-video-toolkit` | 去口癖/静音、字幕、调色、HyperFrames 包装 |
| 全流程工作室 | `OpenMontage`、`onetake`、`motion-video-kit` | 研究 → 脚本 → 素材 → 渲染；注意 AGPL/非商用许可 |
| 动效/UI/数据 | `iart-ai/motion-skills`（50 个）、`charlie947/motion-graphics-skills`、`iart-ai/data-animation-skills` | 动态字、图表、社媒包装 |
| 分镜工作台 | `Yuuhann1999/agent-storyboard`、`kangarooking/director-skills` | 分镜、图片/视频生成、配音回填 |
| YouTube 切片/字幕 | `op7418/Youtube-clipper-skill`、`zenstory-ai/video-recap-skills` | yt-dlp + 语义章节 + 双语字幕 |
| 屏幕演示 | Playwright MCP `--save-video`、`CursorCam`、Screen Studio | 浏览器操作录制 + 后期 |
| Lottie 动效 | `diffusionstudio/lottie` | AE/JSON 动效进视频 |
| FFmpeg 后期 | `digitalsamba/.../ffmpeg` skill | 转码、裁剪、拼接、压缩、抽音 |
| 音乐/节拍 | `ZiadAbdelkarim/beat-synced-edit`、音乐生成模型 | 卡点剪辑 |
| 口播包装 | `jincheng2026/jc-remotion-skills`、`darrenli6/JJKoubo` | 口播精剪 + MG 包装 |

> 这些是社区项目，安装前看 README、LICENSE、最近提交和安全评级。**不要盲目 `--all` 安装**；只装当前任务需要的 core set。

### 选型经验

- **简单 promo 不一定需要 skill。** 社区横评里，不装任何 skill 的 coding agent 也能在几分钟内出一条能播的片子；skill 的真正价值是「风格、工作流、素材处理、少犯 API 错误」。
- **有实拍素材时，剪辑类 skill 比生成类 skill 更有价值。** 去口癖、静音、字幕、B-roll、调色是高频痛点。
- **代码框架的官方 skill 首先解决「渲染正确性」**：Remotion 的 frame/interpolate/spring、HyperFrames 的 seek-safe 动画。没有这些约束，agent 很容易写出「浏览器里能播、渲染出来是错的」代码。
- **HyperFrames 更适合 agent 直接写 HTML；Remotion 更适合 React/数据驱动/批量变体。** 两者都能本地渲染，许可证不同。
- **Three.js 本身不是视频框架。** 它需要无头浏览器逐帧截图；放在 HyperFrames/Remotion 里，或自己写 Puppeteer 管线。
- **生成模型是「补镜头」，不是「整片生成」。** 先用关键帧锁定构图，再图生视频；整片靠剪辑、声音和字幕成立。
- **先装一个框架 skill + 一个任务 skill。** 例如 HyperFrames + video-shotcraft，或 Remotion + anything2explainer；装太多会互相抢上下文。

## 9. 按视频类型推荐

| 视频类型 | 首选框架 | 辅助 | AI Cut 的角色 |
| --- | --- | --- | --- |
| 产品发布 / 功能宣传 | HyperFrames 或 Remotion | Playwright 捕获真实 UI；Nano Banana/FLUX 关键帧；ElevenLabs 旁白 | 组装、字幕、配音、人审、导出 |
| SaaS 演示 / onboarding | Playwright `--save-video` / Screen Studio | HyperFrames 包装、CursorCam 缩放 | 裁剪、节奏、字幕、画中画 |
| 口播 / 访谈 / 课程 | 实拍 + AI Cut | 提词器、双机位、降噪/分离 | 主战场：剪辑、字幕、翻译、配音 |
| 知识解释 / 科普 | Manim（数学/物理）或 HyperFrames/Remotion | TTS、图表、地图、纸拼贴风格 | 组装与交付；字幕校对 |
| 数据新闻 / 图表 | Remotion + D3/Observable Plot | HyperFrames 图表块 | 包装、旁白、导出 |
| 3D 产品 / 空间场景 | Three.js/R3F 或 Blender | Spline、HDRI、PBR 材质 | 叠加实拍、字幕、调色 |
| 社媒短视频 9:16 | AI Cut + HyperFrames 包装 | 智能重构、动态字幕、卡点 | 竖屏重构、字幕、导出 |
| 音乐视频 / 卡点 | HyperFrames / Remotion | 节拍分析、Suno/Udio、Three.js | 组装、节奏微调 |
| 概念片 / AI 电影 | Veo/Kling/Runway/Seedance + 关键帧 | 角色设定、口型、配音、音乐 | 镜头拼接、统一色调、字幕、审片 |
| 幻灯片 / 演示 | HyperFrames `slideshow` 或 Reveal.js | Figma 导入 | 录屏/导出、旁白 |
| 透明叠加 / 片头 | HyperFrames/Remotion 透明渲染或 Lottie | Alpha 通道、ProRes 4444 | 叠加到主时间线 |
| 批量模板 / 个性化 | Remotion + 数据 | Creatomate/Shotstack（低代码） | 抽检、人审、交付 |

## 10. 选型评分卡

给每个候选打 1–5 分，加权后选最高：

| 维度 | 权重 | 问什么 |
| --- | --- | --- |
| 表达力 | 25% | 能否做出目标视觉？3D/合成/文字/图表够不够？ |
| 可控/确定性 | 20% | 能否逐帧复现？能否精确改一帧？ |
| 交付速度 | 15% | 从 brief 到可审片要多久？迭代循环多快？ |
| 成本 | 15% | 渲染算力 + 模型调用 + 人力 + 许可证 |
| Agent 友好度 | 10% | 有无官方 skills、非交互 CLI、可读文档 |
| 生态/维护 | 10% | 社区、模板、更新频率、招聘容易度 |
| 许可证/合规 | 5% | 商用、改编、署名、输出归属 |

**默认栈（没有特殊要求时）：**

- 画面：HyperFrames（HTML 动效）或 Remotion（React/数据驱动）
- 写实补拍：关键帧（Nano Banana Pro / FLUX 2）→ 图生视频（Kling / Veo / Seedance）
- 3D：Three.js/R3F；电影感 3D 用 Blender
- 数学/科学：Manim
- 旁白：ElevenLabs 或 AI Cut 本地 MOSS/ZipVoice
- 音乐/音效：ElevenLabs Music / Freesound / Suno（核对授权）
- 组装与交付：**AI Cut**

## 11. 技术约束清单

- **画幅与安全区**：16:9 1920×1080；9:16 1080×1920；1:1 1080×1080。字幕避开底部 15%（平台 UI）和左右 8%。
- **帧率**：24（电影感）、25（PAL/欧洲）、30（网络）、50/60（运动/游戏）。全链路统一，混帧率要转。
- **编码**：交付 H.264/AAC MP4（`yuv420p`、faststart）；母版 ProRes 422 HQ；透明用 ProRes 4444 或 WebM/VP9 alpha；GIF 仅短循环。
- **字体**：商用字体要有授权；渲染环境必须装同一字体；中文注意缺字与回退。
- **浏览器渲染**：无头 Chrome 需要固定 viewport、`deviceScaleFactor`、禁用动画时钟、等待字体/媒体就绪；长视频分块渲染再拼接。
- **3D**：显存、纹理尺寸、阴影、后处理是最常见的爆点；先做低清预览，再出最终。
- **生成式模型**：单段短、分辨率有限、可能带水印；不要指望一次生成完美长镜头；一致性靠参考图与后期。
- **音频**：48 kHz；对白与音乐分轨；保留无损源；最终响度按平台。
- **文件命名**：`<项目>_<场景>_<镜头>_<版本>_<日期>.<ext>`，避免空格与中文路径在 CLI 中出问题。

## 12. 许可证与版权（必须记录）

| 工具/素材 | 条款要点 |
| --- | --- |
| Remotion | 个人、≤3 人公司、非营利免费；更大的营利公司需公司许可 |
| HyperFrames | Apache-2.0；可商用；保留 NOTICE/许可 |
| Motion Canvas / Manim / Three.js | MIT；保留版权与许可声明 |
| Babylon.js | Apache-2.0 |
| p5.js | LGPL-2.1；动态链接注意义务 |
| GSAP | 官方条款为准；商用/插件授权核对 |
| Lottie / Rive runtime | 开源 runtime；编辑器/服务另有条款 |
| Blender | GPL-2.0+；渲染输出不受 GPL 传染 |
| FFmpeg | LGPL/GPL 取决于编译选项；分发前核对 |
| 生成式模型 | 平台商用条款、输出归属、是否允许训练/署名 |
| 音乐/TTS/声音克隆 | 版权、表演者权、声音人格权、同意书 |
| 素材库 | 单条许可可能不同；保留授权凭证 |

**不要用「网上能找到」当授权。** 记录来源、许可证、获取日期、是否商用、是否改编、署名要求。

## 13. 参考链接

- Remotion Agent Skills: https://www.remotion.dev/docs/ai/skills
- Remotion 文档: https://www.remotion.dev/docs
- HyperFrames: https://github.com/heygen-com/hyperframes
- HyperFrames 文档: https://hyperframes.heygen.com/introduction
- Motion Canvas: https://motioncanvas.io/
- Revideo: https://re.video/
- Manim Community: https://docs.manim.community/
- Three.js: https://threejs.org/docs/
- React Three Fiber: https://r3f.docs.pmnd.rs/
- Babylon.js: https://doc.babylonjs.com/
- Blender Python: https://docs.blender.org/api/current/
- GSAP: https://gsap.com/docs/
- Lottie: https://airbnb.io/lottie/
- Rive: https://rive.app/docs/
- FFmpeg: https://ffmpeg.org/documentation.html
- Creatomate: https://creatomate.com/docs
- Shotstack: https://shotstack.io/docs/
- Agent Skills: https://agentskills.io/
- Skills 目录: https://www.skills.sh/
- Awesome Claude Video Skills: https://github.com/zhuyansen/awesome-claude-video-skills
- Claude Code Video Toolkit: https://github.com/wilwaldon/Claude-Code-Video-Toolkit

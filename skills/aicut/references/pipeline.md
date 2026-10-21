# 域：全流程（pipeline）

这是从一句需求到可交付成片的十阶段 playbook。**阶段之间有人审 Gate；Gate 没通过不要进入下一阶段。**

## 0. 交付定义（Definition of Done）

一条视频算完成，至少要有：

- [ ] `brief.md`：目标、受众、平台、时长、画幅、调性、成功标准、预算/边界
- [ ] `research.md`：参考片、视觉基准、素材来源、版权记录
- [ ] `tech-plan.md`：框架、模型、音频链路、剪辑路径、成本估算
- [ ] `script.md`：旁白稿/对白稿、屏幕文字、时间预算
- [ ] `storyboard.csv`：逐镜头表，含时长、画面、运镜、声音、来源、验收点
- [ ] `assets/` + `manifest.json`：素材、来源、许可证、版本、时长/分辨率/fps
- [ ] AI Cut 工程：轨道结构、主叙事、字幕轨、配音轨、音乐/SFX
- [ ] `review-*.md`：时间码意见与处理结果
- [ ] 成片：按平台规格导出，时长/响度/字幕/黑帧校验通过
- [ ] 归档：工程 JSON、素材清单、许可证、最终文件

## 1. 角色与自动化边界

| 角色 | 职责 |
| --- | --- |
| **人（导演/制片）** | 定 brief、选路线、审分镜、看粗剪、定稿、签收 |
| **智能体** | 调研、写稿、拆分镜、生成/整理素材、搭时间线、批量修改、QC、写交付文档 |
| **AI Cut** | 唯一时间线真相：素材库、轨道、片段、字幕、配音、导出 |

| 步骤 | 内置智能体（只有 MCP） | 外部 agent（有 shell/文件系统） | 人 |
| --- | --- | --- | --- |
| 读工程/改时间线 | ✅ | ✅（走 CLI） | — |
| 导入素材 | ✅ `import_asset` | ✅ | — |
| 写 brief/分镜/清单 | ✅ 输出文本 | ✅ 落盘 | 审 |
| 跑 Remotion/HyperFrames/FFmpeg | ❌ | ✅ | 可代跑 |
| 生成字幕/翻译/配音 | ❌ | ❌（除非另有 API） | ✅ App 界面 |
| 音频/视频 AI 增强 | ❌ | 可用外部工具，但建议用 App | ✅ App 界面 |
| 导出 | ❌ | 可用 FFmpeg，但建议用 App | ✅ App 界面 |

> 内置智能体不要承诺「我来导出/我来生成字幕」。正确说法：**「我已经把字幕文字片段和轨道准备好了，请在 AI 功能面板点生成字幕，完成后我继续校对。」**

## 2. 阶段 0：需求（Brief）

**目标**：把模糊想法变成可验收的约束。

**步骤**

1. 问清楚 8 件事：目的、受众、平台、时长、画幅、调性、必须出现的信息、绝对不能出现的内容。
2. 定成功标准：完播、点击、转化、教学理解、品牌一致性……只选 1–2 个。
3. 定边界：预算、截止时间、可用素材、是否允许生成式画面、是否需要真人出镜。
4. 写 `brief.md`，用一句话总结。

**brief 模板**

```md
# <项目名> Brief

- 一句话：<给谁看，解决什么问题，看完做什么>
- 平台/画幅：<16:9 1920x1080 / 9:16 1080x1920 / 1:1>
- 目标时长：<秒>
- 受众：<谁，已知什么，关心什么>
- 调性：<三个形容词>
- 必须出现：<产品名/卖点/价格/CTA/字幕语言>
- 禁止出现：<竞品/敏感词/未授权素材/真人肖像>
- 成功标准：<一个可观测指标>
- 预算/限制：<模型调用/渲染时间/素材版权>
```

**Gate G0**：人确认 brief。确认后冻结；任何改动走变更记录。

**常见坑**：没定画幅就开始写分镜；把「想要高级感」当 brief；忽略平台时长与字幕安全区。

## 3. 阶段 1：调研与参考

**目标**：找到可执行的视觉方向，而不是「多看几个视频」。

**步骤**

1. 找 3–5 条参考片，标注「学什么」：节奏、镜头、配色、字体、转场、声音。
2. 找 3–5 张视觉基准图（moodboard）：构图、光线、材质、色板。
3. 找素材来源：实拍、库存、生成、代码渲染，分别记录。
4. 建 `research.md`：参考链接、截图、可用/不可用原因、版权备注。

**产物**：`research.md` + `references/` 截图。

**Gate**：无强制 Gate，但 G1 会检查方向是否与参考一致。

**坑**：参考片只抄表面风格，没拆解结构；忽略参考片的版权（不要直接复用画面/音乐）。

## 4. 阶段 2：框架与路线选型

**目标**：用最低成本做出目标画面，并保证能交付。

**步骤**

1. 按 `frameworks.md` 的五个问题定路线：实拍 / 代码 / 生成 / 混合。
2. 给每个候选框架打分（表达力、可控、速度、成本、Agent 友好、生态、许可证）。
3. 定生成模型与音频链路；确认商用条款与预算。
4. 定「兜底方案」：模型不可用/渲染失败时怎么交付。
5. 写 `tech-plan.md`。

**tech-plan 模板**

```md
# 技术方案

- 路线：<实拍/代码/生成/混合>
- 画面主框架：<HyperFrames/Remotion/Manim/Three.js/Blender>
- 生成模型：<关键帧/图生视频/视频模型>
- 音频：<TTS/音乐/音效/口型>
- 剪辑与交付：AI Cut（<分辨率/fps/格式>）
- 渲染环境：<本地/云/Lambda；Node/Python 版本>
- 成本估算：<模型调用 + 渲染 + 素材>
- 许可证：<框架/模型/素材/字体/音乐>
- 兜底：<降级方案>
```

**Gate G1**：人确认路线、预算、时间与风险。

**坑**：为了「最新框架」牺牲交付；忽略 Remotion 商用许可；生成模型按条计费导致超支。

## 5. 阶段 3：剧本与分镜

**目标**：把 brief 变成逐镜头可执行的表。

**步骤**

1. 写旁白/对白稿：按「钩子 → 问题 → 方案 → 证据 → CTA」或「起承转合」。
2. 按语速算时长：中文约 3.5–4.5 字/秒，英文约 2.3–2.8 词/秒；留 10–15% 余量。
3. 拆分镜：每个镜头只表达一件事；写清景别、运镜、动作、画面文字、声音。
4. 标素材来源：`footage` / `screen` / `code` / `image` / `gen-video` / `stock`。
5. 标验收点：这个镜头怎样算「过」。
6. 可选：用关键帧做 animatic（粗剪动态分镜），先验证节奏。

详细模板、时长公式、提示词模板见 `storyboard.md`。

**Gate G2**：人确认剧本与分镜。**这是最便宜的修改点**，不要跳过。

**坑**：先做画面再想叙事；一个镜头塞三个信息；旁白写满导致画面没有呼吸。

## 6. 阶段 4：素材制作

**目标**：产出符合规格、可追溯、可剪辑的素材。

**步骤**

1. **实拍/录屏**：统一分辨率、fps、收音；拍 2–3 个 take；记录场记。
2. **代码渲染**：先出低清预览，确认动效/文字/节奏；再出 1080p/4K 最终。
3. **关键帧**：按分镜逐镜生成；固定角色 token、seed、镜头/光线；选最佳 take。
4. **图生视频**：单段 4–8 秒；每镜 2–4 个 take；标记可用片段。
5. **配音**：先定稿文字，再合成；保留每段音频与对应文字 id。
6. **音乐/音效**：先定情绪与节拍，再卡点；保留无损源。
7. **整理**：按 `<项目>_<场景>_<镜头>_<版本>_<日期>` 命名；写 `manifest.json`。

**manifest 字段**

```json
{
  "id": "s03_c01_v2",
  "file": "assets/gen/s03_c01_v2.mp4",
  "kind": "video",
  "source": "kling-3.0 | pexels | self-shot | remotion",
  "prompt": "…",
  "model_version": "…",
  "duration": 6.0,
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "license": "commercial-ok | CC-BY-4.0 | own",
  "attribution": "…",
  "notes": "take 2, slight hand artifact at 4.1s"
}
```

**Gate G3**：人看素材 selects（联系表/预览），确认可用镜头与缺口。

**坑**：素材规格不统一；生成镜头没有记录 prompt/版本，无法复现；忘记版权与肖像同意。

## 7. 阶段 5：导入 AI Cut 与粗剪

**目标**：把素材组装成能看的叙事骨架。

### 7.1 准备工程

```bash
aicut status                 # App 没开就 aicut start
aicut call get_project       # 拿 revision / 轨道摘要 / 素材数量（不含明细）
```

设置输出规格（画幅与 fps 必须先定）：

```json
{"kind":"project.output","baseRevision":<rev>,"payload":{"width":1080,"height":1920,"fps":30}}
```

### 7.2 导入素材

```json
{"path":"/abs/path/s01_hook_v3.mp4","name":"S01 钩子"}
```

逐条调用 `import_asset`；返回 `{asset, result}`。用 `asset.id` 后续引用。**路径必须是本机绝对路径。**

批量导入时每导一条就记下 id，不要等最后靠名字猜。

### 7.3 建立轨道结构

`index 0` 是最上层。建议从底层往上建，每加一层画面用 `index: 0`；音轨追加到底部即可（顺序不影响混音）。

| 层号（0 = 最上层） | 内容 | 建法 |
| --- | --- | --- |
| 0 | 字幕 / 标题 | UI 生成字幕会自动置顶；标题也可手动加文字片段 |
| 1 | 包装 / 叠加 / 画中画 | `track.add {index:0}` |
| 2 | B-roll | `track.add {index:0}` |
| 3 | A-roll 主画面 | 工程已有轨道或先建 |
| 4 | 对白 / 现场声 | 追加到底部 |
| 5 | 配音 / 旁白 | 追加到底部；UI 的 AI 朗读会自动建朗读轨 |
| 6 | 音乐 | 追加到底部 |
| 7 | SFX | 追加到底部 |

> **两套编号别混：** `track.add` 的 `index` 是 0 基插入位（0 = 最上层）；`get_project` 返回的 `index` 是 1 基展示号。上面写的是层号（0 基）。
>
> `track.add` 现在可以传 `name`，`get_project` 也会返回轨道名；但仍推荐用 1 起始 `index` 定位，名字只作语义提示。

### 7.4 铺主叙事

```json
{"kind":"clip.add","baseRevision":<rev>,"payload":{"trackId":"<A-roll>","clip":{"assetId":"<id>","start":0,"duration":6.2,"in":0.4}}}
```

- `start` 是时间线位置，`in` 是素材入点，`duration` 是片段长度。
- 同轨不能重叠；先排 A-roll，再插 B-roll。
- 图片没有时长，`clip.add` 必须显式给 `duration`。
- 视频片段想保留画面、去掉原声：`clip.update` patch `{ "muted": true }`。

### 7.5 验证

只回读受影响的轨道：`get_track(trackId)`，检查：

- 片段数量与顺序
- 起止时间是否落在预期
- 同轨是否重叠
- 素材 id 是否指向正确文件

**Gate G4**：人看粗剪。只判断「故事是否成立」，不要此时抠细节。

**坑**：revision 过期（人类刚动过界面）→ 重读，不要重试旧命令；同轨重叠被拒 → 顺延或换轨；素材路径含空格/中文导致 CLI 问题。

## 8. 阶段 6：精剪

**目标**：节奏、信息密度、视觉包装到位。

**常用操作**

| 目的 | 命令 |
| --- | --- |
| 平移片段 | `clip.move` `{clipIds, delta}` |
| 改入出点 | `clip.trim` `{clipId, edge:"start"\|"end", time}` |
| 在时间点切开 | `clip.split` `{clipIds, at}` |
| 删除 | `clip.remove` `{clipIds}` |
| 换位置/换轨 | `clip.move` `{clipIds, delta, targetTrackId}` |
| 调透明度/缩放/旋转/位置 | `clip.update` patch `opacity` / `transform` |
| 调音量/淡入淡出/变调/声像 | `clip.update` patch `gain` / `fadeIn` / `fadeOut` / `pitch` / `pan` |
| 改文字 | `clip.update` patch `text` / `textStyle` / `stroke` / `shadow` |

**节奏原则**

- 钩子：0–3 秒给最强画面/问题/结果。
- 单镜头 2–5 秒；口播镜头可 5–10 秒，但要有画面变化。
- 每 15–30 秒有一次「信息刷新」：新场景、图表、文字、音效。
- 转场优先用「切」；需要柔和时用 `fadeIn/fadeOut` 或叠加层透明度。**当前没有内置转场类型**，不要承诺。
- B-roll 覆盖口播时，原声保留在 A-roll，B-roll 片段 `muted: true`。

**画面包装**

- 文字片段：`assetId: ""`，给 `duration` 和 `text`；用 `textStyle` 控制字体/字号/颜色/背景/发光。
- 图片/视频叠加：用 `transform` 定位缩放，`opacity` 控制透明度，`blendMode` 控制混合。
- 画中画：上层片段缩小 + 偏移；底层继续播放。

**Gate G5**：picture lock。之后只允许字幕/声音/调色级修改。

**坑**：一次改太多无法撤销定位；在同一轨做交叉淡化（不允许重叠）→ 放到叠加轨或用淡入淡出；文字太长超出安全区。

## 9. 阶段 7：字幕与配音

**目标**：可读、同步、可翻译的声音层。

### 9.1 生成字幕（人在 App 操作）

1. 选中带对白的 A-roll 片段（或时间线第一个有音轨的素材）。
2. 打开「AI 功能」→ 文本 → 选择 ASR 模型：
   - **SenseVoice**：中/英/日/韩/粤，推荐默认。
   - **Whisper Base**：多语言、低算力。
   - **Whisper Small**：更高精度、更慢。
   - **Paraformer 中文 Small / 三语**：中文/粤语/英语。
3. 首次使用需下载模型 + Silero VAD；按提示确认。
4. 点「生成字幕」。App 会新建一条置顶文字轨，把词级/句级结果映射到时间线。
5. 智能体用 `get_project` 找到新文字轨，再用 `get_track` 读取文字片段。

**校对**

- 错字/专有名词：`clip.update` patch `{ "text": "..." }`。
- 时间不准：`clip.trim` 改边缘，或 `clip.move` 平移。
- 切分太碎/太长：`clip.split` / 合并（删掉一条并把文字并入相邻片段，或重建）。
- 字幕样式：`textStyle`（字号按 1080p 基准，换分辨率会等比缩放）。

### 9.2 翻译 / 译制配音（人在 App 操作）

1. 选中音频/视频片段。
2. 选择目标语言（英/中/日/韩/西/法/德）。
3. 可选「译制配音」：需要本地 TTS 模型；会用原片前 10 秒做参考音色。
4. 生成后得到「译文字幕」轨；若开启配音，还会得到对应朗读轨。
5. 智能体重读工程，校对译文长度与时间是否溢出。

### 9.3 AI 朗读（人在 App 操作）

1. 先准备好**文字片段**（字幕轨或单独的文字轨）。
2. 选中一个或多个文字片段（朗读只处理选中的）。
3. AI 功能 → 音频 → AI 朗读：
   - 本地：MOSS TTS Nano（中英多语）或 ZipVoice（中英、音色克隆）。
   - 云端：OpenAI / ElevenLabs / Azure / Google / 百度 / MiniMax / 火山 / 自定义。
   - 音色：内置音色或参考音频克隆（参考文本可自动转写）。
4. 生成后，音频按每个文字片段的起点放回时间线；重叠时自动拆到新的「朗读」轨道。
5. 智能体重读，检查文字与语音是否对齐；必要时 `clip.move` 微调。

> 语音比文字长时，音频片段会更长并可能压到下一段；系统会自动换轨，不会错位，但语义上要人审。

**Gate G6**：人审字幕准确性与声音自然度。

**坑**：没下载模型就点生成；用错语言模型；字幕一屏超过两行；译文变长导致溢出；TTS 参考音频太短/太吵。

## 10. 阶段 8：AI 增强与技术 QC

**目标**：把「能用」变成「交付级」。

### 音频

| 能力 | 用途 | 注意 |
| --- | --- | --- |
| 响度测量 | 检查 integrated LUFS / true peak | 先测再调，不要盲加增益 |
| 降噪（LocalVQE） | 室内底噪、混响 | 过度会「水下感」 |
| 人声分离（UVR / HTDemucs） | 提取人声/伴奏/鼓/贝斯 | 分离会引入伪影；保留原轨 |
| DSP（denoise/beautify） | 快速美化 | 轻/中/强预设，逐段试 |
| 音量/淡入淡出/变调/声像 | 时间线内调整 | 旁白与音乐做 ducking |

### 视频

| 能力 | 用途 | 注意 |
| --- | --- | --- |
| 稳定 / 去噪 / 去闪烁 / 动态模糊 | 手机素材、生成素材清理 | 强预设可能糊 |
| 超分（Real-ESRGAN） | 低清素材放大 | 先看脸/文字是否变形 |
| 补帧（RIFE） | 24→30/60、慢动作 | 运动复杂处会有果冻 |
| 智能重构（YOLOX/YuNet） | 16:9 → 9:16，人脸/人物/自动/中心 | 主体跟踪会跳；长镜头分段处理 |

这些都在 App 里选片段后触发；处理结果会替换片段视频或新增素材。完成后智能体用 `get_clip` 确认时长与引用没变。

**Gate G7**：技术 QC：无黑帧、无爆音、无错位、无糊脸、无水印。

## 11. 阶段 9：人审

**目标**：让「能交付」变成「愿意署名」。

**审片顺序**

1. **无声看一遍**：故事是否看懂？字幕是否可读？
2. **只听声音**：旁白是否清楚？音乐是否压人声？有没有爆音？
3. **正常看**：节奏、情绪、品牌一致性。
4. **按平台看**：手机竖屏、静音自动播放、小窗。

**反馈格式**（时间码 + 优先级 + 可执行动作）：

```md
[00:03.2] P0 声音：旁白被音乐盖住，音乐降 6 dB 或做 ducking
[00:12.8] P1 画面：B-roll 与口播内容不符，换成产品特写
[00:21.0] P1 字幕：第二行超出安全区，缩短到 16 字以内
[00:34.5] P2 节奏：这里停 1.5 秒太长，切掉 0.8 秒
```

- **P0**：阻断交付（错误信息、爆音、黑帧、版权）。
- **P1**：必须修（影响理解/品牌）。
- **P2**：有余力再修（审美微调）。

**Gate G8**：人明确说「可以导出」。不要用「看起来差不多」代替签收。

详细清单见 `review.md`。

## 12. 阶段 10：导出与归档

**目标**：按平台规格交付，且可复现。

**导出设置（AI Cut）**

| 选项 | 取值 | 用途 |
| --- | --- | --- |
| 格式 | MP4 / ProRes / GIF | MP4 交付；ProRes 母版；GIF 无音频短循环 |
| 分辨率 | project / 1080p / 720p / custom | 自定义时用 `width` / `height`，只给一边会按工程比例补另一边 |
| 画面适配 | contain / cover | contain 加边；cover 裁切填满（不会改工程画布） |
| 裁切位置 | `fitAnchor`: center / top / bottom / left / right / 四角 | cover 时保留哪块画面，竖构图取景常用 |
| 帧率 | 跟随工程或指定 | GIF 省略时默认 15fps，可显式指定 |
| 质量 | high / standard / small | MP4 CRF 18/23/28 |
| GIF 调色板 | `gif.colors` / `gif.dither` / `gif.loop` | 颜色数 2–256；抖动 sierra2_4a / bayer / floyd_steinberg / none；循环 0 = 无限 |

**导出前检查**

- [ ] 所有素材在线（无 offline）
- [ ] 文字片段都已渲染（导出会烧录文字）
- [ ] 没有空轨/多余片段
- [ ] 输出画幅与平台一致
- [ ] 字幕在安全区
- [ ] 音频不削波

`export_video` 的返回值里带实际 `width / height / fps / format`，可以直接和平台规格比对。

**导出后校验**

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate \
  -show_entries stream=codec_name,width,height,r_frame_rate,channels,sample_rate \
  -of default=noprint_wrappers=1 output.mp4
```

- 时长与预期误差 < 0.1s
- 分辨率/fps 正确
- 音频 48 kHz、双声道
- 抽帧检查首尾、字幕、黑帧
- 真峰值 ≤ -1 dBTP（如工具有）

**归档**

```
<project>/
  brief.md
  research.md
  tech-plan.md
  script.md
  storyboard.csv
  manifest.json
  review-2026-10-21.md
  project.aicut.json
  output/
    <name>_1080p.mp4
    <name>_master.mov
```

**Gate G9**：交付签收。

## 13. 一页速查：45 秒产品演示

| 时间 | 段落 | 画面 | 声音 | 来源 |
| --- | --- | --- | --- | --- |
| 0–3s | 钩子 | 产品最强结果特写 | 一句话痛点 + hit | 生成/实拍 |
| 3–10s | 问题 | 用户困境/旧流程 | 旁白 + 轻 BGM | 实拍/库存 |
| 10–25s | 方案 | 真实 UI 操作 + 标注 | 旁白 + UI 音效 | 录屏 + HyperFrames 包装 |
| 25–35s | 证据 | 数据/对比/客户 | 旁白 + 音乐抬起 | 代码图表 |
| 35–42s | CTA | logo + 网址 + 按钮 | 音乐收尾 + whoosh | 代码/设计稿 |
| 42–45s | 尾板 | 品牌/二维码 | 静音或尾音 | 设计稿 |

轨道：A-roll 片段 + B-roll 叠加 + 包装层 + 字幕轨 + 旁白 + 音乐 + SFX。

## 14. 变更管理

- Gate 之后改 brief：记录变更原因，重开受影响的阶段（通常 3、4、5）。
- 改画幅：全部分镜与素材要重排，不能只改 `project.output`。只是换交付尺寸/裁切时，用导出参数 `width` / `height` + `fit: "cover"`，不要改工程画布。
- 改旁白：重跑 TTS，重新对字幕，检查长度。
- 改音乐：重新卡点，检查旁白 ducking。
- 任何「顺手改一下」都要能回答：**它影响哪个 Gate 的验收？**

## 15. 附录：端到端命令骨架

以下只是形状，`<rev>` / id / 路径都要换成真实值；**上一条命令的返回值里有新 revision，可以直接接着用；需要核对结果时只回读受影响的片段（`get_track` / `get_clip`）**。

```bash
# 0. 连接
aicut status || aicut start
aicut call get_project

# 1. 定交付规格（9:16 / 30fps）
aicut call apply_command --json '{"command":{"kind":"project.output","baseRevision":<rev>,"payload":{"width":1080,"height":1920,"fps":30},"label":"设置输出"}}'

# 2. 导素材（逐条；记下 asset.id）
aicut call import_asset --json '{"path":"/abs/path/s01_hook_v3.mp4","name":"S01 钩子"}'
aicut call import_asset --json '{"path":"/abs/path/vo_s01.wav","name":"S01 旁白"}'

# 3. 建上层轨道（从底层往上；0 = 最上层）
#    多条命令用 apply_commands：一次 revision、一个撤销步；name 会写进轨道摘要。
aicut call apply_commands --json '{"baseRevision":<rev>,"label":"建立轨道结构","commands":[{"kind":"track.add","payload":{"index":0,"name":"B-roll"}},{"kind":"track.add","payload":{"index":0,"name":"包装"}}]}'

# 4. 铺 A-roll（主叙事）
aicut call apply_command --json '{"command":{"kind":"clip.add","baseRevision":<rev>,"payload":{"trackId":"<A-roll-id>","clip":{"assetId":"<asset-id>","start":0,"duration":6.2,"in":0.4}},"label":"S01 主镜头"}}'

# 5. 铺 B-roll（静音原声；同轨不重叠）
aicut call apply_command --json '{"command":{"kind":"clip.add","baseRevision":<rev>,"payload":{"trackId":"<broll-id>","clip":{"assetId":"<asset-id>","start":4.0,"duration":2.5,"in":1.0}},"label":"S01 B-roll"}}'
aicut call apply_command --json '{"command":{"kind":"clip.update","baseRevision":<rev>,"payload":{"clipId":"<broll-clip-id>","patch":{"muted":true,"opacity":0.9}},"label":"B-roll 静音"}}'

# 6. 加标题文字片段
aicut call apply_command --json '{"command":{"kind":"clip.add","baseRevision":<rev>,"payload":{"trackId":"<text-id>","clip":{"assetId":"","start":0.5,"duration":2.5,"text":"一句话说清价值"}},"label":"标题"}}'

# 7. 验证（只读受影响的轨道/片段）
aicut call get_track --json '{"trackId":<track-index>}'
```

之后：

1. 人看粗剪（G4）。
2. 人精剪/审片（G5）。
3. 人在 AI 功能里生成字幕、翻译、朗读（G6）。
4. 人做音频/视频增强（G7）。
5. 人终审并导出（G8/G9）。
6. 智能体重读工程，校对字幕/音频/片段，写交付文档。

## 16. 什么时候停下来问人

- brief 缺平台/时长/画幅/受众中的任意一项。
- 需要花钱调用生成模型或购买素材。
- 需要真人肖像、声音克隆、客户素材。
- 画面涉及医疗、金融、法律等高风险陈述。
- 版权/许可证不确定。
- 审片意见互相冲突。
- 当前 AI Cut 不支持想要的转场/字幕格式/导出格式。

**宁可停下来问，也不要交付一个「看起来完成了」但不可用的视频。**

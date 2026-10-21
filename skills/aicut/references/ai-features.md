# 域：AI 能力（ai-features）

这些是 AI Cut 应用内的 AI 能力。**除 `get_project` / `apply_command` / `import_asset` / `undo` / `redo` 外，MCP 不暴露以下功能；它们必须由人在界面触发。** 智能体负责准备输入、给操作清单、读回结果并继续。

## 0. 能力总表

| 分类 | 能力 | 入口 | 产出/副作用 |
| --- | --- | --- | --- |
| 文本 | 一键生成字幕 | AI 功能 → 文本 | 新建置顶文字轨（字幕） |
| 文本 | 字幕翻译 | AI 功能 → 文本 → 翻译 | 新建置顶文字轨（译文字幕） |
| 文本 | 译制配音 | 翻译时勾选 | 译文字幕轨 + 朗读音频轨 |
| 音频 | AI 朗读（本地/云端） | AI 功能 → 音频 | 导入音频素材，按文字片段起点放到朗读轨 |
| 音频 | 响度测量 | 音频工具 | 只测量，不改片段；可据此设 `gain` |
| 音频 | AI 降噪（LocalVQE） | 音频工具 | 新音频素材；替换/新增片段 |
| 音频 | 人声/音源分离（UVR/HTDemucs） | 音频工具 | 多條分轨素材 + 分轨轨道 |
| 音频 | 音频 DSP（降噪/美化） | 音频工具 | 新音频素材 |
| 音频 | 参考音抽取 | 朗读/翻译 | 临时参考音频文件 |
| 视频 | 超分（Real-ESRGAN） | 视频工具 | 新视频素材，替换片段 |
| 视频 | 补帧（RIFE） | 视频工具 | 新视频素材，替换片段 |
| 视频 | 智能重构（YOLOX/YuNet） | 视频工具 | 新视频素材，替换片段（16:9→9:16 等） |
| 视频 | 稳定/去噪/去闪烁/动态模糊/放大 | 视频工具 | 新视频素材，替换片段 |
| 模型 | 下载/删除/探测/定位 | 模型管理 | 本地模型文件 |
| 导出 | MP4 / ProRes / GIF | 导出对话框 | 成片文件 |

## 1. 字幕生成（ASR）

### 可用模型

| model id | 名称 | 语言 | 特点 |
| --- | --- | --- | --- |
| `sense-voice-int8` | SenseVoice | 中/英/日/韩/粤 | 推荐默认；快、准、多语 |
| `whisper-base-int8` | Whisper Base | 多语言 | 低算力；精度一般 |
| `whisper-small-int8` | Whisper Small | 多语言 | 更高精度；更慢 |
| `paraformer-zh-small-int8` | Paraformer 中文 Small | 中文 | 低算力；中文稳定 |
| `paraformer-trilingual-int8` | Paraformer 中粤英三语 | 中/粤/英 | 非自回归；快 |
| `silero-vad` | Silero VAD | — | 语音切段；字幕必装 |

### 流程

1. 选中一个带音轨的片段（视频或音频）。**选中的片段决定转写源与时间映射**。
2. 打开 AI 功能 → 文本 → 选择 ASR 模型。
3. 若模型/VAD 未安装：确认下载 → 跳转模型管理 → 下载完成后回来。
4. 点「生成字幕」。
5. 后端抽音、VAD 切段、识别；返回 `SubtitleCue[] {start,end,text}`。
6. 前端把 cue 映射到时间线（考虑片段的 `start` / `in` / `duration`），新建置顶文字轨。
7. 智能体重新 `get_project`，找到新文字轨和片段，逐条校对。

### 映射规则（重要）

- 如果片段是素材的 `in..in+duration` 区间，超出区间的 cue 会被丢弃。
- 时间线时间 = `clip.start + max(0, cue.start - clip.in)`。
- 结果吸附到帧；过短（<0.1s）的 cue 会被丢弃。
- 若识别结果为空，先检查：素材是否真的有音轨、语言/模型是否匹配、VAD 是否安装。

### 校对命令

```json
{"kind":"clip.update","baseRevision":<rev>,"payload":{"clipId":"<cue>","patch":{"text":"修正后的字幕"}}}
{"kind":"clip.trim","baseRevision":<rev>,"payload":{"clipId":"<cue>","edge":"end","time":12.4}}
{"kind":"clip.move","baseRevision":<rev>,"payload":{"clipIds":["<cue>"],"delta":0.2}}
```

## 2. 字幕翻译与译制配音

### 流程

1. 选中音频/视频片段。
2. AI 功能 → 文本 → 翻译：选目标语言（英/中/日/韩/西/法/德）。
3. 可选「译制配音」。需要本地 TTS 模型；默认取原片前 10 秒做参考音色。
4. 生成：
   - 先 ASR 得到原文字幕；
   - 调用已配置的 OpenAI 兼容端点逐行翻译（`translate_text`）；
   - 新建「译文字幕」轨；
   - 若勾选配音：抽取参考音 → TTS 合成 → 导入音频 → 放到朗读轨。
5. 智能体重读工程，检查译文长度、时间溢出与音色一致性。

### 注意

- 翻译依赖「AI 与 MCP」里配置的模型端点；没配就只出字幕或失败。
- 译文通常比原文长，字幕要重新断句；必要时 `clip.trim` / `clip.move`。
- 配音长度和字幕时长不会自动完全一致；以语音自然为准，字幕可微调。
- 声音克隆需要权利人的明确同意；不要克隆未授权声音。

## 3. AI 朗读（TTS）

### 本地模型

| model id | 名称 | 语言 | 特点 |
| --- | --- | --- | --- |
| `moss-tts-nano` | MOSS TTS Nano（0.1B） | 中/英多语 | 默认本地；需配套 audio tokenizer |
| `zipvoice-distill-int8-zh-en` | ZipVoice（123M） | 中/英 | 音色克隆；需参考音频 |

### 云端 TTS

在设置里配置 provider，支持的类型：

`openai` / `elevenlabs` / `azure` / `google` / `baidu` / `minimax` / `volcengine` / `custom`

字段包括 base URL、API key/secret、app id/group id、region、model、voice、格式、语速、音量、音调、额外音色、HTTP 方法/头/体/音频路径。**API 密钥是敏感信息，不要写进分镜、日志或交付物。**

### 流程

1. 准备文字片段：可以用字幕轨，也可以单独建文字轨。
2. 选中要朗读的文字片段（可多选）。**只处理选中的片段。**
3. AI 功能 → 音频 → AI 朗读：
   - 模型：本地 MOSS / ZipVoice，或云端 provider。
   - 音色：内置音色 / 参考音频克隆。
   - 参考文本：可手动填或自动转写。
4. 合成后每段音频导入素材库，按对应文字片段的 `start` 放回时间线。
5. 重叠时自动新建「朗读 2」「朗读 3」…，不会错位。
6. 智能体检查：文字与语音起点是否一致、是否有截断、音量是否合适。

### 注意

- 先定稿文字再合成，避免反复重跑。
- 参考音频 5–15 秒、干净、单人、无音乐；参考文本要与音频一致。
- 朗读片段是普通音频片段，可 `gain` / `fadeIn` / `fadeOut` / `pan` / `pitch`。
- 没有本地模型也可以只用云端；没有网络则只能用本地。

## 4. 音频 AI 与 DSP

| 能力 | 函数/模型 | 行为 |
| --- | --- | --- |
| 响度测量 | `audio_measure_loudness` | 返回 `integrated_lufs` / `true_peak_dbtp`；不改工程 |
| AI 降噪 | LocalVQE | 降噪/去混响；生成新音频 |
| 人声分离 | UVR / HTDemucs | 生成 vocals/drums/bass/other 等分轨 |
| 音频 DSP | denoise / beautify | 轻/中/强或自然/明亮/温暖预设 |
| 参考音抽取 | `audio_extract_reference` | 抽取片段音频供 TTS 克隆 |

### 落回时间线的方式

- **纯音频片段**：替换素材引用，`in=0`，时长取 `min(原时长, 新素材时长)`。
- **视频片段**：原画面保留并静音；处理后的音频放到下面一条新轨。
- **音源分离**：源片段静音，按分轨新建多条轨道（如「分离 · vocals」），起点对齐源片段。

### 响度目标

| 目标 | LUFS | 用途 |
| --- | --- | --- |
| streaming | -14 | YouTube/社媒/流媒体 |
| podcast | -16 | 播客/口播 |
| broadcast | -23 | 广播/电视 |

真峰值上限 **-1 dBTP**。AI Cut 的响度工具会算出一个非破坏性的 `gain`，夹在 -60..12 dB；静音素材返回空。

**不要用「拉满音量」代替混音。** 先测响度，再调增益/压缩/ducking。

## 5. 视频 AI 与 DSP

| 能力 | 模型 | 参数 | 用途 |
| --- | --- | --- | --- |
| 超分 | `realesr-general-x4v3` / `realesr-x4plus` | scale | 低清素材放大；x4plus 质量更高更慢 |
| 补帧 | `rife-v4.7` | factor | 24→30/60、慢动作 |
| 智能重构 | `yolox-nano` / `yunet-2023mar` | subject: face/person/auto/center；aspect: 9:16/1:1/16:9/source；height/smooth | 16:9 → 竖屏，主体跟踪 |
| 稳定 | 无模型 DSP | light/medium/strong | 手持抖动 |
| 去噪 | 无模型 DSP | light/medium/strong | 暗部噪点 |
| 去闪烁 | 无模型 DSP | light/medium/strong | 生成视频/延时 |
| 动态模糊 | 无模型 DSP | 0..1 | 增加运动感 |
| 放大 | 无模型 DSP | 1.5 / 2.0 | 快速放大 |

**落回方式**：处理结果是一个新视频素材，替换原片段引用，`in=0`，时长取 `min(原片段时长, 新素材时长)`。时间线位置不变。

**注意**

- 超分/补帧很吃显存与时间；先处理短片段验证。
- 生成视频的闪烁/果冻，优先去闪烁 + 稳定，不要过度补帧。
- 竖屏重构会让主体在画面中移动；长镜头分段处理，避免跟踪漂移。
- 处理前保留原始素材引用；处理后可 `undo` 回退。

## 6. 模型管理

- 入口：模型管理面板；显示 feature（asr/tts/enhance/separate/interpolate/superres/track/reframe）、tag（text/audio/visual）、大小、安装状态、来源（ModelScope / HuggingFace / GitHub / 镜像）。
- 支持：下载、取消、探测源、删除、在文件管理器中定位。
- 区域偏好：auto / international / domestic；下载前缀可配。
- 下载前看剩余大小；模型缺失时 AI 功能会提示并跳转下载。
- 离线环境：提前下载；不要假设模型一定已安装。

## 7. 导出

| 格式 | 编码 | 音频 | 用途 |
| --- | --- | --- | --- |
| MP4 | H.264 + AAC 192k，`yuv420p`，faststart | 有 | 平台交付 |
| ProRes | ProRes 422（profile 2），PCM 48k | 有 | 母版/后期 |
| GIF | 调色板，最高 720p，15fps | 无 | 短循环/贴图 |

- 分辨率：project / 1080p / 720p。
- 质量：high（CRF 18）/ standard（23）/ small（28）。
- 帧率：跟随工程或指定；GIF 固定 15。
- **文字片段会被 Canvas 预渲染成 PNG 并烧录**；字幕不是独立 SRT/VTT 文件。
- 音频混音：所有发声轨按 `gain` / `start` / `fadeIn` / `fadeOut` / `pitch` / `pan` 混合；单轨时直通，多轨 `amix`。
- 导出前检查离线素材；缺失会报错。
- 当前没有内置转场、蒙版轨或字幕文件导出。需要这些请用外部工具预处理/后处理。

## 8. 智能体协作边界

**智能体可以：**

- 用 `import_asset` 把 TTS 生成的音频、分离出的分轨、处理后的视频导入。
- 建文字轨/字幕占位、调整文字与时间。
- 读回 AI 操作后的工程，继续校对与精剪。
- 用 `undo` 回退人误操作。

**智能体不可以（除非外部 harness 提供额外工具）：**

- 触发 App 内的 ASR/TTS/翻译/音频 AI/视频 AI。
- 触发导出。
- 读取模型文件或 API 密钥。
- 直接把字幕写成 SRT/VTT 文件（当前产品没有这个导出面）。

**正确的协作话术：**

> 字幕文字片段已按镜头排好。请在 AI 功能 → 文本里选择 SenseVoice，确认 VAD 已下载，选中 S01 片段后点「生成字幕」。完成后告诉我，我会重读工程并校对时间与断句。

## 9. 故障排查

| 现象 | 先查 |
| --- | --- |
| 字幕为空 | 素材有音轨吗？VAD/ASR 模型装了吗？选错片段了吗？ |
| 字幕时间偏移 | 片段有 `in` 偏移吗？cue 是否被窗口裁剪？ |
| 字幕太长/太碎 | 换模型、调 VAD、重新断句；不要只压字号 |
| 朗读没声音 | 模型/音色选了吗？参考音频有效吗？片段被静音了吗？ |
| 翻译失败 | AI 端点配置/网络；字幕是否为空 |
| 配音与字幕不同步 | 译文变长；重断句或微调字幕，不要硬拉音频 |
| 降噪后「水下感」 | 降噪过强；换轻预设或只处理噪声段 |
| 超分后脸崩 | 换模型/降倍率；不要对低质生成脸过度超分 |
| 补帧果冻 | 降低倍率；运动复杂处保留原帧率 |
| 导出黑屏 | 素材离线？文字 PNG 缺失？轨道 visible 关了吗？ |
| 导出没声音 | 轨道 muted？片段 muted？素材 hasAudio？GIF 本来无音 |

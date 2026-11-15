# 云端语音识别服务（ASR Providers）设计

日期：2026-11-15
状态：已确认，待实现

## 目标

让语音识别和语音合成一样，支持在应用内配置第三方云 API，而不是只能下载本地模型：

- **字幕模型下拉列表首项**是一行操作项「配置语音识别服务…」，点击跳转设置页新增的
  「语音识别」分区（与 TTS 的 `ai.ttsSettings` 完全同构）；
- 设置页可添加多家云 ASR 服务，字段按接口类型切换，支持测试、保存、删除；
- 已配置的服务以「云端识别」分组出现在同一个下拉里，选中即可直接生成字幕；
- 云端识别对**字幕、剪口播（词时间）、参考音频转写**三条链路同时生效；
- 一并接入 **DeepSeek 的 ASR 与 TTS** 官方接口（协议以官方文档为准）。

一期只做**同步单请求**的 9 个接口类型；AWS（S3 异步）与讯飞（LFASR 上传轮询）二期。

## 非目标

- 实时 / 流式识别：本功能只做整段文件识别，不做边说边出字；
- 说话人分离、翻译、情绪等附加能力（各家字段先不解析）；
- 强制对齐（forced alignment）：没有原生词时间戳的服务不做二次对齐，`timed=false` 如实上报；
- 多路并发请求：一期串行，避免触发各家 QPS/并发限制；
- AWS Transcribe 与讯飞语音转写（二期，配置结构届时再加，不留空字段）。

## 背景与约束

### 现有链路

- 本地识别 `crates/daemon/src/asr.rs`：ffmpeg 抽 16 kHz 单声道 WAV → Silero VAD 切段 →
  sherpa-onnx 逐段识别 → 按标点切字幕，`want_words` 时同时产出词时间（`timed`）。
- 三个调用方都走 `asr_transcribe` / `asr_transcribe_words`：字幕（`asr` store）、
  剪口播（`cutReview`）、参考音频转写（`aiActions`）。
- `cloud_tts.rs` 已经验证了「daemon 内配置中心 + 协议适配 + 设置页表单」这套形态，
  云端 ASR 直接复用它的分层，不发明新架构。

### 各家硬限制（决定切段策略）

| 服务 | 单请求上限 | 音频格式 | 原生时间戳 |
|---|---|---|---|
| DeepSeek | 120 s / 8 MiB | 16-bit PCM WAV、Ogg Opus | 无 |
| OpenAI（Whisper 系） | 25 MiB | mp3/m4a/wav/webm… | `verbose_json` 有句级、部分模型有词级 |
| Azure 快速转写 | 5 h / 500 MB | wav/mp3/opus/flac… | 句级 + 词级 |
| Google STT v2 `recognize` | 内联 10 MB / 约 1 min | wav/flac/… | 词级（`enableWordTimeOffsets`） |
| 阿里百炼（OpenAI 兼容） | 单条音频，随模型 | wav/mp3… | **无**（原生 DashScope 才有，一期不接） |
| 腾讯云极速版 | 60 MB / 约 2 h | wav/mp3… | 词级（`result.words`） |
| 火山引擎极速版 | 一次请求返回 | wav/mp3… | 词级（`result.utterances[].words`） |
| 百度短语音 | 60 s / 10 MB | PCM/WAV（raw body） | 无 |
| 自定义 HTTP | 由用户负责 | 任意 | 可选 `words_path` |

阿里一期的取舍需要说明：OpenAI 兼容接口最稳、字段最少，但只回纯文本，因此**阿里走 VAD 兜底**；
需要词级时间时再接 DashScope 原生的 `sentences[].words[]`（二期）。

### DeepSeek 协议（官方文档 2026-11 口径）

- ASR：`POST https://api.deepseek.com/v1/tools/asr`，`Authorization: Bearer`，
  `multipart/form-data` 的 `file` 字段；只收 16-bit PCM WAV / Ogg Opus，≤ 8 MiB、≤ 120 s，
  无 `language` 参数（自动判别）；响应 `{request_id, text, duration_ms}`。
- TTS：`POST https://api.deepseek.com/v1/tools/tts`，JSON
  `{text, voice_id: stella|tide, format: wav|pcm, filter_markdown}`；直接返回音频流，
  `wav` 为 `audio/wav`，`pcm` 为 24 kHz 16-bit 单声道裸流；单次 ≤ 10 000 计费字符、≤ 30 分钟。

## 用户流程

1. 打开 AI 面板 → 字幕页 → 点模型下拉，**第一项**是「配置语音识别服务…」；
2. 点击后跳到 设置 → 语音识别，点「添加服务」，选接口类型（DeepSeek / OpenAI 兼容 /
   Azure / Google / 阿里百炼 / 腾讯云 / 火山引擎 / 百度 / 自定义 HTTP），填 Key 等字段；
3. 点「测试」：用媒体库里第一个含音轨的素材跑一小段，回显识别文本前 40 字；
4. 保存后回到 AI 面板，下拉里出现「云端识别 · <服务名>」，选中它，点「生成字幕」；
5. 剪口播时若该服务无原生词时间，沿用现有 `timed=false` 提示（按语音段边界估算）。

## 数据流

```
AiPane（字幕 / 参考音频）           asr store            daemon
  selectedModelId = "cloud:<id>" ──► generate(path,id) ──► asr_transcribe(path, "cloud:<id>")
                                                              │ 前缀命中
cutReview（剪口播）──────────────────────────────────────────► asr_transcribe_words(...)
                                                              ▼
                                                     cloud_asr::transcribe
                                                       extract_wav(16k mono)
                                                       VAD 段 → 按 kind 合并成块
                                                       逐块 HTTP（串行，emit 进度）
                                                       合并 cues / words（+ 偏移、去重）
```

`cloud:` 前缀是唯一路由点，三个调用方都不改签名。

## 后端

### 模块

```
crates/daemon/src/cloud_asr.rs
  ├ CloudAsrKind / CloudAsrProvider / CloudAsrConfig / CloudAsrRuntime
  ├ 命令：config / set_config / test
  ├ transcribe(host, network, provider, path, language, want_words)
  ├ 协议：openai / deepseek / azure / google / aliyun / tencent / volcengine / baidu / custom
  └ 工具：TC3 签名、百度 token 缓存、响应解析、块合并
```

`asr.rs` 只在 `transcribe_file` 入口加一处分支：

```rust
if let Some(provider_id) = model_id.strip_prefix("cloud:") {
    return cloud_asr::transcribe(host, provider_id, path, language, want_words).await;
}
```

桌面壳 `src-tauri/src/cloud_asr.rs` 是薄转发；`rpc.rs` 增加三条命令；`capabilities.rs`
新增 `cloud_asr`（无头端可用）。

### 配置

`<config_dir>/asr.json`，与 `tts.json` 同目录同格式：

```jsonc
{ "providers": [{
  "id": "uuid", "name": "DeepSeek", "kind": "deepseek", "enabled": true,
  "base_url": "", "api_key": "", "api_secret": "", "app_id": "", "region": "",
  "model": "", "language": "", "max_seconds": 0,          // 0 = 按 kind 预置
  "method": "POST", "headers": "", "body": "",
  "text_path": "", "words_path": ""                       // 仅 custom
}]}
```

`max_seconds` 预置值：DeepSeek 110、OpenAI 600、Azure 3600（不切）、Google 55、
阿里 110、腾讯 600、火山 600、百度 55、custom 60。用户填 0 时用预置值，填了则以用户值为准，
最终再按 `min(上限, 源时长)` 钳制。

单请求字节上限是 kind 内置常量（`max_bytes()`，不进配置）：DeepSeek 8 MiB、OpenAI 25 MiB、
Azure 500 MB、Google 10 MB、百度 10 MB，其余按 60 MB。16 kHz 单声道 WAV 约 32 KB/s，
按上限的 90% 折算秒数后与 `max_seconds` 取小，避免只按字节切导致超时。

### 协议要点

| kind | 请求 | 鉴权 | 响应取值 |
|---|---|---|---|
| `deepseek` | `POST {base}/v1/tools/asr`，multipart `file` | `Bearer` | `text` |
| `openai` | `POST {base}/audio/transcriptions`，multipart + `model` + `response_format=verbose_json` | `Bearer` | `segments[].start/end/text`、`words[]` |
| `azure` | `POST {base}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`（`{base}` 留空时按 region 拼 `https://{region}.api.cognitive.microsoft.com`），multipart `audio` + `definition` | `Ocp-Apim-Subscription-Key` | `phrases[].offsetMilliseconds/durationMilliseconds/text/words[]` |
| `google` | `POST https://speech.googleapis.com/v2/speech:recognize?key=`，JSON `audio.content` base64 | API Key | `results[].alternatives[].words[].startOffset/endOffset` |
| `aliyun` | `POST {base}/compatible-mode/v1/chat/completions`，`input_audio` data URL | `Bearer` | `choices[0].message.content`（纯文本） |
| `tencent` | `POST https://asr.cloud.tencent.com/asr/flash/v1/{app_id}`，query + raw body | `TC3-HMAC-SHA256`（SecretId/SecretKey） | `result.voice_text_str`、`result.words[].start_time/end_time` |
| `volcengine` | `POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`，JSON `audio.data` base64 | `X-Api-App-Key` / `X-Api-Access-Key` / `X-Api-Resource-Id` | `result.text`、`result.utterances[].words[]` |
| `baidu` | `POST {base}/server_api?dev_pid=1537&cuid=ai-cut&token=`，raw PCM body | OAuth token（API Key/Secret 换取并缓存） | `result[0]` |
| `custom` | `{base}`，`{{audio}}`（base64）/`{{audio_path}}` 占位，GET/POST | 用户填 headers 或 Bearer | `text_path`、可选 `words_path` |

时间单位统一在适配器内换算成秒；腾讯的 `start_time` 已是毫秒、Google 是 `"1.200s"` 字符串、
Azure 是毫秒、OpenAI 是秒、火山是毫秒——解析函数各自处理，对外只暴露
`SubtitleCue { start, end, text }` 与 `TranscriptWord { text, start, end }`。

### 切段与合并

1. `extract_wav` 取整段 16 kHz 单声道（复用现有函数）；
2. Silero VAD 出语音段（`min_silence 0.35 s`、`max_speech 15 s`，与本地一致）；
3. 按 `max_seconds` 把**相邻语音段**合并成请求块（不切断语音段）：
   - 有原生时间戳：用返回时间 + 块内语音段偏移，`timed=true`；
   - 无原生时间戳：整块文本按标点切句，在该块的语音区间内按字数比例分配时间，
     `timed=false`（与现有「无词时间戳」提示一致）；
4. 去重：相邻块首尾句完全相同且间隔 < 0.3 s 时丢弃后一块的首句；
5. VAD 模型缺失时退化为定长 30 s 切片，并在完成消息里提示「未安装语音检测模型，
   字幕边界较粗」——云端识别不强制用户下载本地模型；
6. 进度：每块前后 `emit(EVENT_ASR, "transcribing", i/n)`；取消沿用 `asr_cancel` 的
   `AtomicBool`，块之间检查一次，取消后不落任何字幕。

### 错误映射

`401/403` → 「密钥无效或无权限」；`429` → 「请求过于频繁或并发超限，请稍后重试」；
`413` → 「音频超过该服务单次上限」；超时 → 「识别超时」；其余把响应体前 200 字附在错误后。
每个服务的原始错误码（腾讯 `Error.Code`、火山 `header.code`、百度 `err_no`）单独映射成中文。

## 前端

### 新增文件

- `src/core/cloudAsrApi.ts`：`cloudAsrConfig / cloudAsrSetConfig / cloudAsrTest`
  （`requireCapability("cloud_asr", ...)`）。
- `src/core/asrSources.ts`：纯函数
  `buildAsrOptions(models, providers, t) → SelectOption[]`（首项 action、本地分组的现状项、
  云端分组）、`parseAsrModelId(id) → { kind: "local" | "cloud" | "action", id }`。

### AiPane

- `modelOptions` 改为调用 `buildAsrOptions`；首项 `action: true`，`@action` →
  `layout.openSettings("asr")`；本地模型统一归入「本地模型」分组，云端服务归入「云端识别」分组；
- 选中 `cloud:<id>` 时：`selectedModel` 为空、`ready = provider.enabled`、`missing = 0`，
  点「生成字幕」不再弹下载确认，直接 `asr.generate(asset, "cloud:<id>", "auto")`；
- 选择持久化沿用 `useModelChoice` 的既有约定：`cloud:<id>` 作为普通 id 记录；
  该服务被删除或停用后，回落到下拉里第一个可用项，不报错；
- `requestModelDownload` 只对本地模型生效；
- 参考音频转写的可用性判断同步放宽（有云端服务即可）。

### 设置页

- `SettingsSection` 增加 `"asr"`，侧栏在「语音合成」上方插入「语音识别」，
  caption「云端语音识别服务与自定义接口」；
- 分区结构照抄 TTS：服务列表（名称 / 类型 / 模型 / 启用状态 / 编辑 / 删除）→ 新建表单
  （名称、接口类型、启用、按 kind 的字段、`max_seconds`、自定义模板）→ 测试 → 保存；
- 测试样本取「媒体库第一个含音轨的素材」，没有则提示先导入；结果回显前 40 字。

### DeepSeek TTS

- `CloudTtsKind::Deepseek` + `settings.tts.kind.deepseek`；
- `Call::deepseek`：`POST {base}/v1/tools/tts`，
  body `{text, voice_id, format, filter_markdown: true}`，`format` 只给 `wav|pcm`；
- 音色固定两项 `stella`（女，默认）/ `tide`（男），不进「获取音色」流程；
- `pcm` 返回 24 kHz 单声道裸流，复用 `wrap_pcm_wav(pcm, 24_000)` 补头；
- 单次上限 10 000 计费字符（中文按 2 计）：朗读按字幕条目逐条请求，单条超限时在该条内
  按句子再切分多次请求，最后按顺序拼接，不整批失败。

### i18n

`settings.section.asr`、`settings.section.asr.caption`、`settings.asr.*`（约 30 键）、
`ai.asrSettings`、`ai.asrSettingsHint`、`ai.asrCloudGroup`、`settings.asr.kind.*`、
`settings.tts.kind.deepseek` 全部 zh/en 双写。

## 测试

- **Rust 单测**（`cloud_asr.rs`）：各 kind 响应 → cues/words 解析、时间单位换算、
  TC3 签名固定向量、块合并与去重、`max_seconds` 钳制、错误码映射；
- **Vitest**（`src/core/__tests__/asrSources.test.ts`）：首项必须是 action、
  云端项前缀与分组、`parseAsrModelId` 三种返回值；
- **手测清单**：每个 kind 的保存/测试/报错文案；下拉首项跳转；云端生成字幕；
  剪口播 `timed=false` 提示；识别中取消；VAD 模型缺失时的定长切片提示；
- **门禁**：`pnpm test`、`pnpm build`、`cargo test`（daemon）。不触碰
  `src/core/{ops,commands,serialize}`，golden 不重生成。

## 二期（不在本次实现）

- **AWS Transcribe**：S3 上传 → `StartTranscriptionJob` → 轮询，需要额外 Bucket 字段；
- **讯飞语音转写**：LFASR 上传 → 轮询，进度语义变为「排队中/识别中」；
- 阿里 DashScope 原生词级时间戳、说话人分离、翻译。

## 风险

- **腾讯 TC3 签名**是最容易出错的一环（签名串、时间戳、query 顺序），必须用固定向量单测锁住；
- **无原生时间戳的服务（DeepSeek / 阿里 / 百度）字幕精度**低于本地模型，属于接口能力上限，
  在 UI 上如实提示，不做虚假对齐；
- **各家限制随版本变化**：`max_seconds` 用保守预置值，并在错误映射里对 413 给出明确提示；
- **密钥落盘**：与 TTS 一致明文存 `asr.json`（本地应用既有约定），不新增加密层。

# AI 变声（离线批量）设计

日期：2026-11-10
状态：已确认，待实现

## 目标

把时间线上选中的音频片段（或带声音的视频片段）批量换成同一个音色：

- 右键「AI 变声…」打开 AI 面板的「变声」页，一次提交所有选中片段；
- 参考音色可以从媒体库选一段音频（过长自动截取其中有声音的 10 秒），也可以存进
  **全局音色库**，跨工程复用；
- 跑完把结果按原时间点铺到新的「AI 变声」轨道，原片段就地静音；
- 进度走全局 HUD，可中途取消，取消不落任何片段。

首版只接 **MeanVC2**（Apache-2.0，ONNX 已就绪、体积最小）；X-VC 的接口位置留好，
等导出脚本写好再上。

## 非目标

- 实时 / 流式监听（模型本身是流式的，但这个功能只做离线整段转换）；
- 16 kHz 之外的音质增强（带宽扩展、超分）；
- 换脸 / 口型对齐，只换声音；
- 云端变声服务。

## 背景与约束

- **MeanVC2**：18M 参数、16 kHz 单声道、识别-合成范式（Fast-U2++ 出 BNF → mean-flow
  DiT 单步/少步 → Vocos 解码）。ONNX 拆成 5 张图 + 说话人编码器，int8 转换链约 74 MB，
  说话人编码器（WavLM-Large + ECAPA）int8 387 MB。
- **采样率**：模型进出都是 16 kHz；本工程音频 AI 统一输出 48 kHz 立体声
  （`audio_ai::OUT_SAMPLE_RATE`），所以变声后上采样到 48 kHz 再落盘，不改变其它环节。
- **模型体积**：两个模型都远大于 10 MB，全部走按需下载，不随包。
- **下载源**：HF 只有社区导出的 ONNX，魔搭没有；cn 区域需要自建 ONNX 镜像
  （沿用 ZipVoice 的 `yuqingteck/mommy-story-on-device-models` 做法）。

## 用户流程

1. 时间线选中 1..N 个片段（纯音频，或带声音的视频）；
2. 右键 → AI 智能 → **AI 变声…**；
3. AI 面板打开「变声」页，待处理列表预填所选片段（名称 + 时长 + 起点），可逐个移除；
4. 选音色：音色库条目 / 「从媒体库选…」/ 「用当前片段导入音色」；
5. 选模型（默认 MeanVC2 int8）；点「开始变声」；
6. HUD 显示 `3/8 片段`，可取消；
7. 完成后：原片段 `muted = true`，结果片段按原起点放到「AI 变声」轨道，并选中新片段。

## 数据流

```
AiVoicePage --(clipIds, voiceId, modelId)--> aiActions.voiceChange
  --> invoke voice_change_convert
      --> 逐片段：ffmpeg 解码片段 -> 16k 单声道 -> MeanVC2 -> 16k 波形
                 -> 上采样 48k 立体声 -> cache/vc-<clipId>.wav
  <-- [{ clipId, path, duration }]
  --> importAsset + 一次 dispatch: placeConvertedVoice
```

整批只在后端成功返回后才改工程；中途取消 / 失败会清掉本次已写的缓存 wav，工程里不会
落下半批片段。

## 后端

### 模块

```
src-tauri/src/voice_change/
  mod.rs       命令、批量编排、进度事件、缓存目录
  refs.rs      参考音频截取、说话人向量计算与缓存
  meanvc2.rs   五张图的会话 + 宿主循环（流式图按 160 ms 块顺序喂）
```

`xvc.rs` 预留，首版不实现。

### 命令

```rust
voice_change_convert(app, clips: Vec<VcClip>, voice_id: String, model_id: String)
    -> Vec<VcClipResult>            // { clip_id, path, duration }

voice_change_cancel()               // 置位取消标志

voice_change_voice_list()  -> Vec<VoiceEntry>
voice_change_voice_import(app, asset_path: String, name: String,
                          start: Option<f64>, duration: Option<f64>) -> VoiceEntry
voice_change_voice_delete(id: String) -> ()
```

`VcClip { clip_id, path, start, duration }`：前端只传片段位置，后端自己 ffmpeg 解码，
不额外产生中间文件。

### 批量与进度

- 片段串行处理；总进度 = `(已完成片段 + 当前片段进度) / N`；
- 每片段顺序：`decoding` → `processing`（模型）→ `writing`；
- 事件 `voice-change-progress`：`{ state, progress, index, total, message }`，
  state ∈ `idle | decoding | processing | writing | done | error`；
- 取消用 `AtomicBool`（与 `audio_ai` 同款），检查点：每片段开始、每个 chunk 之后；
- 会话线程数 `min(4, 物理核数)`：官方单核 RTF ≈ 0.63，4 线程对 10 分钟素材足够。

### MeanVC2 宿主循环

严格按上游 `runtime/run_rt.py` 的语义移植（参考实现：`kiarina/meanvc2_onnx` 的
`tool/onnx_stream.py`）：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `CHUNK` | 2560 | 160 ms @ 16 kHz |
| `BN_WINDOW` | 19 帧 | ASR 滑窗（120 ms 模型） |
| `BN_STRIDE` | 16 | 每次前移的帧数 |
| `REQUIRED_CACHE` | 8 | ASR attention 缓存长度 |
| `offset` | 8 起、每窗 +4 | 位置编码偏移 |
| `CHUNK_SIZE` / `BLOCK_SIZE` | 12 / 4 帧 | DiT 每次出 120 ms，留 40 ms 前瞻 |
| `steps` | 2（可 1..3） | mean-flow ODE 步数 |
| 声码器重叠 | 2 帧 mel / 160 采样 | 拼接处交叉淡化 |

要点：

- `fbank` 输入是 16-bit 定标后的 400 采样帧（`* 32768`），每 160 采样一帧；
- ASR 输出 BNF 用 `align_corners=True` 线性插值到 17 帧后去掉首帧；
- 噪声由 **片段 id 派生的固定种子** 生成，保证同一片段重复跑结果一致；
- DiT 的 4 层 KV cache 只在最后一步 ODE 更新，`offset ≥ 4000` 归零重建；
- 长音频按块流式写 wav，不把整段波形留在内存；
- 结尾要 flush：补静音块直到 BNF 与 mel 缓冲清空，再截掉尾部补零。

### 参考音频

1. 解码整段（或片段）→ 16 kHz 单声道；
2. 20 ms 帧 RMS → dB，阈值取「峰值 −35 dB」与「−45 dBFS」的较大者，5 帧平滑；
3. 滑 10 秒窗（步长 0.5 s），取「有声帧占比最高」的窗；两端各留 50 ms 余量；
4. 不足 10 秒用全长；**短于 3 秒或几乎全静音直接拒绝**，提示换一段；
5. 归一化到 −3 dBFS，16-bit PCM 存成 `reference.wav`；
6. 说话人向量：`speaker.onnx`（`wav [1, samples] → embedding [1, 256]`），存
   `meanvc2.json`，之后换音色不再跑编码器。

### 音色库

```
<数据目录>/voices/
  index.json
  v-<slug>-<hash6>/
    reference.wav      16 kHz 单声道，≤10 秒
    meanvc2.json       { "embedding": [256 floats], "model": "meanvc2-120ms" }
```

`index.json`：

```json
{
  "version": 1,
  "voices": [
    {
      "id": "v-zhangsan-3f9a2c",
      "name": "张三",
      "createdAt": 1762732800,
      "duration": 9.8,
      "source": { "assetId": "a-123", "name": "访谈.wav" }
    }
  ]
}
```

音色库是全局资源（和字体库、模型同一层），工程里不复制；变声结果已经落成普通音频
素材，删音色不影响已有工程。

### 模型目录

`models.rs` 新增 feature `voice-change`、family `MeanVc2`，条目：

| entry | 文件 | 体积 | 区域源 |
| --- | --- | --- | --- |
| `meanvc2-int8` | `fbank.onnx`, `asr.int8.onnx`, `gtm.onnx`, `dit.int8.onnx`, `vocos.int8.onnx` | ≈74 MB | intl: `kiarina/MeanVC2-ONNX`；cn: 自建魔搭镜像 |
| `meanvc2-speaker` | `speaker.int8.onnx` | ≈387 MB | 同上（CC BY-SA 3.0，镜像要带 NOTICE） |

说话人编码器单独成条：已经有音色（或从别处拿到 256 维向量）的用户只下 74 MB 就能变声。

`sha256` 一律取自 HF 仓库的 `manifest.json`，不要手填。

## 前端

- **入口**：`useTimelineMenus` 在音频 / 视频片段的 AI 组加 `ai.voiceChange`，点击写
  `aiLaunch`（page: `"voice"`，带 `clipIds`），再打开 AI 面板；纯图片 / 文字片段不出现。
- **页面**：`AiVoicePage.vue`，与画图、视频生成同级（`aiPage = "voice"`）：
  - 顶部状态行：模型是否就绪、音色是否已选、待处理数量；
  - 音色区：音色库列表（单选）、「从媒体库选…」、「导入新音色」；
  - 模型选择：默认 `meanvc2-int8`，下拉显示体积与是否已装；
  - 待处理列表：片段名、起点、时长、移除按钮；
  - 底部：「开始变声」+ 总进度。
- **动作**：`aiActions.voiceChange(params, ctx)`；`useAiClipActions.voiceChange(ids)`
  负责模型检查与 HUD。
- **放置**：`src/core/voiceEdit.ts`

  ```ts
  placeConvertedVoice(doc, items: { clipId, assetId, duration }[], trackName)
  ```

  1. 原片段 `muted = true`（位置、时长不动）；
  2. 结果按 `start` 排序，复用 `placeVoiceover` 的空轨打包逻辑；
  3. 结果片段 `in = 0`，`duration = min(模型输出时长, 原片段时长)`；
  4. 原片段所在轨道锁定 / 目标轨道不存在时自动新建「AI 变声 2」。
- **i18n**：`ai.voiceChange`、`ai.voiceChangeRun`、`ai.voiceLibrary`、`ai.voiceImport`、
  `ai.voiceTooShort`、`ai.voiceNoAudio` 等，zh / en 同步。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 模型未安装 | 页面顶部给出体积与「下载」按钮，复用模型管理器 |
| 音色缺失（被删） | 列表置灰，提示重新选择 |
| 片段无音轨（视频静音） | 后端解码为空 → 该片段标记失败，其余继续 |
| 参考音频太短 / 全静音 | 拒绝导入并提示换一段 |
| 取消 | 不落盘，HUD 显示已取消，原片段保持原样 |
| 写 wav 失败 | 整批报错，已写文件清理 |

批量里单个片段失败不中断整批，最后汇总「N 个成功，M 个失败：原因」。

## 测试

Rust：

- `refs`：静音前缀自动跳过、9 秒素材不被截断、2 秒素材拒绝、全静音拒绝；
- 16k ↔ 48k 重采样长度与峰值；
- `meanvc2` 权重缺失时 `skip`（同 `localvqe` 的测试写法）；
- 取消后不返回结果、缓存目录无残留。

前端：

- `placeConvertedVoice`：原片段静音、结果按起点落位、重叠自动加轨、时长截断；
- 菜单可见性：音频 / 视频出现，图片 / 文字不出现（扩展 `timelineMenus.test.ts`）；
- 音色库 store：导入去重、删除后工程引用提示。

手动：一段 30 秒带 8 秒静音前缀的对白，验证自动截取、批量 3 段、取消、重跑结果一致。

## 分期

- **P0**：MeanVC2 单模型 + 音色库 + 批量 + 放置 + HUD；
- **P1**：自建魔搭 ONNX 镜像、int8 变体与线程调优、长音频压测；
- **P2**：X-VC（先写导出脚本并对拍 PyTorch，再决定用哪版权重）。

## 风险 / 待验证

- MeanVC2 的 ONNX 只在流式场景对拍过，整段离线要自己验证尾部 flush 与长音频一致性；
- 16 kHz 输出在视频对白里会偏“电话音”，先按约定接受，后续再评估带宽扩展；
- 中文音色的相似度需要用真实素材 A/B，社区对拍只验了整体频谱距离；
- X-VC 的现成 ONNX 是波兰语微调版，不能直接当官方权重用（P2 再说）。

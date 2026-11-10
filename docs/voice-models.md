# 变声模型（MeanVC2）

## 条目

| entry | 文件 | 体积 | 用途 |
| --- | --- | --- | --- |
| `meanvc2-int8` | fbank / asr.int8 / gtm / dit.int8 / vocos.int8 | ≈74 MB | 变声本身 |
| `meanvc2-speaker` | speaker.int8.onnx | 387 MB | 只在「导入新音色」时需要 |

两条都 `bundled: false`，走按需下载；体积远超 10 MB 上限，不随安装包分发。

## 来源

- Hugging Face：`kiarina/MeanVC2-ONNX`（Apache-2.0，转换图；speaker 为 CC-BY-SA-3.0）
- 上游论文 / 代码：`ASLP-lab/MeanVC2`（Interspeech 2026）
- 魔搭：**待上传**，见下。

`sha256` / `approx_bytes` 一律取自 HF 仓库的 `manifest.json`，不要手改。

## 魔搭镜像（待办）

国内下载源需要自己转一份并上传，步骤：

```bash
git clone --depth 1 https://github.com/kiarina/meanvc2_onnx.git
cd meanvc2_onnx/tool && uv sync
uv run python export_onnx.py --int8
uv run python export_speaker.py
shasum -a 256 build/onnx/*.onnx build/onnx/speaker/*.onnx
```

把 6 个文件传到 `yuqingteck/mommy-story-on-device-models` 的 `voice/meanvc2/`
（speaker 放 `voice/meanvc2/speaker/speaker.int8.onnx`），校验和与 `models.rs` 一致后，
给每个 `ModelFile.sources` 追加：

```rust
verified(
    "modelscope",
    "cn",
    "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/voice/meanvc2/<file>",
    "<同 sha256>",
    <同 size>,
)
```

然后把 `models.rs` 测试 `every_downloadable_model_has_a_modelscope_source` 里
`entry.feature != "voice-change"` 这条豁免删掉。

## 已知限制

- 模型输出 16 kHz 单声道；落盘前上采样到 48 kHz，但高频信息不会回来。
- 说话人向量 256 维，音色库只存 `reference.wav` + 向量，换音色不重跑编码器。

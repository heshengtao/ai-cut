# 变声模型（MeanVC2）

## 条目

| entry | feature | 文件 | 体积 | 用途 |
| --- | --- | --- | --- | --- |
| `meanvc2-int8` | `voice-change` | fbank / asr.int8 / gtm / dit.int8 / vocos.int8 / speaker.int8 | ≈461 MB | 完整 AI 变声包（转换 + 导入音色） |

`bundled: false`，走按需下载；体积远超 10 MB 上限，不随安装包分发。

**它是一个完整包**：没有 `speaker.int8.onnx` 就导入不了音色，新用户也就无法变声，
所以不再把音色编码器拆成独立条目。加载路径仍然分开：转换只读五张转换图，导入音色
只加载 `speaker.int8.onnx`；两种操作都从同一个 `meanvc2-int8/` 目录取文件。

旧版本曾把编码器单独装在 `meanvc2-speaker/`；升级后首次下载会用硬链接复用旧文件
并清掉旧目录，不会让用户重下 387 MB，也不会留下看不见的重复占用。

许可证是混合的：转换图 Apache-2.0，音色编码器 CC-BY-SA-3.0。

## 来源

- Hugging Face：`kiarina/MeanVC2-ONNX`（Apache-2.0，转换图；speaker 为 CC-BY-SA-3.0）
- 魔搭国内镜像：`ailm32442/meanvc2-onnx`（同一份权重，`speaker/` 子目录放编码器）
- 上游论文 / 代码：`ASLP-lab/MeanVC2`（Interspeech 2026）

`sha256` / `approx_bytes` 一律取自 HF 仓库的 `manifest.json`，不要手改。改完跑
`node tools/check-models.mjs --deep --id meanvc2` 校验线上字节。

URL 里的 revision 必须是 **commit sha**（上面的 `4e04f461…` 就是），不能是 `master`：
浮动分支会随上游每次 push 换字节，而清单里的 sha256 是硬门禁。`node tools/pin-models.mjs`
会检查这一点，`--write` 负责重新钉。

## 魔搭镜像

国内源是 [ailm32442/meanvc2-onnx](https://modelscope.cn/models/ailm32442/meanvc2-onnx)，
公开仓库，文件与 HF 镜像逐字节一致。下载 URL 形如：

```
https://modelscope.cn/models/ailm32442/meanvc2-onnx/resolve/4e04f4610343de1ceefbff3b11a83d1e65299241/<file>
```

仓库布局：

```
fbank.onnx
asr.int8.onnx
gtm.onnx
dit.int8.onnx
vocos.int8.onnx
speaker/speaker.int8.onnx
README.md
NOTICE
```

`models.rs` 里每个文件都同时声明 `modelscope`（cn）和 `hf`（intl）两个源；下载器
按网络区域挑选，`every_downloadable_model_has_a_modelscope_source` 测试会强制双源。
`NOTICE` 里保留了音色编码器的 CC BY-SA 3.0 署名。

重新导出 / 更新镜像时：

```bash
git clone --depth 1 https://github.com/kiarina/meanvc2_onnx.git
cd meanvc2_onnx/tool && uv sync
uv run python export_onnx.py --int8
uv run python export_speaker.py
shasum -a 256 build/onnx/*.onnx build/onnx/speaker/*.onnx
```

把 6 个文件按上面的布局上传到 `ailm32442/meanvc2-onnx`，确保 `models.rs` 里的
`sha256` / size 与上传文件一致，再跑 `cargo test --lib models::tests`。

## 已知限制

- 模型输出 16 kHz 单声道；落盘前上采样到 48 kHz，但高频信息不会回来。
- 说话人向量 256 维，音色库只存 `reference.wav` + 向量，换音色不重跑编码器。

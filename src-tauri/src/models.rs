//! 本地 AI 模型的清单与应用内下载器。
//!
//! 清单是「有哪些模型、从哪下、对不对得上」的唯一来源；每一项是一组文件，
//! 目录为应用配置目录下的 `models/<id>/`。
//!
//! 下载策略参考 AI DAW：
//! - 每个文件带**多个官方源**，并用 `region` 标注国际（HF / GitHub）或国内（魔搭）；
//! - 区域偏好为 `auto` 时先探测两边首字节延迟，谁快先用谁；失败自动回退另一区域；
//! - 用户可配置镜像前缀（留空 = 只用官方源），镜像在官方源之前尝试；
//! - 每个地址最多重试 3 次，支持 `Range` 断点续传与 `.part` 原子落地；
//! - 每个源可以有**自己的 sha256 / 体积**（镜像不保证字节完全一致时仍能校验）。
//!
//! **分发规则**：只有总体积不超过 [`BUNDLE_LIMIT`]（10 MB）的模型才允许随安装包分发；
//! 更大的模型一律由用户按需下载。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::network::{ModelSourcePreference, NetworkConfig, NetworkRuntime};

/// 模型下载进度事件名。
pub const EVENT_MODEL: &str = "model-progress";
/// 随包分发的体积上限：10 MB。
pub const BUNDLE_LIMIT: u64 = 10 * 1024 * 1024;
/// 每个地址最多尝试次数。
const DOWNLOAD_ATTEMPTS: u32 = 3;
/// 区域探测的单请求超时：被墙的源要快速失败，不能把用户卡住。
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
/// 手动「测试源」的超时：比自动探测宽松一点，避免慢 CDN 被误判。
const TEST_TIMEOUT: Duration = Duration::from_secs(10);

/// 模型运行时类型（决定用哪种识别器加载）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelFamily {
    Whisper,
    Paraformer,
    SenseVoice,
    Vad,
    MossTtsNano,
    MossAudioTokenizerNano,
    #[serde(rename = "zipvoice")]
    ZipVoice,
    #[serde(rename = "localvqe")]
    LocalVqe,
    #[serde(rename = "htdemucs")]
    Htdemucs,
    #[serde(rename = "htdemucs6s")]
    Htdemucs6s,
    #[serde(rename = "uvr")]
    Uvr,
    #[serde(rename = "rife")]
    Rife,
    #[serde(rename = "real_esrgan_general")]
    RealEsrganGeneral,
    #[serde(rename = "real_esrgan_x4plus")]
    RealEsrganX4plus,
    #[serde(rename = "yolox_nano")]
    YoloxNano,
    #[serde(rename = "yunet")]
    Yunet,
    #[serde(rename = "qwen3_aligner")]
    Qwen3Aligner,
    /// MiniMax-H3 视频 + 音频生成（stable-diffusion.cpp）。
    #[serde(rename = "minimax_h3")]
    MiniMaxH3,
    /// MiniMax-H3 Ref2VA：参考图 / 参考视频 / 参考音频条件（不能接首尾帧）。
    #[serde(rename = "minimax_h3_ref2va")]
    MiniMaxH3Ref2va,
    /// Wan2.1 T2V 1.3B 视频生成（stable-diffusion.cpp；无音频，轻量快速）。
    #[serde(rename = "wan21_t2v")]
    Wan21T2v,
    /// Wan2.2 TI2V 5B 视频生成（24 fps，`4k + 1` 帧，用 Wan2.2 VAE）。
    #[serde(rename = "wan22_ti2v")]
    Wan22Ti2v,
    /// Wan2.2 T2V A14B：high / low noise 两个专家轮流去噪。
    #[serde(rename = "wan22_t2v_a14b")]
    Wan22T2vA14b,
    /// HunyuanVideo 1.5（Qwen2.5-VL + ByT5 双文本编码器，无音频）。
    #[serde(rename = "hunyuan_video_15")]
    HunyuanVideo15,
    /// LTX-2.3 22B（Gemma 3 文本编码器 + 视频 / 音频 VAE）。
    #[serde(rename = "ltx_23")]
    Ltx23,
    /// LTX-2.5 22B（Gemma 4 文本编码器，投影层已内置，不再需要 connectors）。
    #[serde(rename = "ltx_25")]
    Ltx25,
    /// SD 1.5 inpainting（单文件，mask 局部重绘最稳的轻量档）。
    #[serde(rename = "sd15")]
    Sd15,
    /// SDXL Base 1.0（单文件，1024p 通用画质）。
    #[serde(rename = "sdxl")]
    Sdxl,
    /// Z-Image Turbo（Qwen3-4B 文本编码器，8 步、低显存）。
    #[serde(rename = "z_image_turbo")]
    ZImageTurbo,
    /// FLUX.1 schnell（FLUX VAE + CLIP-L + T5-XXL，4 步）。
    #[serde(rename = "flux1_schnell")]
    Flux1Schnell,
    /// FLUX.1 Kontext（参考图指令改图，同一套 FLUX 组件）。
    #[serde(rename = "flux1_kontext")]
    Flux1Kontext,
    /// Qwen-Image（Qwen2.5-VL 7B 文本编码器，20B DiT）。
    #[serde(rename = "qwen_image")]
    QwenImage,
    /// Qwen-Image-Edit 2509（参考图指令改图，需要 Qwen2.5-VL 视觉投影层）。
    #[serde(rename = "qwen_image_edit")]
    QwenImageEdit,
    /// MeanVC2：18M 零样本变声（16 kHz，六张 ONNX 图）。
    #[serde(rename = "meanvc2")]
    MeanVc2,
}

/// 一个下载源。
#[derive(Debug, Clone, Copy)]
pub struct ModelSource {
    /// `hf` / `modelscope` / `github` / `custom`。
    pub kind: &'static str,
    /// `intl`（国外直连友好）或 `cn`（国内友好）。
    pub region: &'static str,
    /// 直链。
    pub url: &'static str,
    /// 该源特有的 sha256（为空时回退到文件级）。
    pub sha256: Option<&'static str>,
    /// 该源特有的字节数（为空时回退到文件级）。
    pub size: Option<u64>,
}

const fn official(kind: &'static str, region: &'static str, url: &'static str) -> ModelSource {
    ModelSource {
        kind,
        region,
        url,
        sha256: None,
        size: None,
    }
}

const fn verified(
    kind: &'static str,
    region: &'static str,
    url: &'static str,
    sha256: &'static str,
    size: u64,
) -> ModelSource {
    ModelSource {
        kind,
        region,
        url,
        sha256: Some(sha256),
        size: Some(size),
    }
}

const fn sized(
    kind: &'static str,
    region: &'static str,
    url: &'static str,
    size: u64,
) -> ModelSource {
    ModelSource {
        kind,
        region,
        url,
        sha256: None,
        size: Some(size),
    }
}

/// 一个可下载文件。
#[derive(Debug, Clone, Copy)]
pub struct ModelFile {
    /// 落地文件名。
    pub filename: &'static str,
    /// 主源的精确字节数（进度与完整性校验用；未知时为 0）。
    pub approx_bytes: u64,
    /// 主源 sha256（小写十六进制）。小文件可能为空，此时只校验大小。
    pub sha256: &'static str,
    /// 有序候选源。
    pub sources: &'static [ModelSource],
}

/// 清单条目（= 一组缺一不可的文件）。
#[derive(Debug, Clone, Copy)]
pub struct ModelEntry {
    /// 稳定标识，同时作为落盘子目录名。
    pub id: &'static str,
    /// 展示名。
    pub name: &'static str,
    /// 所属功能：`asr` / `vad` / `tts` / `tts-codec`。
    pub feature: &'static str,
    /// AI 面板里的标签：`text` / `audio` / `visual`。
    pub tag: &'static str,
    /// SPDX 许可。
    pub license: &'static str,
    /// 运行时类型。
    pub family: ModelFamily,
    /// 是否为默认推荐（界面上默认选中并排在最前）。
    pub recommended: bool,
    /// 是否随安装包分发（必须满足 10 MB 上限）。
    pub bundled: bool,
    /// 组内文件。
    pub files: &'static [ModelFile],
}

impl ModelEntry {
    /// 整组体积。
    pub fn total_bytes(&self) -> u64 {
        self.files.iter().map(|file| file.approx_bytes).sum()
    }

    /// 是否满足「可以随包分发」的体积上限。
    pub fn bundle_eligible(&self) -> bool {
        self.total_bytes() <= BUNDLE_LIMIT
    }

    /// 这一组文件覆盖的区域（去重后按 `cn`、`intl` 排序）。
    pub fn regions(&self) -> Vec<String> {
        let mut regions: Vec<String> = self
            .files
            .iter()
            .flat_map(|file| file.sources.iter())
            .map(|source| source.region.to_string())
            .collect();
        regions.sort();
        regions.dedup();
        regions
    }
}

// ---------------------------------------------------------------------------
// 清单
// ---------------------------------------------------------------------------

/// 同一文件同时从魔搭与 HuggingFace 下载；小文件没有 LFS sha256，只校验体积。
macro_rules! moss_file {
    ($file:literal, $size:literal, $sha:literal, $ms:literal, $hf:literal) => {
        ModelFile {
            filename: $file,
            approx_bytes: $size,
            sha256: $sha,
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    concat!(
                        "https://modelscope.cn/models/",
                        $ms,
                        "/resolve/master/",
                        $file
                    ),
                ),
                official(
                    "hf",
                    "intl",
                    concat!("https://huggingface.co/", $hf, "/resolve/main/", $file),
                ),
            ],
        }
    };
}

/// 魔搭与 HuggingFace 上同一个 JSON 的字节不同（版本/格式化差异），
/// 因此需要给两个源分别声明体积；小文件没有 LFS sha256，只校验体积。
macro_rules! moss_file_sized {
    ($file:literal, $size:literal, $ms_size:literal, $hf_size:literal, $ms:literal, $hf:literal) => {
        ModelFile {
            filename: $file,
            approx_bytes: $size,
            sha256: "",
            sources: &[
                sized(
                    "modelscope",
                    "cn",
                    concat!(
                        "https://modelscope.cn/models/",
                        $ms,
                        "/resolve/master/",
                        $file
                    ),
                    $ms_size,
                ),
                sized(
                    "hf",
                    "intl",
                    concat!("https://huggingface.co/", $hf, "/resolve/main/", $file),
                    $hf_size,
                ),
            ],
        }
    };
}

/// MiniMax-H3 FL2VA / Ref2VA 共用的三个文件：文本编码器、视频 VAE、音频 VAE。
///
/// 两个模型档（`minimax-h3` 与 `minimax-h3-ref2va`）只差一个 DiT；这里把共用部分
/// 抽成同一份 `ModelFile` 定义，下载器才能按「文件名 + 大小 + sha256」认出可复用文件。
const H3_TEXT_ENCODER_FILE: ModelFile = ModelFile {
    filename: "qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
    approx_bytes: 13_102_161_024,
    sha256: "a8ccadccd57ef34c838ffb8a7da8368bb554721b2760274a1d3b0df63960b997",
    sources: &[
        official(
            "modelscope",
            "cn",
            "https://modelscope.cn/models/unsloth/MiniMax-H3-GGUF/resolve/master/qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
        ),
        official(
            "hf",
            "intl",
            "https://huggingface.co/leejet/MiniMax-H3-GGUF/resolve/main/qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
        ),
    ],
};

const H3_VIDEO_VAE_FILE: ModelFile = ModelFile {
    filename: "minimax_h3_video_vae_fp16.safetensors",
    approx_bytes: 5_207_808_496,
    sha256: "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522",
    sources: &[
        official(
            "modelscope",
            "cn",
            "https://modelscope.cn/models/unsloth/MiniMax-H3-GGUF/resolve/master/vae/minimax_h3_video_vae_fp16.safetensors",
        ),
        official(
            "hf",
            "intl",
            "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors",
        ),
    ],
};

const H3_AUDIO_VAE_FILE: ModelFile = ModelFile {
    filename: "minimax_h3_audio_vae_fp32.safetensors",
    approx_bytes: 605_254_808,
    sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
    sources: &[
        official(
            "modelscope",
            "cn",
            "https://modelscope.cn/models/unsloth/MiniMax-H3-GGUF/resolve/master/vae/minimax_h3_audio_vae_fp32.safetensors",
        ),
        official(
            "hf",
            "intl",
            "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors",
        ),
    ],
};

/// SenseVoice Small：阿里 FunAudioLLM 的非自回归模型，中英日韩粤五语，自带标点。
///
/// 短句鲁棒性明显好于同尺寸的自回归 Whisper（不会整词漏识），速度也快一个量级，
/// 因此作为字幕功能的默认推荐。魔搭镜像与 HF 源字节完全一致，共用文件级 sha256。
pub static CATALOG: &[ModelEntry] = &[
    ModelEntry {
        id: "sense-voice-int8",
        name: "SenseVoice（中英日韩粤 · 推荐）",
        feature: "asr",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::SenseVoice,
        recommended: true,
        bundled: false,
        files: &[
            ModelFile {
                filename: "model.int8.onnx",
                approx_bytes: 239_233_841,
                sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/model.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "tokens.txt",
                approx_bytes: 315_894,
                sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/tokens.txt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt",
                    ),
                ],
            },
        ],
    },
    // Qwen3 强制对齐器：给「剪口播」补词级时间。
    //
    // 它只吃「音频 + 文本」，所以换成任何 ASR（Paraformer / SenseVoice / 云端）都能用；
    // 权重是 4 bit 量化版（1 GB），不随包分发。
    ModelEntry {
        id: "qwen3-aligner-0.6b-q4",
        name: "Qwen3 强制对齐器（词级时间 · 多语言）",
        feature: "align",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::Qwen3Aligner,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "model_q4.onnx",
                approx_bytes: 1_048_397_349,
                sha256: "59b528896d70b34e57838e160d16d5f7cfc02d86c7c6ad46cdc57c25c15497b7",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/qwen3-aligner-0.6b-q4/model_q4.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/valoomba/Qwen3-ForcedAligner-0.6B-ONNX/resolve/main/onnx/model_q4.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "tokenizer.json",
                approx_bytes: 11_429_733,
                sha256: "e95e4127f5ea82f89695f00bb3c143eb7edd411e6096e27ff56319397f481e77",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/qwen3-aligner-0.6b-q4/tokenizer.json",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/valoomba/Qwen3-ForcedAligner-0.6B-ONNX/resolve/main/tokenizer.json",
                    ),
                ],
            },
        ],
    },
    // Whisper Base：HF 与魔搭双源。
    //
    // 魔搭的 `base-encoder.int8.onnx` 与 HF 的字节不同（同尺寸、不同量化校准），
    // 因此该源单独声明 sha256；其余文件两边一致。
    ModelEntry {
        id: "whisper-base-int8",
        name: "Whisper Base（多语言 · 低算力）",
        feature: "asr",
        tag: "text",
        license: "MIT",
        family: ModelFamily::Whisper,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "base-encoder.int8.onnx",
                approx_bytes: 29_120_534,
                sha256: "0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11",
                sources: &[
                    verified(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-base/resolve/master/base-encoder.int8.onnx",
                        "8dd58f75cfe74a7eb01bf0379c560d5c93c374f731f21e397e1a3c60b1e5747f",
                        29_120_534,
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-encoder.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "base-decoder.int8.onnx",
                approx_bytes: 130_672_026,
                sha256: "9759d217388a01b3a4c7c15533201067b48ae819c4daafc8624e64b9409dc02d",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-base/resolve/master/base-decoder.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-decoder.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "base-tokens.txt",
                approx_bytes: 816_730,
                sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-base/resolve/master/base-tokens.txt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main/base-tokens.txt",
                    ),
                ],
            },
        ],
    },
    ModelEntry {
        id: "paraformer-zh-small-int8",
        name: "Paraformer 中文 Small（低算力）",
        feature: "asr",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::Paraformer,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "model.int8.onnx",
                approx_bytes: 81_828_675,
                sha256: "3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small/resolve/master/model.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/model.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "tokens.txt",
                approx_bytes: 75_352,
                sha256: "4b2d964e18b9cf139b473003b6698fb2ed9a2a5ec55b93daa677b28f578897aa",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small/resolve/master/tokens.txt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main/tokens.txt",
                    ),
                ],
            },
        ],
    },
    ModelEntry {
        id: "whisper-small-int8",
        name: "Whisper Small（多语言 · 更高精度）",
        feature: "asr",
        tag: "text",
        license: "MIT",
        family: ModelFamily::Whisper,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "small-encoder.int8.onnx",
                approx_bytes: 112_442_483,
                sha256: "4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-small/resolve/master/small-encoder.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-encoder.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "small-decoder.int8.onnx",
                approx_bytes: 262_226_114,
                sha256: "acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-small/resolve/master/small-decoder.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-decoder.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "small-tokens.txt",
                approx_bytes: 816_730,
                sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-small/resolve/master/small-tokens.txt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-tokens.txt",
                    ),
                ],
            },
        ],
    },
    ModelEntry {
        id: "paraformer-trilingual-int8",
        name: "Paraformer 中粤英三语（非自回归）",
        feature: "asr",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::Paraformer,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "model.int8.onnx",
                approx_bytes: 244_684_152,
                sha256: "eb3cdd288f535cf73258f491cdd7d68ad5a00aee135c0bba4c0884ea8d926144",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuadraV/sherpa-onnx-paraformer-trilingual-zh-cantonese-en/resolve/master/model.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-trilingual-zh-cantonese-en/resolve/main/model.int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "tokens.txt",
                approx_bytes: 118_931,
                sha256: "8e4593d7a2eb2404ff82976b5494265e9a06283ca4d5e8605bf7b4fed557a492",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuadraV/sherpa-onnx-paraformer-trilingual-zh-cantonese-en/resolve/master/tokens.txt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-trilingual-zh-cantonese-en/resolve/main/tokens.txt",
                    ),
                ],
            },
        ],
    },
    ModelEntry {
        id: "silero-vad",
        name: "Silero VAD（语音检测）",
        feature: "vad",
        tag: "text",
        license: "MIT",
        family: ModelFamily::Vad,
        recommended: false,
        bundled: true,
        files: &[ModelFile {
            filename: "silero_vad_v5.onnx",
            approx_bytes: 2_313_101,
            sha256: "",
            sources: &[
                verified(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/pengzhendong/silero-vad/resolve/master/v5/silero_vad.onnx",
                    "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
                    2_327_524,
                ),
                official(
                    "github",
                    "intl",
                    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx",
                ),
            ],
        }],
    },
    // ------------------------------------------------------------------
    // 音频 AI（降噪 / 音源分离）
    // ------------------------------------------------------------------
    // UVR（MDX-Net）是 2-stem 人声/伴奏分离，训练目标就是「从伴奏里抠出人声」，
    // 比 HTDemucs 的 4/6 分轨更贴近视频剪辑里的对白提取。权重来自 UVR 社区
    // （TRvlvr/model_repo），由 sherpa-onnx 转成带元数据的 ONNX。
    // 注意：上游 model_repo 没有显式许可证文件；商用前请自行确认。
    ModelEntry {
        id: "uvr-mdx-voc-ft",
        name: "UVR 人声提取（Voc_FT · 推荐）",
        feature: "separate",
        tag: "audio",
        license: "UVR（见上游）",
        family: ModelFamily::Uvr,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "UVR-MDX-NET-Voc_FT.onnx",
            approx_bytes: 66_762_795,
            sha256: "e411182ce2c53541fefdcc99a8f46f2fe03978eb22038b9497c1d9d95a00fad4",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/uvr/UVR-MDX-NET-Voc_FT.onnx",
                ),
                official(
                    "github",
                    "intl",
                    "https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR-MDX-NET-Voc_FT.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/k2-fsa/sherpa-onnx-models/resolve/main/source-separation-models/UVR-MDX-NET-Voc_FT.onnx",
                ),
            ],
        }],
    },
    ModelEntry {
        id: "uvr-mdx-9482",
        name: "UVR 人声提取（轻量 · 29 MB）",
        feature: "separate",
        tag: "audio",
        license: "UVR（见上游）",
        family: ModelFamily::Uvr,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "UVR_MDXNET_9482.onnx",
            approx_bytes: 29_704_738,
            sha256: "9d78f8566fa8198065214ab628be1de966a500c57786695aa4b13e2b27a7727d",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/uvr/UVR_MDXNET_9482.onnx",
                ),
                official(
                    "github",
                    "intl",
                    "https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR_MDXNET_9482.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/k2-fsa/sherpa-onnx-models/resolve/main/source-separation-models/UVR_MDXNET_9482.onnx",
                ),
            ],
        }],
    },
    // LocalVQE 只有 6 MB，随包分发；下载源仅作「重新下载」兜底。
    ModelEntry {
        id: "localvqe",
        name: "LocalVQE（人声降噪 / 去混响）",
        feature: "enhance",
        tag: "audio",
        license: "Apache-2.0",
        family: ModelFamily::LocalVqe,
        recommended: false,
        bundled: true,
        files: &[ModelFile {
            filename: "localvqe-ns.onnx",
            approx_bytes: 6_152_621,
            sha256: "268339d31dd427cbe5cf9107028185b7a473b5ae0cbc59f1ba39187767367060",
            sources: &[official(
                "hf",
                "intl",
                "https://huggingface.co/ailm32442/localvqe-ns-onnx/resolve/main/localvqe-ns.onnx",
            )],
        }],
    },
    // HTDemucs 4 分轨：209 MB，按需下载。权重来自 Meta Demucs v4（MIT）。
    ModelEntry {
        id: "htdemucs-ort-v1",
        name: "HTDemucs（音源分离 · 4 分轨）",
        feature: "separate",
        tag: "audio",
        license: "MIT",
        family: ModelFamily::Htdemucs,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "htdemucs.ort",
            approx_bytes: 209_884_896,
            sha256: "09dc165512d8ef7480bcb2cacea9dda82d571f8dbf421d8c44a2ca5568bec729",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/htdemucs-ort/resolve/master/htdemucs.ort",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/gentij/htdemucs-ort/resolve/main/htdemucs.ort",
                ),
            ],
        }],
    },
    // HTDemucs 6 分轨：自足 ONNX（波形进、分轨出），接入更简单但体积更大。
    ModelEntry {
        id: "htdemucs-6s",
        name: "HTDemucs 6s（音源分离 · 6 分轨）",
        feature: "separate",
        tag: "audio",
        license: "MIT",
        family: ModelFamily::Htdemucs6s,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "htdemucs_6s.onnx",
            approx_bytes: 258_159_781,
            sha256: "48f8e84945579f8ab340e083339e9221e03785dbe733a52c388200b6d3ca779a",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/htdemucs-ort/resolve/master/htdemucs_6s.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s.onnx",
                ),
            ],
        }],
    },
    // ------------------------------------------------------------------
    // AI 朗读（MOSS-TTS-Nano）
    // ------------------------------------------------------------------
    // 模型拆成两个条目：TTS 权重与音频 Tokenizer 权重分别下载、分别校验。
    // 两者缺一不可，前端会把两个条目的体积加在一起显示。
    ModelEntry {
        id: "moss-tts-nano",
        name: "MOSS TTS Nano（0.1B · 中英多语）",
        feature: "tts",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::MossTtsNano,
        recommended: false,
        bundled: false,
        files: &[
            moss_file_sized!(
                "browser_poc_manifest.json",
                470_720,
                470_720,
                503_354,
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file_sized!(
                "tts_browser_onnx_meta.json",
                4_302,
                4_302,
                4_487,
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "tokenizer.model",
                470_897,
                "",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_prefill.onnx",
                283_305,
                "d56126dcd0574c2f15d98fc6b35eda68d0386b5bd9c5e38e28548d6f2ea8f3db",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_decode_step.onnx",
                291_483,
                "698cbc2fc1c2feca16e5895614ed52bbb32ded10f236c076f477b2e69abf32d8",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_local_decoder.onnx",
                49_231,
                "51aa754301b38550a5f9adda0ad93bd3dc95819afb511e6dcabf4a90b345a454",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_local_cached_step.onnx",
                53_685,
                "aa9035fefc1c138a951a8bcfc0374fb03a25f1ece67f7f7f53bce349b84a1dd5",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_local_fixed_sampled_frame.onnx",
                471_262,
                "40cdb00efc171c450cf91468e01429caa41b0252222cd308e978f58fe354afa8",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_global_shared.data",
                440_813_568,
                "bce8312c3df6a44545302cae229b61054fe0672e0b252ba59cba47adeed831dc",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
            moss_file!(
                "moss_tts_local_shared.data",
                229_678_080,
                "bae7782032c0fb12490ab42afe009f87ae6c75a0f0596fc7b5c08e4d5ee93916",
                "openmoss/MOSS-TTS-Nano-100M-ONNX",
                "OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX"
            ),
        ],
    },
    ModelEntry {
        id: "moss-audio-tokenizer-nano",
        name: "MOSS Audio Tokenizer Nano（48 kHz 立体声）",
        feature: "tts-codec",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::MossAudioTokenizerNano,
        recommended: false,
        bundled: false,
        files: &[
            moss_file_sized!(
                "codec_browser_onnx_meta.json",
                16_461,
                16_461,
                17_036,
                "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
                "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
            ),
            moss_file!(
                "moss_audio_tokenizer_encode.onnx",
                815_775,
                "eadea4a645abdcf98714c7aead122ee2ce7da6e080f9f80b977cd1ca8e19473a",
                "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
                "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
            ),
            moss_file!(
                "moss_audio_tokenizer_encode.data",
                44_507_136,
                "aa751265b2bab2887eac224484546b194875aa7494b607115439b3dc6b228a2c",
                "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
                "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
            ),
            moss_file!(
                "moss_audio_tokenizer_decode_full.onnx",
                681_902,
                "0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac",
                "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
                "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
            ),
            moss_file!(
                "moss_audio_tokenizer_decode_shared.data",
                44_198_912,
                "e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad",
                "openmoss/MOSS-Audio-Tokenizer-Nano-ONNX",
                "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
            ),
        ],
    },
    ModelEntry {
        id: "zipvoice-distill-int8-zh-en",
        name: "ZipVoice（123M · 中英 · 音色克隆）",
        feature: "tts",
        tag: "text",
        license: "Apache-2.0",
        family: ModelFamily::ZipVoice,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "encoder.int8.onnx",
                approx_bytes: 5_570_211,
                sha256: "f2de9a761a85e5ddd125dee6e05bad1c7ee92c11b83b4d775dab216a6aa41379",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/encoder.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/k2-fsa/ZipVoice/resolve/main/zipvoice_distill/text_encoder_int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "decoder.int8.onnx",
                approx_bytes: 124_657_100,
                sha256: "3cc2e08a96610d7ea1b227398e97cdbbe0414499741d3aec0b8113db2a2ab251",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/decoder.int8.onnx",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/k2-fsa/ZipVoice/resolve/main/zipvoice_distill/fm_decoder_int8.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "tokens.txt",
                approx_bytes: 2_570,
                sha256: "ce98c1afc5f7a20c2484dffdd68a1fff0a4a2cc707328833750c4476c37cdbda",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/tokens.txt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/k2-fsa/ZipVoice/resolve/main/zipvoice_distill/tokens.txt",
                    ),
                ],
            },
            ModelFile {
                filename: "lexicon.txt",
                approx_bytes: 1_727_147,
                sha256: "c94b049d970e971acdc2a7e5e7b23ca594222a9d640e417c711f2ad1e7bb7d46",
                sources: &[official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/lexicon.txt",
                )],
            },
            ModelFile {
                filename: "vocos_24khz.onnx",
                approx_bytes: 54_157_409,
                sha256: "bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/vocos_24khz.onnx",
                    ),
                    official(
                        "github",
                        "intl",
                        "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx",
                    ),
                ],
            },
            ModelFile {
                filename: "espeak-ng-data.tar.gz",
                approx_bytes: 8_978_591,
                sha256: "d65c91ea142601a452fd4a5bf91c722d381c30f0c941ab733a97cff4794c430e",
                sources: &[official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/espeak-ng-data.tar.gz",
                )],
            },
            ModelFile {
                filename: "leijun-1.wav",
                approx_bytes: 291_028,
                sha256: "72e25f11b3fffc402cc9021736e49e7aa7ae97b1edbf514ae1a3ce994013c10d",
                sources: &[official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/zipvoice/test_wavs/leijun-1.wav",
                )],
            },
        ],
    },
    // ------------------------------------------------------------------
    // 视频（P2）
    // ------------------------------------------------------------------
    ModelEntry {
        id: "rife-v4.7",
        name: "RIFE v4.7（视频补帧）",
        feature: "interpolate",
        tag: "visual",
        license: "MIT",
        family: ModelFamily::Rife,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "rife47_ensemble_True_scale_1_sim.onnx",
            approx_bytes: 21_459_153,
            sha256: "f2479a88eae0ab33f697f3f481573ce5eacede039ade3088aee32ac091694972",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/rife/rife47_ensemble_True_scale_1_sim.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/ailm32442/ai-cut-models/resolve/main/rife/rife47_ensemble_True_scale_1_sim.onnx",
                ),
            ],
        }],
    },
    ModelEntry {
        id: "realesr-general-x4v3",
        name: "Real-ESRGAN general-x4v3（视频超分 · 快）",
        feature: "superres",
        tag: "visual",
        license: "BSD-3-Clause",
        family: ModelFamily::RealEsrganGeneral,
        recommended: false,
        bundled: true,
        files: &[ModelFile {
            filename: "realesr-general-x4v3.onnx",
            approx_bytes: 4_866_574,
            sha256: "7964f4acc824de94b71240c6b81de424216a87b4bad8651d098c2e49ff57c2a0",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/real-esrgan-general-x4v3/realesr-general-x4v3.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/ailm32442/ai-cut-models/resolve/main/real-esrgan-general-x4v3/realesr-general-x4v3.onnx",
                ),
            ],
        }],
    },
    ModelEntry {
        id: "realesr-x4plus",
        name: "Real-ESRGAN x4plus（视频超分 · 质量）",
        feature: "superres",
        tag: "visual",
        license: "BSD-3-Clause",
        family: ModelFamily::RealEsrganX4plus,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "RealESRGAN_x4plus.onnx",
            approx_bytes: 67_051_790,
            sha256: "62f4ae8bd6313a4458ffaabcb5426fc2e4711648e89e967198528d9c523ede65",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/real-esrgan-x4plus/RealESRGAN_x4plus.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/ailm32442/ai-cut-models/resolve/main/real-esrgan-x4plus/RealESRGAN_x4plus.onnx",
                ),
            ],
        }],
    },
    ModelEntry {
        id: "yolox-nano",
        name: "YOLOX-nano（目标检测）",
        feature: "track",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::YoloxNano,
        recommended: false,
        bundled: true,
        files: &[ModelFile {
            filename: "yolox_nano.onnx",
            approx_bytes: 3_659_603,
            sha256: "059e134ba0c599b025abc632530c1f730d624053277b214effc021940920f449",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/yolox-nano/yolox_nano.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/ailm32442/ai-cut-models/resolve/main/yolox-nano/yolox_nano.onnx",
                ),
            ],
        }],
    },
    ModelEntry {
        id: "yunet-2023mar",
        name: "YuNet（人脸检测）",
        feature: "reframe",
        tag: "visual",
        license: "MIT",
        family: ModelFamily::Yunet,
        recommended: false,
        bundled: true,
        files: &[ModelFile {
            filename: "face_detection_yunet_2023mar.onnx",
            approx_bytes: 232_801,
            sha256: "cea1903f83f897fd7bad52b7ec43ee97ea1c41a82c460bdc3444e9b1180e89aa",
            sources: &[
                official(
                    "modelscope",
                    "cn",
                    "https://modelscope.cn/models/ailm32442/ai-cut-models/resolve/master/yunet/face_detection_yunet_2023mar.onnx",
                ),
                official(
                    "hf",
                    "intl",
                    "https://huggingface.co/ailm32442/ai-cut-models/resolve/main/yunet/face_detection_yunet_2023mar.onnx",
                ),
            ],
        }],
    },
    // Wan2.1 T2V 1.3B：最轻量的文生视频模型（无音频），用来快速跑通整条链路 / 试提示词。
    // 3 个文件缺一不可：DiT（fp16，2.8 GB）、Wan2.1 VAE（254 MB）、UMT5-XXL 文本编码器
    // （Q4_K_M，3.7 GB）。整包约 6.7 GB，16 GB 显存 / 32 GB 内存都够。
    //
    // 帧率 16 fps、帧数网格 `4k + 1`、CLI 用 `--t5xxl` 而不是 `--llm`，也没有
    // `--audio-vae`（`video_gen.rs` 按 family 拼参数）。
    ModelEntry {
        id: "wan21-t2v-1.3b",
        name: "Wan2.1 T2V 1.3B（轻量 · 无音频）",
        feature: "video-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::Wan21T2v,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "wan2.1_t2v_1.3B_fp16.safetensors",
                approx_bytes: 2_838_303_560,
                sha256: "be531024cd9018cb5b48c40cfbb6a6191645b1c792eb8bf4f8c1c6e10f924dc5",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "wan_2.1_vae.safetensors",
                approx_bytes: 253_815_318,
                sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/vae/wan_2.1_vae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "umt5-xxl-encoder-Q4_K_M.gguf",
                approx_bytes: 3_655_145_312,
                sha256: "17cf97a5bbbc60a646d6105b832b6f657ce904a8a1ad970e4b59df0c67584a40",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/city96/umt5-xxl-encoder-gguf/resolve/master/umt5-xxl-encoder-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q4_K_M.gguf",
                    ),
                ],
            },
        ],
    },
    // Wan2.2 TI2V 5B：比 1.3B 新一代（24 fps、`4k + 1` 帧、Wan2.2 VAE），
    // 整包约 8.5 GB，是「画质能看 + 单卡跑得动」的折中点。仍然无音频。
    ModelEntry {
        id: "wan22-ti2v-5b",
        name: "Wan2.2 TI2V 5B（轻量 · 画质更好）",
        feature: "video-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::Wan22Ti2v,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "Wan2.2-TI2V-5B-Q4_K_M.gguf",
                approx_bytes: 3_433_116_000,
                sha256: "95b19697b7f98e65b0a543640e9ca7b4dfec32e2a6e3731e8e10708be52655e2",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/master/Wan2.2-TI2V-5B-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/main/Wan2.2-TI2V-5B-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "wan2.2_vae.safetensors",
                approx_bytes: 1_409_400_960,
                sha256: "e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/master/split_files/vae/wan2.2_vae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "umt5-xxl-encoder-Q4_K_M.gguf",
                approx_bytes: 3_655_145_312,
                sha256: "17cf97a5bbbc60a646d6105b832b6f657ce904a8a1ad970e4b59df0c67584a40",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/city96/umt5-xxl-encoder-gguf/resolve/master/umt5-xxl-encoder-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q4_K_M.gguf",
                    ),
                ],
            },
        ],
    },
    // Wan2.2 T2V A14B：MoE 双专家（high noise 先跑 80% 的步数，low noise 收尾），
    // 开源文生视频里画质第一档。整包约 23 GB（两个专家各 9.6 GB）。
    // 16 fps、`4k + 1` 帧，用 Wan2.1 VAE —— 与 1.3B 同一套帧数规则。
    ModelEntry {
        id: "wan22-t2v-a14b",
        name: "Wan2.2 T2V A14B（画质优先 · 双专家）",
        feature: "video-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::Wan22T2vA14b,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf",
                approx_bytes: 9_650_090_496,
                sha256: "091a5bae02e14aa016bc9b10a7892efda4c629346b81c5dcebbe30ea2ac8923a",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Wan2.2-T2V-A14B-GGUF/resolve/master/LowNoise/Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Wan2.2-T2V-A14B-GGUF/resolve/main/LowNoise/Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf",
                approx_bytes: 9_650_090_496,
                sha256: "e0c490c6e316fd91ff52034e4ca66b825717e33ff11624585c0ccfcb5d410c59",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Wan2.2-T2V-A14B-GGUF/resolve/master/HighNoise/Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Wan2.2-T2V-A14B-GGUF/resolve/main/HighNoise/Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "wan_2.1_vae.safetensors",
                approx_bytes: 253_815_318,
                sha256: "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/master/split_files/vae/wan_2.1_vae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "umt5-xxl-encoder-Q4_K_M.gguf",
                approx_bytes: 3_655_145_312,
                sha256: "17cf97a5bbbc60a646d6105b832b6f657ce904a8a1ad970e4b59df0c67584a40",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/city96/umt5-xxl-encoder-gguf/resolve/master/umt5-xxl-encoder-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q4_K_M.gguf",
                    ),
                ],
            },
        ],
    },
    // LTX-2.3 22B：Lightricks 的新一代音视频模型，Gemma 3 12B 当文本编码器，
    // 还要单独装 embeddings connectors（Gemma 的输出要过一层投影）与音频 VAE。
    // 24 fps、`8k + 1` 帧，整包约 26 GB。
    ModelEntry {
        id: "ltx-2.3",
        name: "LTX-2.3（22B · 视频 + 音频）",
        feature: "video-gen",
        tag: "visual",
        license: "LTX-2 Community License",
        family: ModelFamily::Ltx23,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "ltx-2.3-22b-dev-Q4_K_M.gguf",
                approx_bytes: 14_326_856_736,
                sha256: "e053e3d7827f3a69ecd00e55395d3a8f8616ab10d3a394e8d2b65ae204d490e0",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/LTX-2.3-GGUF/resolve/master/ltx-2.3-22b-dev-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/unsloth/LTX-2.3-GGUF/resolve/main/ltx-2.3-22b-dev-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "gemma-3-12b-it-qat-UD-Q4_K_XL.gguf",
                approx_bytes: 7_432_229_248,
                sha256: "da98f81c86916ed1c76b3eeda56b25cb7b8352b01093e2edb8028110fe2cb53b",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/gemma-3-12b-it-qat-GGUF/resolve/master/gemma-3-12b-it-qat-UD-Q4_K_XL.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/unsloth/gemma-3-12b-it-qat-GGUF/resolve/main/gemma-3-12b-it-qat-UD-Q4_K_XL.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "ltx-2.3-22b-dev_embeddings_connectors.safetensors",
                approx_bytes: 2_312_144_712,
                sha256: "a5c5148788d8d9d5d1e650e4cbf3502a46a2f7f975ce70c59082732c8905a8ae",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/LTX-2.3-GGUF/resolve/master/text_encoders/ltx-2.3-22b-dev_embeddings_connectors.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/unsloth/LTX-2.3-GGUF/resolve/main/text_encoders/ltx-2.3-22b-dev_embeddings_connectors.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "ltx-2.3-22b-dev_video_vae.safetensors",
                approx_bytes: 1_452_256_522,
                sha256: "8732bb70cf4343541815f45c9f90f5ff0519d679bd63483afc27bf79a08d3f4e",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/LTX-2.3-GGUF/resolve/master/vae/ltx-2.3-22b-dev_video_vae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/unsloth/LTX-2.3-GGUF/resolve/main/vae/ltx-2.3-22b-dev_video_vae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "ltx-2.3-22b-dev_audio_vae.safetensors",
                approx_bytes: 364_853_140,
                sha256: "d7711812d9387ce940c2cd5d65a4f5a1e57bf6087cf618d89b56dd3c722c4dea",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/LTX-2.3-GGUF/resolve/master/vae/ltx-2.3-22b-dev_audio_vae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/unsloth/LTX-2.3-GGUF/resolve/main/vae/ltx-2.3-22b-dev_audio_vae.safetensors",
                    ),
                ],
            },
        ],
    },
    // HunyuanVideo 1.5：腾讯的 720p 文生视频，因果视频 VAE + Qwen2.5-VL 7B
    // （fp8_scaled，9.4 GB）做主文本条件、ByT5 Small GlyphXL 补字形。无音频。
    // 24 fps、`4k + 1` 帧，整包约 29 GB。
    ModelEntry {
        id: "hunyuan-video-1.5",
        name: "HunyuanVideo 1.5（720p · 无音频）",
        feature: "video-gen",
        tag: "visual",
        license: "Tencent Hunyuan Community License",
        family: ModelFamily::HunyuanVideo15,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "hunyuanvideo1.5_720p_t2v_fp16.safetensors",
                approx_bytes: 16_653_368_128,
                sha256: "4f05e2a31b51b7ddee3ef336d234e0932001cbdc85887da15451069fda3e1d05",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/master/split_files/diffusion_models/hunyuanvideo1.5_720p_t2v_fp16.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/diffusion_models/hunyuanvideo1.5_720p_t2v_fp16.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "hunyuanvideo15_vae_fp16.safetensors",
                approx_bytes: 2_521_292_758,
                sha256: "e7c3091949c27e2d55ae6d5df917b99dadfebbf308e5a50d0ade0d16c90297ae",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/master/split_files/vae/hunyuanvideo15_vae_fp16.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/vae/hunyuanvideo15_vae_fp16.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                approx_bytes: 9_384_670_680,
                sha256: "cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/master/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "byt5_small_glyphxl_fp16.safetensors",
                approx_bytes: 438_643_184,
                sha256: "516910bb4c9b225370290e40585d1b0e6c8cd3583690f7eec2f7fb593990fb48",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/master/split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/byt5_small_glyphxl_fp16.safetensors",
                    ),
                ],
            },
        ],
    },
    // MiniMax-H3：视频 + 立体声音频联合生成，走 stable-diffusion.cpp。
    //
    // 四个文件缺一不可：DiT（剪枝 Q4_K_M）、Qwen3-VL 文本编码器（Q2_K_M，32B 编码器
    // 很大，Q2 是 32 GB 内存机器的现实选择）、视频 VAE、音频 VAE。国内源与 HF 的
    // 字节完全一致（同一 sha256），下载器按区域偏好自动选。
    ModelEntry {
        id: "minimax-h3",
        name: "MiniMax-H3（视频 + 立体声）",
        feature: "video-gen",
        tag: "visual",
        license: "MiniMax-H3 Community License",
        family: ModelFamily::MiniMaxH3,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "minimax_h3_fl2va_pruned-Q4_K_M.gguf",
                approx_bytes: 11_420_663_904,
                sha256: "dd948e08ad0ba3c71bd42f368e283dd82e790f5122a63b276e22a3e0283d0c10",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/MiniMax-H3-GGUF/resolve/master/minimax_h3_fl2va_pruned-Q4_K.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/leejet/MiniMax-H3-GGUF/resolve/main/minimax_h3_fl2va_pruned-Q4_K_M.gguf",
                    ),
                ],
            },
            H3_TEXT_ENCODER_FILE,
            H3_VIDEO_VAE_FILE,
            H3_AUDIO_VAE_FILE,
        ],
    },
    // MiniMax-H3 Ref2VA：同一套文本编码器 / 视频 VAE / 音频 VAE，只换参考条件 DiT。
    // 支持参考图、参考视频（含配对音轨）与独立参考音频；不支持首帧 / 尾帧。
    // 和 FL2VA 共用约 18 GB 权重：下载时优先硬链接复用，删除本档不会动到 FL2VA。
    ModelEntry {
        id: "minimax-h3-ref2va",
        name: "MiniMax-H3 Ref2VA（参考图 / 参考音频）",
        feature: "video-gen",
        tag: "visual",
        license: "MiniMax-H3 Community License",
        family: ModelFamily::MiniMaxH3Ref2va,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "minimax_h3_ref2va_pruned-Q4_K_M.gguf",
                approx_bytes: 11_420_663_904,
                sha256: "9ca1aef9f4609a56c2c751484013e1b20fe352f892122e5ab0a428fb95a7956e",
                sources: &[
                    // 魔搭仓库里的 ref2va 是另一份量化（Q4_K，字节与 HF 不同），
                    // 所以体积 / sha256 必须按源单独声明。
                    verified(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/MiniMax-H3-GGUF/resolve/master/minimax_h3_ref2va_pruned-Q4_K.gguf",
                        "2fa5840021cf6967843eaeefde9aaa277e540de02986d5ee3d5b0e6a7a8c9dec",
                        11_381_096_544,
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/leejet/MiniMax-H3-GGUF/resolve/main/minimax_h3_ref2va_pruned-Q4_K_M.gguf",
                    ),
                ],
            },
            H3_TEXT_ENCODER_FILE,
            H3_VIDEO_VAE_FILE,
            H3_AUDIO_VAE_FILE,
        ],
    },
    // LTX-2.5 22B：LTX-2.3 的升级版。Gemma 4 12B 文本编码器自带投影层，所以不再需要
    // 单独的 embeddings connectors；视频 VAE 必须用 **conv** 变体（默认的
    // `ltx-2.5-video-vae-bf16` 是 sd.cpp 还没实现的扩散解码器）。24 fps、`8k + 1` 帧，
    // 整包约 33 GB，是清单里最重的一档。
    ModelEntry {
        id: "ltx-2.5",
        name: "LTX-2.5（22B · 视频 + 音频）",
        feature: "video-gen",
        tag: "visual",
        license: "LTX-2 Community License",
        family: ModelFamily::Ltx25,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "ltx-2.5-22b-dev-transformer-Q4_K_M.gguf",
                approx_bytes: 15_687_639_424,
                sha256: "41546ab47a8ad033b99875207cf386b062732d95fca0b4c9e124b14d4baaa378",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/vantagewithai/LTX-2.5-GGUF/resolve/master/dev/ltx-2.5-22b-dev-transformer-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/main/dev/ltx-2.5-22b-dev-transformer-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
                approx_bytes: 15_372_969_374,
                sha256: "6ce688a0aa98a5fa36a9f1e6c3f42152a498cc2b53ee8c15674c64244f91487f",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "ltx-2.5-video-vae-conv-bf16.safetensors",
                approx_bytes: 1_452_269_922,
                sha256: "685b06ee3d9b2039647698fc4ea33175112462fc374e2777312c907897dfce8d",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/vae/ltx-2.5-video-vae-conv-bf16.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-conv-bf16.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "ltx-2.5-audio-vae-bf16.safetensors",
                approx_bytes: 364_866_540,
                sha256: "c52733d37f6a7fb7949c3dc0fb468c6cb2169e4d836983a73babb9f0d54837a5",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Lightricks/LTX-2.5/resolve/master/vae/ltx-2.5-audio-vae-bf16.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Lightricks/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors",
                    ),
                ],
            },
        ],
    },
    // SD 1.5 重绘：清单里最轻的一档（单文件 4.3 GB），512p 在 CPU / 核显上也能跑。
    // 它是真正的 inpainting 权重，mask 局部重绘最稳；显存不够时是唯一现实的选择。
    ModelEntry {
        id: "sd15-inpaint",
        name: "SD 1.5 重绘（轻量 · mask 局部重绘）",
        feature: "image-gen",
        tag: "visual",
        license: "CreativeML Open RAIL-M",
        family: ModelFamily::Sd15,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "sd-v1-5-inpainting.ckpt",
                approx_bytes: 4265437280,
                sha256: "c6bbc15e3224e6973459ba78de4998b80b50112b0ae5b5c67113d56b4e366b19",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/AI-ModelScope/stable-diffusion-inpainting/resolve/master/sd-v1-5-inpainting.ckpt",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/runwayml/stable-diffusion-inpainting/resolve/main/sd-v1-5-inpainting.ckpt",
                    ),
                ],
            },
        ],
    },
    // Z-Image Turbo：6B DiT + Qwen3-4B 文本编码器，官方说 4 GB 显存可跑，8 步出图。
    // 整包约 6.7 GB，是「新一代 SOTA + 小机器」的折中点，也是图像页的默认档。
    ModelEntry {
        id: "z-image-turbo",
        name: "Z-Image Turbo（6B · 8 步 · 低显存）",
        feature: "image-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::ZImageTurbo,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "z_image_turbo-Q4_K.gguf",
                approx_bytes: 3864250304,
                sha256: "14b375ab4f226bc5378f68f37e899ef3c2242b8541e61e2bc1aff40976086fbd",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/leejet/Z-Image-Turbo-GGUF/resolve/master/z_image_turbo-Q4_K.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "ae.safetensors",
                approx_bytes: 335304388,
                sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/z_image_turbo/resolve/master/split_files/vae/ae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
                approx_bytes: 2497281120,
                sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/master/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
                    ),
                ],
            },
        ],
    },
    // SDXL Base 1.0：1024p 通用画质的老牌基线（单文件 6.9 GB）。
    // 没有专门的 inpainting UNet，但 sd.cpp 的 mask 潜空间混合仍然能局部重绘。
    ModelEntry {
        id: "sdxl-base",
        name: "SDXL Base 1.0（1024p · 通用）",
        feature: "image-gen",
        tag: "visual",
        license: "CreativeML Open RAIL++-M",
        family: ModelFamily::Sdxl,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "sd_xl_base_1.0.safetensors",
                approx_bytes: 6938078334,
                sha256: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/AI-ModelScope/stable-diffusion-xl-base-1.0/resolve/master/sd_xl_base_1.0.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
                    ),
                ],
            },
        ],
    },
    // FLUX.1 schnell：12B，4 步出图，Apache-2.0。整包约 12.4 GB（DiT 6.9 + T5 4.9 + VAE + CLIP-L）。
    // 走得快、提示词跟随好，适合先把画面跑出来再去精修。
    ModelEntry {
        id: "flux1-schnell",
        name: "FLUX.1 schnell（12B · 4 步）",
        feature: "image-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::Flux1Schnell,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "flux1-schnell-q4_k.gguf",
                approx_bytes: 6884606880,
                sha256: "619697cc4c2bf587416aa1afa98d474a44c80eb4e3a3f64ea8f99ab0ed9adb7a",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/leejet/FLUX.1-schnell-gguf/resolve/master/flux1-schnell-q4_k.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/leejet/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-q4_k.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "ae.safetensors",
                approx_bytes: 335304388,
                sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/z_image_turbo/resolve/master/split_files/vae/ae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "clip_l.safetensors",
                approx_bytes: 246144152,
                sha256: "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/comfyanonymous/flux_text_encoders/resolve/master/clip_l.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "t5xxl_fp8_e4m3fn.safetensors",
                approx_bytes: 4893934904,
                sha256: "7d330da4816157540d6bb7838bf63a0f02f573fc48ca4d8de34bb0cbfd514f09",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/comfyanonymous/flux_text_encoders/resolve/master/t5xxl_fp8_e4m3fn.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors",
                    ),
                ],
            },
        ],
    },
    // FLUX.1 Kontext：指令式改图（整图参考，不需要 mask），同一套 VAE / CLIP-L / T5。
    // 权重是 FLUX.1 [dev] 非商用许可；整包约 12.4 GB，6 GB 显存可跑。
    ModelEntry {
        id: "flux1-kontext",
        name: "FLUX.1 Kontext（指令改图）",
        feature: "image-gen",
        tag: "visual",
        license: "FLUX.1 [dev] Non-Commercial License",
        family: ModelFamily::Flux1Kontext,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "flux1-kontext-dev-Q4_K_M.gguf",
                approx_bytes: 6931817760,
                sha256: "ebd4e92c44c47f104ad64e4353692f37addf06eb99420c9b459334d871c8b750",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/FLUX.1-Kontext-dev-GGUF/resolve/master/flux1-kontext-dev-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/FLUX.1-Kontext-dev-GGUF/resolve/main/flux1-kontext-dev-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "ae.safetensors",
                approx_bytes: 335304388,
                sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/Comfy-Org/z_image_turbo/resolve/master/split_files/vae/ae.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "clip_l.safetensors",
                approx_bytes: 246144152,
                sha256: "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/comfyanonymous/flux_text_encoders/resolve/master/clip_l.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "t5xxl_fp8_e4m3fn.safetensors",
                approx_bytes: 4893934904,
                sha256: "7d330da4816157540d6bb7838bf63a0f02f573fc48ca4d8de34bb0cbfd514f09",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/comfyanonymous/flux_text_encoders/resolve/master/t5xxl_fp8_e4m3fn.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors",
                    ),
                ],
            },
        ],
    },
    // Qwen-Image：20B DiT + Qwen2.5-VL 7B 文本编码器，中文和长文字渲染是开源第一档。
    // 整包约 18 GB；16 GB 显存要开「权重放内存」，24 GB 以上可以全放显存。
    ModelEntry {
        id: "qwen-image",
        name: "Qwen-Image（20B · 中文 / 文字）",
        feature: "image-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::QwenImage,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "Qwen_Image-Q4_K_M.gguf",
                approx_bytes: 13065746976,
                sha256: "645473886d7dbb0103f84c563c798f7b0867293d919752d4d6be6a432b0bc988",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Qwen-Image-GGUF/resolve/master/Qwen_Image-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Qwen-Image-GGUF/resolve/main/Qwen_Image-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "Qwen_Image-VAE.safetensors",
                approx_bytes: 253806246,
                sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Qwen-Image-GGUF/resolve/master/VAE/Qwen_Image-VAE.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Qwen-Image-GGUF/resolve/main/VAE/Qwen_Image-VAE.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                approx_bytes: 4683072032,
                sha256: "9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/master/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                    ),
                ],
            },
        ],
    },
    // Qwen-Image-Edit 2509：指令式改图，支持中英文与文字替换；2509 需要额外的
    // Qwen2.5-VL 视觉投影层（mmproj）。整包约 18.9 GB，是清单里最重的图像档。
    ModelEntry {
        id: "qwen-image-edit",
        name: "Qwen-Image-Edit 2509（指令改图 · 中文）",
        feature: "image-gen",
        tag: "visual",
        license: "Apache-2.0",
        family: ModelFamily::QwenImageEdit,
        recommended: false,
        bundled: false,
        files: &[
            ModelFile {
                filename: "Qwen-Image-Edit-2509-Q4_K_M.gguf",
                approx_bytes: 13065746976,
                sha256: "08f27cdf3e760edef5136ab0afdb9d3ed7a2799bd730b8d5cd9ecb291d808425",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Qwen-Image-Edit-2509-GGUF/resolve/master/Qwen-Image-Edit-2509-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Qwen-Image-Edit-2509-GGUF/resolve/main/Qwen-Image-Edit-2509-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "Qwen_Image-VAE.safetensors",
                approx_bytes: 253806246,
                sha256: "a70580f0213e67967ee9c95f05bb400e8fb08307e017a924bf3441223e023d1f",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/QuantStack/Qwen-Image-GGUF/resolve/master/VAE/Qwen_Image-VAE.safetensors",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/QuantStack/Qwen-Image-GGUF/resolve/main/VAE/Qwen_Image-VAE.safetensors",
                    ),
                ],
            },
            ModelFile {
                filename: "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                approx_bytes: 4683072032,
                sha256: "9258bf05b12686d097ff3b6b18d968ab393649780aa2b3cd67fec43d50554392",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/master/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
                    ),
                ],
            },
            ModelFile {
                filename: "mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
                approx_bytes: 853119712,
                sha256: "2ddb555391bae966e412deab9e07b58afa18bcc06930ba0f1c78a3695ab9e506",
                sources: &[
                    official(
                        "modelscope",
                        "cn",
                        "https://modelscope.cn/models/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/master/mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
                    ),
                    official(
                        "hf",
                        "intl",
                        "https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf",
                    ),
                ],
            },
        ],
    },
    // MeanVC2：18M 零样本变声（16 kHz）。转换链 int8 约 74 MB，按需下载。
    ModelEntry {
        id: "meanvc2-int8",
        name: "MeanVC2（18M · 零样本变声 · int8）",
        feature: "voice-change",
        tag: "audio",
        license: "Apache-2.0",
        family: ModelFamily::MeanVc2,
        recommended: false,
        bundled: false,
        files: &[
        ModelFile {
            filename: "fbank.onnx",
            approx_bytes: 908_339,
            sha256: "ecbe193170abe98a8c0ba9299e8fe21b418145aca924e351c667b9257c3e28c8",
            sources: &[
                verified(
                    "hf",
                    "intl",
                    "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/fbank.onnx",
                    "ecbe193170abe98a8c0ba9299e8fe21b418145aca924e351c667b9257c3e28c8",
                    908_339,
                ),
            ],
        },
        ModelFile {
            filename: "asr.int8.onnx",
            approx_bytes: 28_655_587,
            sha256: "553869e3159af4497582072e66f09c16032a3b98ac2bad5c195b7443627616be",
            sources: &[
                verified(
                    "hf",
                    "intl",
                    "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/asr.int8.onnx",
                    "553869e3159af4497582072e66f09c16032a3b98ac2bad5c195b7443627616be",
                    28_655_587,
                ),
            ],
        },
        ModelFile {
            filename: "gtm.onnx",
            approx_bytes: 17_441_893,
            sha256: "f03ff1e9da3c373445f7518fa36fc99980fe4326447235fa89ea1923f57ee224",
            sources: &[
                verified(
                    "hf",
                    "intl",
                    "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/gtm.onnx",
                    "f03ff1e9da3c373445f7518fa36fc99980fe4326447235fa89ea1923f57ee224",
                    17_441_893,
                ),
            ],
        },
        ModelFile {
            filename: "dit.int8.onnx",
            approx_bytes: 13_849_138,
            sha256: "52ac682ed1790b196333d1dbf99fa2806b6c52076c85e438c9dede968572675a",
            sources: &[
                verified(
                    "hf",
                    "intl",
                    "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/dit.int8.onnx",
                    "52ac682ed1790b196333d1dbf99fa2806b6c52076c85e438c9dede968572675a",
                    13_849_138,
                ),
            ],
        },
        ModelFile {
            filename: "vocos.int8.onnx",
            approx_bytes: 12_998_461,
            sha256: "a0dbd4c83708f6e787ceebf1c1b0833398dbdea6af770887d27b19119bba2e16",
            sources: &[
                verified(
                    "hf",
                    "intl",
                    "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/vocos.int8.onnx",
                    "a0dbd4c83708f6e787ceebf1c1b0833398dbdea6af770887d27b19119bba2e16",
                    12_998_461,
                ),
            ],
        },
        ],
    },
    // 音色编码器单独成条：已有 256 维向量的用户不必下这 387 MB。
    ModelEntry {
        id: "meanvc2-speaker",
        name: "MeanVC2 音色编码器（WavLM + ECAPA · int8）",
        feature: "voice-change",
        tag: "audio",
        license: "CC-BY-SA-3.0",
        family: ModelFamily::MeanVc2,
        recommended: false,
        bundled: false,
        files: &[ModelFile {
            filename: "speaker.int8.onnx",
            approx_bytes: 387_106_790,
            sha256: "ccd31b45eb2162937b94921d6e64fdd2cf5bf77193ad6f738e85f06a914a95ca",
            sources: &[
                verified(
                    "hf",
                    "intl",
                    "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/speaker/speaker.int8.onnx",
                    "ccd31b45eb2162937b94921d6e64fdd2cf5bf77193ad6f738e85f06a914a95ca",
                    387_106_790,
                ),
            ],
        }],
    },
];

/// 全部条目。
pub fn all() -> &'static [ModelEntry] {
    CATALOG
}

/// 按 id 查找。
pub fn by_id(id: &str) -> Option<&'static ModelEntry> {
    CATALOG.iter().find(|entry| entry.id == id)
}

/// 下载运行时（同一时刻只允许一个下载）。
struct ModelRuntime {
    running: AtomicBool,
    cancel: AtomicBool,
}

fn runtime() -> &'static ModelRuntime {
    static RUNTIME: OnceLock<ModelRuntime> = OnceLock::new();
    RUNTIME.get_or_init(|| ModelRuntime {
        running: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
    })
}

/// 进度事件载荷。
#[derive(Debug, Clone, Serialize)]
pub struct ModelProgress {
    pub id: String,
    pub state: String,
    pub received: u64,
    pub total: u64,
    pub message: Option<String>,
    /// 当前正在尝试的下载地址（镜像 / 官方源）。
    pub source: Option<String>,
    /// 当前源的种类：`hf` / `modelscope` / `github` / `mirror`。
    pub source_kind: Option<String>,
    /// 当前源的区域：`intl` / `cn`。
    pub region: Option<String>,
}

/// 单个文件的本地状态。
#[derive(Debug, Clone, Serialize)]
pub struct ModelFileStatus {
    pub filename: String,
    pub approx_bytes: u64,
    pub installed: bool,
    /// 本地还没有，但能在另一个模型的目录里找到同内容文件（下载时硬链接复用）。
    pub reusable: bool,
    pub bytes: Option<u64>,
}

/// 清单里的一个官方源（给界面展示 / 悬停查看）。
#[derive(Debug, Clone, Serialize)]
pub struct ModelSourceStatus {
    pub kind: String,
    pub region: String,
    pub url: String,
}

/// 清单条目 + 本地状态。
#[derive(Debug, Clone, Serialize)]
pub struct ModelStatus {
    pub id: String,
    pub name: String,
    pub feature: String,
    pub tag: String,
    pub license: String,
    pub family: ModelFamily,
    pub approx_bytes: u64,
    /// 是否为默认推荐模型。
    pub recommended: bool,
    pub bundled: bool,
    pub bundle_eligible: bool,
    pub installed: bool,
    pub path: Option<String>,
    pub total_files: u32,
    pub installed_files: u32,
    /// 尚未安装、但可以从其它已安装模型复用的字节数（下载按钮显示实际下载量）。
    pub reusable_bytes: u64,
    /// 与其它模型档共用的字节数（硬链接；删除本档不会影响对方）。
    pub shared_bytes: u64,
    /// 覆盖的区域：`["cn"]` / `["cn","intl"]`。
    pub regions: Vec<String>,
    /// 全部官方源（去重；界面用来显示「魔搭 + HuggingFace」与悬停 URL）。
    pub sources: Vec<ModelSourceStatus>,
    pub files: Vec<ModelFileStatus>,
}

/// 权重落地目录（应用配置目录的 `models/`；配置目录可随数据目录搬到别的盘）。
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::config_dir(app)
        .map_err(|error| format!("拿不到应用配置目录：{error}"))?
        .join("models");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// 某个条目的落点目录（不创建）。
fn entry_dir_path(app: &AppHandle, entry: &ModelEntry) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(entry.id))
}

/// 某个条目的落点目录（确保存在）。
fn entry_dir(app: &AppHandle, entry: &ModelEntry) -> Result<PathBuf, String> {
    let dir = entry_dir_path(app, entry)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// 模型搜索路径（下载目录优先，其次资源目录 / 可执行文件同级 / 开发目录）。
fn search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(dir) = models_dir(app) {
        dirs.push(dir);
    }
    if let Ok(dir) = app.path().resource_dir() {
        dirs.push(dir.join("models"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("models"));
        }
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models"));
    dirs
}

/// 已安装目录：所有文件都在同一个候选目录里才算。
pub fn installed_dir(app: &AppHandle, entry: &ModelEntry) -> Option<PathBuf> {
    search_dirs(app)
        .into_iter()
        .map(|base| base.join(entry.id))
        .find(|dir| {
            entry
                .files
                .iter()
                .all(|file| dir.join(file.filename).is_file())
        })
}

/// 已安装目录，未安装时报错。
pub fn require_dir(app: &AppHandle, entry: &ModelEntry) -> Result<PathBuf, String> {
    installed_dir(app, entry).ok_or_else(|| format!("模型尚未安装：{}", entry.name))
}

/// 某个能力域下第一个已安装的模型。用于智能体不指定 modelId 时的默认值。
pub fn first_installed(app: &AppHandle, feature: &str) -> Option<&'static ModelEntry> {
    all()
        .iter()
        .find(|entry| entry.feature == feature && installed_dir(app, entry).is_some())
}

/// 两个清单文件是否是同一份权重：文件名、主源体积、sha256 都一致。
///
/// sha256 为空的小文件不参与复用：只靠同名 + 同体积无法证明内容一致（不同模型的
/// `tokens.txt` 之类可能正好撞上），宁可重新下载也不冒把错误权重链接过去的风险。
fn same_file(left: &ModelFile, right: &ModelFile) -> bool {
    !left.sha256.is_empty()
        && left.filename == right.filename
        && left.approx_bytes == right.approx_bytes
        && left.sha256 == right.sha256
}

fn file_size_ok(path: &Path, file: &ModelFile) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    let len = meta.len();
    if len == 0 {
        return false;
    }
    if file.approx_bytes == 0 {
        return true;
    }
    // 魔搭 / HF 的同一份权重可能是不同量化，大小不一样；按源声明过的体积也算合法。
    len == file.approx_bytes || file.sources.iter().any(|source| source.size == Some(len))
}

/// 在其它模型目录里找同一份文件（如 MiniMax-H3 FL2VA / Ref2VA 共用的文本编码器、VAE）。
///
/// 只按「文件名 + 清单体积」判断，不重新算 sha256：目标文件就是另一个模型下载并校验过的
/// 同一份权重；下载时再用硬链接（失败则复制）落到当前模型目录。
fn reusable_path(app: &AppHandle, entry: &ModelEntry, file: &ModelFile) -> Option<PathBuf> {
    let dirs = search_dirs(app);
    reusable_path_in(all(), &dirs, entry.id, file)
}

fn reusable_path_in(
    entries: &[ModelEntry],
    dirs: &[PathBuf],
    entry_id: &str,
    file: &ModelFile,
) -> Option<PathBuf> {
    for base in dirs {
        for other in entries {
            if other.id == entry_id {
                continue;
            }
            if !other
                .files
                .iter()
                .any(|candidate| same_file(candidate, file))
            {
                continue;
            }
            let path = base.join(other.id).join(file.filename);
            if path.is_file() && file_size_ok(&path, file) {
                return Some(path);
            }
        }
    }
    None
}

/// 把已有文件硬链接到目标目录；跨卷 / 文件系统不支持硬链接时退回复制。
fn link_or_copy(source: &Path, target: &Path) -> Result<(), String> {
    if target.is_file() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    match fs::hard_link(source, target) {
        Ok(()) => Ok(()),
        Err(link_error) => fs::copy(source, target).map(|_| ()).map_err(|copy_error| {
            // 复制中途失败可能留下半个文件；清掉，避免后续 rename 被已存在的目标挡住。
            let _ = fs::remove_file(target);
            format!(
                "复用 {} 失败：硬链接 {link_error}，复制也失败：{copy_error}",
                source.display()
            )
        }),
    }
}

fn statuses(app: &AppHandle) -> Vec<ModelStatus> {
    all()
        .iter()
        .map(|entry| {
            let dir = entry_dir_path(app, entry).ok();
            let installed_path = installed_dir(app, entry);
            let files: Vec<ModelFileStatus> = entry
                .files
                .iter()
                .map(|file| {
                    let bytes = dir
                        .as_ref()
                        .and_then(|dir| fs::metadata(dir.join(file.filename)).ok())
                        .map(|meta| meta.len());
                    let installed = installed_path
                        .as_ref()
                        .map(|dir| dir.join(file.filename).is_file())
                        .unwrap_or(false)
                        || dir
                            .as_ref()
                            .map(|dir| {
                                let path = dir.join(file.filename);
                                path.is_file() && file_size_ok(&path, file)
                            })
                            .unwrap_or(false);
                    let reusable = !installed && reusable_path(app, entry, file).is_some();
                    ModelFileStatus {
                        filename: file.filename.to_string(),
                        approx_bytes: file.approx_bytes,
                        installed,
                        reusable,
                        bytes,
                    }
                })
                .collect();
            let reusable_bytes = files
                .iter()
                .filter(|file| file.reusable && !file.installed)
                .map(|file| file.approx_bytes)
                .sum();
            // 清单层面的共用（例如 H3 FL2VA / Ref2VA 的文本编码器 + VAE），
            // 与「现在能不能复用」无关：安装后是硬链接，删除本档不会删掉对方的目录项。
            let shared_bytes = entry
                .files
                .iter()
                .filter(|file| {
                    all().iter().any(|other| {
                        other.id != entry.id
                            && installed_dir(app, other).is_some()
                            && other
                                .files
                                .iter()
                                .any(|candidate| same_file(candidate, file))
                    })
                })
                .map(|file| file.approx_bytes)
                .sum();
            let mut sources: Vec<ModelSourceStatus> = Vec::new();
            for file in entry.files {
                for source in file.sources {
                    if sources.iter().any(|existing| existing.url == source.url) {
                        continue;
                    }
                    sources.push(ModelSourceStatus {
                        kind: source.kind.to_string(),
                        region: source.region.to_string(),
                        url: source.url.to_string(),
                    });
                }
            }
            ModelStatus {
                id: entry.id.to_string(),
                name: entry.name.to_string(),
                feature: entry.feature.to_string(),
                tag: entry.tag.to_string(),
                license: entry.license.to_string(),
                family: entry.family,
                approx_bytes: entry.total_bytes(),
                recommended: entry.recommended,
                bundled: entry.bundled,
                bundle_eligible: entry.bundle_eligible(),
                installed: installed_path.is_some(),
                path: installed_path.map(|path| path.to_string_lossy().into_owned()),
                total_files: entry.files.len() as u32,
                installed_files: files.iter().filter(|file| file.installed).count() as u32,
                reusable_bytes,
                shared_bytes,
                regions: entry.regions(),
                sources,
                files,
            }
        })
        .collect()
}

/// 列出全部模型与本地状态。
#[tauri::command]
pub fn model_catalog(app: AppHandle) -> Vec<ModelStatus> {
    statuses(&app)
}

/// 开始下载某个模型。命令会一直等到下载完成（或失败 / 取消）。
#[tauri::command]
pub async fn model_download(app: AppHandle, id: String) -> Result<(), String> {
    let entry = by_id(&id).ok_or_else(|| format!("未知模型：{id}"))?;
    if runtime().running.swap(true, Ordering::SeqCst) {
        return Err("已有模型正在下载".into());
    }
    runtime().cancel.store(false, Ordering::Relaxed);

    let result = run_download(&app, entry).await;

    runtime().running.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => emit(
            &app,
            entry,
            "done",
            entry.total_bytes(),
            entry.total_bytes(),
            None,
        ),
        Err(error) => emit(
            &app,
            entry,
            "error",
            0,
            entry.total_bytes(),
            Some(error.clone()),
        ),
    }
    result
}

/// 单个官方源的连通性探测结果。
#[derive(Debug, Clone, Serialize)]
pub struct SourceProbe {
    pub kind: String,
    pub region: String,
    pub url: String,
    pub ok: bool,
    pub status: Option<u16>,
    pub ms: u64,
    pub error: Option<String>,
}

/// 探测某个模型的全部官方源（发给界面「测试源」按钮）。
#[tauri::command]
pub async fn model_probe(app: AppHandle, id: String) -> Result<Vec<SourceProbe>, String> {
    let entry = by_id(&id).ok_or_else(|| format!("未知模型：{id}"))?;
    let runtime_state = app.state::<std::sync::Arc<NetworkRuntime>>();
    let client = runtime_state
        .client()
        .map_err(|error| format!("创建探测客户端失败：{error}"))?;

    let mut unique: Vec<&ModelSource> = Vec::new();
    for file in entry.files {
        for source in file.sources {
            if !unique.iter().any(|existing| existing.url == source.url) {
                unique.push(source);
            }
        }
    }

    let mut probes = Vec::with_capacity(unique.len());
    for source in unique {
        let started = Instant::now();
        let result = client
            .get(source.url)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .timeout(TEST_TIMEOUT)
            .send()
            .await;
        let ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(response) => {
                let status = response.status();
                let ok = status == reqwest::StatusCode::PARTIAL_CONTENT || status.is_success();
                probes.push(SourceProbe {
                    kind: source.kind.to_string(),
                    region: source.region.to_string(),
                    url: source.url.to_string(),
                    ok,
                    status: Some(status.as_u16()),
                    ms,
                    error: if ok {
                        None
                    } else {
                        Some(format!("HTTP {status}"))
                    },
                });
            }
            Err(error) => probes.push(SourceProbe {
                kind: source.kind.to_string(),
                region: source.region.to_string(),
                url: source.url.to_string(),
                ok: false,
                status: None,
                ms,
                error: Some(error.to_string()),
            }),
        }
    }
    Ok(probes)
}

/// 取消当前下载（下一个数据块处停下，保留 `.part` 供下次续传）。
#[tauri::command]
pub fn model_cancel() {
    runtime().cancel.store(true, Ordering::Relaxed);
}

/// 删除已下载的模型文件。
///
/// 共用权重在安装时是**硬链接**（或退化为复制）到各自目录的，所以这里只删当前条目的
/// 目录：另一个模型（如 H3 FL2VA ↔ Ref2VA）目录里的同名文件仍然有效，不会被连带删掉。
#[tauri::command]
pub fn model_remove(app: AppHandle, id: String) -> Result<(), String> {
    let entry = by_id(&id).ok_or_else(|| format!("未知模型：{id}"))?;
    if entry.bundled {
        return Err("随包分发的模型不能删除".into());
    }
    let dir = entry_dir_path(&app, entry)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 在系统文件管理器里显示模型目录。
#[tauri::command]
pub fn model_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let entry = by_id(&id).ok_or_else(|| format!("未知模型：{id}"))?;
    let target = installed_dir(&app, entry)
        .or_else(|| entry_dir_path(&app, entry).ok())
        .unwrap_or_else(|| models_dir(&app).unwrap_or_default());
    reveal_in_file_manager(&target)
}

// ---------------------------------------------------------------------------
// 下载实现
// ---------------------------------------------------------------------------

/// 一个候选地址及其完整性要求。
#[derive(Debug, Clone)]
struct Candidate {
    url: String,
    sha256: String,
    size: u64,
    kind: &'static str,
    region: &'static str,
}

fn apply_prefix(prefix: &str, url: &str) -> String {
    let prefix = prefix.trim();
    if prefix.is_empty() {
        return url.to_string();
    }
    if prefix.contains("{url}") {
        prefix.replace("{url}", url)
    } else {
        format!("{prefix}{url}")
    }
}

/// 魔搭的另一种官方下载入口（SDK 使用的 `repo?FilePath=` 接口）。
///
/// `resolve/master/...` 对部分 CDN / 网络更友好；两条都作为候选，失败自动换下一条。
fn modelscope_api_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://modelscope.cn/models/")?;
    let (repo, file) = rest.split_once("/resolve/master/")?;
    Some(format!(
        "https://www.modelscope.cn/api/v1/models/{repo}/repo?Revision=master&FilePath={file}"
    ))
}

/// 按区域偏好给某个文件的候选源排序（稳定排序，另一区域留在后面兜底）。
fn ordered_sources<'a>(file: &'a ModelFile, region: Option<&str>) -> Vec<&'a ModelSource> {
    let mut sources: Vec<&ModelSource> = file.sources.iter().collect();
    if let Some(preferred) = region {
        sources.sort_by_key(|source| if source.region == preferred { 0 } else { 1 });
    }
    sources
}

/// 某个文件的候选下载地址：镜像前缀 → 偏好区域官方源 → 另一区域官方源。
fn candidates_for(
    file: &ModelFile,
    network: &NetworkConfig,
    region: Option<&str>,
) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::new();
    let mut push = |candidate: Candidate| {
        if !out.iter().any(|existing| existing.url == candidate.url) {
            out.push(candidate);
        }
    };

    for source in ordered_sources(file, region) {
        let size = source.size.unwrap_or(file.approx_bytes);
        let sha256 = source.sha256.unwrap_or(file.sha256).to_string();
        for mirror in &network.model_mirrors {
            push(Candidate {
                url: apply_prefix(mirror, source.url),
                sha256: sha256.clone(),
                size,
                kind: "mirror",
                region: source.region,
            });
        }
        // GitHub 下载代理前缀只重写 GitHub 地址；HF / 魔搭走 model_mirrors。
        let prefix = network.download_prefix.trim();
        let is_github = source.kind == "github"
            || source.url.contains("github.com/")
            || source.url.contains("githubusercontent.com/");
        if !prefix.is_empty() && is_github {
            push(Candidate {
                url: apply_prefix(prefix, source.url),
                sha256: sha256.clone(),
                size,
                kind: "mirror",
                region: source.region,
            });
        }
        push(Candidate {
            url: source.url.to_string(),
            sha256: sha256.clone(),
            size,
            kind: source.kind,
            region: source.region,
        });
        if source.kind == "modelscope" {
            if let Some(api) = modelscope_api_url(source.url) {
                push(Candidate {
                    url: api,
                    sha256,
                    size,
                    kind: "modelscope",
                    region: source.region,
                });
            }
        }
    }
    out
}

/// 自动模式下探测一个地址的首字节延迟；失败 / 非 2xx 返回 `None`。
async fn probe(client: &reqwest::Client, url: &str) -> Option<Duration> {
    let started = Instant::now();
    let response = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .timeout(PROBE_TIMEOUT)
        .send()
        .await
        .ok()?;
    let status = response.status();
    if status == reqwest::StatusCode::PARTIAL_CONTENT || status.is_success() {
        Some(started.elapsed())
    } else {
        None
    }
}

/// 这个模型该优先用哪个区域的源。
async fn resolve_region(
    client: &reqwest::Client,
    entry: &ModelEntry,
    network: &NetworkConfig,
) -> Option<&'static str> {
    match network.model_source_preference {
        ModelSourcePreference::International => Some("intl"),
        ModelSourcePreference::Domestic => Some("cn"),
        ModelSourcePreference::Auto => {
            let intl = entry
                .files
                .iter()
                .flat_map(|file| file.sources.iter())
                .find(|source| source.region == "intl");
            let cn = entry
                .files
                .iter()
                .flat_map(|file| file.sources.iter())
                .find(|source| source.region == "cn");
            let (Some(intl), Some(cn)) = (intl, cn) else {
                return None;
            };
            let (intl_ms, cn_ms) = tokio::join!(probe(client, intl.url), probe(client, cn.url));
            match (intl_ms, cn_ms) {
                (Some(a), Some(b)) => Some(if a <= b { "intl" } else { "cn" }),
                (Some(_), None) => Some("intl"),
                (None, Some(_)) => Some("cn"),
                (None, None) => None,
            }
        }
    }
}

async fn run_download(app: &AppHandle, entry: &ModelEntry) -> Result<(), String> {
    let dir = entry_dir(app, entry)?;
    let runtime_state = app.state::<std::sync::Arc<NetworkRuntime>>();
    let network = runtime_state.get();
    let client = runtime_state
        .client()
        .map_err(|error| format!("创建下载客户端失败：{error}"))?;
    let region = resolve_region(&client, entry, &network).await;
    let total = entry.total_bytes();
    let cancel = &runtime().cancel;

    emit(app, entry, "downloading", 0, total, None);

    let mut base: u64 = 0;
    for file in entry.files {
        let final_path = dir.join(file.filename);
        let part_path = dir.join(format!("{}.part", file.filename));
        if final_path.is_file() {
            if file_size_ok(&final_path, file) {
                // 完整文件已经在场：顺手清掉上次取消留下的 .part，避免白占空间。
                let _ = fs::remove_file(&part_path);
                base += file.approx_bytes;
                emit(app, entry, "downloading", base.min(total), total, None);
                continue;
            }
            // 残留的截断文件：删掉重来，别把它当成已安装。
            let _ = fs::remove_file(&final_path);
        }

        // 共用权重（H3 FL2VA / Ref2VA 的文本编码器 + VAE）：另一个模型已经下过就直接
        // 硬链接过来，不重复占空间、也不重新走网络。删除任一模型只会删掉自己的目录项。
        if let Some(source) = reusable_path(app, entry, file) {
            // 复制回退可能是几十 GB 的同步 IO，放到 blocking 池里，别卡住下载事件循环。
            let source_for_link = source.clone();
            let target_for_link = final_path.clone();
            let linked = tauri::async_runtime::spawn_blocking(move || {
                link_or_copy(&source_for_link, &target_for_link)
            })
            .await;
            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }
            let reused = match linked {
                Ok(Ok(())) => Ok(()),
                Ok(Err(error)) => Err(error),
                Err(error) => Err(error.to_string()),
            };
            match reused {
                Ok(()) => {
                    let _ = fs::remove_file(&part_path);
                    base += file.approx_bytes;
                    emit(
                        app,
                        entry,
                        "downloading",
                        base.min(total),
                        total,
                        Some(format!("复用已有文件：{}", file.filename)),
                    );
                    continue;
                }
                Err(error) => {
                    // 硬链接 / 复制都失败（权限、跨卷、磁盘满）：退回正常下载。
                    eprintln!("[models] {error}");
                }
            }
        }

        let candidates = candidates_for(file, &network, region);
        if candidates.is_empty() {
            return Err(format!("{} 没有可用的下载源", file.filename));
        }

        let base_for_progress = base;
        let result = download_file(
            &client,
            &dir,
            file,
            &candidates,
            cancel,
            |received, candidate| {
                emit_source(
                    app,
                    entry,
                    "downloading",
                    (base_for_progress + received).min(total),
                    total,
                    None,
                    Some(candidate.url.clone()),
                    Some(candidate.kind.to_string()),
                    Some(candidate.region.to_string()),
                );
            },
        )
        .await;

        match result {
            Ok(()) => {
                base += file.approx_bytes;
                emit(app, entry, "downloading", base.min(total), total, None);
            }
            Err(error) => return Err(error),
        }
    }

    Ok(())
}

async fn download_file<F>(
    client: &reqwest::Client,
    dir: &Path,
    file: &ModelFile,
    candidates: &[Candidate],
    cancel: &AtomicBool,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, &Candidate),
{
    let final_path = dir.join(file.filename);
    let part_path = dir.join(format!("{}.part", file.filename));
    let mut errors: Vec<String> = Vec::new();

    for candidate in candidates {
        for attempt in 1..=DOWNLOAD_ATTEMPTS {
            if cancel.load(Ordering::Relaxed) {
                return Err("已取消".into());
            }

            match download_once(
                client,
                &final_path,
                &part_path,
                candidate,
                cancel,
                &mut on_progress,
            )
            .await
            {
                Ok(()) => return Ok(()),
                Err(error) => {
                    let cancelled = error == "已取消";
                    // 内容对不上说明这个源/断点不可用，换下一个源；传输错误则重试同一源。
                    let content_error = error.contains("sha256") || error.contains("大小不符");
                    if !errors.iter().any(|line| line.starts_with(&candidate.url)) {
                        errors.push(format!("{} → {}", candidate.url, error));
                    }
                    if cancelled {
                        return Err(error);
                    }
                    if content_error {
                        let _ = fs::remove_file(&part_path);
                        break;
                    }
                    if attempt < DOWNLOAD_ATTEMPTS {
                        tokio::time::sleep(Duration::from_millis(600 * u64::from(attempt))).await;
                    }
                }
            }
        }
    }

    Err(if errors.is_empty() {
        "没有可用的下载源".into()
    } else {
        format!("所有下载源都失败了：\n{}", errors.join("\n"))
    })
}

async fn download_once<F>(
    client: &reqwest::Client,
    final_path: &Path,
    part_path: &Path,
    candidate: &Candidate,
    cancel: &AtomicBool,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(u64, &Candidate),
{
    let mut existing = fs::metadata(part_path).map(|meta| meta.len()).unwrap_or(0);
    if candidate.size > 0 && existing > candidate.size {
        let _ = fs::remove_file(part_path);
        existing = 0;
    }
    if candidate.size > 0 && existing == candidate.size && existing > 0 {
        if part_valid(part_path, candidate).await {
            fs::rename(part_path, final_path).map_err(|error| error.to_string())?;
            return Ok(());
        }
        let _ = fs::remove_file(part_path);
        existing = 0;
    }

    let mut request = client
        .get(&candidate.url)
        .timeout(Duration::from_secs(60 * 60));
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();

    let append = status == reqwest::StatusCode::PARTIAL_CONTENT && existing > 0;
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && existing > 0 {
        if part_valid(part_path, candidate).await {
            fs::rename(part_path, final_path).map_err(|error| error.to_string())?;
            return Ok(());
        }
        let _ = fs::remove_file(part_path);
        return Err("断点文件无效".into());
    }
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("HTTP {status}"));
    }

    let mut output = if append {
        fs::OpenOptions::new()
            .append(true)
            .open(part_path)
            .map_err(|error| error.to_string())?
    } else {
        fs::File::create(part_path).map_err(|error| error.to_string())?
    };

    let mut received = if append { existing } else { 0 };
    on_progress(received, candidate);
    let mut stream = response.bytes_stream();
    let mut failure: Option<String> = None;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            failure = Some("已取消".into());
            break;
        }
        match chunk {
            Ok(bytes) => {
                if let Err(error) = output.write_all(&bytes) {
                    failure = Some(error.to_string());
                    break;
                }
                received += bytes.len() as u64;
                on_progress(received, candidate);
            }
            Err(error) => {
                failure = Some(error.to_string());
                break;
            }
        }
    }
    drop(output);

    if let Some(error) = failure {
        if error == "已取消" {
            return Err(error);
        }
        return Err(error);
    }

    let size = fs::metadata(part_path).map(|meta| meta.len()).unwrap_or(0);
    if candidate.size > 0 && size != candidate.size {
        let _ = fs::remove_file(part_path);
        return Err(format!(
            "大小不符（期望 {}，实际 {}）",
            candidate.size, size
        ));
    }
    if !candidate.sha256.is_empty() {
        let part = part_path.to_path_buf();
        let digest = tauri::async_runtime::spawn_blocking(move || sha256_file(&part))
            .await
            .map_err(|error| error.to_string())??;
        if digest != candidate.sha256 {
            let _ = fs::remove_file(part_path);
            return Err("sha256 校验失败".into());
        }
    }

    fs::rename(part_path, final_path).map_err(|error| error.to_string())?;
    Ok(())
}

async fn part_valid(part_path: &Path, candidate: &Candidate) -> bool {
    let size = fs::metadata(part_path).map(|meta| meta.len()).unwrap_or(0);
    if candidate.size > 0 && size != candidate.size {
        return false;
    }
    if candidate.sha256.is_empty() {
        return size > 0;
    }
    let part = part_path.to_path_buf();
    match tauri::async_runtime::spawn_blocking(move || sha256_file(&part)).await {
        Ok(Ok(digest)) => digest == candidate.sha256,
        _ => false,
    }
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn emit(
    app: &AppHandle,
    entry: &ModelEntry,
    state: &str,
    received: u64,
    total: u64,
    message: Option<String>,
) {
    emit_source(
        app, entry, state, received, total, message, None, None, None,
    );
}

#[allow(clippy::too_many_arguments)]
fn emit_source(
    app: &AppHandle,
    entry: &ModelEntry,
    state: &str,
    received: u64,
    total: u64,
    message: Option<String>,
    source: Option<String>,
    source_kind: Option<String>,
    region: Option<String>,
) {
    let _ = app.emit(
        EVENT_MODEL,
        ModelProgress {
            id: entry.id.to_string(),
            state: state.to_string(),
            received,
            total,
            message,
            source,
            source_kind,
            region,
        },
    );
}

pub(crate) fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg("-R").arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(format!("/select,{}", path.display()));
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let dir = path.parent().unwrap_or(path);
        let mut command = std::process::Command::new("xdg-open");
        command.arg(dir);
        command
    };
    command.spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 可以随安装包分发的许可（宽松许可白名单）。社区 / RAIL / 非商用许可都不在里面。
    const PERMISSIVE_LICENSES: &[&str] = &["Apache-2.0", "MIT", "BSD-3-Clause"];

    fn network_with(mirrors: &[&str], preference: ModelSourcePreference) -> NetworkConfig {
        NetworkConfig {
            model_mirrors: mirrors.iter().map(|mirror| mirror.to_string()).collect(),
            model_source_preference: preference,
            ..Default::default()
        }
    }

    fn file_of(entry: &'static ModelEntry) -> &'static ModelFile {
        &entry.files[0]
    }

    #[test]
    fn catalog_ids_and_filenames_are_unique() {
        let mut ids = std::collections::HashSet::new();
        for entry in all() {
            assert!(ids.insert(entry.id), "重复 id：{}", entry.id);
            assert!(!entry.files.is_empty(), "{} 没有文件", entry.id);
            let mut names = std::collections::HashSet::new();
            for file in entry.files {
                assert!(names.insert(file.filename), "{} 内文件重名", entry.id);
                assert!(!file.sources.is_empty(), "{} 没有下载源", entry.id);
            }
        }
    }

    #[test]
    fn wan_video_model_is_the_lightweight_option() {
        let wan = by_id("wan21-t2v-1.3b").expect("Wan2.1 1.3B 应该在清单里");
        assert_eq!(wan.family, ModelFamily::Wan21T2v);
        assert_eq!(wan.feature, "video-gen");
        assert_eq!(wan.files.len(), 3, "DiT + VAE + 文本编码器");
        let h3 = by_id("minimax-h3").expect("MiniMax-H3 应该在清单里");
        assert!(
            wan.total_bytes() * 3 < h3.total_bytes(),
            "Wan 应该比 H3 小一个数量级（{} vs {}）",
            wan.total_bytes(),
            h3.total_bytes()
        );
        // 视频家族都必须能算出帧率 / 帧数网格。
        for entry in all().iter().filter(|entry| entry.feature == "video-gen") {
            assert!(
                crate::video_gen::VideoSpec::for_family(entry.family).is_some(),
                "{} 缺少视频规格",
                entry.id
            );
        }
    }

    /// FL2VA / Ref2VA 只差一个 DiT；共用的三个文件必须引用同一份定义，下载器才能复用。
    #[test]
    fn ref2va_reuses_the_shared_h3_weights() {
        let fl2va = by_id("minimax-h3").expect("MiniMax-H3 应该在清单里");
        let ref2va = by_id("minimax-h3-ref2va").expect("MiniMax-H3 Ref2VA 应该在清单里");
        assert_eq!(ref2va.family, ModelFamily::MiniMaxH3Ref2va);
        assert_eq!(ref2va.feature, "video-gen");
        assert_eq!(
            ref2va.files.len(),
            4,
            "DiT + 文本编码器 + 视频 VAE + 音频 VAE"
        );
        assert_ne!(
            fl2va.files[0].filename, ref2va.files[0].filename,
            "两个档的 DiT 必须是不同的权重"
        );
        for name in [
            "qwen3vl_32b_minimax_h3-Q2_K_M.gguf",
            "minimax_h3_video_vae_fp16.safetensors",
            "minimax_h3_audio_vae_fp32.safetensors",
        ] {
            let left = fl2va
                .files
                .iter()
                .find(|file| file.filename == name)
                .expect("FL2VA 缺少共用文件");
            let right = ref2va
                .files
                .iter()
                .find(|file| file.filename == name)
                .expect("Ref2VA 缺少共用文件");
            assert!(same_file(left, right), "{name} 的定义不一致");
        }
    }

    /// 没有 sha256 的同名文件不参与复用：无法证明内容一致。
    #[test]
    fn files_without_sha_are_not_reused() {
        let left = ModelFile {
            filename: "tokens.txt",
            approx_bytes: 10,
            sha256: "",
            sources: &[],
        };
        let right = ModelFile {
            filename: "tokens.txt",
            approx_bytes: 10,
            sha256: "",
            sources: &[],
        };
        assert!(!same_file(&left, &right));
    }

    /// 共用文件查找：只认同名、同大小、同 sha256 的文件，截断文件不能复用。
    #[test]
    fn reusable_path_checks_name_and_size() {
        const SHARED: ModelFile = ModelFile {
            filename: "shared.bin",
            approx_bytes: 6,
            sha256: "abc123",
            sources: &[],
        };
        const FILES: &[ModelFile] = &[SHARED];
        let first = ModelEntry {
            id: "first",
            name: "",
            feature: "",
            tag: "",
            license: "",
            family: ModelFamily::MiniMaxH3,
            recommended: false,
            bundled: false,
            files: FILES,
        };
        let second = ModelEntry {
            id: "second",
            ..first
        };
        let base = std::env::temp_dir().join(format!(
            "aicut-models-reuse-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        let source_dir = base.join("first");
        std::fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("shared.bin");
        std::fs::write(&source, b"123456").unwrap();
        let hit = reusable_path_in(
            &[first, second],
            std::slice::from_ref(&base),
            "second",
            &SHARED,
        );
        assert_eq!(hit.as_deref(), Some(source.as_path()));

        std::fs::write(&source, b"12345").unwrap();
        assert!(
            reusable_path_in(
                &[first, second],
                std::slice::from_ref(&base),
                "second",
                &SHARED
            )
            .is_none(),
            "大小不符的残留文件不能复用"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 魔搭 / HF 是不同量化时体积不同：按源声明过的体积也要算完整。
    #[test]
    fn alternate_source_size_is_accepted() {
        let path = std::env::temp_dir().join(format!(
            "aicut-models-size-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::write(&path, b"123456").unwrap();
        let file = ModelFile {
            filename: "weights.gguf",
            approx_bytes: 10,
            sha256: "aaaa",
            sources: &[ModelSource {
                kind: "modelscope",
                region: "cn",
                url: "",
                sha256: Some("bbbb"),
                size: Some(6),
            }],
        };
        assert!(file_size_ok(&path, &file));
        std::fs::write(&path, b"12345").unwrap();
        assert!(!file_size_ok(&path, &file));
        let _ = std::fs::remove_file(&path);
    }

    /// 共用文件是硬链接 / 复制到各自目录的：删掉一个模型目录，另一个仍能读到文件。
    #[test]
    fn shared_link_survives_removing_one_entry() {
        let base = std::env::temp_dir().join(format!(
            "aicut-models-shared-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        let first = base.join("minimax-h3");
        let second = base.join("minimax-h3-ref2va");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let source = first.join("shared.bin");
        let target = second.join("shared.bin");
        std::fs::write(&source, b"shared weights").unwrap();
        link_or_copy(&source, &target).expect("复用共用文件");
        std::fs::remove_dir_all(&first).expect("删除第一个模型目录");
        assert_eq!(std::fs::read(&target).unwrap(), b"shared weights");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 视频生成模型在清单里的顺序 = 下拉框的顺序，按整包体积从小到大排。
    #[test]
    fn video_models_are_listed_small_to_large() {
        let mut previous = 0u64;
        let mut count = 0usize;
        for entry in all().iter().filter(|entry| entry.feature == "video-gen") {
            assert!(
                entry.total_bytes() >= previous,
                "{} 没有按体积递增排列（上一个 {} 字节）",
                entry.id,
                previous
            );
            previous = entry.total_bytes();
            count += 1;
        }
        // FL2VA / Ref2VA 共用权重，整包体积相同；顺序只要求「不递减」。
        assert_eq!(count, 8, "视频生成模型应该有 8 个");
        assert!(count <= 10, "视频生成模型最多 10 个，现在 {}", count);
        // 最前面就是最轻的 Wan：界面默认选中第一项（`recommended` 全库只允许一个，
        // 所以视频这块靠顺序决定默认值）。
        let first = all()
            .iter()
            .find(|entry| entry.feature == "video-gen")
            .expect("至少有一个视频模型");
        assert_eq!(first.id, "wan21-t2v-1.3b");
    }

    /// 图像模型同样按整包体积从小到大排：轻的能跑 CPU / 核显，重的留给大显存。
    #[test]
    fn image_models_are_listed_small_to_large() {
        let mut previous = 0u64;
        let mut count = 0usize;
        for entry in all().iter().filter(|entry| entry.feature == "image-gen") {
            assert!(
                entry.total_bytes() > previous,
                "{} 没有按体积递增排列（上一个 {} 字节）",
                entry.id,
                previous
            );
            previous = entry.total_bytes();
            count += 1;
            assert!(
                crate::image_gen::ImageSpec::for_family(entry.family).is_some(),
                "{} 缺少图像规格",
                entry.id
            );
        }
        assert_eq!(count, 7, "图像模型应该有 7 个");
        // 最轻的一档必须是真正支持 mask 的 inpainting 权重。
        let first = all()
            .iter()
            .find(|entry| entry.feature == "image-gen")
            .expect("至少有一个图像模型");
        assert_eq!(first.id, "sd15-inpaint");
        assert_eq!(first.family, ModelFamily::Sd15);
    }

    #[test]
    fn bundled_models_respect_the_ten_megabyte_limit() {
        for entry in all().iter().filter(|entry| entry.bundled) {
            assert!(
                entry.bundle_eligible(),
                "{} 超过 10 MB，不能随包分发",
                entry.id
            );
        }
    }

    /// 随包分发的硬约束：**只有宽松许可**的权重能进安装包，体积小不是理由。
    ///
    /// 社区许可（LTX-2 / 混元 / MiniMax-H3）、RAIL 与「仅限非商业」的权重只能走
    /// 「用户点了才下载」，否则安装包就不能再当作 Apache-2.0 发行物分发。
    #[test]
    fn bundled_weights_keep_a_permissive_license() {
        for entry in all().iter().filter(|entry| entry.bundled) {
            assert!(
                PERMISSIVE_LICENSES.contains(&entry.license),
                "{} 的许可是「{}」，不能随安装包分发（只允许 {:?}）",
                entry.id,
                entry.license,
                PERMISSIVE_LICENSES
            );
        }
    }

    #[test]
    fn every_small_model_is_bundled() {
        for entry in all()
            .iter()
            .filter(|entry| entry.total_bytes() <= BUNDLE_LIMIT)
        {
            // 小模型默认随包，但许可不宽松的必须例外：不能为了「开箱能用」把受限权重
            // 塞进安装包。
            if !PERMISSIVE_LICENSES.contains(&entry.license) {
                assert!(
                    !entry.bundled,
                    "{} 只有 {} 字节，但许可为「{}」，仍然不能随包",
                    entry.id,
                    entry.total_bytes(),
                    entry.license
                );
                continue;
            }
            assert!(
                entry.bundled,
                "{} 只有 {} 字节，应该随包",
                entry.id,
                entry.total_bytes()
            );
        }
    }

    #[test]
    fn sha256_is_either_empty_or_a_full_digest() {
        for entry in all() {
            for file in entry.files {
                assert!(
                    file.sha256.is_empty() || file.sha256.len() == 64,
                    "{} / {} 的 sha256 不合法",
                    entry.id,
                    file.filename
                );
                for source in file.sources {
                    if let Some(sha) = source.sha256 {
                        assert_eq!(
                            sha.len(),
                            64,
                            "{} / {} 源 sha256 不合法",
                            entry.id,
                            file.filename
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn asr_models_are_not_bundled() {
        for entry in all().iter().filter(|entry| entry.feature == "asr") {
            assert!(!entry.bundled, "{} 是 ASR 大模型，不该随包", entry.id);
            assert!(entry.total_bytes() > BUNDLE_LIMIT);
        }
    }

    #[test]
    fn every_source_is_official_and_has_a_region() {
        const OFFICIAL: &[&str] = &[
            "https://huggingface.co/",
            "https://github.com/",
            "https://modelscope.cn/",
            "https://www.modelscope.cn/",
        ];
        for entry in all() {
            for file in entry.files {
                for source in file.sources {
                    assert!(
                        source.region == "intl" || source.region == "cn",
                        "{} / {} 的区域非法：{}",
                        entry.id,
                        file.filename,
                        source.region
                    );
                    assert!(
                        OFFICIAL.iter().any(|host| source.url.starts_with(host)),
                        "{} / {} 用了非官方源：{}",
                        entry.id,
                        file.filename,
                        source.url
                    );
                }
            }
        }
    }

    #[test]
    fn domestic_preference_orders_modelscope_first_and_keeps_fallback() {
        let entry = by_id("whisper-base-int8").unwrap();
        let file = file_of(entry);
        let cn = candidates_for(
            file,
            &network_with(&[], ModelSourcePreference::Domestic),
            Some("cn"),
        );
        assert!(cn[0].url.contains("modelscope.cn"));
        assert!(cn
            .iter()
            .any(|candidate| candidate.url.contains("huggingface.co")));

        let intl = candidates_for(
            file,
            &network_with(&[], ModelSourcePreference::International),
            Some("intl"),
        );
        assert!(intl[0].url.contains("huggingface.co"));
        assert!(intl
            .iter()
            .any(|candidate| candidate.url.contains("modelscope.cn")));
    }

    #[test]
    fn model_scope_encoder_uses_its_own_sha256() {
        let entry = by_id("whisper-base-int8").unwrap();
        let file = file_of(entry);
        let cn = candidates_for(
            file,
            &network_with(&[], ModelSourcePreference::Domestic),
            Some("cn"),
        );
        let modelscope = cn
            .iter()
            .find(|candidate| candidate.url.contains("modelscope.cn"))
            .unwrap();
        assert_eq!(
            modelscope.sha256,
            "8dd58f75cfe74a7eb01bf0379c560d5c93c374f731f21e397e1a3c60b1e5747f"
        );
        let hf = cn
            .iter()
            .find(|candidate| candidate.url.contains("huggingface.co"))
            .unwrap();
        assert_eq!(
            hf.sha256,
            "0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11"
        );
    }

    #[test]
    fn mirrors_are_tried_before_official_sources_and_deduplicated() {
        let entry = by_id("paraformer-zh-small-int8").unwrap();
        let file = file_of(entry);
        let candidates = candidates_for(
            file,
            &network_with(
                &["https://mirror.example/?u={url}"],
                ModelSourcePreference::Auto,
            ),
            Some("cn"),
        );
        assert!(candidates[0]
            .url
            .starts_with("https://mirror.example/?u=http"));
        let mut seen = std::collections::HashSet::new();
        for candidate in candidates {
            assert!(seen.insert(candidate.url.clone()), "候选地址重复");
        }
    }

    #[test]
    fn every_downloadable_model_has_a_modelscope_source() {
        // 随包小模型（如 LocalVQE）已经躺在磁盘上，下载源只作兜底，不强制双源。
        // `voice-change` 的 ONNX 由上游社区导出、魔搭尚无人镜像，等自建镜像上传后
        // 在 `models.rs` 里补 `modelscope` 源，并把这条豁免删掉。
        for entry in all()
            .iter()
            .filter(|entry| !entry.bundled && entry.feature != "voice-change")
        {
            for file in entry.files {
                assert!(
                    file.sources
                        .iter()
                        .any(|source| source.kind == "modelscope" && source.region == "cn"),
                    "{} / {} 缺少魔搭源",
                    entry.id,
                    file.filename
                );
            }
        }
    }

    #[test]
    fn paraformer_entries_have_both_regions() {
        for id in ["paraformer-zh-small-int8", "paraformer-trilingual-int8"] {
            let entry = by_id(id).unwrap();
            assert_eq!(entry.regions(), vec!["cn".to_string(), "intl".to_string()]);
        }
    }

    #[test]
    fn github_download_prefix_only_rewrites_github_sources() {
        let vad = by_id("silero-vad").unwrap();
        let mut network = network_with(&[], ModelSourcePreference::International);
        network.download_prefix = "https://mirror.example/".into();
        let candidates = candidates_for(file_of(vad), &network, Some("intl"));
        assert!(candidates[0]
            .url
            .starts_with("https://mirror.example/https://github.com/"));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.url.starts_with("https://github.com/")));

        // HF 源不应该被「GitHub 下载代理前缀」重写。
        let whisper = by_id("whisper-base-int8").unwrap();
        let hf_candidates = candidates_for(file_of(whisper), &network, Some("intl"));
        assert!(hf_candidates
            .iter()
            .all(|candidate| !candidate.url.starts_with("https://mirror.example/")));
    }

    #[test]
    fn modelscope_candidates_include_the_api_endpoint() {
        let entry = by_id("whisper-base-int8").unwrap();
        let candidates = candidates_for(
            file_of(entry),
            &network_with(&[], ModelSourcePreference::Domestic),
            Some("cn"),
        );
        assert!(candidates.iter().any(|candidate| {
            candidate.url.contains("/api/v1/models/")
                && candidate.url.contains("FilePath=base-encoder.int8.onnx")
        }));
    }

    #[test]
    fn modelscope_api_url_is_built_only_for_modelscope_resolve_urls() {
        assert_eq!(
            modelscope_api_url(
                "https://modelscope.cn/models/pengzhendong/sherpa-onnx-whisper-base/resolve/master/base-encoder.int8.onnx"
            )
            .unwrap(),
            "https://www.modelscope.cn/api/v1/models/pengzhendong/sherpa-onnx-whisper-base/repo?Revision=master&FilePath=base-encoder.int8.onnx"
        );
        assert!(modelscope_api_url("https://huggingface.co/x/y.onnx").is_none());
    }

    #[test]
    fn silero_vad_is_small_enough_to_bundle() {
        let vad = by_id("silero-vad").unwrap();
        assert!(vad.bundled, "VAD 是字幕功能的硬依赖，应该随包分发");
        assert!(vad.bundle_eligible());
        assert!(vad.total_bytes() < BUNDLE_LIMIT);
    }

    #[test]
    fn bundled_models_ship_their_files_in_the_resource_directory() {
        for entry in all().iter().filter(|entry| entry.bundled) {
            let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/models")
                .join(entry.id);
            for file in entry.files {
                let path = base.join(file.filename);
                assert!(path.is_file(), "缺少随包文件：{}", path.display());
                assert!(
                    std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) > 0,
                    "随包文件为空：{}",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn sense_voice_is_the_recommended_first_entry() {
        let entry = &all()[0];
        assert_eq!(entry.id, "sense-voice-int8");
        assert!(entry.recommended);
        assert_eq!(entry.feature, "asr");
        assert_eq!(entry.family, ModelFamily::SenseVoice);
        assert_eq!(entry.license, "Apache-2.0");
        // 权重体积与实测下载一致：239_233_841 + 315_894。
        assert_eq!(entry.total_bytes(), 239_549_735);
    }

    #[test]
    fn exactly_one_model_is_recommended() {
        assert_eq!(all().iter().filter(|entry| entry.recommended).count(), 1);
    }

    #[test]
    fn zipvoice_family_serializes_as_zipvoice() {
        assert_eq!(
            serde_json::to_string(&ModelFamily::ZipVoice).unwrap(),
            "\"zipvoice\""
        );
    }

    #[test]
    fn sense_voice_sources_share_the_verified_checksums() {
        let entry = by_id("sense-voice-int8").unwrap();
        for file in entry.files {
            // 魔搭与 HF 的两个文件字节完全一致，因此不需要逐源声明 sha256。
            assert!(!file.sha256.is_empty());
            assert!(file.sources.iter().all(|source| source.sha256.is_none()));
            assert_eq!(file.sources.len(), 2);
        }
    }

    #[test]
    fn meanvc2_entries_are_download_only() {
        let convert = by_id("meanvc2-int8").expect("转换图条目");
        assert_eq!(convert.feature, "voice-change");
        assert!(!convert.bundled);
        assert!(!convert.bundle_eligible(), "74 MB 必须走按需下载");
        assert_eq!(convert.files.len(), 5);
        assert!(convert.files.iter().all(|file| !file.sha256.is_empty()));
        let speaker = by_id("meanvc2-speaker").expect("音色编码器条目");
        assert!(speaker.family == ModelFamily::MeanVc2);
        assert!(speaker.total_bytes() > 10 * 1024 * 1024);
    }
}

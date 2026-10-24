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
    /// 覆盖的区域：`["cn"]` / `["cn","intl"]`。
    pub regions: Vec<String>,
    /// 全部官方源（去重；界面用来显示「魔搭 + HuggingFace」与悬停 URL）。
    pub sources: Vec<ModelSourceStatus>,
    pub files: Vec<ModelFileStatus>,
}

/// 权重落地目录（应用配置目录的 `models/`）。
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
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
                    ModelFileStatus {
                        filename: file.filename.to_string(),
                        approx_bytes: file.approx_bytes,
                        installed: installed_path
                            .as_ref()
                            .map(|dir| dir.join(file.filename).is_file())
                            .unwrap_or(false),
                        bytes,
                    }
                })
                .collect();
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
        if final_path.is_file() {
            base += file.approx_bytes;
            emit(app, entry, "downloading", base.min(total), total, None);
            continue;
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

fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
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
    fn bundled_models_respect_the_ten_megabyte_limit() {
        for entry in all().iter().filter(|entry| entry.bundled) {
            assert!(
                entry.bundle_eligible(),
                "{} 超过 10 MB，不能随包分发",
                entry.id
            );
        }
    }

    #[test]
    fn every_small_model_is_bundled() {
        for entry in all()
            .iter()
            .filter(|entry| entry.total_bytes() <= BUNDLE_LIMIT)
        {
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
        for entry in all().iter().filter(|entry| !entry.bundled) {
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
        network.download_prefix = "https://gh-proxy.example/".into();
        let candidates = candidates_for(file_of(vad), &network, Some("intl"));
        assert!(candidates[0]
            .url
            .starts_with("https://gh-proxy.example/https://github.com/"));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.url.starts_with("https://github.com/")));

        // HF 源不应该被「GitHub 下载代理前缀」重写。
        let whisper = by_id("whisper-base-int8").unwrap();
        let hf_candidates = candidates_for(file_of(whisper), &network, Some("intl"));
        assert!(hf_candidates
            .iter()
            .all(|candidate| !candidate.url.starts_with("https://gh-proxy.example/")));
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
}

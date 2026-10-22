//! sherpa-onnx `OfflineSourceSeparation` C API 的安全封装。
//!
//! sherpa-onnx 的 Rust crate（1.13.8）还没有 source separation 绑定，但静态库里
//! 已经包含 C API 符号。这里用最小的 `extern "C"` 声明直接调用，支持 UVR（MDX-Net）
//! 和 Spleeter 两种 2-stem 模型。
//!
//! 输入/输出都是**按声道拆分**的 `f32`；C API 内部负责重采样到模型采样率。

#![allow(unsafe_code)]

use std::ffi::{c_char, c_void, CString};
use std::ptr;
use std::slice;

#[repr(C)]
struct SpleeterConfig {
    vocals: *const c_char,
    accompaniment: *const c_char,
}

#[repr(C)]
struct UvrConfig {
    model: *const c_char,
}

#[repr(C)]
struct ModelConfig {
    spleeter: SpleeterConfig,
    uvr: UvrConfig,
    num_threads: i32,
    debug: i32,
    provider: *const c_char,
}

#[repr(C)]
struct Config {
    model: ModelConfig,
}

#[repr(C)]
struct Stem {
    samples: *mut *mut f32,
    num_channels: i32,
    n: i32,
}

#[repr(C)]
struct Output {
    stems: *const Stem,
    num_stems: i32,
    sample_rate: i32,
}

// `sherpa-onnx` 的 build script 会把静态库目录加进 `-L`，但链接指令不一定能穿透到
// 本 crate 的最终二进制（尤其是测试二进制）。这里显式链接同一组静态库，顺序与
// sherpa-onnx-sys 保持一致。ONNX Runtime 由 `ort` 链接，不在这里重复声明。
#[link(name = "sherpa-onnx-c-api", kind = "static")]
#[link(name = "sherpa-onnx-core", kind = "static")]
#[link(name = "kaldi-decoder-core", kind = "static")]
#[link(name = "sherpa-onnx-kaldifst-core", kind = "static")]
#[link(name = "sherpa-onnx-fstfar", kind = "static")]
#[link(name = "sherpa-onnx-fst", kind = "static")]
#[link(name = "kaldi-native-fbank-core", kind = "static")]
#[link(name = "kissfft-float", kind = "static")]
#[link(name = "piper_phonemize", kind = "static")]
#[link(name = "espeak-ng", kind = "static")]
#[link(name = "ucd", kind = "static")]
#[link(name = "ssentencepiece_core", kind = "static")]
extern "C" {
    fn SherpaOnnxCreateOfflineSourceSeparation(config: *const Config) -> *const c_void;
    fn SherpaOnnxDestroyOfflineSourceSeparation(ss: *const c_void);
    fn SherpaOnnxOfflineSourceSeparationGetOutputSampleRate(ss: *const c_void) -> i32;
    fn SherpaOnnxOfflineSourceSeparationGetNumberOfStems(ss: *const c_void) -> i32;
    fn SherpaOnnxOfflineSourceSeparationProcess(
        ss: *const c_void,
        samples: *const *const f32,
        num_channels: i32,
        num_samples: i32,
        sample_rate: i32,
    ) -> *const Output;
    fn SherpaOnnxDestroySourceSeparationOutput(p: *const Output);
}

// 平台运行时依赖。`#[link]` 只能挂在外部的 `extern` 块上，所以用空块承载。
#[cfg(target_os = "macos")]
#[link(name = "c++")]
#[link(name = "Foundation", kind = "framework")]
extern "C" {}

#[cfg(target_os = "linux")]
#[link(name = "stdc++")]
#[link(name = "m")]
#[link(name = "pthread")]
#[link(name = "dl")]
extern "C" {}

/// 一条分轨：按声道拆分的样本。
#[derive(Debug, Clone)]
pub struct SeparatedStem {
    pub channels: Vec<Vec<f32>>,
}

/// 分离结果。UVR/Spleeter 都是 2-stem：`[人声, 伴奏]`。
#[derive(Debug, Clone)]
pub struct SeparationOutput {
    pub sample_rate: i32,
    pub stems: Vec<SeparatedStem>,
}

/// 用 UVR（MDX-Net）模型做 2-stem 人声/伴奏分离。
pub fn separate_uvr(
    model_path: &str,
    channels: &[Vec<f32>],
    sample_rate: i32,
) -> Result<SeparationOutput, String> {
    if channels.is_empty() {
        return Err("没有输入声道".into());
    }
    let num_samples = channels[0].len();
    if num_samples == 0 {
        return Err("输入音频为空".into());
    }
    if channels.iter().any(|channel| channel.len() != num_samples) {
        return Err("各声道长度不一致".into());
    }

    let model = CString::new(model_path).map_err(|_| "模型路径包含 NUL".to_string())?;
    let provider = CString::new("cpu").expect("static string");
    let config = Config {
        model: ModelConfig {
            spleeter: SpleeterConfig {
                vocals: ptr::null(),
                accompaniment: ptr::null(),
            },
            uvr: UvrConfig {
                model: model.as_ptr(),
            },
            num_threads: 2,
            debug: 0,
            provider: provider.as_ptr(),
        },
    };

    let engine = unsafe { SherpaOnnxCreateOfflineSourceSeparation(&config) };
    if engine.is_null() {
        return Err(format!("无法创建音源分离引擎：{model_path}"));
    }

    let expected_stems = unsafe { SherpaOnnxOfflineSourceSeparationGetNumberOfStems(engine) };
    let engine_sample_rate =
        unsafe { SherpaOnnxOfflineSourceSeparationGetOutputSampleRate(engine) };
    let channel_ptrs: Vec<*const f32> = channels.iter().map(|channel| channel.as_ptr()).collect();
    let output = unsafe {
        SherpaOnnxOfflineSourceSeparationProcess(
            engine,
            channel_ptrs.as_ptr(),
            channels.len() as i32,
            num_samples as i32,
            sample_rate,
        )
    };

    let result = if output.is_null() {
        Err("音源分离失败".to_string())
    } else {
        unsafe {
            let output_ref = &*output;
            let stems =
                slice::from_raw_parts(output_ref.stems, output_ref.num_stems.max(0) as usize);
            let mut separated = Vec::with_capacity(stems.len());
            for stem in stems {
                let channel_slices =
                    slice::from_raw_parts(stem.samples, stem.num_channels.max(0) as usize);
                let mut channel_data = Vec::with_capacity(channel_slices.len());
                for &samples in channel_slices {
                    channel_data
                        .push(slice::from_raw_parts(samples, stem.n.max(0) as usize).to_vec());
                }
                separated.push(SeparatedStem {
                    channels: channel_data,
                });
            }
            Ok(SeparationOutput {
                sample_rate: if output_ref.sample_rate > 0 {
                    output_ref.sample_rate
                } else {
                    engine_sample_rate
                },
                stems: separated,
            })
        }
    };

    unsafe {
        if !output.is_null() {
            SherpaOnnxDestroySourceSeparationOutput(output);
        }
        SherpaOnnxDestroyOfflineSourceSeparation(engine);
    }
    let _ = expected_stems;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uvr_runs_when_the_model_is_present() {
        let path = std::env::var("UVR_TEST_MODEL")
            .unwrap_or_else(|_| "/tmp/aicut-uvr/UVR_MDXNET_9482.onnx".to_string());
        if !std::path::Path::new(&path).is_file() {
            eprintln!("跳过：未找到 UVR 模型 {path}");
            return;
        }

        let sample_rate = 44_100;
        let frames = sample_rate as usize;
        let mut left = Vec::with_capacity(frames);
        let mut right = Vec::with_capacity(frames);
        for index in 0..frames {
            let t = index as f32 / sample_rate as f32;
            let tone = (std::f32::consts::TAU * 440.0 * t).sin() * 0.3;
            let noise = ((index * 1103515245 + 12345) as f32 / u32::MAX as f32 - 0.5) * 0.05;
            left.push(tone + noise);
            right.push(tone + noise);
        }

        let output = separate_uvr(&path, &[left, right], sample_rate).expect("分离应成功");
        assert_eq!(output.stems.len(), 2, "UVR 应输出人声 / 伴奏两条分轨");
        for stem in &output.stems {
            assert_eq!(stem.channels.len(), 2);
            assert!(!stem.channels[0].is_empty());
        }
    }
}

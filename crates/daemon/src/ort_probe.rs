//! ONNX Runtime 可加载性探针。
//!
//! 为什么单独一个模块：镜像里随包的 `libonnxruntime.so` 是否真的能被 `dlopen`，
//! 取决于目标底座（Alpine 的 musl 需要 gcompat 垫片，Debian 的 glibc 原生可用）。
//! 这个问题无法靠"文件在不在"回答，必须真调一次 `ort` 的初始化。
//!
//! 探针只做两件事：解析路径、尝试加载；**不建会话**，所以很快、也不吃内存。

#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::path::PathBuf;

use serde::Serialize;

use crate::host::Host;

/// 探针结果。
#[derive(Debug, Clone, Serialize)]
pub struct OrtProbe {
    /// 找到并尝试加载的 dylib 路径；没找到时为 `None`。
    pub path: Option<String>,
    /// 是否加载成功（能建会话的必要条件）。
    pub loaded: bool,
    /// 错误信息（加载失败时）。
    pub error: Option<String>,
    /// ONNX Runtime 的构建信息（加载成功时，形如 `ORT Build Info: git-branch=rel-1.30.0, …`）。
    pub build: Option<String>,
}

/// 候选 ONNX Runtime 文件（随包目录优先，其次 `AICUT_ORT_BUNDLED`）。
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn candidates(host: &dyn Host) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(dir) = host.resource_dir() {
        dirs.push(dir.join("ort"));
        dirs.push(dir);
    }
    if let Some(dir) = std::env::var_os("AICUT_ORT_BUNDLED") {
        dirs.push(PathBuf::from(dir));
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("libonnxruntime.so") {
                    out.push(entry.path());
                }
            }
        }
    }
    out
}

/// 探测当前形态下 ONNX Runtime 能否加载。
///
/// macOS 是**静态链接**（CoreML）：没有 dylib 可加载，也不该去找——
/// `Session::builder()` 直接就有 ORT。所以那边只回报构建信息。
pub fn probe(host: &dyn Host) -> OrtProbe {
    #[cfg(target_os = "macos")]
    {
        let _ = host;
        OrtProbe {
            path: None,
            loaded: true,
            error: None,
            build: Some(ort::info().to_string()),
        }
    }
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let Some(path) = candidates(host).into_iter().next() else {
            return OrtProbe {
                path: None,
                loaded: false,
                build: None,
                error: Some("没有找到 libonnxruntime.so（镜像里没随包 ORT？）".into()),
            };
        };
        // `load-dynamic`：初始化成功即代表 dylib 能被 dlopen 且符号齐全。
        let text = path.to_string_lossy().into_owned();
        match ort::init_from(&text) {
            Ok(_builder) => OrtProbe {
                path: Some(text),
                loaded: true,
                error: None,
                build: Some(ort::info().to_string()),
            },
            Err(error) => OrtProbe {
                path: Some(text),
                loaded: false,
                error: Some(error.to_string()),
                build: None,
            },
        }
    }
}

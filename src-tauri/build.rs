use std::path::{Path, PathBuf};

/// 找到 ort-sys 下载/解压的 ONNX Runtime 静态库。
///
/// sherpa-onnx 的 `-l onnxruntime` 已被移除，ORT 完全由 `ort` 提供。把这份
/// 归档用完整路径追加到链接命令末尾，保证 GNU ld 单遍扫描时也能解析 sherpa
/// 静态库里的未定义符号（macOS 的 ld64 通常不需要，但这样也安全）。
fn onnxruntime_archive() -> Option<PathBuf> {
    let out_dir = std::env::var_os("OUT_DIR")?;
    let out_dir = Path::new(&out_dir);
    let build_dir = out_dir.ancestors().find(|path| {
        path.file_name()
            .map(|name| name == "build")
            .unwrap_or(false)
    })?;

    for entry in std::fs::read_dir(build_dir).ok()?.flatten() {
        if !entry.file_name().to_string_lossy().starts_with("ort-sys-") {
            continue;
        }
        let Ok(output) = std::fs::read_to_string(entry.path().join("output")) else {
            continue;
        };
        for line in output.lines() {
            let Some(dir) = line.strip_prefix("cargo:rustc-link-search=native=") else {
                continue;
            };
            for name in ["libonnxruntime.a", "onnxruntime.lib"] {
                let candidate = Path::new(dir).join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn main() {
    println!("cargo:rerun-if-changed=icons");
    if let Some(archive) = onnxruntime_archive() {
        println!("cargo:rustc-link-arg={}", archive.display());
    }
    tauri_build::build()
}

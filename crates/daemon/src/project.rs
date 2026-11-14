//! 工程文件的读写（纯文件系统，不需要 Tauri）。

use std::path::Path;

pub fn read_project(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("读取工程失败：{e}"))
}

pub fn write_project(path: &str, json: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(path, json).map_err(|e| format!("写入工程失败：{e}"))
}

pub fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

/// 文件名安全化：只留字母数字与 `.` `_` `-`，路径分隔符会被剥掉。
pub fn safe_file_name(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .trim()
        .trim_matches('.');
    let cleaned: String = base
        .chars()
        .map(|c| {
            // 保留 Unicode 字母（中文工程名可用），空白与危险字符一律变 `_`。
            if c.is_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// 同名文件加 `-2` / `-3`，绝不覆盖。
pub fn unique_path(dir: &Path, name: &str) -> std::path::PathBuf {
    let direct = dir.join(name);
    if !direct.exists() {
        return direct;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    for index in 2..10_000 {
        let candidate = if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let candidate = dir.join(candidate);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(name)
}

/// 在 `<data>/<subdir>/` 下分配一个不冲突的文件路径（浏览器没有文件框时用）。
pub fn new_file_path(
    data_dir: &Path,
    subdir: &str,
    name: &str,
) -> Result<std::path::PathBuf, String> {
    let dir = data_dir.join(subdir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建 {subdir} 目录失败：{e}"))?;
    let stem = if name.trim().is_empty() {
        "file".to_string()
    } else {
        safe_file_name(name.trim())
    };
    Ok(unique_path(&dir, &stem))
}

/// 浏览器「另存为」：在 `<data>/projects/` 下给工程分配一个路径。
pub fn new_project_path(data_dir: &Path, name: &str) -> Result<std::path::PathBuf, String> {
    let stem = if name.trim().is_empty() {
        "project".to_string()
    } else {
        safe_file_name(name.trim())
    };
    let file = if stem.ends_with(".json") {
        stem
    } else {
        format!("{stem}.json")
    };
    new_file_path(data_dir, "projects", &file)
}

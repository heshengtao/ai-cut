//! 工程文件的读写。内容就是 JSON 文本，解析与校验放在前端。

use std::path::Path;

#[tauri::command]
pub fn read_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取工程失败：{e}"))
}

#[tauri::command]
pub fn write_project(path: String, json: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&path, json).map_err(|e| format!("写入工程失败：{e}"))
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

//! 工程文件读写的 Tauri 壳：实现只有一份，在 `aicut_daemon::project`。

#[tauri::command]
pub fn read_project(path: String) -> Result<String, String> {
    aicut_daemon::project::read_project(&path)
}

#[tauri::command]
pub fn write_project(path: String, json: String) -> Result<(), String> {
    aicut_daemon::project::write_project(&path, &json)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    aicut_daemon::project::path_exists(&path)
}

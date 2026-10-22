//! 用系统默认浏览器打开外部链接（GitHub 仓库等）。

/// 只放行 http(s)，避免把任意字符串交给系统打开器。
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("不支持的链接：{url}"));
    }
    open::that_detached(&url).map_err(|error| error.to_string())
}

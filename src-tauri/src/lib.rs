#![forbid(unsafe_code)]

mod export;
mod media;
mod project_io;
mod sidecar;

/// 创建主窗口，去掉系统自绘的标题栏：
/// - macOS：Overlay 风格（保留原生红黄绿，去掉系统标题栏，内容延伸到顶部）
/// - Windows / Linux：完全无边框，窗口按钮由前端自绘
///
/// 窗口在配置里是 `create: false`，因此由这里显式创建，才能在构建器上改标题栏样式。
fn build_main_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let config = &app.config().app.windows[0];
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.decorations(false);
    }

    builder.build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(export::ExportState::default())
        .invoke_handler(tauri::generate_handler![
            media::probe_media,
            media::make_thumbnail,
            media::make_waveform,
            project_io::read_project,
            project_io::write_project,
            project_io::path_exists,
            export::export_video,
            export::cancel_export,
            export::write_export_text_image,
        ])
        .setup(|app| {
            build_main_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

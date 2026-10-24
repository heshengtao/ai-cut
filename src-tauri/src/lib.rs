#![forbid(unsafe_code)]

mod agent;
mod analysis;
mod asr;
mod audio_ai;
mod backend;
mod bridge;
mod cli;
mod cloud_tts;
mod export;
mod history;
mod mcp;
mod media;
mod models;
mod network;
mod ofx;
mod opener;
mod plugins;
mod project_io;
mod sidecar;
mod tools;
mod tts;
mod video_ai;
mod video_dsp;
mod zipvoice;

use std::sync::Arc;
use tauri::Manager;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(export::ExportState::default())
        .manage(video_dsp::VideoDspState::default())
        .invoke_handler(tauri::generate_handler![
            media::probe_media,
            media::file_stamp,
            media::make_thumbnail,
            media::make_waveform,
            media::extract_audio_preview,
            media::make_video_preview,
            project_io::read_project,
            project_io::write_project,
            project_io::path_exists,
            history::project_history_list,
            history::project_history_record,
            history::project_history_get,
            history::project_history_delete,
            export::export_video,
            export::cancel_export,
            export::write_export_text_image,
            video_dsp::video_dsp_process,
            video_dsp::video_dsp_cancel,
            video_ai::video_ai_upscale,
            video_ai::video_ai_interpolate,
            video_ai::video_ai_reframe,
            video_ai::video_ai_cancel,
            bridge::bridge_respond,
            mcp::mcp_status,
            mcp::set_mcp_config,
            network::network_config,
            network::network_set_config,
            network::network_status,
            network::network_probe,
            network::model_source_config,
            network::model_set_source_config,
            network::plugin_registry_config,
            network::plugin_set_registry_config,
            backend::ai_backend_info,
            backend::ai_set_backend,
            agent::agent_config,
            agent::agent_set_config,
            agent::agent_models,
            agent::agent_test,
            agent::agent_sessions,
            agent::agent_session,
            agent::agent_delete_session,
            agent::agent_set_head,
            agent::agent_send,
            agent::agent_cancel,
            agent::agent_running,
            cli::cli_status,
            cli::install_cli,
            cli::uninstall_cli,
            opener::open_external_url,
            models::model_catalog,
            models::model_download,
            models::model_probe,
            models::model_cancel,
            models::model_remove,
            models::model_reveal,
            plugins::plugin_registry,
            plugins::plugin_installed,
            plugins::plugin_install,
            plugins::plugin_cancel,
            plugins::plugin_remove,
            plugins::plugin_import,
            plugins::plugin_reveal,
            plugins::plugin_open,
            ofx::ofx_probe,
            ofx::ofx_render_frame,
            ofx::ofx_render_preview,
            ofx::ofx_bake_clip,
            ofx::ofx_cancel_bake,
            asr::asr_transcribe,
            asr::asr_cancel,
            tts::tts_voices,
            tts::tts_synthesize,
            tts::tts_cancel,
            cloud_tts::cloud_tts_config,
            cloud_tts::cloud_tts_set_config,
            cloud_tts::cloud_tts_voices,
            cloud_tts::cloud_tts_test,
            cloud_tts::cloud_tts_synthesize,
            audio_ai::audio_measure_loudness,
            audio_ai::audio_dsp_process,
            audio_ai::audio_ai_denoise,
            audio_ai::audio_ai_separate,
            audio_ai::audio_extract_reference,
            audio_ai::audio_ai_cancel,
            audio_ai::translate_text,
        ])
        .setup(|app| {
            let config_dir = app.path().app_config_dir().ok();
            let bridge = Arc::new(bridge::ProjectBridge::new(app.handle().clone()));
            app.manage(bridge.clone());

            let network = Arc::new(network::NetworkRuntime::load(
                config_dir.as_ref().map(|dir| dir.join("network.json")),
            ));
            backend::set_preference(network.get().backend_preference);
            if let Some(dir) = config_dir.as_ref() {
                let cache = dir.join("backend-cache").join("coreml");
                let _ = std::fs::create_dir_all(&cache);
                backend::set_coreml_cache_dir(cache);
            }
            app.manage(network.clone());

            let cloud_tts = Arc::new(cloud_tts::CloudTtsRuntime::load(
                config_dir.as_ref().map(|dir| dir.join("tts.json")),
            ));
            app.manage(cloud_tts);

            let mcp_runtime = Arc::new(mcp::McpRuntime::load(
                app.handle().clone(),
                bridge.clone(),
                config_dir.as_ref().map(|dir| dir.join("mcp.json")),
                config_dir.as_ref().map(|dir| dir.join("mcp-url")),
            ));
            app.manage(mcp_runtime.clone());
            mcp_runtime.autostart();

            let agent_state = Arc::new(agent::AgentState::new(
                app.handle().clone(),
                bridge.clone(),
                network,
                config_dir.as_ref().map(|dir| dir.join("ai.json")),
                config_dir
                    .as_ref()
                    .map(|dir| dir.join("agent").join("sessions")),
            ));
            app.manage(agent_state);

            cli::publish_path(app.handle());

            build_main_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

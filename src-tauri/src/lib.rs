#![forbid(unsafe_code)]

mod agent;
mod aligner;
mod analysis;
mod asr;
mod audio_ai;
mod backend;
mod bridge;
mod cli;
mod cloud_gen;
mod cloud_tts;
mod export;
mod fonts;
mod history;
mod host;
mod image_gen;
mod mcp;
mod media;
mod models;
mod network;
mod ofx;
mod opener;
mod paths;
mod plugins;
mod project_io;
mod runtime;
mod sdcpp;
mod session;
mod sidecar;
mod tools;
mod tts;
mod video_ai;
mod video_dsp;
mod video_gen;
mod web;
mod zipvoice;
mod voice_change;

use std::sync::Arc;
use tauri::Manager;

/// 创建主窗口，去掉系统自绘的标题栏：
/// - macOS：Overlay 风格（保留原生红黄绿，去掉系统标题栏，内容延伸到顶部）
/// - Windows / Linux：完全无边框，窗口按钮由前端自绘
///
/// 窗口在配置里是 `create: false`，因此由这里显式创建，才能在构建器上改标题栏样式。
fn build_main_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let config = &app.config().app.windows[0];
    let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?.on_page_load(
        |window, payload| {
            // 配置里是 `visible: false`：页面真的加载完再显示，避免用户先看到一块
            // 「只有底色」的黑屏。前端首帧就绪时还会调一次 `app_ready`（幂等）。
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = window.show();
            }
        },
    );

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


/// 启动本机 HTTP 服务（浏览器 / 第二屏客户端打进来）。
///
/// 默认只绑 `127.0.0.1:28440`；局域网访问由设置页的开关改成 `0.0.0.0`（M2）。
/// 服务起不来不影响桌面主流程：只记日志，窗口照常打开。
fn start_local_daemon(app: &tauri::AppHandle) {
    let data_dir = match paths::data_dir(app) {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("[daemon] 取数据目录失败：{error}");
            return;
        }
    };
    let token = match aicut_daemon::http::load_or_create_token(&data_dir) {
        Ok(token) => token,
        Err(error) => {
            eprintln!("[daemon] 读取 web-token 失败：{error}");
            return;
        }
    };
    let host = Arc::new(host::TauriHost::new(app.clone()));
    let export = app
        .state::<Arc<aicut_daemon::export::ExportState>>()
        .inner()
        .clone();
    let session = app
        .state::<Arc<aicut_daemon::session::Session>>()
        .inner()
        .clone();
    session::spawn_bridge(app.clone(), Arc::clone(&session));
    let ctx = Arc::new(aicut_daemon::rpc::RpcCtx {
        sessions: Default::default(),
        host,
        token,
        version: env!("CARGO_PKG_VERSION"),
        export,
        session,
        doc: aicut_daemon::DocHandle::spawn(),
    });
    let web_config = web::load_config(app);
    let bind = if web_config.lan {
        std::net::IpAddr::from([0, 0, 0, 0])
    } else {
        std::net::IpAddr::from([127, 0, 0, 1])
    };
    let cfg = aicut_daemon::http::ServerConfig {
        bind,
        port: web_config.port,
        dist: resolve_dist(app),
    };
    let mut info = web::info_for(&web_config, &ctx.token);
    info.running = true;
    web::mark_running(app, info);
    tauri::async_runtime::spawn(async move {
        match aicut_daemon::http::serve(ctx, cfg, tokio_util::sync::CancellationToken::new()).await
        {
            Ok(server) => eprintln!("[daemon] listening on http://{}/", server.addr),
            Err(error) => eprintln!("[daemon] HTTP 服务未启动：{error}"),
        }
    });
}

/// 浏览器端要加载的前端产物目录。
///
/// 生产：Tauri 资源目录里的 `dist/`（见 `tauri.conf.json` 的 resources）；
/// 开发：仓库根目录的 `dist/`（`pnpm build` 之后）；
/// 兜底：`AICUT_DIST` 环境变量。
fn resolve_dist(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let candidate = dir.join("dist");
        if candidate.join("index.html").is_file() {
            return Some(candidate);
        }
    }
    if let Some(dir) = std::env::var_os("AICUT_DIST") {
        let candidate = std::path::PathBuf::from(dir);
        if candidate.join("index.html").is_file() {
            return Some(candidate);
        }
    }
    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if dev.join("index.html").is_file() {
        return Some(dev.canonicalize().unwrap_or(dev));
    }
    None
}

/// 前端首帧已经画好：把窗口显示出来。
///
/// 正常路径下窗口在 webview 加载完成时已经显示过；这里再兜一次（幂等），
/// 也覆盖「前端先调、加载事件后到」的顺序。
#[tauri::command]
fn app_ready(window: tauri::WebviewWindow) {
    if window.label() != "main" {
        return;
    }
    let _ = window.show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 数据目录必须在**任何路径解析之前**定下来：模型、运行时、插件、历史都按它落盘。
    paths::init_from_args();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(aicut_daemon::export::ExportState::default()))
        .manage(web::WebState::default())
        .manage(Arc::new(aicut_daemon::session::Session::new()))
        .manage(video_dsp::VideoDspState::default())
        .invoke_handler(tauri::generate_handler![
            app_ready,
            paths::data_dir_info,
            paths::data_dir_migrate,
            paths::data_dir_cleanup_previous,
            paths::disk_free_bytes,
            web::web_access_info,
            web::web_access_set_lan,
            web::web_access_open,
            session::session_publish,
            session::session_playhead,
            media::probe_media,
            media::file_stamp,
            media::media_cache_dir,
            media::make_thumbnail,
            media::make_waveform,
            media::extract_audio_preview,
            media::make_video_preview,
            media::copy_media_files,
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
            video_ai::video_ai_upscale_image,
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
            network::model_save_hf_token,
            network::model_hf_token_status,
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
            fonts::font_registry,
            fonts::font_list,
            fonts::font_install,
            fonts::font_cancel,
            fonts::font_remove,
            fonts::font_reveal,
            fonts::font_probe,
            fonts::font_import,
            models::model_catalog,
            models::model_download,
            models::model_probe,
            models::model_cancel,
            models::model_remove,
            models::model_reveal,
            runtime::runtime_catalog,
            runtime::runtime_install,
            runtime::runtime_cancel,
            runtime::runtime_busy,
            runtime::runtime_remove,
            runtime::runtime_reveal,
            runtime::app_restart,
            sdcpp::sdcpp_catalog,
            sdcpp::sdcpp_install,
            sdcpp::sdcpp_cancel,
            sdcpp::sdcpp_busy,
            sdcpp::sdcpp_remove,
            sdcpp::sdcpp_reveal,
            sdcpp::sdcpp_select,
            sdcpp::sdcpp_info,
            sdcpp::sdcpp_set_backend,
            video_gen::video_gen_start,
            video_gen::video_gen_cancel,
            video_gen::video_gen_busy,
            image_gen::image_gen_start,
            image_gen::image_gen_cancel,
            image_gen::image_gen_busy,
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
            ofx::ofx_source_time,
            ofx::ofx_render_transition,
            ofx::ofx_bake_transition,
            ofx::ofx_bake_image,
            ofx::ofx_cancel_bake,
            asr::asr_transcribe,
            asr::asr_transcribe_words,
            asr::asr_cancel,
            tts::tts_voices,
            tts::tts_synthesize,
            tts::tts_cancel,
            cloud_tts::cloud_tts_config,
            cloud_tts::cloud_tts_set_config,
            cloud_tts::cloud_tts_voices,
            cloud_tts::cloud_tts_test,
            cloud_tts::cloud_tts_synthesize,
            cloud_gen::cloud_gen_config,
            cloud_gen::cloud_gen_set_config,
            cloud_gen::cloud_gen_presets,
            cloud_gen::cloud_gen_image,
            cloud_gen::cloud_gen_video,
            cloud_gen::cloud_gen_test,
            cloud_gen::cloud_gen_cancel,
            cloud_gen::cloud_gen_busy,
            audio_ai::audio_measure_loudness,
            audio_ai::audio_dsp_process,
            audio_ai::audio_ai_denoise,
            audio_ai::audio_ai_separate,
            audio_ai::audio_extract_reference,
            audio_ai::audio_ai_cancel,
            voice_change::voice_change_convert,
            voice_change::voice_change_cancel,
            voice_change::voice_change_voice_list,
            voice_change::voice_change_voice_import,
            voice_change::voice_change_voice_delete,
            audio_ai::translate_text,
        ])
        .setup(|app| {
            // 数据目录可能被搬到别的盘：配置（network / tts / ai / mcp.json）与它同根。
            let config_dir = paths::config_dir(app.handle()).ok();
            let bridge = Arc::new(bridge::ProjectBridge::new(app.handle().clone()));
            app.manage(bridge.clone());

            let network = Arc::new(network::NetworkRuntime::load(
                config_dir.as_ref().map(|dir| dir.join("network.json")),
            ));
            backend::set_preference(network.get().backend_preference);
            // 运行库的「待删除 / 待重启」清理必须在**任何 dylib 被加载之前**：
            // 已映射的 dll 在本进程里删不掉，晚一步就又要等下一次启动。
            runtime::init(app.handle());
            sdcpp::init(app.handle());
            // Windows / Linux 是运行时加载：dylib 延迟到**第一次建会话**才装进进程，
            // 这样刚装完 CUDA 切过去不必重启（见 backend::ensure_runtime_loaded）。
            // macOS 静态链接，这里直接返回 None。
            match backend::init_runtime(app.handle()) {
                Ok(Some(dir)) => {
                    eprintln!("[backend] ONNX Runtime 将在首次使用 AI 时加载：{}", dir.display())
                }
                Ok(None) => {}
                Err(error) => eprintln!("[backend] 准备 ONNX Runtime 失败：{error}"),
            }
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

            let cloud_gen = Arc::new(cloud_gen::CloudGenRuntime::load(
                config_dir.as_ref().map(|dir| dir.join("cloud-gen.json")),
            ));
            app.manage(cloud_gen);

            let mcp_runtime = Arc::new(mcp::McpRuntime::load(
                app.handle().clone(),
                bridge.clone(),
                config_dir.as_ref().map(|dir| dir.join("mcp.json")),
                // `mcp-url` 是给外部 harness 按 bundle id 找的发现文件，必须留在默认位置。
                paths::default_config_dir(app.handle()).map(|dir| dir.join("mcp-url")),
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

            // 本机 HTTP 服务：浏览器访问与 aicutd 共用同一套 RPC。
            start_local_daemon(app.handle());

            build_main_window(app.handle())?;
            // 页面万一没起来（dev server 没起、前端脚本报错），也不能永远不出窗口：
            // 6 秒后兜底显示。正常的显示由 webview 加载完成 / 前端 `app_ready` 触发。
            {
                let handle = app.handle().clone();
                let _ = std::thread::Builder::new()
                    .name("ai-cut-window-fallback".into())
                    .spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(6));
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                        }
                    });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 子进程烘焙入口（`--ofx-bake-worker` / `--ofx-bake-chunked`）。
///
/// 分段烘焙靠独立进程拿到 OFX 并行度；worker 只跑渲染，不初始化 Tauri。
/// 正常启动返回 `None`，`main()` 会继续走 `run()`。
pub fn maybe_run_bake_worker() -> Option<i32> {
    ofx::maybe_run_bake_worker()
}

/// `--ai-selftest`：无界面检查 ONNX Runtime 运行时与执行后端是否可用。
pub fn maybe_run_ai_selftest() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|arg| arg == "--ai-selftest") {
        return None;
    }
    Some(backend::selftest())
}

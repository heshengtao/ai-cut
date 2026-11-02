// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

fn main() {
    // 无界面模式：必须在初始化 Tauri 之前拦下来（不建窗口、不建 webview）。
    if let Some(code) = ai_cut_lib::maybe_run_bake_worker() {
        std::process::exit(code);
    }
    if let Some(code) = ai_cut_lib::maybe_run_ai_selftest() {
        std::process::exit(code);
    }
    ai_cut_lib::run()
}

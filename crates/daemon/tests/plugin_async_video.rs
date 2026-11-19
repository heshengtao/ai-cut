//! 「异步视频代理」示例插件的端到端：真 QuickJS 跑 host.js，打本机 axum mock 服务。
//!
//! 覆盖客户端半之外的全链路：multipart 提交 → 轮询 → 取直链 → 下载 → 落盘。
//! 真实私有插件用的是同一套 `ctx.http` 能力，这条用例通过就说明能力面够用。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use aicut_daemon::host::{HeadlessHost, Host};
use aicut_daemon::plugin_host::service;
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tempfile::TempDir;

const MP4: &[u8] = b"\x00\x00\x00\x18ftypmp42fake-video-bytes-for-test";

#[derive(Clone)]
struct Mock {
    polls: Arc<AtomicUsize>,
    port: Arc<AtomicUsize>,
}

async fn submit() -> (axum::http::StatusCode, Json<Value>) {
    (axum::http::StatusCode::ACCEPTED, Json(json!({ "id": "t1" })))
}

async fn poll(State(mock): State<Mock>) -> Json<Value> {
    let seen = mock.polls.fetch_add(1, Ordering::SeqCst);
    let status = if seen == 0 { "running" } else { "done" };
    Json(json!({ "status": status }))
}

async fn file_url(State(mock): State<Mock>) -> Json<Value> {
    let port = mock.port.load(Ordering::SeqCst);
    Json(json!({ "url": format!("http://127.0.0.1:{port}/download") }))
}

async fn download() -> Vec<u8> {
    MP4.to_vec()
}

fn install(host: &Arc<dyn Host>, dir: &std::path::Path) {
    service::install_local(host, dir, "1.4.0").unwrap();
}

#[test]
fn runs_the_multipart_poll_download_flow() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _enter = runtime.enter();
    let polls = Arc::new(AtomicUsize::new(0));

    // 先起服务拿到端口，再把端口塞进状态里（file-url 要用）。
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    listener.set_nonblocking(true).unwrap();
    let state = Mock {
        polls: polls.clone(),
        port: Arc::new(AtomicUsize::new(port as usize)),
    };
    let app = Router::new()
        .route("/tasks", post(submit))
        .route("/tasks/{id}", get(poll))
        .route("/tasks/{id}/file", get(file_url))
        .route("/download", get(download))
        .with_state(state);
    runtime.spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        let _ = axum::serve(listener, app).await;
    });

    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let example = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugin-async-video");
    install(&host, &example);

    let network = aicut_daemon::network::NetworkRuntime::load(None);
    service::start(&host, &network, "@aicut/plugin-async-video").unwrap();

    let input = format!(
        r#"{{"base":"http://127.0.0.1:{port}","key":"sk_test","prompt":"一只猫在草地上奔跑","image":""}}"#
    );
    let output = service::invoke("@aicut/plugin-async-video", &input).unwrap();

    let path = std::path::Path::new(&output);
    assert!(path.is_file(), "产物不存在：{output}");
    assert_eq!(std::fs::read(path).unwrap(), MP4);
    assert!(polls.load(Ordering::SeqCst) >= 2);

    // 缺少基址：宿主半原地报错，不落产物。
    let error = service::invoke("@aicut/plugin-async-video", r#"{"base":"","key":"x","prompt":"y"}"#)
        .unwrap_err();
    assert!(error.contains("接口基址"), "{}", error);

    service::stop("@aicut/plugin-async-video");
}

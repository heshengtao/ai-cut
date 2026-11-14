//! HTTP 服务：RPC + 静态托管。桌面壳内嵌与 `aicutd` 共用。

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tower_http::services::ServeDir;

use crate::rpc::RpcCtx;

/// 启动参数。
pub struct ServerConfig {
    pub bind: IpAddr,
    /// 0 表示让系统分配（测试用）。
    pub port: u16,
    /// 前端构建产物目录；`None` 表示只提供 RPC（开发时前端跑在 Vite）。
    pub dist: Option<PathBuf>,
}

/// 启动结果。
pub struct RunningServer {
    pub addr: SocketAddr,
}

/// 起服务；`shutdown` 触发后停止接收新连接。
pub async fn serve(
    ctx: Arc<RpcCtx>,
    cfg: ServerConfig,
    shutdown: CancellationToken,
) -> Result<RunningServer, String> {
    let mut app = Router::new()
        .route("/health", get(crate::rpc::health))
        .route("/events", get(crate::rpc::events))
        .route("/session", get(crate::rpc::session_ws))
        .route("/file", get(crate::rpc::file))
        .route("/upload", post(crate::rpc::upload))
        .route("/rpc/{cmd}", post(crate::rpc::handle));
    if let Some(dist) = cfg.dist {
        app = app.fallback_service(ServeDir::new(dist).append_index_html_on_directories(true));
    }
    // 打开界面就种一个会话 cookie：地址栏不必带 token（脚本仍可用 Bearer）。
    let session_ctx = Arc::clone(&ctx);
    let app = app
        .layer(axum::middleware::from_fn_with_state(
            session_ctx,
            issue_session_cookie,
        ))
        .with_state(ctx);

    let listener = TcpListener::bind(SocketAddr::new(cfg.bind, cfg.port))
        .await
        .map_err(|e| format!("绑定 {}:{} 失败：{e}", cfg.bind, cfg.port))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("取监听地址失败：{e}"))?;

    tokio::spawn(async move {
        let service = axum::serve(listener, app).with_graceful_shutdown(async move {
            shutdown.cancelled().await;
        });
        if let Err(error) = service.await {
            eprintln!("[daemon] HTTP 服务退出：{error}");
        }
    });

    Ok(RunningServer { addr })
}

/// 读或生成访问 token（`<data>/web-token`，只对本机用户可读）。
pub fn load_or_create_token(data_dir: &std::path::Path) -> Result<String, String> {
    let path = data_dir.join("web-token");
    if let Ok(text) = std::fs::read_to_string(&path) {
        let token = text.trim();
        if token.len() >= 32 && token.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(token.to_string());
        }
    }
    std::fs::create_dir_all(data_dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    // 两段 uuid v4 拼 256 bit；hex 便于放进 URL / 二维码。
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    std::fs::write(&path, &token).map_err(|e| format!("写入 web-token 失败：{e}"))?;
    Ok(token)
}

/// 页面加载时发一个会话 cookie。
///
/// **只对非 API 路径发**：否则任何能连上的机器随便 POST 一次 `/rpc` 就能自签一个会话，
/// 鉴权等于没有。
async fn issue_session_cookie(
    State(ctx): State<Arc<RpcCtx>>,
    req: Request,
    next: Next,
) -> Response {
    const API_PREFIXES: [&str; 6] = ["/rpc", "/events", "/session", "/file", "/upload", "/health"];
    let path = req.uri().path().to_string();
    let headers = req.headers().clone();
    let is_api = API_PREFIXES.iter().any(|prefix| path.starts_with(prefix));

    let mut response = next.run(req).await;

    if !is_api {
        if let Some(session) = crate::rpc::issue_session(&ctx, &headers) {
            let cookie = format!(
                "{}={session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000",
                crate::rpc::SESSION_COOKIE
            );
            if let Ok(value) = cookie.parse() {
                response.headers_mut().insert(axum::http::header::SET_COOKIE, value);
            }
        }
    }
    response
}

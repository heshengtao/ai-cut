//! HTTP RPC：前端 `Channel` 的 http 实现打到这里。
//!
//! 约定与 Tauri 的 `invoke` 一致：`POST /rpc/<command>`，body 是参数对象，
//! 成功返回命令结果本身，失败返回 500 + `{"error": "..."}`。

use std::sync::Arc;

use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::TryStreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::host::Host;
use crate::media;
use crate::project;

/// RPC 运行上下文。
pub struct RpcCtx {
    pub host: Arc<dyn Host>,
    pub token: String,
    pub version: &'static str,
    pub export: Arc<crate::export::ExportState>,
    pub session: Arc<crate::session::Session>,
    pub doc: crate::DocHandle,
}

#[derive(Deserialize)]
pub struct AuthQuery {
    pub token: Option<String>,
}

/// **不鉴权**：无头版本给没有显示器的机器用，打开端口就是界面。
///
/// 访问控制交给部署侧（局域网 / 容器网络 / 反向代理）。要对外暴露就自己加一层网关。
pub fn authorized(_ctx: &RpcCtx, _query: &AuthQuery, _headers: &HeaderMap) -> bool {
    true
}

/// 逐字节比较，长度不同也走满循环，避免用时间差猜 token。
fn constant_time_eq(left: &str, right: &str) -> bool {
    let (a, b) = (left.as_bytes(), right.as_bytes());
    let mut diff = (a.len() ^ b.len()) as u8;
    let len = a.len().max(b.len());
    for i in 0..len {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        diff |= x ^ y;
    }
    diff == 0
}

fn rpc_error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

/// `POST /rpc/:cmd`
pub async fn handle(
    State(ctx): State<Arc<RpcCtx>>,
    Path(command): Path<String>,
    Query(query): Query<AuthQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&ctx, &query, &headers) {
        return rpc_error(StatusCode::UNAUTHORIZED, "token 无效");
    }
    let args = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice::<Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                return rpc_error(
                    StatusCode::BAD_REQUEST,
                    format!("请求体不是合法 JSON：{error}"),
                )
            }
        }
    };
    match dispatch(&ctx, &command, args).await {
        Ok(value) => (StatusCode::OK, Json(value)).into_response(),
        Err(error) => rpc_error(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

/// `GET /health`（不需要 token：容器探活用）。
pub async fn health(State(ctx): State<Arc<RpcCtx>>) -> Response {
    let host = ctx.host.as_ref();
    Json(json!({
        "ok": true,
        "version": ctx.version,
        "dataDir": host.data_dir().to_string_lossy(),
        "configDir": host.config_dir().to_string_lossy(),
        "nativeUi": host.has_ui(),
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArgs {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetPathArgs {
    path: String,
    asset_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailArgs {
    path: String,
    asset_id: String,
    at_sec: f64,
}

#[derive(Deserialize)]
struct WriteArgs {
    path: String,
    json: String,
}

#[derive(Deserialize)]
struct CopyArgs {
    dir: String,
    files: Vec<String>,
}

#[derive(Deserialize)]
struct NameArgs {
    name: String,
}

#[derive(Deserialize)]
struct ExportArgs {
    job: crate::export::ExportJob,
}

#[derive(Deserialize)]
struct DocApplyArgs {
    command: String,
}

#[derive(Deserialize)]
struct DocLoadArgs {
    json: String,
}

#[derive(Deserialize)]
struct DocViewArgs {
    method: String,
    #[serde(default)]
    args: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionDocArgs {
    project: String,
    revision: u64,
    #[serde(default)]
    origin: String,
    #[serde(default)]
    affected: Value,
    #[serde(default)]
    full: bool,
    #[serde(default)]
    dirty: bool,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Deserialize)]
struct PlayheadArgs {
    time: f64,
    #[serde(default)]
    playing: bool,
}

#[derive(Deserialize)]
struct TextImageArgs {
    name: String,
    base64: String,
}

/// `GET /file?path=…`：Range 读取任意被工程引用的文件（token 即授权）。
#[derive(Deserialize)]
pub struct FileQuery {
    pub path: String,
    pub token: Option<String>,
}

/// `POST /upload?name=…`：浏览器导入本地文件，流式落到 `<data>/imports/`。
#[derive(Deserialize)]
pub struct UploadQuery {
    pub name: String,
    pub token: Option<String>,
}

fn from_value<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("参数不合法：{e}"))
}

/// 命令分发：名字与 Tauri 命令保持一致，前端 `Channel` 只换传输不换语义。
pub async fn dispatch(ctx: &RpcCtx, command: &str, args: Value) -> Result<Value, String> {
    let host = ctx.host.as_ref();
    match command {
        "ping" => Ok(json!("pong")),
        "media_cache_dir" => Ok(json!(media::media_cache_dir(host)?)),
        // 无头 / 浏览器端没有本机字体库：给空清单，文字按内置回退栈渲染。
        "font_registry" | "font_list" => Ok(json!([])),
        "font_probe" => Ok(json!(null)),
        "probe_media" => {
            let args: PathArgs = from_value(args)?;
            Ok(json!(media::probe_media(host, args.path).await?))
        }
        "file_stamp" => {
            let args: PathArgs = from_value(args)?;
            Ok(json!(media::file_stamp(args.path)))
        }
        "make_thumbnail" => {
            let args: ThumbnailArgs = from_value(args)?;
            Ok(json!(
                media::make_thumbnail(host, args.path, args.asset_id, args.at_sec).await?
            ))
        }
        "make_waveform" => {
            let args: AssetPathArgs = from_value(args)?;
            Ok(json!(
                media::make_waveform(host, args.path, args.asset_id).await?
            ))
        }
        "extract_audio_preview" => {
            let args: AssetPathArgs = from_value(args)?;
            Ok(json!(
                media::extract_audio_preview(host, args.path, args.asset_id).await?
            ))
        }
        "make_video_preview" => {
            let args: AssetPathArgs = from_value(args)?;
            Ok(json!(
                media::make_video_preview(host, args.path, args.asset_id).await?
            ))
        }
        "copy_media_files" => {
            let args: CopyArgs = from_value(args)?;
            Ok(json!(media::copy_media_files(args.dir, args.files)?))
        }
        "read_project" => {
            let args: PathArgs = from_value(args)?;
            Ok(json!(project::read_project(&args.path)?))
        }
        "write_project" => {
            let args: WriteArgs = from_value(args)?;
            project::write_project(&args.path, &args.json)?;
            Ok(Value::Null)
        }
        "path_exists" => {
            let args: PathArgs = from_value(args)?;
            Ok(json!(project::path_exists(&args.path)))
        }
        "export_video" => {
            let args: ExportArgs = from_value(args)?;
            crate::export::export_video(host, ctx.export.as_ref(), args.job).await?;
            Ok(Value::Null)
        }
        "cancel_export" => {
            crate::export::cancel(ctx.export.as_ref())?;
            Ok(Value::Null)
        }
        "write_export_text_image" => {
            let args: TextImageArgs = from_value(args)?;
            Ok(json!(crate::export::write_export_text_image(
                host,
                &args.name,
                &args.base64
            )?))
        }
        "doc_open" => {
            let args: PathArgs = from_value(args)?;
            let json = project::read_project(&args.path)?;
            let result = ctx.doc.load(json).await?;
            publish_session_doc(ctx).await;
            Ok(json!(result))
        }
        "doc_load" => {
            let args: DocLoadArgs = from_value(args)?;
            let result = ctx.doc.load(args.json).await?;
            publish_session_doc(ctx).await;
            Ok(json!(result))
        }
        "doc_apply" => {
            let args: DocApplyArgs = from_value(args)?;
            let result = ctx.doc.apply(args.command).await?;
            publish_session_doc(ctx).await;
            Ok(json!(result))
        }
        "doc_snapshot" => Ok(json!(ctx.doc.snapshot().await?)),
        "doc_save" => {
            let args: PathArgs = from_value(args)?;
            let snapshot = ctx.doc.snapshot().await?;
            project::write_project(&args.path, &snapshot)?;
            Ok(Value::Null)
        }
        "doc_view" => {
            let args: DocViewArgs = from_value(args)?;
            let args_json = serde_json::to_string(&args.args).unwrap_or_else(|_| "{}".into());
            Ok(json!(ctx.doc.view(args.method, args_json).await?))
        }
        "session_publish" => {
            let args: SessionDocArgs = from_value(args)?;
            ctx.session.publish_doc(
                args.project,
                args.revision,
                args.origin,
                args.affected,
                args.full,
                args.dirty,
                args.path,
            );
            Ok(Value::Null)
        }
        "session_playhead" => {
            let args: PlayheadArgs = from_value(args)?;
            ctx.session.publish_playhead(args.time, args.playing);
            Ok(Value::Null)
        }
        "session_state" => Ok(json!({
            "hasDoc": ctx.session.has_doc(),
            "updatedAt": ctx.session.updated_at(),
        })),
        "new_project_path" => {
            let args: NameArgs = from_value(args)?;
            let path = project::new_project_path(host.data_dir(), &args.name)?;
            Ok(json!(path.to_string_lossy()))
        }
        "new_export_path" => {
            let args: NameArgs = from_value(args)?;
            let path = project::new_file_path(host.data_dir(), "exports", &args.name)?;
            Ok(json!(path.to_string_lossy()))
        }
        other => Err(format!("未知命令：{other}")),
    }
}

/// `GET /events`：SSE。当前只保持连接（进度广播在 M3 接上）。
pub async fn events(
    State(ctx): State<Arc<RpcCtx>>,
    Query(query): Query<AuthQuery>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&ctx, &query, &headers) {
        return rpc_error(StatusCode::UNAUTHORIZED, "token 无效");
    }
    let receiver = crate::events::subscribe();
    let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    let message = Event::default().event(event.name).data(event.data);
                    return Some((Ok::<_, std::convert::Infallible>(message), receiver));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return None,
            }
        }
    });
    Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response()
}

/// `GET /file?path=…`：带 Range 的文件读取（`<video>` 拖动进度条靠它）。
pub async fn file(
    State(ctx): State<Arc<RpcCtx>>,
    Query(query): Query<FileQuery>,
    headers: HeaderMap,
) -> Response {
    if !authorized(
        &ctx,
        &AuthQuery {
            token: query.token.clone(),
        },
        &headers,
    ) {
        return rpc_error(StatusCode::UNAUTHORIZED, "token 无效");
    }
    let path = std::path::PathBuf::from(&query.path);
    if !path.is_absolute() || !path.is_file() {
        return rpc_error(StatusCode::NOT_FOUND, "文件不存在");
    }
    let mut builder = axum::http::Request::builder().uri("/");
    for (key, value) in headers.iter() {
        if key == axum::http::header::HOST || key == axum::http::header::AUTHORIZATION {
            continue;
        }
        builder = builder.header(key, value);
    }
    let request = match builder.body(Body::empty()) {
        Ok(request) => request,
        Err(error) => return rpc_error(StatusCode::BAD_REQUEST, error.to_string()),
    };
    match tower_http::services::ServeFile::new(&path)
        .oneshot(request)
        .await
    {
        Ok(response) => response.map(Body::new).into_response(),
        Err(error) => rpc_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

/// `POST /upload?name=…`：把请求体流式写入 `<data>/imports/`，返回服务端路径。
pub async fn upload(
    State(ctx): State<Arc<RpcCtx>>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    if !authorized(
        &ctx,
        &AuthQuery {
            token: query.token.clone(),
        },
        &headers,
    ) {
        return rpc_error(StatusCode::UNAUTHORIZED, "token 无效");
    }
    let dir = ctx.host.data_dir().join("imports");
    if let Err(error) = std::fs::create_dir_all(&dir) {
        return rpc_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("创建导入目录失败：{error}"),
        );
    }
    let name = project::safe_file_name(&query.name);
    let path = project::unique_path(&dir, &name);

    let stream = body
        .into_data_stream()
        .map_err(|error| std::io::Error::other(error.to_string()));
    let mut reader = tokio_util::io::StreamReader::new(stream);
    let mut file = match tokio::fs::File::create(&path).await {
        Ok(file) => file,
        Err(error) => {
            return rpc_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("创建文件失败：{error}"),
            )
        }
    };
    match tokio::io::copy(&mut reader, &mut file).await {
        Ok(bytes) => Json(json!({
            "path": path.to_string_lossy(),
            "bytes": bytes,
        }))
        .into_response(),
        Err(error) => {
            let _ = tokio::fs::remove_file(&path).await;
            rpc_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("写入失败：{error}"),
            )
        }
    }
}

/// `GET /session`（WebSocket）：只读跟随桌面会话（文档快照 + 播放头）。
pub async fn session_ws(
    State(ctx): State<Arc<RpcCtx>>,
    Query(query): Query<AuthQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&ctx, &query, &headers) {
        return rpc_error(StatusCode::UNAUTHORIZED, "token 无效");
    }
    ws.on_upgrade(move |socket| session_loop(socket, ctx))
}

async fn session_loop(mut socket: WebSocket, ctx: Arc<RpcCtx>) {
    let (project, revision, time, playing, dirty, path) = ctx.session.snapshot();
    let hello = json!({
        "t": "hello",
        "project": project,
        "revision": revision,
        "time": time,
        "playing": playing,
        "dirty": dirty,
        "full": true,
        "path": path,
    });
    if socket
        .send(Message::Text(hello.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    let mut receiver = ctx.session.subscribe();
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            match value.get("t").and_then(|t| t.as_str()) {
                                Some("ping") => {
                                    let pong = json!({ "t": "pong", "at": value.get("at") });
                                    if socket.send(Message::Text(pong.to_string().into())).await.is_err() {
                                        break;
                                    }
                                }
                                Some("close") => break,
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = receiver.recv() => {
                match event {
                    Ok(message) => {
                        if socket.send(Message::Text(message.to_json().to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // 落后了：直接补一份最新快照，不做事件回放。
                        let (project, revision, time, playing, dirty, path) = ctx.session.snapshot();
                        let resync = json!({
                            "t": "hello",
                            "project": project,
                            "revision": revision,
                            "time": time,
                            "playing": playing,
                            "dirty": dirty,
                            "full": true,
                            "path": path,
                        });
                        if socket.send(Message::Text(resync.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    }
}

/// 引擎执行完命令后，把最新快照推给会话镜像（无头时浏览器视图也能实时看到）。
async fn publish_session_doc(ctx: &RpcCtx) {
    let Ok(snapshot) = ctx.doc.snapshot().await else {
        return;
    };
    let revision = ctx.doc.revision().await.unwrap_or(0);
    // 无头引擎自己的写操作：不知道具体受影响对象，按整份文档同步。
    ctx.session.publish_doc(
        snapshot,
        revision,
        "server".into(),
        Value::Null,
        true,
        true,
        None,
    );
}

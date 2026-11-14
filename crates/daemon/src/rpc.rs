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
    /// 网络配置（代理 / 模型源 / 插件注册表 / HF token）。
    /// 桌面壳传进来的就是它自己 `app.manage` 的那一份实例，读写同一份配置。
    pub network: Arc<crate::network::NetworkRuntime>,
    /// 云端 TTS 服务配置（provider 列表）。
    pub cloud_tts: Arc<crate::cloud_tts::CloudTtsRuntime>,
    /// 云端出图 / 出视频的服务配置。
    pub cloud_gen: Arc<crate::cloud_gen::CloudGenRuntime>,
    /// 无模型视频处理的运行状态（互斥 + 取消）。
    pub video_dsp: Arc<crate::video_dsp::VideoDspState>,
    /// 剪辑智能体（配置 / 会话 / 运行态）。工具调用走 `agent_tools` → `agent_bridge`。
    pub agent: Arc<crate::agent::AgentState>,
    /// MCP 服务器（谁在管由壳决定：桌面壳是自己那份全量工具面，无头是 daemon 这份）。
    pub mcp: Arc<dyn crate::mcp::McpControl>,
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
struct HistoryRecordArgs {
    /// 工程 JSON 文本（与桌面端 `project_history_record` 同参）。
    project: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    dirty: bool,
    #[serde(default)]
    thumbnail: Option<String>,
}

#[derive(Deserialize)]
struct IdArgs {
    id: String,
}

#[derive(Deserialize)]
struct OptionalIdArgs {
    #[serde(default)]
    id: Option<String>,
}

#[derive(Deserialize)]
struct OptionalForceArgs {
    #[serde(default)]
    force: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfxProbeArgs {
    bundle: String,
    #[serde(default)]
    plugin: Option<String>,
    #[serde(default)]
    context: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfxRenderFrameArgs {
    bundle: String,
    plugin: String,
    #[serde(default)]
    context: Option<String>,
    width: u32,
    height: u32,
    #[serde(default)]
    time: f64,
    rgba_base64: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfxRenderPreviewArgs {
    source: String,
    #[serde(default)]
    source_time: f64,
    #[serde(default)]
    time: f64,
    width: u32,
    height: u32,
    #[serde(default)]
    is_image: bool,
    #[serde(default)]
    fit: Option<String>,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    retimer_source_time: Option<f64>,
    #[serde(default)]
    effects: Vec<crate::ofx::OfxEffectSpec>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfxSourceTimeArgs {
    bundle: String,
    plugin: String,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    time: f64,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
struct OfxRenderTransitionArgs {
    bundle: String,
    plugin: String,
    #[serde(default)]
    context: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    from: Option<crate::ofx::OfxTransitionSource>,
    #[serde(default)]
    to: Option<crate::ofx::OfxTransitionSource>,
    #[serde(default)]
    timeline_time: f64,
    #[serde(default)]
    progress: f64,
    #[serde(default)]
    duration: f64,
    width: u32,
    height: u32,
    #[serde(default)]
    fps: Option<f64>,
    #[serde(default)]
    fit: Option<String>,
}

#[derive(Deserialize)]
struct OfxBakeImageArgs {
    request: crate::ofx::OfxBakeImageRequest,
}

#[derive(Deserialize)]
struct OfxBakeArgs {
    request: crate::ofx::OfxBakeRequest,
}

#[derive(Deserialize)]
struct OfxBakeTransitionArgs {
    request: crate::ofx::OfxBakeTransitionRequest,
}

#[derive(Deserialize)]
struct SlugArgs {
    slug: String,
}

#[derive(Deserialize)]
struct McpConfigArgs {
    enabled: bool,
    port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AsrArgs {
    path: String,
    model_id: String,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TtsSynthArgs {
    model_id: String,
    #[serde(default)]
    items: Vec<crate::tts::TtsItem>,
    #[serde(default)]
    voice: Option<String>,
    #[serde(default)]
    reference_path: Option<String>,
    #[serde(default)]
    reference_text: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelIdArgs {
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoUpscaleArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    fps: f64,
    model_id: String,
    #[serde(default)]
    scale: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoImageArgs {
    path: String,
    model_id: String,
    #[serde(default)]
    scale: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoInterpolateArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    fps: f64,
    model_id: String,
    #[serde(default)]
    factor: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoReframeArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    fps: f64,
    #[serde(default)]
    yolo_model_id: Option<String>,
    #[serde(default)]
    yunet_model_id: Option<String>,
    #[serde(default)]
    subject: String,
    #[serde(default)]
    aspect: String,
    #[serde(default)]
    height: u32,
    #[serde(default = "default_smooth")]
    smooth: f32,
}

fn default_smooth() -> f32 {
    0.5
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoSamplesArgs {
    path: String,
    #[serde(default)]
    interval: f64,
    #[serde(default = "default_samples")]
    max_samples: usize,
    #[serde(default)]
    subject: String,
}

fn default_samples() -> usize {
    60
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceConvertArgs {
    #[serde(default)]
    clips: Vec<crate::voice_change::VcClip>,
    voice_id: String,
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceImportArgs {
    asset_path: String,
    name: String,
    #[serde(default)]
    start: Option<f64>,
    #[serde(default)]
    duration: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioTaskArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioDspArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    effect: String,
    preset: String,
}

#[derive(Deserialize)]
struct TranslateArgs {
    texts: Vec<String>,
    target: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoDspArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    fps: f64,
    #[serde(default)]
    options: crate::video_dsp::VideoDspOptions,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoudnessArgs {
    path: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    duration: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfigArgs {
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentModelArgs {
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSetHeadArgs {
    id: String,
    node_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSendArgs {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeArgs {
    method: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInstallArgs {
    id: String,
    #[serde(default)]
    force: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenProvidersArgs {
    #[serde(default)]
    providers: Vec<crate::cloud_gen::CloudGenProvider>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenProviderArgs {
    provider: crate::cloud_gen::CloudGenProvider,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenImageArgs {
    request: crate::cloud_gen::CloudImageRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenVideoArgs {
    request: crate::cloud_gen::CloudVideoRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvidersArgs {
    #[serde(default)]
    providers: Vec<crate::cloud_tts::CloudTtsProvider>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderArgs {
    provider: crate::cloud_tts::CloudTtsProvider,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudTtsTestArgs {
    provider: crate::cloud_tts::CloudTtsProvider,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudTtsSynthArgs {
    provider_id: String,
    #[serde(default)]
    items: Vec<crate::tts_core::TtsItem>,
    #[serde(default)]
    voice: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenArgs {
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkSetArgs {
    proxy_mode: crate::network::ProxyMode,
    #[serde(default)]
    proxy_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSourceArgs {
    preference: crate::network::ModelSourcePreference,
    #[serde(default)]
    mirrors: Vec<String>,
    #[serde(default)]
    download_prefix: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryArgs {
    #[serde(default)]
    url: String,
    #[serde(default)]
    mirrors: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkProbeArgs {
    proxy_mode: crate::network::ProxyMode,
    #[serde(default)]
    proxy_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontInstallArgs {
    id: String,
    #[serde(default)]
    weights: Vec<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontImportArgs {
    path: String,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    weight: Option<u16>,
    #[serde(default)]
    style: Option<String>,
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

/// `ai_set_backend` 的参数（与桌面命令同名同形）。
#[derive(Deserialize)]
struct BackendArgs {
    preference: crate::ai_backend::BackendPreference,
}

/// `asr_*` 把宿主按 `Arc` 拿走（要在阻塞线程里继续用），这里做一次浅拷贝。
fn host_arc(ctx: &RpcCtx) -> &std::sync::Arc<dyn Host> {
    &ctx.host
}

fn from_value<T: for<'de> Deserialize<'de>>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("参数不合法：{e}"))
}

/// 命令分发：名字与 Tauri 命令保持一致，前端 `Channel` 只换传输不换语义。
pub async fn dispatch(ctx: &RpcCtx, command: &str, args: Value) -> Result<Value, String> {
    let host = ctx.host.as_ref();
    match command {
        "ping" => Ok(json!("pong")),
        // ---- ONNX Runtime 可加载性探针（镜像验证用） ----
        "ai_ort_probe" => Ok(json!(crate::ort_probe::probe(host))),
        // ---- 执行后端（CPU / CoreML / DirectML / CUDA 12·13）----
        "ai_backend_info" => Ok(json!(crate::ai_session::ai_backend_info(
            host,
            &ctx.network
        ))),
        "ai_set_backend" => {
            let args: BackendArgs = from_value(args)?;
            Ok(json!(crate::ai_session::ai_set_backend(
                host,
                &ctx.network,
                args.preference
            )?))
        }
        // ---- ONNX Runtime 运行库（与桌面共用 `aicut_daemon::runtime_ort`） ----
        "runtime_catalog" => Ok(json!(crate::runtime_ort::runtime_catalog(host))),
        "runtime_install" => {
            let args: RuntimeInstallArgs = from_value(args)?;
            crate::runtime_ort::runtime_install(host, &ctx.network, args.id, args.force).await?;
            Ok(Value::Null)
        }
        "runtime_remove" => {
            let args: IdArgs = from_value(args)?;
            crate::runtime_ort::runtime_remove(host, args.id)?;
            Ok(Value::Null)
        }
        "runtime_cancel" => {
            crate::runtime_ort::runtime_cancel();
            Ok(Value::Null)
        }
        "runtime_busy" => Ok(json!(crate::runtime_ort::runtime_busy())),
        "runtime_reveal" => Err("在文件管理器中显示运行库需要桌面应用".to_string()),
        "app_restart" => Err("重启应用需要桌面应用；容器里请重启容器".to_string()),
        // ---- 模型清单 / 下载 / 探测（与桌面共用 `aicut_daemon::models`） ----
        "model_catalog" => Ok(json!(crate::models::model_catalog(host))),
        "model_download" => {
            let args: IdArgs = from_value(args)?;
            Ok(json!(
                crate::models::model_download(host, &ctx.network, args.id).await?
            ))
        }
        "model_probe" => {
            let args: IdArgs = from_value(args)?;
            Ok(json!(
                crate::models::model_probe(host, &ctx.network, args.id).await?
            ))
        }
        "model_cancel" => {
            crate::models::model_cancel();
            Ok(Value::Null)
        }
        "model_remove" => {
            let args: IdArgs = from_value(args)?;
            crate::models::model_remove(host, args.id)?;
            Ok(Value::Null)
        }
        "model_reveal" => Err("在文件管理器中显示模型需要桌面应用".to_string()),
        // ---- 无模型视频处理（滤镜链 + 一次 ffmpeg 转码） ----
        "video_dsp_process" => {
            let args: VideoDspArgs = from_value(args)?;
            Ok(json!(
                crate::video_dsp::video_dsp_process(
                    host,
                    &ctx.video_dsp,
                    args.path,
                    args.start,
                    args.duration,
                    args.fps,
                    args.options,
                )
                .await?
            ))
        }
        "video_dsp_cancel" => {
            crate::video_dsp::video_dsp_cancel(&ctx.video_dsp)?;
            Ok(Value::Null)
        }
        "video_dsp_busy" => Ok(json!(crate::video_dsp::video_dsp_busy(&ctx.video_dsp))),
        // ---- 响度测量（纯 ffmpeg + ebur128，无模型） ----
        "audio_measure_loudness" => {
            let args: LoudnessArgs = from_value(args)?;
            Ok(json!(
                crate::audio_analysis::audio_measure_loudness(
                    host,
                    args.path,
                    args.start,
                    args.duration
                )
                .await?
            ))
        }
        // ---- 音频 AI（LocalVQE 降噪 / HTDemucs 分离）与无模型 DSP ----
        "audio_ai_denoise" => {
            let args: AudioTaskArgs = from_value(args)?;
            Ok(json!(
                crate::audio_ai::audio_ai_denoise(
                    &ctx.host,
                    args.path,
                    args.start,
                    args.duration,
                    args.model_id
                )
                .await?
            ))
        }
        "audio_ai_separate" => {
            let args: AudioTaskArgs = from_value(args)?;
            Ok(json!(
                crate::audio_ai::audio_ai_separate(
                    &ctx.host,
                    args.path,
                    args.start,
                    args.duration,
                    args.model_id
                )
                .await?
            ))
        }
        "audio_ai_cancel" => {
            crate::audio_ai::audio_ai_cancel();
            Ok(Value::Null)
        }
        "audio_dsp_process" => {
            let args: AudioDspArgs = from_value(args)?;
            Ok(json!(
                crate::audio_ai::audio_dsp_process(
                    &ctx.host,
                    args.path,
                    args.start,
                    args.duration,
                    args.effect,
                    args.preset
                )
                .await?
            ))
        }
        "audio_extract_reference" => {
            let args: LoudnessArgs = from_value(args)?;
            Ok(json!(
                crate::audio_ai::audio_extract_reference(
                    host,
                    args.path,
                    args.start,
                    args.duration
                )
                .await?
            ))
        }
        "translate_text" => {
            let args: TranslateArgs = from_value(args)?;
            Ok(json!(
                crate::audio_ai::translate_text(
                    &ctx.network,
                    {
                        let config = ctx.agent.config();
                        crate::audio_ai::TranslateEndpoint {
                            base_url: config.base_url,
                            api_key: config.api_key,
                            model: config.model,
                        }
                    },
                    args.texts,
                    args.target
                )
                .await?
            ))
        }
        // ---- 语音识别（一键字幕 / 剪口播） ----
        "asr_transcribe" => {
            let args: AsrArgs = from_value(args)?;
            Ok(json!(
                crate::asr::asr_transcribe(host_arc(&ctx), args.path, args.model_id, args.language)
                    .await?
            ))
        }
        "asr_transcribe_words" => {
            let args: AsrArgs = from_value(args)?;
            Ok(json!(
                crate::asr::asr_transcribe_words(
                    host_arc(&ctx),
                    args.path,
                    args.model_id,
                    args.language
                )
                .await?
            ))
        }
        "asr_cancel" => {
            crate::asr::asr_cancel();
            Ok(Value::Null)
        }
        // ---- AI 朗读（MOSS-TTS-Nano / ZipVoice） ----
        "tts_voices" => {
            let args: ModelIdArgs = from_value(args)?;
            Ok(json!(crate::tts::tts_voices(host, args.model_id)?))
        }
        "tts_synthesize" => {
            let args: TtsSynthArgs = from_value(args)?;
            Ok(json!(
                crate::tts::tts_synthesize(
                    &ctx.host,
                    args.model_id,
                    args.items,
                    args.voice,
                    args.reference_path,
                    args.reference_text
                )
                .await?
            ))
        }
        "tts_cancel" => {
            crate::tts::tts_cancel();
            Ok(Value::Null)
        }
        // ---- 视频 AI（超分 / 补帧 / 智能裁剪 / 采样） ----
        "video_ai_upscale" => {
            let args: VideoUpscaleArgs = from_value(args)?;
            Ok(json!(
                crate::video_ai::video_ai_upscale(
                    &ctx.host,
                    args.path,
                    args.start,
                    args.duration,
                    args.fps,
                    args.model_id,
                    args.scale
                )
                .await?
            ))
        }
        "video_ai_upscale_image" => {
            let args: VideoImageArgs = from_value(args)?;
            Ok(json!(
                crate::video_ai::video_ai_upscale_image(
                    &ctx.host,
                    args.path,
                    args.model_id,
                    args.scale
                )
                .await?
            ))
        }
        "video_ai_interpolate" => {
            let args: VideoInterpolateArgs = from_value(args)?;
            Ok(json!(
                crate::video_ai::video_ai_interpolate(
                    &ctx.host,
                    args.path,
                    args.start,
                    args.duration,
                    args.fps,
                    args.model_id,
                    args.factor
                )
                .await?
            ))
        }
        "video_ai_reframe" => {
            let args: VideoReframeArgs = from_value(args)?;
            Ok(json!(
                crate::video_ai::video_ai_reframe(
                    &ctx.host,
                    args.path,
                    args.start,
                    args.duration,
                    args.fps,
                    args.yolo_model_id,
                    args.yunet_model_id,
                    args.subject,
                    args.aspect,
                    args.height,
                    args.smooth
                )
                .await?
            ))
        }
        "video_ai_samples" => {
            let args: VideoSamplesArgs = from_value(args)?;
            Ok(json!(
                crate::video_ai::video_ai_samples(
                    &ctx.host,
                    args.path,
                    args.interval,
                    args.max_samples,
                    args.subject
                )
                .await?
            ))
        }
        "video_ai_cancel" => {
            crate::video_ai::video_ai_cancel();
            Ok(Value::Null)
        }
        // ---- 离线 AI 变声 ----
        "voice_change_convert" => {
            let args: VoiceConvertArgs = from_value(args)?;
            Ok(json!(
                crate::voice_change::voice_change_convert(
                    &ctx.host,
                    args.clips,
                    args.voice_id,
                    args.model_id
                )
                .await?
            ))
        }
        "voice_change_cancel" => {
            crate::voice_change::voice_change_cancel();
            Ok(Value::Null)
        }
        "voice_change_voice_list" => Ok(json!(
            crate::voice_change::voice_change_voice_list(host)?
        )),
        "voice_change_voice_import" => {
            let args: VoiceImportArgs = from_value(args)?;
            Ok(json!(
                crate::voice_change::voice_change_voice_import(
                    &ctx.host,
                    args.asset_path,
                    args.name,
                    args.start,
                    args.duration
                )
                .await?
            ))
        }
        // ---- OFX 效果：探测 / 单帧预览 / 图片烘焙 / 转场预览 ----
        "ofx_probe" => {
            let args: OfxProbeArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_probe(args.bundle, args.plugin, args.context).await?
            ))
        }
        "ofx_render_frame" => {
            let args: OfxRenderFrameArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_render_frame(
                    args.bundle,
                    args.plugin,
                    args.context,
                    args.width,
                    args.height,
                    args.time,
                    args.rgba_base64,
                    args.params,
                )
                .await?
            ))
        }
        "ofx_render_preview" => {
            let args: OfxRenderPreviewArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_render_preview(
                    &ctx.host,
                    args.source,
                    args.source_time,
                    args.time,
                    args.width,
                    args.height,
                    args.is_image,
                    args.fit,
                    args.fps,
                    args.duration,
                    args.retimer_source_time,
                    args.effects,
                )
                .await?
            ))
        }
        "ofx_source_time" => {
            let args: OfxSourceTimeArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_source_time(
                    args.bundle,
                    args.plugin,
                    args.context,
                    args.time,
                    args.duration,
                    args.fps,
                    args.width,
                    args.height,
                    args.params,
                )
                .await?
            ))
        }
        "ofx_render_transition" => {
            let args: OfxRenderTransitionArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_render_transition(
                    &ctx.host,
                    args.bundle,
                    args.plugin,
                    args.context,
                    args.params,
                    args.from,
                    args.to,
                    args.timeline_time,
                    args.progress,
                    args.duration,
                    args.width,
                    args.height,
                    args.fps,
                    args.fit,
                )
                .await?
            ))
        }
        "ofx_bake_image" => {
            let args: OfxBakeImageArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_bake_image(&ctx.host, args.request).await?
            ))
        }
        "ofx_bake_clip" => {
            let args: OfxBakeArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_bake_clip(&ctx.host, args.request).await?
            ))
        }
        "ofx_bake_transition" => {
            let args: OfxBakeTransitionArgs = from_value(args)?;
            Ok(json!(
                crate::ofx::ofx_bake_transition(&ctx.host, args.request).await?
            ))
        }
        "ofx_cancel_bake" => {
            let args: OptionalIdArgs = from_value(args)?;
            crate::ofx::ofx_cancel_bake(args.id);
            Ok(Value::Null)
        }
        // ---- OFX 插件管理（注册表 / 安装 / 导入 / 删除）----
        "plugin_registry" => {
            let args: OptionalForceArgs = from_value(args)?;
            Ok(json!(
                crate::plugins::plugin_registry(
                    &ctx.host,
                    &ctx.network,
                    args.force.unwrap_or(false)
                )
                .await?
            ))
        }
        "plugin_installed" => Ok(json!(crate::plugins::plugin_installed(&ctx.host)?)),
        "plugin_install" => {
            let args: SlugArgs = from_value(args)?;
            crate::plugins::plugin_install(&ctx.host, &ctx.network, args.slug).await?;
            Ok(Value::Null)
        }
        "plugin_cancel" => {
            crate::plugins::plugin_cancel();
            Ok(Value::Null)
        }
        "plugin_remove" => {
            let args: SlugArgs = from_value(args)?;
            crate::plugins::plugin_remove(&ctx.host, args.slug)?;
            Ok(Value::Null)
        }
        "plugin_import" => {
            let args: PathArgs = from_value(args)?;
            crate::plugins::plugin_import(&ctx.host, args.path)?;
            Ok(Value::Null)
        }
        "plugin_reveal" => {
            let args: SlugArgs = from_value(args)?;
            crate::plugins::plugin_reveal(&ctx.host, args.slug)?;
            Ok(Value::Null)
        }
        "plugin_open" => {
            let args: SlugArgs = from_value(args)?;
            crate::plugins::plugin_open(&ctx.host, &ctx.network, args.slug).await?;
            Ok(Value::Null)
        }
        // ---- MCP 服务器（状态查询 / 开 / 关 / 换端口） ----
        "mcp_status" => Ok(json!(ctx.mcp.status())),
        "set_mcp_config" => {
            let args: McpConfigArgs = from_value(args)?;
            Ok(json!(ctx.mcp.apply(crate::mcp::McpConfig {
                enabled: args.enabled,
                port: args.port,
            })?))
        }
        "voice_change_voice_delete" => {
            let args: IdArgs = from_value(args)?;
            crate::voice_change::voice_change_voice_delete(host, args.id)?;
            Ok(Value::Null)
        }
        // ---- 云端出图 / 出视频 ----
        "cloud_gen_presets" => Ok(json!(crate::cloud_gen::cloud_gen_presets())),
        "cloud_gen_config" => Ok(json!(crate::cloud_gen::cloud_gen_config(&ctx.cloud_gen))),
        "cloud_gen_set_config" => {
            let args: GenProvidersArgs = from_value(args)?;
            Ok(json!(crate::cloud_gen::cloud_gen_set_config(
                &ctx.cloud_gen,
                args.providers,
            )))
        }
        "cloud_gen_busy" => Ok(json!(crate::cloud_gen::cloud_gen_busy())),
        "cloud_gen_cancel" => {
            crate::cloud_gen::cloud_gen_cancel();
            Ok(Value::Null)
        }
        "cloud_gen_image" => {
            let args: GenImageArgs = from_value(args)?;
            Ok(json!(
                crate::cloud_gen::cloud_gen_image(host, &ctx.network, &ctx.cloud_gen, args.request)
                    .await?
            ))
        }
        "cloud_gen_video" => {
            let args: GenVideoArgs = from_value(args)?;
            Ok(json!(
                crate::cloud_gen::cloud_gen_video(host, &ctx.network, &ctx.cloud_gen, args.request)
                    .await?
            ))
        }
        "cloud_gen_test" => {
            let args: GenProviderArgs = from_value(args)?;
            Ok(json!(
                crate::cloud_gen::cloud_gen_test(host, &ctx.network, args.provider).await?
            ))
        }
        // ---- 云端 TTS（只依赖 HTTP + 配置，浏览器与容器同样可用） ----
        "cloud_tts_config" => Ok(json!(crate::cloud_tts::cloud_tts_config(&ctx.cloud_tts))),
        "cloud_tts_set_config" => {
            let args: ProvidersArgs = from_value(args)?;
            Ok(json!(crate::cloud_tts::cloud_tts_set_config(
                &ctx.cloud_tts,
                args.providers,
            )))
        }
        "cloud_tts_voices" => {
            let args: ProviderArgs = from_value(args)?;
            Ok(json!(
                crate::cloud_tts::cloud_tts_voices(&ctx.network, args.provider).await?
            ))
        }
        "cloud_tts_test" => {
            let args: CloudTtsTestArgs = from_value(args)?;
            Ok(json!(
                crate::cloud_tts::cloud_tts_test(host, &ctx.network, args.provider, args.text)
                    .await?
            ))
        }
        "cloud_tts_synthesize" => {
            let args: CloudTtsSynthArgs = from_value(args)?;
            Ok(json!(
                crate::cloud_tts::cloud_tts_synthesize(
                    host,
                    &ctx.network,
                    &ctx.cloud_tts,
                    args.provider_id,
                    args.items,
                    args.voice,
                )
                .await?
            ))
        }
        // ---- 网络配置（与桌面共用 `aicut_daemon::network` 同一份实现） ----
        "network_config" => Ok(json!(crate::network::network_config(&ctx.network))),
        "model_hf_token_status" => Ok(json!(crate::network::model_hf_token_status(&ctx.network))),
        "model_save_hf_token" => {
            let args: TokenArgs = from_value(args)?;
            crate::network::model_save_hf_token(&ctx.network, args.token)?;
            Ok(Value::Null)
        }
        "network_set_config" => {
            let args: NetworkSetArgs = from_value(args)?;
            Ok(json!(crate::network::network_set_config(
                &ctx.network,
                args.proxy_mode,
                args.proxy_url,
            )))
        }
        "model_source_config" => Ok(json!(crate::network::model_source_config(&ctx.network))),
        "model_set_source_config" => {
            let args: ModelSourceArgs = from_value(args)?;
            Ok(json!(crate::network::model_set_source_config(
                &ctx.network,
                args.preference,
                args.mirrors,
                args.download_prefix,
            )))
        }
        "plugin_registry_config" => Ok(json!(crate::network::plugin_registry_config(&ctx.network))),
        "plugin_set_registry_config" => {
            let args: RegistryArgs = from_value(args)?;
            Ok(json!(crate::network::plugin_set_registry_config(
                &ctx.network,
                args.url,
                args.mirrors,
            )))
        }
        "network_status" => Ok(json!(crate::network::network_status(&ctx.network))),
        "network_probe" => {
            let args: NetworkProbeArgs = from_value(args)?;
            Ok(json!(
                crate::network::network_probe(&ctx.network, args.proxy_mode, args.proxy_url,).await
            ))
        }
        // ---- 剪辑智能体（无头版：工具走文档引擎，不再回传 webview） ----
        "agent_config" => Ok(json!(crate::agent::agent_config(&ctx.agent))),
        "agent_set_config" => {
            let args: AgentConfigArgs = from_value(args)?;
            Ok(json!(crate::agent::agent_set_config(
                &ctx.agent,
                args.base_url,
                args.api_key,
                args.model,
            )))
        }
        "agent_models" => {
            let args: AgentModelArgs = from_value(args)?;
            Ok(json!(
                crate::agent::agent_models(&ctx.agent, args.base_url, args.api_key, args.model,)
                    .await?
            ))
        }
        "agent_test" => {
            let args: AgentModelArgs = from_value(args)?;
            Ok(json!(
                crate::agent::agent_test(&ctx.agent, args.base_url, args.api_key, args.model)
                    .await?
            ))
        }
        "agent_sessions" => Ok(json!(crate::agent::agent_sessions(&ctx.agent))),
        "agent_session" => {
            let args: IdArgs = from_value(args)?;
            Ok(json!(crate::agent::agent_session(&ctx.agent, args.id)?))
        }
        "agent_delete_session" => {
            let args: IdArgs = from_value(args)?;
            crate::agent::agent_delete_session(&ctx.agent, args.id)?;
            Ok(Value::Null)
        }
        "agent_set_head" => {
            let args: AgentSetHeadArgs = from_value(args)?;
            Ok(json!(crate::agent::agent_set_head(
                &ctx.agent,
                args.id,
                args.node_id
            )?))
        }
        "agent_send" => {
            let args: AgentSendArgs = from_value(args)?;
            Ok(json!(crate::agent::agent_send(
                &ctx.agent,
                args.session_id,
                args.parent_id,
                args.text
            )?))
        }
        "agent_cancel" => Ok(json!(crate::agent::agent_cancel(&ctx.agent))),
        "agent_running" => Ok(json!(crate::agent::agent_running(&ctx.agent))),
        // ---- 智能体 / MCP 的工程命令桥（无头版，M5a） ----
        "bridge_request" => {
            let args: BridgeArgs = from_value(args)?;
            Ok(crate::agent_bridge::call(&ctx.doc, &args.method, args.payload).await?)
        }
        "bridge_methods" => Ok(json!(crate::agent_bridge::METHODS)),
        // ---- 能力表：前端据此门控入口，而不是靠 `isTauri()` 猜 ----
        "capabilities" => Ok(json!({
            "version": ctx.version,
            "nativeUi": host.has_ui(),
            "items": crate::capabilities::all(),
        })),
        // ---- 历史工程（桌面与浏览器共用 `aicut_daemon::history`） ----
        "project_history_list" => Ok(json!(crate::history::list(host.data_dir()))),
        "project_history_record" => {
            let args: HistoryRecordArgs = from_value(args)?;
            Ok(json!(crate::history::record(
                host.data_dir(),
                args.project,
                args.path,
                args.dirty,
                args.thumbnail,
            )?))
        }
        "project_history_get" => {
            let args: IdArgs = from_value(args)?;
            Ok(json!(crate::history::get(host.data_dir(), args.id)?))
        }
        "project_history_delete" => {
            let args: IdArgs = from_value(args)?;
            crate::history::delete(host.data_dir(), args.id)?;
            Ok(Value::Null)
        }
        "media_cache_dir" => Ok(json!(media::media_cache_dir(host)?)),
        // ---- 字体库（与桌面端共用 `aicut_daemon::fonts`） ----
        "font_registry" => {
            let args: OptionalForceArgs = from_value(args)?;
            Ok(json!(
                crate::fonts::registry(host.data_dir(), crate::fonts::client(), args.force,)
                    .await?
            ))
        }
        "font_list" => Ok(json!(crate::fonts::list(host.data_dir())?)),
        "font_probe" => {
            let args: PathArgs = from_value(args)?;
            Ok(json!(crate::fonts::probe(args.path)?))
        }
        "font_install" => {
            let args: FontInstallArgs = from_value(args)?;
            let emit = |name: &str, payload: Value| crate::events::publish(name, &payload);
            Ok(json!(
                crate::fonts::install(
                    host.data_dir(),
                    crate::fonts::client(),
                    &emit,
                    args.id,
                    args.weights,
                )
                .await?
            ))
        }
        "font_cancel" => {
            let args: OptionalIdArgs = from_value(args)?;
            crate::fonts::cancel(args.id);
            Ok(Value::Null)
        }
        "font_remove" => {
            let args: IdArgs = from_value(args)?;
            crate::fonts::remove(host.data_dir(), args.id)?;
            Ok(Value::Null)
        }
        "font_import" => {
            let args: FontImportArgs = from_value(args)?;
            Ok(json!(crate::fonts::import(
                host.data_dir(),
                args.path,
                args.family,
                args.weight,
                args.style,
            )?))
        }
        "font_reveal" => Err("在文件管理器中显示字体需要桌面应用".into()),
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

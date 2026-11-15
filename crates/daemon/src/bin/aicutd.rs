//! `aicutd`：无头入口。没有窗口、没有 webview，只有 HTTP RPC + 静态托管。

use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;

use aicut_daemon::http::{self, ServerConfig};
use aicut_daemon::paths::DataPaths;
use aicut_daemon::rpc::RpcCtx;
use aicut_daemon::{HeadlessHost, Host};
use tokio_util::sync::CancellationToken;

const DEFAULT_PORT: u16 = 28440;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("[aicutd] {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    // `reqwest` 用的是 `rustls-no-provider`：**必须先装一份加密 provider**，否则第一次
    // 建 Client 会直接 panic（智能体的对话、云端 TTS/出图、模型下载都走这条路）。
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut data_dir: Option<String> = None;
    let mut port = DEFAULT_PORT;
    let mut lan = false;
    let mut dist: Option<PathBuf> = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data-dir" => {
                data_dir = Some(args.next().ok_or("--data-dir 需要一个路径")?);
            }
            "--port" => {
                port = args
                    .next()
                    .ok_or("--port 需要一个端口")?
                    .parse()
                    .map_err(|e| format!("端口不合法：{e}"))?;
            }
            "--lan" => lan = true,
            "--dist" => dist = Some(PathBuf::from(args.next().ok_or("--dist 需要一个目录")?)),
            "--help" | "-h" => {
                print_help();
                return Ok(());
            }
            other => return Err(format!("未知参数：{other}（--help 看用法）")),
        }
    }

    let paths = DataPaths::resolve(data_dir);
    paths
        .ensure()
        .map_err(|e| format!("准备数据目录失败：{e}"))?;

    let token = String::new();
    // 统一成 trait object：后面 agent / MCP / 各命令都按 `Arc<dyn Host>` 传，少一层阻抗。
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(
        paths.data().to_path_buf(),
        paths.config().to_path_buf(),
    ));
    // 网络配置与桌面壳同一个文件名（`<配置目录>/network.json`）。
    let network = Arc::new(aicut_daemon::network::NetworkRuntime::load(Some(
        host.config_dir().join("network.json"),
    )));
    let cloud_tts = Arc::new(aicut_daemon::cloud_tts::CloudTtsRuntime::load(Some(
        host.config_dir().join("tts.json"),
    )));
    // 执行后端偏好只影响"装/删运行库是否需要重启"的提示，从同一份 network.json 读。
    aicut_daemon::runtime_ort::set_preference(network.get().backend_preference);
    // sd.cpp 引擎的下载暂存目录（`.download`）可能是上次异常退出留下的：启动时清掉。
    aicut_daemon::sdcpp::init(host.as_ref());
    // 会话创建（EP 注册 / 运行时懒加载）用同一份偏好：容器里就是随包 CPU 那份，
    // 桌面装过 CUDA 的话也能在网页模式里用上（同一台机器、同一个进程）。
    aicut_daemon::ai_session::set_preference(network.get().backend_preference);
    match aicut_daemon::ai_session::init_runtime(host.clone()) {
        Ok(Some(dir)) => eprintln!(
            "[aicutd] ONNX Runtime 将在首次建会话时加载：{}",
            dir.display()
        ),
        Ok(None) => {}
        Err(error) => eprintln!("[aicutd] 准备 ONNX Runtime 失败：{error}"),
    }
    let cloud_gen = Arc::new(aicut_daemon::cloud_gen::CloudGenRuntime::load(Some(
        host.config_dir().join("cloud-gen.json"),
    )));
    let video_dsp = Arc::new(aicut_daemon::video_dsp::VideoDspState::default());
    // 智能体：配置与会话都落在数据目录；工具调用打到同一份文档引擎。
    let doc = aicut_daemon::DocHandle::spawn();
    // 无头进程没有"前端新建工程"这一步：先放一份空白工程进去，
    // 否则 MCP 客户端连上后每个工具都会回 "project not loaded"。
    if let Err(error) = doc.blank().await {
        eprintln!("[aicutd] 预置空白工程失败：{error}");
    }
    let agent = Arc::new(aicut_daemon::agent::AgentState::new(
        doc.clone(),
        Arc::clone(&host),
        Arc::clone(&video_dsp),
        Arc::clone(&network),
        Some(host.config_dir().join("ai.json")),
        Some(host.data_dir().join("agent").join("sessions")),
    ));
    // MCP：容器里也能被外部客户端（Claude Desktop / IDE）接上。
    // 工具面与内置智能体同一份（`agent_tools`），所以能力表里它是「降级」而不是「不可用」。
    let mcp = Arc::new(aicut_daemon::mcp::McpRuntime::load(
        Arc::clone(&host),
        doc.clone(),
        Arc::clone(&video_dsp),
        Some(host.config_dir().join("mcp.json")),
        Some(host.config_dir().join("mcp-url")),
        // `--lan` 时 MCP 也绑 0.0.0.0：容器里发布端口后，外部客户端（Claude Desktop /
        // IDE）才连得进来。默认仍是 loopback。
        lan,
    ));
    mcp.autostart();
    // 导出状态是进程级单例：注册一份，智能体 / MCP 的工具直接用同一份。
    let export = Arc::new(aicut_daemon::export::ExportState::default());
    aicut_daemon::export::install_shared(Arc::clone(&export));
    let ctx = Arc::new(RpcCtx {
        host,
        token: token.clone(),
        version: env!("CARGO_PKG_VERSION"),
        export,
        session: Arc::new(Default::default()),
        doc,
        network,
        cloud_tts,
        cloud_gen,
        video_dsp,
        agent,
        mcp: Arc::new(aicut_daemon::mcp::McpHandle(Arc::clone(&mcp))),
    });

    let bind = if lan {
        IpAddr::from([0, 0, 0, 0])
    } else {
        IpAddr::from([127, 0, 0, 1])
    };
    let server = http::serve(
        ctx,
        ServerConfig { bind, port, dist },
        CancellationToken::new(),
    )
    .await?;

    println!("[aicutd] listening on http://{}/", server.addr);
    println!("[aicutd] data dir: {}", paths.data().display());
    println!("[aicutd] open: http://{}/", server.addr);

    tokio::signal::ctrl_c()
        .await
        .map_err(|e| format!("监听退出信号失败：{e}"))?;
    println!("[aicutd] shutting down");
    Ok(())
}

fn print_help() {
    println!(
        "aicutd — AI Cut 无头服务\n\n\
         用法: aicutd [--data-dir <path>] [--port <n>] [--lan] [--dist <dir>]\n\n\
         --data-dir  数据目录（默认 AICUT_DATA_DIR / 系统默认）\n\
         --port      HTTP 端口（默认 {DEFAULT_PORT}）\n\
         --lan       绑定 0.0.0.0（默认只绑 127.0.0.1）\n\
         --dist      前端构建产物目录（默认不托管静态资源）"
    );
}

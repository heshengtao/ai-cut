//! `aicutd`：无头入口。没有窗口、没有 webview，只有 HTTP RPC + 静态托管。

use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;

use aicut_daemon::http::{self, ServerConfig};
use aicut_daemon::paths::DataPaths;
use aicut_daemon::rpc::RpcCtx;
use aicut_daemon::HeadlessHost;
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
    let host = Arc::new(HeadlessHost::new(
        paths.data().to_path_buf(),
        paths.config().to_path_buf(),
    ));
    let ctx = Arc::new(RpcCtx {
        host,
        token: token.clone(),
        version: env!("CARGO_PKG_VERSION"),
        export: Arc::new(Default::default()),
        session: Arc::new(Default::default()),
        doc: aicut_daemon::DocHandle::spawn(),
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

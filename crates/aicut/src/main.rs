//! `aicut`：AI Cut 的薄 MCP 客户端。
//!
//! 子命令完全按工具名转发；新增 MCP 工具不需要改这里。

mod client;
mod discovery;

use std::process::Command as ProcessCommand;
use std::time::Duration;

use clap::{Parser, Subcommand};
use serde_json::Value;

#[derive(Parser)]
#[command(name = "aicut", version, about = "AI Cut 的薄 MCP 客户端")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// 列出 MCP 工具
    Tools,
    /// 调用一个工具：aicut call get_project --json '{}'
    Call {
        tool: String,
        #[arg(long, default_value = "{}")]
        json: String,
    },
    /// 检查 AI Cut 是否在运行
    Status,
    /// 启动 AI Cut 并等待 MCP 就绪
    Start,
}

fn main() {
    let cli = Cli::parse();
    let code = match run(cli.command) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    };
    std::process::exit(code);
}

fn run(command: Commands) -> Result<(), String> {
    match command {
        Commands::Status => {
            match client::connect_any() {
                Ok((_, endpoint)) => {
                    println!("运行中 {endpoint}");
                    Ok(())
                }
                Err(error) => Err(error),
            }
        }
        Commands::Tools => {
            let (mut client, endpoint) = client::connect_any()?;
            println!("# {endpoint}");
            for tool in client.list_tools()? {
                let name = tool.get("name").and_then(Value::as_str).unwrap_or("");
                let description = tool
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                println!("{name}\t{description}");
            }
            Ok(())
        }
        Commands::Call { tool, json } => {
            let arguments: Value = serde_json::from_str(&json)
                .map_err(|error| format!("--json 不是合法 JSON：{error}"))?;
            if !arguments.is_object() {
                return Err("--json 必须是对象".into());
            }
            let (mut client, _) = client::connect_any()?;
            let text = client.call_tool(&tool, arguments)?;
            println!("{text}");
            Ok(())
        }
        Commands::Start => {
            launch()?;
            let endpoint = wait_ready()?;
            println!("已就绪 {endpoint}");
            Ok(())
        }
    }
}

fn launch() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let status = ProcessCommand::new("open")
            .args(["-b", "com.aicut.editor"])
            .status();
        if matches!(status, Ok(status) if status.success()) {
            return Ok(());
        }
        let status = ProcessCommand::new("open")
            .args(["-a", "AI Cut"])
            .status()
            .map_err(|error| format!("启动 AI Cut 失败：{error}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("启动 AI Cut 失败".into());
    }
    if let Some(path) = discovery::app_path() {
        ProcessCommand::new(path)
            .spawn()
            .map_err(|error| format!("启动 AI Cut 失败：{error}"))?;
        return Ok(());
    }
    Err("请设置 AICUT_APP_PATH 指向 AI Cut 可执行文件".into())
}

fn wait_ready() -> Result<String, String> {
    for _ in 0..120 {
        for endpoint in discovery::candidates() {
            if client::probe(&endpoint) {
                return Ok(endpoint);
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("等待 AI Cut MCP 就绪超时".into())
}
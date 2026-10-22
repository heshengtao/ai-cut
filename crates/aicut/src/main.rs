//! `aicut`：AI Cut 的薄 MCP 客户端。
//!
//! 子命令完全按工具名转发；新增 MCP 工具不需要改这里。

mod client;
mod discovery;

use std::path::Path;
use std::process::{Child, Command as ProcessCommand, Stdio};
use std::time::{Duration, Instant};

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
    /// 启动 AI Cut 并等待 MCP 就绪（自动查找本机安装位置）
    Start {
        /// 等待 MCP 就绪的最长秒数
        #[arg(long, default_value_t = 60)]
        wait: u64,
    },
}

/// 启动结果：能否继续监控子进程。
#[allow(dead_code)]
enum Launch {
    /// 交给系统启动器（macOS `open` / Windows `start`），拿不到子进程句柄。
    Detached,
    /// 直接创建的进程，可以观察它是否立刻退出。
    Child(Child),
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
        Commands::Status => match client::connect_any() {
            Ok((_, endpoint)) => {
                println!("运行中 {endpoint}");
                Ok(())
            }
            Err(error) => Err(error),
        },
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
        Commands::Start { wait } => {
            if let Ok((_, endpoint)) = client::connect_any() {
                println!("已在运行 {endpoint}");
                return Ok(());
            }
            println!("正在启动 AI Cut…");
            let launch = launch()?;
            let endpoint = wait_ready(Duration::from_secs(wait.max(5)), launch)?;
            println!("已就绪 {endpoint}");
            Ok(())
        }
    }
}

fn launch() -> Result<Launch, String> {
    #[cfg(target_os = "macos")]
    {
        let status = ProcessCommand::new("open")
            .args(["-b", "com.aicut.editor"])
            .status();
        if matches!(status, Ok(status) if status.success()) {
            return Ok(Launch::Detached);
        }
        let status = ProcessCommand::new("open")
            .args(["-a", "AI Cut"])
            .status()
            .map_err(|error| format_launch_error(&format!("启动 AI Cut 失败：{error}")))?;
        if status.success() {
            return Ok(Launch::Detached);
        }
        return Err(format_launch_error("启动 AI Cut 失败"));
    }

    #[cfg(target_os = "windows")]
    {
        let path = discovery::app_path().ok_or_else(|| format_launch_error("没有找到 AI Cut 应用"))?;
        return launch_windows(&path);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let path = discovery::app_path().ok_or_else(|| format_launch_error("没有找到 AI Cut 应用"))?;
        let child = spawn_detached(&path)?;
        return Ok(Launch::Child(child));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        Err("当前平台不支持自动启动 AI Cut，请手动打开应用".into())
    }
}

#[cfg(target_os = "windows")]
fn launch_windows(path: &Path) -> Result<Launch, String> {
    // 优先直接创建进程，并脱离父进程的 Job Object；这是计划任务 / 终端里
    // 启动 GUI 应用时 WebView2 子进程不初始化最常见的根因。
    match spawn_detached(path) {
        Ok(child) => Ok(Launch::Child(child)),
        Err(spawn_error) => {
            // 回退到 ShellExecute（`start`），它不继承启动器的 Job，但拿不到子进程句柄。
            let mut command = ProcessCommand::new("cmd");
            command
                .arg("/C")
                .arg("start")
                .arg("")
                .arg(path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
            match command.spawn() {
                Ok(_) => Ok(Launch::Detached),
                Err(start_error) => Err(format_launch_error(&format!(
                    "无法启动 {}：{spawn_error}；ShellExecute 回退也失败：{start_error}",
                    path.display()
                ))),
            }
        }
    }
}

#[allow(dead_code)]
fn spawn_detached(path: &Path) -> Result<Child, String> {
    let mut command = ProcessCommand::new(path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(
            CREATE_BREAKAWAY_FROM_JOB | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        );
        if let Ok(child) = command.spawn() {
            return Ok(child);
        }
        // 某些 Job Object 不允许 breakaway；退到普通 detach 也能让窗口独立存活。
        let mut fallback = ProcessCommand::new(path);
        fallback
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        fallback.creation_flags(DETACHED_PROCESS);
        return fallback
            .spawn()
            .map_err(|error| format!("无法启动 {}：{error}", path.display()));
    }

    #[cfg(not(target_os = "windows"))]
    {
        command
            .spawn()
            .map_err(|error| format!("无法启动 {}：{error}", path.display()))
    }
}

#[cfg(target_os = "windows")]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn wait_ready(timeout: Duration, mut launch: Launch) -> Result<String, String> {
    let started = Instant::now();
    loop {
        for endpoint in discovery::candidates() {
            if client::probe(&endpoint) {
                return Ok(endpoint);
            }
        }
        if let Launch::Child(child) = &mut launch {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(exit_error(status));
            }
        }
        if started.elapsed() >= timeout {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(timeout_error(timeout))
}

fn exit_error(status: std::process::ExitStatus) -> String {
    #[allow(unused_mut)]
    let mut message = match status.code() {
        Some(code) => format!("AI Cut 进程启动后立即退出（退出码 {code}）。"),
        None => "AI Cut 进程启动后被终止。".to_string(),
    };
    #[cfg(target_os = "windows")]
    {
        message.push_str("\n");
        message.push_str(&webview2_hint());
    }
    message
}

fn timeout_error(timeout: Duration) -> String {
    let tried = discovery::candidates()
        .into_iter()
        .map(|url| format!("  - {url}"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut message = format!(
        "等待 AI Cut MCP 就绪超时（{} 秒）。\n尝试过的端点：\n{tried}",
        timeout.as_secs()
    );
    #[cfg(target_os = "windows")]
    {
        message.push_str("\n\n");
        message.push_str(&webview2_hint());
    }
    message.push_str(
        "\n\n如果应用窗口已经打开但仍无响应，请确认设置里的 MCP 服务器已启用；\
         也可以先手动打开应用，再运行 `aicut status`。",
    );
    message
}

fn format_launch_error(detail: &str) -> String {
    let searched = discovery::app_candidates()
        .into_iter()
        .map(|path| format!("  - {}", path.display()))
        .collect::<Vec<_>>();
    let searched = if searched.is_empty() {
        "  （没有找到候选路径）".to_string()
    } else {
        searched.join("\n")
    };
    let mut message = format!("{detail}\n已查找的位置：\n{searched}");
    message.push_str(
        "\n\n可以用 AICUT_APP_PATH 指定 AI Cut 可执行文件，或先手动打开一次应用；\
         App 启动后会把真实路径写入配置目录的 app-path。",
    );
    #[cfg(target_os = "windows")]
    {
        message.push_str("\n\n");
        message.push_str(&webview2_hint());
    }
    message
}

#[cfg(target_os = "windows")]
fn webview2_hint() -> String {
    if webview2_installed() {
        "Windows 提示：已检测到 WebView2 Runtime。若窗口仍然黑屏，请检查应用是否被安全软件/计划任务策略阻止创建子进程。".into()
    } else {
        "Windows 提示：未检测到 WebView2 Runtime。请先安装 Microsoft Edge WebView2 Runtime，再运行 `aicut start`。".into()
    }
}

#[cfg(target_os = "windows")]
fn webview2_installed() -> bool {
    for key in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(key) {
            if Path::new(&base)
                .join("Microsoft")
                .join("EdgeWebView")
                .join("Application")
                .is_dir()
            {
                return true;
            }
        }
    }
    let client = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    for root in ["HKLM", "HKCU"] {
        let key = format!(r"{root}\SOFTWARE\Microsoft\EdgeUpdate\Clients\{client}");
        let ok = ProcessCommand::new("reg")
            .arg("query")
            .arg(&key)
            .arg("/v")
            .arg("pv")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if ok {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn webview2_hint() -> String {
    String::new()
}

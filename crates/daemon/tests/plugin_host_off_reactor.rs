//! 回归：从**没有** tokio reactor 的线程启动插件宿主半。
//!
//! 桌面端 `plugin_host_start` 是同步 Tauri 命令，跑在主线程 / WebView 线程上；那里
//! `tokio::runtime::Handle::current()` 会 panic（「there is no reactor running」），
//! 而这个 panic 会带崩整个进程——表现为 `pnpm tauri dev` 一起来就退出。
//!
//! 单独一个测试文件：`plugin_host::service` 的运行中插件表是进程级单例，同一个二进制
//! 里的 `plugin_host.rs` 会断言「只有它自己那一个在跑」。

use std::sync::Arc;

use aicut_daemon::host::{HeadlessHost, Host};
use aicut_daemon::network::NetworkRuntime;
use aicut_daemon::plugin_host::service;
use tempfile::TempDir;

fn plugin_with_host_half(temp: &TempDir, id: &str) -> std::path::PathBuf {
    let source = temp.path().join("desktop");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(
        source.join("aicut.plugin.json"),
        format!(
            r#"{{"format":1,"id":"{id}","version":"0.1.0","engines":{{"aicut":"*"}},"host":"./host.js"}}"#
        ),
    )
    .unwrap();
    std::fs::write(
        source.join("host.js"),
        format!(
            r#"globalThis.__AICUT_PLUGIN__={{id:"{id}",run(input){{return "off-reactor:"+JSON.parse(input).text;}}}};"#
        ),
    )
    .unwrap();
    source
}

#[test]
fn start_invoke_stop_work_without_a_tokio_reactor() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = plugin_with_host_half(&temp, "@demo/desktop");
    service::install_local(&host, &source, "1.4.0").unwrap();
    let network = NetworkRuntime::load(None);

    // 裸线程：没有 tokio 运行时，也没有 `enter()`——这就是桌面命令线程的样子。
    let worker = std::thread::spawn(move || {
        assert!(
            tokio::runtime::Handle::try_current().is_err(),
            "该线程不能已在 tokio 上下文里，否则测不到回归"
        );
        service::start(&host, &network, "@demo/desktop")
            .expect("没有 reactor 时也必须能启动宿主半");
        let output = service::invoke("@demo/desktop", r#"{"text":"hi"}"#).unwrap();
        assert_eq!(output, "off-reactor:hi");
        assert!(service::stop("@demo/desktop"));
    });
    worker.join().expect("插件宿主半线程不应 panic");
}

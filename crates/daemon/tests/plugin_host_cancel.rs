//! 长任务插件：取消能打断正在跑的 `run()`，且调用期间不锁住宿主表。
//!
//! 真实事故：插件节点的 `run()` 是同步的，要轮询到视频生成结束（几分钟）。桌面上
//! 这个命令以前是同步 Tauri 命令 → 整个界面冻住；而且 `invoke` 全程持着「运行中
//! 插件表」的锁 → 连「停止运行 / 禁用插件」都进不去。这里守住两条：
//!
//! 1. `cancel()` 在**不等 actor 空闲**的情况下就能打断脚本；
//! 2. 一次阻塞调用期间，`running()` / `cancel()` / `stop()` 仍然立刻返回。
//!
//! 单独一个测试文件：`plugin_host::service` 的运行中插件表是进程级单例。

use std::sync::Arc;
use std::time::{Duration, Instant};

use aicut_daemon::host::{HeadlessHost, Host};
use aicut_daemon::network::NetworkRuntime;
use aicut_daemon::plugin_host::service;
use tempfile::TempDir;

const ID: &str = "@demo/long-task";

/// 一直轮询到 `ctx.cancelled()` 变 true 才返回（模拟「提交 + 轮询到出片」）。
const LONG_TASK: &str = r#"
globalThis.__AICUT_PLUGIN__ = {
  id: "@demo/long-task",
  run() {
    let ticks = 0;
    while (!ctx.cancelled()) {
      ctx.sleep(20);
      ticks += 1;
    }
    return "cancelled after " + ticks;
  },
};
"#;

fn install(host: &Arc<dyn Host>, temp: &TempDir) {
    let source = temp.path().join("long-task");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(
        source.join("aicut.plugin.json"),
        format!(
            r#"{{"format":1,"id":"{ID}","version":"0.1.0","engines":{{"aicut":"*"}},"host":"./host.js"}}"#
        ),
    )
    .unwrap();
    std::fs::write(source.join("host.js"), LONG_TASK).unwrap();
    service::install_local(host, &source, "1.4.0").unwrap();
}

#[test]
fn cancel_interrupts_a_running_call_and_does_not_lock_the_host_table() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    install(&host, &temp);

    // 桌面命令现在跑在阻塞线程池里；这里用普通线程复现同一条路径（没有 reactor）。
    let worker = std::thread::spawn(move || {
        let network = NetworkRuntime::load(None);
        service::start(&host, &network, ID).unwrap();
        service::invoke(ID, "{}")
    });

    // 等它真的进到 `run()` 里。
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && service::running().is_empty() {
        std::thread::sleep(Duration::from_millis(10));
    }
    std::thread::sleep(Duration::from_millis(200));

    // 调用正在跑：这些操作都必须立刻返回（以前它们会等整次调用跑完）。
    let began = Instant::now();
    assert_eq!(service::running(), vec![ID.to_string()]);
    assert!(service::cancel(ID), "cancel() 要能拿到正在跑的句柄");
    assert!(began.elapsed() < Duration::from_secs(1), "取句柄不能等整次调用");

    // 被打断的那次调用返回「已取消」，而不是等 15 分钟预算耗尽。
    let outcome = worker.join().expect("宿主半线程不应 panic");
    assert_eq!(outcome.unwrap_err(), "插件运行已取消");

    // 宿主半仍然活着，取消只作用于这一次运行。
    assert_eq!(service::running(), vec![ID.to_string()]);
    assert!(service::stop(ID));
    assert!(service::running().is_empty());
}

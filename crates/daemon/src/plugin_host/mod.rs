//! 画布插件宿主：名册、清单校验、本地导入、资源路由。
//!
//! 与 `plugins` 模块（OFX）互不干扰：OFX 在 `plugins/ofx/`，这里在 `plugins/host/`。

use std::sync::OnceLock;

pub mod bindings;
pub mod linked;
pub mod market;
pub mod manifest;
pub mod registry;
pub mod resource;
pub mod runtime;
pub mod service;

/// 插件宿主进度事件（安装 / 重载）。
pub const EVENT_PLUGIN_HOST: &str = "plugin-host-progress";

/// 宿主半的网络句柄：daemon 的 tokio 运行时 + 共享 HTTP 客户端。
///
/// actor 线程不是 tokio 线程，所以它可以用 `Handle::block_on` 安全地等网络结果。
#[derive(Clone)]
pub struct NetHandle {
    pub handle: tokio::runtime::Handle,
    pub client: reqwest::Client,
}

/// 插件宿主半专用运行时：进程内单例，多线程，随进程存活。
///
/// 为什么不能用 `Handle::current()`：`service::start` 既会从 daemon 的 async 上下文
/// （浏览器 `/rpc`）调用，也会从 Tauri 的**同步**命令调用——后者跑在主线程 / WebView
/// 线程上，没有 reactor，`Handle::current()` 会直接 panic（「there is no reactor
/// running」），而且这个 panic 在桌面端会带崩整个进程。插件 actor 线程自己不是 tokio
/// 线程，它只需要一个**活着**的 handle 来 `block_on`，所以固定用自己的运行时最稳。
fn net_runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .thread_name("plugin-net")
            .build()
            .expect("创建插件宿主网络运行时失败")
    })
}

/// 给插件宿主半用的 tokio handle（在有没有 reactor 的线程上调用都安全）。
pub fn net_handle() -> tokio::runtime::Handle {
    net_runtime().handle().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 关键回归点：从**没有** tokio reactor 的普通线程取 handle 不能 panic，
    /// 而且拿到的 handle 真的能跑 async。
    #[test]
    fn net_handle_works_without_a_current_reactor() {
        let name = std::thread::current().name().map(str::to_string);
        // 默认测试线程同样没有 reactor；显式再用一个裸线程验证一次。
        let worker = std::thread::spawn(|| {
            assert!(
                tokio::runtime::Handle::try_current().is_err(),
                "测试线程不应位于 tokio 上下文"
            );
            let handle = net_handle();
            handle.block_on(async { 40 + 2 })
        });
        assert_eq!(worker.join().unwrap(), 42, "线程 {name:?}");
    }

    /// 已有的 reactor 里调用也返回同一个运行时的 handle（不新建、不 panic）。
    #[test]
    fn net_handle_is_stable_across_calls() {
        let a = net_handle().id();
        let b = net_handle().id();
        assert_eq!(a, b);
    }
}

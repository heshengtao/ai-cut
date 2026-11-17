//! 画布插件宿主：名册、清单校验、本地导入、资源路由。
//!
//! 与 `plugins` 模块（OFX）互不干扰：OFX 在 `plugins/ofx/`，这里在 `plugins/host/`。

pub mod bindings;
pub mod linked;
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

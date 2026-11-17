//! 画布插件宿主：名册、清单校验、本地导入、资源路由。
//!
//! 与 `plugins` 模块（OFX）互不干扰：OFX 在 `plugins/ofx/`，这里在 `plugins/host/`。

pub mod manifest;

/// 插件宿主进度事件（安装 / 重载）。
pub const EVENT_PLUGIN_HOST: &str = "plugin-host-progress";

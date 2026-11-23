//! 能力表：**服务端**回答"这个功能在当前形态里到底能不能用"。
//!
//! 为什么需要它：浏览器 / 容器版本此前靠前端 `isTauri()` 猜——猜错的表现是
//! "开关能点、点了没反应"（智能体配置被清空、代理设置回显但不落盘、模型下载成功却
//! 永远显示未安装）。能力必须由**真正干活的那一端**声明，前端只负责照着显示。
//!
//! 三种状态之外还有一个关键约定：**每一格都必须能解释自己**。`reason` 是 i18n 键，
//! 前端翻译后展示；`fallback` 告诉用户现在能改用什么方式（例如"用页面内的参数表"）。
//!
//! 这份表同时是后续迁移的施工图：把某个能力从 `desktopOnly` 改成 `ok`，就是把它真正
//! 接进 `crates/daemon` 的那一天。

use serde::Serialize;

/// 能力状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// 完整可用。
    Ok,
    /// 可用但降级（例如容器里没有声卡时的实时监听、CPU 上的本地推理）。
    Degraded,
    /// 缺组件（模型 / 运行时 / 字体）——装齐就能用，属于可自愈。
    Missing,
    /// 只有桌面壳能做到（原生窗口、系统级操作、尚未下沉的模块）。
    DesktopOnly,
    /// 本形态不支持，也不打算支持（例如需要 GPU 的生成引擎）。
    Unsupported,
}

/// 一条能力声明。
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Capability {
    /// 稳定标识；与前端 API 模块一一对应（`asr` / `tts` / `cloud_gen` / `agent` …）。
    pub key: &'static str,
    pub state: State,
    /// 原因键（i18n `caps.reason.*`）；`""` = 不需要解释。
    pub reason: &'static str,
    /// 替代做法键（i18n `caps.fallback.*`）；`""` = 没有替代。
    pub fallback: &'static str,
}

const fn ok(key: &'static str) -> Capability {
    Capability {
        key,
        state: State::Ok,
        reason: "",
        fallback: "",
    }
}

const fn desktop(key: &'static str, reason: &'static str, fallback: &'static str) -> Capability {
    Capability {
        key,
        state: State::DesktopOnly,
        reason,
        fallback,
    }
}

/// 无头（浏览器 / 容器）形态的能力表。
///
/// 桌面壳**不走这张表**：它没有 HTTP 命令面，前端直接 `invoke`，全部能力都在。
/// 桌面壳起的内嵌 web 服务用的也是这张表——因为那些命令确实还没有 HTTP 实现，
/// 与其让用户点到一个"未知命令"，不如提前说清楚。
pub const HEADLESS: &[Capability] = &[
    // ---- 已经与桌面共用同一份实现 ----
    ok("project"),
    ok("media"),
    ok("export"),
    ok("fonts"),
    ok("history"),
    ok("session"),
    // ---- 本地 AI：已全部下沉（M4）。模型要单独安装，缺的是"权重"而不是"能力"，
    // 所以这里是 ok；没装模型时由模型层给出"先下载 xxx"的明确错误。
    ok("asr"),
    ok("tts"),
    ok("audio_ai"),
    ok("video_ai"),
    ok("voice_change"),
    // 推理在 CPU 上跑得动但慢，具体模型在 `model_catalog` 里有 `installed` 状态。
    ok("aligner"),
    // 无模型视频处理已下沉（滤镜链 + 一次 ffmpeg 转码）。
    ok("video_dsp"),
    // 响度测量已下沉（ffmpeg 解码 + ebur128，无模型）。
    ok("loudness"),
    // 模型清单 / 下载 / 探测已下沉（纯 HTTP + 文件系统）。
    ok("model"),
    // ONNX Runtime 运行库管理已下沉（清单 / 下载 / 删除）。
    ok("runtime"),
    // ---- 纯网络功能：正在下沉，先明确拒绝 ----
    // 云端出图 / 出视频已下沉（纯 HTTP + ffmpeg 探测），浏览器与容器都能用。
    ok("cloud_gen"),
    // 云端朗读已下沉（只依赖 HTTP + 配置 + ffmpeg 探测），浏览器与容器都能用。
    ok("cloud_tts"),
    // 云端语音识别同层：配置在 asr.json，识别走同一套 HTTP + ffmpeg 解码。
    ok("cloud_asr"),
    ok("network"),
    // ---- 插件 / OFX ----
    // OFX：探测 / 单帧预览 / 图片烘焙 / 转场预览 / **整段烘焙（片段与转场）** 都已下沉。
    // 整段烘焙用单进程顺序烘焙：桌面版的 `--ofx-bake-worker` 只是为了并行，逐帧语义
    // （Session 参数、source_time、alpha 规则）与这里同一份。
    ok("ofx"),
    // 插件：注册表 / 下载 / 安装 / 导入 / 删除都可用；只有「在文件管理器里显示」
    // 与「拉起系统浏览器」两条系统级操作需要桌面壳。
    Capability {
        key: "plugin",
        state: State::Degraded,
        reason: "caps.reason.pluginRevealDesktopOnly",
        fallback: "",
    },
    // 画布插件宿主：安装 / 加载 / 宿主半（QuickJS）都在 daemon 里，无头形态同样可用。
    // 客户端半（Vue 组件 / 插槽）只在有 UI 的形态加载，缺 UI 时对应注册表为空。
    ok("plugin_host"),
    // ---- 智能体 / MCP ----
    // 工具面已经与桌面 `tools.rs` 对齐（63 / 63）：文档读写、编辑宏、片段级 AI、
    // 导出与渲染、代码出片、工程生命周期、撤销重做、审片批注、影片结构、后台任务全在。
    ok("agent"),
    // MCP server 与内置智能体共用同一份全量工具面，外部客户端接上容器里的服务
    // 看到的就是桌面上那 63 个工具。
    ok("mcp"),
    // ---- 系统级 ----
    desktop("cli", "caps.reason.needsPath", ""),
    desktop("data_dir", "caps.reason.needsPath", ""),
    // ---- 本地生成（sd.cpp）----
    // 引擎管理（下载 / 安装 / 选择 / 删除）与本地出图 / 出视频都已下沉到 daemon，
    // 桌面与浏览器共用同一份实现；容器**可以**拿到 GPU（Linux 宿主 + NVIDIA 容器运行时
    // `--gpus all` / CDI），没有 GPU 时 sd.cpp 也会退回 CPU 跑。
    // 没装引擎 / 权重时缺的是「组件」而不是「能力」，由引擎层给出"先下载 xxx"的明确错误。
    ok("image_gen"),
    ok("video_gen"),
    ok("sdcpp"),
];

/// 查一条能力；未知 key 返回 `None`（前端据此保留旧行为，而不是误判为不可用）。
pub fn get(key: &str) -> Option<Capability> {
    HEADLESS.iter().copied().find(|item| item.key == key)
}

/// 整张表（`/rpc/capabilities` 的输出）。
pub fn all() -> &'static [Capability] {
    HEADLESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_unique_and_explained() {
        let mut seen = std::collections::HashSet::new();
        for item in HEADLESS {
            assert!(seen.insert(item.key), "重复的能力 key：{}", item.key);
            if item.state != State::Ok {
                assert!(!item.reason.is_empty(), "{} 没有给原因", item.key);
            }
        }
    }

    #[test]
    fn plugin_host_capability_is_available_headless() {
        let cap = get("plugin_host").expect("plugin_host capability must be declared");
        assert_eq!(cap.state, State::Ok);
    }

    #[test]
    fn get_is_stable() {
        assert_eq!(get("project").map(|c| c.state), Some(State::Ok));
        assert_eq!(get("agent").map(|c| c.state), Some(State::Ok));
        assert_eq!(get("ofx").map(|c| c.state), Some(State::Ok));
        assert!(get("no_such_feature").is_none());
    }
}

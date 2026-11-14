//! AI Cut 的无头核心（**不依赖 Tauri**）：
//!
//! - `host`：桌面壳 / 无头二进制提供的宿主能力（进程、目录、事件）；
//! - `paths`：无头模式的数据目录解析；
//! - `project` / `media` / `export`：工程文件与 ffmpeg（探测、缩略图、波形、代理、导出）；
//! - `rpc` / `http`：浏览器端 `Channel` 打进来的 HTTP RPC 与静态托管；
//! - `DocEngine`：把前端**同一份** TS 领域代码放进 QuickJS 执行。

pub mod doc_actor;
pub mod events;
pub mod export;
pub mod host;
pub mod http;
pub mod media;
pub mod paths;
pub mod project;
pub mod rpc;
pub mod session;

pub use doc::{DocEngine, IdSource};
pub use doc_actor::DocHandle;
pub use host::{BoxFuture, HeadlessHost, Host, Output, RunOptions};

mod doc {
    //! 无头文档引擎：把前端**同一份** TS 领域代码放进 QuickJS 执行。
    //!
    //! 为什么不是 Rust 重写：桌面/浏览器的编辑手感依赖本地同步执行，TS 领域代码必须
    //! 留在前端；再写一份 Rust 就是两份实现。这里复用 esbuild 打出来的
    //! `assets/domain.js`，宿主只注入两个不确定源：uuid 与时钟。
    //!
    //! 边界只传 JSON：命令进、`{ok, revision, changed, affected, error}` 出；文档对象
    //! 留在 JS 堆里，只有加入 / 重同步时才 `snapshot()`。

    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    use rquickjs::{Context, Function, Object, Runtime};

    /// 领域代码的 bundle（`pnpm build:domain` 生成，勿手改）。
    const DOMAIN_JS: &str = include_str!("../assets/domain.js");

    /// 确定性模式下时钟的起点，必须与 `scripts/domain-golden.mjs` 一致。
    const CLOCK_BASE: u64 = 1_700_000_000_000;

    /// uuid / 时钟的来源。
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum IdSource {
        /// 生产：真 uuid v4 + 系统时钟。
        Real,
        /// 测试：递增计数器，Node 与 QuickJS 才能逐字段比对。
        Deterministic,
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// 一个加载了领域代码的文档引擎。
    ///
    /// 引擎不是 `Send`/`Sync`（QuickJS 运行时是线程绑定的）：无头服务里按连接 /
    /// 会话持有，桌面壳里按 daemon 实例持有。
    pub struct DocEngine {
        // 必须与 ctx 同生命周期持有；字段顺序不影响 Drop，但名字要能看出来是故意的。
        _rt: Runtime,
        ctx: Context,
    }

    impl DocEngine {
        pub fn new(source: IdSource) -> Result<Self, String> {
            let rt = Runtime::new().map_err(|e| format!("创建 QuickJS 运行时失败：{e}"))?;
            let ctx = Context::full(&rt).map_err(|e| format!("创建 QuickJS 上下文失败：{e}"))?;

            let ids = Arc::new(AtomicU64::new(0));
            let clock = Arc::new(AtomicU64::new(0));

            ctx.with(|ctx| {
                let globals = ctx.globals();

                let id_counter = ids.clone();
                let uuid_fn = Function::new(ctx.clone(), move || -> String {
                    let n = id_counter.fetch_add(1, Ordering::SeqCst) + 1;
                    match source {
                        IdSource::Deterministic => {
                            format!("00000000-0000-4000-8000-{n:012}")
                        }
                        IdSource::Real => uuid::Uuid::new_v4().to_string(),
                    }
                })
                .map_err(|e| format!("安装 __aicut_uuid 失败：{e}"))?;
                globals
                    .set("__aicut_uuid", uuid_fn)
                    .map_err(|e| format!("注册 __aicut_uuid 失败：{e}"))?;

                let clock_counter = clock.clone();
                let now_fn = Function::new(ctx.clone(), move || -> i64 {
                    match source {
                        IdSource::Deterministic => {
                            (CLOCK_BASE + clock_counter.fetch_add(1, Ordering::SeqCst) + 1) as i64
                        }
                        IdSource::Real => now_ms(),
                    }
                })
                .map_err(|e| format!("安装 __aicut_now 失败：{e}"))?;
                globals
                    .set("__aicut_now", now_fn)
                    .map_err(|e| format!("注册 __aicut_now 失败：{e}"))?;

                ctx.eval::<(), _>(DOMAIN_JS)
                    .map_err(|e| format!("加载领域 bundle 失败：{e}"))?;
                Ok::<(), String>(())
            })?;

            Ok(Self { _rt: rt, ctx })
        }

        /// 取 `AICUT.<method>` 并调用（单参数版本）。
        fn call1(&self, method: &str, arg: &str) -> Result<String, String> {
            self.ctx.with(|ctx| {
                let globals = ctx.globals();
                let api: Object = globals
                    .get("AICUT")
                    .map_err(|e| format!("bundle 没有暴露 AICUT：{e}"))?;
                let f: Function = api
                    .get(method)
                    .map_err(|e| format!("AICUT.{method} 不存在：{e}"))?;
                f.call::<_, String>((arg,)).map_err(|e| {
                    let thrown = ctx.catch();
                    format!("AICUT.{method} 抛错：{e}（{thrown:?}）")
                })
            })
        }

        /// 载入工程快照。
        pub fn load(&self, json: &str) -> Result<String, String> {
            self.call1("load", json)
        }

        /// 当前文档快照（紧凑格式由 JS 侧决定）。
        pub fn snapshot(&self) -> Result<String, String> {
            self.call1("snapshot", "")
        }

        /// 当前 revision（命令的乐观并发基线）。
        pub fn revision(&self) -> Result<u64, String> {
            self.call_number("currentRevision", "")
                .map(|value| value.max(0.0) as u64)
        }

        /// 调用返回数字的导出函数（QuickJS 不会把 number 隐式转成 String）。
        fn call_number(&self, method: &str, arg: &str) -> Result<f64, String> {
            self.ctx.with(|ctx| {
                let globals = ctx.globals();
                let api: Object = globals
                    .get("AICUT")
                    .map_err(|e| format!("bundle 没有暴露 AICUT：{e}"))?;
                let f: Function = api
                    .get(method)
                    .map_err(|e| format!("AICUT.{method} 不存在：{e}"))?;
                f.call::<_, f64>((arg,)).map_err(|e| {
                    let thrown = ctx.catch();
                    format!("AICUT.{method} 抛错：{e}（{thrown:?}）")
                })
            })
        }

        /// 应用一条命令，返回 `{ok, revision, changed, affected, error}`。
        pub fn apply(&self, command_json: &str) -> Result<String, String> {
            self.call1("apply", command_json)
        }

        /// 设置引擎语言（`zh` / `en`），影响默认命名与错误文案。
        pub fn set_locale(&self, locale: &str) -> Result<String, String> {
            self.call1("setLocale", locale)
        }

        /// MCP / CLI 的只读视图。
        pub fn view(&self, method: &str, args_json: &str) -> Result<String, String> {
            self.ctx.with(|ctx| {
                let globals = ctx.globals();
                let api: Object = globals
                    .get("AICUT")
                    .map_err(|e| format!("bundle 没有暴露 AICUT：{e}"))?;
                let f: Function = api
                    .get("view")
                    .map_err(|e| format!("AICUT.view 不存在：{e}"))?;
                f.call::<_, String>((method, args_json)).map_err(|e| {
                    let thrown = ctx.catch();
                    format!("AICUT.view 抛错：{e}（{thrown:?}）")
                })
            })
        }
    }
}

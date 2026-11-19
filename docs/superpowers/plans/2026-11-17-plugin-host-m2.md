# 插件宿主半（M2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件的 `host.js` 能在一个独立 QuickJS 运行时里执行，通过同步 `ctx.*` 访问网络 / 存储 / 产物落盘，前端适配器一次 `plugin_host_invoke` 就能拿回结果。

**Architecture:** 每插件一个 **actor 线程**，线程内独占 `rquickjs::Runtime` + `Context`；宿主命令从 mpsc 进来、结果从 oneshot 回去。JS 侧只有**同步 API**（需要网络的调用用 `Handle::block_on` 阻塞该线程），因此不需要 Promise/事件循环，宿主半就是「一个脚本 + 一个 `run(input)`」。`Runtime::set_interrupt_handler` 负责超时与取消。

**Tech Stack:** Rust（`rquickjs 0.14` / `reqwest` / `tokio::runtime::Handle`）、Vue 3 + Vitest。

**设计依据：** [`../specs/2026-11-17-plugin-architecture-design.md`](../specs/2026-11-17-plugin-architecture-design.md) §7
**前置：** M0（内核接缝）、M1（名册 + 加载器）。

## Global Constraints

- 宿主半是**单文件脚本**，不允许 `import`；构建产物在加载时写 `globalThis.__AICUT_PLUGIN__ = { id, run(input) }`。
- 宿主半只有 **同步** API。网络用 `Handle::block_on`；单次调用有超时（默认 30 s）。
- 每个插件**一个线程 + 一个 Runtime**；停用/卸载 = 丢弃 Runtime，线程退出。
- JS 侧没有 `require` / `fetch` / `fs` / `process`；一切能力经 `ctx`。
- `ctx.media.save(base64, name)` 只写进 `<data>/plugins/data/<id>/out/`，返回绝对路径；入库由前端 adapter 的 `paths` 完成。
- 超时 / 取消 → 该次调用返回错误，插件不崩；连续失败不自动停用（只在面板显示 `lastError`）。
- i18n：新增文案同时进 `zh.ts` / `en.ts`。
- 每任务一次 commit。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `crates/daemon/src/plugin_host/runtime.rs` | actor：线程、通道、Runtime、中断、eval、invoke |
| `crates/daemon/src/plugin_host/bindings.rs` | 注入 `ctx`（log/storage/media/http/cancelled） |
| `crates/daemon/src/plugin_host/service.rs` | `start` / `invoke` / `stop` + 运行态登记 |
| `crates/daemon/src/rpc.rs` | `plugin_host_start` / `_invoke` / `_stop` |
| `src-tauri/src/plugin_host.rs` | 三个 Tauri 薄包装 |
| `src/core/pluginHostApi.ts` | `pluginHostStart` / `pluginHostInvoke` / `pluginHostStop` |
| `src/core/plugins/context.ts` | 客户端 `ctx.host.run(input)` |
| `src/stores/pluginHost.ts` | 加载前 `start`、禁用/移除时 `stop` |
| `examples/plugin-echo/` | 带宿主半的示例（storage + 文本回显） |

---

### Task 1: QuickJS actor（Rust）

**Files:**
- Create: `crates/daemon/src/plugin_host/runtime.rs`
- Modify: `crates/daemon/src/plugin_host/mod.rs`
- Test: 同文件 tests

**Interfaces:**
- Produces:
  - `pub struct HostRuntime { tx: std::sync::mpsc::Sender<Command> }`
  - `HostRuntime::spawn(plugin_id: String, source: String, budget: Budget) -> Result<Self, String>`
  - `HostRuntime::invoke(&self, input: String) -> Result<String, String>`
  - `HostRuntime::stop(&self)`
  - `pub struct Budget { pub timeout: std::time::Duration }`（默认 30 s）
  - `pub fn eval_plugin(ctx: &rquickjs::Ctx, source: &str) -> Result<(), String>`（在 bindings 里实现，本任务先留一个最小的 `eval_plugin` 空壳？——不：本任务直接实现 eval + 调用 `__AICUT_PLUGIN__.run`）

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const SCRIPT: &str = r#"
      globalThis.__AICUT_PLUGIN__ = {
        id: "demo",
        run(input) { return JSON.stringify({ text: "hello " + input.name }); },
      };
    "#;

    #[test]
    fn invokes_the_plugin_entry() {
        let runtime = HostRuntime::spawn("demo".into(), SCRIPT.into(), Budget::default()).unwrap();
        let out = runtime.invoke(r#"{"name":"world"}"#.into()).unwrap();
        assert_eq!(out, r#"{"text":"hello world"}"#);
        runtime.stop();
    }

    #[test]
    fn rejects_a_script_without_an_entry() {
        let error = HostRuntime::spawn("demo".into(), "var x = 1;".into(), Budget::default())
            .unwrap_err();
        assert!(error.contains("__AICUT_PLUGIN__"), "{}", error);
    }

    #[test]
    fn rejects_a_syntax_error_with_the_reason() {
        let error = HostRuntime::spawn("demo".into(), "function (".into(), Budget::default())
            .unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn interrupts_a_runaway_script() {
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "spin", run() { while (true) {} } };
        "#;
        let runtime = HostRuntime::spawn(
            "spin".into(),
            script.into(),
            Budget { timeout: Duration::from_millis(120) },
        )
        .unwrap();
        let error = runtime.invoke("{}".into()).unwrap_err();
        assert!(error.contains("超时"), "{}", error);
    }

    #[test]
    fn reports_an_exception_from_run() {
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "boom", run() { throw new Error("nope"); } };
        "#;
        let runtime = HostRuntime::spawn("boom".into(), script.into(), Budget::default()).unwrap();
        let error = runtime.invoke("{}".into()).unwrap_err();
        assert!(error.contains("nope"), "{}", error);
    }

    #[test]
    fn stop_is_idempotent_and_invoke_after_stop_fails() {
        let runtime = HostRuntime::spawn("demo".into(), SCRIPT.into(), Budget::default()).unwrap();
        runtime.stop();
        runtime.stop();
        assert!(runtime.invoke("{}".into()).is_err());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::runtime`
Expected: 编译失败 —— 模块不存在

- [ ] **Step 3: 写实现**

```rust
// crates/daemon/src/plugin_host/runtime.rs
//! 每插件一个 actor 线程 + 一个 QuickJS Runtime。
//!
//! 为什么是「线程 + 通道」而不是 async：QuickJS 运行时是线程绑定的，而且宿主半
//! 用的是**同步 API**（`Handle::block_on` 调网络），阻塞的必须是插件自己的线程，
//! 不能是 daemon 的执行器。

use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rquickjs::{Context, Function, Object, Runtime};

/// 单次调用的时间预算。
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub timeout: Duration,
}

impl Default for Budget {
    fn default() -> Self {
        Self { timeout: Duration::from_secs(30) }
    }
}

enum Command {
    Invoke { input: String, reply: Sender<Result<String, String>> },
    Stop(Sender<()>),
}

pub struct HostRuntime {
    plugin_id: String,
    tx: Option<Sender<Command>>,
    cancelled: Arc<Mutex<bool>>,
    budget: Budget,
}

impl HostRuntime {
    /// 起一个 actor：先建 Runtime、注入 `ctx`、执行脚本，再进入命令循环。
    pub fn spawn(plugin_id: String, source: String, budget: Budget) -> Result<Self, String> {
        let cancelled = Arc::new(Mutex::new(false));
        let (tx, rx) = channel::<Command>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        let id = plugin_id.clone();
        let flag = cancelled.clone();

        thread::Builder::new()
            .name(format!("plugin-{id}"))
            .spawn(move || {
                let mut state = match PluginState::load(&id, &source, budget, flag) {
                    Ok(state) => {
                        let _ = ready_tx.send(Ok(()));
                        state
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                };
                while let Ok(command) = rx.recv() {
                    match command {
                        Command::Invoke { input, reply } => {
                            let _ = reply.send(state.invoke(&input));
                        }
                        Command::Stop(ack) => {
                            state.stop();
                            let _ = ack.send(());
                            break;
                        }
                    }
                }
            })
            .map_err(|error| format!("创建插件线程失败：{error}"))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                plugin_id,
                tx: Some(tx),
                cancelled,
                budget,
            }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err("插件线程异常退出".to_string()),
        }
    }

    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    pub fn budget(&self) -> Budget {
        self.budget
    }

    pub fn invoke(&self, input: String) -> Result<String, String> {
        let Some(tx) = &self.tx else {
            return Err("插件宿主半已停止".to_string());
        };
        let (reply_tx, reply_rx) = channel();
        tx.send(Command::Invoke { input, reply: reply_tx })
            .map_err(|_| "插件宿主半已停止".to_string())?;
        // 线程里的中断处理器负责在超时后打断 JS；这里只等结果。
        reply_rx
            .recv_timeout(self.budget.timeout + Duration::from_secs(2))
            .map_err(|_| "插件调用超时".to_string())?
    }

    pub fn stop(&self) {
        *self.cancelled.lock().unwrap() = true;
        if let Some(tx) = &self.tx {
            let (ack_tx, ack_rx) = channel();
            if tx.send(Command::Stop(ack_tx)).is_ok() {
                let _ = ack_rx.recv_timeout(Duration::from_secs(2));
            }
        }
    }
}

struct PluginState {
    _rt: Runtime,
    ctx: Context,
    deadline: Arc<Mutex<Option<Instant>>>,
    cancelled: Arc<Mutex<bool>>,
}

impl PluginState {
    fn load(
        plugin_id: &str,
        source: &str,
        budget: Budget,
        cancelled: Arc<Mutex<bool>>,
    ) -> Result<Self, String> {
        let rt = Runtime::new().map_err(|error| format!("创建 QuickJS 运行时失败：{error}"))?;
        let deadline = Arc::new(Mutex::new(None::<Instant>));
        let watch = deadline.clone();
        let flag = cancelled.clone();
        rt.set_interrupt_handler(Some(Box::new(move || {
            if *flag.lock().unwrap() {
                return true;
            }
            match *watch.lock().unwrap() {
                Some(limit) => Instant::now() > limit,
                None => false,
            }
        })));
        let ctx = Context::full(&rt).map_err(|error| format!("创建 QuickJS 上下文失败：{error}"))?;

        super::bindings::install(&ctx, plugin_id, cancelled, deadline.clone())?;

        ctx.with(|ctx| {
            ctx.eval::<(), _>(source).map_err(|error| {
                let thrown = ctx.catch();
                format!(
                    "执行 host.js 失败：{error}（{}）",
                    thrown
                        .as_exception()
                        .map(|exception| format!("{exception:?}"))
                        .unwrap_or_else(|| format!("{thrown:?}"))
                )
            })?;
            let exists: bool = ctx
                .globals()
                .get::<_, rquickjs::Value>("__AICUT_PLUGIN__")
                .map(|value| value.is_object())
                .unwrap_or(false);
            if !exists {
                return Err("host.js 必须设置 globalThis.__AICUT_PLUGIN__ = { id, run }".to_string());
            }
            Ok::<(), String>(())
        })?;

        Ok(Self {
            _rt: rt,
            ctx,
            deadline,
            cancelled,
        })
    }

    fn invoke(&mut self, input: &str) -> Result<String, String> {
        let budget = Budget::default();
        *self.deadline.lock().unwrap() = Some(Instant::now() + budget.timeout);
        let result = self.ctx.with(|ctx| {
            let globals = ctx.globals();
            let plugin: Object = globals
                .get("__AICUT_PLUGIN__")
                .map_err(|error| format!("取插件入口失败：{error}"))?;
            let run: Function = plugin
                .get("run")
                .map_err(|_| "插件入口缺少 run(input)".to_string())?;
            let payload = format!("JSON.parse({})", rquickjs::Value::new_string(ctx.clone(), input)
                .map_err(|error| format!("构造入参失败：{error}"))?
                .to_string()
                .map_err(|error| format!("构造入参失败：{error}"))?);
            drop(payload);
            run.call::<_, String>((rquickjs::Value::new_string(ctx.clone(), input).map_err(|error| error.to_string())?,))
                .map_err(|error| {
                    let thrown = ctx.catch();
                    format!(
                        "插件 run 抛错：{error}（{}）",
                        thrown
                            .as_exception()
                            .map(|exception| format!("{exception:?}"))
                            .unwrap_or_else(|| format!("{thrown:?}"))
                    )
                })
        });
        *self.deadline.lock().unwrap() = None;
        if *self.cancelled.lock().unwrap() {
            return Err("插件已被停止".to_string());
        }
        result
    }

    fn stop(&mut self) {
        *self.cancelled.lock().unwrap() = true;
        *self.deadline.lock().unwrap() = Some(Instant::now());
    }
}
```

> 关于入参：`run(input)` 收到的是**字符串**（前端传 JSON 文本），插件里自己 `JSON.parse`。
> 这样 QuickJS 侧不依赖宿主做 JSON 编解码，出错信息也更直白。上面草稿里那段 `payload`
> 是多余的——实现时只保留 `run.call::<_, String>((input.to_string(),))`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::runtime`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/plugin_host
git commit -m "feat(plugin-host): 每插件一个 QuickJS actor 运行时"
```

---

### Task 2: `ctx` 能力注入（Rust）

**Files:**
- Create: `crates/daemon/src/plugin_host/bindings.rs`
- Modify: `crates/daemon/src/plugin_host/mod.rs`
- Test: 同文件 tests

**Interfaces:**
- Produces: `pub fn install(ctx: &rquickjs::Context, plugin_id: &str, cancelled: Arc<Mutex<bool>>, deadline: Arc<Mutex<Option<Instant>>>) -> Result<(), String>`
- JS 面：`ctx.log(msg)`、`ctx.storage.get(k)/set(k,v)`、`ctx.media.save(base64,name)`、`ctx.http.request({method,url,headers,body})`、`ctx.cancelled()`

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn storage_round_trips_within_the_plugin_data_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "s", run() {
            ctx.storage.set("k", "v");
            return ctx.storage.get("k");
          } };
        "#;
        let out = run_script(dir.path(), "s", script, "{}").unwrap();
        assert_eq!(out, "v");
        assert!(dir.path().join("s").join("storage.json").is_file());
    }

    #[test]
    fn media_save_writes_bytes_and_returns_a_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "m", run() {
            return ctx.media.save("aGVsbG8=", "hello.txt");
          } };
        "#;
        let path = run_script(dir.path(), "m", script, "{}").unwrap();
        assert!(std::path::Path::new(&path).is_file());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn media_save_rejects_path_traversal_in_the_name() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "m", run() {
            try { ctx.media.save("aGVsbG8=", "../escape.txt"); return "no"; }
            catch (error) { return "blocked"; }
          } };
        "#;
        assert_eq!(run_script(dir.path(), "m", script, "{}").unwrap(), "blocked");
    }

    #[test]
    fn cancelled_flag_is_visible_to_scripts() {
        let dir = tempfile::TempDir::new().unwrap();
        let flag = Arc::new(Mutex::new(true));
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "c", run() { return String(ctx.cancelled()); } };
        "#;
        let out = run_script_with(
            dir.path(),
            "c",
            script,
            flag,
            Arc::new(Mutex::new(None::<Instant>)),
        )
        .unwrap();
        assert_eq!(out, "true");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::bindings`
Expected: 编译失败

- [ ] **Step 3: 写实现**

```rust
// crates/daemon/src/plugin_host/bindings.rs
//! 宿主半的 `ctx` 注入。
//!
//! 能力面刻意小：日志、键值存储、产物落盘、HTTP、取消标志。
//! 没有 `fs` / `require` / `process`——插件能做的每件事都必须经过这里。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine as _;
use rquickjs::{Context, Function, Object};

const STORAGE_FILE: &str = "storage.json";
const OUT_DIR: &str = "out";

pub fn install(
    ctx: &Context,
    plugin_id: &str,
    cancelled: Arc<Mutex<bool>>,
    deadline: Arc<Mutex<Option<Instant>>>,
) -> Result<(), String> {
    let root = data_dir(plugin_id)?;
    std::fs::create_dir_all(root.join(OUT_DIR))
        .map_err(|error| format!("创建插件数据目录失败：{error}"))?;

    ctx.with(|ctx| {
        let globals = ctx.globals();
        let api = Object::new(ctx.clone()).map_err(|error| error.to_string())?;

        let log = Function::new(ctx.clone(), move |message: String| {
            println!("[plugin {plugin_id}] {message}");
        })
        .map_err(|error| error.to_string())?;
        api.set("log", log).map_err(|error| error.to_string())?;

        let storage = Object::new(ctx.clone()).map_err(|error| error.to_string())?;
        let root_get = root.clone();
        storage
            .set(
                "get",
                Function::new(ctx.clone(), move |key: String| -> Option<String> {
                    let map = read_storage(&root_get);
                    map.get(&key).cloned()
                })
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        let root_set = root.clone();
        storage
            .set(
                "set",
                Function::new(ctx.clone(), move |key: String, value: String| -> bool {
                    let mut map = read_storage(&root_set);
                    map.insert(key, value);
                    write_storage(&root_set, &map).is_ok()
                })
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        api.set("storage", storage).map_err(|error| error.to_string())?;

        let media = Object::new(ctx.clone()).map_err(|error| error.to_string())?;
        let root_media = root.clone();
        media
            .set(
                "save",
                Function::new(
                    ctx.clone(),
                    move |bytes: String, name: String| -> Result<String, rquickjs::Error> {
                        save_media(&root_media, &bytes, &name).map_err(|_| rquickjs::Error::Unknown)
                    },
                )
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        api.set("media", media).map_err(|error| error.to_string())?;

        let http = Object::new(ctx.clone()).map_err(|error| error.to_string())?;
        http.set(
            "request",
            Function::new(
                ctx.clone(),
                move |request: rquickjs::Value| -> Result<String, rquickjs::Error> {
                    request_json(request).map_err(|_| rquickjs::Error::Unknown)
                },
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        api.set("http", http).map_err(|error| error.to_string())?;

        let flag = cancelled.clone();
        api.set(
            "cancelled",
            Function::new(ctx.clone(), move || -> bool { *flag.lock().unwrap() })
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        drop(deadline);
        globals.set("ctx", api).map_err(|error| error.to_string())
    })
}
```

实现要点（补齐未展开的函数）：
- `data_dir(plugin_id)`：`<config>/plugins/data/<safe-id>`；`safe-id` 用 `[A-Za-z0-9._-]` 之外的字符换成 `-`。
- `read_storage/write_storage`：读 `storage.json`（对象 → `BTreeMap<String,String>`），写回用临时文件 + rename。
- `save_media`：只接受 `name` 里没有 `/`、`\`、`..` 的单段文件名；base64 解码（`base64::engine::general_purpose::STANDARD`），写 `out/<name>`，返回绝对路径字符串。
- `request_json`：从 JS 对象读 `method` / `url` / `headers` / `body`，用阻塞 HTTP 客户端发出去，返回 `JSON.stringify({status, body})`。
  - HTTP 客户端用 `crate::network` 里的共享 client（`NetworkRuntime::client()`），actor 线程里用 `Handle::block_on`。
  - **本任务先实现为「不支持网络」的最小版本**：返回 `{"status":0,"body":"http 未启用"}`，把真实网络留给 Task 3 接 `NetworkRuntime`（这样先能跑通 storage / media / cancelled 三条能力，任务边界更清楚）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::bindings`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/plugin_host
git commit -m "feat(plugin-host): 宿主半 ctx 能力注入（storage/media/log/cancelled）"
```

---

### Task 3: 运行态登记与 RPC

**Files:**
- Modify: `crates/daemon/src/plugin_host/service.rs`
- Modify: `crates/daemon/src/rpc.rs`
- Modify: `src-tauri/src/plugin_host.rs`、`src-tauri/src/lib.rs`
- Test: `crates/daemon/tests/plugin_host.rs`（追加用例）

**Interfaces:**
- Produces:
  - `service::start(host: &Arc<dyn Host>, id: &str) -> Result<(), String>`
  - `service::invoke(host: &Arc<dyn Host>, id: &str, input: &str) -> Result<String, String>`
  - `service::stop(host: &Arc<dyn Host>, id: &str)`
  - `service::running(host: &Arc<dyn Host>) -> Vec<String>`
  - RPC：`plugin_host_start { id }` → `{ running: true }`、`plugin_host_invoke { id, input }` → `{ output: string }`、`plugin_host_stop { id }`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn start_invoke_stop_round_trip() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("echo");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::write(
        source.join("aicut.plugin.json"),
        r#"{"format":1,"id":"@demo/echo","version":"0.1.0","engines":{"aicut":"*"},"host":"./host.js"}"#,
    )
    .unwrap();
    std::fs::write(
        source.join("host.js"),
        r#"globalThis.__AICUT_PLUGIN__={id:"@demo/echo",run(input){return "echo:"+input.text;}};"#,
    )
    .unwrap();

    service::install_local(&host, &source, "1.4.0").unwrap();
    service::start(&host, "@demo/echo").unwrap();
    assert_eq!(service::running(&host), vec!["@demo/echo".to_string()]);
    let output = service::invoke(&host, "@demo/echo", r#"{"text":"hi"}"#).unwrap();
    assert_eq!(output, "echo:hi");
    service::stop(&host, "@demo/echo");
    assert!(service::running(&host).is_empty());
}

#[test]
fn start_rejects_a_plugin_without_a_host_half() {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    let temp = TempDir::new().unwrap();
    let source = plugin_dir(&temp, "@demo/clientonly");
    service::install_local(&host, &source, "1.4.0").unwrap();
    let error = service::start(&host, "@demo/clientonly").unwrap_err();
    assert!(error.contains("host"), "{}", error);
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml --test plugin_host`
Expected: 编译失败 —— `start` 不存在

- [ ] **Step 3: 写实现**

`service.rs` 增加：

```rust
/// 运行中的宿主半：`plugin id → HostRuntime`。
static RUNNING: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, super::runtime::HostRuntime>>> =
    std::sync::OnceLock::new();

fn running_map() -> &'static std::sync::Mutex<std::collections::HashMap<String, super::runtime::HostRuntime>> {
    RUNNING.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

pub fn start(host: &Arc<dyn Host>, id: &str) -> Result<(), String> {
    let root = root(host);
    let registry = load(&root)?;
    let record = registry.plugins.iter().find(|item| item.id == id)
        .ok_or_else(|| format!("名册里没有插件 {id}"))?;
    let status = scan(&root, record, "0.0.0");
    let host_file = status.host_file
        .ok_or_else(|| format!("插件 {id} 没有宿主半（host.js）"))?;
    let source = std::fs::read_to_string(&host_file)
        .map_err(|error| format!("读 host.js 失败：{error}"))?;
    let runtime = super::runtime::HostRuntime::spawn(id.to_string(), source, Default::default())?;
    running_map().lock().unwrap().insert(id.to_string(), runtime);
    Ok(())
}

pub fn invoke(host: &Arc<dyn Host>, id: &str, input: &str) -> Result<String, String> {
    let _ = host;
    let map = running_map().lock().unwrap();
    let runtime = map.get(id).ok_or_else(|| format!("插件 {id} 的宿主半没有运行"))?;
    runtime.invoke(input.to_string())
}

pub fn stop(host: &Arc<dyn Host>, id: &str) {
    let _ = host;
    if let Some(runtime) = running_map().lock().unwrap().remove(id) {
        runtime.stop();
    }
}

pub fn running(_host: &Arc<dyn Host>) -> Vec<String> {
    let mut ids: Vec<String> = running_map().lock().unwrap().keys().cloned().collect();
    ids.sort();
    ids
}
```

`rpc.rs` 三个 arm（照 `plugin_host_list` 的写法），`src-tauri` 三个命令 + `generate_handler` 三项。

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path crates/daemon/Cargo.toml --test plugin_host`
Expected: 6 passed（原有 4 + 新增 2）

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src crates/daemon/tests src-tauri/src
git commit -m "feat(plugin-host): 宿主半启停与调用 RPC"
```

---

### Task 4: 前端 `ctx.host` 与启停接线

**Files:**
- Modify: `src/core/pluginHostApi.ts`、`src/core/plugins/context.ts`、`src/stores/pluginHost.ts`
- Test: `src/core/__tests__/pluginHostApi.test.ts`（追加）、`src/core/plugins/__tests__/hostBridge.test.ts`

**Interfaces:**
- Produces:
  - `pluginHostStart(id)` / `pluginHostInvoke(id, input)` / `pluginHostStop(id)`
  - `PluginContext.host: { run(input: string): Promise<string> }`
  - store：`loadOne` 前 `pluginHostStart`（仅当 `hostFile` 存在），`setEnabled(false)` / `remove` 时 `pluginHostStop`

- [ ] **Step 1: 写失败测试**

```ts
// src/core/plugins/__tests__/hostBridge.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { id: string; input: string }[] = [];
vi.mock("@/core/pluginHostApi", () => ({
  pluginHostInvoke: async (id: string, input: string) => {
    calls.push({ id, input });
    return "echo:hi";
  },
}));

import { disposeAll, loadPluginModule } from "../loader";

afterEach(() => disposeAll());

describe("plugin host bridge", () => {
  it("forwards run() to the daemon and returns its output", async () => {
    loadPluginModule(
      { id: "@demo/host", url: "memory:" },
      {
        id: "@demo/host",
        apply(ctx) {
          void ctx.host.run('{"text":"hi"}').then((output) => {
            expect(output).toBe("echo:hi");
          });
        },
      },
    );
    await Promise.resolve();
    expect(calls).toEqual([{ id: "@demo/host", input: '{"text":"hi"}' }]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/plugins/__tests__/hostBridge.test.ts`
Expected: FAIL —— `ctx.host` 不存在

- [ ] **Step 3: 写实现**

- `pluginHostApi.ts`：三个函数（`invoke<{ output: string }>`、`invoke<{ running: boolean }>`）；
- `context.ts`：`PluginContext` 加 `host: { run(input: string): Promise<string> }`，实现直接调 `pluginHostInvoke(pluginId, input)`；
- `stores/pluginHost.ts`：`loadOne` 里 `if (entry.hostFile) await pluginHostStart(entry.id)`（失败按 `note()` 记录但**不阻断**客户端半）；`setEnabled(false)` / `remove` 里 `pluginHostStop(id)`。

- [ ] **Step 4: 跑测试与类型检查**

Run: `npx vitest run src/core/plugins src/stores/__tests__/pluginHost.test.ts && npx vue-tsc --noEmit -p tsconfig.json`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/core src/stores
git commit -m "feat(plugins): 客户端 ctx.host 桥与宿主半启停"
```

---

### Task 5: 示例插件（host 半）+ 端到端

**Files:**
- Create: `examples/plugin-echo/{aicut.plugin.json,package.json,client.js,host.js,README.md}`
- Test: `src/core/plugins/__tests__/exampleEcho.test.ts`

**Interfaces:**
- 插件 id：`@aicut/plugin-echo`
- 客户端半：注册节点 `ext.echo.text`（输入文本，输出文本），adapter 把 `io.text("in")` 交给 `ctx.host.run`
- 宿主半：`run(input)` 返回 `"echo: " + input.text`，并把最近一次输入存进 `ctx.storage`

- [ ] **Step 1: 写失败测试**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterFor } from "@/core/board/adapters";
import { disposeAll, loadPluginModule, type PluginClientModule } from "../loader";

vi.mock("@/core/pluginHostApi", () => ({
  pluginHostInvoke: async (_id: string, input: string) =>
    `echo: ${(JSON.parse(input) as { text: string }).text}`,
}));

// @ts-ignore 示例是纯 JS
import example from "../../../../examples/plugin-echo/client.js";

afterEach(() => disposeAll());

describe("example echo plugin", () => {
  it("forwards the input text to its host half", async () => {
    const module = example as PluginClientModule;
    loadPluginModule({ id: module.id, url: "examples/plugin-echo/client.js" }, module);
    const run = adapterFor("ext.echo.text")!;
    const result = await run({
      node: { id: "n1", type: "ext.echo.text", position: { x: 0, y: 0 }, data: { params: {}, bindings: {} } },
      nodeId: "n1",
      signal: new AbortController().signal,
      io: { param: () => undefined, text: () => "hi", asset: () => null, refs: () => [], progress: () => {} },
    });
    expect(result.text).toBe("echo: hi");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/core/plugins/__tests__/exampleEcho.test.ts`
Expected: FAIL —— 文件不存在

- [ ] **Step 3: 写示例**

`client.js`（注册节点 + 转发宿主半）：

```js
export default {
  id: "@aicut/plugin-echo",
  apply(ctx) {
    ctx.i18n.register({ zh: { name: "回显" }, en: { name: "Echo" } });
    ctx.nodes.register(
      {
        type: "ext.echo.text",
        titleKey: "@aicut/plugin-echo.name",
        category: "model",
        order: 901,
        inputs: [{ id: "in", type: "text", labelKey: "@aicut/plugin-echo.name" }],
        outputs: [{ id: "out", type: "text", labelKey: "@aicut/plugin-echo.name" }],
        params: [],
        defaultSize: { width: 320, height: 200 },
        cost: { lane: "api", ramMb: 16 },
      },
      async ({ io }) => {
        const output = await ctx.host.run(JSON.stringify({ text: io.text("in") ?? "" }));
        return { text: output };
      },
    );
  },
};
```

`host.js`：

```js
globalThis.__AICUT_PLUGIN__ = {
  id: "@aicut/plugin-echo",
  run(input) {
    ctx.storage.set("last", input);
    ctx.log("echo: " + input);
    return "echo: " + JSON.parse(input).text;
  },
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/core/plugins/__tests__/exampleEcho.test.ts`
Expected: 1 passed

- [ ] **Step 5: 手测（无法自动化的部分）**

1. 导入 `examples/plugin-echo` → 面板显示 `hostFile`；
2. 画布加「回显」节点、上游接文本 → 运行，输出 `echo: <上游文本>`；
3. 禁用 → 宿主半线程退出（`plugin_host_list` 里 `running` 为空）。

- [ ] **Step 6: Commit**

```bash
git add examples/plugin-echo src/core/plugins/__tests__
git commit -m "feat(plugins): 带宿主半的示例插件与端到端用例"
```

---

## 收尾验收（M2）

- [ ] `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host`（含 runtime / bindings）
- [ ] `cargo test --manifest-path crates/daemon/Cargo.toml --test plugin_host`
- [ ] `pnpm test`、`pnpm build`
- [ ] 手测第 1–3 条
- [ ] 超时用例证明死循环插件不会拖死 daemon

---

## 执行记录（M2 · 2026-11-17）

| 任务 | 结果 |
| --- | --- |
| T1 QuickJS actor（线程 + Runtime + 中断 + 超时） | ✅ 6 用例 |
| T2 `ctx` 能力注入（log/storage/media/http×3/cancelled） | ✅ 6 用例（含本机 HTTP 真请求） |
| T3 服务层 start/invoke/stop + RPC + Tauri | ✅ 2 端到端用例 |
| T4 前端 `ctx.host.run` + store 启停接线 | ✅ 8 store 用例 |
| T5 `examples/plugin-echo`（客户端半 + 宿主半） | ✅ 2 用例 |
| 全部 | 提交 `ea12ab4` |

**验收证据**

- `cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::`：**33 passed**
- `cargo test --manifest-path crates/daemon/Cargo.toml --test plugin_host`：**6 passed**（含 `start_invoke_stop_round_trip`：真实起 QuickJS、跑 `run()`、写 storage）
- `cargo test --manifest-path crates/daemon/Cargo.toml`：全量通过
- `pnpm test`：**114 文件 / 790 用例**
- `pnpm build`：通过

**执行期发现并修掉的两个真问题**

1. **QuickJS `JS_FreeRuntime` 断言（GC 对象未释放）**：闭包里捕获 `rquickjs::Ctx` 会把 JS 上下文永久挂在函数对象上，卸载时 QuickJS 断言 `list_empty(&rt->gc_obj_list)` 直接 `SIGABRT`。
   - 修法：闭包改签名为 `move |cx: Ctx, ...|`（rquickjs 会把当前 Ctx 作为首参传进来），不再捕获 `Ctx`；
   - 另外 `Context` 必须先于 `Runtime` 析构（结构体字段按声明顺序析构，`ctx` 字段要写在 `_rt` 前面）。
2. **`rustls-no-provider` 的加密实现缺失**：`NetworkRuntime::client()` 是进程里所有 HTTP 客户端的唯一入口，但只有 `fonts.rs` 装过 ring provider。已把 `install_default()` 幂等地放进 `client_builder()`，插件 / 云端 / 字体共用。

**偏差**

- T2 的 `ctx.http` 一开始计划留成「未启用」占位，实际直接实现了 `request` / `download` / `multipart`——因为 H3 那类「multipart 上传 + 轮询 + 直链下载」只能在宿主半做，留占位会让 M4 返工。
- 计划里的独立 `hostBridge.test.ts` 由 `exampleEcho.test.ts` 覆盖（同样验证 `ctx.host.run` → RPC → 结果回传），少写一个重复用例。
- `plugin_host_invoke` / `plugin_host_stop` 的 Tauri 版不需要 `Host`（运行态是进程级单例），只 `plugin_host_start` 带 `app` 与 `network`。

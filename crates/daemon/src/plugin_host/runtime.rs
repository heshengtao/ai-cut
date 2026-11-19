//! 每插件一个 actor 线程 + 一个 QuickJS Runtime。
//!
//! 为什么是「线程 + 通道」而不是 async：QuickJS 运行时是线程绑定的，而且宿主半
//! 用的是**同步 API**（需要网络时在插件自己的线程上阻塞），阻塞的绝不能是 daemon
//! 的执行器。js 侧只有 `run(input): string` 一个入口，输入输出都是 JSON 文本。

use std::path::PathBuf;
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

/// 起一个宿主半需要的全部外部输入。
pub struct SpawnOptions {
    pub budget: Budget,
    /// `<config>/plugins/data/<safe-id>`：storage 与产物都落在这里。
    pub data_root: PathBuf,
    pub net: Option<super::NetHandle>,
}

impl Default for Budget {
    fn default() -> Self {
        // 宿主半是**同步**的：一次 `run()` 往往要「提交任务 → 排队 → 轮询到生成结束 →
        // 下载」，十分钟上下很常见（插件靠 `ctx.sleep` 轮询）。30 秒会把正常任务当失控
        // 脚本打断，所以默认给足 30 分钟；用户中途取消走 `cancel()`（`ctx.cancelled()`
        // 会变 true），不会真等满。
        Self {
            timeout: Duration::from_secs(30 * 60),
        }
    }
}

enum Command {
    Invoke {
        input: String,
        reply: Sender<Result<String, String>>,
    },
    Stop(Sender<()>),
}

pub struct HostRuntime {
    plugin_id: String,
    tx: Option<Sender<Command>>,
    budget: Budget,
    /// 与 JS 侧 `ctx.cancelled()` 同一个标志：置位后中断处理器会打断正在跑的脚本。
    cancelled: Arc<Mutex<bool>>,
}

impl HostRuntime {
    /// 起一个 actor：先建 Runtime、注入 `ctx`、执行脚本，再进入命令循环。
    ///
    /// 创建失败（语法错、没有导出、注入失败）会在本函数里返回，线程随之退出；
    /// 之后 `invoke` 只会拿到「已停止」之类的错误，不会 panic。
    pub fn spawn(plugin_id: String, source: String, options: SpawnOptions) -> Result<Self, String> {
        let budget = options.budget;
        let cancelled = Arc::new(Mutex::new(false));
        let (tx, rx) = channel::<Command>();
        let (ready_tx, ready_rx) = channel::<Result<(), String>>();
        let id = plugin_id.clone();
        let flag = cancelled.clone();

        thread::Builder::new()
            .name(format!("plugin-{id}"))
            .spawn(move || {
                let mut state = match PluginState::load(&id, &source, options, flag) {
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
                budget,
                cancelled,
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

    /// 请求取消：置位后 JS 侧的中断处理器会在下一条字节码处打断正在跑的 `run()`。
    ///
    /// 不需要等 actor 空闲——它正卡在一次长轮询里也照样生效（这正是 `stop` 卡不住
    /// 正在运行的任务的原因）。
    pub fn cancel(&self) {
        *self.cancelled.lock().unwrap() = true;
    }

    pub fn invoke(&self, input: String) -> Result<String, String> {
        let Some(tx) = &self.tx else {
            return Err("插件宿主半已停止".to_string());
        };
        // 每次调用都是一次新的运行：上一次被取消不该毒化这一次（取消只作用于当前这次）。
        *self.cancelled.lock().unwrap() = false;
        let (reply_tx, reply_rx) = channel();
        tx.send(Command::Invoke {
            input,
            reply: reply_tx,
        })
        .map_err(|_| "插件宿主半已停止".to_string())?;
        // JS 侧的中断处理器负责在超时后打断脚本；这里只等结果（多留 2 秒余量）。
        reply_rx
            .recv_timeout(self.budget.timeout + Duration::from_secs(2))
            .map_err(|_| "插件调用超时".to_string())?
    }

    pub fn stop(&self) {
        // 先置取消标志：正在跑的 `run()` 会在下一条字节码处被打断，actor 才能走到
        // `Command::Stop`（否则它要等整次调用跑完，长任务等于停不下来）。
        self.cancel();
        if let Some(tx) = &self.tx {
            let (ack_tx, ack_rx) = channel();
            if tx.send(Command::Stop(ack_tx)).is_ok() {
                let _ = ack_rx.recv_timeout(Duration::from_secs(2));
            }
        }
    }
}

struct PluginState {
    // 顺序有意：**字段按声明顺序析构**。Context 必须先于 Runtime 被丢弃，
    // 否则 QuickJS 在 JS_FreeRuntime 时断言「还有未释放的 GC 对象」。
    ctx: Context,
    _rt: Runtime,
    deadline: Arc<Mutex<Option<Instant>>>,
    cancelled: Arc<Mutex<bool>>,
    budget: Budget,
}

impl PluginState {
    fn load(
        _plugin_id: &str,
        source: &str,
        options: SpawnOptions,
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

        super::bindings::install(
            &ctx,
            &options.data_root,
            options.net.clone(),
            cancelled.clone(),
        )?;

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
            let has_entry = ctx
                .globals()
                .get::<_, Object>("__AICUT_PLUGIN__")
                .is_ok();
            if !has_entry {
                return Err("host.js 必须设置 globalThis.__AICUT_PLUGIN__ = { id, run }".to_string());
            }
            Ok::<(), String>(())
        })?;

        Ok(Self {
            ctx,
            _rt: rt,
            deadline,
            cancelled,
            budget: options.budget,
        })
    }

    fn invoke(&mut self, input: &str) -> Result<String, String> {
        if *self.cancelled.lock().unwrap() {
            return Err("插件已被停止".to_string());
        }
        *self.deadline.lock().unwrap() = Some(Instant::now() + self.budget.timeout);
        let result = self.ctx.with(|ctx| {
            let globals = ctx.globals();
            let plugin: Object = globals
                .get("__AICUT_PLUGIN__")
                .map_err(|error| format!("取插件入口失败：{error}"))?;
            let run: Function = plugin
                .get("run")
                .map_err(|_| "插件入口缺少 run(input)".to_string())?;
            run.call::<_, String>((input.to_string(),)).map_err(|error| {
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
            // 中断处理器已经打断脚本：把「取消」翻译成一句人能读的原因
            // （`result` 这时是 QuickJS 的 interrupted 异常）。
            return Err("插件运行已取消".to_string());
        }
        result
    }

    fn stop(&mut self) {
        *self.cancelled.lock().unwrap() = true;
        *self.deadline.lock().unwrap() = Some(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str = r#"
      globalThis.__AICUT_PLUGIN__ = {
        id: "demo",
        run(input) { return "hello " + JSON.parse(input).name; },
      };
    "#;

    fn options(timeout: Duration) -> (tempfile::TempDir, SpawnOptions) {
        let dir = tempfile::TempDir::new().unwrap();
        let data_root = dir.path().to_path_buf();
        (
            dir,
            SpawnOptions {
                budget: Budget { timeout },
                data_root,
                net: None,
            },
        )
    }

    #[test]
    fn invokes_the_plugin_entry() {
        let (_dir, options) = options(Duration::from_secs(30));
        let runtime = HostRuntime::spawn("demo".into(), SCRIPT.into(), options).unwrap();
        let out = runtime.invoke(r#"{"name":"world"}"#.into()).unwrap();
        assert_eq!(out, "hello world");
        runtime.stop();
    }

    #[test]
    fn rejects_a_script_without_an_entry() {
        let (_dir, options) = options(Duration::from_secs(30));
        let error = HostRuntime::spawn("demo".into(), "var x = 1;".into(), options)
            .err()
            .expect("必须失败");
        assert!(error.contains("__AICUT_PLUGIN__"), "{}", error);
    }

    #[test]
    fn rejects_a_syntax_error() {
        let (_dir, options) = options(Duration::from_secs(30));
        let error = HostRuntime::spawn("demo".into(), "function (".into(), options)
            .err()
            .expect("必须失败");
        assert!(!error.is_empty());
    }

    #[test]
    fn interrupts_a_runaway_script() {
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "spin", run() { while (true) {} } };
        "#;
        let (_dir, options) = options(Duration::from_millis(120));
        let runtime = HostRuntime::spawn("spin".into(), script.into(), options).unwrap();
        let error = runtime.invoke("{}".into()).unwrap_err();
        assert!(error.contains("抛错") || error.contains("超时"), "{}", error);
    }

    #[test]
    fn reports_an_exception_from_run() {
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "boom", run() { throw new Error("nope"); } };
        "#;
        let (_dir, options) = options(Duration::from_secs(30));
        let runtime = HostRuntime::spawn("boom".into(), script.into(), options).unwrap();
        let error = runtime.invoke("{}".into()).unwrap_err();
        assert!(error.contains("nope"), "{}", error);
    }

    #[test]
    fn stop_is_idempotent_and_invoke_after_stop_fails() {
        let (_dir, options) = options(Duration::from_secs(30));
        let runtime = HostRuntime::spawn("demo".into(), SCRIPT.into(), options).unwrap();
        runtime.stop();
        runtime.stop();
        assert!(runtime.invoke("{}".into()).is_err());
    }
}

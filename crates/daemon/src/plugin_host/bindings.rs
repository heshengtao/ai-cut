//! 宿主半的 `ctx` 注入。
//!
//! 能力面刻意小：日志、键值存储、产物落盘、HTTP（request / download / multipart）、
//! 取消标志。没有 `fs` / `require` / `process`——插件要读写文件只能把路径交给宿主代办。
//!
//! 所有函数都是**同步**的：actor 线程不是 tokio 线程，用 `Handle::block_on` 在插件
//! 自己的线程上等网络结果，不会占住 daemon 的执行器。

use std::path::{Path, PathBuf};
use std::sync::Once;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use rquickjs::{Ctx, Exception, Function, Object};

use super::NetHandle;

const STORAGE_FILE: &str = "storage.json";

/// reqwest 用 `rustls-no-provider`：进程里必须显式装一个加密实现（ring）。
/// 字体下载那边也装过一次，这里再装一次是幂等的（重复安装返回 Err，忽略即可）。
fn ensure_crypto_provider() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}
const OUT_DIR: &str = "out";
const MAX_BODY_BYTES: usize = 256 * 1024 * 1024;

pub fn install(
    ctx: &rquickjs::Context,
    data_root: &Path,
    net: Option<NetHandle>,
    cancelled: Arc<Mutex<bool>>,
) -> Result<(), String> {
    ensure_crypto_provider();
    let root = data_root.to_path_buf();
    std::fs::create_dir_all(root.join(OUT_DIR))
        .map_err(|error| format!("创建插件数据目录失败：{error}"))?;

    ctx.with(|ctx| {
        let globals = ctx.globals();
        let api = Object::new(ctx.clone()).map_err(|error| error.to_string())?;

        api.set(
            "log",
            Function::new(ctx.clone(), |message: String| {
                println!("[plugin] {message}");
            })
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        // ---- storage ----
        let storage = Object::new(ctx.clone()).map_err(|error| error.to_string())?;
        let root_get = root.clone();
        storage
            .set(
                "get",
                Function::new(ctx.clone(), move |key: String| -> Option<String> {
                    read_storage(&root_get).get(&key).cloned()
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

        // ---- media ----
        let media = Object::new(ctx.clone()).map_err(|error| error.to_string())?;
        let root_media = root.clone();
        media
            .set(
                "save",
                Function::new(
                    ctx.clone(),
                    move |cx: Ctx,
                          bytes_b64: String,
                          name: String|
                          -> Result<String, rquickjs::Error> {
                        save_media(&root_media, &bytes_b64, &name)
                            .map_err(|error| Exception::throw_message(&cx, &error))
                    },
                )
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
        api.set("media", media).map_err(|error| error.to_string())?;

        // ---- http ----
        let http = Object::new(ctx.clone()).map_err(|error| error.to_string())?;
        let net_request = net.clone();
        http.set(
            "request",
            Function::new(
                ctx.clone(),
                move |cx: Ctx,
                      method: String,
                      url: String,
                      headers: String,
                      body: String|
                      -> Result<String, rquickjs::Error> {
                    let net = require_net(&net_request)
                        .map_err(|error| Exception::throw_message(&cx, &error))?;
                    request_text(&net, &method, &url, &headers, &body)
                        .map_err(|error| Exception::throw_message(&cx, &error))
                },
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        let net_download = net.clone();
        let root_download = root.clone();
        http.set(
            "download",
            Function::new(
                ctx.clone(),
                move |cx: Ctx,
                      url: String,
                      headers: String,
                      name: String|
                      -> Result<String, rquickjs::Error> {
                    let net = require_net(&net_download)
                        .map_err(|error| Exception::throw_message(&cx, &error))?;
                    download_bytes(&net, &url, &headers)
                        .and_then(|bytes| write_out(&root_download, &bytes, &name))
                        .map_err(|error| Exception::throw_message(&cx, &error))
                },
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        let net_upload = net.clone();
        http.set(
            "multipart",
            Function::new(
                ctx.clone(),
                move |cx: Ctx,
                      url: String,
                      fields: String,
                      files: String,
                      headers: String,
                      method: String|
                      -> Result<String, rquickjs::Error> {
                    let net = require_net(&net_upload)
                        .map_err(|error| Exception::throw_message(&cx, &error))?;
                    multipart(&net, &method, &url, &fields, &files, &headers)
                        .map_err(|error| Exception::throw_message(&cx, &error))
                },
            )
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        api.set("http", http).map_err(|error| error.to_string())?;

        // ---- sleep ----
        // 宿主半是同步的，轮询需要「等一会儿又不想空转 CPU」：这里阻塞的是插件自己的线程。
        api.set(
            "sleep",
            Function::new(ctx.clone(), |ms: i64| {
                let capped = ms.clamp(0, 60_000) as u64;
                std::thread::sleep(std::time::Duration::from_millis(capped));
            })
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        // ---- cancelled ----
        let flag = cancelled;
        api.set(
            "cancelled",
            Function::new(ctx.clone(), move || -> bool { *flag.lock().unwrap() })
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

        globals.set("ctx", api).map_err(|error| error.to_string())
    })
}

fn require_net(net: &Option<NetHandle>) -> Result<NetHandle, String> {
    net.clone()
        .ok_or_else(|| "这个插件的宿主半没有网络能力".to_string())
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

fn read_storage(root: &Path) -> std::collections::BTreeMap<String, String> {
    std::fs::read_to_string(root.join(STORAGE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_storage(root: &Path, map: &std::collections::BTreeMap<String, String>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(map).map_err(|error| error.to_string())?;
    let temp = root.join(format!("{STORAGE_FILE}.tmp"));
    std::fs::write(&temp, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, root.join(STORAGE_FILE)).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

fn save_media(root: &Path, bytes_b64: &str, name: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_b64.trim())
        .map_err(|error| format!("base64 解码失败：{error}"))?;
    write_out(root, &bytes, name)
}

fn write_out(root: &Path, bytes: &[u8], name: &str) -> Result<String, String> {
    if name.trim().is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("产物文件名不合法：{name}"));
    }
    let dir = root.join(OUT_DIR);
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建产物目录失败：{error}"))?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|error| format!("写产物失败：{error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------

fn header_map(headers: &str) -> Result<Vec<(String, String)>, String> {
    if headers.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(headers).map_err(|error| format!("headers 不是合法 JSON：{error}"))?;
    let mut out = Vec::new();
    if let Some(map) = value.as_object() {
        for (key, item) in map {
            if let Some(text) = item.as_str() {
                out.push((key.clone(), text.to_string()));
            }
        }
    }
    Ok(out)
}

/// 把 reqwest 错误连同**底层原因**一起打出来。
///
/// 只 `to_string()` 的话只会得到一句「error sending request for url (…)」——连接被拒、
/// DNS、TLS、超时全被吞掉，插件作者和用户都无从下手。
fn describe(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut cause = std::error::Error::source(error);
    while let Some(source) = cause {
        text.push_str(&format!(" ← {source}"));
        cause = source.source();
    }
    let kind = if error.is_connect() {
        "连接失败"
    } else if error.is_timeout() {
        "超时"
    } else if error.is_body() {
        "读取响应体失败"
    } else {
        ""
    };
    if !kind.is_empty() {
        text.push_str(&format!("（{kind}）"));
    }
    text
}

fn apply_headers(
    mut request: reqwest::RequestBuilder,
    headers: &str,
) -> Result<reqwest::RequestBuilder, String> {
    for (key, value) in header_map(headers)? {
        request = request.header(key, value);
    }
    Ok(request)
}

/// 幂等请求的重试次数与退避（毫秒）。
///
/// 长任务插件会在一根长连接上连着轮询几百次（1.2 秒一次、几分钟），中途被服务端 /
/// 中间代理掐掉一次连接是很常见的；以前这一下就把整次运行打死了。GET / HEAD 重发不会
/// 产生副作用，所以宿主替插件重试；POST 一律不重试（可能重复下单 / 重复扣积分）。
const IDEMPOTENT_RETRIES: usize = 2;
const RETRY_BACKOFF_MS: [u64; 2] = [300, 800];

fn retryable(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_request() || error.is_timeout()
}

fn request_text(
    net: &NetHandle,
    method: &str,
    url: &str,
    headers: &str,
    body: &str,
) -> Result<String, String> {
    let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|error| format!("HTTP 方法不合法：{error}"))?;
    let idempotent = matches!(method, reqwest::Method::GET | reqwest::Method::HEAD);
    let retries = if idempotent { IDEMPOTENT_RETRIES } else { 0 };
    let client = net.client.clone();
    let url = url.to_string();
    let headers = headers.to_string();
    let body = body.to_string();
    net.handle.block_on(async move {
        let mut attempt = 0usize;
        loop {
            let mut request = client.request(method.clone(), &url);
            request = apply_headers(request, &headers)?;
            if !body.is_empty() {
                request = request.body(body.clone());
            }
            let error = match request.send().await {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let text = response
                        .text()
                        .await
                        .map_err(|error| format!("读取响应失败：{}", describe(&error)))?;
                    return Ok(serde_json::json!({ "status": status, "text": text }).to_string());
                }
                Err(error) => error,
            };
            if attempt < retries && retryable(&error) {
                tokio::time::sleep(std::time::Duration::from_millis(RETRY_BACKOFF_MS[attempt])).await;
                attempt += 1;
                continue;
            }
            let hint = if retries == 0 {
                ""
            } else {
                "（已重试，仍失败）"
            };
            return Err(format!("请求失败：{}{hint}", describe(&error)));
        }
    })
}

/// 按扩展名猜 multipart 的 Content-Type（猜不到就不设，交给 reqwest 的默认值）。
fn mime_for(name: &str) -> Option<&'static str> {
    let extension = Path::new(name).extension()?.to_string_lossy().to_ascii_lowercase();
    Some(match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => return None,
    })
}

fn download_bytes(net: &NetHandle, url: &str, headers: &str) -> Result<Vec<u8>, String> {
    let client = net.client.clone();
    let url = url.to_string();
    let headers = headers.to_string();
    net.handle.block_on(async move {
        let request = client.get(&url);
        let request = apply_headers(request, &headers)?;
        let response = request
            .send()
            .await
            .map_err(|error| format!("下载失败：{}", describe(&error)))?;
        if !response.status().is_success() {
            return Err(format!("下载返回 HTTP {}", response.status().as_u16()));
        }
        let bytes = response.bytes().await.map_err(|error| format!("读取下载内容失败：{error}"))?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err("下载内容超过 256 MB 上限".to_string());
        }
        Ok(bytes.to_vec())
    })
}

fn multipart(
    net: &NetHandle,
    method: &str,
    url: &str,
    fields: &str,
    files: &str,
    headers: &str,
) -> Result<String, String> {
    let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|error| format!("HTTP 方法不合法：{error}"))?;
    let field_map: serde_json::Value = if fields.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(fields).map_err(|error| format!("fields 不是合法 JSON：{error}"))?
    };
    let file_map: serde_json::Value = if files.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(files).map_err(|error| format!("files 不是合法 JSON：{error}"))?
    };
    let mut form = reqwest::multipart::Form::new();
    if let Some(map) = field_map.as_object() {
        for (key, value) in map {
            let text = match value {
                serde_json::Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            form = form.text(key.clone(), text);
        }
    }
    if let Some(map) = file_map.as_object() {
        for (key, value) in map {
            let Some(path) = value.as_str() else { continue };
            let bytes = std::fs::read(path)
                .map_err(|error| format!("读取上传文件失败（{path}）：{error}"))?;
            let name = PathBuf::from(path)
                .file_name()
                .map(|item| item.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file.bin".to_string());
            // 按扩展名补 Content-Type：不少服务端（例如 MiniMax 代理）按 MIME 判断
            // 素材类型，缺省 application/octet-stream 会被当成「不认识的格式」。
            let mime = mime_for(&name);
            let mut part = reqwest::multipart::Part::bytes(bytes).file_name(name);
            if let Some(mime) = mime {
                // 取的全是内置常量，只有「不是合法 MIME 字面量」才会失败——那是编码错误。
                part = part.mime_str(mime).expect("内置 MIME 常量应当合法");
            }
            form = form.part(key.clone(), part);
        }
    }
    let client = net.client.clone();
    let url = url.to_string();
    let headers = headers.to_string();
    net.handle.block_on(async move {
        let request = client.request(method, &url);
        let request = apply_headers(request, &headers)?;
        let response = request
            .multipart(form)
            .send()
            .await
            .map_err(|error| format!("提交失败：{}", describe(&error)))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .await
            .map_err(|error| format!("读取响应失败：{}", describe(&error)))?;
        Ok(serde_json::json!({ "status": status, "text": text }).to_string())
    })
}

/// 给测试用：在一个独立 Runtime 里跑脚本，走完整的 `ctx` 注入。
#[cfg(test)]
pub(crate) fn run_script(
    root: &Path,
    script: &str,
    net: Option<NetHandle>,
) -> Result<String, String> {
    let rt = rquickjs::Runtime::new().map_err(|error| error.to_string())?;
    let ctx = rquickjs::Context::full(&rt).map_err(|error| error.to_string())?;
    install(&ctx, root, net, Arc::new(Mutex::new(false)))?;
    let result = ctx.with(|ctx| {
        ctx.eval::<(), _>(script)
            .map_err(|error| format!("脚本执行失败：{error}"))?;
        let plugin: Object = ctx
            .globals()
            .get("__AICUT_PLUGIN__")
            .map_err(|error| format!("没有 __AICUT_PLUGIN__：{error}"))?;
        let run: Function = plugin.get("run").map_err(|error| error.to_string())?;
        run.call::<_, String>(("{}",))
            .map_err(|error| format!("run 抛错：{error}"))
    });
    // QuickJS 要求 Context 先于 Runtime 释放，否则 JS_FreeRuntime 会断言失败。
    drop(ctx);
    drop(rt);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_round_trips_inside_the_plugin_data_dir() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "s", run() {
            ctx.storage.set("k", "v");
            return ctx.storage.get("k");
          } };
        "#;
        assert_eq!(run_script(dir.path(), script, None).unwrap(), "v");
        assert!(dir.path().join(STORAGE_FILE).is_file());
    }

    #[test]
    fn media_save_writes_bytes_and_returns_a_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "m", run() {
            return ctx.media.save("aGVsbG8=", "hello.txt");
          } };
        "#;
        let path = run_script(dir.path(), script, None).unwrap();
        assert!(std::path::Path::new(&path).is_file());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn media_save_rejects_path_traversal() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "m", run() {
            try { ctx.media.save("aGVsbG8=", "../escape.txt"); return "no"; }
            catch (error) { return "blocked"; }
          } };
        "#;
        assert_eq!(run_script(dir.path(), script, None).unwrap(), "blocked");
        assert!(!dir.path().parent().unwrap().join("escape.txt").exists());
    }

    #[test]
    fn sleep_blocks_for_at_least_the_requested_time() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "s", run() {
            const started = Date.now();
            ctx.sleep(40);
            return String(Date.now() - started >= 30);
          } };
        "#;
        assert_eq!(run_script(dir.path(), script, None).unwrap(), "true");
    }

    #[test]
    fn cancelled_flag_is_visible() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "c", run() { return String(ctx.cancelled()); } };
        "#;
        assert_eq!(run_script(dir.path(), script, None).unwrap(), "false");
    }

    #[test]
    fn http_without_network_reports_a_clear_error() {
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "h", run() {
            try { ctx.http.request("GET", "https://example.com", "", ""); return "no"; }
            catch (error) { return "blocked"; }
          } };
        "#;
        assert_eq!(run_script(dir.path(), script, None).unwrap(), "blocked");
    }

    #[test]
    fn http_request_hits_a_local_server() {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            if let Ok((mut stream, _)) = server.accept() {
                let mut buffer = [0u8; 1024];
                let _ = stream.read(&mut buffer);
                let body = "{\"ok\":true}";
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        let runtime = tokio::runtime::Runtime::new().unwrap();
        // 生产路径由 `require_net` 负责装加密实现，测试里绕过了它，自己补一次。
        ensure_crypto_provider();
        let net = NetHandle {
            handle: runtime.handle().clone(),
            client: reqwest::Client::new(),
        };
        let dir = tempfile::TempDir::new().unwrap();
        let script = format!(
            r#"
          globalThis.__AICUT_PLUGIN__ = {{ id: "h", run() {{
            const response = JSON.parse(ctx.http.request("GET", "http://{addr}/", "", ""));
            return String(response.status) + ":" + JSON.parse(response.text).ok;
          }} }};
        "#
        );
        assert_eq!(run_script(dir.path(), &script, Some(net)).unwrap(), "200:true");
    }

    /// 生产那条路径：`net_handle()` 的**自有运行时** + 真实 reqwest 请求。
    fn production_net() -> NetHandle {
        ensure_crypto_provider();
        NetHandle {
            handle: super::super::net_handle(),
            client: crate::network::NetworkRuntime::load(None).client().unwrap(),
        }
    }

    /// 一个「先掐一次连接、再正常响应」的本地服务器，返回地址与命中次数。
    fn flaky_server() -> (std::net::SocketAddr, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&hits);
        std::thread::spawn(move || {
            for stream in server.incoming() {
                let Ok(mut stream) = stream else { break };
                let index = counter.fetch_add(1, Ordering::SeqCst);
                let mut buffer = [0u8; 2048];
                let _ = stream.read(&mut buffer);
                if index == 0 {
                    // 长连接被服务端 / 中间代理掐掉：读到请求就直接断开，不给响应。
                    drop(stream);
                    continue;
                }
                let body = "{\"ok\":true}";
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        (addr, hits)
    }

    #[test]
    fn get_is_retried_after_the_connection_drops() {
        // 真实事故：插件轮询到第几百次时连接被掐，整次运行直接失败。GET 是幂等的，
        // 宿主应当自己重试一次而不是把错误抛给插件。
        let (addr, hits) = flaky_server();
        let dir = tempfile::TempDir::new().unwrap();
        let script = format!(
            r#"
          globalThis.__AICUT_PLUGIN__ = {{ id: "r", run() {{
            const response = JSON.parse(ctx.http.request("GET", "http://{addr}/poll", "", ""));
            return String(response.status) + " hits=" + String(response.status === 200);
          }} }};
        "#
        );
        let out = run_script(dir.path(), &script, Some(production_net())).unwrap();
        assert!(out.starts_with("200"), "{out}");
        assert!(hits.load(std::sync::atomic::Ordering::SeqCst) >= 2, "应当重试过：{out}");
    }

    #[test]
    fn multipart_uploads_carry_a_content_type() {
        // MiniMax H3 这类服务端按 MIME 判断素材类型；缺省 application/octet-stream 会被拒。
        use std::io::{Read, Write};
        use std::sync::mpsc::channel;

        let dir = tempfile::TempDir::new().unwrap();
        let image = dir.path().join("first.jpg");
        std::fs::write(&image, b"\xff\xd8\xff\xd9").unwrap();

        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let (tx, rx) = channel::<String>();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = server.accept() {
                // 读超时当「请求收完了」：multipart 的字节数不确定，靠 EOF 会等死。
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(200)));
                let mut captured = Vec::new();
                let mut buffer = [0u8; 4096];
                while captured.len() < 8192 {
                    match stream.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => captured.extend_from_slice(&buffer[..count]),
                        Err(_) => break,
                    }
                }
                let _ = tx.send(String::from_utf8_lossy(&captured).into_owned());
                let body = r#"{"success":true}"#;
                let response = format!(
                    "HTTP/1.1 202 Accepted\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        let script = format!(
            r#"
          globalThis.__AICUT_PLUGIN__ = {{ id: "m", run() {{
            const response = JSON.parse(ctx.http.multipart(
              "http://{addr}/api/v1/tasks",
              JSON.stringify({{ prompt: "hi" }}),
              JSON.stringify({{ first_frame: "{path}" }}),
              "{{}}",
              "POST",
            ));
            return String(response.status);
          }} }};
        "#,
            path = image.to_string_lossy()
        );
        let out = run_script(dir.path(), &script, Some(production_net())).unwrap();
        assert_eq!(out, "202");

        let request = rx.recv().unwrap().to_ascii_lowercase();
        assert!(request.contains("content-type: image/jpeg"), "缺少 MIME:\n{request}");
    }

    #[test]
    fn connect_errors_name_the_underlying_cause() {
        // 没人监听的端口：错误里必须有底层原因和「连接失败」标记，不能只有
        // 一句「error sending request for url」。
        let dir = tempfile::TempDir::new().unwrap();
        let script = r#"
          globalThis.__AICUT_PLUGIN__ = { id: "c", run() {
            try { ctx.http.request("GET", "http://127.0.0.1:1/", "", ""); return "no"; }
            catch (error) { return String(error.message || error); }
          } };
        "#;
        let out = run_script(dir.path(), script, Some(production_net())).unwrap();
        assert!(out.contains("连接失败"), "{out}");
        assert!(out.contains("←"), "错误里应当带上底层原因：{out}");
    }
}

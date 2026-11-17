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

fn apply_headers(
    mut request: reqwest::RequestBuilder,
    headers: &str,
) -> Result<reqwest::RequestBuilder, String> {
    for (key, value) in header_map(headers)? {
        request = request.header(key, value);
    }
    Ok(request)
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
    let client = net.client.clone();
    let url = url.to_string();
    let headers = headers.to_string();
    let body = body.to_string();
    net.handle.block_on(async move {
        let mut request = client.request(method, &url);
        request = apply_headers(request, &headers)?;
        if !body.is_empty() {
            request = request.body(body);
        }
        let response = request.send().await.map_err(|error| format!("请求失败：{error}"))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .await
            .map_err(|error| format!("读取响应失败：{error}"))?;
        Ok(serde_json::json!({ "status": status, "text": text }).to_string())
    })
}

fn download_bytes(net: &NetHandle, url: &str, headers: &str) -> Result<Vec<u8>, String> {
    let client = net.client.clone();
    let url = url.to_string();
    let headers = headers.to_string();
    net.handle.block_on(async move {
        let request = client.get(&url);
        let request = apply_headers(request, &headers)?;
        let response = request.send().await.map_err(|error| format!("下载失败：{error}"))?;
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
            let part = reqwest::multipart::Part::bytes(bytes).file_name(name);
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
            .map_err(|error| format!("提交失败：{error}"))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .await
            .map_err(|error| format!("读取响应失败：{error}"))?;
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
}

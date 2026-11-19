//! 商店端到端：本地 HTTP 服务 + 真 tgz，跑「搜索 → 安装 → 卸载」。
//!
//! 只覆盖 daemon 侧；索引同时在 `plugin_host::market::*` 的单测里覆盖得更细。

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;

use aicut_daemon::host::{HeadlessHost, Host};
use aicut_daemon::plugin_host::{linked, market, registry, service};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn build_tgz(id: &str, version: &str) -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    let manifest = format!(
        r#"{{"format":1,"id":"{id}","version":"{version}","engines":{{"aicut":"*"}},"client":"./client.js"}}"#
    );
    append(&mut builder, "aicut.plugin.json", manifest.as_bytes());
    append(&mut builder, "client.js", b"export default {id, apply(){}}\n");
    builder.into_inner().unwrap().finish().unwrap()
}

fn append<W: std::io::Write>(builder: &mut tar::Builder<W>, name: &str, bytes: &[u8]) {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder.append_data(&mut header, name, bytes).unwrap();
}

/// 起一个只会吐两样东西的 HTTP 服务：索引与 tgz。
fn serve(index: String, tgz: Vec<u8>) -> (u16, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        for _ in 0..4 {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut buffer = [0u8; 2048];
            let read = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            let (body, mime): (Vec<u8>, &str) = if request.contains("pkg.tgz") {
                (tgz.clone(), "application/gzip")
            } else {
                (index.clone().into_bytes(), "application/json")
            };
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: {mime}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    (port, handle)
}

fn setup() -> (TempDir, Arc<dyn Host>) {
    let home = TempDir::new().unwrap();
    let host: Arc<dyn Host> = Arc::new(HeadlessHost::new(home.path().into(), home.path().into()));
    (home, host)
}

#[test]
fn search_install_and_remove_round_trip() {
    let tgz = build_tgz("@demo/market", "0.1.0");
    let digest = sha256(&tgz);
    let (port, _server) = serve(String::new(), tgz.clone());
    let index = format!(
        r#"{{
          "format": 1,
          "title": "Local market",
          "plugins": [{{
            "name": "@demo/market",
            "title": "Market Demo",
            "author": "demo",
            "versions": [{{
              "version": "0.1.0",
              "publishTimestamp": 1,
              "sha256": "{digest}",
              "size": {size},
              "source": {{ "type": "tgz", "url": "http://127.0.0.1:{port}/pkg.tgz" }},
              "engines": {{ "aicut": ">=1.0.0" }}
            }}]
          }}]
        }}"#,
        size = tgz.len()
    );
    let (port, _server) = serve(index, tgz);
    let url = format!("http://127.0.0.1:{port}/index.json");

    let (_home, host) = setup();
    let root = service::root(&host);
    market::fetch::save_source(&root, &url).unwrap();

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _enter = runtime.enter();
    let network = aicut_daemon::network::NetworkRuntime::load(None);

    let result = runtime
        .block_on(service::market_search(&host, &network, "1.4.0", "market", 0, 10, true))
        .unwrap();
    assert_eq!(result["total"], 1);
    assert_eq!(result["hits"][0]["name"], "@demo/market");

    let status = runtime
        .block_on(service::market_install(&host, &network, "1.4.0", "@demo/market", ""))
        .unwrap();
    assert_eq!(status.id, "@demo/market");
    assert_eq!(status.kind, "store");
    assert!(linked::store_dir(&root, "@demo/market", "0.1.0").join("client.js").is_file());

    // 名册里是托管安装，不落绝对路径。
    let registry = registry::load(&root).unwrap();
    assert_eq!(registry.plugins.len(), 1);
    assert!(registry.plugins[0].path.is_none());

    let remaining = service::market_remove(&host, "@demo/market", "1.4.0").unwrap();
    assert!(remaining.is_empty());
    assert!(!linked::store_dir(&root, "@demo/market", "0.1.0").exists());
}

#[test]
fn search_with_a_broken_index_reports_an_error() {
    let (_home, host) = setup();
    let root = service::root(&host);
    market::fetch::save_source(&root, "http://127.0.0.1:1/index.json").unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _enter = runtime.enter();
    let network = aicut_daemon::network::NetworkRuntime::load(None);
    let error = runtime
        .block_on(service::market_search(&host, &network, "1.4.0", "", 0, 10, true))
        .unwrap_err();
    assert!(error.contains("抓取索引失败") || error.contains("索引返回"), "{}", error);
}

#[test]
fn install_rejects_an_unknown_plugin() {
    let tgz = build_tgz("@demo/market", "0.1.0");
    let index = r#"{"format":1,"title":"Empty","plugins":[]}"#.to_string();
    let (port, _server) = serve(index, tgz);
    let url = format!("http://127.0.0.1:{port}/index.json");
    let (_home, host) = setup();
    let root = service::root(&host);
    market::fetch::save_source(&root, &url).unwrap();

    let runtime = tokio::runtime::Runtime::new().unwrap();
    let _enter = runtime.enter();
    let network = aicut_daemon::network::NetworkRuntime::load(None);
    let error = runtime
        .block_on(service::market_install(&host, &network, "1.4.0", "@demo/missing", ""))
        .unwrap_err();
    assert!(error.contains("@demo/missing"), "{}", error);
}

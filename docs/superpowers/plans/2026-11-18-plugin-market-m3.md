# 插件商店（M3）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 软件能从一个静态 JSON 索引发现插件、按 `name@version` 安装（sha256 校验 + 原子落盘 + 失败回滚），能显示更新并一键升级，也能卸载；索引源可配、可换成镜像。

**Architecture:** 索引在 daemon 侧抓取、校验、分页（渲染进程只拿一页）；安装是一次穷举事务：下载 → 校验 → 解包到 `<store>/<id>/<version>.tmp` → 原子 rename → 写名册。托管安装与 M1 的 `linked` 共用同一张名册，区别只是 `kind` 与「路径由版本目录推导、不落绝对路径」。

**Tech Stack:** Rust（`sha2` / `flate2` + `tar` / `reqwest`）、Vue 3 + Pinia + Vitest。

**设计依据：** [`../specs/2026-11-17-plugin-architecture-design.md`](../specs/2026-11-17-plugin-architecture-design.md) §13–§14
**前置：** M1（名册 / 导入 / 资源路由）、M2（宿主半）。

## Global Constraints

- 索引 `format` 必须为 `1`；`plugins[].name` 全局唯一；`versions[].version` 在每个插件内唯一。
- 索引 URL 仅 `https:`（`http://localhost` / `127.0.0.1` 放行，方便本地自建）；不许带凭据或 `#` 片段；**拒绝重定向**；索引体上限 8 MiB。
- 每条版本必须有 `sha256`；`engines.aicut` 必填（沿用 M1 的受限语法）。
- 只接受「已构建产物」：`source.type` 仅 `npm` 与 `tgz`；`git` 源直接拒绝（那等于让宿主编译，是 ComfyUI 的坑）。
- 托管安装目录不可变：`<config>/plugins/host/store/<id>/<version>/`；名册**不保存绝对路径**，路径由 `id@version` 推导。
- 解包只允许落在 `.tmp` 目录内；拒绝对路径、`..`、符号链接；条目数 ≤ 10 000，解包后 ≤ 512 MB。
- 更新保留旧版本目录（默认保留 3 个），可回滚；卸载删 `store/<id>`，`data/<id>` 默认保留。
- 每任务一次 commit。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `crates/daemon/src/plugin_host/market/mod.rs` | 模块导出、事件名、上限常量 |
| `crates/daemon/src/plugin_host/market/index.rs` | 索引类型 + 校验（format / 唯一性 / 版本 / sha256 / engines） |
| `crates/daemon/src/plugin_host/market/fetch.rs` | HTTPS 抓取 + 缓存 + 分页搜索 |
| `crates/daemon/src/plugin_host/market/install.rs` | 下载 / 校验 / 解包 / 原子安装 / 更新 / 卸载 |
| `crates/daemon/src/plugin_host/linked.rs` | `scan` 支持 `kind = store`（路径由版本推导） |
| `crates/daemon/src/rpc.rs` | `plugin_market_sources` / `_search` / `_install` |
| `src-tauri/src/plugin_host.rs` | 三个 Tauri 包装 |
| `src/types/pluginMarket.ts`、`src/core/pluginMarketApi.ts` | 前端类型与调用 |
| `src/stores/pluginHost.ts` | 市场搜索 / 安装 / 更新状态 |
| `src/components/workspace/panes/ExtensionsPane.vue` | 「已安装 / 发现」两个标签页 |

---

### Task 1: 索引类型与校验（Rust）

**Files:** Create `crates/daemon/src/plugin_host/market/{mod,index}.rs`；Modify `plugin_host/mod.rs`；Test 同文件。

**Interfaces:**
- Produces:
  - `pub struct MarketIndex { pub format: u32, pub title: LocalizedText, pub description: Option<LocalizedText>, pub metadata: Option<MarketMetadata>, pub plugins: Vec<MarketPlugin> }`
  - `pub struct MarketPlugin { pub name: String, pub title: Option<LocalizedText>, pub description: Option<LocalizedText>, pub icon: Option<String>, pub author: Option<String>, pub homepage: Option<String>, pub versions: Vec<MarketVersion> }`
  - `pub struct MarketVersion { pub version: String, pub publish_timestamp: u64, pub source: MarketSource, pub engines: Option<Engines>, pub sha256: String, pub size: u64 }`
  - `pub enum MarketSource { Npm { registry: Option<String> }, Tgz { url: String } }`
  - `pub fn parse_index(text: &str) -> Result<MarketIndex, String>`
  - `pub fn best_version(plugin: &MarketPlugin, app_version: &str) -> Option<&MarketVersion>`（兼容范围里最高版本）

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const IDX: &str = r#"{
      "format": 1,
      "title": { "en": "AI Cut Plugins", "zh": "AI Cut 插件" },
      "plugins": [{
        "name": "@demo/a",
        "title": "Demo",
        "versions": [
          { "version": "0.1.0", "publishTimestamp": 1, "sha256": "aa", "size": 10, "source": { "type": "npm" }, "engines": { "aicut": ">=1.0.0" } },
          { "version": "0.2.0", "publishTimestamp": 2, "sha256": "bb", "size": 20, "source": { "type": "tgz", "url": "https://example.com/a.tgz" }, "engines": { "aicut": ">=1.0.0" } }
        ]
      }]
    }"#;

    #[test]
    fn parses_a_valid_index() {
        let index = parse_index(IDX).unwrap();
        assert_eq!(index.plugins.len(), 1);
        assert_eq!(index.plugins[0].versions.len(), 2);
    }

    #[test]
    fn rejects_unknown_format() {
        let text = IDX.replace("\"format\": 1", "\"format\": 2");
        assert!(parse_index(&text).unwrap_err().contains("format"));
    }

    #[test]
    fn rejects_duplicate_plugin_names() {
        let text = IDX.replace("\"@demo/a\",", "\"@demo/a\", \"@demo/a\",");
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("@demo/a"), "{}", error);
    }

    #[test]
    fn rejects_duplicate_versions() {
        let text = IDX.replace("\"0.2.0\"", "\"0.1.0\"");
        let error = parse_index(&text).unwrap_err();
        assert!(error.contains("0.1.0"), "{}", error);
    }

    #[test]
    fn rejects_a_missing_sha256() {
        let text = IDX.replace("\\"sha256\\": \\"aa\\", ", "");
        assert!(parse_index(&text).unwrap_err().contains("sha256"));
    }

    #[test]
    fn rejects_a_git_source() {
        let text = IDX.replace(
            "{ \\"type\\": \\"tgz\\", \\"url\\": \\"https://example.com/a.tgz\\" }",
            "{ \\"type\\": \\"git\\", \\"url\\": \\"https://example.com/a\\", \\"commit\\": \\"abc\\" }",
        );
        assert!(parse_index(&text).unwrap_err().contains("git"));
    }

    #[test]
    fn picks_the_highest_compatible_version() {
        let index = parse_index(IDX).unwrap();
        let best = best_version(&index.plugins[0], "1.4.0").unwrap();
        assert_eq!(best.version, "0.2.0");
        assert!(best_version(&index.plugins[0], "0.9.0").is_none());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**：`cargo test --manifest-path crates/daemon/Cargo.toml plugin_host::market` → 编译失败。

- [ ] **Step 3: 写实现**：按上面的接口实现；`LocalizedText` 用枚举 `Plain(String)` / `Localized(BTreeMap<String,String>)` 反序列化（`#[serde(untagged)]`）；`parse_index` 逐条校验并给出带插件名/版本号的错误；`best_version` 复用 `super::manifest::{version_matches, Version}`（把 `Version` 与 `parse_version` 提升为 `pub(crate)`）。

- [ ] **Step 4: 跑测试确认通过**（7 passed）。

- [ ] **Step 5: Commit**：`feat(plugin-market): 索引类型与校验`

---

### Task 2: 抓取、缓存与分页搜索

**Files:** Create `market/fetch.rs`；Modify `market/mod.rs`；Test 同文件。

**Interfaces:**
- Produces:
  - `pub struct MarketSourceConfig { pub url: String }`（持久化在 `<config>/plugins/host/market.json`）
  - `pub async fn fetch_index(network: &NetworkRuntime, url: &str, force: bool) -> Result<(MarketIndex, String), String>`（`String` = `network|cache|stale-cache`）
  - `pub struct SearchHit { pub name: String, pub title: Option<String>, pub description: Option<String>, pub icon: Option<String>, pub author: Option<String>, pub version: String, pub sha256: String, pub size: u64, pub published_at: u64, pub source: MarketSource, pub installed: bool, pub update_available: bool }`
  - `pub async fn search(network, url, text, offset, limit, installed: &Registry, app_version) -> Result<(Vec<SearchHit>, usize), String>`

- [ ] **Step 1: 写失败测试**
  - `parse_and_filter`: 用固定索引，`search("demo")` 命中 1 条、`search("zzz")` 0 条、分页 `offset=1,limit=1` 只回第 2 条；
  - `rejects_http_non_localhost`：`check_url("http://example.com/x.json")` 报错；`http://127.0.0.1:8080/x.json` 通过；
  - `rejects_url_with_credentials_or_fragment`；
  - 缓存：写入临时 `<config>` 下的 cache 文件后，`fetch_index(force=false)` 走 `cache`（用 `file://`？不行——抓取只走 HTTP，这条用「缓存读取」单测直接测 `read_cache`/`write_cache`）。

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 写实现**
  - `check_url`：`url::Url::parse`（daemon 已有 `url` 依赖？没有就手写 checks：`starts_with("https://")`，或 `http://localhost` / `http://127.0.0.1`），拒 `@` 与 `#`；
  - `fetch_index`：命中缓存且未过期（TTL 6h）→ `cache`；否则 `client.get(url).redirect(Policy::none())` 抓取，`Content-Length` 与读到的字节都 ≤ 8 MiB，解析校验，写缓存（`<config>/plugins/host/cache/market-<hash>.json` + `.meta.json`），失败且有旧缓存 → `stale-cache`；
  - `search`：大小写不敏感的子串匹配 `name/title/description/author`，按 `updated` 排序（版本发布时间倒序），分页，逐条与名册对比得出 `installed` / `update_available`。

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**：`feat(plugin-market): 索引抓取、缓存与分页搜索`

---

### Task 3: 安装事务（下载 → 校验 → 解包 → 原子 rename）

**Files:** Create `market/install.rs`；Modify `linked.rs`（`scan` 支持 `store`）；Test 同文件 + `tests/plugin_host.rs`。

**Interfaces:**
- Produces:
  - `pub fn store_dir(host_root: &Path, id: &str, version: &str) -> PathBuf`（`<root>/store/<safe id>/<version>`）
  - `pub async fn install_from_market(host: &Arc<dyn Host>, network: &NetworkRuntime, url: &str, name: &str, version: &str) -> Result<PluginStatus, String>`
  - `pub fn remove_version(host: &Arc<dyn Host>, id: &str) -> Result<Vec<PluginStatus>, String>`
  - `pub fn gc(host: &Arc<dyn Host>, keep: usize)`

- [ ] **Step 1: 写失败测试**（测试里现造一个 `.tgz`：用 `flate2` + `tar` 打包 `aicut.plugin.json` + `client.js`，再起一个本地 HTTP 服务给它下载；或直接测 `install_from_tgz(path, sha256)` 这个纯函数）
  - `installs_a_tgz_into_the_store_and_writes_the_registry`
  - `rejects_a_sha256_mismatch`
  - `rejects_an_archive_without_a_manifest`
  - `rejects_path_traversal_inside_the_archive`
  - `update_keeps_the_previous_version_directory`
  - `remove_deletes_the_store_dir_but_keeps_data`

- [ ] **Step 2: 跑测试确认失败**。

- [ ] **Step 3: 写实现**
  - 下载（`tgz` 直链）或解析 npm：`GET https://registry.npmjs.org/<name>/<version>` → `dist.tarball`；
  - sha256 校验（`sha2`）；
  - 解包到 `<store>/<id>/<version>.tmp`：`GzDecoder` + `tar::Archive`，逐条 `entry.path()` 校验（无 `..`、非绝对、非 symlink），累计体积上限；
  - 校验 `.tmp` 里有清单且 id 匹配；
  - `fs::rename(tmp, final)`；
  - 名册：`kind = "store"`、`path = None`、`version = 新版本`、`enabled = true`；
  - `scan` 对 `store` 记录用 `store_dir(root, id, version)` 当目录；
  - `remove_version`：删 `store/<id>`、动名册、保留 `data/<id>`；
  - `gc`：每个插件保留最新 3 个版本目录。

- [ ] **Step 4: 跑测试确认通过**。

- [ ] **Step 5: Commit**：`feat(plugin-market): 安装事务与版本回滚`

---

### Task 4: RPC 与前端 API

**Files:** Modify `plugin_host/service.rs`、`rpc.rs`、`src-tauri/src/plugin_host.rs`、`lib.rs`；Create `src/types/pluginMarket.ts`、`src/core/pluginMarketApi.ts`；Test `src/core/__tests__/pluginMarketApi.test.ts`。

**Interfaces（RPC）：**
- `plugin_market_sources` → `{ url: string }`；`plugin_market_set_source { url }` → `{ url }`
- `plugin_market_search { text?, offset?, limit?, force? }` → `{ source, fetchedAt, total, hits[] }`（`limit ≤ 50`）
- `plugin_market_install { name, version }` → `{ plugin: PluginStatus }`

- [ ] **Step 1–5**：照 M1 Task 4 的形态（前端参数名契约测试 + Rust 薄包装 + `generate_handler`）。
- [ ] **Step 6: Commit**：`feat(plugin-market): 市场 RPC 与前端 API`

---

### Task 5: 商店 UI（已安装 / 发现两个标签页）

**Files:** Modify `ExtensionsPane.vue`、`stores/pluginHost.ts`、`i18n/{zh,en}.ts`；Test `src/core/__tests__/i18nKeys.test.ts` 追加 key。

- 顶部两个标签：「已安装」「发现」。
- 已安装：现有列表 + 「有新版本 vX → 更新」按钮（调 `plugin_market_install` 后再 `refresh`）。
- 发现：搜索框 + 结果卡（名字/作者/版本/大小/安装或更新按钮）+ 「索引源」输入（可保存）+ 源状态（`network/cache/stale-cache`）。
- i18n 新 key 同时进 `zh.ts` / `en.ts`。
- **Commit**：`feat(plugin-market): 商店面板`

---

### Task 6: 端到端验收

- `crates/daemon/tests/plugin_market.rs`：造一个本地 HTTP 服务 + 真 tgz，跑「索引 → 搜索 → 安装 → 列表 → 更新 → 卸载」全流程。
- `pnpm test` / `pnpm build` / `cargo test` 全绿。
- 手测：默认源指向作者的 GitHub 仓库（`plugins: []` 时发现页显示空态而不是报错）。

## 收尾验收（M3）

- [ ] 空索引可用（发现页空态，不报错）
- [ ] 假索引能搜索、分页、安装
- [ ] sha256 不符拒绝安装
- [ ] 索引 404 / 断网不影响已装插件（`stale-cache`）
- [ ] 更新保留旧版本、可回滚；卸载不删 `data/`

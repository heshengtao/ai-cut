//! 工作流库：画布（节点 + 连线）的持久化存档。
//!
//! 和 `history` 是同一套约定：索引（`index.json`）只存卡片需要的轻量元信息，完整
//! 画布放在 `<id>.json`；写盘先写临时文件再改名；索引损坏时扫描快照重建。
//!
//! 版本模型：`root_id` 是**一张卡片**的稳定 id，给同一张卡片再存一次就是追加一个
//! 版本（`<root_id>-v<n>`）。内容完全相同的重复保存不落新版本，只把 `updated_at`
//! 往前推——快捷键连按不该在版本列表里刷出一堆空版本。
//!
//! 实现放在 daemon 而不是 Tauri 壳里：浏览器端也要有工作流库，两边的实现必须只有
//! 一份，只是数据目录不同（与 `history` 一致）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// 同一张卡片最多保留多少个版本（超出的从最旧开始丢弃）。
const MAX_VERSIONS_PER_ROOT: usize = 30;

/// 整个工作流库最多保留多少张卡片（超出的从最旧开始丢弃）。
const MAX_ROOTS: usize = 200;

/// 工作流列表的一项：卡片展示用的元信息 + 定位快照的 id。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowVersion {
    /// `"<root_id>-v<version>"`，同时也是快照文件名（不含 `.json`）。
    pub id: String,
    /// 同一张卡片的所有版本共用。
    pub root_id: String,
    /// 从 1 开始。
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 派生自哪个内置工作流（一键套用模板时记下来）。
    #[serde(default)]
    pub origin: Option<String>,
    /// 工程历史分组键（`"path:..."` / `"created:..."`），用于把画布挂到某个工程上。
    #[serde(default)]
    pub history_key: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// 这张卡片第一个版本的创建时间（Unix 毫秒）。
    pub created_at: i64,
    /// 本次保存时间（Unix 毫秒）。
    pub updated_at: i64,
    pub node_count: usize,
    pub edge_count: usize,
    #[serde(default)]
    pub thumbnail: Option<String>,
    /// 画布内容指纹（nodes + edges 的 sha256）：重复保存时用它去重。
    #[serde(default)]
    pub fingerprint: String,
}

/// 保存一次工作流的入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkflowRequest {
    /// 给已有卡片追加版本时传它的 `root_id`；新建 / 版本化匹配时留空。
    #[serde(default)]
    pub root_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub history_key: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    /// 节点数组的 JSON 文本。
    pub nodes: String,
    /// 连线数组的 JSON 文本。
    pub edges: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
}

/// 读回一张工作流版本时的内容：元信息 + 解析好的节点 / 连线。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSnapshot {
    pub version: WorkflowVersion,
    pub nodes: Value,
    pub edges: Value,
}

/// 工作流目录：`<数据目录>/workflows`。
///
/// 参数是**数据目录本身**而不是 Tauri 句柄：桌面壳与无头 daemon 共用这条实现。
fn workflow_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let dir = data_dir.join("workflows");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建工作流目录失败：{e}"))?;
    Ok(dir)
}

/// 从快照文件重建索引。
///
/// `index.json` 损坏或意外丢失时，画布本身还在磁盘上：扫描一遍 `<id>.json` 就能把
/// 它们重新列出来（缩略图等展示元信息仍然存在快照里，不会退化成空列表）。
fn rebuild_index(dir: &Path) -> Vec<WorkflowVersion> {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for item in read_dir.flatten() {
        let file = item.path();
        if file.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = file.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };
        if !valid_id(id) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&file) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_str::<WorkflowSnapshot>(&text) else {
            continue;
        };
        entries.push(snapshot.version);
    }

    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    entries
}

/// 读取索引；文件缺失或损坏时尝试从快照文件重建，并顺手把重建结果写回去。
fn load_index(dir: &Path) -> Vec<WorkflowVersion> {
    let loaded = std::fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<WorkflowVersion>>(&text).ok());
    match loaded {
        Some(entries) => {
            let mut entries = entries;
            // 索引约定「最新的在前」；排序稳定，同毫秒保存也不会打乱插入顺序。
            entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            entries
        }
        None => {
            let rebuilt = rebuild_index(dir);
            if !rebuilt.is_empty() {
                let _ = write_index(dir, &rebuilt);
            }
            rebuilt
        }
    }
}

fn write_index(dir: &Path, entries: &[WorkflowVersion]) -> Result<(), String> {
    let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    write_text(&dir.join("index.json"), &json)
}

/// 原子写文本：先写临时文件再改名，避免中途崩溃留下半截文件。
fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 画布内容指纹：节点 / 连线文本拼接后的 sha256。
fn fingerprint(nodes: &str, edges: &str) -> String {
    let digest = Sha256::digest(format!("{nodes}\n{edges}").as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// id 只可能是我们自己生成的数字 / 连字符 / 版本标记，别让外部输入拼出路径穿越。
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_digit() || c == '-' || c == 'v')
}

/// 新卡片的 root id：`<毫秒时间戳>-<n>`，n 从 1 开始避开目录里已存在的同前缀文件。
fn unique_root_id(dir: &Path) -> String {
    let base = now_ms();
    let mut n = 1_u32;
    loop {
        let id = format!("{base}-{n}");
        if !root_id_used(dir, &id) {
            return id;
        }
        n += 1;
    }
}

/// 目录里是否已有以该 root id 开头的文件（任何版本）。
fn root_id_used(dir: &Path, id: &str) -> bool {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return false;
    };
    read_dir
        .flatten()
        .any(|item| item.file_name().to_string_lossy().starts_with(id))
}

/// 一张卡片当前的版本（按 version 取最大）。
fn latest_of<'a>(entries: &'a [WorkflowVersion], root_id: &str) -> Option<&'a WorkflowVersion> {
    entries
        .iter()
        .filter(|entry| entry.root_id == root_id)
        .max_by_key(|entry| entry.version)
}

/// 一张卡片第一个版本（created_at / origin / tags 的继承来源）。
fn first_of<'a>(entries: &'a [WorkflowVersion], root_id: &str) -> Option<&'a WorkflowVersion> {
    entries
        .iter()
        .filter(|entry| entry.root_id == root_id)
        .min_by_key(|entry| entry.version)
}

/// 修剪索引：每张卡片最多 `MAX_VERSIONS_PER_ROOT` 个版本，整个库最多 `MAX_ROOTS`
/// 张卡片；被丢掉的版本连快照文件一起删。
fn trim_index(dir: &Path, entries: &mut Vec<WorkflowVersion>) {
    // 索引按 updated_at 由新到旧，先出现者即「更新的卡片」。
    let mut kept_roots: Vec<String> = Vec::new();
    for entry in entries.iter() {
        if kept_roots.iter().any(|root| root == &entry.root_id) {
            continue;
        }
        if kept_roots.len() < MAX_ROOTS {
            kept_roots.push(entry.root_id.clone());
        }
    }

    let mut allowed: HashMap<String, Vec<u32>> = HashMap::new();
    for entry in entries.iter() {
        allowed
            .entry(entry.root_id.clone())
            .or_default()
            .push(entry.version);
    }
    for versions in allowed.values_mut() {
        versions.sort_unstable_by(|a, b| b.cmp(a));
        versions.truncate(MAX_VERSIONS_PER_ROOT);
    }

    let mut kept = Vec::with_capacity(entries.len());
    let mut dropped = Vec::new();
    for entry in entries.drain(..) {
        let root_kept = kept_roots.contains(&entry.root_id);
        let version_kept = allowed
            .get(&entry.root_id)
            .map(|versions| versions.contains(&entry.version))
            .unwrap_or(false);
        if root_kept && version_kept {
            kept.push(entry);
        } else {
            dropped.push(entry);
        }
    }
    for entry in &dropped {
        let _ = std::fs::remove_file(dir.join(format!("{}.json", entry.id)));
    }
    *entries = kept;
}

/// 列出工作流版本（最新的在前）。
pub fn list(data_dir: &Path) -> Vec<WorkflowVersion> {
    workflow_dir(data_dir)
        .map(|dir| load_index(&dir))
        .unwrap_or_default()
}

/// 保存一份工作流，返回落盘的版本。
///
/// 目标卡片的选择顺序：显式且存在的 `root_id` → 同 `history_key` + 同名的最新卡片
/// → 新建卡片。同一张卡片的最新版本内容（指纹 + 名称）完全相同时只更新
/// `updated_at`，不产生新版本。
pub fn save(data_dir: &Path, request: SaveWorkflowRequest) -> Result<WorkflowVersion, String> {
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err("工作流名称不能为空".into());
    }

    let nodes_value: Value =
        serde_json::from_str(&request.nodes).map_err(|e| format!("工作流数据无效：{e}"))?;
    if !nodes_value.is_array() {
        return Err("工作流数据无效：nodes 必须是数组".into());
    }
    let edges_value: Value =
        serde_json::from_str(&request.edges).map_err(|e| format!("工作流数据无效：{e}"))?;
    if !edges_value.is_array() {
        return Err("工作流数据无效：edges 必须是数组".into());
    }
    let node_count = nodes_value.as_array().map(Vec::len).unwrap_or(0);
    let edge_count = edges_value.as_array().map(Vec::len).unwrap_or(0);
    let fp = fingerprint(&request.nodes, &request.edges);

    let dir = workflow_dir(data_dir)?;
    let mut entries = load_index(&dir);
    let now = now_ms();

    // 1) 目标卡片：显式的 root_id 必须真的存在（否则当「新建」处理，避免把拼错的
    //    id 当成新卡片写出一堆孤儿版本）。
    let explicit_root = request
        .root_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .filter(|id| valid_id(id))
        .filter(|id| entries.iter().any(|entry| entry.root_id == *id));
    let mut target_root = explicit_root.map(str::to_string);

    // 2) 没给 / 给错 root_id：同 history_key + 同名的卡片就是「同一个工程的工作流」，
    //    接着给它升版本，而不是每次保存都新建一张卡片。
    if target_root.is_none() {
        if let Some(history_key) = request.history_key.as_deref().filter(|key| !key.is_empty()) {
            if let Some(found) = entries.iter().find(|entry| {
                entry.history_key.as_deref() == Some(history_key) && entry.name == name
            }) {
                target_root = Some(found.root_id.clone());
            }
        }
    }

    let is_new_root = target_root.is_none();
    let root_id = match target_root {
        Some(root_id) => root_id,
        None => unique_root_id(&dir),
    };

    let previous = latest_of(&entries, &root_id).cloned();
    let first = first_of(&entries, &root_id).cloned();

    // 3) 去重：同一张卡片的最新版本内容与名称都没变，只推 updated_at。
    if !is_new_root {
        if let Some(previous) = &previous {
            if previous.fingerprint == fp && previous.name == name {
                let updated = if let Some(entry) = entries.iter_mut().find(|e| e.id == previous.id)
                {
                    entry.updated_at = now;
                    entry.clone()
                } else {
                    previous.clone()
                };
                write_index(&dir, &entries)?;
                return Ok(updated);
            }
        }
    }

    let version = previous
        .as_ref()
        .map(|entry| entry.version + 1)
        .unwrap_or(1);
    let description = request
        .description
        .clone()
        .or_else(|| previous.as_ref().map(|entry| entry.description.clone()))
        .unwrap_or_default();
    let origin = request
        .origin
        .clone()
        .or_else(|| first.as_ref().and_then(|entry| entry.origin.clone()));
    let history_key = request
        .history_key
        .clone()
        .filter(|key| !key.is_empty())
        .or_else(|| first.as_ref().and_then(|entry| entry.history_key.clone()));
    let tags = request
        .tags
        .clone()
        .or_else(|| first.as_ref().map(|entry| entry.tags.clone()))
        .unwrap_or_default();
    let thumbnail = request
        .thumbnail
        .clone()
        .or_else(|| previous.as_ref().and_then(|entry| entry.thumbnail.clone()));
    let created_at = first.as_ref().map(|entry| entry.created_at).unwrap_or(now);

    let entry = WorkflowVersion {
        id: format!("{root_id}-v{version}"),
        root_id,
        version,
        name,
        description,
        origin,
        history_key,
        tags,
        created_at,
        updated_at: now,
        node_count,
        edge_count,
        thumbnail,
        fingerprint: fp,
    };

    // 4) 快照写盘（完整画布），索引只留元信息。
    let snapshot = WorkflowSnapshot {
        version: entry.clone(),
        nodes: nodes_value,
        edges: edges_value,
    };
    let text = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    write_text(&dir.join(format!("{}.json", entry.id)), &text)?;

    entries.insert(0, entry.clone());
    trim_index(&dir, &mut entries);
    write_index(&dir, &entries)?;
    Ok(entry)
}

/// 读取一个工作流版本（元信息 + 画布）。
pub fn get(data_dir: &Path, id: String) -> Result<WorkflowSnapshot, String> {
    if !valid_id(&id) {
        return Err("无效的工作流 id".into());
    }
    let dir = workflow_dir(data_dir)?;
    let file = dir.join(format!("{id}.json"));
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("工作流不存在".into())
        }
        Err(error) => return Err(format!("读取工作流失败：{error}")),
    };
    serde_json::from_str::<WorkflowSnapshot>(&text).map_err(|e| format!("工作流数据损坏：{e}"))
}

/// 删除一张卡片的**所有**版本（索引项 + 快照文件）。
pub fn delete(data_dir: &Path, root_id: String) -> Result<(), String> {
    if !valid_id(&root_id) {
        return Err("无效的工作流 id".into());
    }
    let dir = workflow_dir(data_dir)?;
    let mut entries = load_index(&dir);
    let before = entries.len();
    let mut removed = Vec::new();
    entries.retain(|entry| {
        if entry.root_id == root_id {
            removed.push(entry.id.clone());
            false
        } else {
            true
        }
    });
    if entries.len() == before {
        return Err("工作流不存在".to_string());
    }

    for id in removed {
        match std::fs::remove_file(dir.join(format!("{id}.json"))) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("删除工作流失败：{error}")),
        }
    }
    write_index(&dir, &entries)
}

/// 重命名一张卡片：**所有**版本一起改，版本卡片才不会新旧名字混排。
pub fn rename(data_dir: &Path, root_id: String, name: String) -> Result<WorkflowVersion, String> {
    if !valid_id(&root_id) {
        return Err("无效的工作流 id".into());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("工作流名称不能为空".into());
    }

    let dir = workflow_dir(data_dir)?;
    let mut entries = load_index(&dir);
    let now = now_ms();
    let latest_version = latest_of(&entries, &root_id)
        .map(|entry| entry.version)
        .ok_or_else(|| "工作流不存在".to_string())?;

    let mut latest_id = String::new();
    for entry in entries.iter_mut() {
        if entry.root_id != root_id {
            continue;
        }
        entry.name = name.clone();
        if entry.version == latest_version {
            // 只有最新版本的 updated_at 代表「最近一次编辑」。
            entry.updated_at = now;
            latest_id = entry.id.clone();
        }
    }
    let latest = entries
        .iter()
        .find(|entry| entry.id == latest_id)
        .cloned()
        .ok_or_else(|| "工作流不存在".to_string())?;
    write_index(&dir, &entries)?;
    Ok(latest)
}

#[cfg(test)]
mod tests {
    use super::{
        fingerprint, latest_of, list, load_index, rename, save, valid_id, SaveWorkflowRequest,
        WorkflowVersion, MAX_VERSIONS_PER_ROOT,
    };
    use std::path::Path;

    const NODES: &str = r#"[{"id":"n1","type":"input.text","position":{"x":0,"y":0},"data":{"params":{},"bindings":{}}}]"#;
    const EDGES: &str = r#"[{"id":"e1","source":"n1","target":"n2"}]"#;

    fn request(nodes: &str, edges: &str, name: &str) -> SaveWorkflowRequest {
        SaveWorkflowRequest {
            root_id: None,
            name: name.into(),
            description: None,
            origin: None,
            history_key: None,
            tags: None,
            nodes: nodes.into(),
            edges: edges.into(),
            thumbnail: None,
        }
    }

    fn workflow_dir(data_dir: &Path) -> std::path::PathBuf {
        data_dir.join("workflows")
    }

    fn snapshot_files(data_dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(workflow_dir(data_dir))
            .map(|read_dir| {
                read_dir
                    .flatten()
                    .filter_map(|item| item.file_name().to_str().map(str::to_string))
                    .filter(|name| name != "index.json" && name.ends_with(".json"))
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn saving_the_same_root_appends_a_second_version() {
        let dir = tempfile::tempdir().unwrap();
        let first = save(dir.path(), request(NODES, EDGES, "demo")).unwrap();
        assert_eq!(first.version, 1);
        assert_eq!(first.id, format!("{}-v1", first.root_id));
        assert_eq!(first.node_count, 1);
        assert_eq!(first.edge_count, 1);

        let mut second = request(
            NODES,
            r#"[{"id":"e2","source":"n1","target":"n3"}]"#,
            "demo",
        );
        second.root_id = Some(first.root_id.clone());
        let second = save(dir.path(), second).unwrap();

        assert_eq!(second.root_id, first.root_id);
        assert_eq!(second.version, 2);
        assert_eq!(second.id, format!("{}-v2", first.root_id));
        assert_eq!(second.created_at, first.created_at);
        assert_eq!(list(dir.path()).len(), 2);
        assert_eq!(snapshot_files(dir.path()).len(), 2);
    }

    #[test]
    fn identical_content_is_deduped() {
        let dir = tempfile::tempdir().unwrap();
        let first = save(dir.path(), request(NODES, EDGES, "demo")).unwrap();
        let mut again = request(NODES, EDGES, "demo");
        again.root_id = Some(first.root_id.clone());
        let second = save(dir.path(), again).unwrap();

        assert_eq!(second.version, 1);
        assert_eq!(second.id, first.id);
        assert_eq!(list(dir.path()).len(), 1);
        assert_eq!(snapshot_files(dir.path()).len(), 1);
        // 名称变了算一次新的保存。
        let mut renamed = request(NODES, EDGES, "demo2");
        renamed.root_id = Some(first.root_id.clone());
        assert_eq!(save(dir.path(), renamed).unwrap().version, 2);
    }

    #[test]
    fn versions_the_matching_history_key_root() {
        let dir = tempfile::tempdir().unwrap();
        let mut first = request(NODES, EDGES, "demo");
        first.history_key = Some("path:/tmp/a.mp4".into());
        let first = save(dir.path(), first).unwrap();

        let mut second = request(NODES, r#"[{"id":"n2"}]"#, "demo");
        second.history_key = Some("path:/tmp/a.mp4".into());
        let second = save(dir.path(), second).unwrap();

        assert_eq!(second.root_id, first.root_id);
        assert_eq!(second.version, 2);
        assert_eq!(second.history_key.as_deref(), Some("path:/tmp/a.mp4"));
        assert_eq!(
            list(dir.path())
                .iter()
                .filter(|e| e.root_id == first.root_id)
                .count(),
            2
        );
        assert_eq!(snapshot_files(dir.path()).len(), 2);
    }

    #[test]
    fn a_different_name_under_the_same_history_key_starts_a_new_root() {
        let dir = tempfile::tempdir().unwrap();
        let mut first = request(NODES, EDGES, "demo");
        first.history_key = Some("created:1700000000000".into());
        let first = save(dir.path(), first).unwrap();

        let mut second = request(NODES, EDGES, "other");
        second.history_key = Some("created:1700000000000".into());
        let second = save(dir.path(), second).unwrap();

        assert_ne!(second.root_id, first.root_id);
        assert_eq!(second.version, 1);
        let entries = list(dir.path());
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.version == 1));
    }

    #[test]
    fn lists_newest_first_and_reads_the_snapshot_back() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), request(NODES, EDGES, "first")).unwrap();
        let newest = save(dir.path(), request(NODES, EDGES, "second")).unwrap();

        let entries = list(dir.path());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, newest.id);

        let snapshot = super::get(dir.path(), newest.id.clone()).unwrap();
        assert_eq!(snapshot.version.name, "second");
        assert_eq!(snapshot.nodes.as_array().unwrap().len(), 1);
        assert_eq!(snapshot.nodes[0]["id"], "n1");
        assert_eq!(snapshot.edges.as_array().unwrap().len(), 1);
        assert!(super::get(dir.path(), format!("{}-v9", newest.root_id)).is_err());
    }

    #[test]
    fn deletes_every_version_of_a_root() {
        let dir = tempfile::tempdir().unwrap();
        let first = save(dir.path(), request(NODES, EDGES, "demo")).unwrap();
        let mut second = request(NODES, r#"[{"id":"n2"}]"#, "demo");
        second.root_id = Some(first.root_id.clone());
        save(dir.path(), second).unwrap();
        let other = save(dir.path(), request(NODES, EDGES, "keep")).unwrap();

        super::delete(dir.path(), first.root_id.clone()).unwrap();
        let entries = list(dir.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, other.id);
        assert!(snapshot_files(dir.path())
            .iter()
            .all(|name| name.starts_with(&other.root_id)));
        assert!(super::delete(dir.path(), "1700000000000-9".to_string()).is_err());
    }

    #[test]
    fn rename_updates_every_version() {
        let dir = tempfile::tempdir().unwrap();
        let first = save(dir.path(), request(NODES, EDGES, "demo")).unwrap();
        let mut second = request(NODES, r#"[{"id":"n2"}]"#, "demo");
        second.root_id = Some(first.root_id.clone());
        save(dir.path(), second).unwrap();

        let latest = rename(dir.path(), first.root_id.clone(), "  新名字  ".to_string()).unwrap();
        assert_eq!(latest.name, "新名字");
        assert_eq!(latest.version, 2);
        let entries = list(dir.path());
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.name == "新名字"));
        // 最新版本的 updated_at 被推进到重命名时刻。
        assert!(latest.updated_at >= first.updated_at);
        assert!(rename(dir.path(), first.root_id, "   ".to_string()).is_err());
    }

    #[test]
    fn rebuilds_the_index_from_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let saved = save(dir.path(), request(NODES, EDGES, "demo")).unwrap();
        std::fs::remove_file(workflow_dir(dir.path()).join("index.json")).unwrap();

        let entries = load_index(&workflow_dir(dir.path()));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, saved.id);
        // 重建结果会回写索引。
        assert!(workflow_dir(dir.path()).join("index.json").exists());
    }

    #[test]
    fn rejects_invalid_ids_and_payloads() {
        assert!(valid_id("1700000000000-1-v1"));
        assert!(!valid_id("../evil"));
        assert!(!valid_id("1/2"));
        assert!(!valid_id(""));

        let dir = tempfile::tempdir().unwrap();
        assert!(super::get(dir.path(), "../evil".into()).is_err());
        assert!(super::delete(dir.path(), "../evil".into()).is_err());

        assert_eq!(
            save(dir.path(), request(NODES, EDGES, "  ")).unwrap_err(),
            "工作流名称不能为空"
        );
        assert!(save(dir.path(), request("not json", EDGES, "demo"))
            .unwrap_err()
            .starts_with("工作流数据无效"));
        assert!(save(dir.path(), request(r#"{"a":1}"#, EDGES, "demo"))
            .unwrap_err()
            .starts_with("工作流数据无效"));
        assert!(list(dir.path()).is_empty());
    }

    #[test]
    fn trims_versions_beyond_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let first = save(dir.path(), request(NODES, EDGES, "demo")).unwrap();
        for index in 1..=MAX_VERSIONS_PER_ROOT {
            let mut next = request(&format!(r#"[{{"id":"n{index}"}}]"#), EDGES, "demo");
            next.root_id = Some(first.root_id.clone());
            save(dir.path(), next).unwrap();
        }

        let entries = list(dir.path());
        assert_eq!(entries.len(), MAX_VERSIONS_PER_ROOT);
        assert!(entries.iter().all(|entry| entry.root_id == first.root_id));
        let versions: Vec<u32> = entries.iter().map(|entry| entry.version).collect();
        assert_eq!(versions[0] as usize, MAX_VERSIONS_PER_ROOT + 1);
        // 最旧的 v1 被丢掉，v2 成为保留下来的最旧版本。
        assert_eq!(*versions.last().unwrap(), 2);
        assert_eq!(snapshot_files(dir.path()).len(), MAX_VERSIONS_PER_ROOT);
        // 最旧的版本文件被删掉，最新的仍在。
        let latest = latest_of(&entries, &first.root_id).unwrap();
        assert_eq!(latest.version as usize, MAX_VERSIONS_PER_ROOT + 1);
    }

    #[test]
    fn fingerprints_are_stable() {
        assert_eq!(fingerprint(NODES, EDGES), fingerprint(NODES, EDGES));
        assert_ne!(fingerprint(NODES, EDGES), fingerprint(NODES, "[]"));
        // 版本结构可以反序列化（索引与快照都靠它）。
        let version: WorkflowVersion = serde_json::from_str(
            r#"{"id":"1-v1","rootId":"1","version":1,"name":"demo","createdAt":1,"updatedAt":2,"nodeCount":0,"edgeCount":0}"#,
        )
        .unwrap();
        assert_eq!(version.root_id, "1");
        assert_eq!(version.description, "");
        assert!(version.tags.is_empty());
    }
}

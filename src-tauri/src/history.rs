//! 历史工程：当前工程被「新建 / 打开 / 恢复」替换前，留一份工作副本。
//!
//! 索引（`index.json`）只存卡片需要的轻量元信息；完整工程放在 `<id>.json`。
//! 列表接口因此不必把几十份工程塞进 IPC 载荷。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

/// 最多保留多少份历史（超出的从最旧开始丢弃）。
pub const MAX_ENTRIES: usize = 30;

/// 历史列表的一项：展示用元信息 + 恢复时定位快照的 id。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub name: String,
    /// 记录时间（Unix 毫秒）。
    pub saved_at: i64,
    /// 当时的工程文件路径（未保存过为 `None`）。
    pub path: Option<String>,
    /// 当时是否有未保存改动。
    pub dirty: bool,
    /// 时间线长度（秒）。
    pub duration: f64,
    /// 视频 / 图片素材的缩略图缓存路径。
    pub thumbnail: Option<String>,
    pub track_count: usize,
    pub clip_count: usize,
    /// 工程内容指纹：重复记录同一份工程时用它去重。
    #[serde(default)]
    pub fingerprint: String,
}

/// 恢复一份历史工程时返回的内容。
#[derive(Debug, Clone, Serialize)]
pub struct HistorySnapshot {
    pub project: String,
    pub path: Option<String>,
    pub dirty: bool,
}

fn history_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?
        .join("history");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建历史目录失败：{e}"))?;
    Ok(dir)
}

/// 从目录里的快照文件重建索引。
///
/// `index.json` 损坏或意外丢失时，历史工程本身还在磁盘上；扫描一遍 `<id>.json`
/// 就能把它们重新列出来（路径 / 缩略图等展示元信息会退化，但工程内容不会丢）。
fn rebuild_index(dir: &Path) -> Vec<HistoryEntry> {
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
        let Ok(project) = std::fs::read_to_string(&file) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&project) else {
            continue;
        };
        let (name, track_count, clip_count, duration) = summarize(&value);
        if is_empty_project(&value, clip_count) {
            continue;
        }

        let saved_at = id
            .split('-')
            .next()
            .and_then(|part| part.parse::<i64>().ok())
            .or_else(|| {
                std::fs::metadata(&file)
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as i64)
            })
            .unwrap_or(0);

        entries.push(HistoryEntry {
            id: id.to_string(),
            name,
            saved_at,
            path: None,
            dirty: true,
            duration,
            thumbnail: None,
            track_count,
            clip_count,
            fingerprint: fingerprint(&project),
        });
    }

    entries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    entries.truncate(MAX_ENTRIES);
    entries
}

/// 读取索引；文件缺失或损坏时尝试从快照文件重建，历史功能坏了不该拖垮启动。
fn load_index(dir: &Path) -> Vec<HistoryEntry> {
    let entries = std::fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<HistoryEntry>>(&text).ok());
    match entries {
        Some(entries) if !entries.is_empty() => entries,
        _ => rebuild_index(dir),
    }
}

fn write_index(dir: &Path, entries: &[HistoryEntry]) -> Result<(), String> {
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

fn fingerprint(project: &str) -> String {
    let digest = Sha256::digest(project.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 从工程 JSON 里取展示用的摘要。
fn summarize(value: &Value) -> (String, usize, usize, f64) {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("untitled")
        .to_string();
    let tracks = value
        .get("tracks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut clip_count = 0;
    let mut duration = 0.0_f64;
    for track in &tracks {
        let clips = match track.get("clips").and_then(Value::as_array) {
            Some(clips) => clips,
            None => continue,
        };
        clip_count += clips.len();
        for clip in clips {
            let start = clip.get("start").and_then(Value::as_f64).unwrap_or(0.0);
            let length = clip.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
            duration = duration.max(start + length);
        }
    }
    (name, tracks.len(), clip_count, duration)
}

fn is_empty_project(value: &Value, clip_count: usize) -> bool {
    let has_assets = value
        .get("assets")
        .and_then(Value::as_array)
        .map(|assets| !assets.is_empty())
        .unwrap_or(false);
    clip_count == 0 && !has_assets
}

/// 生成一个目录里唯一的 id。
fn unique_id(dir: &Path, saved_at: i64) -> String {
    let base = saved_at.to_string();
    if !dir.join(format!("{base}.json")).exists() {
        return base;
    }
    let mut n = 1;
    loop {
        let id = format!("{base}-{n}");
        if !dir.join(format!("{id}.json")).exists() {
            return id;
        }
        n += 1;
    }
}

/// id 只可能是我们自己生成的数字 / 连字符，别让外部输入拼出路径穿越。
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// 列出历史工程（最新的在前）。
#[tauri::command]
pub fn project_history_list<R: Runtime>(app: AppHandle<R>) -> Vec<HistoryEntry> {
    history_dir(&app)
        .map(|dir| load_index(&dir))
        .unwrap_or_default()
}

/// 记录一份历史；空白工程、或内容完全相同的工程会跳过。
#[tauri::command]
pub fn project_history_record<R: Runtime>(
    app: AppHandle<R>,
    project: String,
    path: Option<String>,
    dirty: bool,
    thumbnail: Option<String>,
) -> Result<Option<HistoryEntry>, String> {
    let value: Value = serde_json::from_str(&project).map_err(|e| format!("工程数据无效：{e}"))?;
    let (name, track_count, clip_count, duration) = summarize(&value);
    if is_empty_project(&value, clip_count) {
        return Ok(None);
    }

    let dir = history_dir(&app)?;
    let fp = fingerprint(&project);
    let mut entries = load_index(&dir);

    // 同一份工程（内容 + 路径都相同）已经在历史里：挪到最前，不再存第二份。
    if let Some(pos) = entries
        .iter()
        .position(|entry| entry.fingerprint == fp && entry.path == path)
    {
        if pos > 0 {
            let existing = entries.remove(pos);
            entries.insert(0, existing);
            write_index(&dir, &entries)?;
        }
        return Ok(None);
    }

    let saved_at = now_ms();
    let id = unique_id(&dir, saved_at);
    write_text(&dir.join(format!("{id}.json")), &project)?;

    let entry = HistoryEntry {
        id,
        name,
        saved_at,
        path,
        dirty,
        duration,
        thumbnail,
        track_count,
        clip_count,
        fingerprint: fp,
    };
    entries.insert(0, entry.clone());
    while entries.len() > MAX_ENTRIES {
        if let Some(old) = entries.pop() {
            let _ = std::fs::remove_file(dir.join(format!("{}.json", old.id)));
        }
    }
    write_index(&dir, &entries)?;
    Ok(Some(entry))
}

/// 删除一份历史工程（索引项 + 快照文件）。
///
/// 只动历史目录，不影响用户磁盘上的工程文件。
#[tauri::command]
pub fn project_history_delete<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("无效的历史工程 id".into());
    }
    let dir = history_dir(&app)?;
    let mut entries = load_index(&dir);
    let before = entries.len();
    entries.retain(|entry| entry.id != id);
    if entries.len() == before {
        return Err("历史工程不存在".to_string());
    }

    match std::fs::remove_file(dir.join(format!("{id}.json"))) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("删除历史工程失败：{error}")),
    }
    write_index(&dir, &entries)
}

/// 读取一份历史工程。
///
/// 这里刻意**不删除**快照：历史列表要能跨重启保留，恢复后当前工程也会再次
/// 记入历史；靠内容指纹去重即可，不会产生重复卡片。
#[tauri::command]
pub fn project_history_get<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<HistorySnapshot, String> {
    if !valid_id(&id) {
        return Err("无效的历史工程 id".into());
    }
    let dir = history_dir(&app)?;
    let entries = load_index(&dir);
    let entry = entries
        .iter()
        .find(|entry| entry.id == id)
        .cloned()
        .ok_or_else(|| "历史工程不存在".to_string())?;

    let file = dir.join(format!("{id}.json"));
    let project = std::fs::read_to_string(&file).map_err(|e| format!("读取历史工程失败：{e}"))?;

    Ok(HistorySnapshot {
        project,
        path: entry.path,
        dirty: entry.dirty,
    })
}

#[cfg(test)]
mod tests {
    use super::{fingerprint, is_empty_project, summarize, valid_id};
    use serde_json::json;

    #[test]
    fn summarizes_tracks_and_timeline_length() {
        let value = json!({
            "name": "demo",
            "tracks": [
                { "clips": [{ "start": 0.0, "duration": 2.5 }] },
                { "clips": [{ "start": 3.0, "duration": 1.5 }] }
            ]
        });
        let (name, tracks, clips, duration) = summarize(&value);
        assert_eq!(name, "demo");
        assert_eq!(tracks, 2);
        assert_eq!(clips, 2);
        assert!((duration - 4.5).abs() < f64::EPSILON);
    }

    #[test]
    fn detects_blank_projects() {
        let empty = json!({ "name": "untitled", "assets": [], "tracks": [] });
        assert!(is_empty_project(&empty, 0));
        let with_asset = json!({
            "name": "untitled",
            "assets": [{ "id": "a" }],
            "tracks": []
        });
        assert!(!is_empty_project(&with_asset, 0));
    }

    #[test]
    fn fingerprints_are_stable() {
        assert_eq!(fingerprint("abc"), fingerprint("abc"));
        assert_ne!(fingerprint("abc"), fingerprint("abd"));
    }

    #[test]
    fn rejects_ids_that_could_escape_the_directory() {
        assert!(valid_id("1700000000000"));
        assert!(valid_id("1700000000000-1"));
        assert!(!valid_id("../index"));
        assert!(!valid_id("1/2"));
        assert!(!valid_id(""));
    }
}

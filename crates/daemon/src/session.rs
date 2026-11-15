//! 共享会话：多个客户端看到同一份工程，任何一侧的编辑都会广播给其他客户端。
//!
//! 这不是 CRDT：桌面与浏览器各自持有完整文档，编辑后把「新快照 + 受影响对象」
//! 发到这里广播；接收端只合并受影响的对象，未受影响的部分保持本地版本。
//! 这样同时在两条不同轨道上编辑不会互相覆盖；同一条轨道上的并发编辑按到达顺序取后者。

use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::sync::broadcast;

/// 推给客户端的一条消息。
#[derive(Clone, Debug)]
pub enum SessionMsg {
    Doc {
        project: String,
        revision: u64,
        origin: String,
        client_revision: u64,
        affected: Value,
        full: bool,
        dirty: bool,
        path: Option<String>,
    },
    Playhead {
        time: f64,
        playing: bool,
    },
}

impl SessionMsg {
    pub fn to_json(&self) -> Value {
        match self {
            SessionMsg::Doc {
                project,
                revision,
                origin,
                client_revision,
                affected,
                full,
                dirty,
                path,
            } => json!({
                "t": "doc",
                "project": project,
                "revision": revision,
                "origin": origin,
                "clientRevision": client_revision,
                "affected": affected,
                "full": full,
                "dirty": dirty,
                "path": path,
            }),
            SessionMsg::Playhead { time, playing } => {
                json!({ "t": "playhead", "time": time, "playing": playing })
            }
        }
    }
}

/// 当前会话的共享文档。
pub struct Session {
    doc: RwLock<Option<DocState>>,
    playhead: RwLock<(f64, bool)>,
    tx: broadcast::Sender<SessionMsg>,
}

#[derive(Clone)]
struct DocState {
    project: String,
    revision: u64,
    dirty: bool,
    path: Option<String>,
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

/// 从 `affected` 里取一个 id 列表。
fn affected_ids(affected: &serde_json::Map<String, Value>, key: &str) -> Vec<String> {
    affected
        .get(key)
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// 把受影响的轨道替换进 `base_tracks`，顺序跟随 `next_tracks`。
fn merge_track_list(base_tracks: Vec<Value>, next_tracks: &[Value], track_ids: &[String]) -> Vec<Value> {
    let mut merged: Vec<Value> = base_tracks
        .into_iter()
        .filter(|track| {
            let id = track.get("id").and_then(Value::as_str).unwrap_or("");
            !track_ids.iter().any(|wanted| wanted == id)
                || next_tracks
                    .iter()
                    .any(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
        })
        .collect();
    for (index, track) in next_tracks.iter().enumerate() {
        let Some(id) = track.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !track_ids.iter().any(|wanted| wanted == id) {
            continue;
        }
        match merged
            .iter()
            .position(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
        {
            Some(local) => merged[local] = track.clone(),
            None => {
                let at = index.min(merged.len());
                merged.insert(at, track.clone());
            }
        }
    }
    merged
}

/// 把受影响的素材替换进 `base_assets`，顺序跟随 `next_assets`。
fn merge_asset_list(base_assets: Vec<Value>, next_assets: &[Value], asset_ids: &[String]) -> Vec<Value> {
    let mut merged: Vec<Value> = base_assets
        .into_iter()
        .filter(|asset| {
            let id = asset.get("id").and_then(Value::as_str).unwrap_or("");
            !asset_ids.iter().any(|wanted| wanted == id)
                || next_assets
                    .iter()
                    .any(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
        })
        .collect();
    for (index, asset) in next_assets.iter().enumerate() {
        let Some(id) = asset.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !asset_ids.iter().any(|wanted| wanted == id) {
            continue;
        }
        match merged
            .iter()
            .position(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
        {
            Some(local) => merged[local] = asset.clone(),
            None => {
                let at = index.min(merged.len());
                merged.insert(at, asset.clone());
            }
        }
    }
    merged
}

/// 在文档里按 id 找分P。
fn episode_of<'a>(doc: &'a Value, episode_id: &str) -> Option<&'a Value> {
    doc.get("episodes")?
        .as_array()?
        .iter()
        .find(|episode| episode.get("id").and_then(Value::as_str) == Some(episode_id))
}

/// 把「片段所在的轨道」补进受影响轨道列表。
fn add_clip_owners(tracks: &[Value], clip_ids: &[String], track_ids: &mut Vec<String>) {
    for track in tracks {
        let Some(clips) = track.get("clips").and_then(Value::as_array) else {
            continue;
        };
        let hit = clips.iter().any(|clip| {
            clip.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| clip_ids.iter().any(|wanted| wanted == id))
        });
        if !hit {
            continue;
        }
        let Some(id) = track.get("id").and_then(Value::as_str) else {
            continue;
        };
        if !track_ids.iter().any(|wanted| wanted == id) {
            track_ids.push(id.to_string());
        }
    }
}

/// 把一次增量补丁合并进当前工程：只替换受影响轨道 / 素材，工程级字段取新快照。
///
/// 服务端在这里做合并（而不是让各客户端各自合并），是为了让所有客户端最终看到**同一份**
/// 文档：两边同时改不同轨道不会互相覆盖，同一条轨道按服务端收到的顺序取后者。
///
/// 工程文档 v2（多分P）：时间线在 `episodes[activeEpisodeId]` 里。补丁只作用于
/// `affected.episodeId` 指向的分P，**当前分P 始终由本地（base）决定**——远端不会把
/// 你从正在剪的那一集踢走；远端新建的分P 会被追加进来。
fn merge_project(current: &str, incoming: &str, affected: &Value) -> String {
    let (Ok(mut base), Ok(next)) = (
        serde_json::from_str::<Value>(current),
        serde_json::from_str::<Value>(incoming),
    ) else {
        return incoming.to_string();
    };
    let Some(affected) = affected.as_object() else {
        return incoming.to_string();
    };

    let clip_ids = affected_ids(affected, "clipIds");
    let mut track_ids = affected_ids(affected, "trackIds");
    let asset_ids = affected_ids(affected, "assetIds");

    let is_episode_doc = base.get("episodes").and_then(Value::as_array).is_some()
        && next.get("episodes").and_then(Value::as_array).is_some();

    if !is_episode_doc {
        // ---- 旧（v1）文档：时间线在根级 tracks ----
        if let (Some(base_tracks), Some(next_tracks)) = (
            base.get("tracks").and_then(Value::as_array).cloned(),
            next.get("tracks").and_then(Value::as_array).cloned(),
        ) {
            add_clip_owners(&base_tracks, &clip_ids, &mut track_ids);
            add_clip_owners(&next_tracks, &clip_ids, &mut track_ids);
            let merged = merge_track_list(base_tracks, &next_tracks, &track_ids);
            if let Some(object) = base.as_object_mut() {
                object.insert("tracks".into(), Value::Array(merged));
            }
        }
        if let (Some(base_assets), Some(next_assets)) = (
            base.get("assets").and_then(Value::as_array).cloned(),
            next.get("assets").and_then(Value::as_array).cloned(),
        ) {
            let merged = merge_asset_list(base_assets, &next_assets, &asset_ids);
            if let Some(object) = base.as_object_mut() {
                object.insert("assets".into(), Value::Array(merged));
            }
        }
        if let (Some(base_object), Some(next_object)) = (base.as_object_mut(), next.as_object()) {
            for (key, value) in next_object {
                if key == "tracks" || key == "assets" {
                    continue;
                }
                base_object.insert(key.clone(), value.clone());
            }
        }
        return serde_json::to_string(&base).unwrap_or_else(|_| incoming.to_string());
    }

    let patch_episode_id = affected
        .get("episodeId")
        .and_then(Value::as_str)
        .or_else(|| next.get("activeEpisodeId").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let base_episode = episode_of(&base, &patch_episode_id).cloned();
    let next_episode = episode_of(&next, &patch_episode_id).cloned();

    if let (Some(base_episode), Some(next_episode)) = (&base_episode, &next_episode) {
        let base_tracks = base_episode
            .get("tracks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let next_tracks = next_episode
            .get("tracks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        add_clip_owners(&base_tracks, &clip_ids, &mut track_ids);
        add_clip_owners(&next_tracks, &clip_ids, &mut track_ids);
        let merged_tracks = merge_track_list(base_tracks, &next_tracks, &track_ids);

        if let Some(episodes) = base.get_mut("episodes").and_then(Value::as_array_mut) {
            for episode in episodes.iter_mut() {
                if episode.get("id").and_then(Value::as_str) != Some(patch_episode_id.as_str()) {
                    continue;
                }
                if let Some(object) = episode.as_object_mut() {
                    object.insert("tracks".into(), Value::Array(merged_tracks.clone()));
                    // 标记是分P 级的：同一分P 内以后到者为准（与 v1 的标记语义一致）。
                    if let Some(markers) = next_episode.get("markers") {
                        object.insert("markers".into(), markers.clone());
                    }
                    for key in ["name", "order", "updatedAt"] {
                        if let Some(value) = next_episode.get(key) {
                            object.insert(key.into(), value.clone());
                        }
                    }
                }
            }
        }
    }

    // 远端新建的分P 带过来（本地没有的 id 才追加）。
    if let Some(episodes) = base.get_mut("episodes").and_then(Value::as_array_mut) {
        let existing: std::collections::HashSet<String> = episodes
            .iter()
            .filter_map(|episode| episode.get("id").and_then(Value::as_str).map(str::to_string))
            .collect();
        if let Some(next_episodes) = next.get("episodes").and_then(Value::as_array) {
            for episode in next_episodes {
                let Some(id) = episode.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if existing.contains(id) {
                    continue;
                }
                episodes.push(episode.clone());
            }
        }
    }

    if let (Some(base_assets), Some(next_assets)) = (
        base.get("assets").and_then(Value::as_array).cloned(),
        next.get("assets").and_then(Value::as_array).cloned(),
    ) {
        let merged = merge_asset_list(base_assets, &next_assets, &asset_ids);
        if let Some(object) = base.as_object_mut() {
            object.insert("assets".into(), Value::Array(merged));
        }
    }

    // 工程级字段（名称 / 帧率 / 尺寸 / 剪口组）以后到者为准；
    // 时间线与分P 结构保持本地，避免远端把当前分P 或别人的分P 覆盖掉。
    if let (Some(base_object), Some(next_object)) = (base.as_object_mut(), next.as_object()) {
        for (key, value) in next_object {
            if matches!(
                key.as_str(),
                "tracks" | "markers" | "assets" | "episodes" | "activeEpisodeId"
            ) {
                continue;
            }
            base_object.insert(key.clone(), value.clone());
        }
    }
    serde_json::to_string(&base).unwrap_or_else(|_| incoming.to_string())
}

impl Session {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            doc: RwLock::new(None),
            playhead: RwLock::new((0.0, false)),
            tx,
        }
    }

    /// 某个客户端推来一份新快照（或一次增量补丁）。服务端合并后广播整份文档。
    pub fn publish_doc(
        &self,
        project: String,
        revision: u64,
        origin: String,
        affected: Value,
        full: bool,
        dirty: bool,
        path: Option<String>,
    ) {
        let (merged, next_revision) = {
            let current = self
                .doc
                .read()
                .ok()
                .and_then(|guard| guard.as_ref().map(|doc| doc.project.clone()));
            let merged = match current {
                Some(current) if !full && !affected.is_null() => {
                    merge_project(&current, &project, &affected)
                }
                _ => project,
            };
            let next = self
                .doc
                .read()
                .ok()
                .and_then(|guard| guard.as_ref().map(|doc| doc.revision))
                .map(|current| current.saturating_add(1))
                .unwrap_or_else(|| revision.max(1));
            (merged, next)
        };
        if let Ok(mut guard) = self.doc.write() {
            *guard = Some(DocState {
                project: merged.clone(),
                revision: next_revision,
                dirty,
                path: path.clone(),
            });
        }
        let _ = self.tx.send(SessionMsg::Doc {
            project: merged,
            revision: next_revision,
            origin,
            client_revision: revision,
            affected: Value::Null,
            full: true,
            dirty,
            path,
        });
    }

    pub fn publish_playhead(&self, time: f64, playing: bool) {
        if let Ok(mut guard) = self.playhead.write() {
            *guard = (time, playing);
        }
        let _ = self.tx.send(SessionMsg::Playhead { time, playing });
    }

    /// 新客户端加入时的一次性状态。文档一定按 full 下发，先从同一份快照起步。
    pub fn snapshot(&self) -> (Option<String>, u64, f64, bool, bool, Option<String>) {
        let (project, revision, dirty, path) = match self.doc.read() {
            Ok(guard) => match guard.as_ref() {
                Some(doc) => (
                    Some(doc.project.clone()),
                    doc.revision,
                    doc.dirty,
                    doc.path.clone(),
                ),
                None => (None, 0, false, None),
            },
            Err(_) => (None, 0, false, None),
        };
        let (time, playing) = self
            .playhead
            .read()
            .map(|guard| *guard)
            .unwrap_or((0.0, false));
        (project, revision, time, playing, dirty, path)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionMsg> {
        self.tx.subscribe()
    }

    /// 是否有会话（没有桌面端在推时，浏览器知道自己在看空会话）。
    pub fn has_doc(&self) -> bool {
        self.doc
            .read()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub fn updated_at(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::Session;
    use serde_json::json;

    #[test]
    fn snapshot_starts_empty_then_reflects_publishes() {
        let session = Session::new();
        let (project, revision, time, playing, dirty, _path) = session.snapshot();
        assert!(project.is_none());
        assert_eq!(revision, 0);
        assert_eq!(time, 0.0);
        assert!(!playing);
        assert!(!dirty);

        session.publish_doc(
            "{\"version\":1}".into(),
            4,
            "desktop".into(),
            json!({"trackIds":[],"clipIds":[],"assetIds":[]}),
            true,
            true,
            None,
        );
        session.publish_playhead(2.5, true);

        let (project, revision, time, playing, dirty, _path) = session.snapshot();
        assert_eq!(project.as_deref(), Some("{\"version\":1}"));
        assert_eq!(revision, 4);
        assert_eq!(time, 2.5);
        assert!(playing);
        assert!(dirty);
        assert!(session.has_doc());
    }

    #[test]
    fn subscribers_receive_doc_and_playhead() {
        let session = Session::new();
        let mut receiver = session.subscribe();
        session.publish_doc(
            "doc".into(),
            1,
            "web".into(),
            json!({"trackIds":["t1"],"clipIds":[],"assetIds":[]}),
            false,
            true,
            None,
        );
        session.publish_playhead(1.0, false);

        let first = receiver.try_recv().unwrap();
        assert!(matches!(first, super::SessionMsg::Doc { revision: 1, .. }));
        let second = receiver.try_recv().unwrap();
        assert!(matches!(second, super::SessionMsg::Playhead { time, .. } if time == 1.0));
    }

    #[test]
    fn merge_only_replaces_affected_track_in_current_episode() {
        let current = r#"{"version":2,"name":"local","activeEpisodeId":"e1","episodes":[{"id":"e1","name":"第一集","tracks":[{"id":"t1","clips":[{"id":"c1","v":1}]},{"id":"t2","clips":[{"id":"c2","v":1}]}],"markers":[]}],"assets":[]}"#;
        let incoming = r#"{"version":2,"name":"remote","activeEpisodeId":"e1","episodes":[{"id":"e1","name":"第一集","tracks":[{"id":"t1","clips":[{"id":"c1","v":2}]},{"id":"t2","clips":[{"id":"c2","v":2}]}],"markers":[]}],"assets":[]}"#;
        let merged = super::merge_project(
            current,
            incoming,
            &serde_json::json!({"trackIds": [], "clipIds": ["c1"], "assetIds": []}),
        );
        let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(value["name"], "remote");
        assert_eq!(value["episodes"][0]["tracks"][0]["clips"][0]["v"], 2);
        assert_eq!(value["episodes"][0]["tracks"][1]["clips"][0]["v"], 1);
        // 根级不再有时间线：v2 只写 episodes。
        assert!(value.get("tracks").is_none());
    }

    #[test]
    fn merge_keeps_local_episode_and_appends_remote_one() {
        let current = r#"{"version":2,"name":"local","activeEpisodeId":"e1","episodes":[{"id":"e1","name":"第一集","tracks":[{"id":"t1","clips":[]}],"markers":[]}],"assets":[]}"#;
        let incoming = r#"{"version":2,"name":"remote","activeEpisodeId":"e2","episodes":[{"id":"e1","name":"第一集","tracks":[{"id":"t1","clips":[{"id":"c9","v":9}]}],"markers":[]},{"id":"e2","name":"第二集","tracks":[{"id":"t9","clips":[{"id":"c7","v":7}]}],"markers":[]}],"assets":[]}"#;
        let merged = super::merge_project(
            current,
            incoming,
            &serde_json::json!({"episodeId": "e2", "trackIds": [], "clipIds": [], "assetIds": []}),
        );
        let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
        // 远端不能把当前分P 换掉。
        assert_eq!(value["activeEpisodeId"], "e1");
        // 补丁打的是 e2，e1 的轨道不能被污染。
        assert_eq!(value["episodes"][0]["tracks"][0]["clips"].as_array().unwrap().len(), 0);
        // 远端新建的分P 要带过来。
        assert_eq!(value["episodes"][1]["id"], "e2");
    }
}

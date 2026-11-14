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

/// 把一次增量补丁合并进当前工程：只替换受影响轨道 / 素材，工程级字段取新快照。
///
/// 服务端在这里做合并（而不是让各客户端各自合并），是为了让所有客户端最终看到**同一份**
/// 文档：两边同时改不同轨道不会互相覆盖，同一条轨道按服务端收到的顺序取后者。
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
    let ids = |key: &str| -> Vec<String> {
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
    };
    let clip_ids = ids("clipIds");
    let mut track_ids = ids("trackIds");
    let asset_ids = ids("assetIds");

    let add_owners = |doc: &Value, track_ids: &mut Vec<String>| {
        let Some(tracks) = doc.get("tracks").and_then(Value::as_array) else {
            return;
        };
        for track in tracks {
            let Some(clips) = track.get("clips").and_then(Value::as_array) else {
                continue;
            };
            if clips.iter().any(|clip| {
                clip.get("id")
                    .and_then(Value::as_str)
                    .is_some_and(|id| clip_ids.iter().any(|wanted| wanted == id))
            }) {
                if let Some(id) = track.get("id").and_then(Value::as_str) {
                    if !track_ids.iter().any(|wanted| wanted == id) {
                        track_ids.push(id.to_string());
                    }
                }
            }
        }
    };
    add_owners(&base, &mut track_ids);
    add_owners(&next, &mut track_ids);

    if let (Some(base_tracks), Some(next_tracks)) = (
        base.get("tracks").and_then(Value::as_array).cloned(),
        next.get("tracks").and_then(Value::as_array).cloned(),
    ) {
        let mut merged: Vec<Value> = base_tracks
            .into_iter()
            .filter(|track| {
                let id = track.get("id").and_then(Value::as_str).unwrap_or("");
                !track_ids.iter().any(|wanted| wanted == id)
                    || next_tracks.iter().any(|candidate| {
                        candidate.get("id").and_then(Value::as_str) == Some(id)
                    })
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
        if let Some(object) = base.as_object_mut() {
            object.insert("tracks".into(), Value::Array(merged));
        }
    }

    if let (Some(base_assets), Some(next_assets)) = (
        base.get("assets").and_then(Value::as_array).cloned(),
        next.get("assets").and_then(Value::as_array).cloned(),
    ) {
        let mut merged: Vec<Value> = base_assets
            .into_iter()
            .filter(|asset| {
                let id = asset.get("id").and_then(Value::as_str).unwrap_or("");
                !asset_ids.iter().any(|wanted| wanted == id)
                    || next_assets.iter().any(|candidate| {
                        candidate.get("id").and_then(Value::as_str) == Some(id)
                    })
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
        if let Some(object) = base.as_object_mut() {
            object.insert("assets".into(), Value::Array(merged));
        }
    }

    // 工程级字段（名称 / 帧率 / 尺寸 / 标记 / 剪口组）以后到者为准。
    if let (Some(base_object), Some(next_object)) = (base.as_object_mut(), next.as_object()) {
        for (key, value) in next_object {
            if key == "tracks" || key == "assets" {
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
    fn merge_only_replaces_affected_track() {
        let current = r#"{"version":1,"name":"local","tracks":[{"id":"t1","clips":[{"id":"c1","v":1}]},{"id":"t2","clips":[{"id":"c2","v":1}]}],"assets":[]}"#;
        let incoming = r#"{"version":1,"name":"remote","tracks":[{"id":"t1","clips":[{"id":"c1","v":2}]},{"id":"t2","clips":[{"id":"c2","v":2}]}],"assets":[]}"#;
        let merged = super::merge_project(
            current,
            incoming,
            &serde_json::json!({"trackIds": [], "clipIds": ["c1"], "assetIds": []}),
        );
        let value: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(value["name"], "remote");
        assert_eq!(value["tracks"][0]["clips"][0]["v"], 2);
        assert_eq!(value["tracks"][1]["clips"][0]["v"], 1);
    }
}

//! 全局音色库：参考音频 + 说话人向量，跨工程复用。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const INDEX: &str = "index.json";
const REFERENCE: &str = "reference.wav";
const EMBEDDING: &str = "meanvc2.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSource {
    #[serde(default)]
    pub asset_id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEntry {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub duration: f64,
    pub source: VoiceSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct VoiceIndex {
    version: u32,
    voices: Vec<VoiceEntry>,
}

pub struct VoiceLibrary {
    root: PathBuf,
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch.is_alphanumeric() {
            out.push(ch);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "voice".into()
    } else {
        trimmed.chars().take(24).collect()
    }
}

fn stamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl VoiceLibrary {
    pub fn open(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|e| format!("创建音色库失败：{e}"))?;
        Ok(Self {
            root: root.to_path_buf(),
        })
    }

    fn read(&self) -> Result<VoiceIndex, String> {
        let path = self.root.join(INDEX);
        if !path.is_file() {
            return Ok(VoiceIndex {
                version: 1,
                voices: Vec::new(),
            });
        }
        let text = fs::read_to_string(&path).map_err(|e| format!("读取音色库失败：{e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("音色库格式错误：{e}"))
    }

    fn write(&self, index: &VoiceIndex) -> Result<(), String> {
        let text = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
        let tmp = self.root.join(format!(".{INDEX}.tmp"));
        fs::write(&tmp, text).map_err(|e| format!("写入音色库失败：{e}"))?;
        fs::rename(&tmp, self.root.join(INDEX)).map_err(|e| format!("写入音色库失败：{e}"))
    }

    pub fn list(&self) -> Result<Vec<VoiceEntry>, String> {
        Ok(self.read()?.voices)
    }

    pub fn dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    pub fn reference_path(&self, id: &str) -> PathBuf {
        self.dir(id).join(REFERENCE)
    }

    pub fn embedding(&self, id: &str) -> Result<Vec<f32>, String> {
        let text = fs::read_to_string(self.dir(id).join(EMBEDDING))
            .map_err(|_| format!("音色 {id} 缺少说话人向量，请重新导入"))?;
        let parsed: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("音色向量损坏：{e}"))?;
        parsed["embedding"]
            .as_array()
            .ok_or_else(|| "音色向量格式错误".to_string())?
            .iter()
            .map(|v| {
                v.as_f64()
                    .map(|x| x as f32)
                    .ok_or_else(|| "音色向量格式错误".to_string())
            })
            .collect()
    }

    pub fn add(
        &self,
        name: String,
        source: VoiceSource,
        reference: &[f32],
        embedding: &[f32],
    ) -> Result<VoiceEntry, String> {
        if reference.is_empty() {
            return Err("参考音频为空".into());
        }
        let mut index = self.read()?;
        let base = format!("v-{}", slug(&name));
        let mut id = base.clone();
        let mut n = 2;
        while index.voices.iter().any(|v| v.id == id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        let dir = self.dir(&id);
        fs::create_dir_all(&dir).map_err(|e| format!("创建音色目录失败：{e}"))?;

        let wav = dir.join(REFERENCE);
        crate::audio_ai::write_wav(&wav, reference, 1, super::refs::REF_SR as u32)?;
        let payload = serde_json::json!({ "model": "meanvc2-120ms", "embedding": embedding });
        fs::write(dir.join(EMBEDDING), payload.to_string())
            .map_err(|e| format!("写入音色向量失败：{e}"))?;

        let entry = VoiceEntry {
            id,
            name,
            created_at: stamp(),
            duration: reference.len() as f64 / super::refs::REF_SR,
            source,
        };
        index.voices.push(entry.clone());
        index.version = 1;
        self.write(&index)?;
        Ok(entry)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut index = self.read()?;
        index.voices.retain(|v| v.id != id);
        self.write(&index)?;
        let dir = self.dir(id);
        if dir.is_dir() {
            fs::remove_dir_all(dir).map_err(|e| format!("删除音色失败：{e}"))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ai-cut-voices-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn add_list_remove_roundtrip() {
        let root = temp_root("roundtrip");
        let library = VoiceLibrary::open(&root).expect("打开音色库");
        let entry = library
            .add(
                "张三".into(),
                VoiceSource {
                    asset_id: Some("a-1".into()),
                    name: "访谈.wav".into(),
                },
                &[0.1f32; 1600],
                &[0.5f32; 256],
            )
            .expect("导入音色");
        assert!(entry.id.starts_with("v-"));
        assert!((entry.duration - 0.1).abs() < 1e-6);

        let reopened = VoiceLibrary::open(&root).expect("重开音色库");
        assert_eq!(reopened.list().expect("列音色").len(), 1);
        assert_eq!(reopened.embedding(&entry.id).expect("读向量").len(), 256);
        assert!(reopened.reference_path(&entry.id).is_file());

        reopened.remove(&entry.id).expect("删除");
        assert!(reopened.list().expect("列音色").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn duplicate_names_get_distinct_ids() {
        let root = temp_root("dup");
        let library = VoiceLibrary::open(&root).expect("打开音色库");
        let source = VoiceSource {
            asset_id: None,
            name: "x.wav".into(),
        };
        let a = library
            .add("同名".into(), source.clone(), &[0.1; 800], &[0.0; 256])
            .expect("a");
        let b = library
            .add("同名".into(), source, &[0.1; 800], &[0.0; 256])
            .expect("b");
        assert_ne!(a.id, b.id);
        let _ = std::fs::remove_dir_all(&root);
    }
}

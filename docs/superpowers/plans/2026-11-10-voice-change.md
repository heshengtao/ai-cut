# AI 变声（离线批量）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选中若干音频片段，用 MeanVC2 一次性离线变声，结果按原位置铺到「AI 变声」轨道并静音原片段。

**Architecture:** Rust 侧新增 `voice_change` 模块，用 `ort` 跑 MeanVC2 的五张 ONNX 图（宿主循环复刻上游流式推理）；音色存全局音色库（参考音频 + 256 维向量）。前端新增 AI 面板「变声」页与 `placeConvertedVoice` 放置逻辑，批量由单个后端命令一次完成。

**Tech Stack:** Rust + tauri 2 + ort + ffmpeg sidecar；Vue 3 + Pinia + TypeScript；Vitest；ONNX Runtime。

## Global Constraints

- 模型一律不随包分发（`bundled: false`），体积上限见 `models::BUNDLE_LIMIT = 10 MB`。
- 变声按 16 kHz 单声道推理，再上采样到 `48 kHz / 2 声道` 落盘（与 `audio_ai` 一致）。
- 后端音频统一用 `audio_ai::decode_segment` / `audio_ai::write_wav`，不另写解码。
- 常量：`REF_SR = 16_000.0`、参考音频上限 10 秒、下限 3 秒。
- 噪声种子由片段 id 派生，同一片段重复跑必须逐样本一致。
- 前端文案同时加 `src/i18n/zh.ts` 与 `src/i18n/en.ts`；菜单项只对音频 / 视频片段出现。
- 提交信息用中文 Conventional Commits（`feat(voice): …`）。

## File Structure

**后端**

| 文件 | 职责 |
| --- | --- |
| `src-tauri/src/voice_change/mod.rs` | 命令、批量编排、进度事件、取消 |
| `src-tauri/src/voice_change/refs.rs` | 参考音频窗口选择、归一化 |
| `src-tauri/src/voice_change/voices.rs` | 全局音色库（`index.json` + 目录） |
| `src-tauri/src/voice_change/meanvc2.rs` | 六张图的会话与宿主循环 |
| `src-tauri/src/models.rs` | `ModelFamily::MeanVc2` + 两个模型条目 |
| `src-tauri/src/audio_ai/mod.rs` | `decode_segment` / `write_wav` / 采样率常量开成 `pub(crate)` |
| `src-tauri/src/lib.rs` | `mod voice_change;` + 命令注册 |

**前端**

| 文件 | 职责 |
| --- | --- |
| `src/types/voiceChange.ts` | 请求 / 结果 / 音色 / 进度类型 |
| `src/core/voiceChangeApi.ts` | `invoke` 封装与进度订阅 |
| `src/core/voiceEdit.ts` | `placeConvertedVoice` |
| `src/core/aiActions.ts` | `convertVoice(params, ctx)` |
| `src/composables/useAiClipActions.ts` | 菜单动作 + 模型检查 + HUD + `openVoiceChange` |
| `src/composables/useTimelineMenus.ts` | 「AI 变声…」菜单项 |
| `src/stores/aiLaunch.ts` | `page: "voice"` + `clipIds` |
| `src/components/workspace/panes/ai/AiVoicePage.vue` | 变声页 |
| `src/components/workspace/panes/AiPane.vue` | 页面路由与入口卡片 |

---

### Task 1: 暴露音频 AI 的公共音频工具

**Files:**
- Modify: `src-tauri/src/audio_ai/mod.rs:42-43,255,305`
- Modify: `src-tauri/src/lib.rs`（模块声明）
- Create: `src-tauri/src/voice_change/mod.rs`

**Interfaces:**
- Produces: `audio_ai::decode_segment(&AppHandle, &str, f64, f64) -> Result<Vec<f32>, String>`（48 kHz 立体声交错）
- Produces: `audio_ai::write_wav(&Path, &[f32], u16, u32) -> Result<(), String>`
- Produces: `audio_ai::OUT_SAMPLE_RATE`、`audio_ai::OUT_CHANNELS`

- [ ] **Step 1: 三个符号改成 `pub(crate)`**

```rust
// src-tauri/src/audio_ai/mod.rs
pub(crate) const OUT_SAMPLE_RATE: u32 = 48_000;
pub(crate) const OUT_CHANNELS: u16 = 2;

pub(crate) async fn decode_segment(
    app: &AppHandle,
    path: &str,
    start: f64,
    duration: f64,
) -> Result<Vec<f32>, String> { /* 函数体不变 */ }

pub(crate) fn write_wav(
    path: &Path,
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<(), String> { /* 函数体不变 */ }
```

- [ ] **Step 2: 建模块骨架**

```rust
// src-tauri/src/voice_change/mod.rs
//! 离线 AI 变声：MeanVC2 批量转换、音色库、参考音频截取。

pub mod meanvc2;
pub mod refs;
pub mod voices;
```

```rust
// src-tauri/src/lib.rs（与其他 mod 并列）
mod voice_change;
```

- [ ] **Step 3: 编译**

Run: `cd src-tauri && cargo check --lib`
Expected: 通过（`meanvc2.rs` / `refs.rs` / `voices.rs` 先建空文件，内容在后续任务补）

- [ ] **Step 4: 提交**

```bash
git add src-tauri/src/audio_ai/mod.rs src-tauri/src/voice_change src-tauri/src/lib.rs
git commit -m "refactor(audio): 暴露解码/写盘工具给 voice_change 复用"
```

---

### Task 2: 参考音频窗口选择

**Files:**
- Create: `src-tauri/src/voice_change/refs.rs`
- Test: 同文件 `#[cfg(test)] mod tests`

**Interfaces:**
- Produces: `refs::REF_SR: f64 = 16_000.0`、`refs::TARGET_SECS: f64 = 10.0`、`refs::MIN_SECS: f64 = 3.0`
- Produces: `refs::Window { start: usize, len: usize }`
- Produces: `refs::pick_window(samples: &[f32], sample_rate: f64) -> Option<Window>`
- Produces: `refs::normalize(samples: &mut [f32], target_dbfs: f32)`

- [ ] **Step 1: 写失败的测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f64, sr: f64, amp: f32) -> Vec<f32> {
        let n = (seconds * sr) as usize;
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / sr as f32).sin())
            .collect()
    }

    #[test]
    fn skips_leading_silence() {
        let sr = REF_SR;
        let mut samples = vec![0.0f32; (8.0 * sr) as usize];
        samples.extend(tone(6.0, sr, 0.3));
        let window = pick_window(&samples, sr).expect("应找到有声窗口");
        let start_secs = window.start as f64 / sr;
        assert!((7.9..=8.1).contains(&start_secs), "起点 {start_secs}");
        let len_secs = window.len as f64 / sr;
        assert!((5.5..=6.2).contains(&len_secs), "长度 {len_secs}");
    }

    #[test]
    fn rejects_short_and_silent() {
        assert!(pick_window(&tone(2.0, REF_SR, 0.3), REF_SR).is_none());
        assert!(pick_window(&vec![0.0f32; 16_000 * 10], REF_SR).is_none());
    }

    #[test]
    fn caps_at_ten_seconds() {
        let window = pick_window(&tone(30.0, REF_SR, 0.3), REF_SR).expect("应有窗口");
        assert!(window.len as f64 / REF_SR <= TARGET_SECS + 0.11);
    }

    #[test]
    fn normalize_hits_target() {
        let mut samples = tone(1.0, REF_SR, 0.05);
        normalize(&mut samples, -3.0);
        let peak = samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        let db = 20.0 * (peak as f64).log10();
        assert!((db - (-3.0)).abs() < 0.5, "峰值 {db} dBFS");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib voice_change::refs`
Expected: 编译失败（`pick_window` 未定义）

- [ ] **Step 3: 实现**

```rust
//! 参考音色：从任意音频里挑一段“有声音的” 3~10 秒。

pub const REF_SR: f64 = 16_000.0;
pub const TARGET_SECS: f64 = 10.0;
pub const MIN_SECS: f64 = 3.0;
const FRAME_SECS: f64 = 0.02;
const STEP_SECS: f64 = 0.5;
const REL_DB: f32 = -35.0;
const ABS_DB: f32 = -45.0;
const PAD_SECS: f64 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub start: usize,
    pub len: usize,
}

fn frame_db(samples: &[f32], frame: usize) -> Vec<f32> {
    samples
        .chunks(frame)
        .map(|chunk| {
            let sum: f32 = chunk.iter().map(|v| v * v).sum();
            let rms = (sum / chunk.len().max(1) as f32).sqrt();
            20.0 * rms.max(1e-6).log10()
        })
        .collect()
}

/// 找一段有声窗口；找不到（太短 / 全静音）返回 `None`。
pub fn pick_window(samples: &[f32], sample_rate: f64) -> Option<Window> {
    if sample_rate <= 0.0 || samples.is_empty() {
        return None;
    }
    let frame = (sample_rate * FRAME_SECS).round() as usize;
    let db = frame_db(samples, frame);
    if db.is_empty() {
        return None;
    }
    let peak = db.iter().cloned().fold(f32::MIN, f32::max);
    let threshold = (peak + REL_DB).max(ABS_DB);

    let smoothed: Vec<f32> = (0..db.len())
        .map(|i| {
            let lo = i.saturating_sub(2);
            let hi = (i + 3).min(db.len());
            db[lo..hi].iter().sum::<f32>() / (hi - lo) as f32
        })
        .collect();
    let voiced: Vec<bool> = smoothed.iter().map(|v| *v >= threshold).collect();
    if (voiced.iter().filter(|v| **v).count() as f64) * FRAME_SECS < MIN_SECS {
        return None;
    }

    let target = (TARGET_SECS / FRAME_SECS).round() as usize;
    let step = (STEP_SECS / FRAME_SECS).round() as usize;
    let mut best: Option<(usize, usize)> = None;
    let mut best_count = 0usize;
    let mut i = 0;
    while i < voiced.len() {
        let end = (i + target).min(voiced.len());
        let count = voiced[i..end].iter().filter(|v| **v).count();
        if count > best_count {
            best_count = count;
            best = Some((i, end));
        }
        if end == voiced.len() {
            break;
        }
        i += step;
    }
    let (mut start, mut end) = best?;

    while start < end && !voiced[start] {
        start += 1;
    }
    while end > start && !voiced[end - 1] {
        end -= 1;
    }
    let pad = (PAD_SECS / FRAME_SECS).round() as usize;
    start = start.saturating_sub(pad);
    end = (end + pad).min(voiced.len());
    if end <= start {
        return None;
    }
    let start_sample = start * frame;
    let len = ((end - start) * frame).min(samples.len().saturating_sub(start_sample));
    (len > 0).then_some(Window { start: start_sample, len })
}

/// 峰值归一到 `target_dbfs`。
pub fn normalize(samples: &mut [f32], target_dbfs: f32) {
    let peak = samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    if peak <= 1e-6 {
        return;
    }
    let gain = 10f32.powf(target_dbfs / 20.0) / peak;
    for sample in samples.iter_mut() {
        *sample = (*sample * gain).clamp(-1.0, 1.0);
    }
}
```

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test --lib voice_change::refs`
Expected: 4 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/voice_change/refs.rs
git commit -m "feat(voice): 参考音频自动截取有声的 10 秒窗口"
```

---

### Task 3: 全局音色库

**Files:**
- Create: `src-tauri/src/voice_change/voices.rs`
- Test: 同文件

**Interfaces:**
- Produces: `voices::VoiceSource { asset_id: Option<String>, name: String }`
- Produces: `voices::VoiceEntry { id, name, created_at, duration, source }`（serde camelCase 见 Task 7）
- Produces: `voices::VoiceLibrary::{open, list, add, remove, reference_path, embedding}`

- [ ] **Step 1: 写失败的测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ai-cut-voices-{tag}-{}", std::process::id()));
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
                VoiceSource { asset_id: Some("a-1".into()), name: "访谈.wav".into() },
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
        let source = VoiceSource { asset_id: None, name: "x.wav".into() };
        let a = library.add("同名".into(), source.clone(), &[0.1; 800], &[0.0; 256]).expect("a");
        let b = library.add("同名".into(), source, &[0.1; 800], &[0.0; 256]).expect("b");
        assert_ne!(a.id, b.id);
        let _ = std::fs::remove_dir_all(&root);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib voice_change::voices`
Expected: 编译失败（`VoiceLibrary` 未定义）

- [ ] **Step 3: 实现**

```rust
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
        Ok(Self { root: root.to_path_buf() })
    }

    fn read(&self) -> Result<VoiceIndex, String> {
        let path = self.root.join(INDEX);
        if !path.is_file() {
            return Ok(VoiceIndex { version: 1, voices: Vec::new() });
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
            .map(|v| v.as_f64().map(|x| x as f32).ok_or_else(|| "音色向量格式错误".to_string()))
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
        crate::audio_ai::write_wav(
            &wav,
            reference,
            1,
            super::refs::REF_SR as u32,
        )?;
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
```

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test --lib voice_change::voices`
Expected: 2 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/voice_change/voices.rs
git commit -m "feat(voice): 全局音色库（参考音频 + 说话人向量）"
```

---

### Task 4: 模型目录条目

**Files:**
- Modify: `src-tauri/src/models.rs`（`ModelFamily`、`ENTRIES` 末尾、测试模块）
- Test: `src-tauri/src/models.rs` 的 `#[cfg(test)]`

**Interfaces:**
- Produces: `ModelFamily::MeanVc2`（serde `"meanvc2"`）
- Produces: 条目 `meanvc2-int8`、`meanvc2-speaker`（feature 都是 `voice-change`）

- [ ] **Step 1: 写失败的测试**

```rust
#[test]
fn meanvc2_entries_are_download_only() {
    let convert = crate::models::by_id("meanvc2-int8").expect("转换图条目");
    assert_eq!(convert.feature, "voice-change");
    assert!(!convert.bundled);
    assert!(!convert.bundle_eligible(), "74 MB 必须走按需下载");
    let speaker = crate::models::by_id("meanvc2-speaker").expect("音色编码器条目");
    assert!(speaker.family == crate::models::ModelFamily::MeanVc2);
    assert!(speaker.total_bytes() > 10 * 1024 * 1024);
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib meanvc2_entries_are_download_only`
Expected: FAIL —— `by_id` 返回 `None`

- [ ] **Step 3: 加枚举与条目（sha256 / size 取自 HF 的 manifest.json）**

```rust
// ModelFamily 里与 ZipVoice 并列
#[serde(rename = "meanvc2")]
MeanVc2,
```

```rust
ModelEntry {
    id: "meanvc2-int8",
    name: "MeanVC2（18M · 零样本变声 · int8）",
    feature: "voice-change",
    tag: "audio",
    license: "Apache-2.0",
    family: ModelFamily::MeanVc2,
    recommended: true,
    bundled: false,
    files: &[
        ModelFile {
            filename: "fbank.onnx",
            approx_bytes: 908_339,
            sha256: "ecbe193170abe98a8c0ba9299e8fe21b418145aca924e351c667b9257c3e28c8",
            sources: &[verified(
                "hf",
                "intl",
                "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/fbank.onnx",
                "ecbe193170abe98a8c0ba9299e8fe21b418145aca924e351c667b9257c3e28c8",
                908_339,
            )],
        },
        ModelFile {
            filename: "asr.int8.onnx",
            approx_bytes: 28_655_587,
            sha256: "553869e3159af4497582072e66f09c16032a3b98ac2bad5c195b7443627616be",
            sources: &[verified(
                "hf",
                "intl",
                "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/asr.int8.onnx",
                "553869e3159af4497582072e66f09c16032a3b98ac2bad5c195b7443627616be",
                28_655_587,
            )],
        },
        ModelFile {
            filename: "gtm.onnx",
            approx_bytes: 17_441_893,
            sha256: "f03ff1e9da3c373445f7518fa36fc99980fe4326447235fa89ea1923f57ee224",
            sources: &[verified(
                "hf",
                "intl",
                "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/gtm.onnx",
                "f03ff1e9da3c373445f7518fa36fc99980fe4326447235fa89ea1923f57ee224",
                17_441_893,
            )],
        },
        ModelFile {
            filename: "dit.int8.onnx",
            approx_bytes: 13_849_138,
            sha256: "52ac682ed1790b196333d1dbf99fa2806b6c52076c85e438c9dede968572675a",
            sources: &[verified(
                "hf",
                "intl",
                "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/dit.int8.onnx",
                "52ac682ed1790b196333d1dbf99fa2806b6c52076c85e438c9dede968572675a",
                13_849_138,
            )],
        },
        ModelFile {
            filename: "vocos.int8.onnx",
            approx_bytes: 12_998_461,
            sha256: "a0dbd4c83708f6e787ceebf1c1b0833398dbdea6af770887d27b19119bba2e16",
            sources: &[verified(
                "hf",
                "intl",
                "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/vocos.int8.onnx",
                "a0dbd4c83708f6e787ceebf1c1b0833398dbdea6af770887d27b19119bba2e16",
                12_998_461,
            )],
        },
    ],
},
ModelEntry {
    id: "meanvc2-speaker",
    name: "MeanVC2 音色编码器（WavLM + ECAPA · int8）",
    feature: "voice-change",
    tag: "audio",
    license: "CC-BY-SA-3.0",
    family: ModelFamily::MeanVc2,
    recommended: false,
    bundled: false,
    files: &[ModelFile {
        filename: "speaker.int8.onnx",
        approx_bytes: 387_106_790,
        sha256: "ccd31b45eb2162937b94921d6e64fdd2cf5bf77193ad6f738e85f06a914a95ca",
        sources: &[verified(
            "hf",
            "intl",
            "https://huggingface.co/kiarina/MeanVC2-ONNX/resolve/main/speaker/speaker.int8.onnx",
            "ccd31b45eb2162937b94921d6e64fdd2cf5bf77193ad6f738e85f06a914a95ca",
            387_106_790,
        )],
    }],
},
```

> 魔搭镜像上传后（Task 13），给每个文件追加一条 `verified("modelscope", "cn", "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/voice/meanvc2/<file>", <同 sha256>, <同 size>)`。

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test --lib meanvc2_entries_are_download_only`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/models.rs
git commit -m "feat(voice): 模型目录加入 MeanVC2 转换图与音色编码器"
```

---

### Task 5: MeanVC2 宿主循环的纯函数

**Files:**
- Create: `src-tauri/src/voice_change/meanvc2.rs`
- Test: 同文件

**Interfaces:**
- Produces: `meanvc2::interp_align_corners(x: &[f32], frames: usize, channels: usize, size: usize) -> Vec<f32>`
- Produces: `meanvc2::chunk_plan(total: usize) -> impl Iterator<Item = (usize, usize)>`
- Produces: 常量 `CHUNK / BN_WINDOW / BN_STRIDE / REQUIRED_CACHE / DIT_CHUNK / BLOCK / VOCODER_OVERLAP / WAV_OVERLAP`

- [ ] **Step 1: 写失败的测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolation_matches_align_corners() {
        assert_eq!(interp_align_corners(&[0.0, 10.0], 2, 1, 3), vec![0.0, 5.0, 10.0]);
    }

    #[test]
    fn interpolation_keeps_channels() {
        let out = interp_align_corners(&[0.0, 1.0, 10.0, 11.0], 2, 2, 3);
        assert_eq!(out, vec![0.0, 1.0, 5.0, 6.0, 10.0, 11.0]);
    }

    #[test]
    fn plan_covers_every_sample_in_160ms_chunks() {
        let plan: Vec<_> = chunk_plan(CHUNK * 3 + 100).collect();
        assert_eq!(plan.len(), 4);
        assert_eq!(plan[0], (0, CHUNK));
        assert_eq!(plan[3].0, CHUNK * 3);
        assert_eq!(plan[3].1, CHUNK);
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib voice_change::meanvc2`
Expected: 编译失败

- [ ] **Step 3: 实现**

```rust
//! MeanVC2（18M，16 kHz）：六张 ONNX 图 + 上游流式宿主循环。

pub const SR: usize = 16_000;
pub const CHUNK: usize = 2560; // 160 ms
pub const BN_WINDOW: usize = 19;
pub const BN_STRIDE: usize = 16;
pub const REQUIRED_CACHE: usize = 8;
pub const ASR_OFFSET_INIT: i64 = 8;
pub const ASR_OFFSET_STEP: i64 = 4;
pub const DIT_CHUNK: usize = 12;
pub const BLOCK: usize = 4;
pub const VOCODER_OVERLAP: usize = 2;
pub const WAV_OVERLAP: usize = 160;

/// `F.interpolate(mode="linear", align_corners=True)`，按帧维插值。
pub fn interp_align_corners(x: &[f32], frames: usize, channels: usize, size: usize) -> Vec<f32> {
    if frames == 0 || size == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0f32; size * channels];
    if frames == 1 {
        for i in 0..size {
            out[i * channels..(i + 1) * channels].copy_from_slice(&x[..channels]);
        }
        return out;
    }
    let scale = (frames - 1) as f32 / (size - 1) as f32;
    for i in 0..size {
        let pos = i as f32 * scale;
        let lo = (pos.floor() as usize).min(frames - 2);
        let w = pos - lo as f32;
        for c in 0..channels {
            let a = x[lo * channels + c];
            let b = x[(lo + 1) * channels + c];
            out[i * channels + c] = a * (1.0 - w) + b * w;
        }
    }
    out
}

/// 把整段音频切成 160 ms 块（最后一块由调用方补零）。
pub fn chunk_plan(total: usize) -> impl Iterator<Item = (usize, usize)> {
    let chunks = total.div_ceil(CHUNK).max(1);
    (0..chunks).map(move |i| (i * CHUNK, CHUNK))
}
```

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test --lib voice_change::meanvc2`
Expected: 3 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/voice_change/meanvc2.rs
git commit -m "feat(voice): MeanVC2 宿主循环的插值与分块"
```

---

### Task 6: MeanVC2 会话与整段转换

**Files:**
- Modify: `src-tauri/src/voice_change/meanvc2.rs`
- Test: 同文件（权重缺失时跳过）

**Interfaces:**
- Consumes: Task 5 的常量与 `interp_align_corners`
- Produces: `meanvc2::Model::load(dir: &Path, steps: usize) -> Result<Self, String>`
- Produces: `Model::embed(&mut self, samples: &[f32]) -> Result<Vec<f32>, String>`
- Produces: `Model::convert(&mut self, samples: &[f32], spk: &[f32], seed: u64, progress: Progress) -> Result<Vec<f32>, String>`

- [ ] **Step 1: 写测试（权重缺失时跳过）**

```rust
#[test]
fn conversion_is_deterministic_when_weights_exist() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.models/meanvc2");
    if !dir.join("dit.int8.onnx").is_file() {
        eprintln!("跳过：未安装 MeanVC2 权重（{}）", dir.display());
        return;
    }
    let mut model = Model::load(&dir, 2).expect("加载模型");
    let speech = vec![0.0f32; SR * 2];
    let spk = vec![0.0f32; 256];
    let a = model.convert(&speech, &spk, 7, &|_| true).expect("第一次");
    let b = model.convert(&speech, &spk, 7, &|_| true).expect("第二次");
    assert_eq!(a.len(), b.len());
    assert!(a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-6));
}
```

- [ ] **Step 2: 跑测试确认编译失败**

Run: `cd src-tauri && cargo test --lib voice_change::meanvc2`
Expected: FAIL —— `Model` 未定义

- [ ] **Step 3: 实现会话与宿主循环**

```rust
use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use crate::audio_ai::{build_session, Progress};

pub struct Model {
    fbank: Session,
    asr: Session,
    gtm: Session,
    dit: Session,
    vocos: Session,
    speaker: Session,
    steps: usize,
}

/// 跨块的缓存，逐块推进。
#[derive(Default)]
struct State {
    samples: Vec<f32>,
    frames: Option<Vec<f32>>,
    bn_cache: Option<Vec<f32>>,
    asr_offset: i64,
    att: Vec<f32>,
    cnn: Vec<f32>,
    kv: Vec<Vec<f32>>, // 8 个 [1,2,L,64]
    vc_offset: i64,
    bn: Option<Vec<f32>>,
    noise: Option<Vec<f32>>,
    voc_mel: Option<Vec<f32>>,
    last_wav: Option<Vec<f32>>,
}

impl Model {
    /// `dir` 里需有 fbank / asr.int8 / gtm / dit.int8 / vocos.int8 / speaker.int8。
    pub fn load(dir: &Path, steps: usize) -> Result<Self, String> {
        let file = |name: &str| dir.join(name);
        Ok(Self {
            fbank: build_session(&file("fbank.onnx"), "MeanVC2 fbank")?,
            asr: build_session(&file("asr.int8.onnx"), "MeanVC2 asr")?,
            gtm: build_session(&file("gtm.onnx"), "MeanVC2 gtm")?,
            dit: build_session(&file("dit.int8.onnx"), "MeanVC2 dit")?,
            vocos: build_session(&file("vocos.int8.onnx"), "MeanVC2 vocos")?,
            speaker: build_session(&file("speaker.int8.onnx"), "MeanVC2 speaker")?,
            steps: steps.clamp(1, 3),
        })
    }

    pub fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>, String> {
        let input = Tensor::from_array(([1usize, samples.len()], samples.to_vec()))
            .map_err(|e| format!("音色输入失败：{e}"))?;
        let outputs = self
            .speaker
            .run(ort::inputs!["wav" => input])
            .map_err(|e| format!("音色编码失败：{e}"))?;
        let (_, values) = outputs["embedding"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("音色向量读取失败：{e}"))?;
        Ok(values.to_vec())
    }

    /// 整段转换：逐 160 ms 块推进，输出同长度 16 kHz 单声道。
    pub fn convert(
        &mut self,
        samples: &[f32],
        spk: &[f32],
        seed: u64,
        progress: Progress,
    ) -> Result<Vec<f32>, String> {
        let gtm = self
            .gtm
            .run(ort::inputs![
                "spks" => Tensor::from_array(([1usize, 256], spk.to_vec()))
                    .map_err(|e| format!("说话人向量形状错误：{e}"))?
            ])
            .map_err(|e| format!("音色记忆失败：{e}"))?;
        let (_, k_mem) = gtm["k_mem"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        let (_, v_mem) = gtm["v_mem"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        let k_mem = k_mem.to_vec();
        let v_mem = v_mem.to_vec();

        let mut state = State {
            asr_offset: ASR_OFFSET_INIT,
            att: vec![0.0; 6 * 4 * REQUIRED_CACHE * 128],
            cnn: vec![0.0; 6 * 1 * 256 * 8],
            kv: vec![Vec::new(); 8],
            ..State::default()
        };
        let mut rng = SplitMix64::new(seed);
        let mut out = Vec::with_capacity(samples.len() + CHUNK);
        for (start, _) in chunk_plan(samples.len()) {
            let mut block = vec![0.0f32; CHUNK];
            let end = (start + CHUNK).min(samples.len());
            if start < end {
                block[..end - start].copy_from_slice(&samples[start..end]);
            }
            out.extend_from_slice(&self.step(&mut state, &block, spk, &k_mem, &v_mem, &mut rng)?);
            if !progress((end as f32 / samples.len().max(1) as f32).clamp(0.0, 1.0)) {
                return Err("已取消".into());
            }
        }
        out.truncate(samples.len());
        Ok(out)
    }

    /// 一块：ASR → DiT（1..3 步 ODE）→ Vocos，返回本块的 16 kHz 波形。
    fn step(
        &mut self,
        st: &mut State,
        block: &[f32],
        spk: &[f32],
        k_mem: &[f32],
        v_mem: &[f32],
        rng: &mut SplitMix64,
    ) -> Result<Vec<f32>, String> {
        // 1) fbank：400 采样一帧、160 步进，×32768。
        let mut padded = st.samples.clone();
        padded.extend_from_slice(block);
        if padded.len() < 400 {
            st.samples = padded;
            return Ok(Vec::new());
        }
        let frames = 1 + (padded.len() - 400) / 160;
        let mut buf = Vec::with_capacity(frames * 400);
        for i in 0..frames {
            for j in 0..400 {
                buf.push(padded[i * 160 + j] * 32768.0);
            }
        }
        st.samples = padded[160 * frames..].to_vec();
        let fb = self
            .fbank
            .run(ort::inputs![
                "frames" => Tensor::from_array(([frames, 400], buf)).map_err(|e| e.to_string())?
            ])
            .map_err(|e| format!("fbank 失败：{e}"))?;
        let (_, fb) = fb["fbank"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        let mut fb = fb.to_vec();
        if let Some(prev) = st.frames.take() {
            let mut merged = prev;
            merged.extend_from_slice(&fb);
            fb = merged;
        }
        if st.asr_offset >= 4000 {
            st.asr_offset = (st.asr_offset - 4000).max(REQUIRED_CACHE as i64);
        }

        // 2) ASR：19 帧滑窗、步进 16。
        let mut bns: Vec<f32> = Vec::new();
        let mut i = 0;
        let mut att = st.att.clone();
        let mut cnn = st.cnn.clone();
        while i + BN_WINDOW <= fb.len() / 80 {
            let window = fb[i * 80..(i + BN_WINDOW) * 80].to_vec();
            let outputs = self
                .asr
                .run(ort::inputs![
                    "xs" => Tensor::from_array(([1usize, BN_WINDOW, 80], window)).map_err(|e| e.to_string())?,
                    "offset" => Tensor::from_array((Vec::<usize>::new(), vec![st.asr_offset])).map_err(|e| e.to_string())?,
                    "required_cache_size" => Tensor::from_array((Vec::<usize>::new(), vec![REQUIRED_CACHE as i64])).map_err(|e| e.to_string())?,
                    "att_cache" => Tensor::from_array(([6usize, 4, REQUIRED_CACHE, 128], att)).map_err(|e| e.to_string())?,
                    "cnn_cache" => Tensor::from_array(([6usize, 1, 256, 8], cnn)).map_err(|e| e.to_string())?,
                ])
                .map_err(|e| format!("ASR 失败：{e}"))?;
            let (_, bn) = outputs["bn"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            bns.extend_from_slice(bn);
            let (_, next_att) = outputs["new_att_cache"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            let (_, next_cnn) = outputs["new_cnn_cache"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            att = next_att.to_vec();
            cnn = next_cnn.to_vec();
            st.asr_offset += ASR_OFFSET_STEP;
            i += BN_STRIDE;
        }
        st.att = att;
        st.cnn = cnn;
        st.frames = Some(fb[i * 80..].to_vec());
        if bns.is_empty() {
            return Ok(Vec::new());
        }

        // 3) BNF 插值到 17 帧、丢首帧；缓存上一块最后一帧。
        let mut bns = bns;
        if let Some(cache) = st.bn_cache.take() {
            let mut merged = cache;
            merged.extend_from_slice(&bns);
            bns = merged;
        }
        let rows = bns.len() / 256;
        st.bn_cache = Some(bns[(rows - 1) * 256..].to_vec());
        if rows < 2 {
            return Ok(Vec::new());
        }
        let interp = interp_align_corners(&bns, rows, 256, 17);
        let mut cond = st.bn.take().unwrap_or_default();
        cond.extend_from_slice(&interp[256..]);

        // 4) 每凑够 16 帧跑一次 DiT + Vocos。
        let mut wav: Vec<f32> = Vec::new();
        let mut guard = 0;
        while cond.len() / 256 >= DIT_CHUNK + BLOCK {
            guard += 1;
            if guard > 4 {
                break;
            }
            let mel = self.vc_step(st, &cond[..(DIT_CHUNK + BLOCK) * 256], spk, k_mem, v_mem, rng)?;
            cond.drain(..DIT_CHUNK * 256);
            wav.extend_from_slice(&self.decode_mel(st, &mel)?);
        }
        st.bn = Some(cond);
        Ok(wav)
    }
}
```

`vc_step` / `decode_mel`：

```rust
impl Model {
    fn vc_step(
        &mut self,
        st: &mut State,
        cond: &[f32],
        spk: &[f32],
        k_mem: &[f32],
        v_mem: &[f32],
        rng: &mut SplitMix64,
    ) -> Result<Vec<f32>, String> {
        let frames = DIT_CHUNK + BLOCK;
        let dt = 1.0f32 / self.steps as f32;
        let mut x: Vec<f32> = (0..frames * 80).map(|_| rng.normal() as f32).collect();
        if let Some(prev) = st.noise.take() {
            x[..BLOCK * 80].copy_from_slice(&prev);
        }
        st.noise = Some(x[(frames - BLOCK) * 80..].to_vec());
        if st.vc_offset >= 4000 {
            st.vc_offset = 0;
            st.kv = vec![Vec::new(); 8];
        }

        let mut offset = st.vc_offset;
        let mut kv = st.kv.clone();
        let mut last: Option<Vec<f32>> = None;
        for i in 0..self.steps {
            let t_val = 1.0 - i as f32 * dt;
            let r_val = (t_val - dt).max(0.0);
            let mut inputs = ort::inputs![
                "x" => Tensor::from_array(([1usize, frames, 80], x.clone())).map_err(|e| e.to_string())?,
                "t" => Tensor::from_array(([1usize], vec![t_val])).map_err(|e| e.to_string())?,
                "r" => Tensor::from_array(([1usize], vec![r_val])).map_err(|e| e.to_string())?,
                "cond" => Tensor::from_array(([1usize, frames, 256], cond.to_vec())).map_err(|e| e.to_string())?,
                "spks" => Tensor::from_array(([1usize, 256], spk.to_vec())).map_err(|e| e.to_string())?,
                "k_mem" => Tensor::from_array(([1usize, 32, 256], k_mem.to_vec())).map_err(|e| e.to_string())?,
                "v_mem" => Tensor::from_array(([1usize, 32, 256], v_mem.to_vec())).map_err(|e| e.to_string())?,
                "offset" => Tensor::from_array((Vec::<usize>::new(), vec![offset])).map_err(|e| e.to_string())?,
            ];
            // 4 层 KV 缓存：长度 0 时用空张量。
            for layer in 0..4 {
                let len = kv[layer * 2].len() / 128;
                inputs.push(
                    Box::leak(format!("k_cache{layer}").into_boxed_str()),
                    Tensor::from_array(([1usize, 2, len, 64], kv[layer * 2].clone()))
                        .map_err(|e| e.to_string())?
                        .into(),
                );
                inputs.push(
                    Box::leak(format!("v_cache{layer}").into_boxed_str()),
                    Tensor::from_array(([1usize, 2, len, 64], kv[layer * 2 + 1].clone()))
                        .map_err(|e| e.to_string())?
                        .into(),
                );
            }
            let outputs = self.dit.run(inputs).map_err(|e| format!("DiT 失败：{e}"))?;
            let (_, u) = outputs["u"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
            for (value, delta) in x.iter_mut().zip(u.iter()) {
                *value -= dt * delta;
            }
            if i == self.steps - 1 {
                let mut next = vec![Vec::new(); 8];
                for layer in 0..4 {
                    let (_, k) = outputs[&format!("new_k_cache{layer}") as &str]
                        .try_extract_tensor::<f32>()
                        .map_err(|e| e.to_string())?;
                    let (_, v) = outputs[&format!("new_v_cache{layer}") as &str]
                        .try_extract_tensor::<f32>()
                        .map_err(|e| e.to_string())?;
                    next[layer * 2] = k.to_vec();
                    next[layer * 2 + 1] = v.to_vec();
                }
                last = Some(x[..DIT_CHUNK * 80].to_vec());
                kv = next;
            }
        }
        st.kv = kv;
        st.vc_offset = offset + DIT_CHUNK as i64;
        Ok(last.ok_or_else(|| "DiT 没有输出".to_string())?)
    }

    fn decode_mel(&mut self, st: &mut State, mel: &[f32]) -> Result<Vec<f32>, String> {
        let mut frames = mel.to_vec();
        if let Some(cache) = st.voc_mel.take() {
            let mut merged = cache;
            merged.extend_from_slice(&frames);
            frames = merged;
        }
        let total = frames.len() / 80;
        st.voc_mel = Some(frames[(total - VOCODER_OVERLAP) * 80..].to_vec());
        for value in frames.iter_mut() {
            *value = (*value + 1.0) / 2.0;
        }
        let outputs = self
            .vocos
            .run(ort::inputs![
                "mel" => Tensor::from_array(([1usize, 80, total], frames)).map_err(|e| e.to_string())?
            ])
            .map_err(|e| format!("Vocos 失败：{e}"))?;
        let (_, wav) = outputs["wav"].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
        let mut wav = wav.to_vec();
        let out = if let Some(last) = st.last_wav.take() {
            let front: Vec<f32> = wav[..WAV_OVERLAP].to_vec();
            let mut merged = Vec::with_capacity(wav.len());
            for i in 0..WAV_OVERLAP {
                let down = 1.0 - i as f32 / WAV_OVERLAP as f32;
                let up = i as f32 / WAV_OVERLAP as f32;
                merged.push(last[i] * down + front[i] * up);
            }
            merged.extend_from_slice(&wav[WAV_OVERLAP..wav.len() - WAV_OVERLAP]);
            merged
        } else {
            wav.truncate(wav.len() - WAV_OVERLAP);
            wav
        };
        st.last_wav = Some(out[out.len() - WAV_OVERLAP..].to_vec());
        Ok(out)
    }
}
```

随机数：

```rust
struct SplitMix64(u64);

impl SplitMix64 {
    fn new(seed: u64) -> Self {
        Self(seed ^ 0x9e3779b97f4a7c15)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    /// Box–Muller，标准正态。
    fn normal(&mut self) -> f64 {
        let u1 = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64;
        let u2 = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64;
        (-2.0 * u1.max(1e-12).ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
    }
}
```

> `inputs.push(Box::leak(...))` 只为演示动态键名；若 `ort` 的 `inputs!` 宏不支持运行时键，
> 改成四层显式写死字面量（`"k_cache0" => …` …），不要泄漏字符串。实施时以编译器为准。

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test --lib voice_change::meanvc2`
Expected: 权重不在时跳过；在时两次结果逐样本一致

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/voice_change/meanvc2.rs
git commit -m "feat(voice): MeanVC2 六图会话与整段转换"
```

---

### Task 7: 批量转换与音色命令

**Files:**
- Modify: `src-tauri/src/voice_change/mod.rs`
- Modify: `src-tauri/src/lib.rs`（命令注册）
- Test: `src-tauri/src/voice_change/mod.rs`

**Interfaces:**
- Produces: `EVENT_VOICE: &str = "voice-change-progress"`
- Produces: `voice_change_convert`、`voice_change_cancel`、`voice_change_voice_list`、`voice_change_voice_import`、`voice_change_voice_delete`

- [ ] **Step 1: 写测试**

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn batch_progress_is_monotonic() {
        let mut last = 0.0f32;
        for (index, inner) in [(0usize, 0.0f32), (0, 0.5), (1, 0.0), (1, 1.0)] {
            let p = super::clip_progress(index, 2, inner);
            assert!(p >= last, "{p} < {last}");
            last = p;
        }
        assert!((last - 1.0).abs() < 1e-6);
    }

    #[test]
    fn seeds_differ_between_clips() {
        assert_ne!(super::seed_of("clip-a"), super::seed_of("clip-b"));
        assert_eq!(super::seed_of("clip-a"), super::seed_of("clip-a"));
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib voice_change::tests`
Expected: 编译失败

- [ ] **Step 3: 实现**

```rust
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::audio_ai::{decode_segment, write_wav, OUT_CHANNELS, OUT_SAMPLE_RATE};
use crate::models;
use crate::paths;
use crate::voice_change::meanvc2::Model;
use crate::voice_change::refs::{normalize, pick_window, REF_SR};
use crate::voice_change::voices::{VoiceEntry, VoiceLibrary, VoiceSource};

pub const EVENT_VOICE: &str = "voice-change-progress";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VcClip {
    pub clip_id: String,
    pub path: String,
    pub start: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcClipResult {
    pub clip_id: String,
    pub path: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoProgress {
    state: String,
    progress: f32,
    index: usize,
    total: usize,
    message: Option<String>,
}

static CANCEL: AtomicBool = AtomicBool::new(false);

fn emit(
    app: &AppHandle,
    state: &str,
    progress: f32,
    index: usize,
    total: usize,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_VOICE,
        VoProgress {
            state: state.into(),
            progress: progress.clamp(0.0, 1.0),
            index,
            total,
            message,
        },
    );
}

fn cancelled() -> bool {
    CANCEL.load(Ordering::Relaxed)
}

pub(crate) fn clip_progress(index: usize, total: usize, inner: f32) -> f32 {
    if total == 0 {
        return 0.0;
    }
    ((index as f32 + inner.clamp(0.0, 1.0)) / total as f32).clamp(0.0, 1.0)
}

pub(crate) fn seed_of(clip_id: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in clip_id.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn library(app: &AppHandle) -> Result<VoiceLibrary, String> {
    VoiceLibrary::open(&paths::data_dir(app)?.join("voices"))
}

fn to_16k(interleaved: &[f32], channels: usize) -> Vec<f32> {
    let channels = channels.max(1);
    let mono: Vec<f32> = interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    crate::audio_ai::resample::resample(&mono, OUT_SAMPLE_RATE as f64, REF_SR)
}

fn upsample(mono: &[f32]) -> Vec<f32> {
    let stereo = crate::audio_ai::resample::resample(mono, REF_SR, OUT_SAMPLE_RATE as f64);
    stereo.iter().flat_map(|v| [*v, *v]).collect()
}

#[tauri::command]
pub async fn voice_change_convert(
    app: AppHandle,
    clips: Vec<VcClip>,
    voice_id: String,
    model_id: String,
) -> Result<Vec<VcClipResult>, String> {
    let entry = models::by_id(&model_id).ok_or_else(|| format!("未知模型：{model_id}"))?;
    if entry.feature != "voice-change" {
        return Err(format!("{} 不是变声模型", entry.name));
    }
    if clips.is_empty() {
        return Err("没有要处理的片段".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let dir = models::require_dir(&app, entry)?;
    let spk = library(&app)?.embedding(&voice_id)?;
    let total = clips.len();
    let app_for_task = app.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<VcClipResult>, String> {
        let mut model = Model::load(&dir, 2)?;
        let mut results = Vec::with_capacity(total);
        for (index, clip) in clips.iter().enumerate() {
            if cancelled() {
                return Err("已取消".into());
            }
            emit(&app_for_task, "decoding", clip_progress(index, total, 0.02), index, total, None);
            let interleaved = tauri::async_runtime::block_on(decode_segment(
                &app_for_task,
                &clip.path,
                clip.start,
                clip.duration,
            ))?;
            if interleaved.is_empty() {
                return Err(format!("片段 {} 没有音频", clip.clip_id));
            }
            let mono = to_16k(&interleaved, OUT_CHANNELS as usize);
            emit(&app_for_task, "processing", clip_progress(index, total, 0.05), index, total, None);
            let out = model.convert(&mono, &spk, seed_of(&clip.clip_id), &|p| {
                emit(
                    &app_for_task,
                    "processing",
                    clip_progress(index, total, 0.05 + p * 0.9),
                    index,
                    total,
                    None,
                );
                !cancelled()
            })?;
            emit(&app_for_task, "writing", clip_progress(index, total, 0.97), index, total, None);
            let path = crate::media::cache_dir(&app_for_task)?.join(format!("voice-{}.wav", clip.clip_id));
            write_wav(&path, &upsample(&out), OUT_CHANNELS, OUT_SAMPLE_RATE)?;
            results.push(VcClipResult {
                clip_id: clip.clip_id.clone(),
                path: path.to_string_lossy().into_owned(),
                duration: out.len() as f64 / REF_SR,
            });
        }
        emit(&app_for_task, "done", 1.0, total, total, Some("变声完成".into()));
        Ok(results)
    })
    .await
    .map_err(|e| format!("变声任务异常：{e}"))?
}

#[tauri::command]
pub fn voice_change_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn voice_change_voice_list(app: AppHandle) -> Result<Vec<VoiceEntry>, String> {
    library(&app)?.list()
}

#[tauri::command]
pub async fn voice_change_voice_import(
    app: AppHandle,
    asset_path: String,
    name: String,
    start: Option<f64>,
    duration: Option<f64>,
    speaker_model_id: String,
) -> Result<VoiceEntry, String> {
    let entry = models::by_id(&speaker_model_id).ok_or_else(|| format!("未知模型：{speaker_model_id}"))?;
    if entry.id != "meanvc2-speaker" {
        return Err("需要 MeanVC2 音色编码器".into());
    }
    let dir = models::require_dir(&app, entry)?;

    let start = start.unwrap_or(0.0);
    let duration = duration.unwrap_or(0.0);
    let decoded = if duration > 0.0 {
        decode_segment(&app, &asset_path, start, duration).await?
    } else {
        let seconds = crate::media::probe_duration(&app, std::path::Path::new(&asset_path))
            .await?
            .max(0.1);
        decode_segment(&app, &asset_path, 0.0, seconds).await?
    };
    let mono = to_16k(&decoded, OUT_CHANNELS as usize);
    let window = pick_window(&mono, REF_SR).ok_or_else(|| {
        "参考音频里没有足够的连续人声（至少 3 秒），换一段试试".to_string()
    })?;
    let mut reference = mono[window.start..window.start + window.len].to_vec();
    normalize(&mut reference, -3.0);

    let mut model = tauri::async_runtime::spawn_blocking(move || {
        let mut model = Model::load(&dir, 2)?;
        let embedding = model.embed(&reference)?;
        Ok::<_, String>((embedding, reference))
    })
    .await
    .map_err(|e| format!("音色编码异常：{e}"))??;

    library(&app)?.add(
        name,
        VoiceSource { asset_id: None, name: asset_path },
        &mut model.1,
        &model.0,
    )
}

#[tauri::command]
pub fn voice_change_voice_delete(app: AppHandle, id: String) -> Result<(), String> {
    library(&app)?.remove(&id)
}
```

> `crate::media::probe_duration` 若不存在，用 `crate::media::probe_media` 拿时长（见 `audio_ai::probe_duration` 的用法）。

- [ ] **Step 4: 跑测试**

Run: `cd src-tauri && cargo test --lib voice_change`
Expected: 全部 PASS

- [ ] **Step 5: 注册命令并编译**

```rust
// src-tauri/src/lib.rs，跟随 audio_ai::audio_ai_denoise 之后
voice_change::voice_change_convert,
voice_change::voice_change_cancel,
voice_change::voice_change_voice_list,
voice_change::voice_change_voice_import,
voice_change::voice_change_voice_delete,
```

Run: `cd src-tauri && cargo check --lib`
Expected: 通过

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/voice_change/mod.rs src-tauri/src/lib.rs
git commit -m "feat(voice): 批量变声、音色导入与进度事件"
```

---

### Task 8: 前端类型、API 与 store

**Files:**
- Create: `src/types/voiceChange.ts`
- Create: `src/core/voiceChangeApi.ts`
- Create: `src/stores/voiceChange.ts`
- Modify: `src/types/models.ts:36-49`（`ModelFeature` 加 `"voice-change"`）
- Test: `src/core/__tests__/voiceChangeApi.test.ts`

**Interfaces:**
- Produces: `VoiceEntry`、`VcClipRequest`、`VcClipResult`、`VoiceProgress`、`EVENT_VOICE`
- Produces: `convertVoiceBatch`、`cancelVoiceChange`、`listVoices`、`importVoice`、`deleteVoice`、`onVoiceProgress`
- Produces: `useVoiceChangeStore()`（`running / progress / index / total / voiceId / modelId / start / finish / cancel`）

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => []);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@/utils/platform", () => ({ isTauri: () => true }));

import { convertVoiceBatch, importVoice } from "@/core/voiceChangeApi";

describe("voice change api", () => {
  it("passes camelCase payload to the command", async () => {
    await convertVoiceBatch(
      [{ clipId: "c1", path: "/a.wav", start: 1, duration: 2 }],
      "v-1",
      "meanvc2-int8",
    );
    expect(invoke).toHaveBeenCalledWith("voice_change_convert", {
      clips: [{ clipId: "c1", path: "/a.wav", start: 1, duration: 2 }],
      voiceId: "v-1",
      modelId: "meanvc2-int8",
    });
  });

  it("imports a voice with the speaker model id", async () => {
    await importVoice("/a.wav", "张三");
    expect(invoke).toHaveBeenCalledWith("voice_change_voice_import", {
      assetPath: "/a.wav",
      name: "张三",
      start: null,
      duration: null,
      speakerModelId: "meanvc2-speaker",
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/__tests__/voiceChangeApi.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

```ts
// src/types/voiceChange.ts
export interface VcClipRequest {
  clipId: string;
  path: string;
  start: number;
  duration: number;
}

export interface VcClipResult {
  clipId: string;
  path: string;
  duration: number;
}

export interface VoiceSource {
  assetId?: string | null;
  name: string;
}

export interface VoiceEntry {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  source: VoiceSource;
}

export type VoiceState = "decoding" | "processing" | "writing" | "done" | "error";

export interface VoiceProgress {
  state: VoiceState;
  progress: number;
  index: number;
  total: number;
  message: string | null;
}

export const EVENT_VOICE = "voice-change-progress";
```

```ts
// src/core/voiceChangeApi.ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  VcClipRequest,
  VcClipResult,
  VoiceEntry,
  VoiceProgress,
} from "@/types/voiceChange";
import { EVENT_VOICE } from "@/types/voiceChange";
import { isTauri } from "@/utils/platform";

function guard<T>(label: string, run: () => Promise<T>): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error(`${label}需要在桌面应用中使用`));
  return run();
}

export function convertVoiceBatch(
  clips: VcClipRequest[],
  voiceId: string,
  modelId: string,
): Promise<VcClipResult[]> {
  return guard("AI 变声", () =>
    invoke<VcClipResult[]>("voice_change_convert", { clips, voiceId, modelId }),
  );
}

export function cancelVoiceChange(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("voice_change_cancel");
}

export function listVoices(): Promise<VoiceEntry[]> {
  return guard("读取音色库", () => invoke<VoiceEntry[]>("voice_change_voice_list"));
}

export function importVoice(
  assetPath: string,
  name: string,
  start: number | null = null,
  duration: number | null = null,
  speakerModelId = "meanvc2-speaker",
): Promise<VoiceEntry> {
  return guard("导入音色", () =>
    invoke<VoiceEntry>("voice_change_voice_import", {
      assetPath,
      name,
      start,
      duration,
      speakerModelId,
    }),
  );
}

export function deleteVoice(id: string): Promise<void> {
  return guard("删除音色", () => invoke<void>("voice_change_voice_delete", { id }));
}

export function onVoiceProgress(
  handler: (payload: VoiceProgress) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => undefined);
  return listen<VoiceProgress>(EVENT_VOICE, (event) => handler(event.payload));
}
```

```ts
// src/stores/voiceChange.ts
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { cancelVoiceChange, onVoiceProgress } from "@/core/voiceChangeApi";

export const useVoiceChangeStore = defineStore("voiceChange", () => {
  const running = ref(false);
  const progress = ref(0);
  const index = ref(0);
  const total = ref(0);
  const message = ref<string | null>(null);
  /** 上次选择的音色 / 模型：跨工程记住。 */
  const voiceId = ref<string | null>(null);
  const modelId = ref("meanvc2-int8");
  let stop: (() => void) | null = null;

  const progressPct = computed(() => Math.round(progress.value * 100));

  function watch(): void {
    if (stop) return;
    void onVoiceProgress((payload) => {
      progress.value = payload.progress;
      index.value = payload.index;
      total.value = payload.total;
      if (payload.state === "done" || payload.state === "error") running.value = false;
    }).then((off) => {
      stop = off;
    });
  }

  function start(count: number): void {
    if (running.value) throw new Error("已有变声任务正在运行");
    watch();
    running.value = true;
    progress.value = 0;
    index.value = 0;
    total.value = count;
    message.value = null;
  }

  function finish(): void {
    running.value = false;
  }

  async function cancel(): Promise<void> {
    await cancelVoiceChange();
  }

  return { running, progress, index, total, message, voiceId, modelId, progressPct, start, finish, cancel };
});
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run src/core/__tests__/voiceChangeApi.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/types/voiceChange.ts src/core/voiceChangeApi.ts src/stores/voiceChange.ts src/types/models.ts src/core/__tests__/voiceChangeApi.test.ts
git commit -m "feat(voice): 前端变声 API 与进度 store"
```

---

### Task 9: `placeConvertedVoice`

**Files:**
- Create: `src/core/voiceEdit.ts`
- Test: `src/core/__tests__/voiceEdit.test.ts`

**Interfaces:**
- Consumes: `newProject` / `createTrack` / `createClip`（`@/core/factory`）、`addClip`、`setClipMuted`、`addTrack`
- Produces: `placeConvertedVoice(doc, items, baseName) -> Project`
- Produces: `ConvertedVoiceItem { clipId, assetId, duration }`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { placeConvertedVoice } from "@/core/voiceEdit";
import { createClip, createTrack, newProject } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

function projectWithClip() {
  let doc = newProject();
  doc = { ...doc, tracks: [] };
  doc = addTrack(doc, "对白");
  const track = doc.tracks[0];
  doc = addClip(
    doc,
    track.id,
    createClip({ assetId: "a-video", trackId: track.id, start: 2, duration: 5 }),
  );
  return { doc, trackId: track.id, clip: doc.tracks[0].clips[0] };
}

describe("placeConvertedVoice", () => {
  it("mutes the original and adds the result on a new track", () => {
    const { doc, clip } = projectWithClip();
    const next = placeConvertedVoice(
      doc,
      [{ clipId: clip.id, assetId: "a-voice", duration: 5 }],
      "AI 变声",
    );
    expect(next.tracks[0].clips[0].muted).toBe(true);
    const lane = next.tracks.find((track) => track.name === "AI 变声");
    expect(lane).toBeTruthy();
    expect(lane!.clips[0]).toMatchObject({ assetId: "a-voice", start: 2, duration: 5 });
  });

  it("keeps overlapping results on separate lanes", () => {
    const { doc, trackId, clip } = projectWithClip();
    const second = createClip({ assetId: "a-video-2", trackId, start: 3, duration: 2 });
    const withSecond = addClip(doc, trackId, second);
    const next = placeConvertedVoice(
      withSecond,
      [
        { clipId: clip.id, assetId: "a-voice", duration: 5 },
        { clipId: second.id, assetId: "a-voice-2", duration: 2 },
      ],
      "AI 变声",
    );
    const names = next.tracks.map((track) => track.name).filter((name) => name.startsWith("AI 变声"));
    expect(names.length).toBe(2);
  });

  it("clamps the result to the original duration", () => {
    const { doc, clip } = projectWithClip();
    const next = placeConvertedVoice(
      doc,
      [{ clipId: clip.id, assetId: "a-voice", duration: 99 }],
      "AI 变声",
    );
    const lane = next.tracks.find((track) => track.name === "AI 变声")!;
    expect(lane.clips[0].duration).toBe(5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/__tests__/voiceEdit.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

```ts
/**
 * 变声结果的落位：原片段就地静音，结果按原起点铺到「AI 变声」轨道。
 *
 * 复用朗读轨道的空轨打包规则：同名轨道放不下就自动加一条，
 * 保证任意两条结果不会在同一轨道上重叠。
 */
import type { Clip, Project } from "@/types/project";
import { createClip } from "@/core/factory";
import { addClip } from "@/core/ops/clips";
import { addTrack } from "@/core/ops/tracks";

export interface ConvertedVoiceItem {
  clipId: string;
  assetId: string;
  /** 模型输出的真实时长（秒）。 */
  duration: number;
}

function locate(doc: Project, clipId: string): Clip | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

export function placeConvertedVoice(
  doc: Project,
  items: ConvertedVoiceItem[],
  baseName: string,
): Project {
  if (items.length === 0) return doc;

  const ordered = items
    .map((item) => ({ item, clip: locate(doc, item.clipId) }))
    .filter((entry): entry is { item: ConvertedVoiceItem; clip: Clip } => entry.clip !== null)
    .sort((a, b) => a.clip.start - b.clip.start);

  let next = doc;
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:\\s+\\d+)?$`);
  const lanes: { id: string; spans: { start: number; end: number }[] }[] = [];
  for (const track of next.tracks) {
    if (track.locked || !pattern.test(track.name)) continue;
    lanes.push({
      id: track.id,
      spans: track.clips.map((clip) => ({
        start: clip.start,
        end: clip.start + clip.duration,
      })),
    });
  }

  for (const { item, clip } of ordered) {
    next = setClipMuted(next, clip.id, true);
    const duration = Math.min(item.duration, clip.duration);
    if (!(duration > 0)) continue;
    const end = clip.start + duration;

    let lane = lanes.find((candidate) =>
      candidate.spans.every((span) => end <= span.start || clip.start >= span.end),
    );
    if (!lane) {
      let name = baseName;
      let index = 2;
      while (next.tracks.some((track) => track.name === name)) name = `${baseName} ${index++}`;
      next = addTrack(next, name);
      const track = next.tracks[next.tracks.length - 1];
      lane = { id: track.id, spans: [] };
      lanes.push(lane);
    }

    next = addClip(
      next,
      lane.id,
      createClip({
        assetId: item.assetId,
        trackId: lane.id,
        start: clip.start,
        duration,
        in: 0,
      }),
    );
    lane.spans.push({ start: clip.start, end });
  }

  return next;
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run src/core/__tests__/voiceEdit.test.ts`
Expected: 3 个测试 PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/voiceEdit.ts src/core/__tests__/voiceEdit.test.ts
git commit -m "feat(voice): 变声结果落位（原片段静音 + 新轨）"
```

---

### Task 10: `convertVoice`、菜单动作与文案

**Files:**
- Modify: `src/core/aiActions.ts`
- Modify: `src/composables/useAiClipActions.ts`
- Modify: `src/i18n/zh.ts`、`src/i18n/en.ts`

**Interfaces:**
- Produces: `VoiceChangeParams { clipIds, voiceId, modelId }`
- Produces: `convertVoice(params, ctx)`
- Produces: `useAiClipActions().changeVoice(ids)`、`.openVoiceChange(ids)`

- [ ] **Step 1: `convertVoice`**

```ts
// src/core/aiActions.ts 顶部 import
import { convertVoiceBatch } from "@/core/voiceChangeApi";
import { placeConvertedVoice } from "@/core/voiceEdit";

export interface VoiceChangeParams {
  clipIds: string[];
  voiceId: string;
  modelId: string;
}

/** 离线变声：整批提交，结果按原位置落到「AI 变声」轨道，原片段静音。 */
export async function convertVoice(params: VoiceChangeParams, ctx: JobContext) {
  if (params.clipIds.length === 0) throw new Error("没有要变声的片段");
  const clips = params.clipIds.map((id) => {
    const { clip, asset } = requireMediaClip(id);
    if (asset.kind !== "audio" && asset.kind !== "video") {
      throw new Error(`片段 ${clip.id} 没有音频`);
    }
    return { clip, asset };
  });

  const results = await convertVoiceBatch(
    clips.map(({ clip, asset }) => ({
      clipId: clip.id,
      path: asset.src,
      start: clip.in ?? 0,
      duration: clip.duration,
    })),
    params.voiceId,
    params.modelId,
  );
  if (ctx.cancelled()) throw new Error("已取消");
  if (results.length === 0) throw new Error("变声没有产出音频");

  const imported = [];
  for (const result of results) {
    imported.push({
      result,
      asset: await importAsset(result.path, `${t("ai.voiceChangeTrack")} · ${result.clipId}`),
    });
  }

  const before = project().doc;
  project().dispatch(
    (doc) => {
      let next = doc;
      for (const item of imported) next = addAsset(next, item.asset);
      return placeConvertedVoice(
        next,
        imported.map(({ result, asset }) => ({
          clipId: result.clipId,
          assetId: asset.id,
          duration: result.duration,
        })),
        t("ai.voiceChangeTrack"),
      );
    },
    jobMeta(ctx, "AI 变声"),
  );

  return {
    count: imported.length,
    assets: imported.map((item) => ({ assetId: item.asset.id, duration: item.result.duration })),
    tracks: createdTracks(before),
    revision: revision(),
  };
}
```

- [ ] **Step 2: 菜单动作与打开页面**

```ts
// src/composables/useAiClipActions.ts
import { convertVoice } from "@/core/aiActions";
import { useVoiceChangeStore } from "@/stores/voiceChange";

const voiceChange = useVoiceChangeStore();

async function changeVoice(clipIds: string[]): Promise<void> {
  if (clipIds.length === 0) return;
  const ok = await ensureFeatures([{ feature: "voice-change", label: t("ai.voiceChange") }]);
  if (!ok) return;
  if (!voiceChange.voiceId) {
    openVoiceChange(clipIds);
    toast(t("ai.voiceNoVoice"));
    return;
  }
  run(
    t("ai.voiceChange"),
    () =>
      convertVoice(
        { clipIds, voiceId: voiceChange.voiceId!, modelId: voiceChange.modelId },
        MENU_JOB,
      ),
    () => void voiceChange.cancel(),
  );
}

/** 右键入口：打开变声页并带上选中的片段。 */
function openVoiceChange(clipIds: string[]): void {
  launch.open("voice", { clipIds });
  layout.openTab("ai");
}
```

导出里加 `changeVoice, openVoiceChange`。

- [ ] **Step 3: 文案（zh / en 同步）**

```ts
// src/i18n/zh.ts
"ai.voiceChange": "AI 变声…",
"ai.voiceChangeTrack": "AI 变声",
"ai.voiceChangeRun": "开始变声",
"ai.voiceLibrary": "音色库",
"ai.voiceFromMedia": "从媒体库选…",
"ai.voiceImported": "已导入音色「{name}」",
"ai.voiceTooShort": "参考音频太短，至少需要 3 秒有声内容",
"ai.voiceNoAudio": "这段素材没有音频",
"ai.voiceNoVoice": "先选一个音色，再开始变声",
"ai.voicePickClips": "待处理片段",
"ai.voiceModel": "变声模型",
"ai.voiceEncoding": "需要先下载音色编码器",
"ai.voiceEmpty": "先在时间线选中要变声的片段",
```

```ts
// src/i18n/en.ts
"ai.voiceChange": "AI voice change…",
"ai.voiceChangeTrack": "AI voice",
"ai.voiceChangeRun": "Convert voice",
"ai.voiceLibrary": "Voice library",
"ai.voiceFromMedia": "Pick from media…",
"ai.voiceImported": "Imported voice “{name}”",
"ai.voiceTooShort": "Reference audio too short — needs at least 3 seconds of speech",
"ai.voiceNoAudio": "This asset has no audio",
"ai.voiceNoVoice": "Choose a voice before converting",
"ai.voicePickClips": "Clips to convert",
"ai.voiceModel": "Voice model",
"ai.voiceEncoding": "Voice encoder required",
"ai.voiceEmpty": "Select the clips to convert on the timeline first",
```

- [ ] **Step 4: 编译**

Run: `pnpm build`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add src/core/aiActions.ts src/composables/useAiClipActions.ts src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(voice): convertVoice 编排、菜单动作与文案"
```

---

### Task 11: 时间线菜单入口

**Files:**
- Modify: `src/stores/aiLaunch.ts`
- Modify: `src/composables/useTimelineMenus.ts`
- Modify: `src/composables/__tests__/timelineMenus.test.ts`

**Interfaces:**
- Produces: `AiLaunchPage = "video" | "image" | "image-edit" | "voice"`，`AiLaunchRequest.clipIds?: string[]`
- Produces: 菜单项 id `ai-voice-change`

- [ ] **Step 1: 写失败的测试**

```ts
it("offers voice change on clips that carry audio", () => {
  const audio = menuFor("clip", { kind: "audio" });
  expect(flattenIds(audio)).toContain("ai-voice-change");
  const video = menuFor("clip", { kind: "video" });
  expect(flattenIds(video)).toContain("ai-voice-change");
  const image = menuFor("clip", { kind: "image" });
  expect(flattenIds(image)).not.toContain("ai-voice-change");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/composables/__tests__/timelineMenus.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/stores/aiLaunch.ts
export type AiLaunchPage = "video" | "image" | "image-edit" | "voice";

export interface AiLaunchRequest {
  id: number;
  page: AiLaunchPage;
  prompt?: string;
  sourceAssetId?: string;
  imageAssetId?: string;
  /** 仅变声页：从时间线带过来的待处理片段。 */
  clipIds?: string[];
}
```

```ts
// useTimelineMenus.ts，紧跟 ai-denoise 之后
const audioIds = ids.filter((id) => {
  const target = findClipInDoc(project.doc, id);
  if (!target) return false;
  const asset = project.doc.assets.find((candidate) => candidate.id === target.assetId);
  return Boolean(asset && (asset.kind === "audio" || asset.kind === "video"));
});
if (audioIds.length > 0) {
  items.push(
    action(
      "ai-voice-change",
      t("ai.voiceChange"),
      () => ai.openVoiceChange(audioIds.length > 0 ? audioIds : [clip.id]),
      { icon: MicrophoneIcon, ai: true },
    ),
  );
}
```

> 图标沿用朗读那一项的 `MicrophoneIcon`；`findClipInDoc`、`project`、`ai` 都是本文件已有的。

- [ ] **Step 4: 跑测试**

Run: `pnpm vitest run src/composables/__tests__/timelineMenus.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/stores/aiLaunch.ts src/composables/useTimelineMenus.ts src/composables/__tests__/timelineMenus.test.ts
git commit -m "feat(voice): 时间线右键「AI 变声…」入口"
```

---

### Task 12: AI 面板「变声」页

**Files:**
- Create: `src/components/workspace/panes/ai/AiVoicePage.vue`
- Modify: `src/components/workspace/panes/AiPane.vue`
- Test: 手动验证

**Interfaces:**
- Consumes: `useVoiceChangeStore`、`listVoices` / `importVoice` / `deleteVoice`、`convertVoice`
- Produces: `<AiVoicePage :clip-ids="…" @back="…" />`

- [ ] **Step 1: 页面（完整实现）**

```vue
<script setup lang="ts">
/**
 * **AI 变声**：选音色 + 选模型，一次转换整批片段。
 *
 * 页面只收集参数；转换、进度、落位都在 `convertVoice` 与后端命令里。
 */
import { computed, onMounted, ref, watch } from "vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";
import { useLayoutStore } from "@/stores/layout";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import { useVoiceChangeStore } from "@/stores/voiceChange";
import { deleteVoice, importVoice, listVoices } from "@/core/voiceChangeApi";
import { convertVoice } from "@/core/aiActions";
import { toast } from "@/composables/useToast";
import { humanSize, missingBytes } from "@/utils/size";
import type { VoiceEntry } from "@/types/voiceChange";

const props = defineProps<{ clipIds?: string[] }>();
const emit = defineEmits<{ (e: "back"): void }>();

const i18n = useI18n();
const layout = useLayoutStore();
const models = useModelsStore();
const project = useProjectStore();
const store = useVoiceChangeStore();

const voices = ref<VoiceEntry[]>([]);
const pending = ref<string[]>(props.clipIds ?? []);
/** 「从媒体库选…」下拉的临时值，导入后清空。 */
const importAssetId = ref<string | null>(null);

const modelOptions = computed<SelectOption[]>(() =>
  models.ofFeature("voice-change").map((model) => ({
    id: model.id,
    label: model.name,
    hint: model.installed
      ? i18n.t("aiVideo.modelReady", { size: humanSize(model.approx_bytes) })
      : i18n.t("aiVideo.modelNeedsDownload", { size: humanSize(missingBytes(model)) }),
  })),
);

const model = computed(() => models.byId(store.modelId));
const modelReady = computed(() => model.value?.installed === true);
const canRun = computed(
  () => !store.running && modelReady.value && Boolean(store.voiceId) && rows.value.length > 0,
);

interface Row {
  id: string;
  name: string;
  start: number;
  duration: number;
}

const rows = computed<Row[]>(() => {
  const doc = project.doc;
  const out: Row[] = [];
  for (const id of pending.value) {
    for (const track of doc.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === id);
      if (!clip) continue;
      const asset = doc.assets.find((candidate) => candidate.id === clip.assetId);
      out.push({ id, name: asset?.name ?? id, start: clip.start, duration: clip.duration });
    }
  }
  return out.sort((a, b) => a.start - b.start);
});

const audioAssets = computed(() =>
  project.doc.assets.filter((asset) => asset.kind === "audio" || asset.kind === "video"),
);

async function refresh(): Promise<void> {
  try {
    voices.value = await listVoices();
    if (!store.voiceId && voices.value.length > 0) store.voiceId = voices.value[0].id;
  } catch (error) {
    toast(String(error), "error");
  }
}

async function importFrom(assetId: string): Promise<void> {
  const asset = project.doc.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return;
  try {
    const entry = await importVoice(asset.src, asset.name.replace(/\.[^.]+$/, ""));
    await refresh();
    store.voiceId = entry.id;
    importAssetId.value = null;
    toast(i18n.t("ai.voiceImported", { name: entry.name }));
  } catch (error) {
    toast(String(error), "error");
  }
}

async function removeVoice(entry: VoiceEntry): Promise<void> {
  try {
    await deleteVoice(entry.id);
    if (store.voiceId === entry.id) store.voiceId = null;
    await refresh();
  } catch (error) {
    toast(String(error), "error");
  }
}

async function run(): Promise<void> {
  if (!canRun.value || !store.voiceId) return;
  store.start(rows.value.length);
  try {
    await convertVoice(
      { clipIds: pending.value, voiceId: store.voiceId, modelId: store.modelId },
      { cancelled: () => false, actor: "human" },
    );
    toast(i18n.t("menu.aiDone", { name: i18n.t("ai.voiceChange") }));
  } catch (error) {
    toast(String(error), "error");
  } finally {
    store.finish();
  }
}

function removeRow(id: string): void {
  pending.value = pending.value.filter((candidate) => candidate !== id);
}

onMounted(() => {
  void models.load();
  void refresh();
});

watch(
  () => props.clipIds,
  (ids) => {
    if (ids) pending.value = ids;
  },
);
</script>

<template>
  <div class="voice-page">
    <header class="head">
      <button class="back" @click="emit('back')">←</button>
      <div class="head-text">
        <h1 class="title">{{ i18n.t("ai.voiceChange") }}</h1>
        <p class="sub">
          {{ i18n.t("ai.voicePickClips") }} · {{ rows.length }}
        </p>
      </div>
      <span v-if="store.running" class="badge">{{ store.index }}/{{ store.total }}</span>
    </header>

    <section class="block">
      <h2>{{ i18n.t("ai.voiceLibrary") }}</h2>
      <ul class="voices">
        <li v-for="voice in voices" :key="voice.id" class="voice-row">
          <button
            class="voice"
            :class="{ on: store.voiceId === voice.id }"
            @click="store.voiceId = voice.id"
          >
            <span class="name">{{ voice.name }}</span>
            <span class="meta">{{ voice.duration.toFixed(1) }}s</span>
          </button>
          <button class="x" @click="removeVoice(voice)">×</button>
        </li>
      </ul>
      <Md3Select
        v-model="importAssetId"
        :options="audioAssets.map((asset) => ({ id: asset.id, label: asset.name }))"
        :label="i18n.t('ai.voiceFromMedia')"
        @update:model-value="importFrom"
      />
    </section>

    <section class="block">
      <h2>{{ i18n.t("ai.voiceModel") }}</h2>
      <Md3Select v-model="store.modelId" :options="modelOptions" :label="i18n.t('ai.voiceModel')" />
      <p v-if="!modelReady" class="warn">{{ i18n.t("ai.voiceEncoding") }}</p>
    </section>

    <section class="block">
      <h2>{{ i18n.t("ai.voicePickClips") }}</h2>
      <ul class="clips">
        <li v-for="row in rows" :key="row.id" class="clip-row">
          <span class="name">{{ row.name }}</span>
          <span class="meta">{{ row.start.toFixed(2) }}s · {{ row.duration.toFixed(2) }}s</span>
          <button class="x" @click="removeRow(row.id)">×</button>
        </li>
      </ul>
      <p v-if="rows.length === 0" class="warn">{{ i18n.t("ai.voiceEmpty") }}</p>
    </section>

    <footer class="dock">
      <progress :value="store.progress" max="1" />
      <button class="run" :disabled="!canRun" @click="run">
        {{ i18n.t("ai.voiceChangeRun") }}
      </button>
    </footer>
  </div>
</template>
```


- [ ] **Step 2: 接到 AiPane**

```ts
// AiPane.vue
const aiPage = ref<null | "video" | "image" | "image-edit" | "voice">(null);
const voiceLaunch = computed(() =>
  launchRequest.value?.page === "voice" ? launchRequest.value : null,
);
function openVoice(): void {
  aiPage.value = "voice";
}
```

```ts
// handleLaunch 里补一行
else if (request.page === "voice") openVoice();
```

```vue
<AiVoicePage
  v-else-if="aiPage === 'voice'"
  :key="`voice-${launchRequest?.id ?? 0}`"
  :clip-ids="voiceLaunch?.clipIds ?? []"
  @back="closeGenPage"
/>
```

- [ ] **Step 3: 手动验证**

Run: `pnpm build && pnpm tauri dev`
检查：右键出现「AI 变声…」→ 页面带片段 → 选音色 → 开始 → HUD 进度 → 完成后新轨 + 原片段静音。

- [ ] **Step 4: 提交**

```bash
git add src/components/workspace/panes/ai/AiVoicePage.vue src/components/workspace/panes/AiPane.vue
git commit -m "feat(voice): AI 面板变声页"
```

---

### Task 13: 魔搭镜像与文档（P1）

**Files:**
- Create: `docs/voice-models.md`
- Modify: `src-tauri/src/models.rs`（补 cn 源）

- [ ] **Step 1: 导出并上传**

```bash
git clone --depth 1 https://github.com/kiarina/meanvc2_onnx.git
cd meanvc2_onnx/tool && uv sync
uv run python export_onnx.py --int8
uv run python export_speaker.py
```

把 `build/onnx/` 下的 `fbank.onnx`、`asr.int8.onnx`、`gtm.onnx`、`dit.int8.onnx`、
`vocos.int8.onnx`、`speaker/speaker.int8.onnx` 上传到
`yuqingteck/mommy-story-on-device-models` 的 `voice/meanvc2/`，文件名与 `models.rs` 一致
（speaker 放 `voice/meanvc2/speaker/speaker.int8.onnx`）。

- [ ] **Step 2: 校验并补 cn 源**

```bash
shasum -a 256 build/onnx/*.onnx build/onnx/speaker/*.onnx
```

与 `models.rs` 里的 sha256 对比，一致后给每个 `ModelFile.sources` 追加：

```rust
verified(
    "modelscope",
    "cn",
    "https://modelscope.cn/models/yuqingteck/mommy-story-on-device-models/resolve/master/voice/meanvc2/fbank.onnx",
    "ecbe193170abe98a8c0ba9299e8fe21b418145aca924e351c667b9257c3e28c8",
    908_339,
),
```

- [ ] **Step 3: 写文档**

```markdown
# 变声模型

- 转换图：`meanvc2-int8`（Apache-2.0，约 74 MB）
- 音色编码器：`meanvc2-speaker`（CC-BY-SA-3.0，387 MB，仅导入新音色时需要）
- 来源：HF `kiarina/MeanVC2-ONNX`；国内镜像
  `yuqingteck/mommy-story-on-device-models/voice/meanvc2`
- 升级 ONNX 图时同步更新 `models.rs` 的 sha256 与 revision，否则旧安装不会重新下载。
```

- [ ] **Step 4: 提交**

```bash
git add docs/voice-models.md src-tauri/src/models.rs
git commit -m "docs(voice): 变声模型来源与魔搭镜像"
```

---

## 自检

**Spec 覆盖**

| 设计章节 | 任务 |
| --- | --- |
| 批量转换、进度、取消 | Task 7、8、10 |
| 原片段静音 + 新轨 | Task 9 |
| 参考音频自动截取 | Task 2 |
| 全局音色库 | Task 3、7 |
| 模型按需下载（>10 MB） | Task 4、13 |
| AI 面板「变声」页 | Task 12 |
| 菜单入口 | Task 11 |
| 16k → 48k | Task 7 |
| 说话人向量缓存 | Task 3、6、7 |

**类型一致性**

- `VcClip { clipId, path, start, duration }` ↔ 前端 `VcClipRequest`（camelCase）。
- `voice_change_voice_import` 参数 `assetPath / name / start / duration / speakerModelId`
  ↔ `importVoice(...)` 一致。
- `VoiceEntry` 前后端同名字段：`id / name / createdAt / duration / source`。
- `placeConvertedVoice` 在 Task 9 测试与 Task 10 的调用参数顺序一致。
- `useVoiceChangeStore` 暴露的 `voiceId / modelId` 被 Task 10、12 以同名使用。

**风险**

- Task 6 的 `step` / `vc_step` / `decode_mel` 是唯一需要逐行对照
  `kiarina/meanvc2_onnx/tool/onnx_stream.py` 的地方；其中动态键名（`k_cache0` 等）
  若 `ort::inputs!` 不支持运行时键，改成四层显式字面量，不要 `Box::leak`。
- Task 7 的 `crate::media::probe_duration` 需按实际导出名调整（`audio_ai` 内有同名私有
  函数可参考）。
- Task 12 的样式类名（`.voice-page` 等）按现有页面的 scoped CSS 补齐，不影响逻辑。

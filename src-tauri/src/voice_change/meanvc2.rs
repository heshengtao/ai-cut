//! MeanVC2（18M，16 kHz）：五张转换图 + 上游流式宿主循环。
//!
//! 图与宿主分工（对照 `kiarina/meanvc2_onnx/tool/onnx_stream.py`）：
//! `fbank`（400 采样帧 → 80 维 log-mel）、`asr`（Fast-U2++ 滑窗 → BNF）、
//! `gtm`（256 维说话人向量 → 音色记忆 k/v）、`dit`（mean-flow 单步去噪）、
//! `vocos`（80 维 mel → 波形）。
//!
//! 音色编码器（`speaker`，WavLM+ECAPA → 256 维向量）单独成条、单独加载：
//! 只有「导入新音色」才需要它，转换已有音色时 387 MB 的编码器不参与推理。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use crate::audio_ai::{build_session, Progress};

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

const HIDDEN: usize = 256;
const MEL: usize = 80;

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

/// xorshift 风格的确定性随机源：同一片段重复跑必须逐样本一致。
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed ^ 0x9e37_79b9_7f4a_7c15)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Box–Muller，标准正态。
    pub fn normal(&mut self) -> f32 {
        let u1 = ((self.next_u64() >> 11) as f64 / (1u64 << 53) as f64).max(1e-12);
        let u2 = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64;
        let value = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
        value as f32
    }
}

pub struct Model {
    fbank: Session,
    asr: Session,
    gtm: Session,
    dit: Session,
    vocos: Session,
    steps: usize,
}

/// 音色编码器：只负责把参考音频压成 256 维说话人向量。
///
/// 和转换图分开加载，是因为它单独占 387 MB，且只在导入新音色时用一次。
pub struct Speaker {
    session: Session,
}

#[derive(Default)]
struct State {
    samples: Vec<f32>,
    frames: Option<Vec<f32>>,
    bn_cache: Option<Vec<f32>>,
    asr_offset: i64,
    att: Vec<f32>,
    cnn: Vec<f32>,
    /// 4 层 × (k, v)，每块 [1,2,L,64]。
    kv: Vec<Vec<f32>>,
    vc_offset: i64,
    bn: Vec<f32>,
    noise: Option<Vec<f32>>,
    voc_mel: Option<Vec<f32>>,
    last_wav: Option<Vec<f32>>,
}

fn scalar_i64(value: i64) -> Result<Tensor<i64>, String> {
    Tensor::from_array(([0usize; 0], vec![value])).map_err(|e| format!("构造标量失败：{e}"))
}

fn tensor_f32<const N: usize>(
    shape: [usize; N],
    data: Vec<f32>,
) -> Result<Tensor<f32>, String> {
    Tensor::from_array((shape, data)).map_err(|e| format!("构造张量失败：{e}"))
}

impl Model {
    /// `dir` 里需有 fbank / asr.int8 / gtm / dit.int8 / vocos.int8 五张转换图。
    pub fn load(dir: &Path, steps: usize) -> Result<Self, String> {
        let file = |name: &str| dir.join(name);
        Ok(Self {
            fbank: build_session(&file("fbank.onnx"), "MeanVC2 fbank")?,
            asr: build_session(&file("asr.int8.onnx"), "MeanVC2 asr")?,
            gtm: build_session(&file("gtm.onnx"), "MeanVC2 gtm")?,
            dit: build_session(&file("dit.int8.onnx"), "MeanVC2 dit")?,
            vocos: build_session(&file("vocos.int8.onnx"), "MeanVC2 vocos")?,
            steps: steps.clamp(1, 3),
        })
    }

    /// 整段转换：逐 160 ms 块推进，输出同长度 16 kHz 单声道。
    pub fn convert(
        &mut self,
        samples: &[f32],
        spk: &[f32],
        seed: u64,
        progress: Progress,
    ) -> Result<Vec<f32>, String> {
        if spk.len() != HIDDEN {
            return Err(format!("说话人向量应为 {HIDDEN} 维，实际 {}", spk.len()));
        }
        let (k_mem, v_mem) = {
            let gtm = self
                .gtm
                .run(ort::inputs!["spks" => tensor_f32([1, HIDDEN], spk.to_vec())?])
                .map_err(|e| format!("音色记忆失败：{e}"))?;
            let (_, k) = gtm["k_mem"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let (_, v) = gtm["v_mem"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            (k.to_vec(), v.to_vec())
        };

        let mut state = State {
            asr_offset: ASR_OFFSET_INIT,
            att: vec![0.0; 6 * 4 * REQUIRED_CACHE * 128],
            cnn: vec![0.0; 6 * 1 * 256 * 8],
            kv: vec![Vec::new(); 8],
            ..State::default()
        };
        let mut rng = SplitMix64::new(seed);
        let mut out = Vec::with_capacity(samples.len() + CHUNK);
        let total = samples.len().max(1);
        for (start, _) in chunk_plan(samples.len()) {
            let mut block = vec![0.0f32; CHUNK];
            let end = (start + CHUNK).min(samples.len());
            if start < end {
                block[..end - start].copy_from_slice(&samples[start..end]);
            }
            out.extend_from_slice(&self.step(&mut state, &block, spk, &k_mem, &v_mem, &mut rng)?);
            if !progress((end as f32 / total as f32).clamp(0.0, 1.0)) {
                return Err("已取消".into());
            }
        }
        out.truncate(samples.len());
        Ok(out)
    }

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
        let mut padded = std::mem::take(&mut st.samples);
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
        let mut fb = {
            let fb_out = self
                .fbank
                .run(ort::inputs!["frames" => tensor_f32([frames, 400], buf)?])
                .map_err(|e| format!("fbank 失败：{e}"))?;
            let (_, out) = fb_out["fbank"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            out.to_vec()
        };
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
        let mut att = std::mem::take(&mut st.att);
        let mut cnn = std::mem::take(&mut st.cnn);
        while i + BN_WINDOW <= fb.len() / MEL {
            let window = fb[i * MEL..(i + BN_WINDOW) * MEL].to_vec();
            let outputs = self
                .asr
                .run(ort::inputs![
                    "xs" => tensor_f32([1, BN_WINDOW, MEL], window)?,
                    "offset" => scalar_i64(st.asr_offset)?,
                    "required_cache_size" => scalar_i64(REQUIRED_CACHE as i64)?,
                    "att_cache" => tensor_f32([6, 4, REQUIRED_CACHE, 128], att)?,
                    "cnn_cache" => tensor_f32([6, 1, 256, 8], cnn)?,
                ])
                .map_err(|e| format!("ASR 失败：{e}"))?;
            let (_, bn) = outputs["bn"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            bns.extend_from_slice(bn);
            let (_, next_att) = outputs["new_att_cache"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let (_, next_cnn) = outputs["new_cnn_cache"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            att = next_att.to_vec();
            cnn = next_cnn.to_vec();
            st.asr_offset += ASR_OFFSET_STEP;
            i += BN_STRIDE;
        }
        st.att = att;
        st.cnn = cnn;
        st.frames = Some(fb[i * MEL..].to_vec());
        if bns.is_empty() {
            return Ok(Vec::new());
        }

        // 3) BNF 插值到 17 帧、丢首帧；缓存上一块最后一帧。
        if let Some(cache) = st.bn_cache.take() {
            let mut merged = cache;
            merged.extend_from_slice(&bns);
            bns = merged;
        }
        let rows = bns.len() / HIDDEN;
        st.bn_cache = Some(bns[(rows - 1) * HIDDEN..].to_vec());
        if rows < 2 {
            return Ok(Vec::new());
        }
        let interp = interp_align_corners(&bns, rows, HIDDEN, 17);
        let mut cond = std::mem::take(&mut st.bn);
        cond.extend_from_slice(&interp[HIDDEN..]);

        // 4) 每凑够 16 帧跑一次 DiT + Vocos。
        let mut wav: Vec<f32> = Vec::new();
        let mut guard = 0;
        while cond.len() / HIDDEN >= DIT_CHUNK + BLOCK {
            guard += 1;
            if guard > 4 {
                break;
            }
            let mel = self.vc_step(
                st,
                &cond[..(DIT_CHUNK + BLOCK) * HIDDEN],
                spk,
                k_mem,
                v_mem,
                rng,
            )?;
            cond.drain(..DIT_CHUNK * HIDDEN);
            wav.extend_from_slice(&self.decode_mel(st, &mel)?);
        }
        st.bn = cond;
        Ok(wav)
    }

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
        let mut x: Vec<f32> = (0..frames * MEL).map(|_| rng.normal()).collect();
        if let Some(prev) = st.noise.take() {
            x[..BLOCK * MEL].copy_from_slice(&prev);
        }
        st.noise = Some(x[(frames - BLOCK) * MEL..].to_vec());
        if st.vc_offset >= 4000 {
            st.vc_offset = 0;
            st.kv = vec![Vec::new(); 8];
        }

        let mut kv = std::mem::take(&mut st.kv);
        let mut mel: Option<Vec<f32>> = None;
        for step in 0..self.steps {
            let t_val = 1.0 - step as f32 * dt;
            let r_val = (t_val - dt).max(0.0);
            let len = kv[0].len() / 128;
            let outputs = self
                .dit
                .run(ort::inputs![
                    "x" => tensor_f32([1, frames, MEL], x.clone())?,
                    "t" => tensor_f32([1], vec![t_val])?,
                    "r" => tensor_f32([1], vec![r_val])?,
                    "cond" => tensor_f32([1, frames, HIDDEN], cond.to_vec())?,
                    "spks" => tensor_f32([1, HIDDEN], spk.to_vec())?,
                    "k_mem" => tensor_f32([1, 32, HIDDEN], k_mem.to_vec())?,
                    "v_mem" => tensor_f32([1, 32, HIDDEN], v_mem.to_vec())?,
                    "offset" => scalar_i64(st.vc_offset)?,
                    "k_cache0" => tensor_f32([1, 2, len, 64], kv[0].clone())?,
                    "v_cache0" => tensor_f32([1, 2, len, 64], kv[1].clone())?,
                    "k_cache1" => tensor_f32([1, 2, len, 64], kv[2].clone())?,
                    "v_cache1" => tensor_f32([1, 2, len, 64], kv[3].clone())?,
                    "k_cache2" => tensor_f32([1, 2, len, 64], kv[4].clone())?,
                    "v_cache2" => tensor_f32([1, 2, len, 64], kv[5].clone())?,
                    "k_cache3" => tensor_f32([1, 2, len, 64], kv[6].clone())?,
                    "v_cache3" => tensor_f32([1, 2, len, 64], kv[7].clone())?,
                ])
                .map_err(|e| format!("DiT 失败：{e}"))?;
            let (_, u) = outputs["u"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            for (value, delta) in x.iter_mut().zip(u.iter()) {
                *value -= dt * delta;
            }
            if step == self.steps - 1 {
                for layer in 0..4 {
                    let k_name = format!("new_k_cache{layer}");
                    let v_name = format!("new_v_cache{layer}");
                    let (_, k) = outputs[k_name.as_str()]
                        .try_extract_tensor::<f32>()
                        .map_err(|e| e.to_string())?;
                    let (_, v) = outputs[v_name.as_str()]
                        .try_extract_tensor::<f32>()
                        .map_err(|e| e.to_string())?;
                    kv[layer * 2] = k.to_vec();
                    kv[layer * 2 + 1] = v.to_vec();
                }
                mel = Some(x[..DIT_CHUNK * MEL].to_vec());
            }
        }
        st.kv = kv;
        st.vc_offset += DIT_CHUNK as i64;
        mel.ok_or_else(|| "DiT 没有输出".to_string())
    }

    fn decode_mel(&mut self, st: &mut State, mel: &[f32]) -> Result<Vec<f32>, String> {
        let mut frames = mel.to_vec();
        if let Some(cache) = st.voc_mel.take() {
            let mut merged = cache;
            merged.extend_from_slice(&frames);
            frames = merged;
        }
        let total = frames.len() / MEL;
        st.voc_mel = Some(frames[(total - VOCODER_OVERLAP) * MEL..].to_vec());
        for value in frames.iter_mut() {
            *value = (*value + 1.0) / 2.0;
        }
        let outputs = self
            .vocos
            .run(ort::inputs!["mel" => tensor_f32([1, MEL, total], frames)?])
            .map_err(|e| format!("Vocos 失败：{e}"))?;
        let (_, wav) = outputs["wav"]
            .try_extract_tensor::<f32>()
            .map_err(|e| e.to_string())?;
        let wav = wav.to_vec();
        let out = if let Some(last) = st.last_wav.take() {
            let mut merged = Vec::with_capacity(wav.len());
            for i in 0..WAV_OVERLAP {
                let down = 1.0 - i as f32 / WAV_OVERLAP as f32;
                let up = i as f32 / WAV_OVERLAP as f32;
                merged.push(last[i] * down + wav[i] * up);
            }
            merged.extend_from_slice(&wav[WAV_OVERLAP..wav.len() - WAV_OVERLAP]);
            merged
        } else {
            wav[..wav.len() - WAV_OVERLAP].to_vec()
        };
        st.last_wav = Some(out[out.len() - WAV_OVERLAP..].to_vec());
        Ok(out)
    }
}

impl Speaker {
    /// 音色编码器只需要 `speaker.int8.onnx` 一个文件。
    pub fn load(path: &Path) -> Result<Self, String> {
        Ok(Self {
            session: build_session(path, "MeanVC2 speaker")?,
        })
    }

    pub fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>, String> {
        let input = tensor_f32([1, samples.len()], samples.to_vec())?;
        let outputs = self
            .session
            .run(ort::inputs!["wav" => input])
            .map_err(|e| format!("音色编码失败：{e}"))?;
        let (_, values) = outputs["embedding"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("音色向量读取失败：{e}"))?;
        Ok(values.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolation_matches_align_corners() {
        assert_eq!(
            interp_align_corners(&[0.0, 10.0], 2, 1, 3),
            vec![0.0, 5.0, 10.0]
        );
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

    #[test]
    fn conversion_is_deterministic_when_weights_exist() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.models/meanvc2");
        if !dir.join("dit.int8.onnx").is_file() {
            eprintln!("跳过：未安装 MeanVC2 权重（{}）", dir.display());
            return;
        }
        let mut model = Model::load(&dir, 2).expect("加载模型");
        let speech = vec![0.0f32; SR * 2];
        let spk = vec![0.0f32; HIDDEN];
        let a = model.convert(&speech, &spk, 7, &|_| true).expect("第一次");
        let b = model.convert(&speech, &spk, 7, &|_| true).expect("第二次");
        assert_eq!(a.len(), b.len());
        assert!(a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-6));
    }
}

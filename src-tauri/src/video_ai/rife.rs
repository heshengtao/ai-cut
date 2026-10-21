//! RIFE v4.7：两帧 + 时间步 → 中间帧。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use super::frames::{self, Frame};

const INPUT0: &str = "img0";
const INPUT1: &str = "img1";
const TIMESTEP: &str = "timestep";
const OUTPUT: &str = "output";

pub fn load(path: &Path) -> Result<Session, String> {
    super::build_session(path, "RIFE")
}

pub fn timesteps(factor: u32) -> Vec<f32> {
    (1..factor)
        .map(|step| step as f32 / factor as f32)
        .collect()
}

pub fn infer(
    session: &mut Session,
    previous: &Frame,
    current: &Frame,
    timestep: f32,
) -> Result<Frame, String> {
    let width = previous.width;
    let height = previous.height;
    if current.width != width || current.height != height {
        return Err("RIFE 两帧尺寸不一致".into());
    }

    let first = Tensor::from_array((
        [1usize, 3, height, width],
        frames::to_rgb_chw(previous, true),
    ))
    .map_err(|e| format!("RIFE 输入构建失败：{e}"))?;
    let second = Tensor::from_array((
        [1usize, 3, height, width],
        frames::to_rgb_chw(current, true),
    ))
    .map_err(|e| format!("RIFE 输入构建失败：{e}"))?;
    let time = Tensor::from_array(([1usize], vec![timestep]))
        .map_err(|e| format!("RIFE 时间步构建失败：{e}"))?;

    let outputs = session
        .run(ort::inputs![INPUT0 => first, INPUT1 => second, TIMESTEP => time])
        .map_err(|e| format!("RIFE 推理失败：{e}"))?;
    let (_, data) = outputs[OUTPUT]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("RIFE 输出读取失败：{e}"))?;
    Ok(frames::from_rgb_chw(data, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timesteps_split_the_interval() {
        assert_eq!(timesteps(2), vec![0.5]);
        assert_eq!(timesteps(3), vec![1.0 / 3.0, 2.0 / 3.0]);
        assert_eq!(timesteps(4), vec![0.25, 0.5, 0.75]);
    }
}

//! Real-ESRGAN 4x 超分；按块推理，避免 4K 帧一次性展开成巨大的浮点张量。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use super::frames::{self, Frame};

const INPUT: &str = "input";
const OUTPUT: &str = "output";
const TILE: usize = 256;
const OVERLAP: usize = 16;

pub fn load(path: &Path) -> Result<Session, String> {
    super::build_session(path, "Real-ESRGAN")
}

pub fn upscale_frame(session: &mut Session, frame: &Frame, scale: u32) -> Result<Frame, String> {
    let full = upscale_x4(session, frame)?;
    match scale {
        4 => Ok(full),
        2 => Ok(frames::downscale2(&full)),
        _ => Err("超分倍数只支持 2 或 4".into()),
    }
}

fn upscale_x4(session: &mut Session, frame: &Frame) -> Result<Frame, String> {
    let out_width = frame.width * 4;
    let out_height = frame.height * 4;
    let mut rgb = vec![0u8; out_width * out_height * 3];

    for tile_y in (0..frame.height).step_by(TILE) {
        let tile_y1 = (tile_y + TILE).min(frame.height);
        for tile_x in (0..frame.width).step_by(TILE) {
            let tile_x1 = (tile_x + TILE).min(frame.width);

            let source_x0 = tile_x.saturating_sub(OVERLAP);
            let source_y0 = tile_y.saturating_sub(OVERLAP);
            let source_x1 = (tile_x1 + OVERLAP).min(frame.width);
            let source_y1 = (tile_y1 + OVERLAP).min(frame.height);
            let tile = frames::crop(
                frame,
                source_x0,
                source_y0,
                source_x1 - source_x0,
                source_y1 - source_y0,
            );

            let input = Tensor::from_array((
                [1usize, 3, tile.height, tile.width],
                frames::to_rgb_chw(&tile, true),
            ))
            .map_err(|e| format!("超分输入构建失败：{e}"))?;
            let outputs = session
                .run(ort::inputs![INPUT => input])
                .map_err(|e| format!("超分推理失败：{e}"))?;
            let (_, data) = outputs[OUTPUT]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("超分输出读取失败：{e}"))?;

            let tile_out_width = tile.width * 4;
            let tile_out_height = tile.height * 4;
            let tile_out = frames::from_rgb_chw(data, tile_out_width, tile_out_height);

            let copy_width = (tile_x1 - tile_x) * 4;
            let output_x = tile_x * 4;
            let tile_x_offset = (tile_x - source_x0) * 4;
            for row in 0..tile_y1 - tile_y {
                for dy in 0..4 {
                    let source_row = (tile_y - source_y0 + row) * 4 + dy;
                    let source_start = (source_row * tile_out_width + tile_x_offset) * 3;
                    let target_row = (tile_y + row) * 4 + dy;
                    let target_start = (target_row * out_width + output_x) * 3;
                    rgb[target_start..target_start + copy_width * 3].copy_from_slice(
                        &tile_out.rgb[source_start..source_start + copy_width * 3],
                    );
                }
            }
        }
    }

    Ok(Frame {
        width: out_width,
        height: out_height,
        rgb,
    })
}

//! 视频 AI 的逐帧图像工具：RGB 缓冲、张量转换、缩放、裁剪与填充。

#[derive(Debug, Clone)]
pub struct Frame {
    pub width: usize,
    pub height: usize,
    pub rgb: Vec<u8>,
}

/// 输出宽高必须是偶数（H.264 + yuv420p）。
pub fn even(value: u32) -> u32 {
    let value = value.max(2);
    if value % 2 == 0 {
        value
    } else {
        value + 1
    }
}

pub fn resize_bilinear(src: &Frame, width: usize, height: usize) -> Frame {
    let width = width.max(1);
    let height = height.max(1);
    if src.width == width && src.height == height {
        return src.clone();
    }

    let mut x0s = vec![0usize; width];
    let mut x1s = vec![0usize; width];
    let mut xfs = vec![0f32; width];
    for (x, (x0, (x1, fx))) in x0s
        .iter_mut()
        .zip(x1s.iter_mut().zip(xfs.iter_mut()))
        .enumerate()
    {
        let sx = ((x as f32 + 0.5) * src.width as f32 / width as f32 - 0.5)
            .clamp(0.0, (src.width - 1) as f32);
        let base = sx.floor() as usize;
        *x0 = base;
        *x1 = (base + 1).min(src.width - 1);
        *fx = sx - base as f32;
    }

    let mut tmp = vec![0f32; width * src.height * 3];
    for y in 0..src.height {
        let source_row = y * src.width * 3;
        let target_row = y * width * 3;
        for x in 0..width {
            let a = source_row + x0s[x] * 3;
            let b = source_row + x1s[x] * 3;
            let fx = xfs[x];
            for c in 0..3 {
                tmp[target_row + x * 3 + c] =
                    src.rgb[a + c] as f32 * (1.0 - fx) + src.rgb[b + c] as f32 * fx;
            }
        }
    }

    let mut y0s = vec![0usize; height];
    let mut y1s = vec![0usize; height];
    let mut yfs = vec![0f32; height];
    for (y, (y0, (y1, fy))) in y0s
        .iter_mut()
        .zip(y1s.iter_mut().zip(yfs.iter_mut()))
        .enumerate()
    {
        let sy = ((y as f32 + 0.5) * src.height as f32 / height as f32 - 0.5)
            .clamp(0.0, (src.height - 1) as f32);
        let base = sy.floor() as usize;
        *y0 = base;
        *y1 = (base + 1).min(src.height - 1);
        *fy = sy - base as f32;
    }

    let mut rgb = vec![0u8; width * height * 3];
    for y in 0..height {
        let a = y0s[y] * width * 3;
        let b = y1s[y] * width * 3;
        let fy = yfs[y];
        let target = y * width * 3;
        for i in 0..width * 3 {
            rgb[target + i] = (tmp[a + i] * (1.0 - fy) + tmp[b + i] * fy)
                .round()
                .clamp(0.0, 255.0) as u8;
        }
    }

    Frame { width, height, rgb }
}

/// 等比缩放后居中填边，返回 `(帧, 缩放比, 左填充, 上填充)`。
pub fn resize_letterbox(src: &Frame, size: usize, pad: u8) -> (Frame, f32, usize, usize) {
    let ratio = (size as f32 / src.width as f32).min(size as f32 / src.height as f32);
    let resized_w = ((src.width as f32 * ratio).round() as usize).clamp(1, size);
    let resized_h = ((src.height as f32 * ratio).round() as usize).clamp(1, size);
    let resized = resize_bilinear(src, resized_w, resized_h);

    let pad_x = (size - resized_w) / 2;
    let pad_y = (size - resized_h) / 2;
    let mut rgb = vec![pad; size * size * 3];
    for y in 0..resized_h {
        let source = y * resized_w * 3;
        let target = ((pad_y + y) * size + pad_x) * 3;
        rgb[target..target + resized_w * 3]
            .copy_from_slice(&resized.rgb[source..source + resized_w * 3]);
    }

    (
        Frame {
            width: size,
            height: size,
            rgb,
        },
        ratio,
        pad_x,
        pad_y,
    )
}

pub fn crop(src: &Frame, x: usize, y: usize, width: usize, height: usize) -> Frame {
    let x = x.min(src.width.saturating_sub(1));
    let y = y.min(src.height.saturating_sub(1));
    let width = width.max(1).min(src.width - x);
    let height = height.max(1).min(src.height - y);
    let mut rgb = Vec::with_capacity(width * height * 3);
    for row in y..y + height {
        let start = (row * src.width + x) * 3;
        rgb.extend_from_slice(&src.rgb[start..start + width * 3]);
    }
    Frame { width, height, rgb }
}

/// 边缘复制填充到 `multiple` 的整数倍；RIFE 的内部下采样要求 32 的倍数。
pub fn pad_to_multiple(src: &Frame, multiple: usize) -> Frame {
    let multiple = multiple.max(1);
    let width = (src.width + multiple - 1) / multiple * multiple;
    let height = (src.height + multiple - 1) / multiple * multiple;
    if width == src.width && height == src.height {
        return src.clone();
    }

    let mut rgb = vec![0u8; width * height * 3];
    for y in 0..height {
        let source_y = y.min(src.height - 1);
        for x in 0..width {
            let source_x = x.min(src.width - 1);
            let source = (source_y * src.width + source_x) * 3;
            let target = (y * width + x) * 3;
            rgb[target..target + 3].copy_from_slice(&src.rgb[source..source + 3]);
        }
    }
    Frame { width, height, rgb }
}

pub fn downscale2(src: &Frame) -> Frame {
    let width = (src.width / 2).max(1);
    let height = (src.height / 2).max(1);
    let mut rgb = vec![0u8; width * height * 3];
    for y in 0..height {
        for x in 0..width {
            for c in 0..3 {
                let mut sum = 0u32;
                for dy in 0..2 {
                    for dx in 0..2 {
                        let sx = (x * 2 + dx).min(src.width - 1);
                        let sy = (y * 2 + dy).min(src.height - 1);
                        sum += src.rgb[(sy * src.width + sx) * 3 + c] as u32;
                    }
                }
                rgb[(y * width + x) * 3 + c] = (sum / 4) as u8;
            }
        }
    }
    Frame { width, height, rgb }
}

pub fn to_rgb_chw(frame: &Frame, normalize: bool) -> Vec<f32> {
    let pixels = frame.width * frame.height;
    let mut out = vec![0f32; pixels * 3];
    for i in 0..pixels {
        let r = frame.rgb[i * 3] as f32;
        let g = frame.rgb[i * 3 + 1] as f32;
        let b = frame.rgb[i * 3 + 2] as f32;
        if normalize {
            out[i] = r / 255.0;
            out[pixels + i] = g / 255.0;
            out[pixels * 2 + i] = b / 255.0;
        } else {
            out[i] = r;
            out[pixels + i] = g;
            out[pixels * 2 + i] = b;
        }
    }
    out
}

pub fn from_rgb_chw(data: &[f32], width: usize, height: usize) -> Frame {
    let pixels = width * height;
    let mut rgb = vec![0u8; pixels * 3];
    for i in 0..pixels {
        for c in 0..3 {
            rgb[i * 3 + c] = (data[c * pixels + i].clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
    Frame { width, height, rgb }
}

/// RGB 帧转 BGR 平面张量；`mean_std` 为 `Some` 时按 `/255 - mean) / std` 归一化。
pub fn to_bgr_chw(frame: &Frame, mean_std: Option<([f32; 3], [f32; 3])>) -> Vec<f32> {
    let pixels = frame.width * frame.height;
    let mut out = vec![0f32; pixels * 3];
    for i in 0..pixels {
        let r = frame.rgb[i * 3] as f32;
        let g = frame.rgb[i * 3 + 1] as f32;
        let b = frame.rgb[i * 3 + 2] as f32;
        if let Some((mean, std)) = mean_std {
            out[i] = (b / 255.0 - mean[0]) / std[0];
            out[pixels + i] = (g / 255.0 - mean[1]) / std[1];
            out[pixels * 2 + i] = (r / 255.0 - mean[2]) / std[2];
        } else {
            out[i] = b;
            out[pixels + i] = g;
            out[pixels * 2 + i] = r;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: usize, height: usize, value: u8) -> Frame {
        Frame {
            width,
            height,
            rgb: vec![value; width * height * 3],
        }
    }

    #[test]
    fn even_rounds_up() {
        assert_eq!(even(1), 2);
        assert_eq!(even(2), 2);
        assert_eq!(even(1081), 1082);
    }

    #[test]
    fn resize_keeps_size_and_edges() {
        let src = frame(2, 2, 200);
        let out = resize_bilinear(&src, 4, 4);
        assert_eq!((out.width, out.height), (4, 4));
        assert!(out.rgb.iter().all(|value| *value == 200));
    }

    #[test]
    fn crop_clamps_to_frame() {
        let src = frame(8, 6, 10);
        let out = crop(&src, 6, 4, 10, 10);
        assert_eq!((out.width, out.height), (2, 2));
    }

    #[test]
    fn pad_to_multiple_replicates_edges() {
        let src = frame(3, 5, 7);
        let out = pad_to_multiple(&src, 32);
        assert_eq!((out.width, out.height), (32, 32));
        assert_eq!(out.rgb[0], 7);
    }

    #[test]
    fn downscale2_averages_blocks() {
        let src = Frame {
            width: 2,
            height: 2,
            rgb: vec![0, 0, 0, 100, 100, 100, 200, 200, 200, 255, 255, 255],
        };
        let out = downscale2(&src);
        assert_eq!((out.width, out.height), (1, 1));
        assert_eq!(out.rgb[0], 138);
    }

    #[test]
    fn bgr_channel_order_is_correct() {
        let src = Frame {
            width: 1,
            height: 1,
            rgb: vec![10, 20, 30],
        };
        let bgr = to_bgr_chw(&src, None);
        assert_eq!(bgr, vec![30.0, 20.0, 10.0]);
        let rgb = to_rgb_chw(&src, false);
        assert_eq!(rgb, vec![10.0, 20.0, 30.0]);
    }

    #[test]
    fn letterbox_centers_and_pads() {
        let src = frame(100, 50, 200);
        let (out, ratio, pad_x, pad_y) = resize_letterbox(&src, 416, 114);
        assert_eq!((out.width, out.height), (416, 416));
        assert!((ratio - 4.16).abs() < 1e-4);
        assert_eq!((pad_x, pad_y), (0, 104));
        assert_eq!(out.rgb[0], 114);
    }
}

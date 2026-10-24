//! Minimal image IO for the CLI: binary PPM (P6) and raw RGBA8.
//!
//! The host works in float RGBA regardless of the on-disk format.  Raw RGBA
//! has no header, so callers must supply the size; PPM carries its own.

use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    /// RGBA, 0.0..=1.0, `width * height * 4` values.
    pub rgba: Vec<f32>,
}

impl Image {
    pub fn new(width: u32, height: u32, rgba: Vec<f32>) -> Self {
        Self {
            width,
            height,
            rgba,
        }
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn read(path: &Path, width: Option<u32>, height: Option<u32>) -> Result<Image, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
    match extension(path).as_str() {
        "ppm" | "pnm" => parse_ppm(&bytes),
        "rgba" | "raw" => {
            let width = width.ok_or_else(|| "读取 .rgba 需要 --width".to_string())?;
            let height = height.ok_or_else(|| "读取 .rgba 需要 --height".to_string())?;
            parse_rgba(&bytes, width, height)
        }
        other => Err(format!("不支持的输入格式 .{other}（支持 .ppm / .rgba）")),
    }
}

pub fn write(path: &Path, image: &Image) -> Result<(), String> {
    match extension(path).as_str() {
        "ppm" | "pnm" => fs::write(path, encode_ppm(image))
            .map_err(|error| format!("写入 {} 失败：{error}", path.display())),
        "rgba" | "raw" => fs::write(path, encode_rgba(image))
            .map_err(|error| format!("写入 {} 失败：{error}", path.display())),
        other => Err(format!("不支持的输出格式 .{other}（支持 .ppm / .rgba）")),
    }
}

pub fn parse_ppm(bytes: &[u8]) -> Result<Image, String> {
    let mut cursor = 0usize;
    let magic = next_token(bytes, &mut cursor).ok_or("PPM 缺少 magic")?;
    if magic != b"P6" {
        return Err(format!(
            "只支持二进制 PPM（P6），收到 {}",
            String::from_utf8_lossy(magic)
        ));
    }
    let width = parse_ascii(next_token(bytes, &mut cursor).ok_or("PPM 缺少宽度")?)?;
    let height = parse_ascii(next_token(bytes, &mut cursor).ok_or("PPM 缺少高度")?)?;
    let maxval = parse_ascii(next_token(bytes, &mut cursor).ok_or("PPM 缺少 maxval")?)?;
    if maxval != 255 {
        return Err(format!("只支持 8 位 PPM（maxval=255），收到 {maxval}"));
    }
    if width == 0 || height == 0 {
        return Err("PPM 尺寸必须大于 0".into());
    }

    // One whitespace byte separates the header from the raster (CRLF counts as
    // one separator).
    if cursor >= bytes.len() {
        return Err("PPM 缺少像素数据".into());
    }
    if bytes[cursor] == b'\r' && cursor + 1 < bytes.len() && bytes[cursor + 1] == b'\n' {
        cursor += 2;
    } else {
        cursor += 1;
    }

    let pixel_count = (width as usize) * (height as usize);
    let need = pixel_count * 3;
    if bytes.len() < cursor + need {
        return Err(format!(
            "PPM 像素数据不足：需要 {need}，实际 {}",
            bytes.len().saturating_sub(cursor)
        ));
    }
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for pixel in bytes[cursor..cursor + need].chunks_exact(3) {
        rgba.push(pixel[0] as f32 / 255.0);
        rgba.push(pixel[1] as f32 / 255.0);
        rgba.push(pixel[2] as f32 / 255.0);
        rgba.push(1.0);
    }
    Ok(Image::new(width, height, rgba))
}

pub fn parse_rgba(bytes: &[u8], width: u32, height: u32) -> Result<Image, String> {
    if width == 0 || height == 0 {
        return Err("RGBA 尺寸必须大于 0".into());
    }
    let expected = (width as usize) * (height as usize) * 4;
    if bytes.len() != expected {
        return Err(format!(
            "RGBA 数据大小不匹配：期望 {expected} 字节，实际 {}",
            bytes.len()
        ));
    }
    let rgba = bytes.iter().map(|value| *value as f32 / 255.0).collect();
    Ok(Image::new(width, height, rgba))
}

pub fn encode_ppm(image: &Image) -> Vec<u8> {
    let mut out = format!("P6\n{} {}\n255\n", image.width, image.height).into_bytes();
    out.reserve((image.width as usize) * (image.height as usize) * 3);
    for pixel in image.rgba.chunks_exact(4) {
        out.push(to_byte(pixel[0]));
        out.push(to_byte(pixel[1]));
        out.push(to_byte(pixel[2]));
    }
    out
}

pub fn encode_rgba(image: &Image) -> Vec<u8> {
    image.rgba.iter().map(|value| to_byte(*value)).collect()
}

fn to_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

fn next_token<'a>(bytes: &'a [u8], cursor: &mut usize) -> Option<&'a [u8]> {
    while *cursor < bytes.len() {
        let value = bytes[*cursor];
        if value == b'#' {
            while *cursor < bytes.len() && bytes[*cursor] != b'\n' {
                *cursor += 1;
            }
        } else if value.is_ascii_whitespace() {
            *cursor += 1;
        } else {
            break;
        }
    }
    if *cursor >= bytes.len() {
        return None;
    }
    let start = *cursor;
    while *cursor < bytes.len() && !bytes[*cursor].is_ascii_whitespace() {
        *cursor += 1;
    }
    Some(&bytes[start..*cursor])
}

fn parse_ascii(token: &[u8]) -> Result<u32, String> {
    std::str::from_utf8(token)
        .map_err(|_| "PPM 头部不是 ASCII".to_string())?
        .parse::<u32>()
        .map_err(|_| format!("PPM 头部数字无效：{}", String::from_utf8_lossy(token)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ppm_round_trip() {
        let image = Image::new(2, 1, vec![0.0, 0.5, 1.0, 1.0, 1.0, 0.0, 0.0, 0.5]);
        let bytes = encode_ppm(&image);
        assert!(bytes.starts_with(b"P6\n2 1\n255\n"));
        let decoded = parse_ppm(&bytes).unwrap();
        assert_eq!(decoded.width, 2);
        assert_eq!(decoded.height, 1);
        assert_eq!(decoded.rgba.len(), 8);
        assert!((decoded.rgba[1] - 0.5).abs() < 0.01);
    }

    #[test]
    fn ppm_ignores_comments() {
        let mut bytes = b"P6\n# created by test\n1 1\n255\n".to_vec();
        bytes.extend_from_slice(&[10, 20, 30]);
        let image = parse_ppm(&bytes).unwrap();
        assert_eq!(image.width, 1);
        assert!((image.rgba[0] - 10.0 / 255.0).abs() < 1e-6);
    }

    #[test]
    fn rgba_requires_exact_size() {
        assert!(parse_rgba(&[0, 0, 0], 1, 1).is_err());
        assert!(parse_rgba(&[0, 0, 0, 255], 1, 1).is_ok());
    }
}

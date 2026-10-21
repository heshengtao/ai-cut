//! YOLOX-nano 人物检测、YuNet 人脸检测，以及用于智能裁剪的轻量跟踪。

use std::path::Path;

use ort::session::Session;
use ort::value::Tensor;

use super::frames::{self, Frame};

const YOLO_SIZE: usize = 416;
const YOLO_CLASSES: usize = 80;
const PERSON_CLASS: usize = 0;

const YUNET_SIZE: usize = 640;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Detection {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub score: f32,
}

impl Detection {
    pub fn area(&self) -> f32 {
        self.width.max(0.0) * self.height.max(0.0)
    }

    pub fn center(&self) -> (f32, f32) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

pub struct Yolo {
    session: Session,
}

impl Yolo {
    pub fn load(path: &Path) -> Result<Self, String> {
        Ok(Self {
            session: super::build_session(path, "YOLOX")?,
        })
    }

    pub fn detect_people(&mut self, frame: &Frame) -> Result<Vec<Detection>, String> {
        let (letterboxed, ratio, pad_x, pad_y) = frames::resize_letterbox(frame, YOLO_SIZE, 114);
        // 官方 ONNXRuntime 导出的 YOLOX 直接吃 0..255 的 BGR，不做 mean/std。
        let input = frames::to_bgr_chw(&letterboxed, None);
        let tensor = Tensor::from_array(([1usize, 3, YOLO_SIZE, YOLO_SIZE], input))
            .map_err(|e| format!("YOLOX 输入构建失败：{e}"))?;

        let outputs = self
            .session
            .run(ort::inputs!["images" => tensor])
            .map_err(|e| format!("YOLOX 推理失败：{e}"))?;
        let (_, data) = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("YOLOX 输出读取失败：{e}"))?;
        let detections = decode_yolox(
            data,
            ratio,
            pad_x as f32,
            pad_y as f32,
            frame.width,
            frame.height,
        );
        Ok(nms(detections, 0.45))
    }
}

pub struct Yunet {
    session: Session,
}

impl Yunet {
    pub fn load(path: &Path) -> Result<Self, String> {
        Ok(Self {
            session: super::build_session(path, "YuNet")?,
        })
    }

    pub fn detect_faces(&mut self, frame: &Frame) -> Result<Vec<Detection>, String> {
        let resized = frames::resize_bilinear(frame, YUNET_SIZE, YUNET_SIZE);
        let input = frames::to_bgr_chw(&resized, None);
        let tensor = Tensor::from_array(([1usize, 3, YUNET_SIZE, YUNET_SIZE], input))
            .map_err(|e| format!("YuNet 输入构建失败：{e}"))?;

        let outputs = self
            .session
            .run(ort::inputs!["input" => tensor])
            .map_err(|e| format!("YuNet 推理失败：{e}"))?;

        let scale_x = frame.width as f32 / YUNET_SIZE as f32;
        let scale_y = frame.height as f32 / YUNET_SIZE as f32;
        let mut detections = Vec::new();

        for stride in [8usize, 16, 32] {
            let grid = YUNET_SIZE / stride;
            let cls_name = format!("cls_{stride}");
            let obj_name = format!("obj_{stride}");
            let bbox_name = format!("bbox_{stride}");
            let (_, cls) = outputs[cls_name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("YuNet cls 读取失败：{e}"))?;
            let (_, obj) = outputs[obj_name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("YuNet obj 读取失败：{e}"))?;
            let (_, bbox) = outputs[bbox_name.as_str()]
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("YuNet bbox 读取失败：{e}"))?;

            for gy in 0..grid {
                for gx in 0..grid {
                    let index = gy * grid + gx;
                    let score = (cls[index].max(0.0) * obj[index].max(0.0)).sqrt();
                    if score < 0.6 {
                        continue;
                    }
                    let base = index * 4;
                    let cx = (bbox[base] + gx as f32) * stride as f32;
                    let cy = (bbox[base + 1] + gy as f32) * stride as f32;
                    let width = bbox[base + 2].exp() * stride as f32;
                    let height = bbox[base + 3].exp() * stride as f32;
                    let x = (cx - width / 2.0) * scale_x;
                    let y = (cy - height / 2.0) * scale_y;
                    if let Some(detection) = clamped(
                        x,
                        y,
                        width * scale_x,
                        height * scale_y,
                        frame.width,
                        frame.height,
                        score,
                    ) {
                        detections.push(detection);
                    }
                }
            }
        }

        Ok(nms(detections, 0.3))
    }
}

fn decode_yolox(
    data: &[f32],
    ratio: f32,
    pad_x: f32,
    pad_y: f32,
    frame_width: usize,
    frame_height: usize,
) -> Vec<Detection> {
    let mut detections = Vec::new();
    let mut offset = 0usize;
    for (stride, grid) in [(8usize, 52usize), (16, 26), (32, 13)] {
        for gy in 0..grid {
            for gx in 0..grid {
                let base = (offset + gy * grid + gx) * (5 + YOLO_CLASSES);
                let objectness = data[base + 4];
                if objectness < 0.05 {
                    continue;
                }
                let mut best_score = 0f32;
                let mut best_class = 0usize;
                for class in 0..YOLO_CLASSES {
                    let score = data[base + 5 + class];
                    if score > best_score {
                        best_score = score;
                        best_class = class;
                    }
                }
                if best_class != PERSON_CLASS {
                    continue;
                }
                let score = objectness * best_score;
                if score < 0.30 {
                    continue;
                }

                let cx = (data[base] + gx as f32) * stride as f32;
                let cy = (data[base + 1] + gy as f32) * stride as f32;
                let width = data[base + 2].exp() * stride as f32;
                let height = data[base + 3].exp() * stride as f32;
                let x = (cx - width / 2.0 - pad_x) / ratio;
                let y = (cy - height / 2.0 - pad_y) / ratio;
                if let Some(detection) = clamped(
                    x,
                    y,
                    width / ratio,
                    height / ratio,
                    frame_width,
                    frame_height,
                    score,
                ) {
                    detections.push(detection);
                }
            }
        }
        offset += grid * grid;
    }
    detections
}

fn clamped(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    frame_width: usize,
    frame_height: usize,
    score: f32,
) -> Option<Detection> {
    if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
        return None;
    }
    let x0 = x.max(0.0);
    let y0 = y.max(0.0);
    let x1 = (x + width).min(frame_width as f32);
    let y1 = (y + height).min(frame_height as f32);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    Some(Detection {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        score,
    })
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.width).min(b.x + b.width);
    let y1 = (a.y + a.height).min(b.y + b.height);
    let intersection = (x1 - x0).max(0.0) * (y1 - y0).max(0.0);
    let union = a.area() + b.area() - intersection;
    if union <= 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn nms(mut detections: Vec<Detection>, threshold: f32) -> Vec<Detection> {
    detections.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut kept: Vec<Detection> = Vec::new();
    for detection in detections {
        if kept
            .iter()
            .all(|existing| iou(&detection, existing) <= threshold)
        {
            kept.push(detection);
        }
    }
    kept
}

pub fn largest(detections: &[Detection]) -> Option<Detection> {
    detections
        .iter()
        .copied()
        .max_by(|a, b| a.area().total_cmp(&b.area()))
}

pub struct CropTracker {
    pub cx: f32,
    pub cy: f32,
    smooth: f32,
    initialized: bool,
}

impl CropTracker {
    pub fn new(smooth: f32) -> Self {
        Self {
            cx: 0.0,
            cy: 0.0,
            smooth: smooth.clamp(0.0, 0.95),
            initialized: false,
        }
    }

    pub fn update(
        &mut self,
        target: Option<(f32, f32)>,
        frame_width: usize,
        frame_height: usize,
        crop_width: f32,
        crop_height: f32,
    ) -> (f32, f32) {
        let fallback = (frame_width as f32 / 2.0, frame_height as f32 / 2.0);
        let (target_x, target_y) = match target {
            Some((x, y)) => (x, y),
            None if self.initialized => (self.cx, self.cy),
            None => fallback,
        };
        if !self.initialized {
            self.cx = target_x;
            self.cy = target_y;
            self.initialized = true;
        } else {
            let alpha = (1.0 - self.smooth).clamp(0.05, 1.0);
            self.cx += (target_x - self.cx) * alpha;
            self.cy += (target_y - self.cy) * alpha;
        }

        let half_width = crop_width / 2.0;
        let half_height = crop_height / 2.0;
        let min_x = half_width.min(frame_width as f32 / 2.0);
        let max_x = (frame_width as f32 - half_width).max(min_x);
        let min_y = half_height.min(frame_height as f32 / 2.0);
        let max_y = (frame_height as f32 - half_height).max(min_y);
        (self.cx.clamp(min_x, max_x), self.cy.clamp(min_y, max_y))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detection(x: f32, y: f32, width: f32, height: f32, score: f32) -> Detection {
        Detection {
            x,
            y,
            width,
            height,
            score,
        }
    }

    #[test]
    fn iou_matches_overlap() {
        let a = detection(0.0, 0.0, 10.0, 10.0, 1.0);
        let b = detection(5.0, 0.0, 10.0, 10.0, 1.0);
        assert!((iou(&a, &b) - 1.0 / 3.0).abs() < 1e-5);
    }

    #[test]
    fn nms_keeps_the_highest_score() {
        let detections = vec![
            detection(0.0, 0.0, 10.0, 10.0, 0.9),
            detection(1.0, 1.0, 10.0, 10.0, 0.8),
            detection(40.0, 40.0, 10.0, 10.0, 0.7),
        ];
        let kept = nms(detections, 0.45);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].score, 0.9);
    }

    #[test]
    fn decodes_a_single_yolox_anchor() {
        let mut data = vec![0f32; 3549 * 85];
        data[0] = 0.5;
        data[1] = 0.5;
        data[4] = 1.0;
        data[5] = 1.0;
        let detections = decode_yolox(&data, 1.0, 0.0, 0.0, 416, 416);
        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].width, 8.0);
        assert_eq!(detections[0].height, 8.0);
    }

    #[test]
    fn tracker_clamps_to_frame() {
        let mut tracker = CropTracker::new(0.0);
        let (x, y) = tracker.update(Some((-100.0, -100.0)), 1920, 1080, 600.0, 1080.0);
        assert_eq!((x, y), (300.0, 540.0));
    }
}

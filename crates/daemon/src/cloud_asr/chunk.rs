//! 把语音段合并成云服务能接受的请求块。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SpeechSpan {
    pub start: f64,
    pub end: f64,
}

/// 块长上限的最小值：比 5 秒更小的设置没有意义，还会把词切碎。
const MIN_LIMIT: f32 = 5.0;

/// 把相邻语音段合并成不超过 `max_seconds` 的块，块边界落在语音段边界上。
pub fn plan_chunks(spans: &[SpeechSpan], max_seconds: f32) -> Vec<(f64, f64)> {
    let limit = max_seconds.max(MIN_LIMIT) as f64;
    let mut out: Vec<(f64, f64)> = Vec::new();
    let mut current: Option<(f64, f64)> = None;
    for span in spans {
        if span.end <= span.start {
            continue;
        }
        match current {
            None => current = Some((span.start, span.end)),
            Some((start, end)) => {
                if span.end - start > limit {
                    out.push((start, end));
                    current = Some((span.start, span.end));
                } else {
                    current = Some((start, span.end));
                }
            }
        }
    }
    if let Some(block) = current {
        out.push(block);
    }
    out
}

/// 没有 VAD 模型时的退路：定长切片。
pub fn fixed_chunks(duration: f64, max_seconds: f32) -> Vec<(f64, f64)> {
    let step = max_seconds.max(MIN_LIMIT) as f64;
    let mut out = Vec::new();
    let mut start = 0.0;
    while start < duration {
        let end = (start + step).min(duration);
        if end - start > 0.05 {
            out.push((start, end));
        }
        start = end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(start: f64, end: f64) -> SpeechSpan {
        SpeechSpan { start, end }
    }

    #[test]
    fn merges_spans_that_fit() {
        let spans = [span(0.0, 2.0), span(3.0, 6.0), span(7.0, 8.0)];
        assert_eq!(plan_chunks(&spans, 30.0), vec![(0.0, 8.0)]);
    }

    #[test]
    fn breaks_before_exceeding_the_limit() {
        let spans = [span(0.0, 10.0), span(11.0, 20.0)];
        assert_eq!(plan_chunks(&spans, 15.0), vec![(0.0, 10.0), (11.0, 20.0)]);
    }

    #[test]
    fn keeps_an_oversized_span_on_its_own() {
        let spans = [span(0.0, 40.0), span(41.0, 42.0)];
        assert_eq!(plan_chunks(&spans, 15.0), vec![(0.0, 40.0), (41.0, 42.0)]);
    }

    #[test]
    fn skips_empty_spans() {
        let spans = [span(5.0, 5.0), span(6.0, 7.0)];
        assert_eq!(plan_chunks(&spans, 30.0), vec![(6.0, 7.0)]);
    }

    #[test]
    fn fixed_chunks_covers_the_whole_duration() {
        let chunks = fixed_chunks(75.0, 30.0);
        assert_eq!(chunks, vec![(0.0, 30.0), (30.0, 60.0), (60.0, 75.0)]);
    }

    #[test]
    fn fixed_chunks_ignores_tiny_tail() {
        assert_eq!(fixed_chunks(30.02, 30.0), vec![(0.0, 30.0)]);
    }
}

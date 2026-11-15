//! 把每块结果合并成字幕与词时间。

use super::ParsedChunk;
use crate::asr::{SubtitleCue, TranscriptWord};

#[derive(Debug, Default)]
pub struct Merged {
    pub cues: Vec<SubtitleCue>,
    pub words: Vec<TranscriptWord>,
    pub timed: bool,
}

/// 单条字幕的最大字符数（与本地链路一致）。
const MAX_CUE_CHARS: usize = 26;

/// 按标点切句，超长再按字数硬切。
pub fn split_pieces(text: &str) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '。' | '！' | '？' | '!' | '?' | '；' | ';' | '…') {
            pieces.push(std::mem::take(&mut current));
        }
    }
    if !current.trim().is_empty() {
        pieces.push(current);
    }
    pieces
        .into_iter()
        .flat_map(|piece| {
            let trimmed = piece.trim().to_string();
            if trimmed.chars().count() <= MAX_CUE_CHARS {
                return vec![trimmed];
            }
            trimmed
                .chars()
                .collect::<Vec<char>>()
                .chunks(MAX_CUE_CHARS)
                .map(|chunk| chunk.iter().collect::<String>())
                .collect::<Vec<String>>()
        })
        .filter(|piece| !piece.is_empty())
        .collect()
}

/// 在 `[start, end]` 内按字数比例分配时间。
pub fn distribute(pieces: &[String], start: f64, end: f64) -> Vec<(f64, f64, String)> {
    let total: usize = pieces.iter().map(|piece| piece.chars().count()).sum();
    if total == 0 || end <= start {
        return Vec::new();
    }
    let mut cursor = start;
    let mut out = Vec::new();
    for (index, piece) in pieces.iter().enumerate() {
        let chars = piece.chars().count();
        let share = (end - start) * chars as f64 / total as f64;
        let piece_end = if index + 1 == pieces.len() {
            end
        } else {
            cursor + share
        };
        out.push((cursor, piece_end, piece.clone()));
        cursor = piece_end;
    }
    out
}

/// 把一块结果追加进合并结果：有原生句时间就用它，否则在语音区间里按字数分配。
pub fn append_chunk(merged: &mut Merged, parsed: ParsedChunk, offset: f64, span: (f64, f64)) {
    let mut push = |merged: &mut Merged, start: f64, end: f64, text: String| {
        if let Some(last) = merged.cues.last() {
            // 切在词中间时，后一块会把同一句再识别一次：同文本且紧挨着就丢掉。
            if last.text == text && start - last.end < 0.3 {
                return;
            }
        }
        merged.cues.push(SubtitleCue { start, end, text });
    };

    if parsed.sentences.is_empty() {
        let pieces = split_pieces(&parsed.text);
        for (start, end, text) in distribute(&pieces, span.0, span.1) {
            push(merged, start, end, text);
        }
    } else {
        for (start, end, text) in &parsed.sentences {
            push(merged, offset + start, offset + end, text.clone());
        }
    }

    if parsed.words.is_empty() {
        return;
    }
    merged.timed = true;
    for (text, start, end) in parsed.words {
        merged.words.push(TranscriptWord {
            text,
            start: offset + start,
            end: offset + end,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_punctuation() {
        assert_eq!(split_pieces("你好。世界！"), vec!["你好。", "世界！"]);
    }

    #[test]
    fn distributes_by_character_count() {
        let pieces = vec!["一二三".to_string(), "四五".to_string()];
        let spans = distribute(&pieces, 0.0, 5.0);
        assert_eq!(spans[0], (0.0, 3.0, "一二三".to_string()));
        assert_eq!(spans[1], (3.0, 5.0, "四五".to_string()));
    }

    #[test]
    fn native_sentences_keep_their_own_times() {
        let mut merged = Merged::default();
        let parsed = ParsedChunk {
            text: "你好".into(),
            sentences: vec![(0.5, 1.5, "你好".to_string())],
            words: vec![("你好".to_string(), 0.5, 1.5)],
        };
        append_chunk(&mut merged, parsed, 10.0, (10.0, 12.0));
        assert_eq!(merged.cues[0].start, 10.5);
        assert_eq!(merged.words[0].start, 10.5);
        assert!(merged.timed);
    }

    #[test]
    fn text_only_chunks_are_distributed_over_the_span() {
        let mut merged = Merged::default();
        let parsed = ParsedChunk {
            text: "你好。世界。".into(),
            ..Default::default()
        };
        append_chunk(&mut merged, parsed, 0.0, (0.0, 4.0));
        assert_eq!(merged.cues.len(), 2);
        assert_eq!(merged.cues[0].start, 0.0);
        assert!(!merged.timed);
    }

    #[test]
    fn drops_a_repeated_boundary_sentence() {
        let mut merged = Merged::default();
        append_chunk(
            &mut merged,
            ParsedChunk {
                text: "你好。".into(),
                ..Default::default()
            },
            0.0,
            (0.0, 1.0),
        );
        let before = merged.cues.len();
        append_chunk(
            &mut merged,
            ParsedChunk {
                text: "你好。世界。".into(),
                ..Default::default()
            },
            1.0,
            (1.0, 3.0),
        );
        assert_eq!(merged.cues.len(), before + 1, "重复的块首句没有被丢掉");
    }
}

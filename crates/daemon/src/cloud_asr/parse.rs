//! 各家响应 → 统一的文本 / 句时间 / 词时间。

use serde_json::Value;

use super::{CloudAsrKind, CloudAsrProvider};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedChunk {
    pub text: String,
    /// 句级时间（相对块起点）；空 = 该服务没有原生时间。
    pub sentences: Vec<(f64, f64, String)>,
    /// 词级时间（相对块起点）。
    pub words: Vec<(String, f64, f64)>,
}

impl ParsedChunk {
    pub fn has_time(&self) -> bool {
        !self.sentences.is_empty() || !self.words.is_empty()
    }
}

pub fn parse_body(
    kind: CloudAsrKind,
    provider: &CloudAsrProvider,
    body: &[u8],
) -> Result<ParsedChunk, String> {
    match kind {
        CloudAsrKind::Openai => parse_openai(body),
        CloudAsrKind::Deepseek => parse_deepseek(body),
        CloudAsrKind::Azure => parse_azure(body),
        CloudAsrKind::Google => parse_google(body),
        CloudAsrKind::Aliyun => parse_aliyun(body),
        CloudAsrKind::Tencent => parse_tencent(body),
        CloudAsrKind::Volcengine => parse_volcengine(body),
        CloudAsrKind::Baidu => parse_baidu(body),
        CloudAsrKind::Custom => parse_custom(provider, body),
    }
}

pub fn parse_openai(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_openai_value)
}

pub fn parse_deepseek(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_deepseek_value)
}

pub fn parse_azure(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_azure_value)
}

pub fn parse_google(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_google_value)
}

pub fn parse_aliyun(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_aliyun_value)
}

pub fn parse_tencent(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_tencent_value)
}

pub fn parse_volcengine(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_volcengine_value)
}

pub fn parse_baidu(raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, parse_baidu_value)
}

pub fn parse_custom(provider: &CloudAsrProvider, raw: &[u8]) -> Result<ParsedChunk, String> {
    parse_value(raw, |value| parse_custom_value(provider, value))
}

fn parse_value(
    raw: &[u8],
    run: impl Fn(&Value) -> Result<ParsedChunk, String>,
) -> Result<ParsedChunk, String> {
    let value: Value = serde_json::from_slice(raw)
        .map_err(|error| format!("响应不是 JSON：{error}；原文：{}", preview(raw)))?;
    run(&value)
}

fn preview(raw: &[u8]) -> String {
    String::from_utf8_lossy(&raw[..raw.len().min(200)]).to_string()
}

/// 数字按秒、字符串去掉 `s` 后缀按秒。
fn as_secs(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    let text = value.as_str()?.trim().trim_end_matches('s');
    text.parse::<f64>().ok()
}

/// 毫秒 → 秒。
fn as_ms(value: &Value) -> Option<f64> {
    value.as_f64().map(|ms| ms / 1000.0)
}

fn parse_openai_value(value: &Value) -> Result<ParsedChunk, String> {
    let mut chunk = ParsedChunk {
        text: value
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        ..Default::default()
    };
    for segment in value
        .get("segments")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (Some(start), Some(end)) = (
            segment.get("start").and_then(as_secs),
            segment.get("end").and_then(as_secs),
        ) else {
            continue;
        };
        let text = segment
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if !text.is_empty() {
            chunk.sentences.push((start, end, text));
        }
    }
    for word in value
        .get("words")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (Some(start), Some(end)) = (
            word.get("start").and_then(as_secs),
            word.get("end").and_then(as_secs),
        ) else {
            continue;
        };
        if let Some(text) = word.get("word").and_then(Value::as_str) {
            chunk.words.push((text.trim().to_string(), start, end));
        }
    }
    Ok(chunk)
}

fn parse_deepseek_value(value: &Value) -> Result<ParsedChunk, String> {
    if let Some(message) = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return Err(format!("DeepSeek 返回错误：{message}"));
    }
    Ok(ParsedChunk {
        text: value
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        ..Default::default()
    })
}

fn parse_azure_value(value: &Value) -> Result<ParsedChunk, String> {
    let mut chunk = ParsedChunk::default();
    for phrase in value
        .get("phrases")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let start = phrase
            .get("offsetMilliseconds")
            .and_then(as_ms)
            .unwrap_or(0.0);
        let duration = phrase
            .get("durationMilliseconds")
            .and_then(as_ms)
            .unwrap_or(0.0);
        let text = phrase
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if !text.is_empty() {
            chunk.sentences.push((start, start + duration, text));
        }
        for word in phrase
            .get("words")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let word_start = word.get("offsetMilliseconds").and_then(as_ms).unwrap_or(start);
            let word_duration = word
                .get("durationMilliseconds")
                .and_then(as_ms)
                .unwrap_or(0.0);
            if let Some(text) = word.get("text").and_then(Value::as_str) {
                chunk
                    .words
                    .push((text.to_string(), word_start, word_start + word_duration));
            }
        }
    }
    chunk.text = chunk
        .sentences
        .iter()
        .map(|(_, _, text)| text.as_str())
        .collect::<Vec<&str>>()
        .join(" ");
    Ok(chunk)
}

fn parse_google_value(value: &Value) -> Result<ParsedChunk, String> {
    let mut chunk = ParsedChunk::default();
    for result in value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for alternative in result
            .get("alternatives")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(1)
        {
            if let Some(text) = alternative.get("transcript").and_then(Value::as_str) {
                chunk.text.push_str(text);
            }
            for word in alternative
                .get("words")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let (Some(start), Some(end)) = (
                    word.get("startOffset").and_then(as_secs),
                    word.get("endOffset").and_then(as_secs),
                ) else {
                    continue;
                };
                if let Some(text) = word.get("word").and_then(Value::as_str) {
                    chunk.words.push((text.to_string(), start, end));
                }
            }
        }
    }
    Ok(chunk)
}

fn parse_aliyun_value(value: &Value) -> Result<ParsedChunk, String> {
    let content = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));
    let text = match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<&str>>()
            .join(""),
        _ => return Err(format!("阿里百炼响应缺少文本：{value}")),
    };
    Ok(ParsedChunk {
        text,
        ..Default::default()
    })
}

fn parse_tencent_value(value: &Value) -> Result<ParsedChunk, String> {
    if let Some(code) = value
        .get("response")
        .and_then(|response| response.get("error"))
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
    {
        if !code.is_empty() {
            return Err(format!("腾讯云返回错误：{value}"));
        }
    }
    let result = value
        .get("result")
        .ok_or_else(|| format!("腾讯云响应缺少 result：{value}"))?;
    let mut chunk = ParsedChunk {
        text: result
            .get("voice_text_str")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        ..Default::default()
    };
    for word in result
        .get("words")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let (Some(start), Some(end)) = (
            word.get("start_time").and_then(as_ms),
            word.get("end_time").and_then(as_ms),
        ) else {
            continue;
        };
        if let Some(text) = word.get("word").and_then(Value::as_str) {
            chunk.words.push((text.to_string(), start, end));
        }
    }
    Ok(chunk)
}

fn parse_volcengine_value(value: &Value) -> Result<ParsedChunk, String> {
    let result = value
        .get("result")
        .ok_or_else(|| format!("火山引擎响应缺少 result：{value}"))?;
    let mut chunk = ParsedChunk {
        text: result
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        ..Default::default()
    };
    for utterance in result
        .get("utterances")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let start = utterance
            .get("start_time")
            .and_then(as_ms)
            .unwrap_or(0.0);
        let end = utterance.get("end_time").and_then(as_ms).unwrap_or(start);
        let text = utterance
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if !text.is_empty() {
            chunk.sentences.push((start, end, text));
        }
        for word in utterance
            .get("words")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let word_start = word.get("start_time").and_then(as_ms).unwrap_or(start);
            let word_end = word.get("end_time").and_then(as_ms).unwrap_or(word_start);
            if let Some(text) = word.get("text").and_then(Value::as_str) {
                chunk.words.push((text.to_string(), word_start, word_end));
            }
        }
    }
    Ok(chunk)
}

fn parse_baidu_value(value: &Value) -> Result<ParsedChunk, String> {
    let code = value.get("err_no").and_then(Value::as_i64).unwrap_or(-1);
    if code != 0 {
        let message = value
            .get("err_msg")
            .and_then(Value::as_str)
            .unwrap_or("未知错误");
        return Err(format!("百度语音错误 {code}：{message}"));
    }
    let text = value
        .get("result")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(ParsedChunk {
        text,
        ..Default::default()
    })
}

fn parse_custom_value(provider: &CloudAsrProvider, value: &Value) -> Result<ParsedChunk, String> {
    let text = pick(value, &provider.text_path)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut chunk = ParsedChunk {
        text,
        ..Default::default()
    };
    if let Some(items) = pick(value, &provider.words_path).and_then(Value::as_array) {
        for item in items {
            let start = item.get("start").and_then(as_secs).unwrap_or(0.0);
            let end = item.get("end").and_then(as_secs).unwrap_or(start);
            let text = item
                .get("text")
                .or_else(|| item.get("word"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !text.is_empty() {
                chunk.words.push((text.to_string(), start, end));
            }
        }
    }
    Ok(chunk)
}

/// 按 `a.b.c` 取 JSON 节点；空路径返回根。
fn pick<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.').filter(|part| !part.is_empty()) {
        current = current.get(part)?;
    }
    Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn value(v: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&v).unwrap()
    }

    #[test]
    fn openai_verbose_json_gives_sentences_and_words() {
        let raw = value(json!({
            "text": "你好世界",
            "segments": [{"start": 0.0, "end": 1.5, "text": "你好"}],
            "words": [{"word": "你好", "start": 0.0, "end": 1.5}]
        }));
        let chunk = parse_openai(&raw).unwrap();
        assert_eq!(chunk.text, "你好世界");
        assert_eq!(chunk.sentences, vec![(0.0, 1.5, "你好".to_string())]);
        assert_eq!(chunk.words, vec![("你好".to_string(), 0.0, 1.5)]);
        assert!(chunk.has_time());
    }

    #[test]
    fn deepseek_returns_text_only() {
        let raw = value(json!({"request_id": "r", "text": "今天天气不错", "duration_ms": 3200}));
        let chunk = parse_deepseek(&raw).unwrap();
        assert_eq!(chunk.text, "今天天气不错");
        assert!(!chunk.has_time());
    }

    #[test]
    fn azure_phrases_use_milliseconds() {
        let raw = value(json!({
            "phrases": [{
                "offsetMilliseconds": 960,
                "durationMilliseconds": 640,
                "text": "Good afternoon.",
                "words": [{"text": "Good", "offsetMilliseconds": 960, "durationMilliseconds": 240}]
            }]
        }));
        let chunk = parse_azure(&raw).unwrap();
        assert!((chunk.sentences[0].0 - 0.96).abs() < 1e-9);
        assert!((chunk.sentences[0].1 - 1.6).abs() < 1e-9);
        assert_eq!(chunk.words[0].0, "Good");
    }

    #[test]
    fn google_offsets_are_seconds_with_suffix() {
        let raw = value(json!({
            "results": [{
                "alternatives": [{
                    "transcript": "hello",
                    "words": [{"word": "hello", "startOffset": "0.100s", "endOffset": "0.900s"}]
                }]
            }]
        }));
        let chunk = parse_google(&raw).unwrap();
        assert_eq!(chunk.text, "hello");
        assert_eq!(chunk.words[0], ("hello".to_string(), 0.1, 0.9));
    }

    #[test]
    fn aliyun_reads_openai_chat_content() {
        let raw = value(json!({
            "choices": [{"message": {"content": "这是识别结果"}}]
        }));
        let chunk = parse_aliyun(&raw).unwrap();
        assert_eq!(chunk.text, "这是识别结果");
        assert!(!chunk.has_time());
    }

    #[test]
    fn tencent_words_are_milliseconds() {
        let raw = value(json!({
            "result": {
                "voice_text_str": "你好",
                "words": [{"word": "你好", "start_time": 0, "end_time": 1200}]
            }
        }));
        let chunk = parse_tencent(&raw).unwrap();
        assert_eq!(chunk.words[0], ("你好".to_string(), 0.0, 1.2));
    }

    #[test]
    fn volcengine_utterances_carry_words() {
        let raw = value(json!({
            "result": {
                "text": "你好",
                "utterances": [{
                    "start_time": 0, "end_time": 1200, "text": "你好",
                    "words": [{"text": "你好", "start_time": 0, "end_time": 1200}]
                }]
            }
        }));
        let chunk = parse_volcengine(&raw).unwrap();
        assert_eq!(chunk.sentences, vec![(0.0, 1.2, "你好".to_string())]);
        assert_eq!(chunk.words[0].2, 1.2);
    }

    #[test]
    fn baidu_reports_error_code() {
        let raw = value(json!({"err_no": 3301, "err_msg": "speech quality error"}));
        let error = parse_baidu(&raw).unwrap_err();
        assert!(error.contains("3301"), "错误文案缺少错误码：{error}");
    }

    #[test]
    fn custom_follows_text_and_words_paths() {
        let provider = CloudAsrProvider {
            text_path: "data.transcript".into(),
            words_path: "data.items".into(),
            ..Default::default()
        };
        let raw = value(json!({
            "data": {
                "transcript": "自定义",
                "items": [{"text": "自定义", "start": 0.5, "end": 1.5}]
            }
        }));
        let chunk = parse_custom(&provider, &raw).unwrap();
        assert_eq!(chunk.text, "自定义");
        assert_eq!(chunk.words[0], ("自定义".to_string(), 0.5, 1.5));
    }
}

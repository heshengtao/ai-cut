//! 请求构造 + 鉴权。只负责「把一段音频发出去、拿回响应字节」。

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use super::{CloudAsrKind, CloudAsrProvider};

/// 一段待上传的音频：原始 WAV 字节 + 预编码的 base64 + MIME。
pub struct AudioPart<'a> {
    pub wav: &'a [u8],
    pub b64: &'a str,
    pub mime: &'a str,
}

/// 各 kind 的默认地址与拼接规则。`base_url` 留空时用官方地址。
pub fn endpoint(provider: &CloudAsrProvider) -> String {
    let base = provider.base_url.trim_end_matches('/');
    match provider.kind {
        CloudAsrKind::Deepseek => format!(
            "{}/v1/tools/asr",
            if base.is_empty() {
                "https://api.deepseek.com"
            } else {
                base
            }
        ),
        CloudAsrKind::Openai => format!(
            "{}/audio/transcriptions",
            if base.is_empty() {
                "https://api.openai.com/v1"
            } else {
                base
            }
        ),
        CloudAsrKind::Azure => {
            let region = if provider.region.is_empty() {
                "eastasia"
            } else {
                provider.region.as_str()
            };
            if base.is_empty() {
                format!("https://{region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15")
            } else {
                format!("{base}/speechtotext/transcriptions:transcribe?api-version=2025-10-15")
            }
        }
        CloudAsrKind::Google => format!(
            "{}/v2/speech:recognize?key={}",
            if base.is_empty() {
                "https://speech.googleapis.com"
            } else {
                base
            },
            provider.api_key
        ),
        CloudAsrKind::Aliyun => format!(
            "{}/compatible-mode/v1/chat/completions",
            if base.is_empty() {
                "https://dashscope.aliyuncs.com"
            } else {
                base
            }
        ),
        CloudAsrKind::Tencent => {
            format!("https://asr.cloud.tencent.com/asr/flash/v1/{}", provider.app_id)
        }
        CloudAsrKind::Volcengine => {
            if base.is_empty() {
                "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash".to_string()
            } else {
                base.to_string()
            }
        }
        CloudAsrKind::Baidu => format!(
            "{}/server_api",
            if base.is_empty() {
                "https://vop.baidu.com"
            } else {
                base
            }
        ),
        CloudAsrKind::Custom => base.to_string(),
    }
}

/// 发一个请求，返回响应字节。状态码非 2xx 时转成中文错误。
pub async fn call(
    client: &reqwest::Client,
    provider: &CloudAsrProvider,
    audio: &AudioPart<'_>,
    language: Option<&str>,
) -> Result<Vec<u8>, String> {
    let timeout = std::time::Duration::from_secs(180);
    match provider.kind {
        CloudAsrKind::Deepseek => {
            let form = reqwest::multipart::Form::new().part(
                "file",
                reqwest::multipart::Part::bytes(audio.wav.to_vec())
                    .file_name("audio.wav")
                    .mime_str("audio/wav")
                    .map_err(|error| error.to_string())?,
            );
            send(
                client
                    .post(endpoint(provider))
                    .bearer_auth(&provider.api_key)
                    .multipart(form),
                timeout,
            )
            .await
        }
        CloudAsrKind::Openai => {
            let mut form = reqwest::multipart::Form::new()
                .part(
                    "file",
                    reqwest::multipart::Part::bytes(audio.wav.to_vec())
                        .file_name("audio.wav")
                        .mime_str("audio/wav")
                        .map_err(|error| error.to_string())?,
                )
                .text("response_format", "verbose_json");
            if !provider.model.is_empty() {
                form = form.text("model", provider.model.clone());
            }
            if let Some(language) = language {
                form = form.text("language", language.to_string());
            }
            send(
                client
                    .post(endpoint(provider))
                    .bearer_auth(&provider.api_key)
                    .multipart(form),
                timeout,
            )
            .await
        }
        CloudAsrKind::Azure => {
            let definition = serde_json::json!({
                "locales": [if provider.language.is_empty() { "zh-CN".to_string() } else { provider.language.clone() }]
            });
            let form = reqwest::multipart::Form::new()
                .part(
                    "audio",
                    reqwest::multipart::Part::bytes(audio.wav.to_vec())
                        .file_name("audio.wav")
                        .mime_str("audio/wav")
                        .map_err(|error| error.to_string())?,
                )
                .text("definition", definition.to_string());
            send(
                client
                    .post(endpoint(provider))
                    .header("Ocp-Apim-Subscription-Key", &provider.api_key)
                    .multipart(form),
                timeout,
            )
            .await
        }
        CloudAsrKind::Google => {
            let body = serde_json::json!({
                "config": {
                    "languageCode": if provider.language.is_empty() { "zh-CN" } else { provider.language.as_str() },
                    "enableWordTimeOffsets": true,
                    "enableAutomaticPunctuation": true,
                },
                "audio": { "content": audio.b64 }
            });
            send(client.post(endpoint(provider)).json(&body), timeout).await
        }
        CloudAsrKind::Aliyun => {
            let body = serde_json::json!({
                "model": if provider.model.is_empty() { "qwen3-asr-flash" } else { provider.model.as_str() },
                "messages": [{
                    "role": "user",
                    "content": [{
                        "type": "input_audio",
                        "input_audio": { "data": format!("data:{};base64,{}", audio.mime, audio.b64) }
                    }]
                }]
            });
            send(
                client
                    .post(endpoint(provider))
                    .bearer_auth(&provider.api_key)
                    .json(&body),
                timeout,
            )
            .await
        }
        CloudAsrKind::Tencent => {
            let timestamp = now_secs();
            let query = format!(
                "engine_type={}&voice_format=wav&secretid={}&timestamp={}&expired={}&nonce={}",
                if provider.model.is_empty() {
                    "16k_zh"
                } else {
                    provider.model.as_str()
                },
                url_encode(&provider.api_key),
                timestamp,
                timestamp + 3600,
                timestamp % 100_000,
            );
            let host = "asr.cloud.tencent.com";
            let path = format!("/asr/flash/v1/{}", provider.app_id);
            let authorization = tc3_authorization(
                &provider.api_key,
                &provider.api_secret,
                host,
                &path,
                &query,
                audio.wav,
                timestamp,
            );
            let url = format!("https://{host}{path}?{query}");
            send(
                client
                    .post(url)
                    .header("Authorization", authorization)
                    .header("Content-Type", "application/octet-stream")
                    .body(audio.wav.to_vec()),
                timeout,
            )
            .await
        }
        CloudAsrKind::Volcengine => {
            let body = serde_json::json!({
                "user": { "uid": "ai-cut" },
                "audio": { "format": "wav", "data": audio.b64 },
                "request": { "model_name": if provider.model.is_empty() { "bigmodel" } else { provider.model.as_str() } }
            });
            send(
                client
                    .post(endpoint(provider))
                    .header("X-Api-App-Key", &provider.app_id)
                    .header("X-Api-Access-Key", &provider.api_key)
                    .header(
                        "X-Api-Resource-Id",
                        if provider.region.is_empty() {
                            "volc.bigasr.auc_turbo"
                        } else {
                            provider.region.as_str()
                        },
                    )
                    .header("X-Api-Request-Id", uuid::Uuid::new_v4().to_string())
                    .header("X-Api-Sequence", "-1")
                    .json(&body),
                timeout,
            )
            .await
        }
        CloudAsrKind::Baidu => {
            let token =
                crate::cloud_tts::baidu_token_for(client, &provider.api_key, &provider.api_secret)
                    .await?;
            let url = format!(
                "{}?dev_pid={}&cuid=ai-cut&token={}",
                endpoint(provider),
                if provider.model.is_empty() {
                    "1537"
                } else {
                    provider.model.as_str()
                },
                url_encode(&token)
            );
            send(
                client
                    .post(url)
                    .header("Content-Type", "audio/wav")
                    .body(audio.wav.to_vec()),
                timeout,
            )
            .await
        }
        CloudAsrKind::Custom => custom_call(client, provider, audio, timeout).await,
    }
}

async fn send(
    request: reqwest::RequestBuilder,
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    let response = request
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(super::errors::describe(status.as_u16(), &bytes));
    }
    Ok(bytes.to_vec())
}

async fn custom_call(
    client: &reqwest::Client,
    provider: &CloudAsrProvider,
    audio: &AudioPart<'_>,
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    let url = replace_placeholders(&provider.base_url, audio);
    let mut request = if provider.method.eq_ignore_ascii_case("GET") {
        client.get(url)
    } else {
        let body = if provider.body.trim().is_empty() {
            serde_json::json!({ "audio": audio.b64 }).to_string()
        } else {
            replace_placeholders(&provider.body, audio)
        };
        client
            .post(url)
            .header("Content-Type", "application/json")
            .body(body)
    };
    if !provider.api_key.is_empty() {
        request = request.bearer_auth(&provider.api_key);
    }
    for (name, value) in parse_headers(&provider.headers)? {
        request = request.header(name, value);
    }
    send(request, timeout).await
}

fn replace_placeholders(template: &str, audio: &AudioPart<'_>) -> String {
    template
        .replace("{{audio}}", audio.b64)
        .replace("{{mime}}", audio.mime)
}

fn parse_headers(raw: &str) -> Result<Vec<(String, String)>, String> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| format!("请求头不是合法 JSON：{error}"))?;
    let object = value.as_object().ok_or("请求头必须是 JSON 对象")?;
    Ok(object
        .iter()
        .map(|(key, value)| (key.clone(), value.as_str().unwrap_or("").to_string()))
        .collect())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// 腾讯 TC3 要求 query 按键名排序后参与签名。
pub(crate) fn canonical_query(raw: &str) -> String {
    let mut pairs: Vec<&str> = raw.split('&').filter(|pair| !pair.is_empty()).collect();
    pairs.sort_unstable();
    pairs.join("&")
}

/// 腾讯云 TC3-HMAC-SHA256 签名。
pub(crate) fn tc3_authorization(
    secret_id: &str,
    secret_key: &str,
    host: &str,
    path: &str,
    query: &str,
    body: &[u8],
    timestamp: i64,
) -> String {
    let date = utc_date(timestamp);
    let payload_hash = hex(&Sha256::digest(body));
    let canonical_request = format!(
        "POST\n{path}\n{}\ncontent-type:application/octet-stream\nhost:{host}\n\ncontent-type;host\n{payload_hash}",
        canonical_query(query)
    );
    let scope = format!("{date}/asr/tc3_request");
    let string_to_sign = format!(
        "TC3-HMAC-SHA256\n{timestamp}\n{scope}\n{}",
        hex(&Sha256::digest(canonical_request.as_bytes()))
    );
    let secret_date = hmac(format!("TC3{secret_key}").as_bytes(), date.as_bytes());
    let secret_service = hmac(&secret_date, b"asr");
    let secret_signing = hmac(&secret_service, b"tc3_request");
    let signature = hex(&hmac(&secret_signing, string_to_sign.as_bytes()));
    format!(
        "TC3-HMAC-SHA256 Credential={secret_id}/{scope}, SignedHeaders=content-type;host, Signature={signature}"
    )
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC 接受任意长度密钥");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 只要 UTC 日期 `YYYY-MM-DD`，不为它引 chrono。
fn utc_date(timestamp: i64) -> String {
    let days = timestamp.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// 把「1970-01-01 起的天数」换成公历日期（Howard Hinnant 的算法）。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_query_sorts_and_keeps_encoding() {
        let raw = "voice_format=wav&secretid=AKID&timestamp=1700000000";
        assert_eq!(
            canonical_query(raw),
            "secretid=AKID&timestamp=1700000000&voice_format=wav"
        );
    }

    #[test]
    fn tc3_signature_is_stable_and_sensitive_to_body() {
        let first = tc3_authorization(
            "AKID",
            "SECRET",
            "asr.cloud.tencent.com",
            "/asr/flash/v1/1300",
            "engine_type=16k_zh",
            b"audio",
            1_700_000_000,
        );
        let again = tc3_authorization(
            "AKID",
            "SECRET",
            "asr.cloud.tencent.com",
            "/asr/flash/v1/1300",
            "engine_type=16k_zh",
            b"audio",
            1_700_000_000,
        );
        let other = tc3_authorization(
            "AKID",
            "SECRET",
            "asr.cloud.tencent.com",
            "/asr/flash/v1/1300",
            "engine_type=16k_zh",
            b"audio2",
            1_700_000_000,
        );
        assert_eq!(first, again);
        assert_ne!(first, other);
        assert!(
            first.starts_with("TC3-HMAC-SHA256 Credential=AKID/"),
            "授权头格式不对：{first}"
        );
        // 头里只有 Credential / SignedHeaders / Signature；path 影响签名但不进头。
        assert!(first.contains("/asr/tc3_request"), "scope 不对：{first}");
        assert!(first.contains("SignedHeaders=content-type;host"));
        let other_path = tc3_authorization(
            "AKID",
            "SECRET",
            "asr.cloud.tencent.com",
            "/asr/flash/v1/9999",
            "engine_type=16k_zh",
            b"audio",
            1_700_000_000,
        );
        assert_ne!(first, other_path, "path 没有参与签名");
    }

    #[test]
    fn endpoint_defaults_per_kind() {
        let deepseek = CloudAsrProvider {
            kind: CloudAsrKind::Deepseek,
            ..Default::default()
        };
        assert_eq!(endpoint(&deepseek), "https://api.deepseek.com/v1/tools/asr");

        let azure = CloudAsrProvider {
            kind: CloudAsrKind::Azure,
            region: "eastasia".into(),
            ..Default::default()
        };
        assert_eq!(
            endpoint(&azure),
            "https://eastasia.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15"
        );

        let baidu = CloudAsrProvider {
            kind: CloudAsrKind::Baidu,
            ..Default::default()
        };
        assert!(endpoint(&baidu).starts_with("https://vop.baidu.com/server_api"));
    }
}

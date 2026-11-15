//! 把 HTTP 状态映射成人话。

pub fn describe(status: u16, body: &[u8]) -> String {
    let detail = String::from_utf8_lossy(&body[..body.len().min(200)]).to_string();
    match status {
        401 | 403 => format!("密钥无效或无权限（HTTP {status}）：{detail}"),
        413 => format!("音频超过该服务单次上限（HTTP 413）：{detail}"),
        429 => format!("请求过于频繁或并发超限，请稍后重试：{detail}"),
        400 => format!("请求被拒绝（HTTP 400）：{detail}"),
        _ => format!("识别失败（HTTP {status}）：{detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_auth_and_rate_limits() {
        assert!(describe(401, b"bad key").contains("密钥"));
        assert!(describe(429, b"slow down").contains("频繁"));
        assert!(describe(413, b"too big").contains("上限"));
        assert!(describe(500, b"boom").contains("boom"));
    }
}

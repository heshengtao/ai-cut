//! 剪辑智能体的 OpenAI 兼容端点配置（`ai.json`，明文）。

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 「文本生成」里的一家供应商接入：端点 + Key + 默认模型 + 可选的模型列表。
///
/// 和图片 / 视频 / 语音那些云端服务一样，可以配置多家，文本生成节点在模型下拉里
/// 同时列出所有启用的供应商（`模型 · 供应商名`），选谁就用谁的端点。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TextProvider {
    pub id: String,
    /// 供应商预设 id（`openai` / `deepseek` / `ollama` / `custom` …），只用于回显。
    pub preset: String,
    /// 显示名（用户可改）；为空时界面用预设名。
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    /// 默认模型。
    pub model: String,
    /// 「获取模型列表」拉到的候选；空 = 只提供默认模型。
    pub models: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AgentConfig {
    /// 供应商 id（`openai` / `deepseek` / `ollama` / `custom` …）。
    ///
    /// 只用来回显与"老配置缺这个字段时按地址反推"；请求本身永远是 OpenAI 兼容
    /// 的 `/chat/completions`，各家的兼容端点由前端预置表填进 `base_url`。
    ///
    /// `base_url` / `api_key` / `model` 是**当前生效供应商**的镜像（智能体面板直接读它），
    /// 真正的数据在 `providers` 里。
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    /// 文本生成的供应商列表（模型节点从这里选）。
    pub providers: Vec<TextProvider>,
}

impl AgentConfig {
    /// 当前生效的供应商：第一个启用的；都没启用就用第一条。
    pub fn active_provider(&self) -> Option<&TextProvider> {
        self.providers
            .iter()
            .find(|provider| provider.enabled)
            .or_else(|| self.providers.first())
    }

    /// 是否配置到"可以尝试调用"的程度。
    ///
    /// Key 不再强制：本地端点（Ollama / vLLM / LM Studio …）本来就不要 Key，
    /// 以前这里要求 Key 会让它们永远显示"未配置"。
    pub fn is_configured(&self) -> bool {
        if let Some(provider) = self.active_provider() {
            return !provider.base_url.trim().is_empty() && !provider.model.trim().is_empty();
        }
        !self.base_url.trim().is_empty() && !self.model.trim().is_empty()
    }

    /// 让 `base_url` / `api_key` / `model` / `provider` 跟上当前生效的供应商。
    ///
    /// 智能体面板和旧的 `agent_config` 只认这几个镜像字段，供应商列表是新的单一数据源。
    pub fn sync_mirror(&mut self) {
        if self.providers.is_empty() {
            // 老配置（只有单条 base_url / key / model）：升级成一条供应商，
            // 这样「文本生成」页打开时能看到它、也能直接再添别的。
            if !self.base_url.trim().is_empty() {
                let preset = self.provider_or_inferred();
                let name = provider_display_name(&preset, &self.base_url);
                let model = self.model.clone();
                self.providers.push(TextProvider {
                    id: "default".into(),
                    preset,
                    name,
                    base_url: self.base_url.clone(),
                    api_key: self.api_key.clone(),
                    model: model.clone(),
                    models: if model.trim().is_empty() {
                        Vec::new()
                    } else {
                        vec![model]
                    },
                    enabled: true,
                });
            }
            return;
        }
        let Some(provider) = self.active_provider().cloned() else {
            return;
        };
        self.provider = provider.preset;
        self.base_url = provider.base_url;
        self.api_key = provider.api_key;
        self.model = provider.model;
    }

    /// 缺 `provider` 的老配置按端点地址反推一个，供界面回显。
    pub fn provider_or_inferred(&self) -> String {
        let provider = self.provider.trim();
        if !provider.is_empty() {
            return provider.to_string();
        }
        infer_provider(&self.base_url)
    }
}

/// 按端点地址猜供应商 id（与前端 `inferProviderId` 的常见域名一一对应）。
pub fn infer_provider(base_url: &str) -> String {
    let base = base_url.trim().to_lowercase();
    const HINTS: &[(&str, &str)] = &[
        ("api.openai.com", "openai"),
        ("api.anthropic.com", "anthropic"),
        ("generativelanguage.googleapis.com", "gemini"),
        ("api.deepseek.com", "deepseek"),
        ("dashscope.aliyuncs.com", "dashscope"),
        ("open.bigmodel.cn", "zhipu"),
        ("ark.cn-beijing.volces.com", "ark"),
        ("api.moonshot.cn", "moonshot"),
        ("api.minimaxi.com", "minimax"),
        ("api.stepfun.com", "stepfun"),
        ("api.mistral.ai", "mistral"),
        ("api.lingyiwanwu.com", "lingyi"),
        ("api.baichuan-ai.com", "baichuan"),
        ("qianfan.baidubce.com", "qianfan"),
        ("api.hunyuan.cloud.tencent.com", "hunyuan"),
        ("api.groq.com", "groq"),
        ("api.x.ai", "xai"),
        ("integrate.api.nvidia.com", "nvidia"),
        ("models.github.ai", "github"),
        ("api-inference.modelscope.cn", "modelscope"),
        ("ai.gitee.com", "gitee"),
        ("api.jina.ai", "jina"),
        ("api.perplexity.ai", "perplexity"),
        ("api.siliconflow.cn", "siliconflow"),
        ("openrouter.ai", "openrouter"),
        ("api.together.xyz", "together"),
        ("api.fireworks.ai", "fireworks"),
        ("aihubmix.com", "aihubmix"),
        ("api.302ai.cn", "302ai"),
        ("api.ocoolai.com", "ocoolai"),
        ("dmxapi.cn", "dmxapi"),
        ("api.hyperbolic.xyz", "hyperbolic"),
        ("api.ppinfra.com", "ppinfra"),
        ("127.0.0.1:11434", "ollama"),
        ("localhost:11434", "ollama"),
        ("127.0.0.1:1234", "lmstudio"),
        ("localhost:1234", "lmstudio"),
        ("127.0.0.1:8000", "vllm"),
        ("localhost:8000", "vllm"),
        ("127.0.0.1:9997", "xinference"),
        ("localhost:9997", "xinference"),
    ];
    if base.is_empty() {
        return "custom".into();
    }
    for (needle, id) in HINTS {
        if base.contains(needle) {
            return (*id).to_string();
        }
    }
    "custom".into()
}

/// 老配置升级成供应商时，给一个能认出来的显示名（域名 / 预设 id）。
fn provider_display_name(preset: &str, base_url: &str) -> String {
    let host = base_url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    match preset {
        "custom" if !host.is_empty() => host,
        "custom" => "自定义端点".into(),
        other => other.to_string(),
    }
}

pub struct AgentConfigRuntime {
    inner: Mutex<AgentConfig>,
    path: Option<PathBuf>,
}

impl AgentConfigRuntime {
    pub fn load(path: Option<PathBuf>) -> Self {
        let mut config = path
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<AgentConfig>(&text).ok())
            .unwrap_or_default();
        config.sync_mirror();
        Self {
            inner: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> AgentConfig {
        self.inner
            .lock()
            .map(|inner| inner.clone())
            .unwrap_or_default()
    }

    pub fn set(&self, next: AgentConfig) -> AgentConfig {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = next.clone();
        }
        self.save(&next);
        next
    }

    fn save(&self, config: &AgentConfig) {
        let Some(path) = &self.path else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match serde_json::to_string_pretty(config) {
            Ok(json) => {
                if let Err(error) = std::fs::write(path, json) {
                    eprintln!("[agent] 写入配置失败：{error}");
                }
            }
            Err(error) => eprintln!("[agent] 序列化配置失败：{error}"),
        }
    }
}

# Hugging Face gated 模型：浏览器授权 + token 回填

日期：2026-11-12
状态：已实现

## 问题

Hugging Face 上有一类 **gated 仓库**（如 `Lightricks/LTX-2.5`）：匿名请求 `resolve/...`
一律返回

```
401（直连）/ 403（镜像）  x-error-code: GatedRepo
                          x-error-message: Access to model … is restricted … Visit https://huggingface.co/<repo>
```

添加这些模型时，下载器把它当成普通 4xx，用户在「下到一半」拿到一个没法处理的失败；
而正确做法是先去网页同意许可、再用 read token 重试。

## 判定

- **只认 `X-Error-Code: GatedRepo`**，状态码接受 **401 和 403**。实测差别：
  直连 HF 是 `401`，经 hf-mirror / 已带 token 但不在授权名单时是 `403`——只认 403 会漏掉
  真实用户路径。
- 普通 401 / 403（镜像站自己的鉴权、权限不足但没有 `GatedRepo` 码）仍是永久失败，
  不进授权流程。
- 仓库页由下载 URL 推出（`https://huggingface.co/<ns>/<repo>/resolve/...`），不解析错误文案。

## 交互

1. 先按现有顺序换源（魔搭有副本时静默下完，国内用户看不到任何弹窗）。
2. 所有源都失败、且其中有 gated：**不算失败**，发 `needs-auth` 状态（ai-daw）或让
   `model_download` 返回 `ModelAuth`（ai-cut），界面弹授权框。
3. 授权框三步：
   - 「去同意许可」→ 系统浏览器打开仓库页（用户点 *Agree and access repository*）；
   - 「创建 read token」→ 打开 `https://huggingface.co/settings/tokens/new?tokenType=read`；
   - 粘贴 token →「保存并重试」→ 写设置并重新下载同一条目。
4. 已存 token 仍 403：在框里就地提示（多半是没点同意，或 token 没有该仓库权限）。

## 凭据

- 字段 `hf_token`（两仓各自的网络配置，随 `store.json` 落盘），明文，UI 掩码显示
  `hf_…abcd`；**后端从不下发 token 本身**（`*_network_config` 返回前清空该字段）。
- 只对 `huggingface.co` 官方域附加 `Authorization: Bearer`。用户自填的镜像 / 代理前缀是
  第三方地址，**不带**凭据。
- 不进日志、不进错误消息；空的 token 等于匿名下载。

## 代码落点

| | ai-daw | ai-cut |
|---|---|---|
| 配置 | `manager::StoreNetwork::hf_token` | `network::NetworkConfig::hf_token` |
| 判定 | `manager::gated_signal` / `hf_request_host` / `hf_repo_of` | `network::is_gated` / `hf_request_host` / `hf_repo_of` |
| 下载 | `download_from` + `download_verified_with_token` | `download_once` + `download_file`（`FetchError`） |
| 上报 | `ModelProgress.state = "needs-auth"` + `auth` | `ModelProgress` 同左 + 命令返回 `ModelAuth` |
| 保存 | `model_save_hf_token` / `model_hf_token_status` | 同名命令 |
| 界面 | `HfAuthDialog.vue` + 设置页网络区块 | 同左（复用 `ModalShell`） |

## 测试

- 域判定：token 只发给官方域；`hf-mirror`、代理前缀、`huggingface.co.evil.tld` 都不带。
- 判定：`403 + GatedRepo` 才进授权；`401` / `404` / 其他错误码不算。
- 仓库页解析：含 `models/` 前缀与缺少仓库名的边界。
- 前端：返回授权信息时只挂起、不写 `error`；保存 token 后重试同一 id；关框清待办；
  普通失败仍走 `error`。

## 不做

- OAuth 设备码流程（需要向 HF 注册 client_id），以及“网页点同意就自动带 token”——
  HF 没有这种回调。token 必须由用户粘贴一次。
- 清单里给条目打 `gated` 标记：与实际授权状态会漂移，且 403 信号已经足够准确。

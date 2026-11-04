# 云端图像 / 视频生成服务（文生图 / 图生图 / 视频）

> 状态：已实施（2026-11-04）。范围：`AI 画图 / 图像编辑`、`AI 视频生成` 两个子页 + AI 首页卡片 + 设置页新增「图像与视频」分区。
> 兄弟项目 ai-daw 暂无同类需求，未同步。

## 一、为什么做

画图 / 视频此前**只有本地 sd.cpp + 权重**这一条路：要下 875 MB 引擎 + 6~30 GB 模型，没有独显的机器基本放弃。
用户明确要求：

1. 模型列表**参考 TTS 的做法**，开头放一个「配置生成服务…」跳转设置；
2. 设置里能配置主流供应商的 **文生图 / 图生图 / 视频生成** 三种 API；
3. **官方 API 优先**，其次大型融合站（OpenRouter、硅基流动等）。

## 二、用户看到的形态

### 2.1 模型下拉（4 处，同一个数据源）

- AI 首页的「AI 画图 / 图像编辑」「AI 视频生成」两张卡；
- 两个子页里的「模型」下拉。

结构（与 TTS 的「配置 TTS 服务…」一致）：

```
配置生成服务…                     ← action，点它打开 设置 → 图像与视频
本地模型
  Z-Image Turbo      已安装 · 6.24 GB
  FLUX.1 Kontext     需下载 12.4 GB
云端服务
  OpenAI             OpenAI · gpt-image-1
  火山方舟            火山方舟（豆包）· doubao-seedream-4-0-250828
```

选云端服务后：

- 子页隐藏「运行环境」「采样步数 / CFG / 重绘强度 / 权重放内存 / VAE 分块」等本地参数；
- 主按钮直接是「生成」，不再要求下载引擎 / 权重；
- 图像编辑保留「原图」下拉；涂抹 mask 只在 OpenAI（编辑接口）出现；
- 视频页的首帧参考图只在支持图生视频的服务上出现；
- 生成结果与本地产物走同一条入库链路（`insertGeneratedImage` / `importAssetAt`）。

### 2.2 设置 → 图像与视频

- 服务列表（名称、接口类型、能力摘要、启用状态、删除）；
- 编辑器：名称、接口类型（官方 / 聚合站分组）、启用、三个能力开关
  （文生图 / 图生图 / 视频生成）、接口地址、API Key、（可灵）Secret Key、
  （MiniMax）Group ID、三个模型名；
- 「测试」：用当前配置生成一张 512 样张（会真的调用一次 API，可能计费），
  成功后直接显示缩略图——这是唯一能同时验证 Key、模型名与网络的方式。
- 编辑器底部左侧「删除」：新建中的草稿点一下就收起（不写配置）；正在编辑已保存的服务时
  变成「取消」，只放弃本次修改。真正删除服务仍走列表那一行的「删除」（带确认框）——
  TTS 的编辑器也补了同一个按钮。

## 三、供应商矩阵

`kind` 决定协议、默认地址、默认模型与默认能力；用户只改模型名即可。

| kind | 展示名 | 默认能力 | 默认地址 |
|---|---|---|---|
| `openai` | OpenAI | 文生图 / 图生图 | `https://api.openai.com/v1` |
| `gemini` | Google Gemini | 文生图 / 图生图 / 视频 | `https://generativelanguage.googleapis.com` |
| `stability` | Stability AI | 文生图 / 图生图 | `https://api.stability.ai` |
| `bfl` | Black Forest Labs | 文生图 / 图生图 | `https://api.bfl.ai` |
| `dashscope` | 阿里云百炼 | 三种全 | `https://dashscope.aliyuncs.com` |
| `ark` | 火山方舟（豆包） | 三种全 | `https://ark.cn-beijing.volces.com/api/v3` |
| `kling` | 可灵 | 文生图 / 视频 | `https://api-beijing.klingai.com` |
| `minimax` | MiniMax 海螺 | 文生图 / 视频 | `https://api.minimax.chat` |
| `runway` | Runway | 视频 | `https://api.dev.runwayml.com` |
| `luma` | Luma AI | 视频 | `https://api.lumalabs.ai` |
| `replicate` | Replicate | 文生图 / 视频 | `https://api.replicate.com/v1` |
| `fal` | fal.ai | 文生图 / 视频 | `https://queue.fal.run` |
| `openrouter` | OpenRouter | 文生图 / 图生图 | `https://openrouter.ai/api` |
| `siliconflow` | 硅基流动 | 三种全 | `https://api.siliconflow.cn/v1` |

能力是**每个服务自己的开关**，默认取 kind 的预设；用户在设置里改过的值以配置为准。
视频的 `i2v`（图生视频）与 `t2v` 共用「视频生成」开关。

## 四、实现位置

| 层 | 文件 | 说明 |
|---|---|---|
| Rust | `src-tauri/src/cloud_gen.rs`（新） | 配置、命令、14 家协议适配、异步任务轮询、落盘 |
| Rust | `src-tauri/src/lib.rs` | 注册 `mod cloud_gen`、7 个命令、`cloud-gen.json` 运行时 |
| 类型 | `src/types/cloudGen.ts`（新） | 与 Rust 对齐的类型 |
| API | `src/core/cloudGenApi.ts`（新） | `invoke` 封装 + `cloud-gen-progress` 事件 |
| Store | `src/stores/cloudGen.ts`（新） | 图像 / 视频共用一个任务状态 |
| 纯逻辑 | `src/utils/cloudGen.ts`（新） | 能力判定、`local:` / `cloud:` 下拉 id |
| UI | `SettingsView.vue` | 新增「图像与视频」分区（列表 + 编辑器 + 测试） |
| UI | `AiImagePage.vue` / `AiVideoPage.vue` / `AiPane.vue` | 模型下拉 + 云端分支 |
| i18n | `src/i18n/{zh,en}.ts` | `settings.gen.*`、`aiImage.*`、`aiVideo.*`、`ai.cloudReady` |

配置文件：`<数据目录>/cloud-gen.json`（与 `tts.json` / `network.json` 同根，跟随「设置 → 存储」迁移）。

命令：

| 命令 | 用途 |
|---|---|
| `cloud_gen_config` / `cloud_gen_set_config` | 读写配置 |
| `cloud_gen_presets` | 供应商预设（前端「添加服务」用，避免两套默认值） |
| `cloud_gen_image` | 文生图 / 图生图；返回 `{ path, width, height, provider, model }` |
| `cloud_gen_video` | 视频生成；返回 `{ path, width, height, duration, … }` |
| `cloud_gen_test` | 设置页的 512 样张 |
| `cloud_gen_cancel` / `cloud_gen_busy` | 取消 / 查询任务（图像与视频共用一条任务锁） |

进度事件：`cloud-gen-progress`，载荷与 `image-gen-progress` 同形
（`state` / `message` / `progress` / `elapsed`）。

### 4.1 产物

- 图片：PNG 直接落地；JPEG / WebP 交给 ffmpeg 转 PNG（与本地生成一致）；
- 视频：MP4 落地后用 ffprobe 取时长 / 宽高；
- 目录：`media::cache_dir(app)`，文件名 `cloud-gen-image-*` / `cloud-gen-video-*`；
- 入库：前端 `importAssetAt` → `insertGeneratedImage`（图像）或新轨 + 片段（视频）。

### 4.2 协议差异是怎么消化的

- 同步接口：OpenAI Images、Gemini `generateContent`、Stability、方舟图片、
  百炼 Qwen-Image、MiniMax 图片、OpenRouter Images、硅基流动图片、Replicate（轮询）、fal（队列）。
- 异步任务：BFL（`polling_url`）、百炼（`tasks`）、方舟（`contents/generations/tasks`）、
  可灵（JWT + `task_id`）、MiniMax（`query` → `files/retrieve`）、Runway（`tasks`）、
  Luma（`generations`）、Replicate（`predictions`）、fal（`status_url` / `response_url`）、
  硅基流动（`/video/submit` + `/video/status`）、Veo（`predictLongRunning` → operations）。
- 鉴权：全部 Bearer，只有 BFL 用 `x-key`、可灵用 AK/SK 签的 HS256 JWT、Veo 下载用 `x-goog-api-key`。
- 尺寸：OpenAI 只接受固定档（`gpt-image` 1024×1024 / 1536×1024 / 1024×1536，
  `dall-e-3` 1792×1024 / 1024×1792），按比例取最近档；
  百炼 / 硅基流动的视频尺寸有白名单（1280×720 / 720×1280 / 960×960），同样取最近档；
  其余供应商接受任意 `宽x高`。

## 五、扩展新供应商

1. `CloudGenKind` 加一个变体；
2. `preset()` 里给默认地址 / 模型 / 能力；
3. 在 `Call::image` 或 `Call::video` 里接一个 `async fn`；
4. 前端不用改（`settings.gen.kind.<kind>` 加两条文案即可）。

## 六、已知边界

1. **接口按各家公开文档实现，无法在 CI 里真连**：协议或字段一旦变动，报错会原样透出
   （HTTP 状态 + 响应片段）。默认地址都可以在设置里改成网关 / 代理。
2. **只有 OpenAI 的编辑接口吃 mask**；其余服务按整图参考改。
3. **测试会计费**：设置页的「测试」是真实生成，提示里已写明。
4. **取消只在轮询间隙生效**：请求发出后的单次 HTTP 不会被中断，取消后最多再等一个轮询周期（3 s）。
5. **视频任务共用锁**：同一时刻只允许一个云端任务（图像或视频），与本地任务互不影响。
6. Replicate / fal 的模型输入 schema 各不相同：只传 `prompt`（图生图再加 `image` / `image_url`），
   模型需要的其它参数请用官方模型默认值或换用官方 API。

## 七、验证

```powershell
pnpm test          # 476 通过（新增 utils/__tests__/cloudGen.test.ts 7 条）
pnpm build         # vue-tsc + vite build
cd src-tauri; cargo test --lib   # 227 通过（新增 cloud_gen 9 条）
```

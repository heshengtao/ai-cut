<p align="center">
  <img src="./public/logo.svg" width="104" alt="AI Cut logo">
</p>

<h1 align="center">AI Cut</h1>

<p align="center">
  <b>AI 剪，人审片。</b><br>
  本地优先、AI 可操作的轻量视频剪辑工作台。
</p>

<p align="center">
  <a href="https://github.com/heshengtao/ai-cut/actions/workflows/release.yml"><img src="https://github.com/heshengtao/ai-cut/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://github.com/heshengtao/ai-cut/actions/workflows/ci.yml"><img src="https://github.com/heshengtao/ai-cut/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/version-0.1.0-1A6CFF?style=flat-square" alt="Version 0.1.0">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-1A6CFF?style=flat-square" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-1A6CFF?style=flat-square" alt="Platforms">
</p>

<p align="center">
  <a href="README_zh.md"><b>简体中文</b></a> ·
  <a href="README.md"><b>English</b></a>
</p>

---

## AI Cut 是什么？

AI Cut 是一个本地优先的桌面剪辑器：时间线、素材库、检查器、字幕、音频处理与导出都在本地完成，不上传素材，不需要账号。

它同时被设计成 **AI 可以操作的编辑器**。应用内置 MCP 服务器，AI Harness 可以通过 MCP 工具或 `aicut` 命令行读取工程、插入片段、调整轨道、生成字幕与朗读，并让每一步都进入同一套撤销历史——人的鼠标操作和 AI 的修改在时间线上没有区别。

> 当前版本 **0.1.0**，处于早期阶段。核心编辑、导出、智能体与 MCP 链路已经可用，接口仍可能变化。

## 功能

### 时间线剪辑
- 多轨道时间线，视频 / 音频 / 图片 / 文字片段混排
- 拖拽、分割、裁剪、跨轨移动、吸附与帧网格
- 撤销 / 重做、命令日志、按命令回退
- 工程自动保存、崩溃后草稿恢复、历史工程

### 素材与检查器
- 拖入即导入，ffprobe 读取时长、分辨率、音轨
- 缩略图、波形、视频预览缓存
- 变换、缩放、旋转、不透明度、混合模式
- 音量、淡入淡出、变调、声道平衡
- 文字样式：字体、字号、颜色、描边、阴影、发光、圆角

### 导出
- MP4 / H.264、ProRes 422、GIF
- 输出分辨率、帧率、质量与音频参数可调
- 后台导出与取消

### AI 与自动化
- **剪辑智能体**：OpenAI 兼容端点、流式回答、工具调用、会话树与分支
- **MCP 服务器**：仅监听回环地址，JSON / SSE 双协议
- **`aicut` CLI**：薄 MCP 客户端，按名转发工具
- **Skills**：内置剪辑技能文档，按需加载
- **字幕**：本地语音识别生成可编辑字幕轨
- **朗读**：本地 TTS 与云端 TTS 服务（OpenAI、ElevenLabs、Azure、Google、百度、MiniMax、火山引擎、自定义 HTTP）
- **音频 AI**：响度统一、降噪、人声美化、人声分离、音频翻译
- **视频 AI**：超分、补帧、智能裁剪、镜头追踪

### 自动更新
- 启动时静默检查 GitHub Releases 的 `latest.json`
- 设置 → 关于里手动检查、显示进度、下载安装并重启
- 更新包使用 Tauri 签名校验，私钥只存在于发布环境

## 安装

从 [Releases](https://github.com/heshengtao/ai-cut/releases) 下载对应平台的安装包：

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `.msi` / `-setup.exe` |
| macOS Apple Silicon | `.dmg` |
| Linux x64 / arm64 | `.AppImage` / `.deb` |

> **macOS 提示「App 已损坏」？** 应用为自签名（未公证），从网络下载会带隔离属性。在终端执行：
>
> ```bash
> xattr -cr "/Applications/AI Cut.app"
> ```

安装后的应用会自动检查更新；也可以在 **设置 → 关于** 中手动检查。

## 从源码构建

### 依赖

- Rust（stable）与 Cargo
- Node.js ≥ 20 与 [pnpm](https://pnpm.io/)（推荐 pnpm 11）
- [Tauri v2 系统依赖](https://tauri.app/start/prerequisites/)

### 构建

```bash
git clone https://github.com/heshengtao/ai-cut.git
cd ai-cut

pnpm install
pnpm tauri dev     # 开发
pnpm tauri build   # 打包
```

常用脚本：

```bash
pnpm build            # 类型检查 + 前端构建
pnpm test             # 单元测试（Vitest）
pnpm fetch:sidecars   # 准备 ffmpeg / ffprobe sidecar
pnpm build:aicut      # 构建 aicut CLI
```

ffmpeg / ffprobe 由 `ffmpeg-static` 与 `@ffprobe-installer/ffprobe` 提供的静态构建随包分发，不依赖用户机器上的 ffmpeg。模型文件位于 `src-tauri/resources/models/`。

本地打正式安装包需要更新签名私钥（CI 已自动注入，本地可选）：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/ai-cut.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s ai-cut-tauri-updater-password -w)"
pnpm tauri build
```

## 架构

```
界面操作 ─┐
MCP 工具 ─┼─▶ apply_command / project.apply ─▶ 纯函数 ops ─▶ Project
内置智能体 ┘                                      │
                                                  └─▶ OpEvent / 撤销历史
```

- **前端**：Vue 3 + TypeScript + Pinia，持有整份响应式工程文档
- **写入口**：所有修改都经过可序列化命令；过期 revision 会被拒绝
- **Rust**：原生文件框、ffmpeg/ffprobe sidecar、导出、MCP 服务器、智能体、网络与 CLI 挂载
- **CLI**：`crates/aicut` 是 MCP 的薄客户端，新增工具不需要改 CLI

更多设计细节见 [docs/roadmap.md](docs/roadmap.md) 与 [docs/superpowers/specs](docs/superpowers/specs)。

## 发布与自动更新

推送 `v*` 标签会触发 [release.yml](.github/workflows/release.yml)：

1. 在 Windows / macOS（Apple Silicon）/ Linux（x64、arm64）上构建
2. 用 `TAURI_SIGNING_PRIVATE_KEY` 签名更新包
3. 生成 `latest.json` 并连同安装包发布到 GitHub Releases
4. 已安装的应用从 `releases/latest/download/latest.json` 获取更新

签名私钥保存在发布环境的 Secrets 中，公钥写在 `src-tauri/tauri.conf.json`。

## License

Apache-2.0，见 [LICENSE](LICENSE)。

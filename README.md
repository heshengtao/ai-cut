<p align="center">
  <img src="./public/logo.svg" width="104" alt="AI Cut logo">
</p>

<h1 align="center">AI Cut</h1>

<p align="center">
  <b>AI cuts, you review.</b><br>
  A local-first, agent-operable video editing workspace — small on purpose.
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

## What is AI Cut?

AI Cut is a local-first desktop editor: timeline, media library, inspector, captions, audio tools and export all run on your machine. No uploads, no account.

It is also built to be **operated by an AI agent**. A bundled MCP server lets any harness read the project, insert clips, adjust tracks, generate captions and voiceovers through MCP tools or the `aicut` CLI — and every change lands in the same undo history as a mouse edit.

> Version **0.1.0**, early stage. Core editing, export, the clip agent and the MCP bridge work; interfaces may still change.

## Features

### Timeline editing
- Multi-track timeline with video, audio, image and text clips
- Drag, split, trim, cross-track moves, snapping and frame grid
- Undo / redo, command log, per-command rollback
- Autosave, crash-draft recovery, project history

### Media and inspector
- Drag-to-import with ffprobe metadata
- Thumbnails, waveforms and cached video previews
- Transform, scale, rotation, opacity, blend modes
- Volume, fades, pitch and stereo balance
- Text styling: fonts, size, colour, stroke, shadow, glow, corner radius

### Export
- MP4 / H.264, ProRes 422, GIF
- Configurable resolution, frame rate, quality and audio
- Background export with cancellation

### AI and automation
- **Clip agent** — OpenAI-compatible endpoint, streaming, tool calls, branching session tree
- **MCP server** — loopback-only, JSON and SSE transports
- **`aicut` CLI** — a thin MCP client that forwards tools by name
- **Skills** — bundled editing docs loaded on demand
- **Captions** — local speech recognition into an editable caption track
- **Voiceover** — local TTS plus cloud providers (OpenAI, ElevenLabs, Azure, Google, Baidu, MiniMax, Volcengine, custom HTTP)
- **Audio AI** — loudness matching, denoise, vocal polish, source separation, audio translation
- **Video AI** — super resolution, frame interpolation, smart reframing, camera tracking

### Auto-update
- Silent check against GitHub Releases `latest.json` at startup
- Manual check, progress, download, install and restart under Settings → About
- Update bundles are signature-verified; the private key lives only in the release environment

## Installation

Download the installer for your platform from [Releases](https://github.com/heshengtao/ai-cut/releases):

| Platform | Package |
| --- | --- |
| Windows x64 | `.msi` / `-setup.exe` |
| macOS Apple Silicon | `.dmg` |
| Linux x64 / arm64 | `.AppImage` / `.deb` |

> **macOS says “App is damaged”?** The app is ad-hoc signed (not notarized), so macOS quarantines downloads. Run this in Terminal, then open the app normally:
>
> ```bash
> xattr -cr "/Applications/AI Cut.app"
> ```

Installed apps check for updates automatically; you can also check manually in **Settings → About**.

## Build from source

### Requirements

- Rust (stable) with Cargo
- Node.js ≥ 20 and [pnpm](https://pnpm.io/) (pnpm 11 recommended)
- [Tauri v2 system prerequisites](https://tauri.app/start/prerequisites/)

### Build

```bash
git clone https://github.com/heshengtao/ai-cut.git
cd ai-cut

pnpm install
pnpm tauri dev     # development
pnpm tauri build   # bundle
```

Useful scripts:

```bash
pnpm build            # type-check + frontend build
pnpm test             # unit tests (Vitest)
pnpm fetch:sidecars   # prepare ffmpeg / ffprobe sidecars
pnpm build:aicut      # build the aicut CLI
```

ffmpeg / ffprobe ship as static binaries from `ffmpeg-static` and `@ffprobe-installer/ffprobe`, so users do not need ffmpeg installed. Model files live in `src-tauri/resources/models/`.

A release build needs the updater signing key (CI injects it automatically; locally it is optional):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/ai-cut.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -s ai-cut-tauri-updater-password -w)"
pnpm tauri build
```

## Architecture

```
UI actions ─┐
MCP tools  ─┼─▶ apply_command / project.apply ─▶ pure ops ─▶ Project
clip agent ┘                                     │
                                                 └─▶ OpEvent / undo history
```

- **Frontend** — Vue 3 + TypeScript + Pinia holding the whole reactive project document
- **Single write path** — every edit is a serializable command; stale revisions are rejected
- **Rust** — native dialogs, ffmpeg/ffprobe sidecars, export, MCP server, agent runtime, networking and CLI mounting
- **CLI** — `crates/aicut` is a thin MCP client; new tools need no CLI changes

More design notes: [docs/roadmap.md](docs/roadmap.md) and [docs/superpowers/specs](docs/superpowers/specs).

## Releases and auto-update

Pushing a `v*` tag runs [release.yml](.github/workflows/release.yml):

1. Build on Windows / macOS (Apple Silicon) / Linux (x64, arm64)
2. Sign updater bundles with `TAURI_SIGNING_PRIVATE_KEY`
3. Generate `latest.json` and publish installers + signatures to GitHub Releases
4. Installed apps fetch `releases/latest/download/latest.json`

The signing private key lives in the release environment's Secrets; the public key is embedded in `src-tauri/tauri.conf.json`.

## License

Apache-2.0. See [LICENSE](LICENSE).

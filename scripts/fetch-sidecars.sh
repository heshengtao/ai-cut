#!/usr/bin/env bash
# 把系统 PATH 上的 ffmpeg / ffprobe 拷进 src-tauri/binaries/，并按 Tauri 要求加上 target-triple 后缀。
# 分发前应替换为体积更小的自建 ffmpeg（见计划风险 R3）。
set -euo pipefail

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ -z "$TRIPLE" ]; then
  echo "无法确定 target triple（rustc 不可用？）" >&2
  exit 1
fi

DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/binaries"
mkdir -p "$DEST"

for bin in ffmpeg ffprobe; do
  src="$(command -v "$bin" || true)"
  if [ -z "$src" ]; then
    echo "缺少 $bin：请先安装 ffmpeg（macOS: brew install ffmpeg）" >&2
    exit 1
  fi
  cp -L "$src" "$DEST/$bin-$TRIPLE"
  chmod +x "$DEST/$bin-$TRIPLE"
  echo "已放置 $DEST/$bin-$TRIPLE"
done

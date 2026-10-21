#!/usr/bin/env bash
# 准备打包用的 ffmpeg / ffprobe sidecar。
#
# 优先用 devDependencies 里的静态构建（ffmpeg-static / @ffprobe-installer/ffprobe），
# 这样发布的 app 不依赖构建机上的 Homebrew 动态库；找不到时再回退到 PATH。
# 目标 triple 默认取 rustc host，交叉构建时可用 AICUT_TARGET 覆盖。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${AICUT_TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"
if [ -z "$TRIPLE" ]; then
  echo "无法确定 target triple（rustc 不可用？）" >&2
  exit 1
fi

EXE=""
case "$TRIPLE" in
  *windows*) EXE=".exe" ;;
esac

DEST="$ROOT/src-tauri/binaries"
mkdir -p "$DEST"

# 从 node 解析包内二进制路径（Windows 下把反斜杠换成斜杠，方便 bash 使用）。
node_path() {
  node -e "process.stdout.write($1)" 2>/dev/null | sed 's|\\\\|/|g' || true
}

for bin in ffmpeg ffprobe; do
  src=""
  if [ "$bin" = "ffmpeg" ]; then
    src="$(node_path "require('ffmpeg-static')")"
  else
    src="$(node_path "require('@ffprobe-installer/ffprobe').path")"
  fi
  if [ -z "$src" ] || [ ! -f "$src" ]; then
    src="$(command -v "$bin" || true)"
  fi
  if [ -z "$src" ] || [ ! -f "$src" ]; then
    echo "缺少 ${bin}：请先 pnpm install（静态构建），或安装系统 ffmpeg" >&2
    exit 1
  fi
  rm -f "$DEST/$bin-$TRIPLE$EXE"
  cp -L "$src" "$DEST/$bin-$TRIPLE$EXE"
  chmod +x "$DEST/$bin-$TRIPLE$EXE"
  echo "已放置 $DEST/${bin}-${TRIPLE}${EXE}（来自 ${src}）"
done

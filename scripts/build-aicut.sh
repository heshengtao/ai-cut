#!/usr/bin/env bash
# 构建 aicut 薄客户端，并按 Tauri 的 target-triple 命名放进 binaries/。
# 目标 triple 默认取 rustc host；交叉构建时用 AICUT_TARGET 覆盖。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${AICUT_TARGET:-$(rustc -vV | sed -n 's/^host: //p')}"
EXE=""
case "$TRIPLE" in
  *windows*) EXE=".exe" ;;
esac

cargo build --manifest-path "$ROOT/crates/aicut/Cargo.toml" --release --target "$TRIPLE"
mkdir -p "$ROOT/src-tauri/binaries"

SRC="$ROOT/crates/aicut/target/$TRIPLE/release/aicut${EXE}"
DST="$ROOT/src-tauri/binaries/aicut-${TRIPLE}${EXE}"
cp "$SRC" "$DST"
chmod +x "$DST" || true
echo "built $DST"

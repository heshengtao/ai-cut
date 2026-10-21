#!/usr/bin/env bash
# MCP 冒烟测试：验证发现文件、初始化、工具列表、工程概览与命令桥接。
# 用法：scripts/mcp-smoke.sh
# 前置：AI Cut 正在运行（会写出 mcp-url）。

set -euo pipefail

if [[ -n "${AICUT_MCP_URL:-}" ]]; then
  URL="${AICUT_MCP_URL}"
else
  if [[ "$(uname -s)" == "Darwin" ]]; then
    CONFIG_DIR="${HOME}/Library/Application Support/com.aicut.editor"
  else
    CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/com.aicut.editor"
  fi
  if [[ ! -f "${CONFIG_DIR}/mcp-url" ]]; then
    echo "未找到 MCP 发现文件：${CONFIG_DIR}/mcp-url（先启动 AI Cut）" >&2
    exit 1
  fi
  URL="$(cat "${CONFIG_DIR}/mcp-url")"
fi

BASE="${URL%/mcp}"
JSON="Content-Type: application/json"

echo "MCP: ${URL}"

echo "1/5 health"
curl -fsS --max-time 10 "${BASE}/health" >/dev/null

echo "2/5 initialize"
curl -fsS --max-time 10 -X POST "${URL}" -H "${JSON}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | grep -q '"protocolVersion"'

echo "3/5 tools/list"
TOOLS="$(curl -fsS --max-time 10 -X POST "${URL}" -H "${JSON}" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')"
for TOOL in get_project get_context get_track find_clips get_markers apply_command apply_commands set_clip_color set_clip_mask set_clip_transition set_clip_keyframes import_subtitles export_subtitles render_frame render_storyboard job_start; do
  grep -q "\"${TOOL}\"" <<<"${TOOLS}"
done

echo "4/5 get_project"
SNAPSHOT="$(curl -fsS --max-time 20 -X POST "${URL}" -H "${JSON}" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_project","arguments":{}}}')"
REVISION="$(node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const response = JSON.parse(raw);
  const snapshot = JSON.parse(response.result.content[0].text);
  console.log(snapshot.revision);
});
' <<<"${SNAPSHOT}")"

echo "5/5 apply_command (no-op)"
RESULT="$(curl -fsS --max-time 20 -X POST "${URL}" -H "${JSON}" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"apply_command\",\"arguments\":{\"command\":{\"kind\":\"clip.remove\",\"payload\":{\"clipIds\":[]},\"baseRevision\":${REVISION},\"actor\":\"agent\",\"label\":\"MCP smoke\"}}}}}")"
grep -q '"isError":false' <<<"${RESULT}"

echo "MCP smoke OK (revision=${REVISION})"

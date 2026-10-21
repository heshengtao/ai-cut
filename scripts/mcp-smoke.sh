#!/usr/bin/env bash
# MCP 冒烟测试：验证发现文件、鉴权、初始化、工具列表、实时工程读取与命令桥接。
# 用法：scripts/mcp-smoke.sh
# 前置：AI Cut 正在运行（会写出 ~/.ai-cut/mcp.json）。

set -euo pipefail

DISCOVERY="${HOME}/.ai-cut/mcp.json"
if [[ ! -f "$DISCOVERY" ]]; then
  echo "未找到 MCP 发现文件：$DISCOVERY（先启动 AI Cut）" >&2
  exit 1
fi

URL="$(node -p "require(process.argv[1]).url" "$DISCOVERY")"
TOKEN="$(node -p "require(process.argv[1]).token" "$DISCOVERY")"
BASE="${URL%/mcp}"
AUTH="Authorization: Bearer ${TOKEN}"
JSON="Content-Type: application/json"

echo "MCP: $URL"

echo "1/5 health"
curl -fsS --max-time 10 "${BASE}/health" >/dev/null

echo "2/5 auth rejection"
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST "$URL" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')"
if [[ "$STATUS" != "401" ]]; then
  echo "期望 401，实际 $STATUS" >&2
  exit 1
fi

echo "3/5 initialize + tools/list"
curl -fsS --max-time 10 -X POST "$URL" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | grep -q '"protocolVersion"'

TOOLS="$(curl -fsS --max-time 10 -X POST "$URL" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}')"
for TOOL in project.get timeline.apply agent.setStatus; do
  grep -q "\"$TOOL\"" <<<"$TOOLS"
done

echo "4/5 project.get"
SNAPSHOT="$(curl -fsS --max-time 20 -X POST "$URL" -H "$AUTH" -H "$JSON" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"project.get","arguments":{}}}')"
REVISION="$(node -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const response = JSON.parse(raw);
  const snapshot = JSON.parse(response.result.content[0].text);
  console.log(snapshot.revision);
});
' <<<"$SNAPSHOT")"

echo "5/5 timeline.apply (no-op)"
RESULT="$(curl -fsS --max-time 20 -X POST "$URL" -H "$AUTH" -H "$JSON" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"timeline.apply\",\"arguments\":{\"command\":{\"kind\":\"clip.remove\",\"payload\":{\"clipIds\":[]},\"baseRevision\":${REVISION},\"actor\":\"agent\",\"label\":\"MCP smoke\"}}}}}")"
grep -q '"isError":false' <<<"$RESULT"

echo "MCP smoke OK (revision=${REVISION})"

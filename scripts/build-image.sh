#!/usr/bin/env bash
# 构建 Docker 镜像，并顺手清掉构建留下的悬空镜像。
#
# 为什么需要这个脚本：本机只能用经典构建器（`DOCKER_BUILDKIT=0`，BuildKit 在
# 这套网络下拉不到 registry），而经典构建器每跑一次都会留下若干 `<none>` 中间镜像
# （多阶段构建的 rust / node 基础层，单个可达 2 GB）。手动 `docker build` 之后
# 很容易忘掉它们，几次下来磁盘就满了。
#
# 用法：
#   scripts/build-image.sh              # 打版本号 + latest
#   scripts/build-image.sh --no-latest  # 只打版本号
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
PROXY=${DOCKER_PROXY:-http://http.docker.internal:3128}

TAGS=(-t "ai-cut:${VERSION}")
if [ "${1:-}" != "--no-latest" ]; then
    TAGS+=(-t "ai-cut:latest")
fi

echo "[build-image] ai-cut ${VERSION}"
DOCKER_BUILDKIT=0 docker build "${TAGS[@]}" \
    --build-arg HTTP_PROXY="$PROXY" \
    --build-arg HTTPS_PROXY="$PROXY" \
    .

# 经典构建器的中间层：不删就会越堆越多。
echo "[build-image] 清理悬空镜像"
docker image prune -f | tail -1

docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep '^ai-cut:' || true

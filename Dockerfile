# AI Cut 无头镜像：只有 aicutd + ffmpeg + 前端产物，没有 Tauri / WebKit / 显示服务。
#
#   docker build -t ai-cut .
#   docker run --rm -p 28440:28440 -v aicut-data:/data ai-cut
#
# 打开 http://<host>:28440 即可（无鉴权，访问控制交给部署侧）。
# 用 Alpine 是为了小：最终镜像约 176 MB（ffmpeg 的依赖占大头）。

FROM alpine:3.21 AS web
RUN apk add --no-cache nodejs npm
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@11 && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM rust:1-alpine AS build
RUN apk add --no-cache musl-dev gcc make
WORKDIR /src
COPY crates/daemon ./crates/daemon
RUN cargo build --manifest-path crates/daemon/Cargo.toml --release --bin aicutd \
    && strip /src/crates/daemon/target/release/aicutd

FROM alpine:3.21
# 不装 CJK 字体：文字图层由客户端 Canvas 渲染，容器只跑 ffmpeg。
# 将来做服务端文字栅格化时再补 font-noto-cjk（约 +88 MB）。
RUN apk add --no-cache ffmpeg ca-certificates
COPY --from=build /src/crates/daemon/target/release/aicutd /usr/local/bin/aicutd
COPY --from=web /src/dist /opt/aicut/dist

ENV AICUT_DATA_DIR=/data
VOLUME /data
EXPOSE 28440
ENTRYPOINT ["aicutd", "--lan", "--dist", "/opt/aicut/dist"]

# AI Cut 无头镜像：aicutd + ffmpeg + 前端产物 + **随包 AI 资源**，
# 没有 Tauri / WebKit / 显示服务。
#
#   docker build -t ai-cut .
#   docker run --rm -p 28440:28440 -v aicut-data:/data ai-cut
#
# 打开 http://<host>:28440 即可（无鉴权，访问控制交给部署侧）。
# 底座用 Debian slim：随包的 ONNX Runtime 是 glibc 构建，Alpine(musl)+gcompat 实测 `dlopen` 失败。
# 体积约 386 MB（Debian 底座 108 + 静态 ffmpeg/ffprobe 各 ~78 + ORT 25 + 随包模型 17 + 前端 9）。
#
# 随包清单必须与桌面 `tauri.conf.json` 的 `bundle.resources` 一致：
# `resources/models/`（Silero VAD / LocalVQE / Real-ESRGAN / YOLOX / YuNet + 许可证）
# 与 `resources/ort/`（ONNX Runtime 基线）。桌面能用的本地 AI，容器里同样要有料；
# 唯一的差别只能是「有没有 GPU / 有没有窗口」。

# syntax=docker/dockerfile:1

# 随包的 ONNX Runtime 版本：必须与桌面 `tools/fetch-ort-runtime.mjs` 一致（1.30.0）。
# 桌面 macOS 走静态链接、`resources/ort` 是空的；**镜像必须自己下一份 Linux 版**，
# 否则容器里本地推理一定失败（`ort` 的 load-dynamic 找不到 dylib）。
ARG ORT_VERSION=1.30.0
ARG TARGETARCH

# ---- 前端 ----
FROM node:22-slim AS web
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
# 把桌面随包的那份静态 ffmpeg / ffprobe 固定到 /opt：镜像不再 `apt install ffmpeg`
# （Debian 的 ffmpeg 会拖进 400 MB 编解码依赖，而桌面本来就是用静态包分发的）。
RUN node -e "require('fs').copyFileSync(require('ffmpeg-static'), '/opt/ffmpeg-static')" \
    && node -e "require('fs').copyFileSync(require('@ffprobe-installer/ffprobe').path, '/opt/ffprobe-static')" \
    && chmod +x /opt/ffmpeg-static /opt/ffprobe-static \
    && /opt/ffmpeg-static -version | head -1

# ---- 后端 ----
FROM rust:1-bookworm AS build
# 全局 ARG 只对 FROM 可见，RUN 里必须在本阶段重新声明。
ARG ORT_VERSION
ARG TARGETARCH
# `perl`：ring 的构建脚本在部分目标上会用到；只在构建阶段装，不进最终镜像。
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential perl curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY crates/daemon ./crates/daemon
# daemon 的三个 path 依赖（本地推理 / OFX 渲染）：
# - sherpa-onnx-sys：ASR / TTS / UVR 的静态库绑定（预编译包在 build 时下载，走代理）
# - sherpa-separation：UVR 音源分离的 C API 封装
# - ofx-host：OpenFX 效果宿主（C++ 静态链接，纯计算，不需要窗口）
#   注意 OFX 插件是原生二进制，必须和镜像架构一致：arm64 镜像加载不了只发
#   x86_64 的插件（host.c 会在 dlopen 前报「架构不兼容」，不会含糊地说找不到文件）。
#   这类插件请用 `--platform linux/amd64` 构建/运行镜像。
COPY crates/sherpa-onnx-sys ./crates/sherpa-onnx-sys
COPY crates/sherpa-separation ./crates/sherpa-separation
COPY crates/ofx-host ./crates/ofx-host
# 智能体的技能文档用 `include_str!` 编进二进制（系统提示里的能力索引）。
COPY skills ./skills
# ONNX Runtime：按目标架构取官方 Linux 包（amd64→x64 / arm64→aarch64）。
# ORT 官方只发 glibc 构建；本镜像底座是 Debian（glibc），所以加载没问题。
# （历史：曾用 Alpine + gcompat，实测 `dlopen` 失败，已放弃。）
# 架构自检：ELF 头 e_machine（偏移 18，小端 u16）必须是目标架构——
# 62 = x86_64，183 = aarch64。装错架构的 .so 只会在运行期报 "dlopen failed"，
# 所以这里在构建期就把它挡住。
#
# **不要用 `TARGETARCH` 当唯一来源**：`TARGETARCH` 是 BuildKit 的自动参数，经典构建器
# （本机 Docker Hub 不可达时只能用它）根本不会设置它——静默回落到 x64，镜像里就躺着一份
# 架构不对的 .so，运行期只报 "dlopen failed"，很难看出是架构问题。这里以构建阶段的真实
# 架构为准，`TARGETARCH` 只在显式传入时覆盖。
RUN set -eux; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
        arm64|aarch64) ORT_ARCH=aarch64; WANT_EM=183 ;; \
        *)             ORT_ARCH=x64;     WANT_EM=62  ;; \
    esac; \
    curl -fsSL --retry 3 \
        "https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-${ORT_ARCH}-${ORT_VERSION}.tgz" \
      | tar xz -C /opt; \
    mv "/opt/onnxruntime-linux-${ORT_ARCH}-${ORT_VERSION}" /opt/ort-bundle; \
    test -f "/opt/ort-bundle/lib/libonnxruntime.so.${ORT_VERSION}"; \
    GOT_EM=$(od -An -tu2 -j18 -N2 "/opt/ort-bundle/lib/libonnxruntime.so.${ORT_VERSION}" | tr -d ' \n'); \
    echo "ORT arch check: e_machine=$GOT_EM (want $WANT_EM, TARGETARCH=${TARGETARCH:-unset})"; \
    [ "$GOT_EM" = "$WANT_EM" ] || { echo "ONNX Runtime 架构不匹配：下载到 e_machine=$GOT_EM，期望 $WANT_EM"; exit 1; }

RUN cargo build --manifest-path crates/daemon/Cargo.toml --release --bin aicutd \
    && strip /src/crates/daemon/target/release/aicutd

# ---- 运行 ----
FROM debian:bookworm-slim
# 不装 CJK 字体：文字图层由客户端 Canvas 渲染，容器只跑 ffmpeg。
# 将来做服务端文字栅格化时再补 font-noto-cjk（约 +88 MB）。
# 底座从 Alpine 换成 Debian：随包的 `libonnxruntime.so` 是 glibc 构建，
# Alpine 的 musl 即使加 `gcompat` 也 `dlopen` 失败（实测 `/rpc/ai_ort_probe` 报 dlopen failed）。
# 代价约 +60 MB，换来本地推理在容器里真的能跑——ai-daw 的镜像是同一条路，已实测可用。
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates libgcc-s1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && find /usr/share/doc /usr/share/man /usr/share/locale -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
COPY --from=build /src/crates/daemon/target/release/aicutd /usr/local/bin/aicutd
COPY --from=web /src/dist /opt/aicut/dist

# 随包 AI 资源：5 个模型（含许可证）+ ONNX Runtime 基线。
# 注意**不要**放进 /data：`VOLUME /data` 会在运行时遮住镜像内文件。
COPY src-tauri/resources/models /opt/aicut/models
# 运行阶段的 ORT 来自构建阶段下载的那一份（`resources/ort` 在 macOS 上是空的）。
COPY --from=build /opt/ort-bundle/lib/libonnxruntime.so.1.30.0 /opt/aicut/ort/
# 兼容两种文件名：加载器先认裸名 `libonnxruntime.so`，再扫带版本号的那份
# （`ai_session::ort_library_in`）。这里建一个符号链接，让两套逻辑都能命中。
RUN ln -sf /opt/aicut/ort/libonnxruntime.so.1.30.0 /opt/aicut/ort/libonnxruntime.so
# 与桌面同款的静态 ffmpeg / ffprobe（无外部 .so 依赖，版本也一致）。
COPY --from=web /opt/ffmpeg-static /usr/local/bin/ffmpeg
COPY --from=web /opt/ffprobe-static /usr/local/bin/ffprobe

ENV AICUT_DATA_DIR=/data
# 随包资源根：`Host::resource_dir()` 用它找 `models/`；单独两个变量是显式锚点，
# 方便用户挂自己的模型目录覆盖镜像自带的那一份。
ENV AICUT_RESOURCES=/opt/aicut
ENV AICUT_MODELS_DIR=/opt/aicut/models
ENV AICUT_ORT_BUNDLED=/opt/aicut/ort

VOLUME /data
EXPOSE 28440
ENTRYPOINT ["aicutd", "--lan", "--dist", "/opt/aicut/dist"]

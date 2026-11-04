<script setup lang="ts">
/**
 * AI 能力名称旁的运行时标签：一眼看出这项功能由哪个「驱动」跑。
 *
 * - `onnx`：ONNX Runtime（本地，ONNX 模型，CPU / DirectML / CoreML / CUDA）；
 * - `sdcpp`：sd.cpp（ggml，本地，视频 / 图像生成的 GGUF / safetensors 权重）；
 * - `cloud`：调用设置里配置的云端服务，本机不跑模型。
 *
 * 文案与说明都走 `ai.engine.*`，悬停显示更长的一句解释。
 */
import { useI18n } from "@/i18n";

const props = defineProps<{ kind: "onnx" | "sdcpp" | "cloud" }>();
const i18n = useI18n();
</script>

<template>
  <span
    class="engine-tag"
    :class="props.kind"
    :title="i18n.t(`ai.engine.${props.kind}Hint`)"
  >
    {{ i18n.t(`ai.engine.${props.kind}`) }}
  </span>
</template>

<style scoped>
.engine-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0.02em;
  vertical-align: 1px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
}
.engine-tag.onnx {
  border-color: rgb(var(--md-primary) / 0.4);
  color: rgb(var(--md-primary));
}
.engine-tag.sdcpp {
  border-color: rgb(var(--md-tertiary) / 0.45);
  color: rgb(var(--md-tertiary));
}
.engine-tag.cloud {
  border-color: rgb(var(--md-secondary) / 0.45);
  color: rgb(var(--md-secondary));
}
</style>

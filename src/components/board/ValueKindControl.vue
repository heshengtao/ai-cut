<script setup lang="ts">
/**
 * 值节点的「类型」控件：下拉列出所有带 inline 编辑器的已注册类型。
 *
 * 类型表来自 `core/board/dataTypes`——插件注册新类型后这里自动出现，
 * 所以这个控件不能把类型写死成枚举。
 */
import { computed } from "vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { inlineDataTypeSpecs } from "@/core/board/dataTypes";
import { useI18n } from "@/i18n";
import type { BoardNode, BoardParamSpec } from "@/types/board";

const props = defineProps<{
  node: BoardNode;
  spec: BoardParamSpec;
  value: unknown;
}>();

const emit = defineEmits<{ update: [value: unknown] }>();

const i18n = useI18n();

const options = computed<SelectOption[]>(() => {
  // 文本走专用的文本输入 / 显示节点，值得不在值节点里再出现一次。
  const list = inlineDataTypeSpecs()
    .filter((item) => item.id !== "text")
    .map((item) => {
      const key = `board.type.${item.id}`;
      const label = i18n.t(key);
      return { id: String(item.id), label: label === key ? item.label : label };
    });
  // 旧工程里存过 text：给一个只读的遗留项，避免下拉显示空白。
  const current = props.value;
  if (current === "text" && !list.some((item) => item.id === "text")) {
    list.unshift({ id: "text", label: i18n.t("board.value.legacyText") });
  }
  return list;
});

const current = computed(() =>
  typeof props.value === "string" && props.value ? props.value : "text",
);
</script>

<template>
  <Md3Select
    :model-value="current"
    :options="options"
    :label="i18n.t(spec.labelKey)"
    :searchable="options.length > 6"
    @update:model-value="emit('update', $event)"
  />
</template>

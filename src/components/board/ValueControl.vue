<script setup lang="ts">
/**
 * 值节点的「值」控件：按 `params.kind` 选编辑器。
 *
 * 只负责编辑**字面量**；解析成 number / boolean / JSON 发生在节点运行时
 * （`parseValueParam`），所以 JSON 解析失败也不会让编辑过程报错。
 */
import { computed } from "vue";
import NumberField from "@/components/common/NumberField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import { dataTypeSpec } from "@/core/board/dataTypes";
import { valueKindOf } from "@/core/board/registry";
import { useI18n } from "@/i18n";
import type { BoardNode, BoardParamSpec } from "@/types/board";

const props = defineProps<{
  node: BoardNode;
  spec: BoardParamSpec;
  value: unknown;
}>();

const emit = defineEmits<{ update: [value: unknown] }>();

const i18n = useI18n();

const kind = computed(() => valueKindOf(props.node));
const editor = computed(() => dataTypeSpec(kind.value).inline ?? "text");
const text = computed(() => {
  if (props.value === null || props.value === undefined) return "";
  if (typeof props.value === "string") return props.value;
  if (typeof props.value === "object") {
    try {
      return JSON.stringify(props.value, null, 2);
    } catch {
      return String(props.value);
    }
  }
  return String(props.value);
});
const number = computed(() => {
  const raw = props.value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
});
const checked = computed(
  () => props.value === true || props.value === "true" || props.value === 1 || props.value === "1",
);
const label = computed(() => i18n.t(props.spec.labelKey));
</script>

<template>
  <NumberField
    v-if="editor === 'number'"
    class="value-control-number"
    :model-value="number"
    :label="label"
    @update:model-value="emit('update', $event)"
  />
  <ToggleSwitch
    v-else-if="editor === 'boolean'"
    class="value-control-boolean"
    :model-value="checked"
    :label="label"
    @update:model-value="emit('update', $event)"
  />
  <textarea
    v-else-if="editor === 'json' || editor === 'text'"
    class="mn-textarea value-control-text nodrag nowheel"
    :class="{ 'value-control-json': editor === 'json' }"
    rows="3"
    spellcheck="false"
    :value="text"
    :placeholder="editor === 'json' ? '{ }' : ''"
    @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
  />
  <input
    v-else-if="editor === 'color'"
    class="value-control-color nodrag"
    type="color"
    :value="text || '#8b93f8'"
    :aria-label="label"
    @input="emit('update', ($event.target as HTMLInputElement).value)"
  />
  <input
    v-else
    class="value-control-url nodrag"
    type="url"
    spellcheck="false"
    placeholder="https://…"
    :value="text"
    :aria-label="label"
    @input="emit('update', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.value-control-text {
  width: 100%;
  resize: vertical;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}

.value-control-json {
  min-height: 64px;
}

.value-control-color {
  width: 48px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: transparent;
}

.value-control-url {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
}
</style>

<script setup lang="ts">
/**
 * 值输入的编辑器：按 `params.kind` 渲染，编辑器自己占满整张卡（没有标签、没有边框）。
 * 解析成 number / boolean / JSON 发生在节点运行时（`parseValueParam`），
 * 所以 JSON 写一半不合法也不会让编辑过程报错。
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
  <div class="value-editor" :data-editor="editor">
    <div v-if="editor === 'number'" class="value-editor-center">
      <NumberField
        class="value-editor-number"
        :model-value="number"
        :label="label"
        @update:model-value="emit('update', $event)"
      />
    </div>
    <div v-else-if="editor === 'boolean'" class="value-editor-center">
      <div class="value-editor-boolean">
        <ToggleSwitch
          :model-value="checked"
          :label="label"
          @update:model-value="emit('update', $event)"
        />
        <span>{{ checked ? i18n.t("board.value.true") : i18n.t("board.value.false") }}</span>
      </div>
    </div>
    <textarea
      v-else-if="editor === 'json' || editor === 'text'"
      class="value-editor-textarea nodrag nowheel"
      spellcheck="false"
      :value="text"
      :placeholder="editor === 'json' ? '{\n  \n}' : ''"
      @input="emit('update', ($event.target as HTMLTextAreaElement).value)"
    />
    <div v-else-if="editor === 'color'" class="value-editor-center">
      <input
        class="value-editor-color nodrag"
        type="color"
        :value="text || '#8b93f8'"
        :aria-label="label"
        @input="emit('update', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <input
      v-else
      class="value-editor-url nodrag"
      type="url"
      spellcheck="false"
      placeholder="https://…"
      :value="text"
      :aria-label="label"
      @input="emit('update', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>

<style scoped>
.value-editor {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.value-editor-center {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
}

.value-editor :deep(.value-editor-number) {
  width: 100%;
  max-width: 220px;
}

.value-editor :deep(.value-editor-number .md-number) {
  border: 0;
  background: rgb(var(--md-surface-container-lowest) / 0.34);
}

.value-editor-boolean {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-lowest) / 0.34);
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  font-weight: 600;
}

.value-editor-textarea {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  outline: 0;
  background: transparent;
  box-shadow: none;
  resize: none;
  color: rgb(var(--md-on-surface));
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 11.5px;
  line-height: 1.6;
}

.value-editor-textarea:focus,
.value-editor-textarea:focus-visible {
  border: 0;
  outline: 0;
  box-shadow: none;
}

.value-editor-color {
  width: 64px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
}

.value-editor-url {
  width: 100%;
  height: 46px;
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  background: rgb(var(--md-surface-container-lowest) / 0.38);
  color: rgb(var(--md-on-surface));
  text-align: center;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 12px;
}
</style>

<script setup lang="ts">
/**
 * 模型节点的「分辨率」控件：一档常用尺寸 / 画幅 / 分辨率档 + 「自定义…」。
 *
 * 卡片和检查器共用：选项来自当前模型（本地家族对齐、云端服务白名单 / 比例 /
 * 档位），见 `core/board/size.ts`。选中某一档时同时写回
 * `params.size` + `params.width` / `params.height`，运行与导出都读得到。
 */
import { computed } from "vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import NumberField from "@/components/common/NumberField.vue";
import { useI18n } from "@/i18n";
import { useBoardSize } from "@/composables/useBoardSize";
import { SIZE_CUSTOM } from "@/core/board/size";
import type { BoardNode } from "@/types/board";

const props = withDefaults(
  defineProps<{
    node?: BoardNode;
    /** 卡片里是紧凑的 mn 字段，检查器里是普通 md 字段。 */
    variant?: "card" | "inspector";
  }>(),
  { variant: "inspector" },
);

const emit = defineEmits<{ (e: "update", patch: Record<string, unknown>): void }>();

const i18n = useI18n();
const nodeRef = computed(() => props.node ?? null);
// 解构成顶层 ref：模板里会自动解包，`spec.min` / `selectedId` 直接可用。
const { spec, mode, selectedId, pixels, patch } = useBoardSize(nodeRef);

const auto = computed(() => mode.value === "auto");

/** 下拉选项：预设 + （可自定义时）「自定义…」。 */
const options = computed<SelectOption[]>(() => {
  const list: SelectOption[] = spec.value.options.map((option) => ({
    id: option.id,
    label: option.label,
    hint: option.hint,
    ratio: option.ratio,
  }));
  if (spec.value.custom) {
    list.push({ id: SIZE_CUSTOM, label: i18n.t("board.param.sizeCustom") });
  }
  return list;
});

const custom = computed(() => spec.value.custom && selectedId.value === SIZE_CUSTOM);

/** 自定义时的两个数字：参数里没有（刚切过来）就落到当前档的像素。 */
const customWidth = computed(
  () => Number(nodeRef.value?.data.params.width) || pixels.value.width,
);
const customHeight = computed(
  () => Number(nodeRef.value?.data.params.height) || pixels.value.height,
);

function onSelect(id: string): void {
  emit("update", patch(id));
}

function setAxis(axis: "width" | "height", value: number): void {
  emit("update", { size: SIZE_CUSTOM, [axis]: value });
}
</script>

<template>
  <div v-if="node" class="board-size" :data-variant="variant">
    <span v-if="auto" class="board-size-auto">{{ i18n.t("board.param.sizeAuto") }}</span>
    <template v-else>
      <Md3Select
        :model-value="selectedId"
        :options="options"
        :label="i18n.t('board.param.size')"
        :searchable="options.length > 8"
        @select="onSelect"
      />
      <div v-if="custom" class="board-size-custom">
        <label class="board-size-axis">
          <span>{{ i18n.t("board.param.width") }}</span>
          <NumberField
            :model-value="customWidth"
            :min="spec.min"
            :max="spec.max"
            :step="spec.step"
            :sr-label="i18n.t('board.param.width')"
            input-width="58px"
            @update:model-value="setAxis('width', $event)"
          />
        </label>
        <label class="board-size-axis">
          <span>{{ i18n.t("board.param.height") }}</span>
          <NumberField
            :model-value="customHeight"
            :min="spec.min"
            :max="spec.max"
            :step="spec.step"
            :sr-label="i18n.t('board.param.height')"
            input-width="58px"
            @update:model-value="setAxis('height', $event)"
          />
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped>
.board-size {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

/* 接口不传尺寸（Replicate / fal / H3 参考）：一行说明，不做成控件，省卡片高度。 */
.board-size-auto {
  padding: 4px 0;
  color: rgb(var(--md-on-surface-muted));
  font-size: 10.5px;
  line-height: 1.45;
}

.board-size-custom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
}

.board-size-axis {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.board-size-axis > span {
  font-size: 10px;
  font-weight: 600;
  color: rgb(var(--md-on-surface-variant));
}

.board-size-axis :deep(.step) {
  width: 100%;
  justify-content: space-between;
}

.board-size-axis :deep(.step-input) {
  flex: 1 1 auto;
}

/* 检查器：字段名称呼统一成 md-field 的 11px。 */
.board-size[data-variant="inspector"] .board-size-axis > span {
  font-size: 11px;
}

.board-size[data-variant="inspector"] .board-size-auto {
  padding: 0;
  font-size: 11.5px;
}
</style>

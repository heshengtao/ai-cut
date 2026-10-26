<script setup lang="ts">
/**
 * OFX 参数编辑器。
 *
 * 只负责渲染一个插件实例的参数；放在独立的「参数」面板里，
 * 这样参数再多也不会占满检查器。支持多选片段的混合值。
 */
import { computed } from "vue";
import type { ClipEffect, Project } from "@/types/project";
import type { OfxParamInfo, OfxParamType, OfxParamValue, OfxPluginInfo } from "@/types/plugins";
import { useProjectStore } from "@/stores/project";
import { setClipEffectParam, setClipTransitionEffectParam } from "@/core/ops";
import { isValueParam, sameParamValue } from "@/core/effects";
import NumberField from "@/components/common/NumberField.vue";
import ColorField from "@/components/common/ColorField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    info: OfxPluginInfo;
    effect: ClipEffect;
    targets: Array<{
      clipId: string;
      effect: ClipEffect;
      edge?: "in" | "out";
    }>;
    /** transition 模式隐藏由宿主驱动的 Transition 参数。 */
    mode?: "effect" | "transition";
    readonly?: boolean;
  }>(),
  { readonly: false, mode: "effect" },
);

const project = useProjectStore();
const i18n = useI18n();

const activeTargets = computed(() =>
  props.targets.length > 0
    ? props.targets
    : [{ clipId: "", effect: props.effect }],
);

const valueParams = computed(() =>
  props.info.params.filter(
    (param) =>
      isValueParam(param) &&
      param.name !== "SourceTime" &&
      !(props.mode === "transition" && param.name === "Transition"),
  ),
);

function valueOf(effect: ClipEffect, param: OfxParamInfo): OfxParamValue {
  return effect.params[param.name] ?? param.default;
}

function isMixed(param: OfxParamInfo): boolean {
  const values = activeTargets.value.map(
    (target) => target.effect.params[param.name] ?? param.default,
  );
  return values.length > 1 && values.some((value) => !sameParamValue(value, values[0]));
}

function setParam(
  param: OfxParamInfo,
  value: OfxParamValue,
  coalesce = false,
): void {
  if (props.readonly || props.targets.length === 0) return;
  const targets = props.targets.slice();
  const apply = (doc: Project): Project => {
    let next = doc;
    for (const target of targets) {
      next = target.edge
        ? setClipTransitionEffectParam(
            next,
            target.clipId,
            target.edge,
            param.name,
            value,
          )
        : setClipEffectParam(
            next,
            target.clipId,
            target.effect.id,
            param.name,
            value,
          );
    }
    return next;
  };
  if (coalesce) {
    project.dispatchCoalesced(
      apply,
      `ofx:${props.effect.id}:${param.name}:${targets
        .map((target) => `${target.clipId}:${target.edge ?? ""}`)
        .join(",")}`,
    );
  } else {
    project.dispatch(apply);
  }
}

function numberAt(
  value: OfxParamValue | undefined,
  index: number,
  fallback = 0,
): number {
  if (Array.isArray(value)) {
    const item = value[index];
    return Number.isFinite(item) ? item : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function numbersOf(value: OfxParamValue | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => numberAt(value, index));
}

function minOf(param: OfxParamInfo, index: number): number {
  return param.displayMin?.[index] ?? param.min?.[index] ?? -1_000_000;
}

function maxOf(param: OfxParamInfo, index: number): number {
  return param.displayMax?.[index] ?? param.max?.[index] ?? 1_000_000;
}

function stepOf(param: OfxParamInfo, index: number): number {
  const increment = param.increment?.[index] ?? param.increment?.[0];
  if (increment && increment > 0) return increment;
  return isInteger(param.type) ? 1 : 0.01;
}

function decimalsOf(param: OfxParamInfo): number {
  if (isInteger(param.type)) return 0;
  return Math.min(6, Math.max(0, param.digits || 2));
}

function isInteger(type: OfxParamType): boolean {
  return type === "integer" || type === "integer2d" || type === "integer3d";
}

function isBooleanValue(value: OfxParamValue): boolean {
  return value === true || value === 1;
}

function choiceOptions(param: OfxParamInfo): SelectOption[] {
  return param.choices.map((label, index) => ({ id: String(index), label }));
}

function strChoiceOptions(param: OfxParamInfo): SelectOption[] {
  return param.choices.map((label) => ({ id: label, label }));
}

function colorHex(value: OfxParamValue): string {
  const values = numbersOf(value, 4);
  const byte = (input: number) =>
    Math.round(Math.min(1, Math.max(0, input)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(values[0])}${byte(values[1])}${byte(values[2])}`;
}

function onColor(param: OfxParamInfo, hex: string): void {
  const numeric = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(numeric)) return;
  const current = numbersOf(valueOf(props.effect, param), param.dimension);
  const red = ((numeric >> 16) & 0xff) / 255;
  const green = ((numeric >> 8) & 0xff) / 255;
  const blue = (numeric & 0xff) / 255;
  setParam(
    param,
    param.dimension >= 4 ? [red, green, blue, current[3] ?? 1] : [red, green, blue],
    true,
  );
}

function onComponent(
  param: OfxParamInfo,
  component: number,
  value: number,
): void {
  const next = numbersOf(valueOf(props.effect, param), param.dimension);
  next[component] = value;
  setParam(param, param.dimension > 1 ? next : value, false);
}

function onAlpha(param: OfxParamInfo, value: number): void {
  const next = numbersOf(valueOf(props.effect, param), param.dimension);
  next[3] = value;
  setParam(param, next, false);
}

function onText(param: OfxParamInfo, value: string): void {
  setParam(param, value, false);
}

function parentLabel(param: OfxParamInfo): string {
  if (!param.parent) return "";
  const parent = props.info.params.find((item) => item.name === param.parent);
  return parent?.label || parent?.name || param.parent;
}

function startsGroup(param: OfxParamInfo, index: number): boolean {
  const label = parentLabel(param);
  if (!label) return false;
  if (index === 0) return true;
  return label !== parentLabel(valueParams.value[index - 1]);
}
</script>

<template>
  <div class="param-editor">
    <p v-if="valueParams.length === 0" class="empty">
      {{ i18n.t("plugins.editorNoParams") }}
    </p>

    <template v-for="(param, index) in valueParams" :key="param.name">
      <p v-if="startsGroup(param, index)" class="group-label">
        {{ parentLabel(param) }}
      </p>
      <div class="param-row">
        <span class="param-label" :title="param.hint || param.name">
          {{ param.label || param.name }}
        </span>
        <span v-if="isMixed(param)" class="mixed-chip">
          {{ i18n.t("effects.mixed") }}
        </span>

        <NumberField
          v-if="param.type === 'integer' || param.type === 'double'"
          :model-value="numberAt(valueOf(effect, param), 0)"
          :min="minOf(param, 0)"
          :max="maxOf(param, 0)"
          :step="stepOf(param, 0)"
          :decimals="decimalsOf(param)"
          :sr-label="param.label || param.name"
          :disabled="readonly || !param.enabled"
          input-width="52px"
          @update:model-value="onComponent(param, 0, $event)"
        />

        <ToggleSwitch
          v-else-if="param.type === 'boolean'"
          :model-value="isBooleanValue(valueOf(effect, param))"
          :label="param.label || param.name"
          :disabled="readonly || !param.enabled"
          @update:model-value="setParam(param, $event)"
        />

        <Md3Select
          v-else-if="param.type === 'choice'"
          class="param-select"
          :model-value="String(numberAt(valueOf(effect, param), 0))"
          :options="choiceOptions(param)"
          :label="param.label || param.name"
          :disabled="readonly || !param.enabled"
          @update:model-value="setParam(param, Number($event))"
        />

        <Md3Select
          v-else-if="param.type === 'strchoice'"
          class="param-select"
          :model-value="String(valueOf(effect, param) ?? '')"
          :options="strChoiceOptions(param)"
          :label="param.label || param.name"
          :disabled="readonly || !param.enabled"
          @update:model-value="setParam(param, $event)"
        />

        <div
          v-else-if="param.type === 'rgb' || param.type === 'rgba'"
          class="color-control"
        >
          <ColorField
            :model-value="colorHex(valueOf(effect, param))"
            :label="param.label || param.name"
            :disabled="readonly || !param.enabled"
            @update:model-value="onColor(param, $event)"
            @commit="project.endCoalesce()"
          />
          <NumberField
            v-if="param.type === 'rgba'"
            :model-value="numberAt(valueOf(effect, param), 3, 1)"
            :min="0"
            :max="1"
            :step="0.01"
            :decimals="2"
            label="A"
            :sr-label="`${param.label || param.name} alpha`"
            :disabled="readonly || !param.enabled"
            input-width="34px"
            @update:model-value="onAlpha(param, $event)"
          />
        </div>

        <div
          v-else-if="
            param.type === 'double2d' ||
            param.type === 'double3d' ||
            param.type === 'integer2d' ||
            param.type === 'integer3d'
          "
          class="component-row"
        >
          <NumberField
            v-for="component in param.dimension"
            :key="component"
            :model-value="numberAt(valueOf(effect, param), component - 1)"
            :min="minOf(param, component - 1)"
            :max="maxOf(param, component - 1)"
            :step="stepOf(param, component - 1)"
            :decimals="decimalsOf(param)"
            :sr-label="`${param.label || param.name} ${component}`"
            :disabled="readonly || !param.enabled"
            input-width="42px"
            @update:model-value="onComponent(param, component - 1, $event)"
          />
        </div>

        <input
          v-else-if="
            param.type === 'string' ||
            param.type === 'custom' ||
            param.type === 'bytes'
          "
          class="text-input"
          type="text"
          :value="String(valueOf(effect, param) ?? '')"
          :disabled="readonly || !param.enabled"
          :aria-label="param.label || param.name"
          @change="
            onText(param, ($event.target as HTMLInputElement).value)
          "
        />

        <span v-else class="unsupported">{{ param.type }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.param-editor {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 16px;
  background-color: var(--app-inset);
}
.empty {
  margin: 0;
  padding: 12px 4px;
  font-size: 11.5px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
.group-label {
  margin: 10px 0 2px;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--md-on-surface-muted));
}
.param-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
}
.param-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: rgb(var(--md-on-surface-variant));
}
.mixed-chip {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-tertiary-container));
  color: rgb(var(--md-on-tertiary-container));
  font-size: 9px;
  font-weight: 600;
}
.param-select {
  width: 168px;
}
.color-control {
  display: flex;
  align-items: center;
  gap: 4px;
}
.component-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.text-input {
  width: 168px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
  font-size: 11.5px;
  outline: none;
}
.text-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.unsupported {
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}
</style>

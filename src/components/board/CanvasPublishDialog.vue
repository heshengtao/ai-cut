<script setup lang="ts">
/**
 * 「发布工作流」模态框（全局单例）。
 *
 * 发布是画布级动作：从画布列表某一行的「发布」按钮打开，先切到那张画布，
 * 这里展示签名 / 校验问题 / 名称 / 两个用途开关，确认后保存成库里的新版本。
 */
import { computed } from "vue";
import ModalShell from "@/components/common/ModalShell.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import { useCanvasPublish } from "@/composables/useCanvasPublish";
import { useBoardLabels } from "@/composables/useBoardLabels";
import { useI18n } from "@/i18n";
import { declKey } from "@/core/board/workflowNodes";

const i18n = useI18n();
const { typeLabel } = useBoardLabels();
const publish = useCanvasPublish();

const name = computed({
  get: () => publish.name.value,
  set: (value: string) => {
    publish.name.value = value;
  },
});
const publishApi = computed({
  get: () => publish.publishApi.value,
  set: (value: boolean) => {
    publish.publishApi.value = value;
  },
});
const publishEmbed = computed({
  get: () => publish.publishEmbed.value,
  set: (value: boolean) => {
    publish.publishEmbed.value = value;
  },
});

const open = computed({
  get: () => publish.open.value,
  set: (value: boolean) => {
    if (!value) publish.closePublish();
  },
});
</script>

<template>
  <ModalShell v-model:open="open" :title="i18n.t('board.canvas.publishTitle')" width="480px">
    <p class="target">
      {{ i18n.t("board.canvas.publishTarget", { name: publish.targetTitle.value }) }}
    </p>

    <div v-if="publish.signature.value.inputs.length || publish.signature.value.outputs.length" class="signature">
      <div v-if="publish.signature.value.inputs.length" class="signature-row">
        <span class="signature-label">{{ i18n.t("board.inspect.workflowInputs") }}</span>
        <span class="chips">
          <span v-for="decl in publish.signature.value.inputs" :key="decl.id" class="chip">
            {{ declKey(decl) }}<em>{{ typeLabel(decl.type) }}</em>
          </span>
        </span>
      </div>
      <div v-if="publish.signature.value.outputs.length" class="signature-row">
        <span class="signature-label">{{ i18n.t("board.inspect.workflowOutputs") }}</span>
        <span class="chips">
          <span v-for="decl in publish.signature.value.outputs" :key="decl.id" class="chip">
            {{ declKey(decl) }}<em>{{ typeLabel(decl.type) }}</em>
          </span>
        </span>
      </div>
    </div>
    <p v-else class="hint">{{ i18n.t("board.canvas.signatureNone") }}</p>

    <ul v-if="publish.problems.value.length" class="problems">
      <li v-for="problem in publish.problems.value" :key="problem.code">
        {{ i18n.t(problem.messageKey, problem.params) }}
      </li>
    </ul>

    <label class="field">
      <span class="label">{{ i18n.t("board.canvas.publishName") }}</span>
      <input
        v-model="name"
        class="input"
        type="text"
        :placeholder="i18n.t('board.canvas.publishNamePlaceholder')"
        @keydown.enter.prevent="publish.submitPublish()"
      />
    </label>

    <div class="toggles">
      <div class="toggle-row">
        <div class="toggle-copy">
          <strong>{{ i18n.t("board.canvas.api") }}</strong>
          <em>{{ i18n.t("board.canvas.apiHint") }}</em>
        </div>
        <ToggleSwitch v-model="publishApi" :label="i18n.t('board.canvas.api')" />
      </div>
      <div class="toggle-row">
        <div class="toggle-copy">
          <strong>{{ i18n.t("board.canvas.subworkflow") }}</strong>
          <em>{{ i18n.t("board.canvas.subworkflowHint") }}</em>
        </div>
        <ToggleSwitch
          v-model="publishEmbed"
          :label="i18n.t('board.canvas.subworkflow')"
        />
      </div>
    </div>

    <p class="hint">{{ i18n.t("board.canvas.publishHint") }}</p>

    <template #foot>
      <div class="actions">
        <span class="state" :data-ready="publish.publishable.value ? 'true' : 'false'">
          {{
            publish.publishable.value
              ? i18n.t("board.canvas.publishReady")
              : i18n.t("board.canvas.publishBlocked")
          }}
        </span>
        <button type="button" class="btn-text" @click="publish.closePublish()">
          {{ i18n.t("common.cancel") }}
        </button>
        <button
          type="button"
          class="btn-filled"
          :disabled="!publish.publishable.value || publish.saving.value"
          @click="publish.submitPublish()"
        >
          {{ i18n.t("board.canvas.savePublish") }}
        </button>
      </div>
    </template>
  </ModalShell>
</template>

<style scoped>
.target {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}

.hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-muted));
}

.signature {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.signature-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.signature-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgb(var(--md-on-surface-muted));
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface-variant));
  font-size: 9.5px;
  font-weight: 600;
  line-height: 16px;
}

.chip em {
  font-style: normal;
  font-weight: 500;
  opacity: 0.62;
}

.problems {
  margin: 0;
  padding-left: 14px;
  font-size: 11px;
  line-height: 1.55;
  color: rgb(var(--md-error));
}

.problems li::marker {
  color: rgb(var(--md-error) / 0.7);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 10.5px;
  font-weight: 600;
  color: rgb(var(--md-on-surface-muted));
}

.input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.6);
  border-radius: var(--md-shape-corner-sm);
  background-color: rgb(var(--md-surface-container-lowest));
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  outline: none;
  transition: border-color var(--md-duration-short-2) var(--md-ease-standard);
}

.input:focus {
  border-color: rgb(var(--md-primary));
}

.toggles {
  display: flex;
  flex-direction: column;
}

.toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.toggle-row + .toggle-row {
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.35);
}

.toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.toggle-copy strong {
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}

.toggle-copy em {
  font-style: normal;
  font-size: 10.5px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-muted));
}

/* 和项目里其它模态框（ProjectDialog / ConfirmDialog）一致：右侧对齐 + 同样的按钮尺寸。 */
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

.state {
  margin-right: auto;
  padding: 1px 8px;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-error-container) / 0.55);
  color: rgb(var(--md-on-error-container));
  font-size: 9.5px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
}

.state[data-ready="true"] {
  background-color: rgb(var(--md-tertiary-container) / 0.7);
  color: rgb(var(--md-on-tertiary-container));
}

.btn-text {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--md-shape-corner-full);
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.14s ease;
}

.btn-text:hover {
  background-color: rgb(var(--md-primary) / 0.08);
}

.btn-filled {
  height: 36px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--md-shape-corner-full);
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.14s ease;
}

.btn-filled:hover:not(:disabled) {
  filter: brightness(1.06);
}

.btn-filled:disabled {
  opacity: 0.4;
  cursor: default;
  filter: none;
}

.btn-text:focus-visible,
.btn-filled:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
</style>

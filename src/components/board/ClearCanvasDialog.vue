<script setup lang="ts">
/**
 * 「清空画布」三选一对话框（全局单例）。
 *
 * 清空一张**还没保存过**的画布时，不再偷偷保存一份到工作流库（那会让库里
 * 越堆越多），而是让用户明确选择：保存并清空 / 直接清空 / 取消。
 *
 * 按钮和 ProjectDialog / ConfirmDialog 用同一套尺寸与右对齐规则。
 */
import { computed } from "vue";
import ModalShell from "@/components/common/ModalShell.vue";
import { useWorkflowLibrary } from "@/composables/useWorkflowLibrary";
import { useI18n } from "@/i18n";

const i18n = useI18n();
const library = useWorkflowLibrary();

const open = computed({
  get: () => library.clearOpen.value,
  set: (value: boolean) => {
    if (!value) library.closeClear();
  },
});
</script>

<template>
  <ModalShell v-model:open="open" :title="i18n.t('board.clear.unsavedTitle')" width="460px">
    <p class="message">{{ i18n.t("board.clear.unsavedMessage") }}</p>

    <div class="actions">
      <button type="button" class="btn-text" @click="library.closeClear()">
        {{ i18n.t("common.cancel") }}
      </button>
      <button type="button" class="btn-text danger" @click="library.clearWithoutSave()">
        {{ i18n.t("board.clear.clearWithoutSave") }}
      </button>
      <button
        type="button"
        class="btn-filled"
        :disabled="library.saving.value"
        @click="library.clearWithSave()"
      >
        {{ i18n.t("board.clear.saveAndClear") }}
      </button>
    </div>
  </ModalShell>
</template>

<style scoped>
.message {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.btn-text {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
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

.btn-text.danger {
  color: rgb(var(--md-error));
}

.btn-text.danger:hover {
  background-color: rgb(var(--md-error) / 0.08);
}

.btn-filled {
  height: 36px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
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

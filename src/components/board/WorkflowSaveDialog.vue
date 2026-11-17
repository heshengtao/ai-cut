<script setup lang="ts">
/**
 * 「保存工作流」对话框（全局单例）。
 *
 * 画布工具栏、工作流库面板、文件菜单共用同一个对话框；挂在 AppShell 上，
 * 避免各面板各渲染一份、同时弹出两个。
 */
import { computed } from "vue";
import ProjectDialog from "@/components/common/ProjectDialog.vue";
import { useWorkflowLibrary } from "@/composables/useWorkflowLibrary";
import { useI18n } from "@/i18n";

const i18n = useI18n();
const library = useWorkflowLibrary();

const open = computed({
  get: () => library.saveOpen.value,
  set: (value: boolean) => {
    library.saveOpen.value = value;
    if (!value) library.closeSave();
  },
});

function submit(name: string): void {
  library.saveName.value = name;
  void library.submitSave();
}
</script>

<template>
  <ProjectDialog
    v-model:open="open"
    :initial-name="library.saveName.value"
    :title="i18n.t('board.library.saveTitle')"
    :label="i18n.t('board.library.nameLabel')"
    :placeholder="i18n.t('board.library.namePlaceholder')"
    :confirm-text="i18n.t('board.library.save')"
    @submit="submit"
  />
</template>

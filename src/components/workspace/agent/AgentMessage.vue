<script setup lang="ts">
/** 一条用户消息：气泡（可编辑 / 分支切换）。助手内容由 `AgentTurn` 负责。 */
import { computed, ref } from "vue";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilSquareIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import type { AgentNode } from "@/types/agent";

const props = defineProps<{
  node: AgentNode;
  branches?: AgentNode[];
}>();

const emit = defineEmits<{ edit: [id: string, text: string]; branch: [id: string] }>();
const i18n = useI18n();

const branchIndex = computed(() => {
  const list = props.branches ?? [];
  return list.findIndex((n) => n.id === props.node.id);
});

const editing = ref(false);
const draft = ref("");

function startEdit(): void {
  draft.value = props.node.content;
  editing.value = true;
}

function submitEdit(): void {
  const value = draft.value.trim();
  if (!value) return;
  editing.value = false;
  emit("edit", props.node.id, value);
}

function switchBranch(delta: number): void {
  const list = props.branches ?? [];
  const next = list[branchIndex.value + delta];
  if (next) emit("branch", next.id);
}
</script>

<template>
  <div class="msg user">
    <div v-if="editing" class="edit-box">
      <textarea v-model="draft" class="edit-input" rows="3" @keydown.esc="editing = false" />
      <div class="edit-actions">
        <button class="edit-btn ghost" @click="editing = false">{{ i18n.t("common.cancel") }}</button>
        <button class="edit-btn primary" @click="submitEdit">{{ i18n.t("agent.send") }}</button>
      </div>
    </div>
    <div v-else class="bubble">
      <span class="bubble-text">{{ node.content }}</span>
      <button class="hover-btn" :aria-label="i18n.t('agent.edit')" @click="startEdit">
        <PencilSquareIcon class="w-[13px] h-[13px]" />
      </button>
    </div>
    <div v-if="(branches?.length ?? 0) > 1" class="branches">
      <button class="branch-btn" :disabled="branchIndex <= 0" @click="switchBranch(-1)">
        <ChevronLeftIcon class="w-[13px] h-[13px]" />
      </button>
      <span class="branch-label">{{ branchIndex + 1 }}/{{ branches?.length }}</span>
      <button
        class="branch-btn"
        :disabled="branchIndex >= (branches?.length ?? 1) - 1"
        @click="switchBranch(1)"
      >
        <ChevronRightIcon class="w-[13px] h-[13px]" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg.user {
  align-items: flex-end;
}
.bubble {
  position: relative;
  max-width: 88%;
  padding: 9px 13px;
  border-radius: 16px 16px 4px 16px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.hover-btn {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 22px;
  height: 22px;
  display: none;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.bubble:hover .hover-btn {
  display: inline-flex;
}
.edit-box {
  width: 88%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.edit-input {
  width: 100%;
  resize: vertical;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid rgb(var(--md-primary));
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.edit-btn {
  min-width: 64px;
  height: 26px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.1px;
  cursor: pointer;
  transition: background-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.edit-btn.ghost {
  background-color: transparent;
  color: rgb(var(--md-on-surface-variant));
}
.edit-btn.ghost:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
}
.edit-btn.primary {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.edit-btn.primary:hover {
  box-shadow: 0 2px 8px rgb(var(--md-primary) / 0.28);
}
.edit-btn:active {
  transform: scale(0.96);
}
.branches {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 2px;
}
.branch-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.branch-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.branch-label {
  font-size: 11px;
  color: rgb(var(--md-on-surface-muted));
  font-variant-numeric: tabular-nums;
}
</style>
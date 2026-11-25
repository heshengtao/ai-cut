<script setup lang="ts">
/** 全局 AI 任务浮层：从右键菜单直接触发的长任务在这里显示进度与取消。 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { XMarkIcon } from "@heroicons/vue/24/outline";
import Md3LoadingIndicator from "@/components/common/Md3LoadingIndicator.vue";
import { useAiTasksStore, type AiTaskEntry } from "@/stores/aiTasks";
import { useI18n } from "@/i18n";

const tasks = useAiTasksStore();
const i18n = useI18n();

const now = ref(Date.now());
const cancelling = ref<string[]>([]);
let timer: number | null = null;

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
});

const visible = computed(() => tasks.tasks);

function elapsed(startedAt: number): string {
  const total = Math.max(0, Math.floor((now.value - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

function cancel(task: AiTaskEntry): void {
  if (!task.cancel || cancelling.value.includes(task.id)) return;
  cancelling.value = [...cancelling.value, task.id];
  try {
    task.cancel();
  } catch {
    // 取消命令失败时保留任务条：后端结束事件仍会把它清掉。
    cancelling.value = cancelling.value.filter((id) => id !== task.id);
  }
}
</script>

<template>
  <div v-if="visible.length > 0" class="ai-task-hud" aria-live="polite">
    <transition-group name="hud-item">
      <div v-for="task in visible" :key="task.id" class="ai-task">
        <Md3LoadingIndicator size="sm" :label="task.label" />
        <span class="task-label">{{ task.label }}</span>
        <span class="task-time tabular">{{ elapsed(task.startedAt) }}</span>
        <button
          v-if="task.cancel"
          v-ripple="{ centered: true }"
          class="task-cancel"
          type="button"
          :aria-label="i18n.t('common.cancel')"
          :title="i18n.t('common.cancel')"
          :disabled="cancelling.includes(task.id)"
          @click="cancel(task)"
        >
          <XMarkIcon class="cancel-icon" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.ai-task-hud {
  position: fixed;
  left: 18px;
  bottom: 18px;
  z-index: 210;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.ai-task {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 210px;
  max-width: 350px;
  padding: 8px 10px 8px 10px;
  border-radius: 18px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
  box-shadow: var(--md-elevation-3), 0 0 0 1px rgb(var(--md-outline-variant) / 0.25);
  font-size: 12px;
}
.hud-item-enter-active {
  transition:
    opacity var(--md-dur-effects-default) var(--md-spring-effects-default),
    transform var(--md-dur-spatial-default) var(--md-spring-spatial-fast);
}
.hud-item-leave-active {
  transition:
    opacity var(--md-dur-effects-fast) var(--md-spring-effects-fast),
    transform var(--md-dur-effects-fast) var(--md-spring-effects-fast);
}
.hud-item-enter-from {
  opacity: 0;
  transform: translateY(14px) scale(0.92);
}
.hud-item-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.96);
}
.task-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-time {
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-muted));
  font-size: 11px;
}
.task-cancel {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: rgb(var(--md-on-surface-muted));
  cursor: pointer;
}
.task-cancel:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha, 0.08));
  color: rgb(var(--md-on-surface));
}
.task-cancel:disabled {
  opacity: 0.4;
  cursor: default;
}
.cancel-icon {
  width: 13px;
  height: 13px;
}
</style>

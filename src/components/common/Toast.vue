<script setup lang="ts">
/** Toast 渲染层：右下角堆叠，MD3 风格；可带一个操作按钮。 */
import { dismiss, useToastItems, type ToastItem } from "@/composables/useToast";

const items = useToastItems();

function runAction(item: ToastItem): void {
  item.action?.run();
  dismiss(item.id);
}
</script>

<template>
  <div class="toast-layer" aria-live="polite">
    <transition-group name="toast">
      <div
        v-for="item in items"
        :key="item.id"
        class="toast"
        :class="item.tone"
        role="status"
        @click="dismiss(item.id)"
      >
        <span class="toast-message">{{ item.message }}</span>
        <button v-if="item.action" class="toast-action" @click.stop="runAction(item)">
          {{ item.action.label }}
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-layer {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 380px;
  padding: 11px 15px;
  border-radius: 14px;
  text-align: left;
  font-size: 12.5px;
  line-height: 1.45;
  cursor: pointer;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface));
  box-shadow: var(--md-elevation-3);
}
.toast.error {
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
}
.toast-message {
  flex: 1;
  min-width: 0;
}
.toast-action {
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.toast-action:hover {
  box-shadow: var(--md-elevation-1);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.24s cubic-bezier(0.34, 1.42, 0.5, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}
</style>

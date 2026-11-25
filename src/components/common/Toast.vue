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
  /* 弹窗（300 / 420）里触发的提示也要看得见，所以放在确认框之上。 */
  z-index: 480;
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
  padding: 11px 16px;
  border-radius: 16px;
  text-align: left;
  font-size: 12.5px;
  line-height: 1.45;
  cursor: pointer;
  background-color: rgb(var(--md-inverse-surface));
  color: rgb(var(--md-inverse-on-surface));
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
  padding: 5px 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-inverse-primary));
  font: inherit;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--md-dur-effects-fast) var(--md-spring-effects-fast),
    transform var(--md-dur-spatial-fast) var(--md-spring-spatial-bouncy);
}
.toast-action:hover {
  background-color: rgb(var(--md-inverse-primary) / 0.14);
}
.toast-action:active {
  transform: scale(0.95);
}
.toast.error .toast-action {
  background-color: rgb(var(--md-error));
  color: rgb(var(--md-on-error));
}
.toast-enter-active {
  transition:
    opacity var(--md-dur-effects-default) var(--md-spring-effects-default),
    transform var(--md-dur-spatial-default) var(--md-spring-spatial-fast);
}
.toast-leave-active {
  transition:
    opacity var(--md-dur-effects-fast) var(--md-spring-effects-fast),
    transform var(--md-dur-effects-fast) var(--md-spring-effects-fast);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(18px) scale(0.92);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-action {
    transition: none;
  }
}
</style>

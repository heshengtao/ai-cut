<script setup lang="ts">
/** Toast 渲染层：右下角堆叠，MD3 风格。 */
import { dismiss, useToastItems } from "@/composables/useToast";

const items = useToastItems();
</script>

<template>
  <div class="toast-layer" aria-live="polite">
    <transition-group name="toast">
      <button
        v-for="item in items"
        :key="item.id"
        class="toast"
        :class="item.tone"
        @click="dismiss(item.id)"
      >
        {{ item.message }}
      </button>
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
  max-width: 320px;
  padding: 11px 15px;
  border: 0;
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

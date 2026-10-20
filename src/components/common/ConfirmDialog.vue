<script setup lang="ts">
/** MD3 确认框渲染层：遮罩 + 对话框，替代原生 confirm。 */
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { answerConfirm, currentConfirm } from "@/composables/useConfirm";

const confirmButton = ref<HTMLButtonElement | null>(null);

watch(currentConfirm, async (request) => {
  if (!request) return;
  await nextTick();
  confirmButton.value?.focus();
});

function onKeyDown(event: KeyboardEvent): void {
  const request = currentConfirm.value;
  if (!request) return;
  // 确认框打开时吞掉所有按键，避免快捷键同时生效。
  event.stopImmediatePropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    answerConfirm(false);
  } else if (event.key === "Enter") {
    event.preventDefault();
    answerConfirm(true);
  }
}

onMounted(() => window.addEventListener("keydown", onKeyDown, true));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, true));
</script>

<template>
  <Teleport to="body">
    <transition name="dialog">
      <div v-if="currentConfirm" class="scrim" @pointerdown.self="answerConfirm(false)">
        <div
          class="dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="'confirm-title'"
        >
          <h2 id="confirm-title" class="dialog-title">{{ currentConfirm.title }}</h2>
          <p v-if="currentConfirm.message" class="dialog-message">
            {{ currentConfirm.message }}
          </p>
          <div class="dialog-actions">
            <button class="btn-text" @click="answerConfirm(false)">
              {{ currentConfirm.cancelText }}
            </button>
            <button
              ref="confirmButton"
              class="btn-filled"
              :class="{ destructive: currentConfirm.destructive }"
              @click="answerConfirm(true)"
            >
              {{ currentConfirm.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(0 0 0 / 0.32);
}
.dialog {
  width: min(400px, 100%);
  padding: 24px;
  border-radius: 28px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  box-shadow: var(--md-elevation-3);
}
.dialog-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0.1px;
}
.dialog-message {
  margin: 14px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: rgb(var(--md-on-surface-variant));
  overflow-wrap: anywhere;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
.dialog-actions button {
  min-height: 40px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-text {
  background: transparent;
  color: rgb(var(--md-primary));
}
.btn-text:hover {
  background-color: rgb(var(--md-primary) / var(--md-state-hover-alpha));
}
.btn-filled {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.btn-filled:hover {
  box-shadow: var(--md-elevation-1);
}
.btn-filled.destructive {
  background-color: rgb(var(--md-error));
  color: rgb(var(--md-on-error));
}
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.16s ease;
}
.dialog-enter-active .dialog,
.dialog-leave-active .dialog {
  transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1);
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
.dialog-enter-from .dialog,
.dialog-leave-to .dialog {
  transform: scale(0.92);
}
</style>

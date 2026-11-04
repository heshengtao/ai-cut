<script setup lang="ts">
/**
 * MD3 对话框外壳：遮罩 + 容器 + 焦点回归。
 *
 * 项目里原本每个对话框（`ExportModal`、`CutSettingsDialog`）各写一份 scrim + Teleport，
 * 这次要新增「准备运行环境」向导，就顺手把外壳抽出来，别再多抄一份。
 *
 * 行为：
 * - `open` 打开时把焦点移到第一个可聚焦元素（默认是底部主按钮）；
 * - `dismissible` 为 `false` 时没有关闭按钮、Esc 与点遮罩都无效（首次引导用）；
 * - 关闭后把焦点还给打开前的那个元素，键盘用户不会掉到页面顶上。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** 内容区宽度；内容多时用 `520px`。 */
    width?: string;
    dismissible?: boolean;
  }>(),
  { width: "440px", dismissible: true },
);

const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();

const dialog = ref<HTMLElement | null>(null);
let previous: HTMLElement | null = null;

function close(): void {
  if (!props.dismissible) return;
  emit("update:open", false);
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.open) return;
  // 打开时吞掉全局快捷键：`space` 在这里是「按下按钮」，不该同时触发播放 / 暂停。
  event.stopImmediatePropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      const target =
        dialog.value?.querySelector<HTMLElement>("[data-autofocus]") ??
        dialog.value?.querySelector<HTMLElement>("button, [href], input, select, textarea") ??
        null;
      target?.focus();
    } else {
      previous?.focus();
      previous = null;
    }
  },
  { immediate: true },
);

onMounted(() => window.addEventListener("keydown", onKeyDown, true));
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, true));
</script>

<template>
  <Teleport to="body">
    <transition name="modal">
      <div v-if="open" class="scrim" @pointerdown.self="close">
        <div
          ref="dialog"
          class="dialog"
          role="dialog"
          aria-modal="true"
          :style="{ width: `min(${width}, calc(100vw - 48px))` }"
        >
          <header class="head">
            <h2 class="title">{{ title }}</h2>
            <button
              v-if="dismissible"
              class="icon-btn"
              type="button"
              aria-label="关闭"
              @click="close"
            >
              <svg viewBox="0 0 20 20" class="icon" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </header>

          <div class="body">
            <slot />
          </div>

          <footer v-if="$slots.foot" class="foot">
            <slot name="foot" />
          </footer>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 420;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: rgb(0 0 0 / 0.32);
}
.dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  padding: 22px 24px 18px;
  border-radius: 28px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  box-shadow: var(--md-elevation-3);
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.title {
  flex: 1;
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.35;
}
.icon-btn {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  margin: -4px -6px 0 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.icon-btn:hover {
  background-color: rgb(var(--md-on-surface) / 0.08);
}
.icon {
  width: 16px;
  height: 16px;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  margin-top: 14px;
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.16s ease;
}
.modal-enter-active .dialog,
.modal-leave-active .dialog {
  transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1);
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .dialog,
.modal-leave-to .dialog {
  transform: scale(0.94);
}
</style>

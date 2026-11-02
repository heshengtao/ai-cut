<script setup lang="ts">
/** 下载管理器右上角的「导入插件」按钮：文件和 .ofx.bundle 两个入口。 */
import { onMounted, onUnmounted, ref } from "vue";
import {
  ArrowUpTrayIcon,
  ChevronDownIcon,
  DocumentArrowUpIcon,
  FolderOpenIcon,
} from "@heroicons/vue/24/outline";
import { usePluginsStore } from "@/stores/plugins";
import { useI18n } from "@/i18n";
import { toast } from "@/composables/useToast";

const plugins = usePluginsStore();
const i18n = useI18n();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle(): void {
  if (plugins.importing) return;
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

async function runImport(mode: "file" | "bundle"): Promise<void> {
  close();
  const ok =
    mode === "file" ? await plugins.importFile() : await plugins.importBundle();
  if (ok) toast(i18n.t("plugins.manager.imported"));
}

function onDocPointer(event: PointerEvent): void {
  if (!open.value) return;
  const target = event.target as Node;
  if (root.value?.contains(target)) return;
  close();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    event.stopPropagation();
    close();
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", onDocPointer, true);
  window.addEventListener("keydown", onKey);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", onDocPointer, true);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="import-wrap">
    <button
      class="import-btn"
      type="button"
      :disabled="plugins.importing"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <ArrowUpTrayIcon class="import-icon" />
      {{ i18n.t("plugins.manager.import") }}
      <ChevronDownIcon class="import-caret" />
    </button>
    <div v-if="open" class="import-menu" role="menu">
      <button class="import-item" type="button" role="menuitem" @click="runImport('file')">
        <DocumentArrowUpIcon class="import-item-icon" />
        <span class="import-item-text">
          <span class="import-item-title">{{ i18n.t("plugins.manager.importFile") }}</span>
          <span class="import-item-hint">{{ i18n.t("plugins.manager.importFileHint") }}</span>
        </span>
      </button>
      <button class="import-item" type="button" role="menuitem" @click="runImport('bundle')">
        <FolderOpenIcon class="import-item-icon" />
        <span class="import-item-text">
          <span class="import-item-title">{{ i18n.t("plugins.manager.importBundle") }}</span>
          <span class="import-item-hint">{{ i18n.t("plugins.manager.importBundleHint") }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.import-wrap {
  position: relative;
  flex: 0 0 auto;
}
.import-btn {
  height: 30px;
  padding: 0 12px 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.import-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}
.import-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.import-icon {
  width: 15px;
  height: 15px;
}
.import-caret {
  width: 12px;
  height: 12px;
  opacity: 0.8;
}
.import-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: 220px;
  padding: 4px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.import-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px 9px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
}
.import-item:hover {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.import-item-icon {
  width: 15px;
  height: 15px;
  margin-top: 1px;
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
}
.import-item-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.import-item-title {
  font-size: 12px;
  font-weight: 500;
}
.import-item-hint {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
</style>

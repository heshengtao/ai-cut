<script setup lang="ts">
/**
 * 画布插件（第三方扩展）面板。
 *
 * 与 `PluginsPane`（OFX 原生插件）分开：这里是「可执行客户端半的插件」，
 * 能往画布加节点、加命令、加文案。v1 只支持从本地目录导入（私有插件 / 开发者）。
 */
import { computed, onMounted, ref } from "vue";
import {
  ExclamationTriangleIcon,
  FolderOpenIcon,
  PuzzlePieceIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { usePluginHostStore } from "@/stores/pluginHost";
import { importPluginModule } from "@/core/plugins/importer";
import { useI18n } from "@/i18n";

const host = usePluginHostStore();
const i18n = useI18n();
const busy = ref<string | null>(null);
const notice = ref<string | null>(null);

const entries = computed(() => host.plugins);

async function importFolder(): Promise<void> {
  notice.value = null;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string" || !picked) return;
    busy.value = "install";
    await host.installLocal(picked, importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function toggle(id: string, enabled: boolean): Promise<void> {
  busy.value = id;
  notice.value = null;
  try {
    await host.setEnabled(id, enabled);
    if (enabled) await host.loadEnabled(importPluginModule);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

async function remove(id: string, name: string): Promise<void> {
  if (!window.confirm(i18n.t("extensions.confirmRemove", { name }))) return;
  busy.value = id;
  try {
    await host.remove(id);
  } catch (error) {
    notice.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = null;
  }
}

onMounted(() => {
  void host.refresh();
});
</script>

<template>
  <section class="extensions">
    <header class="head">
      <div>
        <div class="title">{{ i18n.t("extensions.title") }}</div>
        <div class="sub">{{ i18n.t("extensions.subtitle") }}</div>
      </div>
      <button class="install" type="button" :disabled="busy !== null" @click="importFolder">
        <FolderOpenIcon class="w-4 h-4" />
        <span>{{ i18n.t("extensions.install") }}</span>
      </button>
    </header>

    <p v-if="notice" class="notice">
      <ExclamationTriangleIcon class="w-4 h-4" />
      <span>{{ notice }}</span>
    </p>

    <p v-if="host.loading" class="hint">{{ i18n.t("extensions.loading") }}</p>
    <p v-else-if="entries.length === 0" class="empty">
      <PuzzlePieceIcon class="w-6 h-6" />
      <span>{{ i18n.t("extensions.empty") }}</span>
    </p>

    <ul v-else class="list">
      <li v-for="entry in entries" :key="entry.id" class="item">
        <div class="item-main">
          <div class="item-title">
            <span class="id">{{ entry.id }}</span>
            <span class="version">v{{ entry.version }}</span>
            <span v-if="!entry.compatible" class="badge warn">
              {{ i18n.t("extensions.incompatible") }}
            </span>
          </div>
          <div class="item-sub">{{ entry.dir }}</div>
          <div v-if="entry.lastError" class="error">{{ entry.lastError }}</div>
        </div>
        <div class="item-actions">
          <button
            type="button"
            class="ghost"
            :disabled="busy === entry.id || !entry.compatible"
            @click="toggle(entry.id, !entry.enabled)"
          >
            {{ entry.enabled ? i18n.t("extensions.disable") : i18n.t("extensions.enable") }}
          </button>
          <button
            type="button"
            class="ghost danger"
            :disabled="busy === entry.id"
            @click="remove(entry.id, entry.id)"
          >
            <TrashIcon class="w-4 h-4" />
          </button>
        </div>
      </li>
    </ul>

    <ul v-if="host.failed.length > 0" class="failures">
      <li v-for="line in host.failed" :key="line">{{ line }}</li>
    </ul>
  </section>
</template>

<style scoped>
.extensions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
  height: 100%;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.sub {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  margin-top: 2px;
}
.install {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--md-sys-color-on-primary-container);
  background: var(--md-sys-color-primary-container);
}
.notice,
.empty {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.notice {
  color: var(--md-sys-color-error);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container);
}
.item-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.id {
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.version {
  color: var(--md-sys-color-on-surface-variant);
}
.badge.warn {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--md-sys-color-on-error-container);
  background: var(--md-sys-color-error-container);
}
.item-sub {
  font-size: 10px;
  color: var(--md-sys-color-on-surface-variant);
  word-break: break-all;
}
.error {
  font-size: 11px;
  color: var(--md-sys-color-error);
  margin-top: 2px;
}
.item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ghost {
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 11px;
  color: var(--md-sys-color-on-surface);
  background: transparent;
}
.ghost.danger {
  color: var(--md-sys-color-error);
}
.failures {
  font-size: 11px;
  color: var(--md-sys-color-error);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hint {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
</style>

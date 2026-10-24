<script setup lang="ts">
/** 单个 OFX 插件卡片：管理模式下安装/更新/外链/定位/删除；使用模式下只打开界面。 */
import { computed, ref } from "vue";
import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  FolderOpenIcon,
  TrashIcon,
} from "@heroicons/vue/24/outline";
import { usePluginsStore } from "@/stores/plugins";
import { useI18n } from "@/i18n";
import { humanSize } from "@/utils/size";
import type { PluginStatus } from "@/types/plugins";

const props = defineProps<{
  plugin: PluginStatus;
  compact?: boolean;
  mode?: "manage" | "use";
}>();

const emit = defineEmits<{ use: [slug: string] }>();

const plugins = usePluginsStore();
const i18n = useI18n();
const confirming = ref(false);
const mode = computed(() => props.mode ?? "manage");

const busy = computed(() => plugins.isBusy(props.plugin.slug));
const pct = computed(() => (busy.value ? plugins.progressPct : null));
const installable = computed(
  () => props.plugin.compatible && props.plugin.install_kind === "archive",
);
const sizeLabel = computed(() =>
  props.plugin.download_size ? humanSize(props.plugin.download_size) : "",
);
const installLabel = computed(() =>
  props.plugin.update_available
    ? i18n.t("plugins.update", { version: props.plugin.version })
    : sizeLabel.value
      ? i18n.t("plugins.install", { size: sizeLabel.value })
      : i18n.t("plugins.installNoSize"),
);
const typeLabels = computed(() =>
  props.plugin.plugin_types.map((type) => {
    const key = `plugins.type.${type}`;
    const label = i18n.t(key);
    return label === key ? type : label;
  }),
);
const systemLabels = computed(() => {
  const systems = new Set<string>();
  for (const file of props.plugin.files) {
    for (const system of file.systems) systems.add(system);
  }
  if (systems.size === 0) return [];
  return [...systems].map((system) => {
    const key = `plugins.system.${system}`;
    const label = i18n.t(key);
    return label === key ? system : label;
  });
});
const phaseLabel = computed(() => {
  const phase = plugins.progress?.phase;
  if (!phase) return "";
  const key = `plugins.phase.${phase}`;
  const label = i18n.t(key);
  return label === key ? phase : label;
});
const gplUpstream = computed(
  () =>
    props.plugin.install_kind === "archive" &&
    /^(A?GPL)-/.test(props.plugin.license),
);

function install(): void {
  void plugins.install(props.plugin.slug);
}

function remove(): void {
  confirming.value = false;
  void plugins.remove(props.plugin.slug);
}

function openInterface(): void {
  emit("use", props.plugin.slug);
}
</script>

<template>
  <li class="card" :class="{ busy, compact }">
    <div class="card-top">
      <span class="card-name">{{ plugin.name }}</span>
      <span v-if="plugin.vendor" class="badge">{{ plugin.vendor }}</span>
      <span class="badge">v{{ plugin.version }}</span>
      <span v-if="plugin.installed" class="badge ok">
        {{ i18n.t("plugins.installed") }}
      </span>
      <span v-if="mode === 'manage' && plugin.update_available" class="badge warn">
        {{ i18n.t("plugins.updateAvailable") }}
      </span>
      <span v-if="plugin.external" class="badge">
        {{ i18n.t("plugins.externalPlugin") }}
      </span>
      <span v-if="mode === 'manage' && !plugin.compatible" class="badge warn">
        {{ i18n.t("plugins.incompatible") }}
      </span>
      <span v-if="mode === 'manage' && gplUpstream" class="badge warn">
        {{ i18n.t("plugins.gplUpstream") }}
      </span>
    </div>

    <p class="card-meta">
      <span>{{ i18n.t("plugins.license") }} {{ plugin.license }}</span>
      <span v-if="sizeLabel"> · {{ sizeLabel }}</span>
      <span v-if="typeLabels.length"> · {{ typeLabels.join(" / ") }}</span>
      <span v-if="systemLabels.length && mode === 'manage'">
        · {{ systemLabels.join(" / ") }}
      </span>
    </p>

    <p v-if="!compact && plugin.description" class="card-desc">
      {{ plugin.description }}
    </p>
    <p
      v-if="mode === 'manage' && !plugin.compatible && plugin.incompatible_reason"
      class="card-warn"
    >
      {{ plugin.incompatible_reason }}
    </p>

    <div class="card-actions">
      <template v-if="mode === 'use'">
        <button class="mini-btn primary" @click="openInterface">
          <AdjustmentsHorizontalIcon class="btn-icon" />
          {{ i18n.t("plugins.openInterface") }}
        </button>
      </template>

      <template v-else-if="busy">
        <button class="mini-btn danger" @click="plugins.cancel()">
          {{ i18n.t("plugins.cancel") }}
        </button>
      </template>

      <template v-else-if="plugin.installed">
        <button class="mini-btn" @click="plugins.reveal(plugin.slug)">
          <FolderOpenIcon class="btn-icon" />
          {{ i18n.t("plugins.reveal") }}
        </button>
        <button
          v-if="plugin.update_available && installable"
          class="mini-btn primary"
          :disabled="plugins.busySlug !== null"
          @click="install"
        >
          <ArrowDownTrayIcon class="btn-icon" />
          {{ installLabel }}
        </button>
        <template v-if="plugin.managed">
          <button
            v-if="!confirming"
            class="mini-btn danger"
            :disabled="plugins.busySlug !== null"
            @click="confirming = true"
          >
            <TrashIcon class="btn-icon" />
            {{ i18n.t("plugins.remove") }}
          </button>
          <template v-else>
            <button class="mini-btn danger" @click="remove">
              {{ i18n.t("plugins.confirmRemove") }}
            </button>
            <button class="mini-btn" @click="confirming = false">
              {{ i18n.t("common.cancel") }}
            </button>
          </template>
        </template>
      </template>

      <template v-else-if="installable">
        <button
          class="mini-btn primary"
          :disabled="plugins.busySlug !== null"
          @click="install"
        >
          <ArrowDownTrayIcon class="btn-icon" />
          {{ installLabel }}
        </button>
      </template>

      <template v-else-if="plugin.install_kind === 'external'">
        <button class="mini-btn" @click="plugins.open(plugin.slug)">
          <ArrowTopRightOnSquareIcon class="btn-icon" />
          {{ i18n.t("plugins.openPage") }}
        </button>
      </template>

      <template v-else>
        <button class="mini-btn" disabled>
          {{ i18n.t("plugins.incompatible") }}
        </button>
      </template>
    </div>

    <p v-if="mode === 'manage' && busy" class="card-phase">
      {{ i18n.t("plugins.downloadingFrom", { phase: phaseLabel }) }}
    </p>
    <div v-if="mode === 'manage' && busy" class="progress">
      <div
        class="progress-fill"
        :class="{ indeterminate: pct === null }"
        :style="pct === null ? undefined : { width: `${pct}%` }"
      />
    </div>
  </li>
</template>

<style scoped>
.card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border-radius: 14px;
  background-color: var(--app-inset);
}
.card.compact {
  padding: 10px 12px;
}
.card-top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.card-name {
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--md-on-surface));
}
.badge {
  padding: 1px 7px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
  color: rgb(var(--md-on-surface-variant));
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.badge.ok {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.badge.warn {
  background-color: rgb(var(--md-error) / 0.12);
  color: rgb(var(--md-error));
}
.card-meta {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.card-desc {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: rgb(var(--md-on-surface-muted));
}
.card-warn {
  margin: 1px 0 0;
  font-size: 10.5px;
  color: rgb(var(--md-error));
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}
.btn-icon {
  width: 13px;
  height: 13px;
}
.mini-btn {
  height: 27px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgb(var(--md-outline-variant) / 0.7);
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.mini-btn:hover:not(:disabled) {
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.mini-btn.primary {
  border-color: transparent;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.mini-btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.mini-btn.danger {
  border-color: transparent;
  background-color: rgb(var(--md-error) / 0.14);
  color: rgb(var(--md-error));
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.card-phase {
  margin: 2px 0 0;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background-color: rgb(var(--md-primary) / 0.15);
}
.progress-fill {
  height: 100%;
  width: 0;
  background-color: rgb(var(--md-primary));
  transition: width 120ms linear;
}
.progress-fill.indeterminate {
  width: 35%;
  animation: indeterminate 1.1s ease-in-out infinite;
}
@keyframes indeterminate {
  0% {
    margin-left: -35%;
  }
  100% {
    margin-left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .progress-fill.indeterminate {
    animation: none;
  }
}
</style>

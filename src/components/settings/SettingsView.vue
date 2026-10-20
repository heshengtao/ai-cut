<script setup lang="ts">
/**
 * 设置页：自带一条侧栏 + 居中内容列，视觉与 ai-daw 一致。
 * 应用内全屏页（layout.settingsOpen），不引入路由。
 */
import { computed, ref } from "vue";
import { ArrowLeftIcon } from "@heroicons/vue/24/outline";
import NumberField from "@/components/common/NumberField.vue";
import {
  ACCENTS,
  accent,
  setAccent,
  themeMode,
  setTheme,
  type AccentColor,
  type ThemeMode,
} from "@/composables/useTheme";
import {
  MAX_PANEL_WIDTH,
  MAX_TIMELINE_HEIGHT,
  MIN_PANEL_WIDTH,
  MIN_TIMELINE_HEIGHT,
  useLayoutStore,
} from "@/stores/layout";
import { useProjectStore } from "@/stores/project";
import { displayProjectName } from "@/utils/projectName";
import { useI18n } from "@/i18n";

type Section = "general" | "appearance" | "layout" | "about";

const SECTIONS: { id: Section; labelKey: string; captionKey: string }[] = [
  { id: "general", labelKey: "settings.section.general", captionKey: "settings.section.general.caption" },
  {
    id: "appearance",
    labelKey: "settings.section.appearance",
    captionKey: "settings.section.appearance.caption",
  },
  { id: "layout", labelKey: "settings.section.layout", captionKey: "settings.section.layout.caption" },
  { id: "about", labelKey: "settings.section.about", captionKey: "settings.section.about.caption" },
];

const THEMES: { id: ThemeMode; labelKey: string }[] = [
  { id: "light", labelKey: "settings.theme.light" },
  { id: "dark", labelKey: "settings.theme.dark" },
  { id: "system", labelKey: "settings.theme.system" },
];

const APP_VERSION = "0.1.0";

const i18n = useI18n();
const layout = useLayoutStore();
const project = useProjectStore();

const active = ref<Section>("general");
const activeMeta = computed(() => SECTIONS.find((s) => s.id === active.value) ?? SECTIONS[0]);
const projectName = computed(() => displayProjectName(project.doc.name));

function onTheme(id: ThemeMode): void {
  setTheme(id);
}

function onAccent(id: AccentColor): void {
  setAccent(id);
}

function back(): void {
  layout.closeSettings();
}
</script>

<template>
  <div class="settings">
    <!-- 设置自带的侧栏 -->
    <aside class="settings-nav">
      <button class="back" @click="back">
        <ArrowLeftIcon class="back-icon" />
        <span class="back-label">{{ i18n.t("settings.back") }}</span>
      </button>

      <nav class="nav-list" :aria-label="i18n.t('settings.navAria')">
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          class="nav-item"
          :class="{ on: active === s.id }"
          :aria-current="active === s.id ? 'page' : undefined"
          @click="active = s.id"
        >
          <span class="nav-ind" />
          <span class="nav-text">
            <span class="nav-label">{{ i18n.t(s.labelKey) }}</span>
            <span class="nav-caption">{{ i18n.t(s.captionKey) }}</span>
          </span>
        </button>
      </nav>
    </aside>

    <!-- 内容：居中列 -->
    <section class="settings-body">
      <div class="settings-content">
        <h1 class="page-title">{{ i18n.t(activeMeta.labelKey) }}</h1>
        <p class="page-sub">{{ i18n.t(activeMeta.captionKey) }}</p>

        <!-- 通用 -->
        <template v-if="active === 'general'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.language") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.language.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.language.hint") }}</span>
                </div>
                <div class="m3-seg" role="group" :aria-label="i18n.t('settings.language.label')">
                  <button
                    v-for="l in i18n.locales"
                    :key="l.id"
                    class="m3-seg-btn"
                    :class="{ on: i18n.locale.value === l.id }"
                    :aria-pressed="i18n.locale.value === l.id"
                    @click="i18n.setLocale(l.id)"
                  >
                    {{ l.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.project") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.project.current") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.project.currentHint") }}</span>
                </div>
                <span class="row-value">{{ projectName }}</span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("export.resolution") }}</span>
                  <span class="row-sub">{{ project.doc.fps }} fps</span>
                </div>
                <span class="row-value tabular">
                  {{ project.doc.width }} × {{ project.doc.height }}
                </span>
              </div>
            </div>
          </div>
        </template>

        <!-- 外观 -->
        <template v-else-if="active === 'appearance'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.theme") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.theme.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.theme.hint") }}</span>
                </div>
                <div class="m3-seg" role="group" :aria-label="i18n.t('settings.theme.label')">
                  <button
                    v-for="t in THEMES"
                    :key="t.id"
                    class="m3-seg-btn"
                    :class="{ on: themeMode === t.id }"
                    :aria-pressed="themeMode === t.id"
                    @click="onTheme(t.id)"
                  >
                    {{ i18n.t(t.labelKey) }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.accent") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.accent.label") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.accent.hint") }}</span>
                </div>
                <div class="swatches" role="group" :aria-label="i18n.t('settings.accent.label')">
                  <button
                    v-for="a in ACCENTS"
                    :key="a.id"
                    class="swatch"
                    :class="{ on: accent === a.id }"
                    :style="{ backgroundColor: a.swatch }"
                    :aria-label="i18n.t(a.labelKey)"
                    :aria-pressed="accent === a.id"
                    @click="onAccent(a.id)"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="active === 'layout'">
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.panels") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.panels.tracks") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.panels.tracksHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: layout.showTimeline }"
                  role="switch"
                  :aria-checked="layout.showTimeline"
                  :aria-label="i18n.t('settings.panels.tracks')"
                  @click="layout.showTimeline = !layout.showTimeline"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.panels.inspector") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.panels.inspectorHint") }}</span>
                </div>
                <button
                  class="m3-switch"
                  :class="{ on: layout.showPanel }"
                  role="switch"
                  :aria-checked="layout.showPanel"
                  :aria-label="i18n.t('settings.panels.inspector')"
                  @click="layout.showPanel = !layout.showPanel"
                />
              </div>
            </div>
          </div>

          <div class="group">
            <div class="group-title">{{ i18n.t("settings.width") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.width.tracks") }}</span>
                </div>
                <NumberField
                  v-model="layout.timelineHeight"
                  :min="MIN_TIMELINE_HEIGHT"
                  :max="MAX_TIMELINE_HEIGHT"
                  :step="10"
                  :sr-label="i18n.t('settings.width.tracks')"
                  input-width="40px"
                />
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.width.inspector") }}</span>
                </div>
                <NumberField
                  v-model="layout.panelWidth"
                  :min="MIN_PANEL_WIDTH"
                  :max="MAX_PANEL_WIDTH"
                  :step="10"
                  :sr-label="i18n.t('settings.width.inspector')"
                  input-width="40px"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- 关于 -->
        <template v-else>
          <div class="group">
            <div class="group-title">{{ i18n.t("settings.about.app") }}</div>
            <div class="card">
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.about.version") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.about.versionHint") }}</span>
                </div>
                <span class="row-value">v{{ APP_VERSION }}</span>
              </div>
              <div class="row">
                <div class="row-text">
                  <span class="row-title">{{ i18n.t("settings.about.engine") }}</span>
                  <span class="row-sub">{{ i18n.t("settings.about.engineHint") }}</span>
                </div>
                <span class="row-value">Tauri + ffmpeg</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  background-color: var(--app-bg);
}

/* ---- 设置侧栏 ---- */
.settings-nav {
  width: 220px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 14px;
  border-right: 1px solid rgb(var(--md-outline-variant) / 0.3);
  overflow-y: auto;
}
.back {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.back:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.back:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.back-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 6px 14px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  text-align: left;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}
.nav-item:hover {
  background-color: rgb(var(--md-on-surface-variant) / var(--md-state-hover-alpha));
  color: rgb(var(--md-on-surface));
}
.nav-item:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.nav-item.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.nav-ind {
  position: absolute;
  left: 4px;
  top: 50%;
  width: 3px;
  height: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  transform: translateY(-50%);
  opacity: 0;
  transition: height 0.16s ease, opacity 0.16s ease;
}
.nav-item.on .nav-ind {
  height: 20px;
  opacity: 1;
}
.nav-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.nav-label {
  font-size: 14px;
  font-weight: 500;
}
.nav-caption {
  font-size: 11px;
  opacity: 0.7;
}

/* ---- 内容 ---- */
.settings-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  display: flex;
  justify-content: center;
}
.settings-content {
  width: 100%;
  max-width: 720px;
  padding: 32px 32px 56px;
}
.page-title {
  margin: 0;
  font-size: 26px;
  line-height: 1.25;
  font-weight: 400;
  color: rgb(var(--md-on-surface));
}
.page-sub {
  margin: 4px 0 24px;
  font-size: 13px;
  color: rgb(var(--md-on-surface-variant));
}
.group + .group {
  margin-top: 22px;
}
.group-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: rgb(var(--md-primary));
  padding: 0 4px 8px;
}
.card {
  background-color: var(--app-inset);
  border-radius: 20px;
  padding: 4px 16px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 62px;
  padding: 10px 0;
}
.row + .row {
  border-top: 1px solid rgb(var(--md-outline-variant) / 0.3);
}
.row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.row-title {
  font-size: 14px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
}
.row-sub {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.row-value {
  font-size: 13px;
  color: rgb(var(--md-on-surface-variant));
  white-space: nowrap;
  flex: 0 0 auto;
}

/* ---- 分段按钮 ---- */
.m3-seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  flex: 0 0 auto;
}
.m3-seg-btn {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.m3-seg-btn:hover {
  color: rgb(var(--md-on-surface));
}
.m3-seg-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.m3-seg-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}

/* ---- 主题色 swatches ---- */
.swatches {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.swatch {
  position: relative;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: var(--md-elevation-1);
  transition: transform 0.16s ease;
}
.swatch:hover {
  transform: scale(1.08);
}
.swatch:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}
.swatch.on::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 999px;
  border: 2px solid rgb(var(--md-primary));
}

/* ---- 开关 ---- */
.m3-switch {
  width: 52px;
  height: 32px;
  flex: 0 0 auto;
  position: relative;
  border: 2px solid rgb(var(--md-outline));
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.16s ease, border-color 0.16s ease;
}
.m3-switch::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background-color: rgb(var(--md-outline));
  transform: translate(-50%, -50%);
  transition: left 0.16s ease, width 0.16s ease, height 0.16s ease, background-color 0.16s ease;
}
.m3-switch.on {
  background-color: rgb(var(--md-primary));
  border-color: rgb(var(--md-primary));
}
.m3-switch.on::after {
  left: 72%;
  width: 24px;
  height: 24px;
  background-color: rgb(var(--md-on-primary));
}
.m3-switch:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
}

@media (max-width: 820px) {
  .settings-nav {
    width: 76px;
    padding: 10px 8px;
  }
  .back-label,
  .nav-text {
    display: none;
  }
  .back,
  .nav-item {
    justify-content: center;
    padding: 0;
  }
  .settings-content {
    padding: 24px 18px 44px;
  }
  .row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .back,
  .nav-item,
  .nav-ind,
  .m3-seg-btn,
  .m3-switch,
  .m3-switch::after,
  .swatch {
    transition: none;
  }
}
</style>

/**
 * 布局偏好：右侧面板可见性与宽度、面板标签页、预览/时间线的分割高度。
 * 持久化到 localStorage，下次打开保持原样。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** 右侧面板可打开的窗口类型；后续新增面板只需在此登记。 */
export type PaneId = "media" | "inspector" | "agent" | "ai" | "models";

/** 设置页分区。 */
export type SettingsSection =
  | "general"
  | "appearance"
  | "layout"
  | "ai"
  | "tts"
  | "network"
  | "cli"
  | "about";

/** 预览画布比例。`project` 跟随工程分辨率。 */
export type PreviewAspect =
  | "project"
  | "16:9"
  | "1.85:1"
  | "2:1"
  | "2.35:1"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  | "1:2";

/** 预览画质（界面选项；低画质时关闭平滑缩放）。 */
export type PreviewQuality = "auto" | "high" | "medium" | "low";

/** 工作区布局：横屏 = 预览上 / 时间线下；竖屏 = 预览左 / 时间线右。 */
export type LayoutMode = "landscape" | "portrait";

const PREVIEW_ASPECTS: PreviewAspect[] = [
  "project",
  "16:9",
  "1.85:1",
  "2:1",
  "2.35:1",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "1:2",
];
const PREVIEW_QUALITIES: PreviewQuality[] = ["auto", "high", "medium", "low"];

/** 全部可用面板的元数据（供「新建标签」选择器展示）。 */
export const PANES: { id: PaneId; labelKey: string; hintKey: string }[] = [
  { id: "media", labelKey: "panel.media", hintKey: "panel.mediaHint" },
  { id: "inspector", labelKey: "panel.inspector", hintKey: "panel.inspectorHint" },
  { id: "agent", labelKey: "panel.agent", hintKey: "panel.agentHint" },
  { id: "ai", labelKey: "panel.ai", hintKey: "panel.aiHint" },
  { id: "models", labelKey: "panel.models", hintKey: "panel.modelsHint" },
];

/** 右侧面板宽度下限（px）：标签栏与属性行需要的最小呼吸空间。 */
export const MIN_PANEL_WIDTH = 280;
/** 右侧面板宽度上限（px）：再宽就挤掉预览区。 */
export const MAX_PANEL_WIDTH = 520;

/** 时间线高度范围（px）。 */
export const MIN_TIMELINE_HEIGHT = 180;
export const MAX_TIMELINE_HEIGHT = 520;

/** 竖屏模式预览宽度占比：左栏约占三分之一，可拖动。 */
export const MIN_PREVIEW_RATIO = 0.2;
export const MAX_PREVIEW_RATIO = 0.6;

interface Persisted {
  showPanel: boolean;
  showTimeline: boolean;
  panelWidth: number;
  tabs: PaneId[];
  activeTab: PaneId;
  timelineHeight: number;
  previewAspect: PreviewAspect;
  previewQuality: PreviewQuality;
  layoutMode: LayoutMode;
  previewRatio: number;
}

const KEY = "ai-cut-layout";

const VALID_PANES: PaneId[] = PANES.map((p) => p.id);

function load(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Persisted>;
  } catch {
    return {};
  }
}

function sanitizeTabs(value: unknown): PaneId[] {
  if (!Array.isArray(value)) return ["media", "inspector"];
  const tabs = value.filter((v): v is PaneId => VALID_PANES.includes(v as PaneId));
  return tabs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useLayoutStore = defineStore("layout", () => {
  const saved = load();

  const showPanel = ref(saved.showPanel ?? true);
  const showTimeline = ref(saved.showTimeline ?? true);
  const panelWidth = ref(clamp(saved.panelWidth ?? 360, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH));
  const tabs = ref<PaneId[]>(sanitizeTabs(saved.tabs));
  const activeTab = ref<PaneId>(
    saved.activeTab && VALID_PANES.includes(saved.activeTab)
      ? saved.activeTab
      : (tabs.value[0] ?? "media"),
  );
  const timelineHeight = ref(
    clamp(saved.timelineHeight ?? 300, MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT),
  );
  const previewAspect = ref<PreviewAspect>(
    saved.previewAspect && PREVIEW_ASPECTS.includes(saved.previewAspect)
      ? saved.previewAspect
      : "project",
  );
  const previewQuality = ref<PreviewQuality>(
    saved.previewQuality && PREVIEW_QUALITIES.includes(saved.previewQuality)
      ? saved.previewQuality
      : "auto",
  );
  const layoutMode = ref<LayoutMode>(
    saved.layoutMode === "portrait" ? "portrait" : "landscape",
  );
  const previewRatio = ref(
    clamp(saved.previewRatio ?? 0.34, MIN_PREVIEW_RATIO, MAX_PREVIEW_RATIO),
  );
  /** 全屏设置页是否开启（不持久化：下次启动回到工作区）。 */
  const settingsOpen = ref(false);
  /** 打开设置页时定位到哪个分区（不持久化）。 */
  const settingsSection = ref<SettingsSection | null>(null);

  const hasTabs = computed(() => tabs.value.length > 0);

  /** 打开（或切到）某个面板标签。 */
  function openTab(id: PaneId): void {
    if (!tabs.value.includes(id)) tabs.value.push(id);
    activeTab.value = id;
    showPanel.value = true;
  }

  /** 关闭标签：关掉当前标签时，优先落到右边那个，其次左边。 */
  function closeTab(id: PaneId): void {
    const index = tabs.value.indexOf(id);
    if (index < 0) return;
    tabs.value.splice(index, 1);
    if (activeTab.value === id) {
      activeTab.value = tabs.value[index] ?? tabs.value[index - 1] ?? "media";
    }
  }

  /** 拖拽右栏分隔线：右栏在分隔线右侧，往左拖变大（增量由 resizer 换算好）。 */
  function resizePanel(delta: number): void {
    panelWidth.value = clamp(panelWidth.value + delta, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
  }

  /** 拖拽时间线上边界：时间线在下方，往上拖变大。 */
  function resizeTimeline(delta: number): void {
    timelineHeight.value = clamp(
      timelineHeight.value + delta,
      MIN_TIMELINE_HEIGHT,
      MAX_TIMELINE_HEIGHT,
    );
  }

  /** 竖屏模式拖拽预览栏右边界：往右拖预览变宽。 */
  function resizePreview(delta: number): void {
    const width = typeof window === "undefined" ? 1440 : window.innerWidth;
    previewRatio.value = clamp(
      previewRatio.value + delta / Math.max(1, width),
      MIN_PREVIEW_RATIO,
      MAX_PREVIEW_RATIO,
    );
  }

  /** 切换横屏 / 竖屏布局。 */
  function setLayoutMode(mode: LayoutMode): void {
    layoutMode.value = mode;
  }

  /** 窗口尺寸变化后重新夹紧（窄窗口下别让面板吃掉整个画面）。 */
  function clampPanes(): void {
    const maxByWindow = Math.max(MIN_PANEL_WIDTH, Math.round(window.innerWidth * 0.55));
    panelWidth.value = clamp(panelWidth.value, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, maxByWindow));
    const maxTimeline = Math.max(
      MIN_TIMELINE_HEIGHT,
      Math.round(window.innerHeight * 0.55),
    );
    timelineHeight.value = clamp(
      timelineHeight.value,
      MIN_TIMELINE_HEIGHT,
      Math.min(MAX_TIMELINE_HEIGHT, maxTimeline),
    );
    previewRatio.value = clamp(previewRatio.value, MIN_PREVIEW_RATIO, MAX_PREVIEW_RATIO);
  }

  /** 打开全屏设置页；可指定分区（如智能体跳转到 AI 设置）。 */
  function openSettings(section?: SettingsSection): void {
    if (section) settingsSection.value = section;
    settingsOpen.value = true;
  }

  /** 返回工作区。 */
  function closeSettings(): void {
    settingsOpen.value = false;
    settingsSection.value = null;
  }

  watch(
    [
      showPanel,
      showTimeline,
      panelWidth,
      tabs,
      activeTab,
      timelineHeight,
      previewAspect,
      previewQuality,
      layoutMode,
      previewRatio,
    ],
    () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            showPanel: showPanel.value,
            showTimeline: showTimeline.value,
            panelWidth: panelWidth.value,
            tabs: tabs.value,
            activeTab: activeTab.value,
            timelineHeight: timelineHeight.value,
            previewAspect: previewAspect.value,
            previewQuality: previewQuality.value,
            layoutMode: layoutMode.value,
            previewRatio: previewRatio.value,
          } satisfies Persisted),
        );
      } catch {
        /* 忽略：偏好只在本次会话生效 */
      }
    },
    { deep: true },
  );

  return {
    showPanel,
    showTimeline,
    panelWidth,
    tabs,
    activeTab,
    timelineHeight,
    previewAspect,
    previewQuality,
    layoutMode,
    previewRatio,
    settingsOpen,
    settingsSection,
    hasTabs,
    openTab,
    closeTab,
    resizePanel,
    resizeTimeline,
    resizePreview,
    setLayoutMode,
    clampPanes,
    openSettings,
    closeSettings,
  };
});

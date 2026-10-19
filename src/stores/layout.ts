/**
 * 布局偏好：右侧面板可见性与宽度、面板标签页、预览/时间线的分割高度。
 * 持久化到 localStorage，下次打开保持原样。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

/** 右侧面板可打开的窗口类型；后续新增面板只需在此登记。 */
export type PaneId = "media" | "inspector" | "ai" | "export";

/** 全部可用面板的元数据（供「新建标签」选择器展示）。 */
export const PANES: { id: PaneId; label: string; hint: string }[] = [
  { id: "media", label: "媒体库", hint: "素材、音乐与字幕文件" },
  { id: "inspector", label: "属性", hint: "变换、音频与合成参数" },
  { id: "ai", label: "AI 助手", hint: "用一句话剪出成片" },
  { id: "export", label: "导出", hint: "预设、分辨率与码率" },
];

/** 右侧面板宽度下限（px）：标签栏与属性行需要的最小呼吸空间。 */
export const MIN_PANEL_WIDTH = 280;
/** 右侧面板宽度上限（px）：再宽就挤掉预览区。 */
export const MAX_PANEL_WIDTH = 520;

/** 时间线高度范围（px）。 */
export const MIN_TIMELINE_HEIGHT = 180;
export const MAX_TIMELINE_HEIGHT = 520;

interface Persisted {
  showPanel: boolean;
  panelWidth: number;
  tabs: PaneId[];
  activeTab: PaneId;
  timelineHeight: number;
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
  }

  watch(
    [showPanel, panelWidth, tabs, activeTab, timelineHeight],
    () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            showPanel: showPanel.value,
            panelWidth: panelWidth.value,
            tabs: tabs.value,
            activeTab: activeTab.value,
            timelineHeight: timelineHeight.value,
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
    panelWidth,
    tabs,
    activeTab,
    timelineHeight,
    hasTabs,
    openTab,
    closeTab,
    resizePanel,
    resizeTimeline,
    clampPanes,
  };
});

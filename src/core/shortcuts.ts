/** 全局快捷键。返回卸载函数。 */
import { useLayoutStore } from "@/stores/layout";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useTimelineActions } from "@/composables/useTimelineActions";
import { useProjectActions } from "@/composables/useProjectActions";

/** 焦点在输入类元素上时不抢快捷键。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** 有模态框打开时，快捷键交给模态框自己处理。 */
function hasOpenModal(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function installShortcuts(): () => void {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();
  const layout = useLayoutStore();
  const actions = useTimelineActions();
  const projectActions = useProjectActions();

  function onKeyDown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;

    // 模态框（确认框 / 导出 / 重命名）打开时，不触发后台快捷键。
    if (hasOpenModal()) return;

    // 设置页：只保留退出设置的快捷键。
    if (mod && event.key === ",") {
      event.preventDefault();
      projectActions.toggleSettings();
      return;
    }
    if (layout.settingsOpen) return;

    // 带 ⌘ 的组合键即使在输入框里也应生效（保存/撤销是全局语义）
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (event.shiftKey) void projectActions.saveProjectAs();
      else void projectActions.saveProject();
      return;
    }
    if (mod && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void projectActions.openProject();
      return;
    }
    if (mod && event.key.toLowerCase() === "n") {
      event.preventDefault();
      void projectActions.newProject();
      return;
    }
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) project.redo();
      else project.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      actions.duplicateSelected();
      return;
    }
    if (mod && event.key.toLowerCase() === "\\") {
      event.preventDefault();
      layout.showPanel = !layout.showPanel;
      return;
    }

    if (isTypingTarget(event.target)) return;

    switch (event.key) {
      case " ":
        event.preventDefault();
        playback.playing = !playback.playing;
        break;
      case "s":
      case "S":
        event.preventDefault();
        actions.splitAtPlayhead();
        break;
      case "m":
      case "M":
        event.preventDefault();
        actions.addMarkerAtPlayhead();
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        if (event.shiftKey) actions.rippleDeleteSelected();
        else actions.deleteSelected();
        break;
      case "ArrowLeft":
        event.preventDefault();
        playback.playing = false;
        playback.setPlayhead(playback.playhead - 1 / project.doc.fps);
        break;
      case "ArrowRight":
        event.preventDefault();
        playback.playing = false;
        playback.setPlayhead(playback.playhead + 1 / project.doc.fps);
        break;
      case "Escape":
        selection.clear();
        break;
      default:
        break;
    }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}

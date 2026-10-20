/** 选中状态：当前选中的片段与「活跃轨道」。 */
import { ref } from "vue";
import { defineStore } from "pinia";

export const useSelectionStore = defineStore("selection", () => {
  const selectedClipIds = ref<string[]>([]);
  const activeTrackId = ref<string | null>(null);

  function isSelected(id: string): boolean {
    return selectedClipIds.value.includes(id);
  }

  /** 选中单个片段；`additive` 为 true 时并入现有选择（⇧ 点击）。 */
  function select(id: string, additive = false): void {
    if (!additive) {
      selectedClipIds.value = [id];
      return;
    }
    if (!selectedClipIds.value.includes(id)) selectedClipIds.value = [...selectedClipIds.value, id];
  }

  function selectMany(ids: string[]): void {
    selectedClipIds.value = [...ids];
  }

  function toggle(id: string): void {
    selectedClipIds.value = selectedClipIds.value.includes(id)
      ? selectedClipIds.value.filter((x) => x !== id)
      : [...selectedClipIds.value, id];
  }

  function clear(): void {
    selectedClipIds.value = [];
  }

  function setActiveTrack(id: string | null): void {
    activeTrackId.value = id;
  }

  return {
    selectedClipIds,
    activeTrackId,
    isSelected,
    select,
    selectMany,
    toggle,
    clear,
    setActiveTrack,
  };
});

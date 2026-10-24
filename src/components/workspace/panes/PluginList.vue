<script setup lang="ts">
/** 插件列表：插件面板（使用）与下载管理器（管理）共用。 */
import { PuzzlePieceIcon } from "@heroicons/vue/24/outline";
import PluginCard from "./PluginCard.vue";
import { useI18n } from "@/i18n";
import type { PluginStatus } from "@/types/plugins";

defineProps<{
  plugins: PluginStatus[];
  compact?: boolean;
  mode?: "manage" | "use";
}>();

const emit = defineEmits<{ use: [slug: string] }>();
const i18n = useI18n();
</script>

<template>
  <ul v-if="plugins.length > 0" class="list">
    <PluginCard
      v-for="plugin in plugins"
      :key="plugin.slug"
      :plugin="plugin"
      :compact="compact"
      :mode="mode"
      @use="emit('use', $event)"
    />
  </ul>
  <div v-else class="empty">
    <PuzzlePieceIcon class="empty-icon" />
    <p class="empty-text">{{ i18n.t("plugins.noResults") }}</p>
  </div>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 0;
  padding: 8px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 44px 16px;
  color: rgb(var(--md-on-surface-muted));
}
.empty-icon {
  width: 26px;
  height: 26px;
}
.empty-text {
  margin: 0;
  font-size: 12px;
}
</style>

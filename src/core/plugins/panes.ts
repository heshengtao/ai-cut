/**
 * AI 面板页注册表（`ai.pane` 注入点）。
 *
 * 页面是组件而不是路由：插件页和内置页共用 `AiPane` 的页面容器与「返回」语义。
 */
import type { Component } from "vue";

export interface PaneSpec {
  /** 全局唯一；注册时由宿主自动加 `ext.<插件短 id>.` 前缀。 */
  id: string;
  /** i18n key：插件词典里写 `@<id>.<key>`。 */
  titleKey: string;
  component: Component;
}

const PANES = new Map<string, { spec: PaneSpec; owner: string }>();

export function registerPane(owner: string, spec: PaneSpec): () => void {
  const existing = PANES.get(spec.id);
  if (existing) {
    throw new Error(`面板页 ${spec.id} 已被 ${existing.owner} 注册`);
  }
  PANES.set(spec.id, { spec, owner });
  return () => {
    if (PANES.get(spec.id)?.spec === spec) PANES.delete(spec.id);
  };
}

export function pluginPanes(): PaneSpec[] {
  return [...PANES.values()].map((entry) => entry.spec);
}

export function paneFor(id: string): PaneSpec | null {
  return PANES.get(id)?.spec ?? null;
}

export function clearPanes(): void {
  PANES.clear();
}

/**
 * 参数控件注册表：插件可以给某个参数提供一个 Vue 组件（`board.inspector` 注入点）。
 *
 * 只收组件、不收 HTML 字符串——动态组件由 Vue 渲染，插件拿不到 `innerHTML` 这条 XSS 面。
 */
import type { Component } from "vue";

export interface ControlSpec {
  /** 全局唯一；注册时由宿主自动加 `ext.<插件短 id>.` 前缀。 */
  id: string;
  component: Component;
}

const CONTROLS = new Map<string, { spec: ControlSpec; owner: string }>();

export function registerControl(owner: string, spec: ControlSpec): () => void {
  const existing = CONTROLS.get(spec.id);
  if (existing) {
    throw new Error(`参数控件 ${spec.id} 已被 ${existing.owner} 注册`);
  }
  CONTROLS.set(spec.id, { spec, owner });
  return () => {
    if (CONTROLS.get(spec.id)?.spec === spec) CONTROLS.delete(spec.id);
  };
}

export function controlFor(id: string): Component | null {
  return CONTROLS.get(id)?.spec.component ?? null;
}

export function clearControls(): void {
  CONTROLS.clear();
}

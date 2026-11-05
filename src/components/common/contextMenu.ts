/**
 * 右键菜单的数据模型。
 *
 * 菜单是纯数据（可嵌套），由 `ContextMenu.vue` + `MenuPanel.vue` 递归渲染。
 * 动作直接挂在 `run` 上：构建菜单时就决定了「点下去会发生什么」，
 * 渲染层不需要知道任何业务含义。
 */
import type { Component } from "vue";

/** 子菜单相对触发行的锚点（`getBoundingClientRect()` 的结构子集）。 */
export interface MenuAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface MenuItemBase {
  /** 同一层菜单内唯一；用于高亮与子菜单开关。 */
  id: string;
  label: string;
  icon?: Component;
  /** 行尾快捷键提示。 */
  keys?: string[];
  /** 悬停说明 / 补充信息。 */
  hint?: string;
  /** 行内小标签（例如 AI）。 */
  badge?: string;
  disabled?: boolean;
  /** 危险操作（删除等）用错误色。 */
  danger?: boolean;
  /** AI 动作行：图标与徽标用主题色强调。 */
  ai?: boolean;
  /** 带勾选标记（静音、显示等开关）。 */
  checked?: boolean;
}

export interface MenuAction extends MenuItemBase {
  kind: "action";
  run: () => void;
}

export interface MenuSubmenu extends MenuItemBase {
  kind: "submenu";
  items: MenuItem[];
}

export interface MenuSeparator {
  kind: "separator";
  id: string;
}

export interface MenuLabel {
  kind: "label";
  id: string;
  label: string;
}

export type MenuItem = MenuAction | MenuSubmenu | MenuSeparator | MenuLabel;

let sequence = 0;

function autoId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export function menuAction(options: Omit<MenuAction, "kind" | "id"> & { id?: string }): MenuAction {
  return { kind: "action", id: options.id ?? autoId("action"), ...options };
}

export function menuSubmenu(
  options: Omit<MenuSubmenu, "kind" | "id"> & { id?: string },
): MenuSubmenu {
  return { kind: "submenu", id: options.id ?? autoId("submenu"), ...options };
}

export function menuSeparator(id?: string): MenuSeparator {
  return { kind: "separator", id: id ?? autoId("sep") };
}

export function menuLabel(label: string, id?: string): MenuLabel {
  return { kind: "label", label, id: id ?? autoId("label") };
}

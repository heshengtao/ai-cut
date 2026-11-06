/** `MenuButton` 的菜单数据结构：类型放独立文件，组件只渲染。 */
import type { Component } from "vue";

export interface MenuItem {
  id: string;
  label: string;
  /** 右侧的补充说明（通常是快捷键）。 */
  hint?: string;
  icon?: Component;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

# AI Cut × Material Design 3 Expressive 升级设计规范

- **日期**: 2026-11-25
- **状态**: 待评审
- **关联目标**: 让 `ai-cut` 的视觉质感与交互动效对齐 Google Material Design 3 Expressive（2025/2026）规范，引入标志性 M3 Expressive UI 原语与真实物理弹簧动效，同时保持专业视频剪辑核心区（时间线、画布节点）的高密度与克制。

---

## 1. 背景与现状诊断

`ai-cut` 目前在 `src/assets/main.css` 具备基础的 Material You 表面色阶（`surface-container-lowest..highest`）与 5 套主题色，但与谷歌官方 M3 Expressive 体验存在以下核心差距：

1. **缺少状态层涟漪（Material Ripple）**：按钮与可交互项仅做静态背景叠色 + `scale(0.97)`，缺少指针起点的墨水波纹反馈。
2. **缺少 M3 Expressive 物理弹簧分层**：现有过渡普遍使用 `0.15s ease` 或普通贝塞尔曲线，未区分 **Spatial（空间弹簧，带弹性过冲）** 与 **Effects（效果曲线，无过冲）**。
3. **缺少标志性 M3 Expressive 原语与形变（Shape Morph）**：
   - `Md3Slider` 仍是旧版 4px 细轨 + 圆形手柄，缺少 14px 宽轨、竖条手柄、轨道留白间隙、末端刻度点与拖拽数值气泡。
   - `ToggleSwitch` 缺少内置对勾图标与按压拉伸（squishy stretch）触感。
   - 缺少 **变形几何加载器（Morphing Loading Indicator）**、**波浪进度条（Wavy Progress）**、**Filter Chip**、**Split Button**、**Connected Button Group**。
   - `Toast` 使用 `surface-container-highest` 而非 M3 标准的 `inverse-surface` + `inverse-primary` 配色（且 `main.css` 尚未正式声明 `--md-inverse-*` token）。
4. **工作区空间编排偏平**：`StageView` 视图切换无过渡，`PanelTabs` 切换标签无滑动胶囊，`ModalShell` / `ConfirmDialog` 入场偏线性，设置页卡片仍是传统分割线样式而非 M3 Expressive 分组圆角列表。

---

## 2. 设计架构与边界

### 2.1 视觉与动效边界（专业剪辑克制原则）

- **全量应用 M3 Expressive**：顶栏、视图切换、右侧面板标签与空态、弹窗（`ModalShell` / `ConfirmDialog`）、Snackbar（`Toast`）、AI 任务浮层（`AiTaskHud`）、设置页（`SettingsView`）以及所有公共表单/交互原语。
- **保持克制的高密度区**：时间线片段拖拽（`TimelineClip`）、画布节点与连线（`BoardNode` / `BoardEdge`）、剧集图卡片（`SeriesGraph`）不附加涟漪与过冲弹跳，避免干扰帧级精准剪辑与画布性能；同时确保不破坏 `src/components/board/__tests__/cssTokens.test.ts` 的 CSS 变量守卫。

### 2.2 令牌与物理弹簧层（`src/assets/main.css`）

1. **补齐 M3 Inverse 色彩角色**：在 `:root`、`.dark` 以及 5 套 `[data-accent=*]` 配色块中补齐：
   - `--md-inverse-surface`
   - `--md-inverse-on-surface`
   - `--md-inverse-primary`
2. **新增 M3 Expressive 弹簧令牌**（保留既有 `--md-ease-*` / `--md-duration-*` 向后兼容）：
   - **Spatial（用于位置、缩放、圆角形变、宽度变化，基于 CSS `linear()` 弹簧近似）**：
     - `--md-spring-spatial-fast` / `--md-dur-spatial-fast: 320ms`
     - `--md-spring-spatial-default` / `--md-dur-spatial-default: 460ms`
     - `--md-spring-spatial-bouncy` / `--md-dur-spatial-bouncy: 380ms`
   - **Effects（用于颜色、透明度、背景，临界阻尼零过冲）**：
     - `--md-spring-effects-fast` / `--md-dur-effects-fast: 140ms`
     - `--md-spring-effects-default` / `--md-dur-effects-default: 200ms`
3. **按钮形变（Shape Morph）与新增按钮类**：
   - `.btn-filled` / `.btn-tonal` / `.btn-text` / 新增 `.btn-outlined`：默认圆角 `20px`（胶囊），`:active` 时通过 Spatial Fast 弹簧形变为 `10px` 并微缩 `scale(0.96)`。
   - `.icon-btn`：默认圆形 `999px`，`:active` 缩至 `10px`，`.icon-btn.on` 切换为圆角方形 `10px`（圆 ↔ 方圆切换）。
4. **全局涟漪样式**：在 `@layer` 之外定义 `.md-ripple-host` 与 `.md-ripple-wave`（防止 Tailwind v3 JIT 裁掉运行时动态节点样式），并在 `@media (prefers-reduced-motion: reduce)` 下完全禁用动画。

### 2.3 全局 Material Ripple 引擎（`src/directives/ripple.ts` + `src/main.ts`）

- 提供两个互不冲突的接入方式：
  1. **Vue 指令 `v-ripple`**：全局注册于 `src/main.ts`，支持 `v-ripple`（默认指针落点扩散）、`v-ripple="false"`（关闭）、`v-ripple="{ centered: true }"`（中心扩散，适合圆形图标按钮）。
  2. **全局委托 `installGlobalRipple()`**：在 `document` 捕获 `pointerdown`，自动为匹配 `.btn-filled, .btn-tonal, .btn-outlined, .btn-text, .icon-btn, [data-ripple]` 的非禁用元素触发指针起点涟漪，使全站既有按钮零改动即获得 Material Ripple 触感。
- 守卫规则：
  - 跳过 `disabled` / `[aria-disabled="true"]` / `[data-no-ripple]` 元素；
  - 跳过非主按键（`event.button !== 0`）；
  - 遵循 `prefers-reduced-motion: reduce`；
  - 涟漪节点在 `animationend` + 兜底定时器自动移除，不泄漏 DOM。

---

## 3. UI 原语升级与新增清单

### 3.1 升级现有公共原语（保持既有 Props 100% 兼容）

| 组件文件 | 升级内容 | 兼容性与细节 |
| --- | --- | --- |
| `src/components/common/Md3Slider.vue` | 14px 宽轨 + 激活/未激活轨道双段留白间隙（两侧各 6px）+ 竖条手柄（`4×28px`，拖拽时弹簧变细拉长至 `2.5×34px`）+ 末端刻度点 + 悬停/拖拽弹簧浮起 `inverse-surface` 数值气泡 | 保留全部现有 Props，新增可选 `formatValue?: (v: number) => string` 与 `showBubble?: boolean`（默认 `true`） |
| `src/components/common/ToggleSwitch.vue` | 内置对勾 SVG 图标（旋转缩放弹簧入场）+ `:active` 按压横向拉伸（squishy stretch）+ Spatial Bouncy 弹簧位移 | 保留全部现有 Props，新增 `size?: "sm" \| "md"`（默认 `"sm"` `44×26px` 适配检查器与节点，`"md"` `52×32px` 适配设置页） |
| `src/components/common/SegmentedControl.vue` | 胶囊滑块改用 `--md-spring-spatial-fast` 弹簧过渡，按钮按压增加轻微宽度/圆角弹性反馈 | 零破坏性变更 |
| `src/components/layout/ViewSwitcher.vue` | 胶囊滑块升级为 `--md-spring-spatial-fast` 物理弹簧过渡，按钮接入涟漪 | 零破坏性变更 |
| `src/components/common/ModalShell.vue` | 入场改为 `scale(0.88) translateY(14px) → 1` 的 Spatial Fast 弹簧，退场使用 Effects Fast，遮罩增加 `backdrop-filter: blur(5px)`，圆角 `28px` | 保持焦点管理、Esc 快捷键吞噬与 `dismissible` 行为不变 |
| `src/components/common/ConfirmDialog.vue` | 同步 `ModalShell` 的弹簧入场、遮罩毛玻璃与按钮形变 | 保持 `z-index: 460` 与键盘确认/取消逻辑不变 |
| `src/components/common/Toast.vue` | 升级为标准 M3 Snackbar：默认采用 `inverse-surface` / `inverse-on-surface`，操作按钮用 `inverse-primary` 文本态；错误态保留 `error-container`；入场改用 Spatial Fast 弹簧上浮 | 保持右下角非模态 Toast 定位（遵循 `AGENTS.md` 更新提示规范） |
| `src/components/common/Md3Expansion.vue` | 展开箭头与高度过渡升级为 Spatial Default 弹簧，展开内容区增加轻微淡入 | 零破坏性变更 |

### 3.2 新增 M3 Expressive 原语（`src/components/common/`）

1. **`Md3LoadingIndicator.vue`**：
   - 标志性 M3 Expressive 旋转+形变几何加载器（在 8 瓣扇贝 ↔ 四叶草 ↔ 六瓣花 ↔ 圆角方之间平滑过渡）。
   - Props：`size?: "sm" | "md" | "lg"`（默认 `"md"`）、`contained?: boolean`（是否包裹 `primary-container` 圆形底托，默认 `true`）、`label?: string`。
   - `prefers-reduced-motion` 下保持静态几何形状，不启动 `requestAnimationFrame`。
   - 接入点：`src/components/common/AiTaskHud.vue` 替换原有 CSS 边框圆圈 spinner。
2. **`Md3WavyProgress.vue`**：
   - 标志性 M3 Expressive 波浪线性进度条（SVG 正弦波激活段 + 留白间隙 + 直线未完成段）。
   - Props：`value?: number`（0–1，不传时为不确定流动波浪模式）、`label?: string`、`height?: number`。
   - `prefers-reduced-motion` 下渲染为平滑直线进度条，不跑帧动画。
   - 接入点：`SettingsView.vue` 的应用更新下载进度与运行库下载进度条。
3. **`Md3Chip.vue`**：
   - 标准 M3 Filter / Assist Chip：未选中时 `10px` 圆角 + `outline` 描边，选中时弹簧形变为 `999px` 胶囊 + `secondary-container` 填充 + 左侧对勾弹簧展开宽度。
   - Props：`selected?: boolean`、`variant?: "filter" | "assist"`、`disabled?: boolean`。
4. **`Md3SplitButton.vue`**：
   - 左侧主动作按钮（`20px 6px 6px 20px`）+ 2px 缝隙 + 右侧下拉触发键（`6px 20px 20px 6px`，展开时弹簧变为全圆并旋转箭头 180°）。
   - Props：`label: string`、`open?: boolean`、`disabled?: boolean`、`variant?: "filled" | "tonal"`。
5. **`Md3ButtonGroup.vue`**：
   - 连接按钮组（Connected Button Group）：首尾外侧 `20px` 圆角、内部 `8px` 圆角、`3px` 间隙，按压时横向宽度弹簧扩张、选中项变形为完整胶囊（`20px`）+ `secondary-container`。

---

## 4. 工作区空间编排与设置页升级

1. **主舞台 Shared Axis X 切换（`src/components/workspace/StageView.vue`）**：
   - 按视图顺序 `preview (0) → board (1) → series (2)` 计算切换方向（`forward` / `backward`）。
   - 使用 Vue `<Transition :name="transitionName" mode="out-in">` 实现 M3 Shared Axis X 空间过渡：入场沿对应方向位移 `24px` + `scale(0.985)` + 淡入（Spatial Fast 弹簧），退场快速收敛（Effects Fast，90ms），与顶栏 `ViewSwitcher` 胶囊滑动方向完全一致。
2. **右侧面板标签栏弹簧胶囊（`src/components/workspace/PanelTabs.vue`）**：
   - 为打开的面板标签引入 DOM 实测的滑动指示胶囊（`.tab-pill`，带 `ResizeObserver` 与横向滚动同步），点击标签时胶囊以 Spatial Fast 弹簧滑向目标标签，替代原先瞬间切换背景色的生硬感。
3. **右侧面板内容与设置页切页过渡（`src/assets/main.css`）**：
   - `.pane-enter-active` 与 `.shell-enter-active` 升级为 Spatial Fast + Effects Fast 组合曲线，使面板切换与打开设置页更具弹性与空间纵深。
4. **设置页分组圆角列表（`src/components/settings/SettingsView.vue`）**：
   - 将 `.card` + `.row` 从传统的「单大卡片 + 细分割线」升级为 M3 Expressive **分组圆角列表**：`.card` 作为无背景透明容器（`display: flex; flex-direction: column; gap: 3px;`），内部每条 `.row` / `.col-row` / `.runtime-row` 独立拥有 `var(--app-inset)` 表面色与 `6px` 内圆角，首项顶部 `22px`、末项底部 `22px`、悬停轻微提亮。
   - 设置页内的 `.m3-switch` 升级为与 `ToggleSwitch` 一致的对勾 + 按压拉伸风格；下载进度条接入 `Md3WavyProgress`。

---

## 5. 测试与验证计划

1. **新增单元测试**：
   - `src/directives/__tests__/ripple.test.ts`：验证指针坐标计算、涟漪 DOM 创建与清理、`disabled` / `data-no-ripple` / `prefers-reduced-motion` 守卫。
   - `src/components/common/__tests__/md3Primitives.test.ts`：验证 `Md3Slider`、`ToggleSwitch`、`Md3Chip`、`Md3WavyProgress`、`Md3LoadingIndicator`、`Md3SplitButton`、`Md3ButtonGroup` 的核心交互、无障碍属性与事件触发。
2. **全量回归验证**：
   - `pnpm test`（覆盖既有单测与 `src/components/board/__tests__/cssTokens.test.ts` CSS 变量守卫）。
   - `pnpm build`（完整 `vue-tsc --noEmit` 类型检查 + `vite build` 生产构建）。

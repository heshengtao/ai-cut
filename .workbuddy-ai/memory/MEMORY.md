# ai-cut 项目备忘

- 技术链：Tauri 2（Rust）+ Vue 3 + TypeScript + Vite 6 + Tailwind 3 + Pinia + @heroicons/vue。
- UI 规范：MD3 / Material You，令牌与组件层参考 `/Users/ailm32442/Documents/github/ai-daw`（`src/assets/main.css`、`tailwind.config.js`）。
- 端口：开发固定 `1430`（`vite.config.ts` 与 `src-tauri/tauri.conf.json` 的 `devUrl` 必须一致）；1420 被 ai-daw 占用。
- 标题栏：macOS 用 Overlay + hidden_title（保留红绿灯，左侧 78px 让位）；Windows/Linux 无边框 + 自绘 `WindowControls`。
- 布局状态：`src/stores/layout.ts`，localStorage 键 `ai-cut-layout`；主题键 `ai-cut-theme`，默认 dark。
- 原型阶段：预览、时间线、面板内容均为静态占位，无真实剪辑/播放逻辑。

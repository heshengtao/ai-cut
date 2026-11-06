/** 欢迎页的起点动作；由 `App.vue` 统一执行（那里才拿得到各种对话框与面板）。 */
export type WelcomeStart =
  | "ai"
  | "blank"
  | "import"
  | "open"
  | "history"
  /** 回到启动时已经恢复的上次工程（只关掉欢迎页，工程本来就在下面）。 */
  | "resume";

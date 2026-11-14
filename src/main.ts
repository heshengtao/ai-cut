import { createApp } from "vue";
import { createPinia } from "pinia";
import { invoke } from "@/platform/tauri";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import { isTauri } from "./utils/platform";
import { ensureCapabilities } from "./platform/capabilities";
import "./i18n";
import "./assets/main.css";
import "./assets/fonts.css";

// 主题必须在挂载前应用：否则「上次选了深色」这件事在重新打开应用时会失效。
initTheme();

createApp(App).use(createPinia()).mount("#app");

// 浏览器 / 容器形态：进入就拉一次能力表。之后所有门控都读它，
// 不再各自用 `isTauri()` 猜"这个功能到底能不能用"。
if (!isTauri()) {
  void ensureCapabilities();
}

// 首帧画完再告诉后端「可以显示窗口了」。用定时器而不是 requestAnimationFrame：
// 窗口在 `app_ready` 之前还是隐藏的，隐藏页面不保证跑 rAF（会被节流）。
if (isTauri()) {
  window.setTimeout(() => {
    void invoke("app_ready").catch(() => {
      // 老版本后端没有这个命令：忽略即可（窗口由后端的兜底定时器显示）。
    });
  }, 250);
}

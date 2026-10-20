import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import "./i18n";
import "./assets/main.css";
import "./assets/fonts.css";

// 主题必须在挂载前应用：否则「上次选了深色」这件事在重新打开应用时会失效。
initTheme();

createApp(App).use(createPinia()).mount("#app");

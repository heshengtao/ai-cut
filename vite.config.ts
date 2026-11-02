import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/**
 * 固定端口。**不要改回 1430**：Windows 上要同时躲开两张表，否则 dev server 起不来
 * （Node 报 `EACCES: permission denied ::1:1430`）：
 *
 * 1. **排除端口区**（`netsh interface ipv4 show excludedportrange protocol=tcp`）：
 *    Hyper-V / WSL2 / Docker 整段预留，绑定直接 WSAEACCES(10013)。本机覆盖 1112–2061。
 * 2. **动态端口区**（`netsh int ipv4 show dynamicport tcp`）：系统从这里发临时端口。
 *    本机是 1024–15000（默认才是 49152–65535）。
 *
 * 20000–49151 这一段最稳。改这里必须同步改 `src-tauri/tauri.conf.json` 的 `build.devUrl`。
 * 兄弟项目 ai-daw 用 28420，两个可以同时起。
 */
const DEV_PORT = 28430;
const HMR_PORT = 28431;

// Vite config tailored for Tauri development:
// 1. don't obscure rust errors, 2. fixed port, 3. don't watch src-tauri.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: HMR_PORT } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});

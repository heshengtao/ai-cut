# AI Cut — Agent Notes

## Release & update conventions

- Every GitHub Release must include a complete changelog generated from git commits. `.github/workflows/release.yml` runs `scripts/release-notes.mjs`, which writes `release-body.md` (release page body) and `updater-notes.txt` (plain-text notes used as `latest.json`'s `notes`). Do not replace the generated body with a placeholder.
- The app records the last-run version in localStorage (`ai-cut-last-version`). On the first launch after an upgrade, `src/core/updateNotice.ts` reports the previous version and the bottom-right toast shows a one-time update notice with a "查看更新日志" action that opens `https://github.com/heshengtao/ai-cut/releases/tag/v<version>` in the system browser. Keep it a toast, not a modal.
- When bumping a version, keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` in sync; the release tag must match `tauri.conf.json`.

## Checks

- Frontend tests: `pnpm test`
- Type-check + build: `pnpm build`
- Rust tests: `cargo test --lib` (in `src-tauri`). The CUDA session check is opt-in:
  `AICUT_TEST_RUNTIME=<runtime/ort/cuda or cuda13> AICUT_TEST_MODEL=<a .onnx>` then
  `cargo test --lib cuda_runs_a_model -- --ignored --nocapture`.

## Timeline context menu

- Generic menu lives in `src/components/common/`: `ContextMenu.vue` handles the host / global
  closing, `MenuPanel.vue` renders one panel and recursively renders submenus. The item model is
  `contextMenu.ts` (`action` / `submenu` / `separator` / `label`).
- Content is built **per target** in `src/composables/useTimelineMenus.ts`: `clip`, `lane`
  (empty track area), `ruler`, `marker`, `track` header. Keep the AI group first, and keep each
  root menu short by moving groups into submenus instead of adding more top-level rows.
- AI actions go through `src/composables/useAiClipActions.ts`: it checks installed models, calls
  `core/aiActions` directly, and reports through the global `AiTaskHud` (cancel included).
  Generation entries must open the AI pane through `stores/aiLaunch` with a prefilled
  prompt/image — do not duplicate the generation forms inside the menu.
- A menu item only appears for blocks where it is valid: audio / video clips get audio and/or
  visual AI, image clips get image AI, text clips get voiceover; "generate from nothing" belongs
  to the empty-area / ruler menus only.
- When adding items, add `menu.*` keys to **both** `src/i18n/zh.ts` and `src/i18n/en.ts`, and
  extend `src/composables/__tests__/timelineMenus.test.ts` for the block-type rule.

## Data folder (where models / plugins / history live)

- All persistent state is resolved through `src-tauri/src/paths.rs` — never call
  `app.path().app_config_dir()` / `app_data_dir()` directly for app-owned data. Order:
  `--data-dir <path>` > `AICUT_DATA_DIR` > pointer file `<default config dir>/data-dir.json`
  (written by Settings → Storage) > `HKCU\Software\AI Cut\DataDir` (written by the NSIS
  installer) > the system default. Settings page commands: `data_dir_info`,
  `data_dir_migrate`, `data_dir_cleanup_previous`; progress goes out on `data-dir-progress`.
- The effective folder is **frozen for the process** (`EFFECTIVE`). Migration only copies and
  writes the pointer; the running app keeps using the old folder and the UI must say "restart
  required". Never delete the old folder during migration — `cleanup_previous` runs after the
  restart and refuses paths that don't look like an AI Cut data folder.
- Discovery files (`cli-path`, `app-path`, `mcp-url`) stay in the **default** config dir:
  `aicut` and external AI harnesses find them by bundle id (`skills/aicut/SKILL.md`). Only
  `mcp.json` (settings) moves with the data folder.
- The installer hook is `src-tauri/nsis/data-dir-hook.nsh` (NSIS only — MSI has no hooks, MSI
  users migrate from Settings). It must stay UTF-8 **with BOM**, and it only prompts on a first
  install (`/S`, auto-updates and machines that already chose a folder must not be interrupted).
- Fonts live in `<data dir>/fonts/`: Fontsource installs are `fs-<sourceId>/`, local imports
  are `local-<slug>-<hash>/`, each with its own `manifest.json`. Projects only store the
  `fontFamily` id; the front-end injects `@font-face` from the manifests
  (`src/core/installedFonts.ts`) and must await `ensureProjectFontsLoaded()` before Canvas
  export. The manifest's absolute `dir` is never persisted — it is filled on read.

## Local AI runtime (CUDA 12 / CUDA 13)

- Windows downloads CUDA as **two complete, version-matched sets**, never borrowing the user's
  CUDA (the data dir defaults to `%APPDATA%\com.aicut.editor` but can be moved — see above):
  - CUDA 12: ONNX Runtime 1.26 (CUDA 12 build) + `cudart` / `cublas` / `cufft` / `cudnn` in
    `<data dir>\runtime\ort\cuda\<part>\`;
  - CUDA 13: ONNX Runtime 1.31.1 (CUDA 13 build) + the matching components in
    `<data dir>\runtime\ort\cuda13\<part>\`.
  The catalog lives in `src-tauri/src/runtime.rs`; loading is `src-tauri/src/backend.rs`.
- ORT and its components move together. CUDA 12's provider imports `cudart64_12` /
  `cublas64_12` / `cufft64_11`; CUDA 13's imports `cudart64_13` / `cublas64_13` / `cufft64_12`.
  Mixing the two makes `LoadLibrary` fail and ORT silently falls back to CPU. When you change
  either the ORT pin or a component version, bump the entry's `revision` in `runtime.rs` —
  otherwise existing installs are considered current.
- Downloading a CUDA core also installs the missing components of the **same** major version
  (`runtime_install` bundles them under one progress bar). Deleting one component never touches
  the other CUDA version.
- Linux ships the same complete sets (the NVIDIA archives are `.tar.xz`, extracted to SONAME
  names with `xz2`), and the loader only looks at `runtime/ort/cuda[13]/<part>` there too —
  it does **not** fall back to `CUDA_PATH` / `/usr/local/cuda` / pip. Installing the components
  is what makes CUDA usable on Linux; a missing one is reported, not borrowed.
- The loader only looks at the directories we install (`runtime/ort/cuda[13]/<part>`), preloads
  cudart → cuBLAS → cuFFT → the whole cuDNN folder, then registers the provider library with
  `Environment::register_ep_library("CUDA", …)`. Without that registration
  `with_execution_providers([CUDA])` is silently ignored and sessions run on CPU.
- Switching CUDA 12 ↔ 13, or installing/removing components of the loaded runtime, always needs
  a restart. Removing a DLL that is still mapped is deferred through `pending-remove.json`;
  the runtime root's `pending-restart` marker drives the "restart to apply" banner/dialog.

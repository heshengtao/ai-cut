# AI Cut × Material Design 3 Expressive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `ai-cut` to Google Material Design 3 Expressive (2025/2026) with Spatial/Effects spring physics, pointer-origin Material Ripple, Shape Morph buttons, upgraded core controls, new Expressive primitives, and workspace spatial choreography.

**Architecture:** All tokens and spring curves live in `src/assets/main.css` (preserving legacy tokens for `cssTokens.test.ts`). Pure SVG/math helpers live in `src/core/md3/` and `src/directives/ripple.ts` so Vitest (Node environment) can unit-test them directly. Existing common components are upgraded in-place with backward-compatible props; high-density pro editing zones (`TimelineClip`, `BoardNode`, `SeriesGraph`) stay crisp and free of bounce/ripple.

**Tech Stack:** Vue 3.5 (`<script setup lang="ts">`), Tailwind CSS v3, CSS `linear()` springs, Vitest (Node environment), `vue-tsc` + Vite 6.

## Global Constraints

- Preserve all existing `--md-*` / `--app-*` / `--node-*` tokens so `src/components/board/__tests__/cssTokens.test.ts` continues to pass.
- All animations must respect `@media (prefers-reduced-motion: reduce)`.
- Keep `Toast.vue` as a bottom-right non-modal toast (`AGENTS.md` update notice rule).
- Do not add `tauri` imports or modify `crates/daemon`.
- Vitest runs in `environment: "node"`; unit tests must not assume a browser DOM unless stubbed cleanly.

---

### Task 1: Design Tokens, Spring Physics & Global Material Ripple Engine

**Files:**
- Modify: `src/assets/main.css`
- Create: `src/directives/ripple.ts`
- Create: `src/directives/__tests__/ripple.test.ts`
- Modify: `src/main.ts`

**Steps:**
- [ ] **Step 1:** Write `src/directives/__tests__/ripple.test.ts` testing `computeRippleGeometry` and `shouldSkipRipple` (center mode, pointer-origin mode, disabled/aria-disabled/data-no-ripple, non-primary button, reduced motion).
- [ ] **Step 2:** Implement `src/directives/ripple.ts` exporting `computeRippleGeometry`, `shouldSkipRipple`, `vRipple`, and `installGlobalRipple`.
- [ ] **Step 3:** Update `src/assets/main.css` with `--md-inverse-surface`, `--md-inverse-on-surface`, `--md-inverse-primary` across `:root`, `.dark`, and all 5 `[data-accent=*]` palettes; add `--md-spring-spatial-*` / `--md-spring-effects-*` and duration tokens; upgrade `.btn-filled`, `.btn-tonal`, `.btn-text`, `.icon-btn` and add `.btn-outlined` with Shape Morph; add `.md-ripple-host` / `.md-ripple-wave` outside `@layer`.
- [ ] **Step 4:** Register `v-ripple` and call `installGlobalRipple()` in `src/main.ts`.
- [ ] **Step 5:** Run `pnpm test src/directives/__tests__/ripple.test.ts` and verify pass.

---

### Task 2: New M3 Expressive Primitives & Pure Shape Helpers

**Files:**
- Create: `src/core/md3/shapes.ts`
- Create: `src/core/md3/__tests__/shapes.test.ts`
- Create: `src/components/common/Md3LoadingIndicator.vue`
- Create: `src/components/common/Md3WavyProgress.vue`
- Create: `src/components/common/Md3Chip.vue`
- Create: `src/components/common/Md3SplitButton.vue`
- Create: `src/components/common/Md3ButtonGroup.vue`

**Steps:**
- [ ] **Step 1:** Write `src/core/md3/__tests__/shapes.test.ts` testing `buildMorphPolygonPath` (valid closed SVG path, smooth interpolation between presets) and `buildWavyProgressPaths` (active wave path + gap + inactive track clamping for 0%, 50%, 100%).
- [ ] **Step 2:** Implement `src/core/md3/shapes.ts`.
- [ ] **Step 3:** Implement `Md3LoadingIndicator.vue`, `Md3WavyProgress.vue`, `Md3Chip.vue`, `Md3SplitButton.vue`, and `Md3ButtonGroup.vue`.
- [ ] **Step 4:** Run `pnpm test src/core/md3/__tests__/shapes.test.ts` and verify pass.

---

### Task 3: Upgrade Existing M3 Base Primitives

**Files:**
- Modify: `src/components/common/Md3Slider.vue`
- Modify: `src/components/common/ToggleSwitch.vue`
- Modify: `src/components/common/SegmentedControl.vue`
- Modify: `src/components/layout/ViewSwitcher.vue`
- Modify: `src/components/common/ModalShell.vue`
- Modify: `src/components/common/ConfirmDialog.vue`
- Modify: `src/components/common/Toast.vue`
- Modify: `src/components/common/Md3Expansion.vue`

**Steps:**
- [ ] **Step 1:** Upgrade `Md3Slider.vue` to 14px thick track + dual-side gap + vertical handle + stop dot + floating `inverse-surface` value bubble (keeping full keyboard/pointer/prop compatibility).
- [ ] **Step 2:** Upgrade `ToggleSwitch.vue` with checkmark icon, squishy `:active` thumb stretch, spatial bouncy spring, and optional `size?: "sm" | "md"`.
- [ ] **Step 3:** Upgrade `SegmentedControl.vue` and `ViewSwitcher.vue` to Spatial Fast springs + ripple-ready buttons.
- [ ] **Step 4:** Upgrade `ModalShell.vue`, `ConfirmDialog.vue`, `Toast.vue` (M3 Inverse Surface Snackbar), and `Md3Expansion.vue`.

---

### Task 4: Workspace Choreography & Settings Expressive Grouping

**Files:**
- Modify: `src/components/workspace/StageView.vue`
- Modify: `src/components/workspace/PanelTabs.vue`
- Modify: `src/components/common/AiTaskHud.vue`
- Modify: `src/components/settings/SettingsView.vue`

**Steps:**
- [ ] **Step 1:** Add directional M3 Shared Axis X transitions to `StageView.vue` synced with `ViewSwitcher` order (`preview → board → series`).
- [ ] **Step 2:** Add DOM-measured sliding spring active pill to `PanelTabs.vue`.
- [ ] **Step 3:** Replace `AiTaskHud.vue` border spinner with `Md3LoadingIndicator` and spring slide-in transition.
- [ ] **Step 4:** Upgrade `SettingsView.vue` `.card`/`.row` groups to M3 Expressive grouped rounded lists, upgrade `.m3-switch` to press-stretch + checkmark, and wire `Md3WavyProgress` into updater/runtime progress bars.

---

### Task 5: Full Verification & Commit

**Steps:**
- [ ] **Step 1:** Run `pnpm test` and `pnpm build` in one chained command.
- [ ] **Step 2:** Fix any type, CSS token, or test issues until both pass with zero errors.
- [ ] **Step 3:** Commit implementation changes cleanly.

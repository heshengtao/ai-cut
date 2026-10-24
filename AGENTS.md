# AI Cut — Agent Notes

## Release & update conventions

- Every GitHub Release must include a complete changelog generated from git commits. `.github/workflows/release.yml` runs `scripts/release-notes.mjs`, which writes `release-body.md` (release page body) and `updater-notes.txt` (plain-text notes used as `latest.json`'s `notes`). Do not replace the generated body with a placeholder.
- The app records the last-run version in localStorage (`ai-cut-last-version`). On the first launch after an upgrade, `src/core/updateNotice.ts` reports the previous version and the bottom-right toast shows a one-time update notice with a "查看更新日志" action that opens `https://github.com/heshengtao/ai-cut/releases/tag/v<version>` in the system browser. Keep it a toast, not a modal.
- When bumping a version, keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` in sync; the release tag must match `tauri.conf.json`.

## Checks

- Frontend tests: `pnpm test`
- Type-check + build: `pnpm build`

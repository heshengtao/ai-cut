/**
 * 共享会话发布（桌面 + 浏览器）：把本地编辑的「快照 + 受影响对象」推给 daemon。
 *
 * 只有本地事件会触发推送（`project.subscribe`），应用远端补丁不会回推，
 * 避免两端互相回声。浏览器要等 `/session` 的 hello 到达后再开始推，
 * 否则会用本地空工程覆盖桌面端正在编辑的会话。
 */
import { watch } from "vue";

import { invoke } from "@/platform/tauri";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { isTauri } from "@/utils/platform";
import { sessionClientId } from "@/core/sessionMerge";
import { sessionHadDoc, sessionReady } from "@/core/sessionSync";

let started = false;

/** 文档推送的防抖：拖动时最多约 8 次/秒。 */
const DOC_DEBOUNCE_MS = 120;
/** 播放头推送的最小间隔（约 10Hz）。 */
const PLAYHEAD_INTERVAL_MS = 100;

export function startSessionPublisher(): void {
  if (started) return;
  started = true;

  const project = useProjectStore();
  const playback = usePlaybackStore();
  const origin = sessionClientId();

  let docTimer = 0;
  const pushDoc = (full: boolean): void => {
    if (!isTauri() && !sessionReady.value) return;
    void invoke("session_publish", {
      project: JSON.stringify(project.doc),
      revision: project.revision,
      origin,
      affected: full ? null : (project.lastAffected ?? null),
      full,
      dirty: project.dirty,
      path: project.filePath,
    }).catch(() => undefined);
  };

  // 本地命令产生的事件才推送；远端合并（applyRemote）不会 emit。
  project.subscribe((event) => {
    if (event.error) return;
    if (!isTauri() && !sessionReady.value) return;
    window.clearTimeout(docTimer);
    docTimer = window.setTimeout(
      () => pushDoc(project.lastPatchFull),
      DOC_DEBOUNCE_MS,
    );
  });

  // 浏览器是第一个客户端（hello 里没有工程）：把本地工程推上去成为共享起点。
  if (!isTauri()) {
    watch(sessionReady, (ready) => {
      if (ready && !sessionHadDoc.value) pushDoc(true);
    });
  }

  // 打开 / 新建 / 恢复这类不产生命令事件的操作：补一次整份推送。
  watch(
    () => project.revision,
    () => {
      if (!isTauri() && !sessionReady.value) return;
      if (Date.now() - project.remoteApplyAt < 200) return;
      if (Date.now() - project.lastLocalEventAt < 300) return;
      window.clearTimeout(docTimer);
      docTimer = window.setTimeout(() => pushDoc(true), DOC_DEBOUNCE_MS);
    },
  );

  // 启动时先推一份整档，浏览器后连也能立刻看到当前会话。
  if (isTauri()) pushDoc(true);

  if (!isTauri()) return;

  let lastPlayhead = 0;
  watch([() => playback.playhead, () => playback.playing], () => {
    const now = performance.now();
    if (now - lastPlayhead < PLAYHEAD_INTERVAL_MS) return;
    lastPlayhead = now;
    void invoke("session_playhead", {
      time: playback.playhead,
      playing: playback.playing,
    }).catch(() => undefined);
  });
}

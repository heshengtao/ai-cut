/**
 * MCP / 智能体 → webview 的工程命令桥接。
 *
 * Rust 侧收到工具调用后 emit `project-request`；这里执行对应操作，
 * 再 invoke `bridge_respond` 把结果送回 Rust。所有写操作仍走 project store
 * 的统一命令入口，因此时间线会直接更新、撤销历史也一致。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Command, CommandResult } from "@/types/events";
import { isCommandKind } from "@/types/events";
import { EXPORT_ANCHORS } from "@/types/export";
import type { ExportAnchor } from "@/types/export";
import { useProjectStore } from "@/stores/project";
import { isTauri } from "@/utils/platform";
import { t } from "@/i18n";
import * as ai from "@/core/aiActions";
import { extractAudio } from "@/core/editActions";
import * as views from "@/core/projectView";
import { newProject as makeProject } from "@/core/factory";
import { setProjectOutput } from "@/core/ops";
import { serializeProject } from "@/core/serialize";
import { writeProjectFile } from "@/core/media";
import { renderFrame } from "@/core/export/frame";
import { renderStoryboard } from "@/core/export/storyboard";
import { flushHistoryRecords, recordProjectHistory } from "@/core/history";
import {
  collectSubtitleEntries,
  exportSubtitlesToFile,
  importSubtitlesFromFile,
} from "@/core/subtitleActions";
import { usePlaybackStore } from "@/stores/playback";
import { useSelectionStore } from "@/stores/selection";
import { useAsrStore } from "@/stores/asr";
import { useAudioAiStore } from "@/stores/audioAi";
import { useExportStore } from "@/stores/export";
import { useModelsStore } from "@/stores/models";
import { useTtsStore } from "@/stores/tts";
import { useVideoAiStore } from "@/stores/videoAi";
import { useVideoDspStore } from "@/stores/videoDsp";

interface BridgeRequest {
  id: string;
  method: string;
  payload: unknown;
}

let started = false;

export function initProjectBridge(): void {
  if (started || !isTauri()) return;
  started = true;

  const project = useProjectStore();

  void listen<BridgeRequest>("project-request", async (event) => {
    const { id, method, payload } = event.payload;
    try {
      const data = await handle(method, payload, project);
      await invoke("bridge_respond", { id, ok: true, data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await invoke("bridge_respond", { id, ok: false, error: message }).catch(() => undefined);
    }
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(t("error.command.invalidPayload"));
  }
  return value as Record<string, unknown>;
}

function parseCommand(value: unknown): Command {
  const record = asRecord(value);
  if (!isCommandKind(record.kind)) {
    throw new Error(t("error.command.unknownKind", { kind: String(record.kind) }));
  }
  if (typeof record.baseRevision !== "number" || !Number.isFinite(record.baseRevision)) {
    throw new Error(`${t("error.command.invalidPayload")}：baseRevision`);
  }
  return {
    id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
    baseRevision: record.baseRevision,
    actor: record.actor === "human" ? "human" : "agent",
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    kind: record.kind,
    payload: record.payload ?? {},
    label:
      typeof record.label === "string" && record.label
        ? record.label
        : t("agent.command.editTimeline"),
    timestamp:
      typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
        ? record.timestamp
        : Date.now(),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalAnchor(value: unknown): ExportAnchor | undefined {
  return typeof value === "string" && EXPORT_ANCHORS.includes(value as ExportAnchor)
    ? (value as ExportAnchor)
    : undefined;
}

function currentOverview(project: ReturnType<typeof useProjectStore>) {
  return {
    ...views.overview(project.doc, project.revision),
    filePath: project.filePath,
    dirty: project.dirty,
  };
}

async function handle(
  method: string,
  payload: unknown,
  project: ReturnType<typeof useProjectStore>,
): Promise<unknown> {
  const record = asRecord(payload ?? {});

  switch (method) {
    // 渐进式读取：概览只给规格与轨道摘要，细节按关注点单独取。
    case "project.overview":
    case "project.get":
      return currentOverview(project);
    case "project.revision":
      return { revision: project.revision };
    case "project.track": {
      const page = views.trackPage(
        project.doc,
        project.revision,
        record.trackId as string | number | undefined,
        record.offset,
        record.limit,
      );
      if (!page) throw new Error(`轨道不存在：${String(record.trackId ?? "")}`);
      return page;
    }
    case "project.clip": {
      const clipId = optionalString(record.clipId);
      if (!clipId) throw new Error("需要 clipId");
      const detail = views.clipDetail(project.doc, project.revision, clipId);
      if (!detail) throw new Error(`片段不存在：${clipId}`);
      return detail;
    }
    case "project.find_clips": {
      const result = views.findClips(project.doc, project.revision, {
        trackId: record.trackId as string | number | undefined,
        assetId: optionalString(record.assetId),
        text: optionalString(record.text),
        kind: optionalString(record.kind),
        from: optionalNumber(record.from),
        to: optionalNumber(record.to),
        offset: optionalNumber(record.offset),
        limit: optionalNumber(record.limit),
      });
      if (!result) throw new Error(`轨道不存在：${String(record.trackId ?? "")}`);
      return result;
    }
    case "project.markers":
      return views.markers(project.doc, project.revision, {
        from: optionalNumber(record.from),
        to: optionalNumber(record.to),
      });
    case "project.assets":
      return views.assetsPage(project.doc, project.revision, {
        kind: optionalString(record.kind),
        name: optionalString(record.name),
        offline: typeof record.offline === "boolean" ? record.offline : undefined,
        offset: optionalNumber(record.offset),
        limit: optionalNumber(record.limit),
      });
    case "project.context": {
      const playback = usePlaybackStore();
      const selection = useSelectionStore();
      return views.focusContext(project.doc, project.revision, {
        playhead: playback.playhead,
        playing: playback.playing,
        selectedClipIds: selection.selectedClipIds,
        activeTrackId: selection.activeTrackId,
      });
    }

    // 写入：单条 / 批量。批量在草稿上执行，全部成功才提交一次 revision。
    case "project.apply": {
      const command = parseCommand(record.command);
      const result: CommandResult = project.applyCommand(command);
      return result;
    }
    case "project.apply_batch": {
      const raw = record.commands;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error("commands 必须是非空数组");
      }
      if (raw.length > 200) throw new Error("一次最多应用 200 条命令");
      return project.applyCommands(raw.map(parseCommand));
    }
    case "project.undo":
      project.undo();
      return { ok: true, revision: project.revision };
    case "project.redo":
      project.redo();
      return { ok: true, revision: project.revision };

    // 工程生命周期
    case "project.new": {
      const doc = makeProject(optionalString(record.name));
      const patch: { width?: number; height?: number; fps?: number } = {};
      const width = optionalNumber(record.width);
      const height = optionalNumber(record.height);
      const fps = optionalNumber(record.fps);
      if (width !== undefined) patch.width = width;
      if (height !== undefined) patch.height = height;
      if (fps !== undefined) patch.fps = fps;
      project.reset(setProjectOutput(doc, patch), null);
      return currentOverview(project);
    }
    case "project.open": {
      const path = optionalString(record.path);
      if (!path) throw new Error("需要 path");
      await project.openPath(path);
      return currentOverview(project);
    }
    case "project.save": {
      const path = optionalString(record.path);
      if (path) {
        await writeProjectFile(path, serializeProject(project.doc));
        project.markSaved(path);
        recordProjectHistory(project.doc, path, false);
        await flushHistoryRecords();
      } else {
        if (!project.filePath) {
          throw new Error("工程尚未保存，请提供 path");
        }
        if (!(await project.save())) {
          return { saved: false, path: project.filePath, revision: project.revision };
        }
      }
      return { saved: true, path: project.filePath, revision: project.revision };
    }

    case "export.frame": {
      const time = optionalNumber(record.time);
      const outputPath = optionalString(record.outputPath) ?? optionalString(record.path);
      if (time === undefined) throw new Error("需要 time");
      if (!outputPath) throw new Error("需要 outputPath");
      return renderFrame(project.doc, {
        time,
        outputPath,
        resolution:
          record.resolution === "720p" ||
          record.resolution === "1080p" ||
          record.resolution === "custom"
            ? record.resolution
            : "project",
        width: optionalNumber(record.width) ?? null,
        height: optionalNumber(record.height) ?? null,
        fit: record.fit === "cover" ? "cover" : "contain",
        fitAnchor: optionalAnchor(record.fitAnchor),
        fps: optionalNumber(record.fps) ?? null,
      });
    }

    case "export.storyboard": {
      const times = Array.isArray(record.times)
        ? record.times.filter((value): value is number =>
            typeof value === "number" && Number.isFinite(value),
          )
        : [];
      const outputDir = optionalString(record.outputDir);
      if (times.length === 0) throw new Error("需要 times 数组");
      if (!outputDir) throw new Error("需要 outputDir");
      return renderStoryboard(project.doc, {
        times,
        outputDir,
        prefix: optionalString(record.prefix),
        resolution:
          record.resolution === "720p" ||
          record.resolution === "1080p" ||
          record.resolution === "custom"
            ? record.resolution
            : "project",
        width: optionalNumber(record.width) ?? null,
        height: optionalNumber(record.height) ?? null,
        fit: record.fit === "cover" ? "cover" : "contain",
        fitAnchor: optionalAnchor(record.fitAnchor),
        fps: optionalNumber(record.fps) ?? null,
      });
    }

    case "subtitle.import": {
      const path = optionalString(record.path);
      if (!path) throw new Error("需要 path");
      return importSubtitlesFromFile({
        path,
        trackName: optionalString(record.trackName),
        offset: optionalNumber(record.offset),
        actor: record.actor === "human" ? "human" : "agent",
        sessionId: optionalString(record.sessionId),
        baseRevision: optionalNumber(record.baseRevision),
      });
    }
    case "subtitle.export": {
      const outputPath = optionalString(record.outputPath) ?? optionalString(record.path);
      if (!outputPath) throw new Error("需要 outputPath");
      const format =
        record.format === "vtt" ? "vtt" : record.format === "srt" ? "srt" : undefined;
      return exportSubtitlesToFile(
        outputPath,
        collectSubtitleEntries(
          project.doc,
          record.trackId as string | number | undefined,
        ),
        format,
      );
    }

    case "edit.extract_audio":
      return extractAudio({
        ...(asRecord(payload) as { clipId: string; trackName?: string }),
        actor: record.actor === "human" ? "human" : "agent",
        sessionId: optionalString(record.sessionId),
      });
    case "ai.models.list":
      return ai.listAiModels(asRecord(payload) as { feature?: string });
    case "ai.job.start":
      return startAiJob(payload);
    case "ai.job.status":
      return aiJobStatus(payload);
    case "ai.job.cancel":
      return cancelAiJob(payload);
    default:
      throw new Error(`未知的工程桥接方法：${method}`);
  }
}

// ---------------------------------------------------------------------------
// AI 长任务：启动后立刻返回 jobId，Rust 侧轮询状态，避免占住 20 秒桥接超时。
// ---------------------------------------------------------------------------

const AI_JOB_KINDS = [
  "transcribe",
  "separate",
  "denoise",
  "process_audio",
  "loudness",
  "translate",
  "voiceover",
  "upscale",
  "interpolate",
  "reframe",
  "process_video",
  "export",
  "download_model",
] as const;

type AiJobKind = (typeof AI_JOB_KINDS)[number];

interface AiJob {
  id: string;
  kind: AiJobKind;
  status: "running" | "done" | "error";
  result: unknown;
  error: string | null;
  cancelled: boolean;
  /** 触发者：内置智能体是 `chat`，外部 MCP 是会话 id。 */
  actor: "human" | "agent";
  sessionId?: string;
}

const aiJobs = new Map<string, AiJob>();
let activeAiJob: string | null = null;

function isAiJobKind(value: string): value is AiJobKind {
  return (AI_JOB_KINDS as readonly string[]).includes(value);
}

function runAiJob(kind: AiJobKind, params: Record<string, unknown>, job: AiJob): Promise<unknown> {
  const ctx: ai.JobContext = {
    cancelled: () => job.cancelled,
    actor: job.actor,
    sessionId: job.sessionId,
  };
  const args = params as never;
  switch (kind) {
    case "transcribe":
      return ai.transcribe(args, ctx);
    case "separate":
      return ai.separate(args, ctx);
    case "denoise":
      return ai.denoise(args, ctx);
    case "process_audio":
      return ai.processAudio(args, ctx);
    case "loudness":
      return ai.measureLoudness(args, ctx);
    case "translate":
      return ai.translate(args, ctx);
    case "voiceover":
      return ai.synthesizeVoiceover(args, ctx);
    case "upscale":
      return ai.upscale(args, ctx);
    case "interpolate":
      return ai.interpolate(args, ctx);
    case "reframe":
      return ai.reframe(args, ctx);
    case "process_video":
      return ai.processVideo(args, ctx);
    case "export":
      return ai.exportVideo(args, ctx);
    case "download_model":
      return ai.downloadModel(args, ctx);
  }
}

function startAiJob(payload: unknown): { jobId: string } {
  const record = asRecord(payload);
  const kind = String(record.kind ?? "");
  if (!isAiJobKind(kind)) throw new Error(`未知 AI 任务：${kind}`);
  if (activeAiJob) throw new Error("已有 AI 任务正在运行");

  for (const [id, job] of aiJobs) {
    if (job.status !== "running") aiJobs.delete(id);
  }

  const job: AiJob = {
    id: crypto.randomUUID(),
    kind,
    status: "running",
    result: null,
    error: null,
    cancelled: false,
    actor: record.actor === "human" ? "human" : "agent",
    sessionId: optionalString(record.sessionId),
  };
  aiJobs.set(job.id, job);
  activeAiJob = job.id;

  void runAiJob(kind, asRecord(record.params ?? {}), job)
    .then((result) => {
      job.status = "done";
      job.result = result;
    })
    .catch((error: unknown) => {
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      if (activeAiJob === job.id) activeAiJob = null;
    });

  return { jobId: job.id };
}

function aiJobProgress(kind: AiJobKind): number {
  switch (kind) {
    case "transcribe":
      return useAsrStore().progress;
    case "separate":
    case "denoise":
    case "process_audio":
    case "loudness":
      return useAudioAiStore().progress;
    case "translate":
      return Math.max(
        useAsrStore().progress,
        useAudioAiStore().progress,
        useTtsStore().progress,
      );
    case "voiceover":
      return useTtsStore().progress;
    case "upscale":
    case "interpolate":
    case "reframe":
      return useVideoAiStore().progress;
    case "process_video":
      return useVideoDspStore().progress;
    case "export":
      return useExportStore().progress;
    case "download_model":
      return (useModelsStore().progressPct ?? 0) / 100;
  }
}

function aiJobStatus(payload: unknown) {
  const id = String(asRecord(payload).jobId ?? "");
  const job = aiJobs.get(id);
  if (!job) throw new Error(`AI 任务不存在：${id}`);
  return {
    status: job.status,
    progress: job.status === "running" ? aiJobProgress(job.kind) : 1,
    message: job.status === "error" ? job.error : null,
    result: job.result,
    error: job.error,
  };
}

async function cancelAiJob(payload: unknown) {
  const record = asRecord(payload ?? {});
  const id =
    typeof record.jobId === "string" && record.jobId.length > 0
      ? record.jobId
      : activeAiJob;
  const job = id ? aiJobs.get(id) : undefined;
  if (!job) return { cancelled: false };
  job.cancelled = true;
  await Promise.allSettled([
    useAsrStore().cancel(),
    useTtsStore().cancel(),
    useAudioAiStore().cancel(),
    useVideoAiStore().cancel(),
    useVideoDspStore().cancel(),
    useModelsStore().cancel(),
    useExportStore().cancel(),
  ]);
  return { cancelled: true, jobId: job.id };
}
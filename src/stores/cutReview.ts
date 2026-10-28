/**
 * 智能剪口播：识别 → 检测口癖 / 停顿 → 落成剪口 → 在文稿里逐条审查。
 *
 * 剪口落在工程文档里（`cutScopes`），所以「点一下还原」只是删掉一条记录，
 * 时间线按剪口重铺；这个词表只活在内存里，用于显示与追溯。
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { asrCancel, asrTranscribeWords, onAsrProgress } from "@/core/modelApi";
import { useModelsStore } from "@/stores/models";
import { useProjectStore } from "@/stores/project";
import {
  buildParagraphs,
  detectFillers,
  detectPauses,
  mergeProposals,
  withWordIds,
  type FillerOptions,
  type PauseOptions,
  type TranscriptWord,
} from "@/core/cutAnalysis";
import {
  applyCuts,
  clearScope,
  cutSourceRange,
  cutTimelineLength,
  cutTimelineStart,
  removeCut,
  scopeById,
  scopeOfClip,
} from "@/core/cuts";
import { buildCutCues, placeCueTrack } from "@/core/cutSubtitles";
import type { ModelStatus } from "@/types/models";
import type { Clip, CutScope, MediaAsset, Project } from "@/types/project";
import { t } from "@/i18n";

/** 默认识别模型：SenseVoice（自带标点、短句稳），时间交给对齐器。 */
const DEFAULT_ASR = "sense-voice-int8";
/** 词级时间靠这个对齐器：文字谁识别都行，时间由它统一给。 */
const ALIGNER_ID = "qwen3-aligner-0.6b-q4";
const ASR_KEY = "ai-cut-cut-review-asr";

export interface CutReviewOptions {
  /** 超过多少秒算长停顿。 */
  minPause: number;
  /** 是否也剪「那个 / 就是」这类软口癖。 */
  includeSoft: boolean;
}

const OPTIONS_KEY = "ai-cut-cut-review-options";

function loadOptions(): CutReviewOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") as Partial<CutReviewOptions>;
    return {
      minPause: typeof raw.minPause === "number" ? raw.minPause : 0.8,
      includeSoft: raw.includeSoft !== false,
    };
  } catch {
    return { minPause: 0.8, includeSoft: true };
  }
}

export const useCutReviewStore = defineStore("cutReview", () => {
  const running = ref(false);
  const progress = ref(0);
  const message = ref<string | null>(null);
  const words = ref<TranscriptWord[]>([]);
  /** 词时间是否来自模型时间戳；false 时界面要提示只能粗剪。 */
  const timed = ref(true);
  /** 当前审查的素材与片段。 */
  const assetId = ref<string | null>(null);
  const clipId = ref<string | null>(null);
  const modelId = ref<string | null>(null);
  const options = ref<CutReviewOptions>(loadOptions());
  /** 下拉框里选的识别模型。 */
  const asrModelId = ref<string | null>(
    (() => {
      try {
        return localStorage.getItem(ASR_KEY);
      } catch {
        return null;
      }
    })(),
  );

  let stopProgress: (() => void) | null = null;
  let subscribing: Promise<void> | null = null;

  const progressPct = computed(() => Math.min(100, Math.round(progress.value * 100)));
  const paragraphs = computed(() => buildParagraphs(words.value));

  /** 当前片段所属的剪口组。 */
  const scope = computed<CutScope | undefined>(() => {
    if (!clipId.value) return undefined;
    return scopeOfClip(useProjectStore().doc, clipId.value);
  });

  /** 当前这组剪口的全部剪口。 */
  const cuts = computed(() => scope.value?.cuts ?? []);

  /** 剪掉的总时长（秒）。 */
  const removedSeconds = computed(() =>
    (scope.value?.cuts ?? []).reduce((sum, cut) => sum + (cut.srcEnd - cut.srcStart), 0),
  );

  /** 剪口在时间线上的落点，供时间轴画标记。 */
  const timelineCuts = computed(() => {
    const current = scope.value;
    if (!current) return [];
    return current.cuts.map((cut) => ({
      id: cut.id,
      kind: cut.kind,
      start: cutTimelineStart(current, cut),
      length: cutTimelineLength(current, cut),
    }));
  });

  function setAsrModel(id: string): void {
    asrModelId.value = id;
    try {
      localStorage.setItem(ASR_KEY, id);
    } catch {
      // 隐私模式写不了 localStorage，只影响下次记住选择。
    }
  }

  function setOptions(patch: Partial<CutReviewOptions>): void {
    options.value = { ...options.value, ...patch };
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options.value));
    } catch {
      // 隐私模式下写不了 localStorage，只影响下次记住设置。
    }
  }

  /** 用户选的识别模型（下拉框），没选过就用 SenseVoice。 */
  function candidateModel(): ModelStatus | null {
    const models = useModelsStore();
    const all = models.ofFeature("asr");
    const chosen = asrModelId.value ? models.byId(asrModelId.value) : null;
    if (chosen) return chosen;
    return all.find((model) => model.id === DEFAULT_ASR) ?? all.find((model) => model.installed) ?? all[0] ?? null;
  }

  /** 真正能跑的识别模型：必须已经装好。 */
  function pickModel(): ModelStatus | null {
    const model = candidateModel();
    return model?.installed ? model : null;
  }

  /** 对齐器：剪口播必选，没装就不给跑（否则只有估算时间）。 */
  function alignerModel(): ModelStatus | null {
    return useModelsStore().byId(ALIGNER_ID);
  }

  function alignerReady(): boolean {
    return Boolean(alignerModel()?.installed);
  }

  /** 跑一次还差多少下载量（识别模型 + 对齐器）。 */
  function missingBytesNow(): number {
    let total = 0;
    for (const model of [candidateModel(), alignerModel()]) {
      if (model && !model.installed) {
        total += model.files
          .filter((file) => !file.installed)
          .reduce((sum, file) => sum + file.approx_bytes, 0);
      }
    }
    return total;
  }

  function watch(): void {
    if (stopProgress || subscribing) return;
    subscribing = onAsrProgress((payload) => {
      progress.value = payload.progress;
      message.value = payload.message;
      if (payload.state === "done" || payload.state === "error") running.value = false;
    })
      .then((off) => {
        stopProgress = off;
        subscribing = null;
      })
      .catch(() => {
        subscribing = null;
      });
  }

  /**
   * 识别并剪一遍。返回新增的剪口数量；`0` 表示没找到可剪的内容。
   *
   * 剪口一次性全部落地（一次 dispatch、一步撤销），随后在文稿里逐条还原。
   */
  async function run(asset: MediaAsset, clip: Clip): Promise<number> {
    if (running.value) return 0;
    const model = pickModel();
    if (!model) throw new Error(t("cutReview.noModel"));
    if (!alignerReady()) throw new Error(t("cutReview.noAligner"));

    watch();
    running.value = true;
    progress.value = 0;
    message.value = null;
    assetId.value = asset.id;
    clipId.value = clip.id;
    modelId.value = model.id;

    try {
      const result = await asrTranscribeWords(asset.src, model.id);
      words.value = withWordIds(result.words);
      timed.value = result.timed;
      if (words.value.length === 0) return 0;

      const project = useProjectStore();
      const existing = scopeOfClip(project.doc, clip.id);
      const taken = (existing?.cuts ?? []).map((cut) => ({
        srcStart: cut.srcStart,
        srcEnd: cut.srcEnd,
      }));

      const pauseOptions: Partial<PauseOptions> = { minPause: options.value.minPause };
      const fillerOptions: Partial<FillerOptions> = { includeSoft: options.value.includeSoft };
      const proposals = mergeProposals(
        [
          detectFillers(words.value, fillerOptions),
          detectPauses(words.value, pauseOptions),
        ],
        taken,
      );
      if (proposals.length === 0) return 0;

      const applied = project.dispatch(
        (doc) => {
          const cutDoc = applyCuts(
            doc,
            clip.id,
            proposals.map((proposal) => ({
              kind: proposal.kind,
              srcStart: proposal.srcStart,
              srcEnd: proposal.srcEnd,
              text: proposal.text,
            })),
            words.value.map((word) => ({
              text: word.text,
              start: word.start,
              end: word.end,
            })),
            result.timed,
          );
          // 剪完把剩下的词落成字幕片段：改字去时间线上改，这里只负责剪和还原。
          const scope = scopeOfClip(cutDoc, clip.id);
          if (!scope) return cutDoc;
          const cues = buildCutCues(
            scope,
            words.value,
            cutDoc.tracks.flatMap((track) => track.clips),
            cutDoc.fps,
          );
          return placeCueTrack(cutDoc, cues, t("cutReview.cueTrack"));
        },
        {
          kind: "ui.dispatch",
          actor: "human",
          label: t("cutReview.commandLabel", { count: proposals.length }),
        },
      );
      return applied ? proposals.length : 0;
    } finally {
      running.value = false;
    }
  }

  /**
   * 打开工程后把词表接回来：剪口与词表都存在工程里，
   * 所以重新打开也能逐字审查、点一下还原。
   */
  function adopt(clip: Clip): void {
    const current = scopeOfClip(useProjectStore().doc, clip.id);
    // 只有落在剪口组里的片段才是这段文稿的一部分；点到字幕片段或别的素材时不动当前审查。
    if (!current) return;
    if (clipId.value !== clip.id) {
      if (words.value.length > 0) words.value = [];
      timed.value = true;
    }
    clipId.value = clip.id;
    assetId.value = current.assetId;
    if (current.words && current.words.length > 0 && words.value.length === 0) {
      words.value = withWordIds(current.words);
      timed.value = current.timed !== false;
    }
  }

  /**
   * 按当前剪口重铺「口播字幕」轨。
   *
   * 剪口一变，字幕就要跟着合并 / 拆开：恢复一段之后原来被切开的句子要接回去，
   * 新剪掉的字要从字幕里消失。每次改剪口都在同一个 dispatch 里调它。
   */
  function refreshCues(doc: Project, scopeId: string): Project {
    const current = scopeById(doc, scopeId);
    if (!current?.words?.length) return doc;
    const cues = buildCutCues(
      current,
      current.words,
      doc.tracks.flatMap((track) => track.clips),
      doc.fps,
    );
    return placeCueTrack(doc, cues, t("cutReview.cueTrack"));
  }

  /** 在文稿里手动剪掉一段。 */
  function cutWords(from: number, to: number, text: string): boolean {
    const targetClip = clipId.value;
    if (!targetClip) return false;
    let changed = false;
    useProjectStore().dispatch(
      (doc) => {
        const next = cutSourceRange(doc, targetClip, from, to, "manual", text);
        if (next === doc) return doc;
        changed = true;
        const current = scopeOfClip(next, targetClip);
        return current ? refreshCues(next, current.id) : next;
      },
      {
        kind: "ui.dispatch",
        actor: "human",
        label: t("cutReview.cutSelection", { value: `${(to - from).toFixed(1)}s` }),
      },
    );
    return changed;
  }

  /** 还原一条剪口。 */
  function restoreCut(cutId: string): void {
    const current = scope.value;
    if (!current) return;
    const cut = current.cuts.find((item) => item.id === cutId);
    if (!cut) return;
    useProjectStore().dispatch(
      (doc) => refreshCues(removeCut(doc, current.id, cutId), current.id),
      {
        kind: "ui.dispatch",
        actor: "human",
        label: t("cutReview.restoreLabel", { text: cut.text || t("cutReview.pauseText") }),
      },
    );
  }

  /** 还原这一组剪口的全部剪口。 */
  function restoreAll(): void {
    const current = scope.value;
    if (!current || current.cuts.length === 0) return;
    const count = current.cuts.length;
    useProjectStore().dispatch(
      (doc) => refreshCues(clearScope(doc, current.id), current.id),
      {
        kind: "ui.dispatch",
        actor: "human",
        label: t("cutReview.restoreAllLabel", { count }),
      },
    );
  }

  /** 放弃当前审查（不动文档）。 */
  function reset(): void {
    words.value = [];
    clipId.value = null;
    assetId.value = null;
    timed.value = true;
  }

  async function cancel(): Promise<void> {
    try {
      await asrCancel();
    } catch {
      // 终态事件会纠正状态。
    }
  }

  return {
    running,
    progress,
    progressPct,
    message,
    words,
    timed,
    paragraphs,
    assetId,
    clipId,
    modelId,
    options,
    scope,
    cuts,
    removedSeconds,
    timelineCuts,
    setOptions,
    asrModelId,
    setAsrModel,
    candidateModel,
    pickModel,
    alignerModel,
    alignerReady,
    missingBytesNow,
    adopt,
    run,
    cutWords,
    restoreCut,
    restoreAll,
    reset,
    cancel,
  };
});

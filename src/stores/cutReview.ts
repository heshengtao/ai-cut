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
  cutTimelineLength,
  cutTimelineStart,
  removeCut,
  scopeOfClip,
  updateScopeWords,
} from "@/core/cuts";
import type { ModelStatus } from "@/types/models";
import type { Clip, CutScope, MediaAsset } from "@/types/project";
import { t } from "@/i18n";

/** 默认识别模型偏好：Paraformer 有原生 token 时间戳，是剪口播的主力。 */
const PREFERRED_MODELS = ["paraformer-trilingual-int8", "paraformer-zh-small-int8"];

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

  function setOptions(patch: Partial<CutReviewOptions>): void {
    options.value = { ...options.value, ...patch };
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options.value));
    } catch {
      // 隐私模式下写不了 localStorage，只影响下次记住设置。
    }
  }

  /** 可用的识别模型：优先 Paraformer，其次任意已安装的 ASR。 */
  function pickModel(): ModelStatus | null {
    const models = useModelsStore();
    const installed = models.ofFeature("asr").filter((model) => model.installed);
    for (const id of PREFERRED_MODELS) {
      const hit = installed.find((model) => model.id === id);
      if (hit) return hit;
    }
    return installed.find((model) => model.family === "paraformer") ?? installed[0] ?? null;
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
        (doc) =>
          applyCuts(
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
          ),
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
    if (clipId.value !== clip.id) {
      // 换了片段：清掉上一段的词表，免得审查到别的素材上。
      if (words.value.length > 0) words.value = [];
      timed.value = true;
    }
    clipId.value = clip.id;
    assetId.value = current?.assetId ?? clip.assetId;
    if (current?.words && current.words.length > 0 && words.value.length === 0) {
      words.value = withWordIds(current.words);
      timed.value = current.timed !== false;
    }
  }

  /**
   * 改一个词的文本（改错别字）。只写词表，不碰时间线，因此不会触发剪切。
   */
  function renameWord(index: number, text: string): void {
    const word = words.value[index];
    const current = scope.value;
    const value = text.trim();
    if (!word || !current?.words || !value || word.text === value) return;
    word.text = value;
    const next = current.words.map((item, at) =>
      at === index ? { ...item, text: value } : item,
    );
    useProjectStore().dispatch((doc) => updateScopeWords(doc, current.id, next), {
      kind: "ui.dispatch",
      actor: "human",
      label: t("cutReview.editLabel"),
    });
  }

  /** 还原一条剪口。 */
  function restoreCut(cutId: string): void {
    const current = scope.value;
    if (!current) return;
    const cut = current.cuts.find((item) => item.id === cutId);
    if (!cut) return;
    useProjectStore().dispatch((doc) => removeCut(doc, current.id, cutId), {
      kind: "ui.dispatch",
      actor: "human",
      label: t("cutReview.restoreLabel", { text: cut.text || t("cutReview.pauseText") }),
    });
  }

  /** 还原这一组剪口的全部剪口。 */
  function restoreAll(): void {
    const current = scope.value;
    if (!current || current.cuts.length === 0) return;
    const count = current.cuts.length;
    useProjectStore().dispatch((doc) => clearScope(doc, current.id), {
      kind: "ui.dispatch",
      actor: "human",
      label: t("cutReview.restoreAllLabel", { count }),
    });
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
    pickModel,
    adopt,
    run,
    renameWord,
    restoreCut,
    restoreAll,
    reset,
    cancel,
  };
});

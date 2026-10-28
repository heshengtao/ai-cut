/**
 * 口癖与长停顿的本地检测。
 *
 * 只做「同一份输入必须得出同一个结论」的部分：给词的素材内时间，返回要剪的素材区间。
 * 不碰文档、不碰 UI，方便单测；时间来自 ASR 的 token 时间戳（Paraformer / Whisper）。
 */
import type { CutKind } from "@/types/project";

/** 一个识别出的词，`start` / `end` 是素材内秒。 */
export interface TranscriptWord {
  id: string;
  text: string;
  start: number;
  end: number;
}

/** 一条待剪的建议。 */
export interface ProposedCut {
  kind: CutKind;
  /** 素材内起点（秒）。 */
  srcStart: number;
  /** 素材内终点（秒）。 */
  srcEnd: number;
  /** 命中的词 id，展示用。 */
  wordIds: string[];
  /** 被剪掉的原文。 */
  text: string;
  /** 一句话说明，审查面板展示。 */
  reason: string;
}

export interface PauseOptions {
  /** 超过这个间隔才算长停顿（秒）。 */
  minPause: number;
  /** 段中停顿压缩到多长（秒）。 */
  keep: number;
  /** 句末停顿压缩到多长（秒）。 */
  sentenceKeep: number;
  /** 超过这个间隔就不算停顿（多半是换场 / 换人），默认 4 秒。 */
  maxGap: number;
}

export const DEFAULT_PAUSE: PauseOptions = {
  minPause: 0.8,
  keep: 0.3,
  sentenceKeep: 0.4,
  maxGap: 4,
};

export interface FillerOptions {
  lang: "zh" | "en" | "both";
  /** 也命中「那个 / 就是 / you know」这类软口癖（要求前后有停顿）。 */
  includeSoft: boolean;
}

export const DEFAULT_FILLER: FillerOptions = {
  lang: "both",
  includeSoft: true,
};

/** 硬口癖：几乎只作语气词，命中就剪。 */
const HARD: Record<string, string[]> = {
  zh: ["嗯", "呃", "额", "唔", "唉", "哎"],
  en: ["um", "umm", "uh", "uhh", "er", "erm", "hmm", "mhm", "ah"],
};

/** 软口癖：也可能是正常词汇，要求前后有停顿或标点才剪。 */
const SOFT: Record<string, string[]> = {
  zh: ["那个", "这个", "就是", "然后", "其实", "反正", "对吧", "你知道吧", "怎么说"],
  en: ["you know", "i mean", "kind of", "sort of", "like", "basically", "actually", "literally", "honestly"],
};

/** 停顿上的两个词之间小于这个值就不算「隔离」。 */
const ISOLATION_GAP = 0.12;

/** 去掉标点、空白并转小写，用于比对口癖词表。 */
export function normalizeWord(text: string): string {
  return text
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .toLowerCase();
}

/** 给词补上稳定 id（`w0`、`w1`…），数组顺序即语音顺序。 */
export function withWordIds(
  words: { text: string; start: number; end: number }[],
): TranscriptWord[] {
  return words.map((word, index) => ({
    id: `w${index}`,
    text: word.text,
    start: word.start,
    end: word.end,
  }));
}

function sentenceEnd(text: string): boolean {
  return /[。！？.!?…；;]\s*["'”’」』]?$/.test(text.trim());
}

function hasPunctuation(text: string): boolean {
  return /[\p{P}]/u.test(text);
}

/**
 * 长停顿：相邻两个词之间超过 `minPause` 的静音，保留头尾各 `keep/2` 秒。
 *
 * 只处理词与词之间的停顿；片头片尾的静音不剪，避免把开头的气口剪掉。
 */
export function detectPauses(
  words: TranscriptWord[],
  options: Partial<PauseOptions> = {},
): ProposedCut[] {
  const opts = { ...DEFAULT_PAUSE, ...options };
  const out: ProposedCut[] = [];
  for (let index = 0; index + 1 < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    const gap = next.start - word.end;
    if (gap < opts.minPause || gap > opts.maxGap) continue;
    const keep = sentenceEnd(word.text) ? opts.sentenceKeep : opts.keep;
    const srcStart = word.end + keep / 2;
    const srcEnd = next.start - keep / 2;
    if (srcEnd - srcStart < 0.15) continue;
    out.push({
      kind: "pause",
      srcStart,
      srcEnd,
      wordIds: [word.id, next.id],
      text: "",
      reason: `${gap.toFixed(1)}s → ${keep.toFixed(1)}s`,
    });
  }
  return out;
}

/**
 * 一段词（可能是多词口癖）是否被停顿或标点隔离。
 *
 * 录音开头没有「前一个词」，所以不把「句首」本身当成隔离——否则一句
 * 「那个东西」会被误剪；真正的口癖后面通常跟着停顿。
 */
function isolatedSpan(words: TranscriptWord[], startIndex: number, endIndex: number): boolean {
  const first = words[startIndex];
  const last = words[endIndex];
  const previous = words[startIndex - 1];
  const next = words[endIndex + 1];
  const beforePause = previous ? first.start - previous.end >= ISOLATION_GAP : false;
  const afterPause = next ? next.start - last.end >= ISOLATION_GAP : false;
  if (beforePause || afterPause) return true;
  if (previous && hasPunctuation(previous.text)) return true;
  return hasPunctuation(last.text);
}

/**
 * 口癖：硬口癖直接命中，软口癖要求前后有停顿或标点。
 *
 * 词表按语言取；中文软口癖是整词比对（「就是」不会命中「就是说」里的两个字）。
 */
export function detectFillers(
  words: TranscriptWord[],
  options: Partial<FillerOptions> = {},
): ProposedCut[] {
  const opts = { ...DEFAULT_FILLER, ...options };
  const langs = opts.lang === "both" ? ["zh", "en"] : [opts.lang];
  const out: ProposedCut[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const normalized = normalizeWord(words[index].text);
    if (!normalized) continue;

    let matched: { length: number; text: string; soft: boolean } | null = null;
    for (const lang of langs) {
      if ((HARD[lang] ?? []).includes(normalized)) {
        matched = { length: 1, text: normalized, soft: false };
        break;
      }
    }

    if (!matched && opts.includeSoft) {
      for (const lang of langs) {
        for (const item of SOFT[lang] ?? []) {
          const parts = item.split(" ").filter(Boolean);
          if (index + parts.length > words.length) continue;
          const hit = parts.every(
            (part, offset) => normalizeWord(words[index + offset].text) === part,
          );
          if (!hit) continue;
          if (!isolatedSpan(words, index, index + parts.length - 1)) continue;
          matched = { length: parts.length, text: parts.join(""), soft: true };
          break;
        }
        if (matched) break;
      }
    }
    if (!matched) continue;

    const span = words.slice(index, index + matched.length);
    const srcStart = span[0].start;
    const srcEnd = span[span.length - 1].end;
    if (srcEnd - srcStart < 0.05) continue;
    out.push({
      kind: "filler",
      srcStart,
      srcEnd,
      wordIds: span.map((word) => word.id),
      text: span.map((word) => word.text).join(""),
      reason: matched.soft ? "口头禅" : "语气词",
    });
    index += matched.length - 1;
  }
  return out;
}

/**
 * 合并三类建议：重叠的只留一条（口癖优先于停顿），并按时间排序。
 *
 * `taken` 是已经剪掉的素材区间，命中的建议不再提出（重复扫描时不会越剪越多）。
 */
export function mergeProposals(
  groups: ProposedCut[][],
  taken: { srcStart: number; srcEnd: number }[] = [],
): ProposedCut[] {
  const ordered = groups
    .flat()
    .sort((a, b) => a.srcStart - b.srcStart || b.srcEnd - b.srcStart - (a.srcEnd - a.srcStart));
  const out: ProposedCut[] = [];
  const overlaps = (a: { srcStart: number; srcEnd: number }, b: { srcStart: number; srcEnd: number }) =>
    a.srcStart < b.srcEnd && b.srcStart < a.srcEnd;

  for (const proposal of ordered) {
    if (taken.some((range) => overlaps(proposal, range))) continue;
    if (out.some((item) => overlaps(item, proposal))) continue;
    out.push(proposal);
  }
  return out;
}

/** 词是否落在某条剪口里（按词中点判断，与引擎侧的判定一致）。 */
export function wordIsCut(
  word: { start: number; end: number },
  cuts: { srcStart: number; srcEnd: number }[],
): boolean {
  const middle = (word.start + word.end) / 2;
  return cuts.some((cut) => middle >= cut.srcStart && middle < cut.srcEnd);
}

/** 把词排成段落：停顿超过 0.8 秒或一行超过 36 个字就换行。 */
export function buildParagraphs(
  words: TranscriptWord[],
  maxChars = 36,
): TranscriptWord[][] {
  const paragraphs: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];
  let chars = 0;
  let lastEnd = 0;
  for (const word of words) {
    const gap = current.length > 0 ? word.start - lastEnd : 0;
    if (current.length > 0 && (gap > 0.8 || chars >= maxChars || sentenceEnd(current[current.length - 1].text))) {
      paragraphs.push(current);
      current = [];
      chars = 0;
    }
    current.push(word);
    chars += word.text.length;
    lastEnd = word.end;
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

/** 一段词按中位数基准重排 id（重新识别后 id 会变，展示用）。 */
export function totalDuration(cuts: { srcStart: number; srcEnd: number }[]): number {
  return cuts.reduce((sum, cut) => sum + Math.max(0, cut.srcEnd - cut.srcStart), 0);
}

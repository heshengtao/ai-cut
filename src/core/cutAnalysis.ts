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
  /** 用户自己加的过滤词：多字也算，命中就剪，不做停顿要求。 */
  custom?: string[];
  /** 用户在设置里移除的默认过滤词，命中时跳过（按归一化文本比对）。 */
  disabled?: string[];
}

export const DEFAULT_FILLER: FillerOptions = {
  lang: "both",
  includeSoft: true,
  custom: [],
  disabled: [],
};

/** 硬口癖：几乎只作语气词，命中就剪。 */
export const HARD_FILLERS: Record<"zh" | "en", readonly string[]> = {
  zh: ["嗯", "呃", "额", "唔", "唉", "哎"],
  en: ["um", "umm", "uh", "uhh", "er", "erm", "hmm", "mhm", "ah"],
};

/** 软口癖：也可能是正常词汇，要求前后有停顿或标点才剪。 */
export const SOFT_FILLERS: Record<"zh" | "en", readonly string[]> = {
  zh: ["那个", "这个", "就是", "然后", "其实", "反正", "对吧", "你知道吧", "怎么说"],
  en: ["you know", "i mean", "kind of", "sort of", "like", "basically", "actually", "literally", "honestly"],
};

/** 设置里展示的默认过滤词：中英合并，按「直接剪 / 有停顿才剪」分组。 */
export function defaultFillerWords(): { hard: string[]; soft: string[] } {
  return {
    hard: [...HARD_FILLERS.zh, ...HARD_FILLERS.en],
    soft: [...SOFT_FILLERS.zh, ...SOFT_FILLERS.en],
  };
}

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
 * 软口癖匹配：返回从 `index` 起要吃掉的词数与归一化后的文本。
 *
 * 中文词表是逐字的（「那」「个」），英文是整词的（you / know），两条路子都走一遍。
 */
function matchSoft(
  phrase: string,
  words: TranscriptWord[],
  index: number,
): { length: number; text: string } | null {
  const target = normalizeWord(phrase);
  if (!target) return null;

  if (phrase.includes(" ")) {
    // 英文短语按空格分词，词表大小写不敏感（I mean / i mean 都行）。
    const parts = phrase.split(" ").filter(Boolean).map(normalizeWord);
    if (index + parts.length > words.length) return null;
    const hit = parts.every((part, offset) => normalizeWord(words[index + offset].text) === part);
    return hit ? { length: parts.length, text: target } : null;
  }

  let text = "";
  let count = 0;
  while (index + count < words.length && text.length < target.length) {
    text += normalizeWord(words[index + count].text);
    count += 1;
  }
  return text === target ? { length: count, text } : null;
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
  const langs: ("zh" | "en")[] = opts.lang === "both" ? ["zh", "en"] : [opts.lang];
  const disabled = new Set(
    (opts.disabled ?? []).map((word) => normalizeWord(word)).filter(Boolean),
  );
  const out: ProposedCut[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const normalized = normalizeWord(words[index].text);
    if (!normalized) continue;
    // 设置里被移除的默认词：整词命中也不剪。
    if (disabled.has(normalized)) continue;

    let matched: { length: number; text: string; soft: boolean } | null = null;
    for (const lang of langs) {
      if ((HARD_FILLERS[lang] ?? []).includes(normalized)) {
        matched = { length: 1, text: normalized, soft: false };
        break;
      }
    }

    if (!matched && opts.custom && opts.custom.length > 0) {
      for (const phrase of opts.custom) {
        if (disabled.has(normalizeWord(phrase))) continue;
        const span = matchSoft(phrase, words, index);
        if (!span) continue;
        matched = { length: span.length, text: span.text, soft: true };
        break;
      }
    }

    if (!matched && opts.includeSoft) {
      for (const lang of langs) {
        for (const item of SOFT_FILLERS[lang] ?? []) {
          if (disabled.has(normalizeWord(item))) continue;
          // 中文口癖（那个 / 就是 / 其实）在词表里是逐字的，要按字拼起来比；
          // 英文（you know）按空格分词比。
          const span = matchSoft(item, words, index);
          if (!span) continue;
          if (!isolatedSpan(words, index, index + span.length - 1)) continue;
          matched = { length: span.length, text: span.text, soft: true };
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

export interface TrimOptions {
  /** 切点向两侧静音最多扩展多少秒（0 = 不扩展）。 */
  pad: number;
  /** 与相邻词之间至少保留的安全间隔（秒），避免切到相邻字的起音。 */
  guard: number;
}

export const DEFAULT_TRIM: TrimOptions = { pad: 0.12, guard: 0.02 };

function trimLimits(
  words: TranscriptWord[],
  first: number,
  last: number,
  guard: number,
): { floor: number; ceil: number } {
  const prev = words[first - 1];
  const next = words[last + 1];
  // 留出 guard，避免切到相邻字的起音；相邻词本身要被剪时，
  // 两条剪口在 mergeProposals 里会按很近的间隔合并，不必在这里吃穿。
  return {
    floor: prev ? prev.end + guard : 0,
    ceil: next ? next.start - guard : Number.POSITIVE_INFINITY,
  };
}

/**
 * 把口癖剪口向两侧的静音扩展。
 *
 * ASR 的词时间戳常常停在字音的峰值上：按时间戳直接切，字的起音 / 尾音会留在切点外，
 * 剪完还能听到半声「嗯」。这里向相邻词之间的静音多吃 `pad` 秒，让切点落在安静处；
 * 扩展不会越过相邻词，且只扩不缩。
 */
export function padFillerCuts(
  cuts: ProposedCut[],
  words: TranscriptWord[],
  options: Partial<TrimOptions> = {},
): ProposedCut[] {
  const opts = { ...DEFAULT_TRIM, ...options };
  const pad = Math.max(0, opts.pad);
  const guard = Math.max(0, opts.guard);
  if (pad <= 0 || words.length === 0) return cuts;

  const indexes = new Map(words.map((word, index) => [word.id, index]));

  return cuts.map((cut) => {
    if (cut.kind !== "filler" || cut.wordIds.length === 0) return cut;
    const first = indexes.get(cut.wordIds[0]);
    const last = indexes.get(cut.wordIds[cut.wordIds.length - 1]);
    if (first === undefined || last === undefined) return cut;
    const { floor, ceil } = trimLimits(words, first, last, guard);
    // 只扩不缩：时间戳互相重叠时也不能把剪口改短。
    const srcStart = Math.min(cut.srcStart, Math.max(floor, cut.srcStart - pad));
    const srcEnd = Math.max(cut.srcEnd, Math.min(ceil, cut.srcEnd + pad));
    if (srcStart === cut.srcStart && srcEnd === cut.srcEnd) return cut;
    return { ...cut, srcStart, srcEnd };
  });
}

/**
 * 手动剪掉一段词时，同样向两侧静音扩展一点，避免切点卡在字音峰值上。
 * `from` / `to` 一般是所选词的首尾时间。
 */
export function padCutRange(
  words: TranscriptWord[],
  from: number,
  to: number,
  options: Partial<TrimOptions> = {},
): { start: number; end: number } {
  const opts = { ...DEFAULT_TRIM, ...options };
  const pad = Math.max(0, opts.pad);
  if (pad <= 0 || words.length === 0) return { start: from, end: to };

  let first = -1;
  let last = -1;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.end <= from + 1e-6) continue;
    if (word.start >= to - 1e-6) break;
    if (first < 0) first = index;
    last = index;
  }
  if (first < 0 || last < 0) return { start: from, end: to };

  const { floor, ceil } = trimLimits(words, first, last, Math.max(0, opts.guard));
  return {
    start: Math.min(from, Math.max(floor, from - pad)),
    end: Math.max(to, Math.min(ceil, to + pad)),
  };
}

function overlaps(
  a: { srcStart: number; srcEnd: number },
  b: { srcStart: number; srcEnd: number },
): boolean {
  return a.srcStart < b.srcEnd && b.srcStart < a.srcEnd;
}

/** 两条口癖剪口间隔小于这个值时直接并成一条（避免中间漏 10ms 的气口）。 */
const FILLER_MERGE_GAP = 0.03;

/** 把互相重叠 / 相邻的口癖剪口并成一条（扩展后很容易碰到一起）。 */
function unionFillerCuts(cuts: ProposedCut[]): ProposedCut[] {
  const ordered = cuts
    .slice()
    .sort((a, b) => a.srcStart - b.srcStart || a.srcEnd - b.srcEnd);
  const out: ProposedCut[] = [];
  for (const cut of ordered) {
    const last = out[out.length - 1];
    if (last && cut.srcStart <= last.srcEnd + FILLER_MERGE_GAP) {
      last.srcEnd = Math.max(last.srcEnd, cut.srcEnd);
      for (const id of cut.wordIds) {
        if (!last.wordIds.includes(id)) last.wordIds.push(id);
      }
      last.text += cut.text;
      continue;
    }
    out.push({ ...cut, wordIds: [...cut.wordIds] });
  }
  return out;
}

/** 从一条建议里挖掉口癖已经占用的区间，剩下的部分照常剪。 */
function subtractCut(
  cut: ProposedCut,
  holes: { srcStart: number; srcEnd: number }[],
): ProposedCut[] {
  let segments = [{ start: cut.srcStart, end: cut.srcEnd }];
  for (const hole of holes) {
    const next: { start: number; end: number }[] = [];
    for (const segment of segments) {
      if (hole.srcEnd <= segment.start + 1e-6 || hole.srcStart >= segment.end - 1e-6) {
        next.push(segment);
        continue;
      }
      if (hole.srcStart > segment.start + 1e-6) {
        next.push({ start: segment.start, end: hole.srcStart });
      }
      if (hole.srcEnd < segment.end - 1e-6) {
        next.push({ start: hole.srcEnd, end: segment.end });
      }
    }
    segments = next;
  }
  return segments
    .filter((segment) => segment.end - segment.start > 0.05)
    .map((segment) => ({ ...cut, srcStart: segment.start, srcEnd: segment.end }));
}

/**
 * 合并三类建议：重叠的只留一条（口癖优先于停顿），并按时间排序。
 *
 * 口癖先合并成并集，再把停顿从口癖区间里挖掉——扩展切点后两者很容易重叠，
 * 若简单丢掉后一条，会把口癖的后半段或停顿的剩余部分留进时间线。
 *
 * `taken` 是已经剪掉的素材区间，命中的建议不再提出（重复扫描时不会越剪越多）。
 */
export function mergeProposals(
  groups: ProposedCut[][],
  taken: { srcStart: number; srcEnd: number }[] = [],
): ProposedCut[] {
  const fresh = groups.flat().filter((proposal) => !taken.some((range) => overlaps(proposal, range)));
  const fillers = unionFillerCuts(fresh.filter((proposal) => proposal.kind === "filler"));
  const holes = fillers.map((cut) => ({ srcStart: cut.srcStart, srcEnd: cut.srcEnd }));
  const out: ProposedCut[] = [...fillers];

  for (const proposal of fresh) {
    if (proposal.kind === "filler") continue;
    for (const piece of subtractCut(proposal, holes)) {
      if (out.some((item) => overlaps(item, piece))) continue;
      out.push(piece);
    }
  }
  return out.sort((a, b) => a.srcStart - b.srcStart || a.srcEnd - b.srcEnd);
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

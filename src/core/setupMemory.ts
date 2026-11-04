/**
 * **「这个功能已经引导过了」的记忆**（localStorage）。
 *
 * 规则：
 * - 按「功能 + 当时推荐的后端」记一条。用户换了显卡 / 驱动升级导致推荐变化时，
 *   会再引导一次——那说明之前的对话已经不适用了；
 * - 用户点过「稍后」也算引导过：不要每次进页面都糊一脸模态框；
 * - 但用户**主动**点「下载 / 准备」时永远弹，这里只管「自动弹」。
 */
const KEY = "ai-cut-setup-seen";

type Seen = Record<string, string>;

function read(): Seen {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Seen = {};
    for (const [feature, backend] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof backend === "string" && backend.length > 0) out[feature] = backend;
    }
    return out;
  } catch {
    // 无痕模式 / 存储被禁用：当作「没引导过」，最多多弹一次，不影响功能。
    return {};
  }
}

let memory: Seen | null = null;

function table(): Seen {
  memory ??= read();
  return memory;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(table()));
  } catch {
    // 存不下就只在本次会话生效。
  }
}

/** 这个功能在当前推荐后端下是否已经引导过。 */
export function hasSeen(feature: string, backend: string): boolean {
  return table()[feature] === backend;
}

/** 记下「引导过了」（`backend` 是当时的推荐后端）。 */
export function markSeen(feature: string, backend: string): void {
  table()[feature] = backend;
  persist();
}

/** 忘掉这个功能（装好之后调用：下次换机器才会重新提示）。 */
export function forgetSeen(feature: string): void {
  const seen = table();
  if (!(feature in seen)) return;
  delete seen[feature];
  persist();
}

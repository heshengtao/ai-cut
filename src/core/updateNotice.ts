/**
 * 「更新完成」提示：用 localStorage 记住上次运行的版本，启动时对比当前版本。
 *
 * 首次安装（没有记录）不打扰用户；版本升级后首次启动才提示一次。
 */

/** 上次运行版本号的持久化键。 */
const KEY = "ai-cut-last-version";

/** 对应版本的 GitHub Release 页面；版本号为空时退回发布列表。 */
export function releaseNotesUrl(version: string): string {
  const clean = version.trim().replace(/^v/i, "");
  const base = "https://github.com/heshengtao/ai-cut/releases";
  return clean ? `${base}/tag/v${clean}` : base;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function parse(version: string): { core: number[]; pre: string } {
  const clean = version.trim().replace(/^v/i, "");
  const dash = clean.indexOf("-");
  const corePart = dash >= 0 ? clean.slice(0, dash) : clean;
  return {
    core: corePart.split(".").map((part) => Number.parseInt(part, 10) || 0),
    pre: dash >= 0 ? clean.slice(dash + 1) : "",
  };
}

/** 比较两个版本号：`a > b` 返回 1，相等 0，小于 -1。 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  // 正式版高于同号的预发布版。
  if (!left.pre && right.pre) return 1;
  if (left.pre && !right.pre) return -1;
  if (left.pre === right.pre) return 0;
  return left.pre > right.pre ? 1 : -1;
}

/** 当前版本是否比上次记录的新（需要在启动时提示更新完成）。 */
export function shouldNotice(last: string | null, current: string): boolean {
  if (!last || !current || last === current) return false;
  return compareVersions(current, last) > 0;
}

/**
 * 记录当前版本，并返回被更新前的版本号（不需要提示时返回 `null`）。
 *
 * 每次启动都应调用：即使不提示，也要把版本号写回去，避免下次重复比较旧值。
 */
export function takeUpdateNotice(current: string): string | null {
  if (!current) return null;
  const store = storage();
  let last: string | null = null;
  try {
    last = store?.getItem(KEY) ?? null;
  } catch {
    // 读不到就当首次安装。
  }
  try {
    store?.setItem(KEY, current);
  } catch {
    // 存不住也不影响本次启动。
  }
  return shouldNotice(last, current) ? last : null;
}

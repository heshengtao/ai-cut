/**
 * UI 命令表：快捷键、右键菜单、未来的命令面板都从这里取。
 *
 * 注意与 `core/commands/` 区分：那是「可序列化命令」（AI 写操作的纯数据），
 * 这里是「人在界面上触发的动作」。插件要加的是后者。
 *
 * 为什么要有它：`shortcuts.ts` 原来是一个巨大的 `onKeyDown`，键位写死在分支里；
 * 插件要加命令就必须能注册。
 */
export interface CommandSpec {
  /** 全局唯一：`<域>.<动作>`，插件命令必须以 `ext.<插件短 id>.` 开头。 */
  id: string;
  /** i18n key（插件命令可指向插件自己的词典）。 */
  titleKey: string;
  /** 键位描述：`mod+shift+k`；`mod` = ⌘ / Ctrl。 */
  key?: string;
  /** 生效条件；返回 false 时既不响应快捷键也不出现在菜单里。 */
  when?: () => boolean;
  run: () => void | Promise<void>;
  owner?: string;
}

interface Entry {
  spec: CommandSpec;
  owner: string;
}

const COMMANDS = new Map<string, Entry>();
const KEYS = new Map<string, string>();

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .sort()
    .join("+");
}

export function registerCommand(spec: CommandSpec): () => void {
  const owner = spec.owner ?? "core";
  const existing = COMMANDS.get(spec.id);
  if (existing) {
    throw new Error(`命令 ${spec.id} 已被 ${existing.owner} 注册，不能重复注册`);
  }
  const key = spec.key ? normalizeKey(spec.key) : null;
  if (key) {
    const holder = KEYS.get(key);
    if (holder && holder !== spec.id) {
      throw new Error(`键位 ${spec.key} 已被 ${COMMANDS.get(holder)?.owner ?? holder} 占用`);
    }
    KEYS.set(key, spec.id);
  }
  COMMANDS.set(spec.id, { spec, owner });
  return () => {
    if (COMMANDS.get(spec.id)?.spec !== spec) return;
    COMMANDS.delete(spec.id);
    if (key && KEYS.get(key) === spec.id) KEYS.delete(key);
  };
}

export function commands(): CommandSpec[] {
  return [...COMMANDS.values()]
    .filter((entry) => entry.spec.when?.() ?? true)
    .map((entry) => entry.spec);
}

export function commandFor(id: string): CommandSpec | null {
  return COMMANDS.get(id)?.spec ?? null;
}

export async function runCommand(id: string): Promise<boolean> {
  const spec = commandFor(id);
  if (!spec) return false;
  if (spec.when && !spec.when()) return false;
  await spec.run();
  return true;
}

/** 把一次 keydown 映射到命令；没有命中返回 null。 */
export function matchShortcut(event: KeyboardEvent): CommandSpec | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.shiftKey) parts.push("shift");
  if (event.altKey) parts.push("alt");
  const name = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(name.toLowerCase());
  const id = KEYS.get(parts.sort().join("+"));
  if (!id) return null;
  const spec = commandFor(id);
  if (!spec || (spec.when && !spec.when())) return null;
  return spec;
}

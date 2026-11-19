/**
 * 回归：插件节点的 `io.param` 必须回落到定义里的默认值。
 *
 * 真实事故：第三方节点把接口基址写在 `params[].default` 里，用户在卡片上看到默认值
 * 就没再改；但 `data.params` 里只有用户动过的字段，`io.param("base")` 拿到
 * `undefined` → `host.run` 抛「缺少接口基址」。卡片显示的和运行器读到的必须是同一个值。
 */
import { afterEach, describe, expect, it } from "vitest";

import { registerAdapter } from "@/core/board/adapters";
import { registerNodeDefinition } from "@/core/board/registry";
import { runAdapter } from "@/composables/useBoardRun";
import type { BoardNode, BoardNodeDefinition } from "@/types/board";

const TYPE = "ext.demo.baseUrl";

const definition: BoardNodeDefinition = {
  type: TYPE,
  titleKey: "demo",
  category: "model",
  order: 1,
  inputs: [],
  outputs: [],
  params: [
    { id: "base", labelKey: "base", kind: "text", default: "https://www.runlive.top/mnmx" },
    { id: "key", labelKey: "key", kind: "text", default: "" },
  ],
  defaultSize: { width: 380, height: 300 },
  cost: { lane: "api", ramMb: 64 },
};

function demoNode(params: Record<string, unknown>): BoardNode {
  return {
    id: "n1",
    type: TYPE,
    position: { x: 0, y: 0 },
    size: { width: 380, height: 300 },
    data: { params, bindings: {} },
  };
}

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()!();
});

/** 注册演示节点 + 一个只回读参数的适配器，返回它看到的值。 */
async function runWith(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  disposers.push(registerNodeDefinition(definition, "@demo/base-url"));
  const seen: Record<string, unknown> = {};
  disposers.push(
    registerAdapter(
      TYPE,
      async ({ io }) => {
        seen.base = io.param("base");
        seen.key = io.param("key");
        return { text: "ok" };
      },
      "@demo/base-url",
    ),
  );
  await runAdapter(demoNode(params), "n1");
  return seen;
}

describe("plugin adapter io.param", () => {
  it("没改过的参数拿到定义里的默认值（而不是 undefined）", async () => {
    const seen = await runWith({ key: "card-1" });
    expect(seen.base).toBe("https://www.runlive.top/mnmx");
    expect(seen.key).toBe("card-1");
  });

  it("完全没写过的参数也拿到默认值", async () => {
    expect((await runWith({})).base).toBe("https://www.runlive.top/mnmx");
  });

  it("用户主动清空时保持空串，不被默认值顶回去", async () => {
    expect((await runWith({ base: "" })).base).toBe("");
  });
});

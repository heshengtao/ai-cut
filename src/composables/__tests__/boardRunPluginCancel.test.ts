/**
 * 回归：插件节点「停止运行」必须真的通知 daemon 取消。
 *
 * 宿主半的 `run()` 是同步的（轮询到生成结束才返回），前端 abort 不会自己停下来；
 * `runAdapter` 的插件分支要在 `signal` 上挂取消，否则用户点了停止，插件还在后台
 * 一直跑到服务端结束。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/pluginHostApi", () => ({
  pluginHostCancel: vi.fn(async () => true),
}));

import { registerAdapter } from "@/core/board/adapters";
import { registerNodeDefinition } from "@/core/board/registry";
import { pluginHostCancel } from "@/core/pluginHostApi";
import { runAdapter } from "@/composables/useBoardRun";
import type { BoardNode, BoardNodeDefinition } from "@/types/board";

const OWNER = "@demo/cancel-me";
const TYPE = "ext.demo.cancelMe";

const definition: BoardNodeDefinition = {
  type: TYPE,
  titleKey: "demo",
  category: "model",
  order: 1,
  inputs: [],
  outputs: [],
  params: [],
  defaultSize: { width: 300, height: 200 },
  cost: { lane: "api", ramMb: 16 },
};

function demoNode(): BoardNode {
  return {
    id: "n1",
    type: TYPE,
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    data: { params: {}, bindings: {} },
  };
}

const disposers: (() => void)[] = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()!();
  vi.mocked(pluginHostCancel).mockClear();
});

describe("plugin node cancel", () => {
  it("abort 时按插件 id 通知 daemon 取消", async () => {
    disposers.push(registerNodeDefinition(definition, OWNER));
    let release: (() => void) | null = null;
    disposers.push(
      registerAdapter(
        TYPE,
        () =>
          new Promise((resolve) => {
            release = () => resolve({ text: "done" });
          }),
        OWNER,
      ),
    );

    const controller = new AbortController();
    const running = runAdapter(demoNode(), "n1", controller.signal);
    // 让适配器真的进到 await 里。
    await Promise.resolve();
    expect(pluginHostCancel).not.toHaveBeenCalled();

    controller.abort();
    await Promise.resolve();
    expect(pluginHostCancel).toHaveBeenCalledTimes(1);
    expect(pluginHostCancel).toHaveBeenCalledWith(OWNER);

    release!();
    await expect(running).resolves.toEqual({ text: "done" });
  });

  it("正常跑完不会去取消", async () => {
    disposers.push(registerNodeDefinition(definition, OWNER));
    disposers.push(registerAdapter(TYPE, async () => ({ text: "ok" }), OWNER));
    const controller = new AbortController();
    await runAdapter(demoNode(), "n1", controller.signal);
    expect(pluginHostCancel).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { createRunLimiter } from "@/core/board/limiter";
import { DEFAULT_RUN_LIMITS } from "@/core/board/scheduler";

const cost = (lane: "api" | "gpu" | "cpu" | "instant", vramMb = 0, ramMb = 0) => ({
  lane,
  vramMb,
  ramMb,
});

describe("run limiter", () => {
  it("instant 直接放行，api 按并发上限排队", async () => {
    const limiter = createRunLimiter({ ...DEFAULT_RUN_LIMITS, api: 1 });
    const releaseInstant = await limiter.acquire(cost("instant"));
    releaseInstant();
    const release = await limiter.acquire(cost("api"));
    let second = false;
    const wait = limiter.acquire(cost("api")).then((free) => {
      second = true;
      return free;
    });
    await Promise.resolve();
    expect(second).toBe(false);
    release();
    (await wait)();
    expect(second).toBe(true);
  });

  it("gpu 默认串行，释放后立刻放行下一个", async () => {
    const limiter = createRunLimiter({ ...DEFAULT_RUN_LIMITS, gpu: 1 });
    const first = await limiter.acquire(cost("gpu", 4096, 2048));
    let second = false;
    const wait = limiter.acquire(cost("gpu", 4096, 2048)).then((free) => {
      second = true;
      return free;
    });
    await Promise.resolve();
    expect(second).toBe(false);
    first();
    (await wait)();
  });

  it("显存预算挡住超出预算的任务", async () => {
    const limiter = createRunLimiter({ ...DEFAULT_RUN_LIMITS, gpu: 4, vramMb: 8192, ramMb: 65536 });
    const first = await limiter.acquire(cost("gpu", 6144, 1024));
    let second = false;
    const wait = limiter.acquire(cost("gpu", 4096, 1024)).then((free) => {
      second = true;
      return free;
    });
    await Promise.resolve();
    expect(second).toBe(false);
    first();
    (await wait)();
  });
});

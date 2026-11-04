import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import { useSdcppStore } from "@/stores/sdcpp";
import { useDownloadsStore, type DownloadTask } from "@/stores/downloads";

/**
 * 下载队列的语义：**按类型并行、同类型串行**。
 *
 * 后端三个 downloader 各有自己的 `running` 标志（见 `src-tauri/src/models.rs` /
 * `runtime.rs` / `sdcpp.rs`），前端不该假设「同一时刻只有一项」。
 */

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function engine(): DownloadTask {
  return { section: "sdcpp", id: "sdcpp-cuda12", label: "sd.cpp CUDA 12" };
}

function runtime(): DownloadTask {
  return { section: "runtime", id: "cuda13", label: "CUDA 13" };
}

function model(id = "z-image-turbo"): DownloadTask {
  return { section: "model", id, label: id };
}

function setup() {
  setActivePinia(createPinia());
  return {
    models: useModelsStore(),
    runtimes: useRuntimesStore(),
    sdcpp: useSdcppStore(),
    downloads: useDownloadsStore(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("按类型并行", () => {
  it("引擎与模型同时开始，互不等待", async () => {
    const { models, sdcpp, downloads } = setup();
    const engineRun = deferred();
    const modelRun = deferred();
    const engineDownload = vi.spyOn(sdcpp, "install").mockReturnValue(engineRun.promise);
    const modelDownload = vi.spyOn(models, "download").mockReturnValue(modelRun.promise);

    const done = downloads.run([engine(), model()]);

    await vi.waitFor(() => {
      expect(engineDownload).toHaveBeenCalledWith("sdcpp-cuda12");
      expect(modelDownload).toHaveBeenCalledWith("z-image-turbo");
    });
    expect(downloads.active.map((row) => row.section)).toEqual(["sdcpp", "model"]);

    engineRun.resolve();
    await vi.waitFor(() => expect(downloads.active.map((row) => row.section)).toEqual(["model"]));

    modelRun.resolve();
    await expect(done).resolves.toBe(true);
    expect(downloads.running).toBe(false);
  });

  it("同一类型按入队顺序串行", async () => {
    const { models, downloads } = setup();
    const first = deferred();
    const second = deferred();
    const calls: string[] = [];
    vi.spyOn(models, "download").mockImplementation((id: string) => {
      calls.push(id);
      return id === "a" ? first.promise : second.promise;
    });

    const done = downloads.run([model("a"), model("b")]);

    await vi.waitFor(() => expect(calls).toEqual(["a"]));
    expect(downloads.active[0]?.total).toBe(2);

    first.resolve();
    await vi.waitFor(() => expect(calls).toEqual(["a", "b"]));
    second.resolve();
    await expect(done).resolves.toBe(true);
  });

  it("已有别的入口在同类下载时排队，而不是报错", async () => {
    const { models, downloads } = setup();
    const run = deferred();
    const download = vi.spyOn(models, "download").mockReturnValue(run.promise);

    // 手动（别的入口）启动了一个模型下载。
    models.busyId = "manual";
    const done = downloads.run([model()]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(download).not.toHaveBeenCalled();

    models.busyId = null;
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));

    run.resolve();
    await expect(done).resolves.toBe(true);
  });
});

describe("失败与取消", () => {
  it("一条车道失败只停它自己，其余车道照常完成", async () => {
    const { models, runtimes, sdcpp, downloads } = setup();
    const engineRun = deferred();
    const runtimeRun = deferred();
    const secondModel = vi.fn(async () => undefined);
    const modelDownload = vi
      .spyOn(models, "download")
      .mockImplementationOnce(() => Promise.reject(new Error("磁盘满了")))
      .mockImplementation(secondModel);
    vi.spyOn(sdcpp, "install").mockReturnValue(engineRun.promise);
    vi.spyOn(runtimes, "install").mockReturnValue(runtimeRun.promise);

    const done = downloads.run([model("a"), model("b"), engine(), runtime()]);

    await vi.waitFor(() => {
      expect(modelDownload).toHaveBeenCalledTimes(1);
      expect(downloads.failure?.task.id).toBe("a");
    });

    // 同车道后面的 b 被跳过（记进待重试），不会接着跑。
    expect(secondModel).not.toHaveBeenCalled();
    expect(downloads.failedTasks.map((task) => task.id)).toEqual(["a", "b"]);

    engineRun.resolve();
    runtimeRun.resolve();
    await expect(done).resolves.toBe(false);
    expect(downloads.active).toHaveLength(0);
  });

  it("只取消指定车道，另一条继续下", async () => {
    const { models, runtimes, sdcpp, downloads } = setup();
    const engineRun = deferred();
    const runtimeRun = deferred();
    vi.spyOn(sdcpp, "install").mockReturnValue(engineRun.promise);
    vi.spyOn(runtimes, "install").mockReturnValue(runtimeRun.promise);
    const cancelRuntime = vi.spyOn(runtimes, "cancel").mockResolvedValue(undefined);

    const done = downloads.run([engine(), runtime()]);
    await vi.waitFor(() => expect(downloads.active).toHaveLength(2));

    await downloads.cancel("runtime");
    expect(cancelRuntime).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(downloads.active.map((row) => row.section)).toEqual(["sdcpp"]),
    );

    // 真机上取消会让 `runtimes.install` 抛「已取消」；这里手动拒绝同一个 promise。
    runtimeRun.reject(new Error("已取消"));
    engineRun.resolve();
    await expect(done).resolves.toBe(false);
    expect(downloads.active).toHaveLength(0);
  });

  it("取消会清掉排队中的任务，run() 不会一直等", async () => {
    const { models, downloads } = setup();
    const first = deferred();
    vi.spyOn(models, "download").mockReturnValue(first.promise);
    vi.spyOn(models, "cancel").mockResolvedValue(undefined);

    const done = downloads.run([model("a"), model("b")]);
    await vi.waitFor(() => expect(downloads.active).toHaveLength(1));

    await downloads.cancel();
    first.resolve();
    await expect(done).resolves.toBe(false);
    expect(downloads.pending).toBe(0);
    expect(downloads.running).toBe(false);
  });
});

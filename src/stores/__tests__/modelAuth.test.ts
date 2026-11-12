import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * gated 模型的授权流程：`model_download` 返回 `ModelAuth` 时不是失败，而是「要先去网页
 * 同意 + 粘 token」；拿到 token 后 `authorizeAndRetry` 会写设置并重试同一次下载。
 */

const modelDownload = vi.fn();
const modelSaveHfToken = vi.fn();
const modelCatalog = vi.fn();

vi.mock("@/core/modelApi", () => ({
  modelDownload: (id: string) => modelDownload(id),
  modelSaveHfToken: (token: string) => modelSaveHfToken(token),
  modelCatalog: () => modelCatalog(),
  modelProbe: vi.fn(async () => []),
  modelRemove: vi.fn(async () => undefined),
  modelReveal: vi.fn(async () => undefined),
  modelCancel: vi.fn(async () => undefined),
  modelSetSourceConfig: vi.fn(async () => ({
    preference: "auto",
    mirrors: [],
    download_prefix: "",
  })),
  modelSourceConfig: vi.fn(async () => ({
    preference: "auto",
    mirrors: [],
    download_prefix: "",
  })),
  onModelProgress: vi.fn(async () => () => undefined),
}));

import { useModelsStore } from "@/stores/models";

const AUTH = {
  repo: "Lightricks/LTX-2.5",
  page_url: "https://huggingface.co/Lightricks/LTX-2.5",
  token_url: "https://huggingface.co/settings/tokens/new?tokenType=read",
};

describe("gated 模型的授权流程", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    modelDownload.mockReset();
    modelSaveHfToken.mockReset();
    modelCatalog.mockReset();
    modelCatalog.mockResolvedValue([]);
  });

  it("下载返回授权信息时挂起等待用户，而不是报错", async () => {
    modelDownload.mockResolvedValueOnce(AUTH);
    const store = useModelsStore();

    await store.download("ltx-2.5");

    expect(store.pendingAuth?.id).toBe("ltx-2.5");
    expect(store.pendingAuth?.auth.repo).toBe("Lightricks/LTX-2.5");
    // 授权不是失败：不该在界面上留下红色错误。
    expect(store.error).toBeNull();
    // 也不该把模型标成「正在下载」。
    expect(store.installing("ltx-2.5")).toBe(false);
  });

  it("保存 token 后重试同一个模型，成功即清掉待办", async () => {
    modelDownload.mockResolvedValueOnce(AUTH).mockResolvedValueOnce(null);
    modelSaveHfToken.mockResolvedValueOnce(undefined);
    const store = useModelsStore();

    await store.download("ltx-2.5");
    await store.authorizeAndRetry("hf_test123");

    expect(modelSaveHfToken).toHaveBeenCalledWith("hf_test123");
    expect(modelDownload).toHaveBeenCalledTimes(2);
    expect(modelDownload).toHaveBeenLastCalledWith("ltx-2.5");
    expect(store.pendingAuth).toBeNull();
  });

  it("关掉授权框就不再挂着待办", async () => {
    modelDownload.mockResolvedValueOnce(AUTH);
    const store = useModelsStore();

    await store.download("ltx-2.5");
    store.dismissAuth();

    expect(store.pendingAuth).toBeNull();
  });

  it("普通失败仍然进 error，不会弹授权框", async () => {
    modelDownload.mockRejectedValueOnce(new Error("所有下载源都失败了"));
    const store = useModelsStore();

    await expect(store.download("ltx-2.5")).rejects.toThrow("所有下载源都失败了");
    expect(store.pendingAuth).toBeNull();
    expect(store.error).toContain("所有下载源都失败了");
  });
});

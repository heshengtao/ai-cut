/**
 * 客户端半：把一个「异步生成」节点接成画布节点。
 *
 * 提交 / 轮询 / 下载全在 host.js 里——密钥与二进制都不进渲染进程。
 */
export default {
  id: "@aicut/plugin-async-video",
  apply(ctx) {
    ctx.i18n.register({
      zh: { name: "异步视频代理", base: "接口基址", key: "密钥", prompt: "提示词", out: "视频" },
      en: { name: "Async video proxy", base: "Base URL", key: "API key", prompt: "Prompt", out: "Video" },
    });

    ctx.nodes.register(
      {
        type: "ext.asyncvideo.video",
        titleKey: "@aicut/plugin-async-video.name",
        category: "model",
        order: 902,
        inputs: [
          { id: "prompt", type: "text", labelKey: "@aicut/plugin-async-video.prompt" },
          { id: "image", type: "image", labelKey: "@aicut/plugin-async-video.out" },
        ],
        outputs: [{ id: "out", type: "video", labelKey: "@aicut/plugin-async-video.out" }],
        params: [
          { id: "base", labelKey: "@aicut/plugin-async-video.base", kind: "text", default: "" },
          { id: "key", labelKey: "@aicut/plugin-async-video.key", kind: "text", default: "" },
        ],
        defaultSize: { width: 360, height: 260 },
        cost: { lane: "api", ramMb: 64 },
      },
      async ({ io }) => {
        const prompt = io.text("prompt") ?? "";
        const image = io.asset("image");
        const result = await ctx.host.run(
          JSON.stringify({
            base: String(io.param("base") ?? ""),
            key: String(io.param("key") ?? ""),
            prompt,
            image: image?.path ?? "",
          }),
        );
        return { paths: [result] };
      },
    );
  },
};

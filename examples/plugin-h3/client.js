/**
 * 客户端半：只做「把画布参数交给宿主半」。
 *
 * 提交 / 轮询 / 下载全在 host.js 里——密钥与二进制都不进渲染进程。
 */
export default {
  id: "@aicut/plugin-h3",
  apply(ctx) {
    ctx.i18n.register({
      zh: { name: "H3 代理", base: "接口基址", key: "卡密钥", prompt: "提示词", out: "视频" },
      en: { name: "H3 proxy", base: "Base URL", key: "Card key", prompt: "Prompt", out: "Video" },
    });

    ctx.nodes.register(
      {
        type: "ext.h3.video",
        titleKey: "@aicut/plugin-h3.name",
        category: "model",
        order: 902,
        inputs: [
          { id: "prompt", type: "text", labelKey: "@aicut/plugin-h3.prompt" },
          { id: "image", type: "image", labelKey: "@aicut/plugin-h3.out" },
        ],
        outputs: [{ id: "out", type: "video", labelKey: "@aicut/plugin-h3.out" }],
        params: [
          { id: "base", labelKey: "@aicut/plugin-h3.base", kind: "text", default: "" },
          { id: "key", labelKey: "@aicut/plugin-h3.key", kind: "text", default: "" },
        ],
        defaultSize: { width: 360, height: 260 },
        cost: { lane: "api", ramMb: 64 },
      },
      async ({ io }) => {
        const prompt = io.text("prompt") ?? String(io.param("prompt") ?? "");
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

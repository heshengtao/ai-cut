/**
 * 客户端半：只做「把上游文本交给宿主半，再把结果当文本发布」。
 *
 * 真正的活（网络 / 存储 / 产物）都在 host.js 里，客户端半不碰密钥与二进制。
 */
export default {
  id: "@aicut/plugin-echo",
  apply(ctx) {
    ctx.i18n.register({
      zh: { name: "回显", out: "文本" },
      en: { name: "Echo", out: "Text" },
    });

    ctx.nodes.register(
      {
        type: "ext.echo.text",
        titleKey: "@aicut/plugin-echo.name",
        category: "model",
        order: 901,
        inputs: [{ id: "in", type: "text", labelKey: "@aicut/plugin-echo.name" }],
        outputs: [{ id: "out", type: "text", labelKey: "@aicut/plugin-echo.out" }],
        params: [],
        defaultSize: { width: 320, height: 200 },
        cost: { lane: "api", ramMb: 16 },
      },
      async ({ io }) => {
        const output = await ctx.host.run(JSON.stringify({ text: io.text("in") ?? "" }));
        return { text: output };
      },
    );
  },
};

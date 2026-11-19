/**
 * 最小示例插件：加一个「打招呼」节点 + 一条命令。
 *
 * 直接是浏览器可加载的 ESM，不需要构建——这也是自包含插件的最小形态。
 */
export default {
  id: "@aicut/plugin-hello",
  apply(ctx) {
    ctx.i18n.register({
      zh: { name: "打招呼", out: "文本", cmd: "打个招呼" },
      en: { name: "Hello", out: "Text", cmd: "Say hello" },
    });

    ctx.nodes.register(
      {
        type: "ext.hello.greet",
        titleKey: "@aicut/plugin-hello.name",
        category: "model",
        order: 900,
        inputs: [],
        outputs: [{ id: "out", type: "text", labelKey: "@aicut/plugin-hello.out" }],
        params: [{ id: "name", labelKey: "@aicut/plugin-hello.name", kind: "text", default: "world" }],
        defaultSize: { width: 320, height: 180 },
        cost: { lane: "api", ramMb: 16 },
      },
      async ({ io }) => ({ text: `hello ${io.param("name") ?? "world"}` }),
    );

    ctx.commands.register({
      id: "ext.hello.greet",
      titleKey: "@aicut/plugin-hello.cmd",
      run: () => ctx.log("hello"),
    });
  },
};

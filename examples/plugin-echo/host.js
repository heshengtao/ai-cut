/**
 * 宿主半：在独立 QuickJS 运行时里跑，只有一个 run(input) 入口。
 *
 * 可以用的东西全在 `ctx` 上：storage / media / http / log / cancelled。
 */
globalThis.__AICUT_PLUGIN__ = {
  id: "@aicut/plugin-echo",
  run(input) {
    const payload = JSON.parse(input);
    ctx.storage.set("last", input);
    ctx.log("echo " + payload.text);
    return "echo: " + payload.text;
  },
};

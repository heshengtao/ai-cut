# 示例插件：echo（带宿主半）

演示「客户端半 + 宿主半」两件套：

- `client.js`：在 webview 里注册节点/命令，把画布输入交给宿主半；
- `host.js`：在 daemon 的独立 QuickJS 运行时里执行 `run(input)`，可以用
  `ctx.storage` / `ctx.http` / `ctx.media` / `ctx.log` / `ctx.cancelled`。

## 试用

1. 「插件扩展」面板 →「导入本地目录」选本目录；
2. 画布加「回显」节点，上游接一个文本节点；
3. 运行 → 输出 `echo: <上游文本>`；
4. 禁用 → 宿主半线程一起退出。

宿主半是**单文件脚本**：不允许 `import`，依赖请在自己的构建里打进 `host.js`。

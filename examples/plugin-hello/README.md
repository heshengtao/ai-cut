# 示例插件：hello

最小可用的画布插件，演示三件事：

- `aicut.plugin.json` 的必填字段（`format` / `id` / `version` / `engines` / `client`）；
- `client.js` 的形态：`export default { id, apply(ctx) }`，不需要构建；
- `ctx.nodes` / `ctx.commands` / `ctx.i18n` 三个注册面。

## 试用

1. 面板 →「插件扩展」→「导入本地目录」，选择本目录；
2. 画布添加菜单里会出现「打招呼」节点；
3. 禁用后节点消失，源目录不会被删除。

插件 id 是 `@aicut/plugin-hello`；文案 key 统一写成 `@aicut/plugin-hello.<key>`。

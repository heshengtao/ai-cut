# 插件开发指南

AI Cut 的画布插件是一个普通 npm 包，带两半：**客户端半**（在编辑器里跑 Vue 组件、注册节点）
和**宿主半**（在 daemon 的独立 QuickJS 运行时里跑网络 / 存储 / 产物落盘）。两半都是可选的，
一个插件可以只有一半。

> 设计背景与取舍见 [插件架构设计](superpowers/specs/2026-11-17-plugin-architecture-design.md)。

## 1. 最小插件

```
my-plugin/
├─ package.json
├─ aicut.plugin.json
└─ client.js        # 或 host.js，或两者都有
```

`package.json`：

```json
{
  "name": "@you/aicut-plugin-demo",
  "version": "0.1.0",
  "type": "module",
  "aicut": { "manifest": "./aicut.plugin.json" },
  "files": ["aicut.plugin.json", "client.js", "host.js"]
}
```

`aicut.plugin.json`：

```json
{
  "format": 1,
  "id": "@you/aicut-plugin-demo",
  "version": "0.1.0",
  "engines": { "aicut": ">=1.3.0" },
  "client": "./client.js",
  "host": "./host.js",
  "inject": ["http", "media", "storage"],
  "external": [],
  "capabilities": { "net": [] }
}
```

**清单只放宿主必须在加载前知道的东西**：`format`、`id`、`version`、`engines.aicut`、
两个入口文件、`inject`、`external`、`capabilities`。节点 / 面板 / 控件 / 命令一律在运行时
用 `ctx` 注册——不要把它们抄进清单（那样会有两份真源）。

`engines.aicut` 支持的范围写法（受限语法，`^` / `~` / `x` 会被拒）：
`*`、`>=1.3.0`、`>=1.3.0 <2.0.0`、`=1.3.0`，多个条件用空格或逗号连接。

## 2. 客户端半

```js
export default {
  id: "@you/aicut-plugin-demo",
  apply(ctx) {
    ctx.i18n.register({ zh: { name: "示例" }, en: { name: "Demo" } });
    ctx.nodes.register(
      {
        type: "ext.demo.text",          // 必须以 ext. 开头
        titleKey: "@you/aicut-plugin-demo.name",
        category: "model",              // input / display / model / group 之一
        order: 900,
        inputs: [{ id: "in", type: "text", labelKey: "@you/aicut-plugin-demo.name" }],
        outputs: [{ id: "out", type: "text", labelKey: "@you/aicut-plugin-demo.name" }],
        params: [],
        defaultSize: { width: 320, height: 200 },
        cost: { lane: "api", ramMb: 16 },   // 必填：插件节点必须声明泳道
      },
      async ({ node, io, signal }) => {
        const text = io.text("in") ?? "";
        return { text: await ctx.host.run(JSON.stringify({ text })) };
      },
    );
  },
};
```

可用的注册面：

| API | 作用 |
| --- | --- |
| `ctx.nodes.register(def, run)` | 画布节点（`run` 收到 `{ node, nodeId, signal, io }`） |
| `ctx.commands.register(spec)` | 命令 + 默认快捷键（`{ id, titleKey, key?, run }`） |
| `ctx.controls.register({ id, component })` | 参数区自定义控件（配合 `params[].kind = "component"`） |
| `ctx.panes.register({ id, titleKey, component })` | AI 面板里的插件页 |
| `ctx.i18n.register({ zh, en })` | 插件词典，key 用 `@<插件 id>.<key>` 引用 |
| `ctx.host.run(input)` | 调宿主半的 `run(input)`，拿到字符串结果 |

`io` 提供 `param(id)` / `text(portId)` / `asset(portId)` / `refs(kind)` / `progress(v, msg)`。
节点产物用返回值表达：`{ paths: [绝对路径] }`（自动入库）、`{ text }`（文本产物）、
`{ pathByPort }`（多端口）、`{ assetId }`（透传已有素材）。

## 3. 宿主半

单文件脚本，**没有 `import`**（依赖请在自己的构建里打进来），必须设置
`globalThis.__AICUT_PLUGIN__`：

```js
globalThis.__AICUT_PLUGIN__ = {
  id: "@you/aicut-plugin-demo",
  run(input) {
    const args = JSON.parse(input);
    const response = JSON.parse(ctx.http.request("GET", args.url, "", ""));
    const saved = ctx.http.download(args.url, "", "out.bin");
    ctx.storage.set("last", args.url);
    return saved;             // 字符串返回给客户端半
  },
};
```

`ctx` 的全部分能力（**同步**，没有 Promise）：

| API | 说明 |
| --- | --- |
| `ctx.http.request(method, url, headersJson, body)` | 返回 JSON 文本 `{status, text}` |
| `ctx.http.download(url, headersJson, name)` | 下载到 `data/<id>/out/<name>`，返回绝对路径 |
| `ctx.http.multipart(url, fieldsJson, filesJson, headersJson, method)` | multipart 提交；`filesJson` 是 `{ 字段名: 本地绝对路径 }` |
| `ctx.media.save(base64, name)` | 把字节落盘并返回路径（文件名不能带路径分隔符） |
| `ctx.storage.get(key)` / `.set(key, value)` | 插件私有键值（`data/<id>/storage.json`） |
| `ctx.log(message)` | 诊断输出 |
| `ctx.cancelled()` | 用户在界面上取消了吗 |

宿主半**没有** `fs` / `require` / `process` / `fetch`。要读用户文件，把路径交给
`ctx.http.multipart` 的文件字段，宿主会替你读。

**性能注意**：宿主半是同步的，`while` 轮询会占满该插件的线程（不会拖慢别的插件）。
轮询间隔用 `Date.now()` 空转实现，建议 ≥200 ms 并检查 `ctx.cancelled()`。

## 4. 本地调试

1. 「插件扩展」面板 →「导入本地目录」，选插件目录（`kind = linked`，不复制源码）；
2. 改 `client.js` 后点面板的刷新/重进面板即可重新加载（客户端半按 `rev` 热替换）；
3. 改 `host.js` 后需要禁用再启用该插件（宿主半重建 QuickJS 运行时）；
4. 移除插件**不会**删除你的源目录。

## 5. 发布到商店

1. 把包发布到 npm（或自己托管一个 `.tgz` 直链）；
2. 在索引仓库里加一条 `versions[]` 条目：`version`、`publishTimestamp`、
   `source`（`{"type":"npm"}` 或 `{"type":"tgz","url":"https://…"}`）、
   `engines.aicut`、`sha256`、`size`；
3. 索引是静态 JSON（`format: 1`），软件默认指向作者维护的
   `https://raw.githubusercontent.com/heshengtao/ai-cut-plugin-market/main/index.json`，
   用户也可以改成任意 HTTPS 索引。

`sources` 只支持 `npm` 与 `tgz`：**不支持 `git`** ——那意味着宿主要替插件构建，
等于把依赖地狱搬回来。

## 6. 已知边界

- 客户端半与编辑器共享 JS 上下文，**没有沙箱**（安装确认里必须让用户知道）；宿主半有
  QuickJS 隔离，`ctx` 是唯一能力面。
- 插件 id 冲突、控件 / 面板 id 冲突、命令键位冲突都是**硬报错**并指出占用者，
  不会静默覆盖。
- `settings.section`（设置页分组）暂未开放：设置页是单文件大组件，拆分成本高，等前面的
  注入点跑顺了再做。

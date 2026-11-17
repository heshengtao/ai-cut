# AI Cut 插件架构设计（v1）

- 日期：2026-11-17
- 状态：已确认，待实现
- 范围：插件运行时（宿主半 / 客户端半）、内核扩展点改造、插件商店的发现与安装、私有插件落地路径
- 一句话目标：第三方（含作者本人不想开源的私有节点）以「可安装包」的形式扩展画布节点、模型供应商、命令与 UI 注入点；不重启热更；插件互不打架；**一块插件代码都不进主仓库**。

---

## 1. 背景

### 1.1 触发事件

MiniMax H3 的第三方代理（`runlive.top/mnmx`）协议与现有 `cloud_gen` 的官方 MiniMax 适配在鉴权头、路径、编码、状态字面量、取文件方式五处全不一致，改造成本不小而受众极窄。结论是**不做专门适配**：这类东西应该以插件形式活在主仓库之外。

### 1.2 要吸收的三条教训

| 来源 | 教训 | 本设计的对策 |
| --- | --- | --- |
| ComfyUI | 插件把依赖装进宿主环境 → 依赖地狱、版本漂移、装不上、污染全局 | 插件自带依赖（自包含 bundle），宿主不装任何东西 |
| ComfyUI | 插件共享一个全局命名空间 → 互相覆盖、一处坏全崩 | 每插件独立 Runtime/线程 + 命名空间 + 硬冲突检测 |
| DSH 第一代 loader | 把「模块系统」与「插件治理」融进一个函数 → 没有卸载路径、依赖清单三处手抄、跨插件 import 走后门 | 模块系统只管字节与身份；治理只管生命周期。两者只有一个边界 |
| DSH | 插件是**名册里的一行**，包只是被引用的字节 | 照搬：装 ≠ 启用；启用列表是宿主数据 |
| DSH | UI 插槽（尤其「插件自带设置页」）在 `archived/` 里被重做四次 | 第一版只开接缝成本最低的几个注入点；设置页分区明确推迟 |
| DSH | 扁平 id 空间 + 同 id 静默覆盖（作者自述为「本仓库空白点」） | 改成**硬报错**：重复 id/slot/服务名一律拒绝并说明谁占用 |

### 1.3 非目标（v1 明确不做）

- 不做 Pi / VS Code / ComfyUI 插件兼容层。
- 不做宿主内构建（不随包发 esbuild，不接受源码目录直接编译）。
- 不做 git 源安装（要构建 → 正是要避免的形态）。
- 不做插件签名/公证体系（靠 sha256 + 来源提示 + 安装确认）。
- 不做插件市场服务器（静态 JSON 索引即可）。
- 不改 `docs/roadmap.md` 之外的既有 AI 能力语义。

---

## 2. 已确认决策

| 议题 | 决策 |
| --- | --- |
| 能力边界 | **C 档**：插件既能加节点/供应商，也能注入 UI，也能有后端半（注册命令、长任务） |
| 依赖策略 | **A 档**：插件自带依赖、构建成自包含产物；宿主不安装、不解析 npm |
| 运行时形态 | **方案①**：双半 + 每插件一个 QuickJS Runtime（独立线程 actor） |
| 第一版注入点 | `board.node`、`ai.provider`、`timeline.menu`、`command` |
| 设置页分区 | 推迟（见 §10.3） |
| 商店默认源 | 作者自控的 GitHub 仓库，索引 `plugins: []` 起步，可关可改可加 |
| 私有插件 | 本地目录链接（`linked`），不进索引、不进主仓库 |

### 2.1 为什么 A 不是妥协

DSH 的宿主是 Node，所以它能用 pnpm 把插件依赖装进独立 profile；我们的宿主是 **Rust daemon + 内嵌 QuickJS**（`crates/daemon/Cargo.toml:18`，已在跑 `assets/domain.js` 文档引擎），**没有 Node 可以给插件装依赖**。DSH 里 pnpm 那一步在我们的平台上的等价物就是「插件在自己的构建里把依赖打进去」。把它做成宿主内包管理器，就会精确地复现 ComfyUI 的病。

---

## 3. 总体架构

```
┌─ 内核（现有应用，只新增三个构件） ────────────────────────────┐
│ Webview: pluginRuntime (src/core/plugins)                     │
│   · 模块表（惰性 factory）   · slot 注册表                    │
│   · 节点 / 供应商 / 命令注册表  · 热替换控制器                │
│                                                               │
│ Daemon: plugin_host (crates/daemon/src/plugin_host/)          │
│   · 名册与文件锁   · 安装/更新/卸载事务   · 索引抓取与分页    │
│   · 每插件 actor 线程 + QuickJS Runtime + 中断处理器          │
│   · ctx 能力桥（http/media/settings/storage/events/jobs/log） │
└───────────────────────────────────────────────────────────────┘
        ↕ 现有通道：Tauri invoke/event  ↔  /rpc + /events (SSE)
        ↕ 插件资源：GET /plugins/<id>/<version>/client.js?rev=
┌─ 插件包 @scope/aicut-plugin-x ────────────────────────────────┐
│ package.json         aicut: { manifest: "./aicut.plugin.json" }│
│ aicut.plugin.json    静态依赖边与能力声明                      │
│ host.js              宿主半（自包含，QuickJS 执行）            │
│ client.js            客户端半（自包含 ESM，运行时 import）     │
└───────────────────────────────────────────────────────────────┘
```

**数据流（一次插件节点运行）**

1. 用户在画布上跑到 `ext.<短id>.<type>` 节点；
2. `pluginRuntime` 把它交给该插件注册的 adapter（内核 adapter 表的普通一行）；
3. adapter 需要网络/文件/进度 → 经 `/rpc` 调 `plugin_host`，后者把调用转成一次 actor 命令；
4. 插件 host 半在 QuickJS 里执行，通过 `ctx.*` 回调宿主；产物 `ctx.media.importBytes()` 落盘入库；
5. 进度/状态经 `plugin-progress` 事件回到画布（不再走 180ms 轮询单例 store）；
6. 结果按现有 `AdapterResult` 契约回写（`paths` / `assetByPort` / `text`）。

---

## 4. 与 DSH 的对照

| DSH 机制 | 我们 | 理由 |
| --- | --- | --- |
| `dsh.bundle` patch 层（YAML 组合方言） | **不搬** | 那套是给 web/headless/acp/sdk 多种部署形态组合用的；我们只有一种形态，引入只会多一个真源 |
| entry 行（插件 = 配置行，包 = 字节） | **照搬** | 装/启用/禁用全是数据编辑，可 diff、可回滚 |
| `dsh.client` + `inject` + `external` | **照搬** | 依赖边由 manifest 声明，不许手抄 |
| 客户端 bundle 惰性 factory | **照搬** | 注册 ≠ 执行，副作用推迟到首次物化 |
| 模块系统与 Loader 治理分离 | **照搬** | 第一代融合的教训 |
| 每插件 fiber（PENDING/ACTIVE/FAILED） | **照搬语义**，实现为 actor 状态机 | 缺服务就 PENDING 并报缺哪个 |
| 热更「为什么必须重启」枚举 | **照搬** | 不假装热更 |
| 市场索引 `format: 1` | **裁剪照搬** | 静态 JSON + 分页 + 分类标签 |
| Host 侧抓取索引、客户端只拿一页 | **照搬** | 索引会长大，不能整份进渲染进程 |
| 同 id 静默覆盖 | **加强** | 改成硬报错 |
| 同进程无沙箱 | **加强** | 宿主半有 QuickJS 真隔离 |
| pnpm 装依赖 | **替换** | 插件自包含 |

---

## 5. 包形态与清单

### 5.1 package.json

```jsonc
{
  "name": "@heshengtao/aicut-plugin-minimax-h3",
  "version": "0.1.0",
  "type": "module",
  "aicut": { "manifest": "./aicut.plugin.json" },
  "files": ["aicut.plugin.json", "host.js", "client.js"]
}
```

`aicut` 键只声明清单位置；不声明 `aicut` 的包**拒绝安装**（DSH 的「无 `dsh.bundle` 直接拒装」同款）。

### 5.2 aicut.plugin.json

```jsonc
{
  "format": 1,
  "id": "@heshengtao/aicut-plugin-minimax-h3",   // 缺省取 package.json name；必须与之一致
  "version": "0.1.0",
  "engines": { "aicut": ">=1.3.0 <2.0.0" },
  "host":   "./host.js",     // 可选
  "client": "./client.js",   // 可选
  "inject": ["http", "jobs", "media", "storage"],
  "external": ["vue"],
  "capabilities": {
    "net": ["www.runlive.top"],
    "media.readUser": true,
    "jobs.long": true
  },
  "contributes": { "nodes": ["h3"], "providers": ["h3-proxy"], "slots": ["board.node"] }
}
```

### 5.3 清单纪律（最重要的一条）

**清单里只放宿主必须在加载前就知道的事**：兼容范围、依赖边、共享模块、能力声明、产物路径。

节点/slot/命令/供应商**具体注册了什么，一律由运行时 `ctx` 注册产生**；`contributes` 只用于商店与安装确认的展示，**永不作为校验依据**。这样不存在第二个真源——DSH 反复踩过「依赖清单手抄三处并漂移」。

### 5.4 兼容性

- `engines.aicut` 是唯一被执行的范围校验（SemVer range），安装时与加载时各查一次。
- 不满足时：包保持安装、拒绝加载、`failed(engines)`，并给「降低版本 / 装兼容版本 / 显式接受风险」三个动作。显式接受风险须在确认框里打勾，不落豁免表（v1 简化）。
- `format` 不等于 1 → 拒装。

---

## 6. 磁盘布局与所有权

```
<数据目录>/plugins/
├─ plugins.json                 # 名册（唯一写者：plugin_host，带文件锁）
├─ market.json                  # 索引源 + 抓取元数据（TTL/ETag/上次错误）
├─ store/<id>/<version>/        # 托管安装：不可变、按版本并存
├─ data/<id>/                   # 插件运行期数据（卸载默认保留）
└─ cache/<id>/                  # 可随时删
<缓存目录>/plugins/
├─ registry/<index-hash>.json   # 索引缓存
└─ downloads/                   # 安装下载暂存
```

规则：

1. **产物不可变**：`store/<id>/<version>/` 写入后不再改；更新 = 新目录。加载一律 `id@version` 定位，陈旧引用直接报错。
2. **数据与代码分离**：插件只能写 `data/<id>` 与 `cache/<id>`，路径由宿主注入，插件不得自行拼路径。
3. **托管安装不持久化绝对路径**（字体库的同款教训：`fonts.rs` 的 `dir` 只在读时填充）。唯一会持久化绝对路径的是 `linked` 插件。
4. **命名空间不侵占**：插件不放 `models/`、`fonts/`、`runtime/`；OFX 仍独占 `plugins/ofx/`。

---

## 7. 宿主半运行时

### 7.1 actor 模型

每个插件一个线程，独占一个 `rquickjs::Runtime` + `Context`：

```
RPC handler ──mpsc(Command)──▶ plugin thread ──▶ QuickJS
                 ◀──oneshot(Result)──
```

- **隔离**：全局变量、定时器、异常互不可见；卸载 = 丢弃 Runtime，零残留。
- **不阻塞**：daemon 主循环永不等插件；每次调用有 `timeout` 与 `cancelled`。
- **死循环**：`Runtime::set_interrupt_handler` 做超时/取消中断。
- **崩溃**：插件 OOM/panic 只让该 actor 退出 → 该插件 `failed`，其它插件与宿主不受影响。
- **任务登记**：所有长任务进 `ctx.jobs`，供取消、超时与热更 `busy` 判定使用。

### 7.2 ctx 能力面

QuickJS 里**没有** `require` / `fetch` / `fs` / `process`。插件能做的每件事都必须经过宿主注入的 `ctx`——这既是能力边界，也是隔离的物理保证。

| 命名空间 | 宿主半 | 客户端半 | 说明 |
| --- | --- | --- | --- |
| `ctx.http` | ✅ | ❌ | `request` / `multipart`（含文件 part）/ `download`；受 `capabilities.net` 域白名单约束 |
| `ctx.media` | ✅ | ✅ | `importBytes` / `importPath` / `thumbnail` |
| `ctx.settings` | ✅ | ✅ | 每插件一节独立配置，schema 由插件声明，宿主渲染表单 |
| `ctx.storage` | ✅ | ❌ | 键值 + 文件，落 `data/<id>`，超配额拒绝 |
| `ctx.events` | ✅ | ✅ | 订阅宿主事件（progress/asset/project），只看公共面 |
| `ctx.jobs` | ✅ | ❌ | 长任务登记：取消、超时、在跑清单 |
| `ctx.log` | ✅ | ✅ | 进插件诊断面板，不污染宿主日志 |
| `ctx.i18n` | ✅ | ✅ | 插件自带词典，key 自动加 `@<短id>.` 前缀 |
| `ctx.providers` | ✅ | ✅ | 注册模型供应商 |
| `ctx.nodes` / `ctx.slots` / `ctx.commands` | ❌ | ✅ | 画布节点 / UI 注入 / 命令 |
| `ctx.ui` | ❌ | ✅ | `h` / `defineComponent` / 宿主组件白名单（`Md3Select` 等） |

纪律：`inject` 里没声明的命名空间，`ctx` 上是 `undefined`（不是「调了才报错」）。缺依赖 → 插件停在 `PENDING`，诊断写「缺 `http`，由 `aicut-plugin-x` 提供」。

**插件拿不到 `fs`**。需要读用户文件时走 `ctx.http.multipart({ file: <宿主给的素材路径> })` 或 `ctx.media.importPath`，由宿主校验路径后代办。

### 7.3 配额与限制

| 项 | 默认 | 行为 |
| --- | --- | --- |
| 单次调用超时 | 30 s | 中断 + `ctx` 报错 |
| 单插件内存 | 256 MB | 超限杀 actor → `failed(oom)` |
| `data/<id>` 大小 | 512 MB | 写入失败 |
| 并发命令 | 每插件 1 | 串行（避免插件内部竞态由宿主兜底） |

---

## 8. 客户端半运行时

### 8.1 代码怎么到达

`import(/* @vite-ignore */ <插件资源 URL>)`：

- 桌面：`convertFileSrc()` → `asset://`（`csp: null` + `assetProtocol.scope: **` 已允许，`src-tauri/tauri.conf.json:28`）。产物在 `<version>` 目录里不可变，**文件身份由版本目录保证**。
- 浏览器 / headless：`GET /plugins/<id>/<version>/client.js?rev=`（daemon 侧路由另做 `rev` 精确校验，陈旧 `rev` 返回 404）。
- 两种运行时同一个 API（`src/platform/tauri.ts:97`），调用方不感知。

**这是本仓库第一次运行时加载第三方 JS**（现有 `import()` 全是打包期已知的对话框插件），因此：

- 不依赖打包器的模块图，`@vite-ignore` 必须写；
- 不用 import map（DSH 已验证在 WebKitGTK 上不可靠），共享模块走全局桥；
- `rev` 等于 `<version>+<mtime|ctime|size 哈希>`；daemon 路由对陈旧 `rev` 返回 404，不做别名。

### 8.2 共享模块（全局桥）

- `@aicut/plugin-sdk` 提供 Vite 预设：把 `vue` 与 SDK 编译成对 `globalThis.__AICUT__` 的 re-export 桥。
- re-export 清单由 SDK 构建期从 vue 导出表生成（`scripts/gen-bridge.mjs`），**不手抄**。
- 插件产物里只剩 `vue` 的桥接调用，真实 Vue 实例由宿主提供 → 组件、VNode、Pinia 身份一致。

### 8.3 惰性 factory

插件 bundle 被 `import()` 时**只登记**工厂；模块体副作用（含样式注入、组件定义）推迟到首次物化。理由：DSH 第一代把「登记」与「执行」混在一起，导致无法卸载、样式标签永不回收。

### 8.4 样式

- 插件样式在构建期进 bundle，物化时注入 `<style data-plugin="<id>@<version>">`。
- 卸载/替换时按该属性精确移除，不用「整页清空」这类粗粒度手段。

### 8.5 热替换（顺序不可错）

`invalidate(rev)` → `prefetch` 新 factory → **先 `registry.delete` 再 dispose**（裸 dispose 会触发自停用分支）→ 排空旧 disposer → 移除样式 → 物化新导出 → `refresh()` → `await`；失败重抛并回滚到旧代码，标记 `failed`，不连坐其它插件。

---

## 9. 内核改造清单

实现顺序即 M0，每条都能独立验收（内置行为不变）。

| 编号 | 改造 | 现状证据 | 验收 |
| --- | --- | --- | --- |
| K1 | `runAdapter` 的 `switch` → **adapter 注册表**；内置节点启动时注册进同一张表 | `useBoardRun.ts:707` 未知类型抛错 | 内置节点行为不变；表里能查出插件节点 |
| K2 | run 上下文加 per-node `signal` | 现在是模块级 `cancelled` 布尔（`:109`） | 取消单个节点不误伤并行分支 |
| K3 | 插件节点进度走 `ctx.jobs.report()` 事件 | 现在 180ms 轮询单例 store（`:802`） | 并行多节点进度互不串台 |
| K4 | 节点定义加 `cost.lane` | 未知 type 落 `gpu` 且按 4 GB（`scheduler.ts:80`） | 插件节点进 `api` 泳道而不是 `gpu` |
| K5 | `category` 与节点类型加守卫 | 未知 `category` 会在 `grouped[...].push` 抛 TypeError | 插件只能复用内置分类；未知类型给出可读错误 |
| K6 | 插件 i18n 解析：`titleKey` 支持 `@<短id>.<key>` | 词典硬编码在 `zh.ts`/`en.ts` | 插件节点多语言不依赖内核词典 |
| K7 | 节点 `data.ports` 端口快照 | 未知节点被保留但**连线被丢**（`schema.ts:185`） | 缺插件时工程连线仍在 |
| K8 | 新增 `/plugins/...` 资源路由（路径限定在 store 内） | 现在只能复用 `/file`（可读任意绝对路径，`rpc.rs:1939`） | 路径穿越请求 404 |
| K9 | **命令注册表**（快捷键 + 右键菜单 + 未来命令面板共用） | `shortcuts.ts` 150 行硬编码键位 | 键位冲突明确报出占用者 |
| K10 | 能力表加 `plugin` 键（headless 也 `ok`，因为宿主半在 daemon） | `capabilities.rs` 只有一张 HEADLESS 表 | 浏览器端能力门控正确 |

---

## 10. 注入点与命名空间

### 10.1 v1 开放（4 个）

| 注入点 | 接缝 | 插件能做什么 |
| --- | --- | --- |
| `board.node` | `src/core/board/registry.ts`（已是声明式注册表） | 新节点类型：端口、参数 spec、`run`、`cost`、图标 |
| `ai.provider` | `cloud_gen` 预设表 | 模型供应商：名称、模型列表、能力（t2v/i2v）、配置字段。**配置表单在插件管理页渲染**（v1），不依赖设置页分组 |
| `timeline.menu` | `useTimelineMenus.ts` 的 `build`（纯函数） | 按目标（clip/lane/ruler/marker/track）追加菜单项 |
| `command` | 新增命令表（K9） | 命令 + 默认键位 + 生效条件 |

### 10.2 第二批

`ai.pane`（AI 面板新页面，需抽象 `AiPane.vue` 的页面表）、`board.inspector`（自定义检查器控件，需组件级插槽）。

### 10.3 明确推迟：`settings.section`

`SettingsView.vue` 是 **5237 行单文件**，分区只是数组里的一项 + 模板里顺序平铺的 `v-if` 块。要开分组插槽必须先拆分区壳。而 DSH 在「插件自带设置页/详情页插槽」上重做了 **四次**（`archived/` 四份笔记）——这个面最容易返工，等命令表与插槽表跑顺了再动，代价更小。

### 10.4 命名空间的四道闸

1. **id 唯一且硬冲突**：同 id 只能有一个来源在册；`store/<id>` 多版本并存但**同时只启用一个**；重复安装 → 拒绝并说明谁占用了它（**不是静默覆盖**）。
2. **注册命名空间**：节点 `ext.<短id>.<type>`；插件服务 `plugin.<短id>.<name>`；slot 名必须在宿主白名单内。越界 → 拒绝 + 一条诊断，不静默丢弃。
3. **服务只可加不可覆**：插件不得覆盖宿主服务（`http`/`settings`/`media`），同名 provide 直接拒绝。
4. **三重独立**：独立 Runtime、独立线程、独立数据目录。三条都独立，才谈得上「海量插件」。

### 10.5 插件 i18n

- 插件自带 `i18n/zh.json` / `en.json`（可选，缺时回落 `en`）。
- 插件注册时用的 key 自动加前缀：`@<短id>.<key>`。
- 内核的 `t()` 在词典未命中时查插件词典；插件词典缺失时不报错，回落 key 本身（与现有行为一致）。

---

## 11. 生命周期与名册

### 11.1 状态机

```
installed ──enable──▶ loading ──ok──▶ active
                 │         └──err──▶ failed(reason)
                 └─disable─▶ disabled
active ──hot-reload──▶ active'
```

`failed.reason` 取值：`import`（脚本解析/导入失败）、`activation`（apply 抛错）、`missing-service`（`inject` 未满足）、`engines`（兼容范围）、`oom`、`timeout`。三类失败分开报，不合并成一句「插件加载失败」。

### 11.2 plugins.json

```jsonc
{
  "format": 1,
  "plugins": [
    {
      "id": "@heshengtao/aicut-plugin-minimax-h3",
      "kind": "linked",                    // store | linked
      "path": "/Users/…/aicut-plugin-h3",  // 仅 linked 持久化绝对路径
      "activeVersion": null,               // 仅 store
      "enabled": true,
      "installedAt": 1790000000,
      "updatedAt": 1790000000,
      "source": { "type": "local" },       // market | npm | tgz | local
      "config": {},
      "lastError": null
    }
  ]
}
```

写名册必须持文件锁；写失败整体回滚。

### 11.3 事件

统一 `plugin-progress`：`{ id, version, phase, received, total, message }`，`phase ∈ resolving|downloading|verifying|extracting|installing|loading|done|error`。前端复用现有 `watchProgress` 形态（`src/stores/plugins.ts:141`）。

---

## 12. 热更新语义

宿主把「为什么必须等」编码成枚举返回给 UI：

| 原因 | 何时 | UI 行为 |
| --- | --- | --- |
| `busy` | 该插件有任务在跑（`ctx.jobs` 非空） | 等空闲或用户确认取消 |
| `host-reload` | 宿主半需要重建 Runtime，旧 Runtime 等任务结束 | 显示「重载中」 |
| `release-change` | 宿主版本变了（与页面 boot 版本不一致） | 暂停替换，提示刷新页面 |

- **配置改动**（enable/disable/插件设置）→ 即时重组，不重启、不重建 Runtime。
- **客户端半文件变化** → stat 轮询（每次 1 次 stat，默认 500ms；不用 inotify，网络盘不可靠）→ `rev` 变化 → §8.5 七步。
- **宿主半文件变化** → 等 `busy` 清除 → 重建 Runtime → 重新加载。
- **两套缓存分开失效**：名册解析结果与已加载模块分开算（DSH 踩过「清了模块缓存没刷新 package.json exports」）。

---

## 13. 商店

### 13.1 索引格式（format 1）

```jsonc
{
  "format": 1,
  "title": { "en": "AI Cut Plugins", "zh": "AI Cut 插件" },
  "description": { "zh": "AI Cut 的第三方插件索引" },
  "metadata": {
    "categories": { "video": { "title": { "zh": "视频" } } },
    "labels":     { "official": { "title": { "zh": "官方" } } },
    "sortKeys":   { "downloads": { "title": { "zh": "下载量" }, "order": "desc" } }
  },
  "plugins": [
    {
      "name": "@heshengtao/aicut-plugin-example",
      "title": { "zh": "示例插件" },
      "description": { "zh": "演示节点与命令注入" },
      "icon": "icons/example.svg",
      "author": "heshengtao",
      "homepage": "https://github.com/heshengtao/ai-cut-plugin-example",
      "repository": { "url": "https://github.com/heshengtao/ai-cut-plugin-example" },
      "metadata": { "category": "video", "labels": ["official"], "sortKeys": { "downloads": 0 } },
      "versions": [
        {
          "version": "0.1.0",
          "publishTimestamp": 1790000000,
          "source": { "type": "npm" },
          "engines": { "aicut": ">=1.3.0 <2.0.0" },
          "sha256": "9f2c…",
          "size": 48213
        }
      ]
    }
  ]
}
```

与 DSH 的三处有意差异：

1. **`sha256` 与 `size` 必填**：DSH 把校验放在索引生成器、安装时不查；我们强制宿主校验（`plugins.rs` 已有 sha256 强制、`MAX_ARCHIVE_BYTES = 2 GiB`、`MAX_ARCHIVE_ENTRIES = 10_000`）。
2. **不支持 `source.type = "git"`**：git 源意味着宿主负责构建，正是要避免的形态。只收已构建产物：`npm`（`name@version`）或 `tgz`（直链 + sha256）。
3. **`engines.aicut` 必填**：宁可让作者声明，也不要在加载期才发现不兼容。

### 13.2 默认源与仓库结构

```
https://raw.githubusercontent.com/heshengtao/ai-cut-plugin-market/main/index.json
```

仓库只放：`index.json`、`icons/`、`scripts/build-index.mjs`（从一份包名列表生成索引，只读不执行）。**现在 `plugins: []`**，后续手工添加。

- 默认内置但**可关、可改、可加第二个源**；配置落 `plugins/market.json`（跟着数据目录走）。
- 「实时发现」= 打开插件页按需 `refresh`；不做后台轮询。
- 索引缓存 TTL 6 小时 + ETag；`stale-cache` 可用但标注过期。

### 13.3 抓取与校验（在 daemon 做）

| 规则 | 值 |
| --- | --- |
| 协议 | 仅 `https:`（`http:` 只允许 localhost，便于本地自建索引） |
| URL | 不许含凭据、不许含 fragment |
| 重定向 | 拒绝 |
| 体积 | ≤ 8 MiB（索引只含元数据；比 DSH 的 128 MiB 小两个量级） |
| 并发 | 串行，一次一个索引源 |
| 失败 | 单源失败只影响它自己，展示「最近一次错误」 |
| 分页/搜索 | 在 daemon 完成，`limit ≤ 50`，渲染进程只拿一页 |
| 校验 | 逐字段 + 名称唯一 + 版本唯一 + sha256 形状 + `engines` 可解析 |

### 13.4 安装 target 拼装（唯一一处）

```
npm  → spec = "<name>@<version>", registry = source.registry ?? null
tgz  → spec = "<url>", sha256, size
```

只此一个函数拼装，UI 与后续 CLI 共用（DSH 的同款纪律：`marketInstallTarget` 是唯一点）。

---

## 14. 安装 / 更新 / 卸载事务

```
resolve → 预检 → 下载(cache) → sha256 → 解包(.tmp) → 原子 rename → 写名册 → 启用 → 加载
```

| 步骤 | 硬规则 |
| --- | --- |
| 预检 | 读 `aicut.plugin.json`：`format`、`engines`、依赖边、能力声明、产物存在性；不合法直接拒装 |
| 解包 | 只在 `store/<id>/<version>.tmp` 内；拒 `..`、拒符号链接、条目数/体积上限 |
| 原子化 | rename 成功后才写名册；任一步失败 → 清 `.tmp`，名册不变，磁盘不留半个插件 |
| 单飞 | 同一时刻只允许一个安装事务（复用 `plugins.rs` 的 `AtomicBool` 形态，冲突返回「已有插件正在安装」） |
| 更新 | 装新版本 → 激活成功 → 切 `activeVersion` → 旧版本保留可回滚；超过 3 个版本 GC |
| 卸载 | 先停（等 `busy` 清）→ 清名册 → 删 `store/<id>`；`data/<id>` 默认保留，可勾选删除。**`linked` 插件只移除名册记录，绝不删源目录** |
| 回滚 | 激活失败 → `activeVersion` 回退到上一版并重启该插件，不自动删新版本（留着排查） |

---

## 15. 工程兼容（缺插件）

1. **端口快照**：节点 `data.ports` 存端口定义，缺插件时从快照恢复端口与连线（修掉「保留节点、丢连线」）。
2. **占位而非报错**：缺插件的节点渲染成「插件未安装 · 去商店」占位；工程能正常打开、保存、导出（该节点视为无产物）。
3. **不静默改 type**，不自动删未知参数。
4. **参数迁移由插件负责**：节点记 `pluginVersion`；插件可选 `migrate(params, from)`，未提供则原样保留未知字段。
5. **先例风险**：`schema.ts` 会丢弃「端口类型解析不出来」的连线，K7 必须先落地，否则插件节点在旧版本工程里会断连。

---

## 16. 安全与信任

### 16.1 隔离矩阵（诚实版）

| 半 | 隔离 | 说明 |
| --- | --- | --- |
| 宿主半 | **真隔离** | 独立 QuickJS Runtime/线程、`ctx` 是唯一能力面、中断处理器、内存/超时/配额 |
| 客户端半 | **无隔离** | 与编辑器共用同一个 JS 上下文、同一份 Pinia store、同一个工程文档。这是既有债务，v1 不承诺消掉 |

因此安装确认框必须写明三件事：**客户端代码与编辑器同权**、来源（索引源 / 作者 / 仓库）、`capabilities.net` 域清单 + `inject` 边 + sha256。

### 16.2 资源路由收口

- 新增 `GET /plugins/<id>/<version>/client.js?rev=`，只允许 `store` 目录内、禁路径穿越、按 `rev` 精确匹配。
- **不复用 `/file`**：它现在能读任意绝对路径（`rpc.rs:1939`），且 headless 的 `authorized()` 恒真（`rpc.rs:57`）。这条不在本次修复范围，但插件路径不得依赖它。
- 桌面仍需 `asset://`（scope `**`）：路径一律由宿主从 `store` 根拼出后再交给 `convertFileSrc`，插件拿不到拼接权。

### 16.3 安全模式

- `--safe-mode` 启动：禁用所有第三方插件（名册不动，只跳过加载）。
- 启动失败自动降级：记录「本次启动新增/更新的插件」，若加载期崩溃，下次启动自动禁用该插件并提示（对应 DSH 的原生恢复对话框）。

---

## 17. 私有插件（作者的 H3 节点）

这是本设计的真实验收目标：**零内核改动、零 Rust 改动**。

| 需求 | 由谁提供 |
| --- | --- |
| multipart 提交（`first_frame`/`ref_0..5`/`ref_audio_0..2`） | `ctx.http.multipart()`（宿主实现，含二进制文件 part） |
| `X-Card-Key` 自定义头 | `ctx.http.request({ headers })` |
| 轮询 `/api/v1/tasks/{id}`、`/file-url` | 插件 host 半自带逻辑；`ctx.jobs` 管取消/超时 |
| 下载直链 → 产物入库 | `ctx.http.download` → `ctx.media.importBytes` |
| 出现在模型下拉 | `ctx.providers.register()` |
| 画布节点与参数（分辨率 0.4/1/2、画幅整串） | `ctx.nodes.register()`（v1 用现有 7 种 param kind） |

落地方式：`kind: "linked"` 指向本地目录，**不进索引、不进主仓库、不开源**。仓库内不出现该插件的任何代码。

---

## 18. 验收标准

1. 内置节点全部改走 adapter 注册表后，`pnpm test` + 手测画布行为与改造前一致。
2. 一个只含客户端半的示例插件（本地 linked）能：安装 → 出现节点与命令 → 跑通 → 禁用 → 节点消失 → 卸载无残留。
3. 一个含宿主半的示例插件能：`ctx.http` 请求成功、超时被中断、`ctx.jobs` 取消生效、崩溃只影响自己。
4. 修改插件 `client.js` 后不重启，500ms 级检测到 `rev` 变化并完成替换；有任务在跑时返回 `busy` 而不是硬替换。
5. 工程文件含未安装插件的节点时：能打开、连线在、节点占位、保存后不丢数据。
6. 商店：空索引可加载；添加一条假索引后能搜索、分页、安装；sha256 不符拒绝安装；索引 404 不影响已装插件。
7. 重复 id 安装被拒绝并指出占用者；slot 名越界被拒绝并记诊断。
8. 私有 H3 插件（linked）能从画布跑到真实视频并入素材库，全程未改内核与 Rust。

---

## 19. 测试策略

| 层 | 覆盖 |
| --- | --- |
| Rust 单测 | manifest 校验、SemVer 范围、名册锁与回滚、索引解析/校验、路径穿越、解包上限、`rev` 计算 |
| Rust 集成 | actor 超时中断、OOM 杀进程、取消传播、安装事务失败回滚、单飞锁 |
| TS 单测 | 模块表惰性登记与物化、样式标签精确移除、slot 注册/卸载、命令冲突、热替换七步顺序（mock registry） |
| TS 集成 | adapter 表：内置节点全部经表运行；`data.ports` 快照恢复连线 |
| e2e / 手测 | §18 的 8 条验收 |

---

## 20. 分期落地

| 阶段 | 内容 | 可独立验收 |
| --- | --- | --- |
| M0 | 内核改造 K1–K10（内置行为不变） | `pnpm build` + 全套测试 + 手测画布 |
| M1 | 加载器与生命周期（仅 `linked`、仅客户端半） | 示例插件出现节点/命令、可禁用 |
| M2 | 宿主半 + ctx（QuickJS actor、http/media/jobs/storage、中断与配额） | 示例插件发真实 HTTP |
| M3 | 商店（索引抓取、安装事务、更新/卸载、进度、安全模式、插件管理页） | 空索引 + 假索引安装 |
| M4 | 注入点第二批（`ai.pane`、`board.inspector`）+ 私有 H3 插件落地 | §18 第 8 条 |

M0 之后每个阶段都能独立发布；M1–M2 不依赖商店，M3 不依赖 M4。

---

## 21. 风险与未决

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| **QuickJS 的 Promise / 事件循环驱动**（最大实现风险） | 插件写 `async/await` 需要宿主驱动 job queue；`rquickjs` 需自行 pump | M2 先只承诺「同步 API + 回调」，评估后再开 Promise |
| 客户端半无沙箱 | 恶意插件可改工程 | 安装确认 + 来源展示 + 安全模式；长期考虑 utilityProcess/iframe |
| WebKitGTK 的动态 ESM 行为 | Linux 上可能加载失败 | 不用 import map；M1 就在 Linux 冒烟 |
| 插件体积/内存 | 多插件拖慢启动 | 惰性 factory + 空闲预取；每插件内存上限 |
| 工程文件版本漂移 | 参数失配 | `data.ports` 快照 + 插件 `migrate` |
| 与「工程另存 / 多窗口」的交互 | 名册是进程级单例 | 名册只由 daemon 持有，多客户端只读 |
| `docs/roadmap.md:215` 的「插件市场与第三方 UI 扩展」非目标 | 文档与实际冲突 | 本次一并更新路线图 |

### 未决（已给 v1 默认，后续可改）

| 议题 | v1 默认 | 何时重新评估 |
| --- | --- | --- |
| 插件设置面板放哪 | 扩展 `PluginsPane`（插件自己的管理页），不进设置页 | 设置页分区拆分完成后（§10.3） |
| 「插件禁用但工程节点仍可运行」降级模式 | **不做**：禁用即节点停用，工程里显示「插件已禁用」占位 | 有用户真的需要「临时禁用但仍出片」时 |
| 商店「下载量/评分」排序键 | 索引 schema 保留字段，**我们从不在本地统计**，只显示市场给出的值 | 需要真实统计时再加口径 |

---

## 22. 影响面

- `docs/roadmap.md:215`：把「插件市场与第三方 UI 扩展」从非目标移出，指向本设计。
- `AGENTS.md`：新增「插件」一节——产物不可变、清单不许手抄、插件与内核的边界、`/plugins` 路由不得依赖 `/file`。
- `src/stores/plugins.ts` / `ModelsPane.vue` / `PluginsPane.vue`：复用现有安装进度 UI 形态；**注意 `PluginManager.vue`（621 行）是死代码，不要接**。
- `crates/daemon/src/plugins.rs`：OFX 继续独占；新的 `plugin_host` 在独立目录，复用其下载/校验/解包/进度事件的重型逻辑（抽公共部分，不复制）。
- `src/components/board/BoardNode.vue`：新增插件节点的占位与渲染分支（3606 行单文件，M1 前先抽节点卡片子组件）。

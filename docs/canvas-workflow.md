# 多画布与工作流（画布侧设计说明）

> 状态：已落地。本文描述工程里的多画布文档、画布上的工作流开始 / 结束 / 嵌入节点、
> 发布与调用方式，以及暴露给 MCP / 技能的画布原子操作。节点视觉与交互红线见
> [`canvas-node-design.md`](canvas-node-design.md)。

## 1. 多画布

一个工程可以有任意多张画布（和 ai-board 的扁平画布列表一致：一张画布 = 一个可执行程序）。

```ts
interface BoardCanvas {
  id: string;      // `canvas-<uuid>`，稳定
  title: string;   // 用户可改；空字符串 = 自动名「画布 N」（渲染时按当前语言）
  doc: BoardDoc;   // 节点 / 连线 / 视口 / source（来自工作流库的哪张卡）
}

interface Project {
  boards?: BoardCanvas[];   // 真相：工程里的全部画布
  activeBoardId?: string;   // 活动画布
  board?: BoardDoc;         // 活动画布的**可枚举访问器**（不是第二份数据）
}
```

规则：

- **一份数据**：写盘只有 `boards`；`serializeProject()` 会剔除 `board` 投影。
  读盘时 `attachBoardView()` 把老工程的单张 `board` 迁移成一张画布。
- **所有文档产出点都要折返**：`attachEpisodeView()` 内部会调用 `attachBoardView()`；
  任何 `{ ...doc }` 展开出来的文档交给 store 之前必须折返（与 `tracks` / `markers`
  投影同一套纪律）。
- **切换画布**：board store 先 `flush()` 把防抖窗口里的编辑写回活动画布，再让
  project store 改 `activeBoardId`；活动画布文档变化触发画布重载，并自动**适应画布**
  （fit）一次，避免新画布的节点落在视野外。所有「适应画布」的缩放上限是 **100%**
  （`FIT_MAX_ZOOM`）：只有一个节点时不会把它放大到占满全屏。
- **删除**：工程至少保留一张画布；删掉活动画布时切到相邻一张。被删画布的
  工作流库版本不受影响。
- **历史数据修复**：早期版本把缺词条的 `t()` 返回值（key 本身）写进过画布标题
  （例如 `board.canvas.defaultTitle`）。载入时 `attachBoardView()` 用
  `isKnownMessageKey()` 识别并清成自动名；UI 侧 `canvasTitle()` 也有同样的兜底。
- **画布身份 vs 工作流身份**：画布是工程内的；`BoardDoc.source` 记录它来自工作流库
  的哪张卡（保存时据此追加版本，而不是新建）。

UI 入口：**画布检查器**（右侧面板常驻）。点画布空白处不选中任何节点时，检查器展示
画布列表：新建 / 切换 / 改名 / 复制 / 删除，以及当前画布的签名与发布状态。

## 2. 工作流开始 / 结束：画布的对外签名

两个节点**成对创建**（共享 `data.pairId` + `kind: "pair"` 的配对线），删除任意一端
另一端与配对线一起消失；`workflow.end` 不出现在添加菜单里。

```ts
interface WorkflowPortDecl {
  id: string;          // 稳定行 id = 端口 id：改名不移动连线
  name: string;        // 结果对象的键（对外 API 字段名）
  label: string;       // 给人看的标签
  type: BoardPortType; // 数据类型注册表里的 id（插件类型同样合法）
  required?: boolean;
  default?: unknown;   // 输入行默认值（没接上游、外部也没传时用）
}

interface WorkflowSignature { inputs: WorkflowPortDecl[]; outputs: WorkflowPortDecl[]; }
```

- 开始节点声明 `inputs`，每个输入发布成一个输出端口；结束节点声明 `outputs`，
  每个输出是一个输入端口（收集）加一个 `out-<id>` 值端口（下游可读）。
- 签名行在**画布检查器**里增删：名字 / 标签 / 类型 / 默认值 / 必填。
  类型下拉来自 `core/board/dataTypes.ts`，第三方插件注册的类型自动出现，不需要改节点代码。
- 输入 / 输出值的设置方式和循环结束节点一致：每行一个**来源选择**（上游输出）
  加删除按钮，新建输入就加一行——端口 `id` 是稳定行 id，不用重新连线。
- 「循环结束」与「工作流结束」共用同一种行式输入区：行 = 序号 / 名字（签名行）+
  来源下拉 + 删除，不再有「参数区输入数量 + 输入区只读列表」两份 UI。

## 3. 嵌入工作流（`workflow.call`）

- 目标：工作流库里**已发布**（标签含 `subworkflow` 或 `api`）的工作流，排除自己。
  节点里存的是 **rootId**（一张工作流卡），运行时解析成最新版本快照；目标重新发布、
  输入签名变了会提示重新选择，不会静默跑错。
- 选中目标后把它的签名快照写进 `data.ports`（和插件节点的端口快照同一机制）：
  目标被删 / 改名后端口与连线仍在，运行时报明确错误，不会静默丢边。
- 运行时按**签名行 id** 从父画布的上游取输入（检查器里每行选来源），在子作用域里
  顺序执行子图的节点，再把结束节点声明的输出发布成 `out-<id>` 值端口。
- 递归：调用栈记录 rootId，成环立即报错；深度上限 8。目标缺失、缺少成对开始 / 结束、
  没有发布都抛错。

执行模型：`src/composables/useBoardRun.ts` 的 `RunScope`。上游读取（文本 / 素材 / 值 /
参考文件）都显式带作用域——顶层画布用全局作用域，子工作流用快照节点的子作用域；
**不要**用模块级「当前画布」变量，父画布节点和子工作流节点会并发执行。

## 4. 发布与调用

发布 = 把当前画布保存成工作流库的一个新版本，并打标签：

| 标签 | 含义 |
| --- | --- |
| `workflow` | 基础标签（有签名的工作流） |
| `subworkflow` | 可被其它画布用「嵌入工作流」节点调用 |
| `api` | 可被外部 / AI Harness / MCP 调用 |

- UI：画布检查器的画布列表里，每一行有一个显眼的「发布」按钮；点开是
  「发布工作流」模态框（名字 + 可调用 API / 可被嵌入 两个开关 + 校验问题），
  校验通过才允许发布。列表行上会显示「已发布」徽章。
- 校验（`core/board/workflowNodes.ts` 的 `workflowProblems`）：恰好一个开始、恰好一个
  结束、成对、名字非空且唯一、必填输出接了上游、没有数据环。
- 工作流库按 `子工作流` / `API` 筛选，卡片上有对应徽章。
- 调用：`workflow_run`（MCP）与嵌入节点走**同一个** `runWorkflowDoc()`，返回对象的键是
  结束节点声明的输出名。

## 5. 暴露给 MCP / 技能的原子操作

桌面版通过渲染进程的桥接方法（`src/core/mcpBridge.ts`）执行，全部落在 board store 上，
撤销 / 过期标记 / 落盘与手点一致：

| 工具 | 桥接方法 | 说明 |
| --- | --- | --- |
| `board_list_canvases` | `board.list` | 画布列表 + 签名 + 能否发布（含 problems） |
| `board_get_canvas` | `board.get` | 一张画布的完整节点 / 连线 |
| `board_create_canvas` | `board.create` | 新建并切换 |
| `board_delete_canvas` | `board.delete` | 删除（至少保留一张） |
| `board_rename_canvas` | `board.rename` | 改名 |
| `board_open_canvas` | `board.open` | 切换活动画布 |
| `board_apply_ops` | `board.apply` | 原子操作组：`add_node` / `update_node` / `remove_node` / `connect` / `disconnect` / `clear` / `load` |
| `workflow_publish` | `workflow.publish` | 校验 + 保存 + 打标签 |
| `workflow_list` | `workflow.list` | 已发布条目（标签过滤，带签名） |
| `workflow_run` | `workflow.run` | 运行已发布工作流，返回签名输出 |

无头 daemon（`aicutd`）没有渲染进程，但画布**写入**已经下沉到领域层：

- 读：`board_list_canvases` / `board_get_canvas` 从工程快照读（`boards` 是真相），
  `workflow_list` 直接读本机工作流库；
- 写：`board_create_canvas` / `board_delete_canvas` / `board_rename_canvas` /
  `board_open_canvas` / `board_apply_ops` 走 `crates/daemon/src/agent_tools.rs` →
  `doc_ops("board_*")` → `src/domain/host.ts` → `src/core/board/ops.ts`。语义只有一份：
  成对节点（开始 + 结束 + 配对线）、组员连带删除、显示节点牌堆口的上限、任一条失败整组
  不落地。撤销 / revision 用引擎侧快照栈（`undo` 能撤回整次调用）。
- 仍然桌面专属：`workflow_publish`（要工作流库校验）与 `workflow_run`（要前端运行器），
  返回值里明确说明原因，不伪造成功。

桌面端之所以还保留一条 store 通道：画布编辑要即时反映在 UI 上，还要维护选中态与防抖落盘。
两边共用 `core/board/ops.ts` 的语义，store 只负责 commit / selection。

### 代码出片（`render_code`）

three.js / Remotion 这类「代码 → 视频」不在应用里渲染：它们的依赖与构建都发生在用户的
工程目录里，应用替不了。工具只负责契约的另一半（`crates/daemon/src/render_code.rs`）：

1. 在 `cwd` 里跑一条命令（`sh -c` / `cmd /C`，stderr 合并进 stdout）；
2. 进度按 400ms 节流推到 `render-code-progress`；超时（默认 900s）或 `job_cancel` 都会杀进程；
3. 失败 / 超时 / 取消：删掉**本次新建**的产物（跑之前就存在的文件不动），报错带输出尾部；
4. 成功：`ffprobe` 探测 → `import_asset` → 给了 `nodeId` 时把素材回填到该节点
   （输入 / 显示节点连牌堆一起换成这一个），`params` 里的溯源标量逐键并进节点已有参数。

节点上只存素材 id 与溯源参数，源码和渲染命令留在工程目录里——这是「可重放」的最低要求：
改完代码重新调一次 `render_code`，同一个节点、同一个 `outputPath` 就是新版本。

## 6. 已落地的边界

- 画布之间**不**共享节点；跨画布复用只有「嵌入工作流」一种方式。
- 发布是显式动作；保存画布版本不会自动打发布标签。
- 清空未保存的画布会弹三选一（保存并清空 / 直接清空 / 取消），不会偷偷往库里存版本。
- 画布文档仍随工程保存（不是独立文件）；工作流库是全局的，跨工程可用。

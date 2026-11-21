# 域：工作流（workflow）

## 标准闭环

1. `get_project`：只拿 `revision`、规格、轨道摘要与素材数量。
2. 定位关注点：用户说“这里/选中” → `get_context`；要某条轨 → `get_track`；要找片段 → `find_clips`；要改一个 → `get_clip`。
3. 规划：目标时长、插入位置、轨道层级、是否需要新轨或新素材。
4. `import_asset`：需要新素材时先导入，拿 `asset.id`。
5. 写入：单条用 `apply_command`；一组相关修改用 `apply_commands`（一次 revision、一个撤销步）。
6. 只回读受影响的片段验证：`get_track` 或 `get_clip`。
7. 需要回退时 `undo`；确认无误后告诉用户做了什么。

## 典型任务

**插入 B-roll**
- `track.add`（如无空轨，可带 `name`）→ `import_asset` → `append_clip`（自动接轨尾）或 `clip.add`（指定落点）。

**调整节奏**
- `clip.move` 平移；`clip.trim` 改入出点；`clip.split` 在播放头切分；`ripple_delete` 删除并补空隙。

**加文字**
- 优先用已有文字片段 `clip.update` 改 `text`；新建时 `clip.add` 的 `assetId` 为 `""`，并给 `duration`。
- 批量改样式（字号、颜色、位置）用 `apply_commands` 一次提交。

**批量修改**
- 用 `apply_commands`，不要一条条发；整批失败不会留下半成品。

## 坑

- `revision` 会因人类操作而变化；收到过期错误时重新 `get_project`（只读概览即可），不要重试旧命令。
- 同轨不能重叠；插入位置冲突时顺延到冲突片段之后，或换一条轨道。
- `clip.add` / `clip.update` 会拒绝未知素材、越过素材范围与重叠；不要绕过校验。
- 片段 id 是全局唯一的；`clip.update` / `clip.trim` / `clip.remove` / `get_clip` 都用这个 id。
- `get_project` 不再返回片段与素材明细；不要期待在概览里看到它们。
- 当前没有字幕轨；用文字片段、素材叠加与变换表达。

## 画布工作流（多画布 / 签名 / 嵌入 / 发布）

时间线工作流之外，工程还有**画布**：一个工程多张画布，每张画布是一段可执行的工作流。

**发现与读取**

- `board_list_canvases`：每张画布的 `id` / `title` / `active` / 节点连线数 / 来源工作流 /
  签名（`workflow.start` 的输入、`workflow.end` 的输出）/ 能否发布。
- `board_get_canvas { canvasId? }`：完整节点与连线；省略读活动画布。

**改图**

- `board_apply_ops { canvasId?, ops[] }`：一次调用一组原子操作，**一个撤销步**：
  - `add_node`：`{ id, type, position:{x,y}, size?, data:{ params, bindings, … } }`
  - `update_node`：`{ nodeId, patch:{ position?, size?, data? } }`
  - `remove_node`：`{ nodeIds: string[] }`（成对的循环 / 工作流节点会连体删除）
  - `connect` / `disconnect`：`{ edge }` / `{ edgeIds }`；连线只记 `sourcePort` / `targetPort`
  - `clear` / `load`：清空 / 整份替换
- 画布级：`board_create_canvas { title? }`、`board_delete_canvas { canvasId }`、
  `board_rename_canvas { canvasId, title }`、`board_open_canvas { canvasId }`。

**签名与发布**

- 画布上的 `workflow.start` 与 `workflow.end` 成对出现（共享 `pairId`）。开始节点
  `data.signature.inputs`、结束节点 `data.signature.outputs`，每行是
  `{ id, name, label, type, required?, default? }`；`id` 是端口 id（改名不移动连线），
  `name` 是结果对象的键。类型来自数据类型注册表，插件类型同样可用。
- `workflow_publish { canvasId?, name?, tags? }`：校验「恰好一对开始结束 + 名字唯一 +
  必填输出已接线 + 无环」，保存进库并打标签；`subworkflow` = 可被嵌入，`api` = 可被调用。
- `workflow_list`：只列打了 `api` / `subworkflow` 的最新版本，附签名。
- `workflow_run { rootId, inputs }`：只接受已发布条目；`inputs` 的键可以是签名行 id、
  `name` 或 `label`；返回对象的键是结束节点声明的输出名。

**嵌入而不是复制**

- 父画布用 `workflow.call` 节点嵌入子工作流；端口快照来自目标签名，目标被删时端口
  与连线保留、运行报错。递归成环或超过 8 层直接报错，不会挂死。

**坑**

- 画布编辑不在时间线命令总线里：不要用 `apply_command` 改画布，也不要用 `undo` 期待撤销
  画布操作（用 `board_apply_ops` 自身的撤销步）。
- 无头（容器 / 浏览器版）只能读画布与工作流库，写入 / 发布 / 运行需要桌面版渲染进程，
  会返回明确的错误。

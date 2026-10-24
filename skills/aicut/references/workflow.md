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

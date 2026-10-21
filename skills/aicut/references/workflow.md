# 域：工作流（workflow）

## 标准闭环

1. `get_project`：记录 `revision`、轨道 id、片段 id、素材 id。
2. 规划：目标时长、插入位置、轨道层级、是否需要新轨。
3. `import_asset`：需要新素材时先导入，拿 `asset.id`。
4. `apply_command`：一次做一件清晰的事；每次都用最新 `revision`。
5. 重新 `get_project` 验证：片段是否落在预期时间、同轨是否重叠。
6. 需要回退时 `undo`；确认无误后告诉用户做了什么。

## 典型任务

**插入 B-roll**
- `track.add`（如无空轨）→ `import_asset` → `clip.add`。

**调整节奏**
- `clip.move` 平移；`clip.trim` 改入出点；`clip.split` 在播放头切分；`clip.remove` 删除多余段。

**加文字**
- 优先用已有文字片段 `clip.update` 改 `text`；新建时 `clip.add` 的 `assetId` 为 `""`，并给 `duration`。

**批量修改**
- 拆成多条命令，每条一个撤销步；不要一次改一大片。

## 坑

- `revision` 会因人类操作而变化；收到过期错误时重新 `get_project`，不要重试旧命令。
- 同轨不能重叠；插入位置冲突时顺延到冲突片段之后，或换一条轨道。
- 片段 id 是全局唯一的；`clip.update` / `clip.trim` / `clip.remove` 都用这个 id。
- 当前没有字幕轨、蒙版轨和内置转场；用文字片段、素材叠加与变换表达。

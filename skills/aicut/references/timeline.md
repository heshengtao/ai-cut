# 域：时间线（timeline）

所有写操作都通过 `apply_command`（多条用 `apply_commands`），先 `get_project` 拿 `revision`。

## 轨道

```json
{"kind":"track.add","baseRevision":3,"payload":{"index":0,"name":"字幕"}}
{"kind":"track.update","baseRevision":4,"payload":{"trackId":"...","patch":{"muted":true}}}
{"kind":"track.move","baseRevision":5,"payload":{"trackId":"...","toIndex":2}}
{"kind":"track.remove","baseRevision":6,"payload":{"trackId":"..."}}
```

- `track.add` 可以传 `name`；`get_project` 的轨道摘要也包含 `name`。仍然推荐用 1 起始的 `index` 定位，名字只作语义提示。
- `trackId` 可传轨道 id 或 1 起始 `index`。
- `track.add` 后返回结果的 `affected.trackIds` 能看到新轨道 id；也可以重读概览。
- 删除轨道会连带删除轨道上的片段。

## 片段

```json
{"kind":"clip.add","baseRevision":7,"payload":{"trackId":"...","clip":{"assetId":"...","start":12,"duration":4,"in":0}}}
{"kind":"clip.update","baseRevision":8,"payload":{"clipId":"...","patch":{"opacity":0.6,"gain":-3}}}
{"kind":"clip.move","baseRevision":9,"payload":{"clipIds":["..."],"delta":-1.5}}
{"kind":"clip.trim","baseRevision":10,"payload":{"clipId":"...","edge":"end","time":18.5}}
{"kind":"clip.split","baseRevision":11,"payload":{"clipIds":["..."],"at":6.0}}
{"kind":"clip.remove","baseRevision":12,"payload":{"clipIds":["..."]}}
```

### 变速

```json
{"kind":"clip.speed","baseRevision":13,"payload":{"clipId":"...","speed":2}}
```

- 速度范围 0.1–4；保持素材区间不变，时间线时长 = 原时长 × 原速度 / 新速度。
- 结果会被同轨下一个片段和素材剩余范围夹紧；`set_clip_speed` 工具等价。
- 预览与导出都按同一套 `speed` 计算；`clip.update` 也可以直接改 `speed`，但要同时保证 `duration × speed` 不越界。

### 合成原语

```json
{"kind":"clip.color","baseRevision":14,"payload":{"clipId":"...","patch":{"brightness":0.1,"saturation":1.2}}}
{"kind":"clip.mask","baseRevision":15,"payload":{"clipId":"...","mask":{"shape":"ellipse","x":0.2,"y":0.1,"width":0.6,"height":0.8,"feather":0.1}}}
{"kind":"clip.transition","baseRevision":16,"payload":{"clipId":"...","edge":"in","transition":{"type":"fade","duration":0.5}}}
{"kind":"clip.keyframes","baseRevision":17,"payload":{"clipId":"...","property":"scale","keyframes":[{"time":0,"value":1},{"time":2,"value":1.2}]}}
```

- 调色：`brightness` -1..1、`contrast` 0..2、`saturation` 0..3、`temperature`/`tint` -1..1。
- 蒙版：`shape` = `rect` / `ellipse` / `linear`；坐标按画面归一化到 0..1。只对视频/图片生效。
- 转场：`edge` = `in` / `out`；`type` = `fade` / `slide`；`slide` 支持 `left/right/up/down`。这是片段入/出动画，不是重叠式交叉淡化。
- 关键帧：`property` = `opacity` / `x` / `y` / `scale` / `rotation`；`time` 相对片段起点。传 `null` 清空。
- 对应工具：`set_clip_color` / `set_clip_mask` / `set_clip_transition` / `set_clip_keyframes`。
- 预览是近似实现；需要确认最终效果时用 `render_frame` / `render_storyboard`。

### 确定性宏

```json
{"kind":"clip.append","baseRevision":14,"payload":{"assetId":"...","trackId":1}}
{"kind":"clip.duplicate","baseRevision":15,"payload":{"clipIds":["..."],"offset":4}}
{"kind":"clip.ripple_delete","baseRevision":16,"payload":{"clipIds":["..."]}}
```

- 直接调用同名工具也可以：`append_clip` / `set_clip_speed` / `duplicate_clips` / `ripple_delete`。
- `clip.append` 省略 `trackId` 时用最后一条轨道，没有轨道就自动新建；省略 `start` 时接在轨尾；省略 `duration` 时用素材时长（图片默认 5 秒）。
- `clip.duplicate` 的结果与目标轨道现有片段重叠会被拒绝；复制到同轨时记得给 `offset`。
- `clip.ripple_delete` 只影响片段所在轨道：删除后同轨后续片段左移补空隙。

### 批量

```json
{
  "commands": [
    {"kind":"clip.update","payload":{"clipId":"...","patch":{"opacity":0.6}}},
    {"kind":"clip.update","payload":{"clipId":"...","patch":{"opacity":0.6}}}
  ],
  "baseRevision": 16,
  "label": "统一不透明度"
}
```

调用 `apply_commands`。整批在草稿上执行，全部成功才提交：一次 revision、一个撤销步；任意一条失败整批不生效。`baseRevision` 可以省略，工具会读取当前 revision 并注入每条命令。

## 约束

- 时间单位是秒，落点会按帧率吸附。
- 同轨禁止重叠；`clip.add` / `clip.update` / `clip.duplicate` 都会拒绝重叠。
- `clip.add` / `clip.update` 会校验素材存在与素材范围；文字片段（`assetId:""`）不受素材范围限制。
- `clip.trim` 的 `edge:"start"` 会同时调整 `start` 与 `in`，`edge:"end"` 只改 `duration`。
- `clip.update` 不允许改 `id` / `trackId`；跨轨用 `clip.move`。
- 文字片段：`assetId` 为 `""`，用 `clip.update` 的 `patch.text` 改文案。

## 分离视频音频

优先用一个 `extract_audio({clipId})` 完成；它等价于下面的命令组合。需要自定义轨道名时再手工拼：

1. `get_project`，从目标视频片段拿到 `trackId`、`assetId`、`start`、`duration`、`in`，以及所在轨道的 `index`。
2. `track.add`，`index` 填源轨道的 `index`（1 起始，插到原轨下面）；重新 `get_project` 拿新轨道 id。
3. `clip.add` 到新轨道：复用视频的 `assetId`，`start` / `duration` / `in` 与原片段一致，并加 `"audioOnly": true`。
4. `clip.update` 原片段，`patch` 为 `{"muted": true}`。

之后音频片段可以单独调 `gain`、降噪或做人声分离；`audioOnly` 片段在预览 / 导出时不再渲染画面。

## 画面属性

`clip.update` 的 patch 可包含：`opacity`、`transform`（x/y/scale/rotation）、`gain`、`fadeIn`、`fadeOut`、`blendMode`、`cornerRadius`、`text`、`textStyle`、`stroke`、`shadow`。

## 字幕

字幕在时间线里仍是文字片段（`assetId: ""`），但可以和 SRT / VTT 交换：

```json
{"kind":"subtitle.import","baseRevision":17,"payload":{"entries":[{"start":0,"end":2.5,"text":"第一句"}],"trackName":"字幕"}}
```

- 直接调用 `import_subtitles({path})` 读取文件并写入置顶文字轨；重叠条目会自动拆到新轨。
- `export_subtitles({outputPath, trackId?})` 从文字片段生成 SRT/VTT；`trackId` 省略时导出全部文字片段。
- 改字幕文本仍用 `clip.update` 的 `patch.text`；样式用 `patch.textStyle` / `stroke` / `shadow`。

## 标记

标记是工程级对象，不属于片段：

```json
{"kind":"marker.add","baseRevision":18,"payload":{"time":12.5,"name":"转折"}}
{"kind":"marker.update","baseRevision":19,"payload":{"markerId":"...","patch":{"name":"第二幕"}}}
{"kind":"marker.remove","baseRevision":20,"payload":{"markerId":"..."}}
```

- 读取用 `get_markers(from?, to?)`；概览里的 `project.markerCount` 只给数量。
- 标记命令不会改变片段，但同样进入撤销历史。
- 时间线里点击标记可定位播放头；双击重命名，右键删除。

## 验证

写完只回读受影响的片段：`get_track(trackId)` 或 `get_clip(clipId)`，检查起止时间、轨道与属性。需要回退时调用 `undo`；批量操作只回退一步。

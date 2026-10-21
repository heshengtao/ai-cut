# 域：时间线（timeline）

所有写操作都通过 `apply_command`，先 `get_project` 拿 `revision`。

## 轨道

```json
{"kind":"track.add","baseRevision":3,"payload":{"index":0}}
{"kind":"track.update","baseRevision":4,"payload":{"trackId":"...","patch":{"muted":true}}}
{"kind":"track.move","baseRevision":5,"payload":{"trackId":"...","toIndex":2}}
{"kind":"track.remove","baseRevision":6,"payload":{"trackId":"..."}}
```

- 轨道没有名称；`get_project` 返回的轨道带 1 起始的 `index`，用它定位轨道。
- `track.add` 后重新 `get_project` 拿新轨道 id；返回结果的 `affected.trackIds` 也能看到。
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

- 时间单位是秒，落点会按帧率吸附。
- 同轨禁止重叠；`clip.add` 会拒绝重叠，需要先换位置或用 `clip.move`。
- `clip.trim` 的 `edge:"start"` 会同时调整 `start` 与 `in`，`edge:"end"` 只改 `duration`。
- 文字片段：`assetId` 为 `""`，用 `clip.update` 的 `patch.text` 改文案。

## 画面属性

`clip.update` 的 patch 可包含：`opacity`、`transform`（x/y/scale/rotation）、`gain`、`fadeIn`、`fadeOut`、`blendMode`、`cornerRadius`、`text`、`textStyle`、`stroke`、`shadow`。

## 验证

写完重新 `get_project`，检查片段数量、起止时间与轨道层级。需要回退时调用 `undo`。

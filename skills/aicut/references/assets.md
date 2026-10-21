# 域：素材（assets）

## 导入

```json
{"path":"/absolute/path/to/clip.mp4","name":"海边日落"}
```

调用 `import_asset`。Rust 侧会用 ffprobe 读取时长、分辨率、帧率与音轨，然后把素材加入工程。
返回 `{asset, result}`；`asset.id` 用于后续 `clip.add`。

- 支持视频、音频与常见图片格式。
- 路径必须是本机可读的绝对路径。
- 图片没有时长，`clip.add` 时需要显式给 `duration`。

## 查询

`get_project` 的 `project.assets` 是素材表：`id` / `name` / `kind` / `src` / `duration` / `width` / `height` / `fps` / `hasAudio`。

## 更新与删除

```json
{"kind":"asset.update","baseRevision":5,"payload":{"assetId":"...","patch":{"name":"新名字"}}}
{"kind":"asset.remove","baseRevision":6,"payload":{"assetId":"..."}}
```

删除素材会连带删除引用它的所有片段。

## 片段引用

```json
{"kind":"clip.add","baseRevision":7,"payload":{"trackId":"...","clip":{"assetId":"<asset id>","start":0,"duration":5,"in":0}}}
```

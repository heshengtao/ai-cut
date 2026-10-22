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

## 探测内容（省 token）

不要为了「看看素材里有什么」连续渲染帧。先调用：

```json
{"path":"/absolute/path/to/clip.mp4","motion":true,"objects":"none","transcript":false,"interval":2,"maxSamples":60}
```

`probe_media` 一次返回：

- `media`：ffprobe 元数据（时长、宽高、帧率、旋转、音视频轨、编码）。
- `samples`：按 `interval` 采样的 `{time, motion, objects}`；`motion` 是相对上一采样帧的运动量（0..1）。
- `motionSegments`：按 low / medium / high 合并的运动区间。
- `cuts`：强运动点，可当作候选镜头切点。
- `transcript`：`transcript: true` 时返回 `{model, cues:[{start,end,text}]}`；需要已安装 ASR + `silero-vad`。
- `warnings`：可选分析降级时的原因。

目标框需要模型：`objects:"face"` 用 YuNet（feature `reframe`），`objects:"person"` 用 YOLOX（feature `track`），
`objects:"auto"` 两者都试。坐标已归一化到 0..1，可直接映射到画面比例。
`interval` / `maxSamples` 控制采样密度与覆盖范围；更细的切点就缩小 `interval` 再调一次。

## 查询

`get_project` 只给素材数量与类型分布。素材明细用 `get_assets` 分页读取，支持 `kind` / `name` / `offline` 过滤；返回 `id` / `name` / `kind` / `src` / `duration` / `width` / `height` / `fps` / `hasAudio`。

## 字幕文件

字幕不是素材：用 `import_subtitles({path})` 读 SRT/VTT 并生成文字轨，用 `export_subtitles({outputPath})` 从文字片段导出。字幕文件不会进入素材库。

## 更新与删除

```json
{"kind":"asset.update","baseRevision":5,"payload":{"assetId":"...","patch":{"name":"新名字"}}}
{"kind":"asset.remove","baseRevision":6,"payload":{"assetId":"..."}}
```

删除素材会连带删除引用它的所有片段。

## 片段引用

```json
{"kind":"clip.add","baseRevision":7,"payload":{"trackId":"...","clip":{"assetId":"<asset id>","start":0,"duration":5,"in":0}}}
{"kind":"clip.append","baseRevision":8,"payload":{"assetId":"<asset id>","trackId":1}}
```

需要“导入后直接接到轨道末尾”时用 `append_clip`：省略 `start` 会接在轨尾，省略 `duration` 会用素材时长（图片默认 5 秒）。

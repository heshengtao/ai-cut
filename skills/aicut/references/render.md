# 域：增量渲染、审片与对比（render）

这个域解决一件事：**改一场，只重渲一场；人写的意见，agent 能直接读。**

## 1. 什么时候用它

| 场景 | 工具 |
| --- | --- |
| 拿到 `timeline.json` / `film.json`，想在 AI CUT 里看到整片结构 | `import_film_manifest` |
| 人看片后写了批注，agent 要读成结构化任务 | `list_review_notes` |
| 改完代码，想知道哪几段脏了 | `render_status` |
| 只重渲一个场景，不重跑 8,220 帧 | `render_range` |
| 一次重渲所有脏段 | `render_manifest` |
| 确认这一版没有把别处弄坏 | `compare_takes` |
| 一次看完 20 场 | `render_contact_sheet` |
| 把审片结果写回清单 | `export_film_manifest` |

## 2. 工具

| 工具 | 关键参数 | 说明 |
| --- | --- | --- |
| `import_film_manifest` | `path`, `mode?`, `trackName?`, `conform?` | 建场景轨/clip/场次与穿越 marker/review notes；`replace` 同步删除过期条目，`merge` 只增改；`conform:true` 把工程 fps/宽高改成 manifest 规格（同一个撤销步） |
| `export_film_manifest` | `path?` | 从工程重建 scenes/review；省略 `path` 只返回 JSON；写回时保留 `music` |
| `add_review_note` | `time`, `text`, `severity?`, `sceneId?`, `bbox?`, `screenshot?` | 返回 `markerId` |
| `list_review_notes` | `from?`, `to?`, `sceneId?`, `severity?`, `resolved?`, `limit?` | 结构化读批注 |
| `update_review_note` | `markerId`, `text?`, `severity?`, `resolved?`, `bbox?` | 改完标 `resolved:true` |
| `render_status` | `ranges[{id?,start,end}]` | 只算脏段，不渲染 |
| `render_range` | `start`, `end`, `outputPath?`, `force?` | 单段渲染 + 内容哈希缓存 |
| `render_manifest` | `scenes[]` 或 `manifestPath`, `force?` | 逐段渲染，命中缓存跳过 |
| `compare_takes` | `a`, `b`, `times?`, `range?`, `threshold?` | SSIM + 并排关键帧 |
| `render_contact_sheet` | `manifestPath?`/`times?`/`frames?`, `perScene?`, `outputPath`, `cols?` | 接触表 PNG + 同名 `.json` 图例 |

## 3. 缓存语义（重要）

- 缓存键 = 窗口内工程 + 素材 `{size, mtimeMs}` + 输出规格（宽高/帧率/fit/锚点）。
- 素材重新生成后 `mtime` 变化 → 自动失效，不需要手动清缓存。
- 命中时返回 `cached: true` 和缓存路径；`force: true` 强制重渲。
- 缓存目录：应用数据目录下 `cache/render/`。
- **同一时间只允许一个 ffmpeg 进程**。`render_manifest` 串行执行；并发调用会直接报错，不要并行发多个 `render_range`。

## 4. 20 秒超时

Rust ↔ webview 的桥接请求固定 20 秒。`render_frame` 是单帧，可以直连；所有多帧/多段任务都走 job：

- `render_range` / `render_manifest` / `compare_takes` / `render_contact_sheet` / `render_storyboard` 都是异步 job；
- 也可以自己 `job_start({kind:"render_range", params:{...}})`，再 `job_status` 轮询。

### 静帧不带音频

`render_frame` / `render_storyboard` 只编译**画面**：单帧输出只 `-map` 视频，不生成
`anullsrc` / `anull`。不要给静帧任务加音频参数；整片导出才会混音。

## 5. 审片闭环（标准顺序）

```
人看片
  → add_review_note {time, sceneId, severity, text}
  → agent: list_review_notes {resolved:false}
  → 改代码（p5 / Three.js / Remotion …）
  → 重新生成该场 take（覆盖同名 MP4）
  → render_status {ranges:[该场]}
  → render_range {start, end}            # 只渲这一场
  → compare_takes {a:旧版, b:新版}       # SSIM + 并排帧
  → update_review_note {markerId, resolved:true}
  → export_film_manifest {path}          # 写回，保留 music
```

**不要**逐帧 `render_frame` 看 137 秒；**不要**为一条批注重渲整片。

## 6. 场景级重渲的推荐写法

```bash
# 1) 哪些脏了
aicut call render_status --json '{
  "ranges": [
    {"id":"s05-song","start":29,"end":35},
    {"id":"s06-cross","start":35,"end":41}
  ]
}'

# 2) 只渲脏段（把 scenes 换成 stale 的那几段）
aicut call render_manifest --json '{
  "scenes": [{"id":"s05-song","start":29,"end":35}],
  "outputDir": "/tmp/takes"
}'

# 3) 对比
aicut call compare_takes --json '{
  "a": "/tmp/takes-old/s05.mp4",
  "b": "/tmp/takes/s05.mp4",
  "times": [29, 31, 33]
}'
```

## 7. 接触表

```bash
aicut call render_contact_sheet --json '{
  "manifestPath": "/path/film.json",
  "perScene": "mid",
  "outputPath": "/tmp/contact-sheet.png",
  "cols": 4
}'
```

- 返回 `cells` 与 `legendPath`；图例 JSON 记录每格对应的时间。
- v1 不在图上烧字（不引入字体）；看片时用图例对齐。
- `perScene`: `start` / `mid` / `end`。

## 8. 成功线

- 6 秒场景（360 帧 @60fps）单场重渲 < 60 秒。
- 缓存命中 < 1 秒。
- 20 段 `render_status` < 5 秒（只 hash + stat，不渲染）。
- 一条 review note 从创建到 `resolved` 全程结构化，不依赖聊天上下文。

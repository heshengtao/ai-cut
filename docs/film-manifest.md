# film.json：影片共享清单

`film.json` 是 AI CUT 与 AI DAW 之间的唯一共享时间轴。AI CUT 负责场景、take 与审片意见；AI DAW 负责配乐与 stems。两边都按秒写入，各自只改自己的区块。

- 版本：`1`
- 时间单位：**秒**
- 路径：`take` / `screenshot` 相对 manifest 所在目录；绝对路径原样使用
- 示例：`docs/film.example.json`

## 结构

```json
{
  "version": 1,
  "name": "137s 草稿",
  "fps": 60,
  "width": 1920,
  "height": 1080,
  "duration": 137,
  "scenes": [
    {
      "id": "s05-song",
      "t0": 29,
      "t1": 35,
      "title": "宋代山水",
      "take": "renders/s05-song.mp4",
      "markers": [31.0, 32.0],
      "review": [
        {
          "id": "r-s05-01",
          "t": 31.2,
          "text": "翅膀穿模",
          "severity": "high",
          "resolved": false,
          "bbox": { "x": 0.3, "y": 0.2, "width": 0.2, "height": 0.3 },
          "screenshot": "shots/s05-31.2.png",
          "tags": ["character"]
        }
      ]
    }
  ],
  "review": [],
  "music": {
    "bpm": 120,
    "key": "A minor",
    "bars": 68,
    "offset": 0,
    "cues": [
      { "scene": "s05-song", "t0": 29, "t1": 35, "instrument": "guqin-like", "stem": "s05-guqin.wav" }
    ]
  }
}
```

## 字段

### 顶层

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | ✅ | 必须为 `1` |
| `scenes` | ✅ | 非空数组，按 `t0` 升序 |
| `name` | | 影片名 |
| `fps` / `width` / `height` | | 交付规格；用于渲染与对齐 |
| `duration` | | 总时长（秒）；场景超出时给 warning |
| `review` | | 不归属某一场的审片意见 |
| `music` | | **AI DAW 所有**；AI CUT 只透传 |

### `scenes[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一、稳定；重导入靠它幂等更新 |
| `t0` / `t1` | ✅ | `0 <= t0 < t1` |
| `title` | | 场次标题；用于 marker 名称与接触表图例 |
| `take` | | 这一场的渲染产物（MP4 / MOV / 图片）；相对 manifest 目录。**帧目录不支持**，请先编码成视频 |
| `markers` | | 穿越/切点时间（秒） |
| `review` | | 这一场的审片意见 |

场景允许重叠（转场）；AI CUT 导入时会硬切到下一场开始，并给 warning。

### `review[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `t` | ✅ | 时间（秒） |
| `text` | ✅ | 可执行的现象 → 期望 → 动作 |
| `id` | | 稳定 id；建议写，便于跨工具追踪 |
| `severity` | | `blocker` / `high` / `medium` / `low` |
| `resolved` | | 是否已解决 |
| `bbox` | | 归一化到画面 `0..1` 的 `{x,y,width,height}` |
| `screenshot` | | 审片截图路径 |
| `tags` | | 自由标签 |

### `music`

由 AI DAW 写入，AI CUT 原样保留。

| 字段 | 说明 |
| --- | --- |
| `bpm` | 速度 |
| `key` | 调性，例如 `A minor` |
| `bars` | 总小节数 |
| `offset` | bar 1 / beat 0 对应的影片时间（秒） |
| `cues[]` | `{scene?, t0, t1, instrument?, stem?, gainDb?}` |

秒 → 拍换算：`beat = (t - offset) * bpm / 60`。

## 写入责任

| 区块 | 写入方 | 读取方 |
| --- | --- | --- |
| `scenes[].id/t0/t1/title/take/markers` | AI CUT | AI CUT、AI DAW |
| `scenes[].review` / 顶层 `review` | AI CUT（人 + agent） | AI CUT、agent |
| `music` | AI DAW | AI CUT（透传）、agent |

AI CUT 写回 `film.json` 时会保留旧文件的 `music` 与未知顶层字段，不会覆盖配乐。

## AI CUT 工具

- `import_film_manifest({path, mode, conform})`：建场景轨/clip/marker/review；`replace` 同步删除过期条目，`merge` 只增改；`conform:true` 把工程 fps/宽高改成 manifest 规格（与导入同一个撤销步）。
- `export_film_manifest({path?})`：从工程重建 scenes/review；省略 `path` 只返回 JSON。
- `add_review_note` / `list_review_notes` / `update_review_note`：结构化审片闭环。
- `render_status` / `render_range` / `render_manifest`：按场景增量渲染。
- `compare_takes` / `render_contact_sheet`：版本对比与接触表。

## 校验规则

- `version` 必须为 `1`，`scenes` 非空。
- `id` 唯一；`t1 > t0 >= 0`。
- 场景按 `t0` 排序；重叠只 warning。
- 相对路径按 manifest 目录解析。
- 非法 `severity` / `bbox` / 空 `text` 会被丢弃并写入 `warnings`，不阻塞其余条目。

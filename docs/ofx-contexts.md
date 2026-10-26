# OpenFX context 兼容性

AI Cut 的宿主（`crates/ofx-host`）接受 OpenFX 1.5.1 的全部 6 种 image-effect
context。不同 context 的挂载位置与渲染语义不同：

| Context | 挂载位置 | 输入 | 实时预览 | 烘焙 / 导出 |
| --- | --- | --- | --- | --- |
| `Filter` | 片段 `effects[]` | `Source` | ✅ 预烘焙常驻 | ✅ 整段 |
| `General` | 片段 `effects[]` | `Source`（额外 clip 复用同一帧） | ✅ 预烘焙常驻 | ✅ 整段 |
| `Generator` | 片段 `effects[]` | 忽略输入 | ✅ 预烘焙常驻 | ✅ 整段 |
| `Transition` | 片段入 / 出边 | `SourceFrom` + `SourceTo` | ⚠️ 暂停逐帧合成；播放硬切 | ✅ 叠加视频 |
| `Paint` | 片段 `effects[]` | `Source` | ✅ 预烘焙常驻（仅参数） | ✅ 整段 |
| `Retimer` | 片段 `effects[]` | `Source` + `SourceTime` | ✅ 预烘焙常驻 | ✅ 逐帧 seek |

## Transition

- `ClipTransition.type` 为 `"ofx"` 时，`effect` 指向一个 transition 插件实例。
- 时间线以切点为中心：区间 `[cut - d/2, cut + d/2)`；如果只有一侧片段，
  区间落在有片段的一侧，长度为 `d`。
- 两侧源按各自的 `in` / `speed` 映射到素材时间；越过 out / in 时读取素材
  handle，素材边界处冻结。
- 宿主用 `Transition` 参数驱动进度（0..1），`SourceFrom` / `SourceTo` 两路
  输入由 `ofx_host_session_render_multi` 提供。
- 导出时烘焙成 ProRes 4444 整帧叠加视频，按轨道层级压住同轨 A/B，但不遮
  上方轨道的字幕 / 图片。
- 暂停预览逐帧合成；播放时暂不叠加（导出结果为准）。

## 预览与预烘焙

- 挂上 / 修改效果后，`effectRender` 队列会立即开始预烘焙，并在检查器和预览标题显示进度。
- 视频片段：烘焙成 H.264 预览文件，播放引擎直接播它，因此播放 / 暂停都带效果。
- 图片片段：烘焙成带效果的 PNG（`ofx_bake_image`），`<img>` 的源替换成该缓存文件；
  图片本身没有时间轴，效果在 clip-local `t=0` 求值，静态滤镜 / 调色 / 绘制常驻显示。
  时间相关效果（例如动态噪声）在图片预览里固定为 t=0 的那一帧，导出仍按帧计算。
- 参数改动时先保留上一版预览（`previousOutput`），新结果就绪后再切换，避免效果闪回原片。
- 导出仍按最终尺寸单独烘焙，不复用预览缓存。

## Paint

- 可以挂载、预览和烘焙，但宿主没有实现交互画笔 / overlay / 自定义 interact
  套件，因此只有参数驱动的输出。需要手绘的插件只能显示其默认/参数结果。

## Retimer

- 必须放在效果链第一位，因为它决定后续效果的源时间。
- 宿主以 `OfxActionInstanceChanged(kOfxChangeTime)` 询问插件，读取强制参数
  `SourceTime`，再按该时间解码源素材。
- 预览先在解码前查询 `SourceTime`；烘焙逐帧 seek 解码，比普通滤镜慢。
- `SourceTime` / `Transition` 是宿主驱动参数，不会出现在参数面板，也不会
  被工程里的旧值覆盖。

## 测试

`ofx-host` CLI 可以直接验证三种新路径：

```sh
# transition: 两路输入 + 进度
ofx-host render plugin.ofx com.example.transition from.ppm params.json out.ppm \
  --context OfxImageEffectContextTransition --from from.ppm --to to.ppm --progress 0.5

# retimer: 查询某个输出时间需要的源时间
ofx-host render plugin.ofx com.example.retimer in.ppm params.json out.ppm \
  --context OfxImageEffectContextRetimer --source-time --time 2 --duration 4
```

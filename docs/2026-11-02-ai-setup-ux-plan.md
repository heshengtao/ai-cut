# AI 引擎 / 组件 / 模型「缺失即引导下载」体验改造计划

> 范围：`D:\ai-cut`（AI Cut）与 `D:\ai-daw`（AI DAW，作为参照与同步改造方）
> 基线：AI Cut `0d364ae` + 未提交的 image-gen / video-gen 改动
> 状态：**P0 / P1 已实施**（见文末「实施记录」），P2 待做。

---

## 一、结论（先看这里）

今天两个项目的"缺依赖"体验都是**三跳之后落空**：

```
点「生成/打开」 → 确认框「需要下载 X GB，现在打开下载管理器吗？」 → 跳下载管理器
                                                              （还停在「已安装」页签）
                                                              → 什么都不下
```

用户要自己再找到那张卡片、再点一次「下载」。中间任何一步（页签不对、卡片被过滤、列表没加载完）
都会变成"点了没反应"。

**目标**：一次确认，全自动下完最后一颗依赖，并在装好后自动回到原页面、自动切到最优后端。

**六条硬性体验要求**（对应本次需求）：

1. 缺**引擎** → 弹模态框；缺**模型** → 弹模态框（只针对当前选中的那一档）。
2. 确认后**真的开始下载**，不是只跳转。
3. **切换后端**（首页 / 设置页 / AI 子页三处）同样走「确认 → 下载 → 自动切 → 重启提示」。
4. 按**设备**推荐最优后端：NVIDIA → CUDA；Apple → Metal + CoreML；AMD/Intel → Vulkan（视频）/ DirectML（ORT）；无独显 → CPU。
5. 首次使用某个 AI 功能时自动引导一次，之后按用户意愿不再打扰。
6. 下载管理器里**看得见** CUDA 12 / CUDA 13 两套本体 + 八个组件，且跳转能定位。

---

## 二、排查：现状与问题

### 2.1 AI 功能首页卡片（AI Cut）

`src/components/workspace/panes/AiPane.vue:2074-2120`

现状：`AI 画图 / 图像编辑` 与 `AI 视频生成` 两张卡只有
`badge「未下载模型」` + `note「需下载 6.24 GB」` + 主按钮 `打开`。

问题：

| # | 问题 | 影响 |
|---|---|---|
| a | 卡片完全不提 **sd.cpp 引擎**（另一笔 875 MB） | 用户进到子页才发现"还要下一个 875 MB" |
| b | 主按钮 `打开` 只切子页，**不触发任何下载** | 首页没有任何"从这里就能装好"的路径 |
| c | 模型下拉选到未下载的档，卡片上没有下载出口 | 选了等于白选 |
| d | badge 只有"就绪 / 未下载"两态 | 缺"引擎就绪但缺模型""缺引擎"的区分 |

### 2.2 AI 子页（画图 / 视频）

`src/components/workspace/panes/ai/AiImagePage.vue`、`AiVideoPage.vue`

| 位置 | 代码 | 问题 |
|---|---|---|
| `AiImagePage.vue:308-312` | `openEngineManager()` → `sdcpp.requestFocus()` + `layout.openTab("models")` | 只跳转 |
| `AiImagePage.vue:314-327` | `downloadModel()` → `confirm()` → `layout.openTab("models")` | 注释写着"交给下载管理器"，但**没有调用 `models.download()`** |
| `AiImagePage.vue:360-374` | 主按钮 `primaryKind === "engine"` → `openEngineManager()` | 按钮写着「下载引擎」，点下去只是换页签 |
| `AiImagePage.vue:280-306` | `pickBackend()` 未安装 → confirm → `openEngineManager(kind)` | 后端切换不下载、不切 |
| `AiVideoPage.vue:187-235`、`:268-282` | 同上 | 同上 |

**对照：项目里已经有正确范式** ——

- `AiPane.vue:119-143` `downloadCutModels()`：确认 → `layout.openTab("models")` → **串行 `models.download()`**。
- `AiPane.vue:935-956` `ensureInstalled()`：确认 → 跳管理器 → 下载 → 返回 `true` 继续跑。

也就是说 `ensureInstalled` 已经存在，只是**没有跨页面复用**，image/video 两个新页面没用上。

### 2.3 后端切换的五个入口，行为不一致

| 入口 | 位置 | 未安装时的实际行为 |
|---|---|---|
| 设置 → AI → ONNX Runtime 后端 | `SettingsView.vue:366-460` | 确认 → 关设置 → 开管理器 → **串行下载 → 自动切 → 重启提示** ✅ |
| 设置 → AI → sd.cpp 后端 | `SettingsView.vue:542-573` | 确认 → 关设置 → 开管理器；**不下载、不切** ❌ |
| AI 首页 → ORT 后端 | `AiPane.vue:1570-1605` | `toast` + 打开设置页；**不跳管理器、不下载** ❌ |
| AI 首页 → sd.cpp 后端 | `AiPane.vue:1711-1736` | 确认 → 开管理器；不下载 ❌ |
| 画图 / 视频页 → sd.cpp 后端 | `AiImagePage.vue:280` / `AiVideoPage.vue:187` | 确认 → 开管理器；不下载 ❌ |

五个入口五种行为，用户无法形成预期。

### 2.4 下载管理器 &「CUDA 13 组件看不到」

**先说结论：组件在数据层是齐的，是 UI 把它藏了。**

证据链：

1. **后端清单是全的**
   - `src-tauri/src/runtime.rs:132-133`：`CUDA13_COMPONENTS = ["cudart13","cublas13","cufft13","cudnn13"]`
   - `runtime.rs:377-475`：四个组件条目齐全（`install_dir: "cuda13/cudart"` 等，体积 2.9 MB / 401 MB / 212 MB / 1.33 GB）
   - `runtime.rs:1244` `runtime_install` + `:1271` `bundle_plan`：下 CUDA 13 本体时**顺带补齐同版本全部组件**

2. **UI 在默认页签里把它们过滤掉了**
   - `ModelsPane.vue:41` `tab = ref("installed")`
   - `ModelsPane.vue:71-75` `visibleParts` 在「已安装」页签只保留 `part.installed` 的项
   - `ModelsPane.vue:78-88` `componentGroups` 再过滤 `items.length === 0` 的组
   - ⇒ **当 CUDA 13 一个组件都没装时，整块「CUDA 13 组件」卡片根本不渲染**，必须手动切到「可下载」

3. **跳转不切页签**
   - `src/stores/runtimes.ts:37-44` `requestFocus(id)` 只是设置 2.6 秒的高亮字符串
   - `ModelsPane.vue` 没有任何消费 `focus` 的逻辑（只有 `:314` 的 `focus` class）
   - 对照 ai-daw `ManagerPane.vue:134-144`：`consumeFocus()` → `tab = "available"` + `kindFilter = "runtime"` ✅

4. **本机实测**（`D:\AI\ai-cut-model\runtime`）

   ```
   ort\cuda   : cublas, cudart, cudnn, cufft   ← CUDA 12 完整
   ort\cuda13 : （目录不存在）
   sdcpp      : （空，没有任何引擎包）
   models     : （空）
   ```

   正好就是截图里的状态：图片/视频都「未下载模型」，且管理器「已安装」页签里看不到任何 CUDA 13 组件。

> 顺带：设置页「运行库」卡片只有一句 hint + 一个「打开下载管理器」按钮（`SettingsView.vue:2133-2148`），
> 用户在这里既不知道装了什么，也不知道缺什么。

### 2.5 设备探测：「优先最优后端」缺的那一环

AI Cut **有**推荐值，但没人用：

- `backend.rs:859-868` `recommended_backend()`：NVIDIA + 驱动 ≥580 → `cuda13`，否则 `cuda12`，再否则 `cpu`
- `backend.rs:1133-1188` 通过 `BackendInfo.recommended` 下发到前端
- `sdcpp.rs:409-425` `auto_device()`、`:506` `SdcppInfo.recommended`

但：

| # | 问题 | 证据 |
|---|---|---|
| a | `auto_device()` **只认已安装的包** → 新机器永远 CPU | `sdcpp.rs:411-414` `has()` 内部是 `installed(app, pack)` |
| b | Windows 上 **AMD 机器也能看到并下载 CUDA 12**（917 MB），装完跑不起来 | `sdcpp.rs:497` `available: backend.platform_ok()`；`:80-88` `Cuda12.platform_ok()` 只判断 OS |
| c | `nvidia_present()` 在 Linux 恒 `false` | `sdcpp.rs:395-400` 第一行 `if !cfg!(target_os = "windows") { return false }` |
| d | 前端从不使用 `recommended` 做引导 | 只在 `AiImagePage.vue:309` 当 `openEngineManager` 的 fallback |
| e | 开箱默认是 CPU | `network.rs:70` `backend_preference: Cpu`、`:71` `sdcpp_backend: Auto` |

AI DAW 在这块**更完整**（可作为 AI Cut 的参照）：

- `src-tauri/src/yue.rs:249-275` `auto_device()`：NVIDIA → CUDA 13（驱动 ≥580）→ CUDA 12 → Vulkan → CPU
- `yue.rs:306-316` `usable(device)`：CUDA 要 N 卡、CUDA 13 要 580+、Metal 要 macOS —— **"装了但跑不了"不算数**
- `src-tauri/src/runtimes.rs:557-573` `recommended_backend()`

### 2.6 下载队列：静默失败

| 文件 | 代码 | 后果 |
|---|---|---|
| `src/stores/models.ts:121-123` | `if (busyId.value !== null) return;` | 已有下载时第二次调用**静默丢弃**：没提示、不排队 |
| `src/stores/runtimes.ts:144-148` | 有 error 文案 | 不排队 |
| `src/stores/sdcpp.ts:120-124` | 有 error 文案 | 不排队 |

"引擎 → 模型"这种链式下载，只要用户自己先点了一个别的下载，后面的就无声消失 —— 表现为"确认过了，但什么都没发生"。

### 2.7 下载器的健壮性差异

- **模型**：支持 `Range` 断点续传、`.part` 原子落地、多源切换（`models.rs:10`、`:2852-2864`）
- **运行时**：无续传（`runtime.rs` 无 `Range` / `.part`）
- **sd.cpp 引擎**：无续传（`sdcpp.rs` 无 `Range` / `.part`）

⇒ 2.1 GB 的 CUDA 或 875 MB 的引擎，断了要从 0 重来。

### 2.8 AI DAW 侧同类问题

| 位置 | 现状 | 问题 |
|---|---|---|
| `components/common/EngineSetupDialog.vue:80-88` `pickDefault()` | 已装且 selected → 已装 → `core`(CPU) → 第一个 | **全新 NVIDIA 机器默认选 CPU**，推荐 CUDA 却要用户自己翻 |
| `panes/ai/AiSingingPage.vue:117-121` `downloadModel()` | `openTab("manager")` + `models.requestFocus()` | 点「去下载」**什么都不下**（`render()` 在 `:137-139` 会调它） |
| `panes/ai/AiSvcPage.vue:123-132` | 同上 | 同上 |
| `panes/ai/AiYuePage.vue:107-121` `needsEngineSetup` | 一份引擎都没有 → 强制弹安装向导 | ✅ 好，但**只有写歌页**，其它 AI 页面没有等价引导 |
| `panes/ManagerPane.vue:134-144` `applyFocus()` | focus → 切页签 + 切筛选 | ✅ 好，但不滚动定位到具体条目 |
| `stores/runtimes.ts:189-257` `installAndWait()` | 发起下载并**等装完** | ✅ 可复用范式 |
| `composables/useModelDownloadPrompt.ts` | 确认 → 跳转 → 下载 | ✅ 可复用范式 |
| `views/SettingsView.vue:434-550` | ORT 后端确认 → 下载 → 切换 | ✅ 但只覆盖 ONNX，没有引擎等价物 |

---

## 三、目标体验（用户剧本）

### 场景 A：全新 Windows + RTX 4060（驱动 560）

1. 打开 AI 首页 →「AI 画图 / 图像编辑」卡片显示 `需要准备` /「引擎 875 MB + 模型 6.24 GB」
2. 点卡片 → 弹「准备 AI 画图」模态框：
   > 推荐 **CUDA 12**（检测到 NVIDIA GeForce RTX 4060）
   > ☐ sd.cpp 引擎（CUDA 12）· 875 MB
   > ☐ 图像模型 · Z-Image Turbo · 6.24 GB
   > 合计 7.09 GB　　[稍后]　[下载并安装]
3. 点「下载并安装」→ 关模态框 → 打开下载管理器（自动切到「可下载 → 运行时」，
   定位到 sd.cpp CUDA 12 卡片，**已经在下载**）
4. 引擎装完 → 自动 `select("sdcpp-cuda12")` → 接着下模型（管理器显示 2/2 项）
5. 全部完成 → **自动回到 AI 画图页** + toast「运行环境已就绪」
6. 主按钮已经是「生成」

### 场景 B：AMD RX 7800（Windows）

- 视频侧推荐 **Vulkan**（28 MB）；CUDA 项灰显「未检测到 NVIDIA 显卡」，**不提供下载**。
- ORT 侧推荐 **DirectML**（随包，0 下载）。

### 场景 C：M3 MacBook

- 推荐 **Metal**（sd.cpp，按需下载）+ **CoreML**（ORT，随包）。
- 列表里没有 CUDA 项（不是灰显，是根本不出现）。

### 场景 D：无独显老本

- 推荐 **CPU**；模态框明说「CPU 也能跑，只是慢」，并给一个粗略的耗时预期。

### 场景 E：设置页切到未装的 CUDA 13

- 模态框列出 `ONNX Runtime（CUDA 13）160 MB + cudart13 3 MB + cublas13 401 MB + cufft13 212 MB + cudnn13 1.33 GB`，合计 2.11 GB
- 确认 → 管理器里一条进度条（本体 + 组件折算在一起）
- 装完 → 自动切到 CUDA 13 → 弹「需要重启才能启用 CUDA 13」[立即重启] [稍后]

---

## 四、设计：一套统一的「依赖准备」机制

### 4.1 依赖模型

```ts
// src/types/setup.ts
export type DepKind = "engine" | "runtime" | "component" | "model";

export interface SetupDep {
  kind: DepKind;
  /** pack id / runtime id / model id */
  id: string;
  label: string;
  /** 还差多少字节（已装 = 0） */
  bytes: number;
  installed: boolean;
  /** 这台机器能不能用（AMD 机器上的 CUDA = false；为 false 时整行不展示） */
  usable: boolean;
  /** 仅组件：属于哪套 CUDA */
  group?: "cuda12" | "cuda13";
  /** 仅模型 */
  files?: number;
}

export interface SetupPlan {
  feature: "image" | "video" | "asr" | "tts" | "upscale" | "interpolate" | "denoise" | "separate" | "aligner";
  deps: SetupDep[];
  totalBytes: number;
  backend: {
    kind: "cuda12" | "cuda13" | "vulkan" | "metal" | "directml" | "coreml" | "cpu";
    label: string;
    /** 「检测到 NVIDIA GeForce RTX 4060」这类依据文案 */
    reason: string;
    recommended: boolean;
  };
  /** 装了 CUDA 本体/组件 → 必须重启才生效 */
  restartAfter: boolean;
}
```

### 4.2 依赖解析规则（`src/core/aiDeps.ts`）

按 **引擎 → 运行时本体 → 运行时组件 → 模型** 的顺序产出（下载顺序即数组顺序）：

| feature | 引擎 / 运行时 | 模型来源 |
|---|---|---|
| `image` / `video` | sd.cpp 推荐 pack（`cuda12` / `vulkan` / `metal` / `cpu`） | `useModelChoice("image-gen" / "video-gen")` 当前档 |
| `asr` / `aligner` / `tts` / `upscale` / `interpolate` / `denoise` / `separate` | ORT 推荐后端（`cuda12` / `cuda13` / `directml` / `coreml` / `cpu`）；CUDA 时含 4 个组件 | 对应 feature 的当前档 |

关键点：**"当前档"取自 `useModelChoice` 记住的选择**，不是"第一个"。用户选了 6.28 GB 的 H3，
模态框就必须说 6.28 GB，而不是默认档的体积。

### 4.3 状态机

```
                 ┌──────────────┐
   进入 AI 页面 →│   planning   │←──────────┐
                 │ (模态框)      │           │
                 └──┬────────┬──┘           │
             稍后   │        │ 下载并安装     │ 用户点按钮
                    ▼        ▼              │
              ┌─────────┐  ┌──────────────┐ │
              │dismissed│  │ downloading  │─┘
              │(记住)    │  │ (管理器)      │
              └─────────┘  └───┬──────┬───┘
                               │      │ 失败
                          成功  ▼      ▼
                        ┌──────────┐ ┌────────┐
                        │ restart? │ │ error  │→ 重试 / 换源
                        └──┬────┬──┘ └────────┘
                     是    │    │ 否
                           ▼    ▼
                     「重启」  「回到来源页 + toast」
```

### 4.4 `AiSetupDialog` 规格

新增 `src/components/ai/AiSetupDialog.vue`，基于新增的 `src/components/common/ModalShell.vue`
（从现有 `ExportModal.vue:152-160` / `CutSettingsDialog.vue:121-127` 的 scrim 写法抽出）。

```
┌────────────────────────────────────────────────────┐
│  准备「AI 画图 / 图像编辑」                     ✕  │
│                                                    │
│  ⚡ 推荐 CUDA 12 · 检测到 NVIDIA GeForce RTX 4060  │
│                                     [更换后端]     │
│  ────────────────────────────────────────────────  │
│  ↓  sd.cpp 引擎组件（CUDA 12 + cuBLAS）    875 MB  │
│     装好后自动切换到这套后端                        │
│  ↓  Z-Image Turbo（图像模型）             6.24 GB  │
│     4 个权重文件                                    │
│  ────────────────────────────────────────────────  │
│  合计需要下载 7.09 GB                              │
│                                                    │
│                        [稍后]  [下载并安装]        │
└────────────────────────────────────────────────────┘
```

规则：

- 宽度 440px，MD3 外观（复用 `--md-*` 变量），`Teleport to="body"` + scrim，Esc / 点遮罩 = 稍后。
- 已装的行显示 `✓ 已安装`（灰色），仍列出，让用户看到"还差什么"。
- `usable === false` 的行**不渲染**（AMD 机器不出现 CUDA）。
- 主按钮文案随合计变化；合计为 0 时直接关闭并执行。
- 打开时焦点落在主按钮；关闭后焦点回到触发元素。
- 「更换后端」展开一个内联的单选列表（`cuda12 / cuda13 / vulkan / metal / cpu`，只列 `usable` 的），
  选中后合计实时重算。
- 下载中的进度**不在对话框里**（按本次需求：跳转管理器），对话框在点确认时就关闭。

### 4.5 跳转、回收与自动继续

```
AiSetupDialog.confirm()
  → layout.openDownloads("models")
  → downloads.requestFocus({ section, id })     // runtime / sdcpp / model
  → ModelsPane 消费 focus：tab="available" → kind → scrollIntoView({block:"center"}) → 3s 高亮
  → useAiSetup.run(plan)                        // 串行下载，每项 await 完成
  → 全部成功：
       restartAfter ? 弹重启框（先 layout 回来源页）
                    : 回来源页 + toast「运行环境已就绪」
  → 中途失败：停在管理器，红条 + 「重试剩余（N 项）」
```

`来源页` 用一个 `setupSession = { feature, returnTo: "image" | "video" | "ai" | "settings" }` 记住，
`AiPane` 的 `aiPage` 在跳转前快照，回来后恢复。

### 4.6 设备 → 后端推荐矩阵

| 设备 | ONNX Runtime（ASR / TTS / 超分 / 补帧 / 降噪） | sd.cpp（画图 / 视频） |
|---|---|---|
| Windows + NVIDIA（驱动 ≥ 580） | **CUDA 13**（本体 160 MB + 组件 1.95 GB） | **CUDA**（上游只有 CUDA 12 构建，917 MB） |
| Windows + NVIDIA（老驱动 / 老卡） | **CUDA 12**（188 MB + 2.68 GB） | CUDA（917 MB） |
| Windows + AMD / Intel | **DirectML**（随包，0 下载） | **Vulkan**（28 MB） |
| macOS Apple Silicon | **CoreML**（随包，0 下载） | **Metal**（按需） |
| macOS Intel | CPU | CPU |
| Linux + NVIDIA | **CUDA 12**（上游无 sd.cpp CUDA 包） | Vulkan / CPU |
| Linux + AMD / Intel | CPU | **Vulkan** |
| 无独显 | **CPU** | **CPU** |

> 注：sd.cpp 官方没有 CUDA 13 构建，所以视频侧永远是「CUDA 12」。UI 上不要写成「CUDA 13」误导用户；
> 这与 ORT 的 CUDA 13 是**两套完全独立**的东西（代码里已经分开：`runtime.rs` vs `sdcpp.rs`）。

### 4.7 不打扰策略

```ts
// localStorage: ai-cut-setup-v1
{ image: { dismissedFor: "cuda12", at: 1730000000000 }, video: null }
```

自动弹的条件（全部满足）：

1. 依赖缺失；
2. 本次会话没为这个 feature 弹过；
3. 用户没 dismiss 过，**或** 推荐后端变了（换了显卡 / 驱动升级）。

用户**主动**点「下载/准备」按钮 → 永远弹，忽略 dismiss 记录。
装好之后清掉该 feature 的记录（下次换机器才会重新提示）。

### 4.8 失败与重试

| 情况 | 表现 |
|---|---|
| 单项下载失败 | 管理器里该卡片红条 + `重试`（复用 `models.error` / `runtimes.error` 通道） |
| 链中断 | 顶部提示「已完成 1/2，{name} 下载失败」+ `重试剩余` |
| 用户取消 | 保留已完成的项；再次点主按钮从断点继续 |
| 源不可达 | 复用 models 的多源探测（`model_probe`）与 runtime 的 cn/intl 双源 |
| 磁盘不足 | 开始前预估（P2）：`free < total × 1.2` 时直接拒绝并说明 |

---

## 五、改动清单

### 5.1 AI Cut · 新增文件

| 文件 | 内容 | 优先级 |
|---|---|---|
| `src/components/common/ModalShell.vue` | scrim + 焦点陷阱 + Esc + 过渡（从 ExportModal 抽出） | P0 |
| `src/components/ai/AiSetupDialog.vue` | 依赖准备模态框 | P0 |
| `src/core/aiDeps.ts` | `resolvePlan(feature)` 依赖解析 | P0 |
| `src/composables/useAiSetup.ts` | `ensure(feature)` / `run(plan)` / `returnTo` / 首次引导 | P0 |
| `src/stores/downloads.ts` | 串行下载队列 + `focus` 总线 + `activeTask` | P0 |
| `src/core/setupMemory.ts` | dismiss 记忆 | P0 |
| `src/types/setup.ts` | 类型 | P0 |

### 5.2 AI Cut · 修改

| 文件 | 改动 | 优先级 |
|---|---|---|
| `src/stores/models.ts` | `download()` 入队（不再静默 return）；新增 `focus`、`downloadMany(ids)` | P0 |
| `src/stores/runtimes.ts` | `install()` 返回 `boolean`；`installMany(ids)`；`focus` 改为 `{ id, tab }` | P0 |
| `src/stores/sdcpp.ts` | 同上；`select()` 返回 `boolean` | P0 |
| `src/components/workspace/panes/ModelsPane.vue` | 消费 `focus`（切 tab / kind / 滚动 / 高亮）；**CUDA 12 / 13 组件卡常显**（未装也渲染，给下载按钮） | P0 |
| `src/components/workspace/panes/ai/AiImagePage.vue` | 引擎卡 → 「运行环境」卡（引擎 + 后端 + 模型三行）；`downloadModel` / `openEngineManager` / `pickBackend` 接入 `useAiSetup` | P0 |
| `src/components/workspace/panes/ai/AiVideoPage.vue` | 同上 | P0 |
| `src/components/workspace/panes/AiPane.vue` | 卡片三态 badge + 主按钮「准备并打开」；`pickBackend` / `pickSdcppBackend` 接入；首次进入自动弹 | P0 |
| `src/components/settings/SettingsView.vue` | sd.cpp 后端接入「确认 → 下载 → 自动切」；运行库卡片内联状态（已装/未装/体积/下载） | P1 |
| `src/i18n/zh.ts`、`src/i18n/en.ts` | 新增 `setup.*` 词条（见第六节） | P0 |

### 5.3 AI Cut · Rust 侧

| 文件 | 改动 | 优先级 |
|---|---|---|
| `src-tauri/src/sdcpp.rs` | `SdcppOption` 增 `usable`（NVIDIA 检测）；`available` 保留"平台支持"语义；新增 `best_device()`（不要求已装） | P1 |
| `src-tauri/src/backend.rs` | `BackendInfo` 增 `device`：`{ vendor: "nvidia" \| "amd" \| "intel" \| "apple" \| "none", name: "RTX 4060", driver: "560.94" }`，供模态框写"检测到 …" | P1 |
| `src-tauri/src/sdcpp.rs` | `nvidia_present()` 补 Linux 分支（`/dev/nvidiactl`），与 `backend.rs:808-812` 对齐 | P2 |
| `src-tauri/src/runtime.rs`、`sdcpp.rs` | 下载加 `Range` 续传 + `.part`（对齐 `models.rs`） | P2 |

> 不建议在首次启动时**静默**改写 `backend_preference`（`network.rs:70` 保持 `Cpu`）。
> 只下发 `recommended`，由用户点「下载并安装」时才写偏好 —— 避免"我什么都没干，它自己改了配置"。

### 5.4 AI DAW · 修改（同步同一套体验）

| 文件 | 改动 | 优先级 |
|---|---|---|
| `src/components/common/EngineSetupDialog.vue` | `pickDefault()` 改为按「最佳可用」选（新增 `recommended` 派生），不再落到 `core`(CPU)；列表加「推荐」徽标；不可用项灰显 | P0 |
| `src/components/workspace/panes/ai/AiSingingPage.vue` | `downloadModel()` 改用 `useModelDownloadPrompt` 的 confirm（**真下载**）；主按钮文案带体积 | P0 |
| `src/components/workspace/panes/ai/AiSvcPage.vue` | 同上 | P0 |
| `src/stores/runtimes.ts` | 新增 `recommended` 派生（来自 `BackendInfo.recommended` / `statuses.device`） | P1 |
| `src/components/workspace/panes/ManagerPane.vue` | `focus` 带 id → `scrollIntoView` + 3s 高亮（现在只切页签） | P1 |
| `src/components/workspace/panes/AiPanel.vue`、`panes/ai/AiYuePage.vue` | 首次进入缺依赖自动弹 setup；记住 dismiss | P1 |
| `src/views/SettingsView.vue` | 运行库卡片内联状态 + 「推荐」徽标 | P2 |

---

## 六、文案（i18n）

新增命名空间 `setup.*`（zh / en 各一份）：

| key | zh | en |
|---|---|---|
| `setup.title` | 准备「{feature}」 | Set up “{feature}” |
| `setup.lead` | 这台机器适合用 **{backend}**（{reason}）。以下内容需要先下载： | This machine works best with **{backend}** ({reason}). These need to be downloaded first: |
| `setup.recommended` | 推荐 | Recommended |
| `setup.reason.nvidia` | 检测到 {name} | Detected {name} |
| `setup.reason.apple` | Apple Silicon，使用 Metal / CoreML | Apple Silicon — Metal / CoreML |
| `setup.reason.vulkan` | 未检测到 NVIDIA 显卡，使用 Vulkan | No NVIDIA GPU — using Vulkan |
| `setup.reason.cpu` | 未检测到可用显卡，使用 CPU（较慢） | No usable GPU — running on CPU (slower) |
| `setup.dep.engine` | sd.cpp 引擎组件（{backend}） | sd.cpp engine ({backend}) |
| `setup.dep.runtime` | ONNX Runtime（{backend}） | ONNX Runtime ({backend}) |
| `setup.dep.component` | {name} | {name} |
| `setup.dep.model` | {name}（{files} 个权重文件） | {name} ({files} files) |
| `setup.installed` | 已安装 | Installed |
| `setup.total` | 合计需要下载 {size} | {size} to download |
| `setup.download` | 下载并安装 | Download & install |
| `setup.later` | 稍后 | Later |
| `setup.switch` | 更换后端 | Change backend |
| `setup.unsupported` | 未检测到 {vendor} 显卡 | No {vendor} GPU detected |
| `setup.progress` | 正在下载 {current}/{total} · {name} | Downloading {current}/{total} · {name} |
| `setup.done` | 运行环境已就绪 | Ready to go |
| `setup.partial` | 已完成 {done}/{total}，{name} 下载失败 | {done}/{total} done — {name} failed |
| `setup.retryRest` | 重试剩余 {count} 项 | Retry remaining ({count}) |
| `setup.restartTitle` | 需要重启才能启用 {backend} | Restart to enable {backend} |
| `setup.restartBody` | 新装的运行时会在下次启动时加载。现在重启吗？ | The new runtime loads on next launch. Restart now? |
| `setup.cancelled` | 已取消下载 | Download cancelled |
| `setup.diskLow` | 磁盘剩余空间不足（需要约 {size}） | Not enough disk space (need about {size}) |

沿用现有词条：`dialog.downloadModelTitle`、`dialog.downloadModelOk`、`settings.ai.restartNow`、
`sdcpp.downloadSize`、`aiVideo.engineMissingTitle`。

---

## 七、验收清单

| # | 场景 | 期望 |
|---|---|---|
| 1 | 全新 Windows + RTX 4060，进 AI 首页点「AI 画图」 | 弹「准备 AI 画图」；推荐 CUDA 12；合计 7.09 GB |
| 2 | 上一步点「下载并安装」 | 对话框关闭 → 管理器切到「可下载 → 运行时」→ sd.cpp CUDA 12 **正在下载** → 自动切后端 → 接着下模型 → 自动回画图页 + toast |
| 3 | AMD RX 7800 Windows | 推荐 Vulkan；列表里没有 CUDA（不是灰显而是不出现）；ORT 侧推荐 DirectML |
| 4 | M3 Mac | 推荐 Metal；没有 CUDA 项；ORT 侧 CoreML 已随包 |
| 5 | 无独显 | 推荐 CPU；文案说明较慢 |
| 6 | 设置页把 ORT 后端切到未装的 CUDA 13 | 弹框列出本体 + 4 个组件（2.11 GB）→ 确认 → 下载 → 自动切 → 重启提示 |
| 7 | AI 首页 / 子页切 sd.cpp 后端到未装项 | 同上（下载 → 自动切），不再只是跳转 |
| 8 | 打开下载管理器「已安装」页签 | CUDA 12 / CUDA 13 两张组件卡**常显**，未装的显示下载按钮 |
| 9 | 从任意入口跳管理器 | 自动切到「可下载」、切到对应筛选、滚动定位、高亮 3 秒 |
| 10 | 下载进行中再点另一个下载 | 进入队列（显示"排队中"），不再静默失败 |
| 11 | 下载中点取消 | 进度条收起，已完成的项保留，可续 |
| 12 | 用户点「稍后」后再次进入同一页面 | 不再自动弹；点主按钮才弹 |
| 13 | AI DAW 写歌页首次进入（无引擎） | 安装向导默认选中**最佳可用**（NVIDIA 机器选 CUDA 而非 CPU） |
| 14 | AI DAW 歌声合成页缺模型点「去下载」 | 确认框 → 管理器 → **真的开始下载** |

---

## 八、实施顺序与工作量

| 步骤 | 内容 | 预估 |
|---|---|---|
| 1 | **P0 · AI Cut 主链路**：`ModalShell` + `AiSetupDialog` + `useAiSetup` + `downloads` store + 三处接入 + `ModelsPane` focus / 组件卡常显 + 队列 | 1.5 天 |
| 2 | **P1 · AI Cut 设备最优**：Rust `usable` / `device` profile + 推荐贯通 + 首次引导 + 重启引导 + 设置页 sd.cpp 链路 | 1 天 |
| 3 | **P0 · AI DAW 对齐**：`EngineSetupDialog` 默认值 + 两个页面真下载 + 首次引导 | 1 天 |
| 4 | **P2 · 打磨**：页内进度「留在本页后台下载」、失败重试、续传、磁盘检查、无障碍与焦点回归 | 1 天 |

检查命令（遵循 `AGENTS.md`）：

```powershell
pnpm test          # 前端单测
pnpm build         # 类型检查 + 构建
cd src-tauri; cargo test --lib
```

---

## 九、风险与注意事项

1. **首次装 CUDA 必须重启**（AI Cut 在启动时 `init_runtime` 加载 ORT；`backend.rs:265-270`
   `loaded=None` 时也判 `restart_required=true`）。引导流程必须显式给出重启步骤，
   否则用户装完之后仍然在跑 CPU，只会觉得"下载了没用"。
   > 长期优化：改成懒加载（对齐 ai-daw），首次装完无需重启 —— 属于 P2 的架构改动，本次不做。
2. **体积大（6~7 GB）**：取消、续传、源切换、磁盘检查都是必需品，不是锦上添花。
3. **不要静默改用户偏好**：只在用户点「下载并安装」后才写 `backend_preference` / `sdcpp_backend`。
4. **三个"后端"别混**：
   - ORT 后端（`backend.rs`，决定 ASR/TTS/超分/降噪跑哪儿）
   - sd.cpp 引擎后端（`sdcpp.rs`，决定画图/视频跑哪儿）
   - 模型档（`models.rs`，权重）
   模态框里要说清"这是哪一层的依赖"，否则用户会以为下了 CUDA 12 就能画图。
5. **mock / 旧版本降级**：`BackendInfo` 新增字段要在 `backendFallback()`（`AiPane.vue`）里补齐，
   避免预览环境白屏。
6. **测试覆盖**：`aiDeps.ts` 的解析规则要单测（每个 feature × 每种设备），
   以及 `setupMemory` 的"不再打扰"逻辑。

---

## 十、实施记录（本次已落地）

### 10.1 AI Cut

| 模块 | 文件 | 做了什么 |
|---|---|---|
| 下载队列 + 聚焦总线 | `src/stores/downloads.ts`（新） | 串行下载（引擎 → 模型）、失败定位、`requestFocus(section, id)` |
| 依赖解析 | `src/core/aiDeps.ts`（新） | 引擎 / 运行时 / 组件 / 模型四类依赖，体积按「实际要下的量」算（CUDA 本体含组件、不重复计） |
| 引导记忆 | `src/core/setupMemory.ts`（新） | 按「功能 + 推荐后端」记住，换显卡会重新提示 |
| 设备画像 | `src/stores/device.ts`（新） | 缓存 `BackendInfo`（显卡厂商 / 推荐后端） |
| 统一流程 | `src/composables/useAiSetup.ts`（新） | `ensure()` / `maybePrompt()` / `confirm()` / `retry()` / `choose()`；装完自动切后端、自动回原页面、CUDA 提示重启 |
| 模态框 | `src/components/common/ModalShell.vue`、`src/components/ai/AiSetupDialog.vue`（新） | 依赖清单 + 体积合计 + 推荐后端 + 更换后端；首次引导不可关闭 |
| 首页卡片 | `AiPane.vue` | 三态 badge（缺引擎 / 缺模型 / 就绪）、「准备」按钮、点击即弹向导并在装完后自动进入子页 |
| 子页 | `AiImagePage.vue` / `AiVideoPage.vue` | 「下载引擎 / 下载模型」改为弹向导 → 跳管理器 → **真的开始下载**；切后端同一条链路 |
| 管理器 | `ModelsPane.vue` | 消费 `focus`：切「可下载」页签 + 切分类 + 滚动定位 + 高亮 3 秒；CUDA 12/13 组件卡**两个页签都常显** |
| 设置页 | `SettingsView.vue` | sd.cpp 后端「确认 → 下载 → 自动切 → 回设置页」；ORT 后端改走同一条下载队列 |
| 后端 | `backend.rs` | `DeviceProfile`（nvidia / amd / intel / apple / none + 显卡名 + 驱动）；AMD/Intel 推荐 DirectML；macOS 推荐 CoreML |
| 后端 | `sdcpp.rs` | `usable`（本机能不能跑）与 `recommended`（最优，不看已装）分离；`best_device()`；Windows 上 AMD 机器不再推荐 CUDA |
| 文案 | `i18n/zh.ts`、`en.ts` | 新增 `setup.*` / `ai.prepare` / `ai.setupNote` |

### 10.2 AI DAW

| 文件 | 做了什么 |
|---|---|
| `src-tauri/src/yue.rs` | 新增 `best_device()`（不看已装）；`YueStatus` 增 `recommended` / `usable`；`auto_device()` 先试最优 |
| `src-tauri/src/runtimes.rs` | `RuntimeStatus` 透传 `recommended` / `usable` |
| `src/components/common/EngineSetupDialog.vue` | 默认选中「最优且可用」的那一份（不再落到 CPU）；「推荐」徽标；不可用项灰显并说明原因 |
| `panes/ai/AiSingingPage.vue`、`AiSvcPage.vue` | 「去下载」改为确认框 → 跳管理器 → **真的开始下载**（复用 `useModelDownloadPrompt`） |
| `api/types.ts`、`api/mock.ts` | 同步新字段 |

### 10.3 验证

- `ai-cut`：`vue-tsc` 通过；`vitest` 61 文件 / 455 用例通过（含新增 `aiSetup.test.ts` 8 条）；`vite build` 通过；
  `cargo check --lib` + `cargo test --lib` 209 通过（新增 `best_device_is_always_usable`、`usable_device_matches_platform_rules`）。
- `ai-daw`：`vue-tsc` 通过；`vite build` 通过。

### 10.4 P2 已补齐

| # | 项 | 做法 |
|---|---|---|
| 1 | 页内进度 + 「留在本页后台下载」 | `AiSetupDialog` 增加「在后台下载」次按钮；新增 `components/ai/DownloadStrip.vue` 全局进度条（AI 首页 + 两个子页顶部），可取消；`useDownloadsStore.progress` 统一三项的百分比 |
| 2 | 设置页运行库内联状态 | 「运行库」卡片逐行列出 CUDA 12 / 13：体积、已装 / 未装、「使用中」徽标、下载（带进度、可取消）/ 定位；装完自动切过去 |
| 3 | 运行时 / 引擎断点续传 | `runtime.rs` `fetch_archive` 与 `sdcpp.rs` `download` 改成 `<file>.part` + `Range`：断线 / 取消都保留断点，只有 416 与 sha256 不符才丢弃；运行时还会按源偏好逐个重试 |
| 4 | 下载前磁盘预检 | `paths::disk_free_bytes`（Windows 走 `Get-PSDrive`、其它平台 `df -k`，都失败则返回 `null` 不拦）；`useSetupSession.run` 按 `总大小 × 1.2` 判断，不足直接提示 |
| 5 | AI DAW 聚焦滚动定位 | `models.requestFocus(id)` / `runtimes.requestFocus(id)` 带 id；`ManagerPane` 切页签后 `scrollIntoView` + 3 秒高亮；各跳转点已传具体 id |
| 6 | ORT 懒加载 | `init_runtime` 只登记 AppHandle，dylib 推迟到第一次建会话（`ensure_runtime_loaded`，双重检查 + 互斥）；`restart_required` 在本进程没加载过运行时的情况下直接返回 false —— **首次装 CUDA 不再要求重启** |

验证：`cargo test --lib` 209 通过；`vue-tsc` / `vitest` 455 / 两个 `vite build` 均通过。

### 10.5 仍然存在的边界

1. 磁盘预检是**尽力而为**：`#![forbid(unsafe_code)]` 让直接调 `GetDiskFreeSpaceExW` 不可能，
   Windows 上走 PowerShell（约 200–400 ms），被策略禁用时静默跳过检查。
2. 断点续传依赖服务端支持 `Range`；不支持时自动退回「从头下」。
3. 懒加载之后，「已经加载过 CPU 基线再装 CUDA」仍然需要重启（进程里那份 dylib 换不掉），
   这是真实约束，提示文案保留。

### 10.6 修订（2026-11-04）：下载队列改成「按类型并行」

后端本来就有三个独立 downloader——`models.rs` / `runtime.rs` / `sdcpp.rs` 各一个
`running` 标志，彼此不阻塞（ai-daw 的 models / runtimes / yue 也是同一形态）。
§10.1 里「串行下载（引擎 → 模型）」把三条独立链路并成了一条；更麻烦的是：只要
别的入口正在下同类内容，`downloads.run()` 会**静默 `return false`**，界面表现为
「确认过了，但什么都没发生」。

| 项 | 以前 | 现在 |
|---|---|---|
| 调度 | 全局一条队列，同一时刻只跑一项 | 一条车道一个类型：`runtime` / `sdcpp` / `model` 各最多一项，**最多 3 项同时跑** |
| 同类冲突 | 直接 `return false`（静默） | 排在正在跑的那一项后面（等对应 store 的 `busyId` 归零） |
| 失败 | 整条队列停下，`failed` 记为全部任务 | 只停失败的车道，其余照跑；`failedTasks` = 失败 + 被跳过的项 |
| 取消 | 只取消 `current` | `cancel(section)` 取消一条车道；不传参取消所有车道（排队的一并丢弃） |
| 下载条 | 一条（`progress`） | 每车道一行（`active`），各自带取消按钮；`progress` 留给页内单条进度 |

改动：`src/stores/downloads.ts`（车道化）、`src/components/ai/DownloadStrip.vue`（多行）、
`src/composables/useAiSetup.ts`（重试只带 `failedTasks`）、
`src/stores/__tests__/downloads.test.ts`（新增 6 条：跨类型并行、同类型串行、排队、失败隔离、单车取消、取消不悬挂）。


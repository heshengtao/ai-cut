# 字体库（Font Library）设计

日期：2026-11-09
状态：已确认，待实现

## 目标

在 Inspector 的字体下拉最前面加一个「字体库…」入口，打开模态框后可以：

- 拉取 Fontsource 注册表，搜索 / 筛选 / 预览并安装字体；
- 导入本地字体文件（.ttf / .otf / .woff2 / .woff）；
- 查看、应用、更新、移除已安装字体；
- 安装后的字体直接出现在文字样式下拉里，预览与导出共用同一份字体文件。

字体是全局资源，不是工程资源：工程只保存 `fontFamily` id，字体文件放在数据目录，
随数据目录迁移。

## 存储

```
<数据目录>/fonts/
  registry.json                 # Fontsource 列表缓存 { fetchedAt, fonts: [...] }
  fs-noto-sans-sc/
    manifest.json
    files/119-400-normal.woff2
  local-source-han-serif-3f9a2c/
    manifest.json
    files/SourceHanSerif.ttf
  .tmp-<id>/                    # 安装中；成功后 rename 成正式目录
```

`manifest.json`：

```json
{
  "id": "fs-noto-sans-sc",
  "family": "Noto Sans SC",
  "source": "fontsource",
  "sourceId": "noto-sans-sc",
  "version": "5.3.1",
  "license": "OFL-1.1",
  "category": "sans-serif",
  "subsets": ["chinese-simplified", "latin"],
  "weights": [400, 700],
  "styles": ["normal"],
  "bytes": 4760000,
  "installedAt": 1762680000,
  "faces": [
    {
      "file": "files/119-400-normal.woff2",
      "weight": 400,
      "style": "normal",
      "subset": "chinese-simplified",
      "unicodeRange": "U+20-22,..."
    }
  ]
}
```

id 规则：Fontsource → `fs-<sourceId>`；本地 → `local-<slug(family)>-<hash6>`。
目录名与 id 相同，后端校验只允许 `[a-z0-9-]`，防止路径穿越。

## 后端（`src-tauri/src/fonts.rs`）

| 命令 | 说明 |
| --- | --- |
| `font_registry(force)` | 读缓存（7 天）；`force` 刷新。失败时返回旧缓存 + `stale/error` |
| `font_list()` | 扫描目录，返回字体、体积、目录、faces |
| `font_install(id, weights)` | 拉详情、下载分片、原子落盘、写 manifest |
| `font_cancel(id)` | 取消进行中的安装并清理临时目录 |
| `font_remove(id)` | 删除字体目录 |
| `font_reveal(id)` | 在系统文件管理器中定位 |
| `font_probe(path)` | 读 family / 字重 / 样式（ttf-parser；解析失败返回 null 让用户手填） |
| `font_import(path, family?, weight?, style?)` | 复制进数据目录；同 family 合并字重 |

安装流水线：

1. 取 `https://api.fontsource.org/v1/fonts/<id>` 详情（含 variants / unicodeRange）。
2. 每个字重、每个 style：
   - 存在数字分片 → 安装全部分片（CJK 完整字形，ASCII 也在分片内）；
   - 否则安装**全部命名字集**（latin / cyrillic / arabic / devanagari…），任何语言的
     字形都能用；主语言（`defSubset`，CJK 优先）排在最前。
3. 并发 4 路下载到 `.tmp-<id>/files/`，URL 失败时把 `cdn.jsdelivr.net` 换成
   `fastly.jsdelivr.net` 重试 2 次。
4. 写 manifest，删除旧目录后 rename 临时目录。
5. 事件 `font-progress`：`{ id, phase, filesDone, filesTotal, bytes, message }`。

同一时刻只允许一个安装任务（与模型下载一致）；启动后首次 `font_list` 清理遗留
`.tmp-*`。HTTP 客户端复用 `NetworkRuntime`（尊重代理设置）。

## 前端

| 文件 | 职责 |
| --- | --- |
| `src/core/fontsApi.ts` | invoke 包装、类型、进度订阅 |
| `src/core/installedFonts.ts` | 模块级状态、CSS 注入、字体栈解析、导出前预载 |
| `src/core/fontLanguages.ts` | subset → 语言映射、数据驱动的语言下拉、字体语言标签 |
| `src/components/common/FontLibraryDialog.vue` | 字体库 / 已安装两页、预览、安装、导入、管理 |
| `InspectorPane.vue` | 下拉操作项、缺失字体提示、打开弹窗、应用字体 |
| `core/export/layers.ts` | `prepareLayers` 前 `await ensureProjectFontsLoaded` |
| `App.vue` | 启动时 `ensureInstalledFontsLoaded()` |

CSS 注入（`<style id="aicut-installed-fonts">`）：

```css
@font-face {
  font-family: "Noto Sans SC";
  src: url("asset://…/119-400-normal.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: U+20-22, …;
}
```

- `fontStackOf(id)`：内置表 → 已安装表 → 默认苹方。
- 导出前按片段文本调用 `document.fonts.load('600 48px "Family"', text)`，
  让 CJK 分片按实际字符加载，再走同步 Canvas 渲染。
- 安装 / 移除后重新拉 `font_list` 并重注入样式。

## UI

- 入口：字体下拉第一条 `{ action: true }`，文案「字体库…」；已安装字体单独分组。
- 弹窗约 860×620：左列表（搜索、语言下拉 + 类别 chips、首屏 60 条 + 加载更多），
  右详情（样本文本、字重勾选、子集说明、许可、安装按钮 / 进度）。
- 语言下拉不写死中文：`src/core/fontLanguages.ts` 把 Fontsource 的 `subsets` 映射成语言项，
  可选语言由注册表实际数据决定（字体数 ≥ 3）；数据里新出现的 subset 会自动补一条，无需改
  代码。默认把“界面语言对应的字体”排在前面（中文界面 → 中文优先，英文界面 → 拉丁优先）。
- 预览：选中时才加载该字体主语言的单文件子集（不只中文），独立 family 名，最多缓存 8 个；
  样本文本随主语言切换（拉丁 / 中文 / 日文 / 阿拉伯文…），也可手动编辑；失败只影响预览。
- 安装成功后 toast；勾选「安装后应用到当前文字片段」则立即写回并刷新预览。
- 已安装页：应用、更新（Fontsource 版本不同）、在文件夹中显示、移除（二次确认）。
- 缺失字体：下拉显示「缺失：id」，Inspector 给出「去字体库」入口。
- 本地导入：文件选择 → probe → 解析失败让用户手填 family → 复制并高亮。

## 错误处理

- 注册表失败：旧缓存 + 顶部提示，可手动刷新。
- 下载失败 / 取消：只清理临时目录，正式目录不受影响。
- 同名 family：Fontsource 重装覆盖同 id；本地导入按 family 合并字重。
- 删除仍被工程引用的字体：允许，回退默认字体并靠“缺失”提示找回。
- 极端情况下 asset 协议加载字体失败：先用 `document.fonts.load` 探测，失败再考虑
  Blob URL 方案（实现时验证，不预先复杂化）。

## 测试

- Rust：分片 / 命名字集选择、manifest 读写、缓存过期、镜像回退、临时目录清理、
  本地导入合并。
- 前端：`@font-face` 生成与转义、`fontStackOf` 回退、下拉分组与操作项、缺失字体
  判定、体积估算。
- 全量：`pnpm test`、`pnpm build`、`cargo test --lib`；手工验证安装 → 应用 →
  预览 → 导出 → 移除回退。

## 不做

自动更新、按工程隔离字体、字体子集裁剪、商用字体授权校验。

/**
 * Markdown → 消毒后的 HTML（对话 / 画布文本节点共用）。
 *
 * `marked` 负责解析，`DOMPurify` 负责消毒（模型输出属于不可信输入，一律先消毒再 `v-html`）。
 *
 * 结果按源文本缓存：流式刷新会反复解析同一段越来越长的文本，没有缓存很容易把界面拖卡。
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

/** 缓存上限：流式文本每个刷新窗口都会产生一个新版本，必须封顶。 */
const CACHE_LIMIT = 64;
const cache = new Map<string, string>();

/** 把一小段 Markdown 渲染成可安全 `v-html` 的 HTML。 */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, html);
  return html;
}

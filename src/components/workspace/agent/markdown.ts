/**
 * 助手回复的 Markdown → 消毒后的 HTML。
 *
 * `marked` 负责解析，`DOMPurify` 负责消毒（对话内容来自外部模型，一律当作不可信输入）。
 *
 * 结果按源文本缓存：一轮对话定稿后它的 markdown 就不会再变，但每次流式刷新都会让
 * 整棵会话树重渲染一遍。没有缓存的话，几万字的思考会被反复解析——这是「越聊越卡」的
 * 主要来源之一。缓存只在渲染路径上做纯记忆化，不影响正确性。
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

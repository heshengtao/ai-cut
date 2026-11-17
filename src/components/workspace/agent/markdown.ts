/**
 * 助手回复的 Markdown → 消毒后的 HTML。
 *
 * 具体实现在 `@/utils/markdown`（画布的文本节点也用它，避免两套解析器）。
 */
export { renderMarkdown } from "@/utils/markdown";

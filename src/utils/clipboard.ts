/** 复制文本到剪贴板；失败时返回 false，由调用方决定怎么提示。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
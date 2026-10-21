/** 剪辑智能体面板内部的展示类型。 */

export interface ToolCard {
  id: string;
  name: string;
  args: unknown;
  /** `null` = 还在跑。 */
  ok: boolean | null;
  output: string;
}
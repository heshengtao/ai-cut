/**
 * 内置的值节点控件。
 *
 * 和插件控件走同一张注册表（`core/plugins/controls`），所以「值节点」不需要在
 * 画布组件里开特例分支：节点定义里写 `control: "core.value"` 就够了。
 */
import { registerControl } from "@/core/plugins/controls";
import ValueControl from "@/components/board/ValueControl.vue";
import ValueKindControl from "@/components/board/ValueKindControl.vue";

let registered = false;

/** 幂等：重复调用（热重载 / 多入口）不会重复注册。 */
export function registerValueControls(): void {
  if (registered) return;
  registered = true;
  registerControl("core", { id: "core.valueKind", component: ValueKindControl });
  registerControl("core", { id: "core.value", component: ValueControl });
}

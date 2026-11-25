import type { Directive, DirectiveBinding } from "vue";

export interface RippleOptions {
  disabled?: boolean;
  centered?: boolean;
}

export interface RippleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RippleGeometry {
  size: number;
  left: number;
  top: number;
}

export interface RippleGuardInput {
  disabled: boolean;
  ariaDisabled: boolean;
  noRipple: boolean;
  button: number;
  reducedMotion: boolean;
}

const RIPPLE_DURATION_MS = 540;
const AUTO_RIPPLE_SELECTOR = [
  ".btn-filled",
  ".btn-tonal",
  ".btn-outlined",
  ".btn-text",
  ".icon-btn",
  "[data-ripple]",
].join(", ");

/**
 * 计算涟漪圆的直径和左上角偏移：确保从点击点（或元素中心）出发能够覆盖到最远角落。
 */
export function computeRippleGeometry(
  rect: RippleRect,
  clientX: number,
  clientY: number,
  centered = false,
): RippleGeometry {
  const localX = centered ? rect.width / 2 : clientX - rect.left;
  const localY = centered ? rect.height / 2 : clientY - rect.top;
  const distX = Math.max(Math.abs(localX), Math.abs(rect.width - localX));
  const distY = Math.max(Math.abs(localY), Math.abs(rect.height - localY));
  const radius = Math.hypot(distX, distY);
  const size = Math.max(radius * 2, 16);
  return {
    size,
    left: localX - size / 2,
    top: localY - size / 2,
  };
}

/**
 * 判断本次指针事件是否应跳过涟漪。
 */
export function shouldSkipRipple(input: RippleGuardInput): boolean {
  if (input.reducedMotion) return true;
  if (input.disabled || input.ariaDisabled || input.noRipple) return true;
  if (input.button !== 0) return true;
  return false;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function spawnRipple(host: HTMLElement, event: PointerEvent, options: RippleOptions = {}): void {
  const isDisabled =
    options.disabled === true ||
    ("disabled" in host && Boolean((host as HTMLButtonElement).disabled));
  const ariaDisabled = host.getAttribute("aria-disabled") === "true";
  const noRipple = host.hasAttribute("data-no-ripple");

  if (
    shouldSkipRipple({
      disabled: isDisabled,
      ariaDisabled,
      noRipple,
      button: event.button,
      reducedMotion: prefersReducedMotion(),
    })
  ) {
    return;
  }

  const rect = host.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const centered =
    options.centered === true || host.getAttribute("data-ripple-center") !== null;
  const geom = computeRippleGeometry(rect, event.clientX, event.clientY, centered);

  // 确保宿主有裁剪上下文，避免波纹溢出圆角边界。
  if (!host.classList.contains("md-ripple-host")) {
    host.classList.add("md-ripple-host");
  }

  const wave = document.createElement("span");
  wave.className = "md-ripple-wave";
  wave.setAttribute("aria-hidden", "true");
  wave.style.width = `${geom.size}px`;
  wave.style.height = `${geom.size}px`;
  wave.style.left = `${geom.left}px`;
  wave.style.top = `${geom.top}px`;

  host.appendChild(wave);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    wave.remove();
  };
  wave.addEventListener("animationend", cleanup, { once: true });
  window.setTimeout(cleanup, RIPPLE_DURATION_MS + 80);
}

type RippleBindingValue = boolean | RippleOptions | undefined;

interface RippleElement extends HTMLElement {
  __mdRippleHandler?: (e: PointerEvent) => void;
  __mdRippleOptions?: RippleOptions;
}

function normalizeOptions(value: RippleBindingValue): RippleOptions {
  if (value === false) return { disabled: true };
  if (typeof value === "object" && value !== null) return value;
  return {};
}

/**
 * Vue 指令 `v-ripple`：支持 `v-ripple`、`v-ripple="false"`、`v-ripple="{ centered: true }"`。
 */
export const vRipple: Directive<RippleElement, RippleBindingValue> = {
  mounted(el, binding: DirectiveBinding<RippleBindingValue>) {
    el.__mdRippleOptions = normalizeOptions(binding.value);
    el.dataset.rippleBound = "1";
    el.classList.add("md-ripple-host");
    const handler = (event: PointerEvent) => {
      spawnRipple(el, event, el.__mdRippleOptions);
    };
    el.__mdRippleHandler = handler;
    el.addEventListener("pointerdown", handler);
  },
  updated(el, binding: DirectiveBinding<RippleBindingValue>) {
    el.__mdRippleOptions = normalizeOptions(binding.value);
  },
  unmounted(el) {
    if (el.__mdRippleHandler) {
      el.removeEventListener("pointerdown", el.__mdRippleHandler);
      delete el.__mdRippleHandler;
    }
    delete el.__mdRippleOptions;
    delete el.dataset.rippleBound;
  },
};

let globalInstalled = false;

/**
 * 全局委托涟漪：自动覆盖全站既有 `.btn-filled` / `.btn-tonal` / `.btn-outlined` /
 * `.btn-text` / `.icon-btn` 与 `[data-ripple]` 元素，无需逐个模板手写指令。
 */
export function installGlobalRipple(): void {
  if (globalInstalled || typeof document === "undefined") return;
  globalInstalled = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const host = target.closest<HTMLElement>(AUTO_RIPPLE_SELECTOR);
      if (!host) return;
      // 已经由 v-ripple 指令绑定的元素不重复触发。
      if (host.dataset.rippleBound === "1") return;
      const centered = host.classList.contains("icon-btn");
      spawnRipple(host, event, { centered });
    },
    { passive: true },
  );
}

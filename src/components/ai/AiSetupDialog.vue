<script setup lang="ts">
/**
 * **「准备 AI 功能」向导**：把还缺的引擎 / 运行时 / 组件 / 权重一次列清楚，
 * 确认后跳到下载管理器并**真的开始下载**。
 *
 * 为什么不直接弹一句「需要下载 6.24 GB，现在打开下载管理器吗？」：
 * - 用户看不到到底缺几样、为什么推荐这个后端；
 * - 跳过去之后还得自己找卡片、再点一次下载（以前就断在这一步）；
 * - 下载管理器默认停在「已安装」，未装的条目根本不在视野里。
 *
 * 这里只负责「说清楚 + 要一个确认」，真正下载由 `useAiSetup` 的会话负责。
 */
import { computed, ref, watch } from "vue";
import ModalShell from "@/components/common/ModalShell.vue";
import { useI18n } from "@/i18n";
import { humanSize } from "@/utils/size";
import type { SetupPlan } from "@/types/setup";

const props = withDefaults(
  defineProps<{
    open: boolean;
    plan: SetupPlan | null;
    /** 首次引导不可随便关掉；用户主动点的入口传 `true`。 */
    dismissible?: boolean;
  }>(),
  { dismissible: true },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "confirm"): void;
  (e: "background"): void;
  (e: "cancel"): void;
  (e: "choose", kind: string): void;
}>();

const i18n = useI18n();
/** 「更换后端」展开的候选列表。 */
const switching = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) switching.value = false;
  },
);

const rows = computed(() =>
  (props.plan?.deps ?? []).map((dep) => ({
    id: dep.id,
    kind: dep.kind,
    label: dep.label,
    size: humanSize(dep.bytes),
    installed: dep.installed,
    hint:
      dep.kind === "runtime" && dep.hint
        ? i18n.t("setup.dep.bundle", { count: Number(dep.hint) })
        : dep.kind === "model" && dep.files
          ? i18n.t("setup.dep.files", { count: dep.files })
          : "",
  })),
);

const total = computed(() => humanSize(props.plan?.totalBytes ?? 0));
const confirmLabel = computed(() =>
  i18n.t("setup.download", { size: props.plan ? total.value : "" }),
);

function choose(kind: string): void {
  switching.value = false;
  emit("choose", kind);
}
</script>

<template>
  <ModalShell
    :open="open"
    :title="plan?.title ?? ''"
    :dismissible="dismissible"
    width="460px"
    @update:open="emit('update:open', $event)"
  >
    <p v-if="plan" class="lead">{{ plan.lead }}</p>

    <!-- 推荐后端 + 换一个 -->
    <div v-if="plan?.backend" class="backend">
      <span class="chip">
        <span class="chip-label">{{ plan.backend.label }}</span>
        <span v-if="plan.backend.recommended" class="chip-badge">
          {{ i18n.t("setup.recommended") }}
        </span>
      </span>
      <button
        v-if="plan.backend.choices.length > 1"
        class="link"
        type="button"
        @click="switching = !switching"
      >
        {{ switching ? i18n.t("common.cancel") : i18n.t("setup.switch") }}
      </button>
    </div>

    <ul v-if="switching && plan?.backend" class="choices" role="radiogroup">
      <li v-for="choice in plan.backend.choices" :key="choice.kind">
        <button
          class="choice"
          :class="{ on: choice.kind === plan.backend.kind }"
          type="button"
          role="radio"
          :aria-checked="choice.kind === plan.backend.kind"
          @click="choose(choice.kind)"
        >
          <span class="radio" aria-hidden="true" />
          <span class="choice-label">{{ choice.label }}</span>
        </button>
      </li>
    </ul>

    <ul class="deps">
      <li v-for="row in rows" :key="row.id" class="dep">
        <span class="mark" :class="{ ready: row.installed }" aria-hidden="true">
          {{ row.installed ? "✓" : "↓" }}
        </span>
        <span class="dep-main">
          <span class="dep-label">{{ row.label }}</span>
          <span v-if="row.hint" class="dep-hint">{{ row.hint }}</span>
        </span>
        <span class="dep-size" :class="{ ready: row.installed }">
          {{ row.installed ? i18n.t("setup.installed") : row.size }}
        </span>
      </li>
    </ul>

    <p class="total">{{ i18n.t("setup.total", { size: total }) }}</p>

    <template #foot>
      <button class="btn text" type="button" @click="emit('cancel')">
        {{ dismissible ? i18n.t("setup.later") : i18n.t("setup.back") }}
      </button>
      <span class="spacer" />
      <button class="btn text" type="button" @click="emit('background')">
        {{ i18n.t("setup.background") }}
      </button>
      <button class="btn filled" type="button" data-autofocus @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.lead {
  margin: 0;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12.5px;
  line-height: 1.55;
}
.backend {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.12);
  color: rgb(var(--md-primary));
  font-size: 11.5px;
  font-weight: 600;
}
.chip-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 9.5px;
  font-weight: 500;
}
.link {
  border: 0;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 11px;
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
.choices {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 8px;
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-highest));
  list-style: none;
}
.choice {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.choice:hover {
  background-color: rgb(var(--md-on-surface) / 0.06);
}
.radio {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border: 1.5px solid rgb(var(--md-outline));
  border-radius: 999px;
}
.choice.on .radio {
  border-color: rgb(var(--md-primary));
  background-color: rgb(var(--md-primary));
  box-shadow: inset 0 0 0 3px rgb(var(--md-surface-container-highest));
}
.deps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dep {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgb(var(--md-outline-variant) / 0.4);
}
.dep:last-child {
  border-bottom: 0;
}
.mark {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
  font-size: 10px;
  font-weight: 700;
}
.mark.ready {
  background-color: rgb(var(--md-primary) / 0.08);
  color: rgb(var(--md-on-surface-variant));
}
.dep-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dep-label {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dep-hint {
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
}
.dep-size {
  flex: 0 0 auto;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.dep-size.ready {
  opacity: 0.7;
}
.total {
  margin: 4px 0 0;
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  font-weight: 600;
}
.progress {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.progress-fill {
  height: 100%;
  border-radius: inherit;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}
.progress-fill.indeterminate {
  width: 35%;
  animation: setup-slide 1.2s ease-in-out infinite;
}
@keyframes setup-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.step {
  margin: 0;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1;
}
.btn {
  min-height: 38px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn.text {
  background: transparent;
  color: rgb(var(--md-primary));
}
.btn.text:hover {
  background-color: rgb(var(--md-primary) / 0.08);
}
.btn.filled {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.btn.filled:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>

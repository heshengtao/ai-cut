<script setup lang="ts">
/**
 * 字体库：Fontsource 注册表浏览 / 安装 + 已安装字体管理 + 本地导入。
 *
 * 弹窗只负责选择和触发；下载、落盘、manifest 都在后端（`fonts.rs`）。安装完成后通过
 * `reloadInstalledFonts()` 重注入 `@font-face`，字体立即出现在 Inspector 的下拉里。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ArrowPathIcon, FolderOpenIcon, PlusIcon, TrashIcon } from "@heroicons/vue/24/outline";
import ModalShell from "./ModalShell.vue";
import { useI18n } from "@/i18n";
import { toast } from "@/composables/useToast";
import { confirm } from "@/composables/useConfirm";
import {
  cancelFontInstall,
  fontRegistry,
  fontsourceId,
  importFont,
  installFont,
  onFontProgress,
  probeFont,
  removeFont,
  revealFont,
  type FontProgress,
  type FontRegistry,
  type FontSourceSummary,
  type InstalledFont,
} from "@/core/fontsApi";
import {
  ensureInstalledFontsLoaded,
  installedFonts,
  reloadInstalledFonts,
} from "@/core/installedFonts";
import {
  availableLanguages,
  languageLabel,
  languagesOf,
  matchesLanguage,
  primaryLanguageLabel,
} from "@/core/fontLanguages";
import Md3Select, { type SelectOption } from "./Md3Select.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** 当前是否选中了文字片段（决定“应用”是否可用）。 */
    hasTextClip?: boolean;
    /** 打开时优先定位的字体 id（例如工程引用了缺失字体）。 */
    selectedFontId?: string;
  }>(),
  { hasTextClip: false, selectedFontId: "" },
);

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "apply", fontId: string): void;
}>();

const { t, locale } = useI18n();

const CJK_SUBSETS = new Set([
  "chinese-simplified",
  "chinese-traditional",
  "traditional-chinese",
  "japanese",
  "korean",
]);
const FILTERS = ["all", "sans-serif", "serif", "monospace", "display", "handwriting"];

const tab = ref<"library" | "installed">("library");
const registry = ref<FontRegistry | null>(null);
const registryLoading = ref(false);
const registryError = ref("");
const search = ref("");
const installedSearch = ref("");
const filter = ref("all");
/** 语言过滤：`all` 不过滤；其余见 `fontLanguages.ts`。 */
const languageId = ref("all");
const pageSize = ref(60);
const selectedSourceId = ref("");
const weights = ref<number[]>([]);
/** 样本文本按字体的主语言切换，避免默认只展示中文。 */
const SAMPLE_TEXTS: Record<string, string> = {
  latin: "Aa Bb Cc 123",
  "chinese-simplified": "永字八法 中文排版",
  "chinese-traditional": "永字八法 繁體中文",
  japanese: "あいうえお 日本語",
  korean: "가나다라 한글",
  cyrillic: "Абвгд Привет",
  arabic: "أبجد هوز حطي",
  hebrew: "אבגד שלום",
  devanagari: "अ आ इ क ख",
  thai: "ก ข ค ภาษาไทย",
  vietnamese: "Tiếng Việt ắằ",
  greek: "Αβγδ Ελληνικά",
};
const previewText = ref(SAMPLE_TEXTS.latin!);
/** 用户手动改过样本文本后，切换字体不再覆盖。 */
const previewTextEdited = ref(false);
const previewStatus = ref<"idle" | "loading" | "ready" | "error">("idle");
const installError = ref("");
const installing = ref(false);
const activeInstallId = ref("");
const progress = ref<FontProgress | null>(null);
const applyAfterInstall = ref(true);
const importBusy = ref(false);
const importDraft = ref<{ path: string; family: string; weight: number; style: string } | null>(
  null,
);
const highlightId = ref("");

const installedList = computed(() => installedFonts());
const installedMap = computed(() => {
  const map = new Map<string, InstalledFont>();
  for (const font of installedList.value) map.set(font.id, font);
  return map;
});
const installedFiltered = computed(() => {
  const query = installedSearch.value.trim().toLowerCase();
  if (!query) return installedList.value;
  return installedList.value.filter(
    (font) =>
      font.family.toLowerCase().includes(query) || font.id.toLowerCase().includes(query),
  );
});

const registryFonts = computed(() => registry.value?.fonts ?? []);
/** 可用语言由注册表数据决定（新文字系统不用改代码就会出现在下拉里）。 */
const languages = computed(() => availableLanguages(registryFonts.value));
const languageOptions = computed<SelectOption[]>(() => [
  { id: "all", label: t("font.lang.all") },
  ...languages.value.map((language) => ({
    id: language.id,
    label: languageLabel(language),
  })),
]);
/** 界面语言对应的字体语言：列表里把“当前界面语言”的字体排在前面，而不是写死中文。 */
const uiLanguageId = computed(() => (locale.value === "zh" ? "chinese-simplified" : "latin"));
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  const list = registryFonts.value.filter((font) => {
    if (query && !font.family.toLowerCase().includes(query) && !font.id.includes(query)) {
      return false;
    }
    if (filter.value !== "all" && font.category !== filter.value) return false;
    return matchesLanguage(font, languageId.value, languages.value);
  });
  return [...list].sort((a, b) => {
    const rank =
      Number(matchesLanguage(b, uiLanguageId.value)) -
      Number(matchesLanguage(a, uiLanguageId.value));
    return rank || a.family.localeCompare(b.family);
  });
});
const visibleFonts = computed(() => filtered.value.slice(0, pageSize.value));
const selected = computed(
  () => registryFonts.value.find((font) => font.id === selectedSourceId.value) ?? null,
);
const selectedInstalled = computed(() =>
  selected.value ? installedMap.value.get(fontsourceId(selected.value.id)) : undefined,
);

const previewFamily = computed(() =>
  selected.value ? `__aicut_preview_${selected.value.id.replace(/[^a-z0-9]/gi, "_")}` : "",
);
const previewWeight = computed(() => {
  const list = selected.value?.weights ?? [];
  return list.includes(400) ? 400 : (list[0] ?? 400);
});
const previewStack = computed(() =>
  previewStatus.value === "ready"
    ? `${JSON.stringify(previewFamily.value)}, "PingFang SC", "Microsoft YaHei", sans-serif`
    : '"PingFang SC", "Microsoft YaHei", sans-serif',
);
const progressPercent = computed(() => {
  const value = progress.value;
  if (!value || value.filesTotal === 0) return 12;
  return Math.max(4, Math.min(100, Math.round((value.filesDone / value.filesTotal) * 100)));
});
const progressText = computed(() => {
  const value = progress.value;
  if (!value || value.phase === "meta" || value.phase === "write") return t("font.installing");
  return t("font.downloading", {
    done: value.filesDone,
    total: value.filesTotal,
    size: formatBytes(value.bytes),
  });
});
const estimateSize = computed(() => {
  const font = selected.value;
  if (!font) return "";
  // 中文分片每字重约 2.4 MB；其余字体会装全部子集，按子集数量粗估。
  const perWeight = supportsCjk(font) ? 2_400_000 : Math.max(1, font.subsets.length) * 45_000;
  return formatBytes(perWeight * Math.max(1, weights.value.length));
});
const subsetSummary = computed(() => {
  const font = selected.value;
  if (!font) return "";
  return supportsCjk(font)
    ? t("font.subsetsSlices")
    : t("font.subsetsCount", { n: font.subsets.length });
});

let unlisten: (() => void) | null = null;
let previewToken = 0;
const previewCache = new Map<string, FontFace>();
const previewOrder: string[] = [];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function supportsCjk(font: FontSourceSummary): boolean {
  return font.subsets.some((subset) => CJK_SUBSETS.has(subset));
}

function defaultWeights(font: FontSourceSummary): number[] {
  const out: number[] = [];
  if (font.weights.includes(400)) out.push(400);
  if (font.weights.includes(700)) out.push(700);
  if (out.length === 0 && font.weights.length > 0) out.push(font.weights[0]!);
  return out;
}

function categoryLabel(font: FontSourceSummary): string {
  if (!font.category) return "";
  const key = `font.category.${font.category}`;
  const label = t(key);
  return label === key ? font.category : label;
}

function subsetForPreview(font: FontSourceSummary): string {
  for (const subset of CJK_SUBSETS) {
    if (font.subsets.includes(subset)) return subset;
  }
  return "latin";
}

async function loadRegistry(force = false): Promise<void> {
  registryLoading.value = true;
  registryError.value = "";
  try {
    registry.value = await fontRegistry(force);
    if (languageId.value !== "all" && !languages.value.some((item) => item.id === languageId.value)) {
      languageId.value = "all";
    }
    if (!selectedSourceId.value && filtered.value.length > 0) {
      selectSource(filtered.value[0]!.id);
    } else if (selectedSourceId.value && weights.value.length === 0) {
      const font = registryFonts.value.find((item) => item.id === selectedSourceId.value);
      if (font) {
        weights.value = defaultWeights(font);
        void loadPreview();
      }
    }
  } catch (error) {
    registryError.value = errorMessage(error);
  } finally {
    registryLoading.value = false;
  }
}

/** 按字体主语言挑一句样本；没登记的语言直接用字体名。 */
function sampleTextFor(font: FontSourceSummary): string {
  const primary = languagesOf(font)[0];
  if (primary && SAMPLE_TEXTS[primary.id]) return SAMPLE_TEXTS[primary.id]!;
  return SAMPLE_TEXTS.latin!;
}

function selectSource(id: string): void {
  selectedSourceId.value = id;
  const font = registryFonts.value.find((item) => item.id === id);
  weights.value = font ? defaultWeights(font) : [];
  installError.value = "";
  if (font && !previewTextEdited.value) previewText.value = sampleTextFor(font);
  void loadPreview();
}

async function loadPreview(): Promise<void> {
  const font = selected.value;
  if (!font) return;
  const token = ++previewToken;
  if (previewCache.has(font.id)) {
    previewStatus.value = "ready";
    return;
  }
  previewStatus.value = "loading";
  const url =
    `https://fastly.jsdelivr.net/npm/@fontsource/${font.id}/files/` +
    `${font.id}-${subsetForPreview(font)}-${previewWeight.value}-normal.woff2`;
  try {
    const face = new FontFace(previewFamily.value, `url(${JSON.stringify(url)})`, {
      weight: String(previewWeight.value),
      style: "normal",
    });
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("preview timeout")), 15000);
    });
    try {
      await Promise.race([face.load(), timeout]);
    } finally {
      window.clearTimeout(timer);
    }
    if (token !== previewToken) return;
    document.fonts.add(face);
    previewCache.set(font.id, face);
    previewOrder.push(font.id);
    while (previewOrder.length > 8) {
      const oldId = previewOrder.shift()!;
      const oldFace = previewCache.get(oldId);
      if (oldFace) document.fonts.delete(oldFace);
      previewCache.delete(oldId);
    }
    previewStatus.value = "ready";
  } catch {
    if (token === previewToken) previewStatus.value = "error";
  }
}

function toggleWeight(weight: number, checked: boolean): void {
  if (checked) {
    if (!weights.value.includes(weight)) weights.value = [...weights.value, weight].sort((a, b) => a - b);
  } else {
    weights.value = weights.value.filter((item) => item !== weight);
  }
}

async function install(): Promise<void> {
  const font = selected.value;
  if (!font || installing.value) return;
  if (weights.value.length === 0) {
    toast(t("font.noWeights"), "error");
    return;
  }
  installing.value = true;
  installError.value = "";
  progress.value = null;
  activeInstallId.value = fontsourceId(font.id);
  try {
    const installed = await installFont(font.id, weights.value);
    await reloadInstalledFonts();
    toast(t("font.installedToast", { name: installed.family }));
    if (applyAfterInstall.value && props.hasTextClip) {
      emit("apply", installed.id);
    }
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("已取消") || message.toLowerCase().includes("cancel")) {
      toast(message);
    } else {
      installError.value = message;
    }
  } finally {
    installing.value = false;
    activeInstallId.value = "";
    progress.value = null;
  }
}

function cancelInstall(): void {
  void cancelFontInstall(activeInstallId.value || undefined);
}

function reveal(font: InstalledFont): void {
  void revealFont(font.id).catch((error) => toast(errorMessage(error), "error"));
}

function applyFont(font: InstalledFont, close = true): void {
  emit("apply", font.id);
  toast(t("font.appliedToast", { name: font.family }));
  if (close) emit("update:open", false);
}

async function removeFontEntry(font: InstalledFont): Promise<void> {
  const accepted = await confirm({
    title: t("font.removeConfirmTitle"),
    message: t("font.removeConfirmMessage", { name: font.family }),
    confirmText: t("font.remove"),
    destructive: true,
  });
  if (!accepted) return;
  try {
    await removeFont(font.id);
    await reloadInstalledFonts();
    if (highlightId.value === font.id) highlightId.value = "";
    toast(t("font.removeDone", { name: font.family }));
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

function reinstall(font: InstalledFont): void {
  if (font.source !== "fontsource" || !font.sourceId) return;
  tab.value = "library";
  selectSource(font.sourceId);
  weights.value = font.weights.length > 0 ? [...font.weights] : weights.value;
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  return name.replace(/\.[^.]+$/, "");
}

async function pickLocalFont(): Promise<void> {
  if (importBusy.value) return;
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    importBusy.value = true;
    const probe = await probeFont(path);
    if (probe.family) {
      const font = await importFont(path);
      await finishImport(font);
    } else {
      importDraft.value = {
        path,
        family: fileStem(path),
        weight: probe.weight || 400,
        style: probe.style || "normal",
      };
    }
  } catch (error) {
    toast(errorMessage(error), "error");
  } finally {
    importBusy.value = false;
  }
}

async function confirmImport(): Promise<void> {
  const draft = importDraft.value;
  if (!draft) return;
  const family = draft.family.trim();
  if (!family) return;
  importBusy.value = true;
  try {
    const font = await importFont(draft.path, family, draft.weight, draft.style);
    importDraft.value = null;
    await finishImport(font);
  } catch (error) {
    toast(errorMessage(error), "error");
  } finally {
    importBusy.value = false;
  }
}

async function finishImport(font: InstalledFont): Promise<void> {
  await reloadInstalledFonts();
  tab.value = "installed";
  highlightId.value = font.id;
  toast(t("font.importedToast", { name: font.family }));
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void ensureInstalledFontsLoaded();
    void reloadInstalledFonts();
    if (!registry.value) void loadRegistry();
    const wanted = props.selectedFontId.startsWith("fs-")
      ? props.selectedFontId.slice(3)
      : "";
    if (wanted) {
      tab.value = "library";
      selectSource(wanted);
    }
  },
);

watch(search, () => {
  pageSize.value = 60;
});

// 换了筛选 / 语言后，如果当前详情已经不在列表里，就跳到第一条（搜索输入不触发重载预览）。
watch([filter, languageId], () => {
  pageSize.value = 60;
  if (selected.value && !filtered.value.some((font) => font.id === selectedSourceId.value)) {
    const first = filtered.value[0];
    if (first) selectSource(first.id);
  }
});

watch(tab, (value) => {
  if (value === "installed") void reloadInstalledFonts();
});

onMounted(async () => {
  unlisten = await onFontProgress((payload) => {
    if (payload.id !== activeInstallId.value) return;
    progress.value = payload;
    if (payload.phase === "error" && payload.message) installError.value = payload.message;
  });
  if (props.open) {
    void ensureInstalledFontsLoaded();
    void loadRegistry();
  }
});

onUnmounted(() => {
  unlisten?.();
});
</script>

<template>
  <ModalShell
    :open="open"
    :title="t('font.libraryTitle')"
    width="880px"
    :dismissible="!installing"
    @update:open="emit('update:open', $event)"
  >
    <div class="font-library">
      <div class="toolbar">
        <div class="tabs" role="tablist">
          <button
            class="tab"
            :class="{ active: tab === 'library' }"
            type="button"
            role="tab"
            :aria-selected="tab === 'library'"
            @click="tab = 'library'"
          >
            {{ t("font.libraryTab") }}
          </button>
          <button
            class="tab"
            :class="{ active: tab === 'installed' }"
            type="button"
            role="tab"
            :aria-selected="tab === 'installed'"
            @click="tab = 'installed'"
          >
            {{ t("font.installedTab") }}
            <span v-if="installedList.length" class="tab-count">{{ installedList.length }}</span>
          </button>
        </div>
        <div class="toolbar-actions">
          <button
            v-if="tab === 'library'"
            class="btn-text"
            type="button"
            :disabled="registryLoading"
            @click="loadRegistry(true)"
          >
            <ArrowPathIcon class="icon" :class="{ spin: registryLoading }" />
            {{ t("font.refresh") }}
          </button>
          <button class="btn-tonal" type="button" :disabled="importBusy" @click="pickLocalFont">
            <PlusIcon class="icon" />
            {{ importBusy ? t("font.importing") : t("font.import") }}
          </button>
        </div>
      </div>

      <p v-if="registry?.stale" class="notice">{{ t("font.staleNotice") }}</p>
      <p v-if="registryError && !registry" class="notice error">
        {{ t("font.registryFailed") }}：{{ registryError }}
      </p>

      <div v-if="tab === 'library'" class="library-grid">
        <aside class="list-pane">
          <input v-model="search" class="search" type="search" :placeholder="t('font.searchPlaceholder')" />
          <Md3Select
            class="language-select"
            :model-value="languageId"
            :options="languageOptions"
            :label="t('font.languageLabel')"
            @update:model-value="languageId = $event"
          />
          <div class="chips">
            <button
              v-for="item in FILTERS"
              :key="item"
              class="chip"
              :class="{ active: filter === item }"
              type="button"
              @click="filter = item"
            >
              {{ item === "all" ? t("font.filterAll") : t(`font.category.${item}`) }}
            </button>
          </div>
          <p class="count">{{ t("font.count", { n: filtered.length }) }}</p>
          <div class="font-list">
            <p v-if="registryLoading && !registry" class="empty">{{ t("font.loadingRegistry") }}</p>
            <button
              v-for="font in visibleFonts"
              :key="font.id"
              class="font-row"
              :class="{ active: font.id === selectedSourceId }"
              type="button"
              @click="selectSource(font.id)"
            >
              <span class="row-main">
                <span class="row-name">{{ font.family }}</span>
                <span class="row-meta">
                  {{ categoryLabel(font) }}
                  <template v-if="primaryLanguageLabel(font)">
                    · {{ primaryLanguageLabel(font) }}
                  </template>
                </span>
              </span>
              <span v-if="installedMap.has(fontsourceId(font.id))" class="badge">
                {{ t("font.installedBadge") }}
              </span>
            </button>
            <button
              v-if="visibleFonts.length < filtered.length"
              class="more"
              type="button"
              @click="pageSize += 60"
            >
              {{ t("font.more", { n: filtered.length - visibleFonts.length }) }}
            </button>
            <p v-if="!registryLoading && filtered.length === 0" class="empty">
              {{ t("font.empty") }}
            </p>
          </div>
        </aside>

        <section class="detail-pane">
          <template v-if="selected">
            <header class="detail-head">
              <h3 class="detail-title">{{ selected.family }}</h3>
              <p class="detail-meta">
                {{ categoryLabel(selected) }}
                <template v-if="selected.license"> · {{ selected.license }}</template>
                <template v-if="selected.type"> · {{ selected.type }}</template>
              </p>
            </header>

            <div class="preview">
              <input
                v-model="previewText"
                class="preview-input"
                @input="previewTextEdited = true"
                type="text"
                :aria-label="selected.family"
              />
              <p class="preview-line" :style="{ fontFamily: previewStack, fontWeight: previewWeight }">
                {{ previewText }}
              </p>
              <p v-if="previewStatus === 'loading'" class="preview-note">
                {{ t("font.previewLoading") }}
              </p>
              <p v-else-if="previewStatus === 'error'" class="preview-note">
                {{ t("font.previewFailed") }}
              </p>
            </div>

            <div class="field">
              <span class="field-label">{{ t("font.weights") }}</span>
              <div class="weight-list">
                <label v-for="weight in selected.weights" :key="weight" class="weight">
                  <input
                    type="checkbox"
                    :checked="weights.includes(weight)"
                    @change="toggleWeight(weight, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>{{ weight }}</span>
                </label>
              </div>
            </div>

            <p class="hint">{{ t("font.subsetsLabel") }}：{{ subsetSummary }}</p>
            <p class="hint">{{ t("font.estimate", { size: estimateSize }) }}</p>

            <label v-if="hasTextClip" class="apply-check">
              <input v-model="applyAfterInstall" type="checkbox" />
              <span>{{ t("font.applyAfterInstall") }}</span>
            </label>

            <div class="install-zone">
              <template v-if="installing">
                <div class="progress" role="progressbar" :aria-valuenow="progressPercent">
                  <span class="progress-bar" :style="{ width: `${progressPercent}%` }" />
                </div>
                <div class="progress-row">
                  <span class="progress-text">{{ progressText }}</span>
                  <button class="btn-text" type="button" @click="cancelInstall">
                    {{ t("font.cancel") }}
                  </button>
                </div>
              </template>
              <template v-else-if="selectedInstalled">
                <p class="installed-line">
                  {{ t("font.alreadyInstalled") }} ·
                  {{ selectedInstalled.weights.join(" / ") }} ·
                  {{ formatBytes(selectedInstalled.bytes) }}
                </p>
                <div class="actions">
                  <button
                    class="btn-tonal"
                    type="button"
                    :disabled="!hasTextClip"
                    @click="applyFont(selectedInstalled)"
                  >
                    {{ t("font.apply") }}
                  </button>
                  <button class="btn-text" type="button" @click="tab = 'installed'">
                    {{ t("font.manage") }}
                  </button>
                  <button
                    v-if="selectedInstalled.source === 'fontsource'"
                    class="btn-text"
                    type="button"
                    @click="install"
                  >
                    {{ t("font.reinstall") }}
                  </button>
                </div>
              </template>
              <template v-else>
                <button class="btn-filled" type="button" :disabled="weights.length === 0" @click="install">
                  {{ t("font.install") }}
                </button>
              </template>
              <p v-if="installError" class="error-text">{{ installError }}</p>
            </div>
          </template>
          <p v-else class="empty">{{ t("font.detailEmpty") }}</p>
        </section>
      </div>

      <div v-else class="installed-pane">
        <input
          v-model="installedSearch"
          class="search"
          type="search"
          :placeholder="t('font.searchInstalled')"
        />
        <div class="installed-list">
          <article
            v-for="font in installedFiltered"
            :key="font.id"
            class="installed-row"
            :class="{ highlight: font.id === highlightId }"
          >
            <div class="installed-main">
              <p class="installed-name">{{ font.family }}</p>
              <p class="installed-meta">
                {{ font.source === "local" ? t("font.localSource") : t("font.fontsourceSource") }}
                · {{ font.weights.join(" / ") }}
                · {{ t("font.sizeOnDisk", { size: formatBytes(font.bytes) }) }}
                <template v-if="font.license">
                  · {{ t("font.licenseLabel", { license: font.license }) }}
                </template>
              </p>
            </div>
            <div class="row-actions">
              <button
                class="btn-text"
                type="button"
                :disabled="!hasTextClip"
                @click="applyFont(font)"
              >
                {{ t("font.apply") }}
              </button>
              <button
                v-if="font.source === 'fontsource'"
                class="btn-text"
                type="button"
                @click="reinstall(font)"
              >
                {{ t("font.reinstall") }}
              </button>
              <button class="icon-btn" type="button" :title="t('font.reveal')" @click="reveal(font)">
                <FolderOpenIcon class="icon" />
              </button>
              <button class="icon-btn danger" type="button" :title="t('font.remove')" @click="removeFontEntry(font)">
                <TrashIcon class="icon" />
              </button>
            </div>
          </article>
          <div v-if="installedFiltered.length === 0" class="empty-state">
            <p class="empty-title">{{ t("font.emptyInstalled") }}</p>
            <p class="empty-hint">{{ t("font.emptyInstalledHint") }}</p>
            <button class="btn-tonal" type="button" @click="tab = 'library'">
              {{ t("font.openLibrary") }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="importDraft" class="import-card">
        <p class="import-title">{{ t("font.importPromptTitle") }}</p>
        <p class="hint">{{ t("font.importPromptHint") }}</p>
        <label class="import-field">
          <span>{{ t("font.familyLabel") }}</span>
          <input v-model="importDraft.family" class="search" type="text" />
        </label>
        <div class="import-row">
          <label class="import-field small">
            <span>{{ t("font.weights") }}</span>
            <input v-model.number="importDraft.weight" class="search" type="number" min="1" max="1000" />
          </label>
          <label class="import-field small">
            <span>Style</span>
            <select v-model="importDraft.style" class="search">
              <option value="normal">normal</option>
              <option value="italic">italic</option>
              <option value="oblique">oblique</option>
            </select>
          </label>
        </div>
        <div class="actions">
          <button class="btn-text" type="button" @click="importDraft = null">
            {{ t("font.cancel") }}
          </button>
          <button
            class="btn-filled"
            type="button"
            :disabled="importBusy || !importDraft.family.trim()"
            @click="confirmImport"
          >
            {{ importBusy ? t("font.importing") : t("font.importConfirm") }}
          </button>
        </div>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
.font-library {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: min(560px, calc(100vh - 230px));
  min-height: 360px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest) / 0.7);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 12.5px;
  cursor: pointer;
}
.tab.active {
  background-color: rgb(var(--md-primary) / 0.16);
  color: rgb(var(--md-primary));
  font-weight: 600;
}
.tab-count {
  font-size: 10.5px;
  opacity: 0.75;
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.icon {
  width: 15px;
  height: 15px;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.library-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.list-pane,
.detail-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.list-pane {
  padding: 10px;
  border-radius: 18px;
  background-color: rgb(var(--md-surface-container-highest) / 0.45);
}
.search {
  width: 100%;
  height: 32px;
  padding: 0 11px;
  border: 1px solid rgb(var(--md-outline) / 0.5);
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  outline: none;
}
.search:focus {
  border-color: rgb(var(--md-primary) / 0.8);
}
.language-select {
  width: 100%;
}
.language-select :deep(.md3-select) {
  height: 30px;
  padding-left: 11px;
  font-size: 11.5px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
  cursor: pointer;
}
.chip:hover {
  background-color: rgb(var(--md-on-surface) / 0.06);
}
.chip.active {
  border-color: rgb(var(--md-primary) / 0.4);
  background-color: rgb(var(--md-primary) / 0.12);
  color: rgb(var(--md-primary));
}
.count {
  margin: 0;
  padding: 0 2px;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.font-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-right: 2px;
}
.font-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: rgb(var(--md-on-surface));
  text-align: left;
  cursor: pointer;
}
.font-row:hover {
  background-color: rgb(var(--md-on-surface) / 0.06);
}
.font-row.active {
  background-color: rgb(var(--md-primary) / 0.14);
}
.row-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.row-name {
  overflow: hidden;
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta {
  font-size: 10px;
  color: rgb(var(--md-on-surface-variant));
}
.badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
  font-size: 9px;
}
.more {
  margin: 6px 4px;
  padding: 6px;
  border: 1px dashed rgb(var(--md-outline) / 0.5);
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  cursor: pointer;
}
.empty {
  margin: 12px 6px;
  font-size: 11.5px;
  line-height: 1.6;
  text-align: center;
  color: rgb(var(--md-on-surface-muted));
}
.detail-pane {
  padding: 14px 16px;
  border-radius: 18px;
  background-color: rgb(var(--md-surface-container-highest) / 0.3);
  overflow-y: auto;
}
.detail-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.detail-meta {
  margin: 0;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high) / 0.8);
}
.preview-input {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  font-size: 11px;
  outline: none;
}
.preview-line {
  margin: 0;
  min-height: 40px;
  font-size: 27px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.preview-note {
  margin: 0;
  font-size: 10px;
  color: rgb(var(--md-on-surface-muted));
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field-label {
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.weight-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.weight {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border: 1px solid rgb(var(--md-outline) / 0.45);
  border-radius: 999px;
  font-size: 11px;
  cursor: pointer;
}
.weight input {
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: rgb(var(--md-primary));
}
.hint {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}
.apply-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.apply-check input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: rgb(var(--md-primary));
}
.install-zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
}
.progress {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.progress-bar {
  display: block;
  height: 100%;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  transition: width 0.2s ease;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.progress-text {
  flex: 1;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.installed-line {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-primary));
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.error-text {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-error));
}
.notice {
  margin: 0;
  padding: 6px 10px;
  border-radius: 10px;
  background-color: rgb(var(--md-primary) / 0.08);
  color: rgb(var(--md-on-surface-variant));
  font-size: 10.5px;
}
.notice.error {
  background-color: rgb(var(--md-error) / 0.1);
  color: rgb(var(--md-error));
}
.installed-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.installed-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.installed-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-highest) / 0.45);
}
.installed-row.highlight {
  outline: 1px solid rgb(var(--md-primary) / 0.55);
}
.installed-main {
  min-width: 0;
  flex: 1;
}
.installed-name {
  margin: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.installed-meta {
  margin: 0;
  font-size: 10px;
  color: rgb(var(--md-on-surface-variant));
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.icon-btn {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
}
.icon-btn:hover {
  background-color: rgb(var(--md-on-surface) / 0.08);
}
.icon-btn.danger:hover {
  color: rgb(var(--md-error));
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 16px;
  text-align: center;
}
.empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.empty-hint {
  margin: 0;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.import-card {
  position: absolute;
  right: 34px;
  bottom: 34px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(360px, calc(100% - 68px));
  padding: 14px;
  border-radius: 18px;
  background-color: rgb(var(--md-surface-container-high));
  box-shadow: var(--md-elevation-3);
}
.import-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.import-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-variant));
}
.import-row {
  display: flex;
  gap: 8px;
}
.import-field.small {
  flex: 1;
}
.btn-filled,
.btn-tonal,
.btn-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-size: 11.5px;
  cursor: pointer;
}
.btn-filled {
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
}
.btn-filled:disabled,
.btn-tonal:disabled,
.btn-text:disabled {
  opacity: 0.45;
  cursor: default;
}
.btn-tonal {
  background-color: rgb(var(--md-primary) / 0.14);
  color: rgb(var(--md-primary));
}
.btn-text {
  background: transparent;
  color: rgb(var(--md-primary));
}
.btn-text:hover:not(:disabled) {
  background-color: rgb(var(--md-primary) / 0.08);
}
</style>

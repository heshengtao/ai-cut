<script setup lang="ts">
/** 检查器面板：显示选中片段的真实属性，并把不透明度/音量/文字写回文档。 */
import { computed, ref } from "vue";
import {
  Bars3BottomLeftIcon,
  Bars3BottomRightIcon,
  Bars3Icon,
  EllipsisHorizontalIcon,
  FilmIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import {
  relinkAsset,
  setClipBlendMode,
  setClipCornerRadius,
  setClipFadeIn,
  setClipFadeOut,
  setClipGain,
  setClipOpacity,
  setClipPan,
  setClipPitch,
  setClipShadow,
  setClipStroke,
  setClipText,
  setClipTextStyle,
  setClipTransform,
} from "@/core/ops";
import { fileUrl, pickMediaFiles } from "@/core/media";
import { formatTimecode } from "@/core/time";
import { resolveTransform } from "@/core/transform";
import {
  BLEND_MODES,
  FONT_FAMILIES,
  TEXT_ALIGNS,
  resolveBlendMode,
  resolveCornerRadius,
  resolveShadow,
  resolveStroke,
  resolveTextStyle,
} from "@/core/clipStyle";
import type {
  BlendMode,
  ClipShadow,
  ClipStroke,
  ClipTextStyle,
  ClipTransform,
  Project,
  TextAlign,
} from "@/types/project";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { useTextPresetsStore } from "@/stores/textPresets";
import { toast } from "@/composables/useToast";
import NumberField from "@/components/common/NumberField.vue";
import ColorField from "@/components/common/ColorField.vue";
import ToggleSwitch from "@/components/common/ToggleSwitch.vue";
import Md3Select, { type SelectOption } from "@/components/common/Md3Select.vue";
import ProjectDialog from "@/components/common/ProjectDialog.vue";
import { useI18n } from "@/i18n";

const project = useProjectStore();
const selection = useSelectionStore();
const textPresets = useTextPresetsStore();
const i18n = useI18n();

const clip = computed(() => {
  const ids = new Set(selection.selectedClipIds);
  for (const track of project.doc.tracks) {
    const found = track.clips.find((c) => ids.has(c.id));
    if (found) return found;
  }
  return null;
});

const asset = computed(() =>
  clip.value && clip.value.assetId !== ""
    ? project.doc.assets.find((a) => a.id === clip.value!.assetId)
    : undefined,
);

const track = computed(() =>
  clip.value ? project.doc.tracks.find((t) => t.id === clip.value!.trackId) : undefined,
);

const isText = computed(() => clip.value?.assetId === "");
const isAudio = computed(() => asset.value?.kind === "audio");
/** 画面类片段（文字 / 图片 / 视频 / 缺失素材）才显示变换与视觉特效。 */
const isVisual = computed(() => isText.value || !isAudio.value);
const opacityPercent = computed(() => Math.round((clip.value?.opacity ?? 1) * 100));
const transform = computed(() => (clip.value ? resolveTransform(clip.value) : null));
const scalePercent = computed(() => Math.round((transform.value?.scale ?? 1) * 100));

const textStyle = computed(() => (clip.value ? resolveTextStyle(clip.value) : null));
const stroke = computed(() => (clip.value ? resolveStroke(clip.value) : null));
const shadow = computed(() => (clip.value ? resolveShadow(clip.value) : null));
const blendMode = computed(() => (clip.value ? resolveBlendMode(clip.value) : "normal"));
const cornerRadius = computed(() =>
  clip.value ? resolveCornerRadius(clip.value) : 0,
);

/** 音频相关参数（旧工程缺省为 0）。 */
const fadeIn = computed(() => clip.value?.fadeIn ?? 0);
const fadeOut = computed(() => clip.value?.fadeOut ?? 0);
const pitch = computed(() => clip.value?.pitch ?? 0);
const panPercent = computed(() => Math.round((clip.value?.pan ?? 0) * 100));

/** 保存文字预设的命名对话框。 */
const presetDialogOpen = ref(false);
const presetInitialName = computed(() => {
  const text = clip.value?.text?.trim() ?? "";
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
});

const fontOptions = computed<SelectOption[]>(() =>
  FONT_FAMILIES.map((font) => ({ id: font.id, label: i18n.t(font.labelKey) })),
);

const blendOptions = computed<SelectOption[]>(() =>
  BLEND_MODES.map((mode) => ({
    id: mode,
    label: i18n.t(`blend.${mode}`),
  })),
);

const ALIGN_ICONS: Record<TextAlign, unknown> = {
  left: Bars3BottomLeftIcon,
  center: Bars3Icon,
  right: Bars3BottomRightIcon,
};

function onOpacityInput(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipOpacity(doc, target.id, value / 100));
}

function onBlendMode(value: BlendMode | string): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipBlendMode(doc, target.id, value));
}

function onTextStyle(patch: Partial<ClipTextStyle>, coalesce = false): void {
  const target = clip.value;
  if (!target) return;
  const mutate = (doc: Project) => setClipTextStyle(doc, target.id, patch);
  if (coalesce) project.dispatchCoalesced(mutate, `text-style:${target.id}`);
  else project.dispatch(mutate);
  if (clip.value) textPresets.rememberStyle(resolveTextStyle(clip.value));
}

function onStroke(patch: Partial<ClipStroke>, coalesce = false): void {
  const target = clip.value;
  if (!target) return;
  const mutate = (doc: Project) => setClipStroke(doc, target.id, patch);
  if (coalesce) project.dispatchCoalesced(mutate, `stroke:${target.id}`);
  else project.dispatch(mutate);
}

function onShadow(patch: Partial<ClipShadow>, coalesce = false): void {
  const target = clip.value;
  if (!target) return;
  const mutate = (doc: Project) => setClipShadow(doc, target.id, patch);
  if (coalesce) project.dispatchCoalesced(mutate, `shadow:${target.id}`);
  else project.dispatch(mutate);
}

function onRadius(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipCornerRadius(doc, target.id, value));
}

function onTransformInput(patch: Partial<ClipTransform>): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipTransform(doc, target.id, patch));
}

function onGainInput(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipGain(doc, target.id, value));
}

function onFadeInInput(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipFadeIn(doc, target.id, value));
}

function onFadeOutInput(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipFadeOut(doc, target.id, value));
}

function onPitchInput(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipPitch(doc, target.id, value));
}

function onPanInput(value: number): void {
  const target = clip.value;
  if (!target) return;
  project.dispatch((doc) => setClipPan(doc, target.id, value / 100));
}

/** 把当前文字片段的样式保存成媒体库预设。 */
function saveTextPreset(name: string): void {
  const target = clip.value;
  if (!target) return;
  const preset = textPresets.savePreset({
    name,
    text: target.text ?? "",
    duration: target.duration,
    textStyle: resolveTextStyle(target),
  });
  textPresets.rememberStyle(resolveTextStyle(target));
  toast(i18n.t("textPreset.saved", { name: preset.name }));
}

function onTextInput(event: Event): void {
  const target = clip.value;
  if (!target) return;
  const value = (event.target as HTMLTextAreaElement).value;
  project.dispatchCoalesced((doc) => setClipText(doc, target.id, value), `text:${target.id}`);
}

async function relink(): Promise<void> {
  const target = asset.value;
  if (!target) return;
  const picked = await pickMediaFiles();
  if (picked.length === 0) return;
  project.dispatch((doc) => relinkAsset(doc, target.id, picked[0]));
  toast(i18n.t("inspector.relinked"));
}
</script>

<template>
  <div class="pane">
    <header class="pane-head">
      <div>
        <h2 class="pane-title">{{ i18n.t("inspector.title") }}</h2>
        <p class="pane-sub">
          {{
            clip
              ? isText
                ? i18n.t("inspector.textSelected")
                : i18n.t("inspector.mediaSelected")
              : i18n.t("inspector.nothingSelected")
          }}
        </p>
      </div>
      <button class="icon-btn" :aria-label="i18n.t('inspector.more')">
        <EllipsisHorizontalIcon class="w-[18px] h-[18px]" />
      </button>
    </header>

    <div class="pane-scroll">
      <p v-if="!clip" class="hint-empty">{{ i18n.t("inspector.emptyHint") }}</p>

      <template v-else>
        <div class="selected">
          <div
            class="selected-thumb"
            :style="asset?.thumb ? { backgroundImage: `url('${fileUrl(asset.thumb)}')` } : undefined"
          >
            <FilmIcon v-if="!asset?.thumb" class="w-4 h-4" />
          </div>
          <div class="selected-text">
            <span class="selected-name">
              {{ isText ? clip.text || i18n.t("inspector.textClip") : (asset?.name ?? i18n.t("inspector.missingAsset")) }}
            </span>
            <span class="selected-meta">
              {{ track?.name }} · {{ formatTimecode(clip.duration, project.doc.fps) }}
            </span>
          </div>
        </div>

        <p v-if="asset?.offline" class="offline-row">
          <ExclamationTriangleIcon class="w-4 h-4" />
          {{ i18n.t("inspector.offline") }}
          <button class="btn-text" @click="relink">{{ i18n.t("inspector.relink") }}</button>
        </p>

        <template v-if="isText">
          <div class="section-label">{{ i18n.t("inspector.text") }}</div>
          <textarea
            class="text-input"
            rows="3"
            :value="clip.text ?? ''"
            @input="onTextInput"
            @change="project.endCoalesce()"
          />

          <div class="section-label">{{ i18n.t("inspector.textStyle") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.font") }}</span>
              <Md3Select
                class="prop-select"
                :model-value="textStyle?.fontFamily ?? ''"
                :options="fontOptions"
                :label="i18n.t('inspector.font')"
                @update:model-value="onTextStyle({ fontFamily: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.fontSize") }}</span>
              <NumberField
                :model-value="textStyle?.fontSize ?? 48"
                :min="5"
                :max="400"
                :step="1"
                :sr-label="i18n.t('inspector.fontSize')"
                input-width="44px"
                @update:model-value="onTextStyle({ fontSize: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.color") }}</span>
              <ColorField
                :model-value="textStyle?.color ?? '#ffffff'"
                :label="i18n.t('inspector.color')"
                @update:model-value="onTextStyle({ color: $event }, true)"
                @commit="project.endCoalesce()"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.letterSpacing") }}</span>
              <NumberField
                :model-value="textStyle?.letterSpacing ?? 0"
                :min="-100"
                :max="200"
                :step="0.5"
                :decimals="1"
                :sr-label="i18n.t('inspector.letterSpacing')"
                input-width="44px"
                @update:model-value="onTextStyle({ letterSpacing: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.lineHeight") }}</span>
              <NumberField
                :model-value="textStyle?.lineHeight ?? 1.25"
                :min="0.5"
                :max="4"
                :step="0.05"
                :decimals="2"
                :sr-label="i18n.t('inspector.lineHeight')"
                input-width="44px"
                @update:model-value="onTextStyle({ lineHeight: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.align") }}</span>
              <div class="align-group" role="group" :aria-label="i18n.t('inspector.align')">
                <button
                  v-for="align in TEXT_ALIGNS"
                  :key="align"
                  class="align-btn"
                  :class="{ on: textStyle?.align === align }"
                  type="button"
                  :aria-pressed="textStyle?.align === align"
                  :aria-label="i18n.t(`inspector.align.${align}`)"
                  @click="onTextStyle({ align })"
                >
                  <component :is="ALIGN_ICONS[align]" class="align-icon" />
                </button>
              </div>
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.background") }}</span>
              <ToggleSwitch
                :model-value="textStyle?.backgroundEnabled ?? false"
                :label="i18n.t('inspector.background')"
                @update:model-value="onTextStyle({ backgroundEnabled: $event })"
              />
            </div>
            <template v-if="textStyle?.backgroundEnabled">
              <div class="prop-row">
                <span>{{ i18n.t("inspector.backgroundColor") }}</span>
                <ColorField
                  :model-value="textStyle?.backgroundColor ?? '#000000'"
                  :label="i18n.t('inspector.backgroundColor')"
                  @update:model-value="onTextStyle({ backgroundColor: $event }, true)"
                  @commit="project.endCoalesce()"
                />
              </div>
              <div class="prop-row">
                <span>{{ i18n.t("inspector.backgroundOpacity") }}</span>
                <NumberField
                  :model-value="Math.round((textStyle?.backgroundOpacity ?? 0.65) * 100)"
                  :min="0"
                  :max="100"
                  :step="1"
                  :sr-label="i18n.t('inspector.backgroundOpacity')"
                  input-width="44px"
                  @update:model-value="onTextStyle({ backgroundOpacity: $event / 100 })"
                />
              </div>
            </template>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.glow") }}</span>
              <ToggleSwitch
                :model-value="textStyle?.glowEnabled ?? false"
                :label="i18n.t('inspector.glow')"
                @update:model-value="onTextStyle({ glowEnabled: $event })"
              />
            </div>
            <template v-if="textStyle?.glowEnabled">
              <div class="prop-row">
                <span>{{ i18n.t("inspector.glowColor") }}</span>
                <ColorField
                  :model-value="textStyle?.glowColor ?? '#ffffff'"
                  :label="i18n.t('inspector.glowColor')"
                  @update:model-value="onTextStyle({ glowColor: $event }, true)"
                  @commit="project.endCoalesce()"
                />
              </div>
              <div class="prop-row">
                <span>{{ i18n.t("inspector.glowBlur") }}</span>
                <NumberField
                  :model-value="textStyle?.glowBlur ?? 16"
                  :min="0"
                  :max="200"
                  :step="1"
                  :sr-label="i18n.t('inspector.glowBlur')"
                  input-width="44px"
                  @update:model-value="onTextStyle({ glowBlur: $event })"
                />
              </div>
            </template>
          </div>

          <div class="section-label">{{ i18n.t("inspector.textPreset") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.textPresetHint") }}</span>
              <button class="preset-btn" type="button" @click="presetDialogOpen = true">
                {{ i18n.t("inspector.saveTextPreset") }}
              </button>
            </div>
          </div>
        </template>

        <template v-if="isVisual">
        <div class="section-label">{{ i18n.t("inspector.transform") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.positionX") }}</span>
            <NumberField
              :model-value="transform?.x ?? 0"
              :min="-300"
              :max="300"
              :step="1"
              :decimals="1"
              :sr-label="i18n.t('inspector.positionX')"
              input-width="44px"
              @update:model-value="onTransformInput({ x: $event })"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.positionY") }}</span>
            <NumberField
              :model-value="transform?.y ?? 0"
              :min="-300"
              :max="300"
              :step="1"
              :decimals="1"
              :sr-label="i18n.t('inspector.positionY')"
              input-width="44px"
              @update:model-value="onTransformInput({ y: $event })"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.scale") }}</span>
            <NumberField
              :model-value="scalePercent"
              :min="5"
              :max="500"
              :step="1"
              :sr-label="i18n.t('inspector.scale')"
              input-width="44px"
              @update:model-value="onTransformInput({ scale: $event / 100 })"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.rotation") }}</span>
            <NumberField
              :model-value="transform?.rotation ?? 0"
              :min="-360"
              :max="360"
              :step="1"
              :decimals="1"
              :sr-label="i18n.t('inspector.rotation')"
              input-width="44px"
              @update:model-value="onTransformInput({ rotation: $event })"
            />
          </div>
        </div>

        <div class="section-label">{{ i18n.t("inspector.compositing") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.opacity") }}</span>
            <NumberField
              :model-value="opacityPercent"
              :min="0"
              :max="100"
              :step="1"
              :sr-label="i18n.t('inspector.opacity')"
              input-width="44px"
              @update:model-value="onOpacityInput"
            />
          </div>
          <div class="prop-row">
            <span>{{ i18n.t("inspector.blendMode") }}</span>
            <Md3Select
              class="prop-select"
              :model-value="blendMode"
              :options="blendOptions"
              :label="i18n.t('inspector.blendMode')"
              @update:model-value="onBlendMode"
            />
          </div>
        </div>

        <div class="section-label">{{ i18n.t("inspector.stroke") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.stroke") }}</span>
            <ToggleSwitch
              :model-value="stroke?.enabled ?? false"
              :label="i18n.t('inspector.stroke')"
              @update:model-value="onStroke({ enabled: $event })"
            />
          </div>
          <template v-if="stroke?.enabled">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.color") }}</span>
              <ColorField
                :model-value="stroke?.color ?? '#000000'"
                :label="i18n.t('inspector.strokeColor')"
                @update:model-value="onStroke({ color: $event }, true)"
                @commit="project.endCoalesce()"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.strokeWidth") }}</span>
              <NumberField
                :model-value="stroke?.width ?? 4"
                :min="0"
                :max="80"
                :step="1"
                :decimals="1"
                :sr-label="i18n.t('inspector.strokeWidth')"
                input-width="44px"
                @update:model-value="onStroke({ width: $event })"
              />
            </div>
          </template>
        </div>

        <div class="section-label">{{ i18n.t("inspector.shadow") }}</div>
        <div class="group">
          <div class="prop-row">
            <span>{{ i18n.t("inspector.shadow") }}</span>
            <ToggleSwitch
              :model-value="shadow?.enabled ?? false"
              :label="i18n.t('inspector.shadow')"
              @update:model-value="onShadow({ enabled: $event })"
            />
          </div>
          <template v-if="shadow?.enabled">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.color") }}</span>
              <ColorField
                :model-value="shadow?.color ?? '#000000'"
                :label="i18n.t('inspector.shadowColor')"
                @update:model-value="onShadow({ color: $event }, true)"
                @commit="project.endCoalesce()"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.opacity") }}</span>
              <NumberField
                :model-value="Math.round((shadow?.opacity ?? 0.5) * 100)"
                :min="0"
                :max="100"
                :step="1"
                :sr-label="i18n.t('inspector.shadowOpacity')"
                input-width="44px"
                @update:model-value="onShadow({ opacity: $event / 100 })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.blur") }}</span>
              <NumberField
                :model-value="shadow?.blur ?? 16"
                :min="0"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.blur')"
                input-width="44px"
                @update:model-value="onShadow({ blur: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.offsetX") }}</span>
              <NumberField
                :model-value="shadow?.offsetX ?? 0"
                :min="-300"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.offsetX')"
                input-width="44px"
                @update:model-value="onShadow({ offsetX: $event })"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.offsetY") }}</span>
              <NumberField
                :model-value="shadow?.offsetY ?? 0"
                :min="-300"
                :max="300"
                :step="1"
                :sr-label="i18n.t('inspector.offsetY')"
                input-width="44px"
                @update:model-value="onShadow({ offsetY: $event })"
              />
            </div>
          </template>
        </div>
        </template>

        <template v-if="isVisual && !isText">
          <div class="section-label">{{ i18n.t("inspector.appearance") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.cornerRadius") }}</span>
              <NumberField
                :model-value="cornerRadius"
                :min="0"
                :max="1000"
                :step="1"
                :sr-label="i18n.t('inspector.cornerRadius')"
                input-width="44px"
                @update:model-value="onRadius"
              />
            </div>
          </div>
        </template>

        <template v-if="!isText && (isAudio || asset?.kind === 'video' || !asset)">
          <div class="section-label">{{ i18n.t("inspector.audio") }}</div>
          <div class="group">
            <div class="prop-row">
              <span>{{ i18n.t("inspector.volume") }}</span>
              <NumberField
                :model-value="clip.gain ?? 0"
                :min="-60"
                :max="12"
                :step="0.5"
                :decimals="1"
                :sr-label="i18n.t('inspector.volume')"
                input-width="44px"
                @update:model-value="onGainInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.fadeIn") }}</span>
              <NumberField
                :model-value="fadeIn"
                :min="0"
                :max="clip.duration"
                :step="0.1"
                :decimals="2"
                :sr-label="i18n.t('inspector.fadeIn')"
                input-width="44px"
                @update:model-value="onFadeInInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.fadeOut") }}</span>
              <NumberField
                :model-value="fadeOut"
                :min="0"
                :max="clip.duration"
                :step="0.1"
                :decimals="2"
                :sr-label="i18n.t('inspector.fadeOut')"
                input-width="44px"
                @update:model-value="onFadeOutInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.pitch") }}</span>
              <NumberField
                :model-value="pitch"
                :min="-12"
                :max="12"
                :step="1"
                :sr-label="i18n.t('inspector.pitch')"
                input-width="44px"
                @update:model-value="onPitchInput"
              />
            </div>
            <div class="prop-row">
              <span>{{ i18n.t("inspector.pan") }}</span>
              <NumberField
                :model-value="panPercent"
                :min="-100"
                :max="100"
                :step="5"
                :sr-label="i18n.t('inspector.pan')"
                input-width="44px"
                @update:model-value="onPanInput"
              />
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>

  <ProjectDialog
    v-model:open="presetDialogOpen"
    :initial-name="presetInitialName"
    :title="i18n.t('textPreset.saveTitle')"
    :label="i18n.t('textPreset.nameLabel')"
    :placeholder="i18n.t('textPreset.namePlaceholder')"
    :confirm-text="i18n.t('textPreset.save')"
    @submit="saveTextPreset"
  />
</template>

<style scoped>
.hint-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.selected {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 14px;
  background-color: rgb(var(--md-surface-container-high));
  margin-bottom: 2px;
}
.selected-thumb {
  width: 46px;
  height: 34px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: linear-gradient(140deg, #2c1f4d 0%, #7c4a76 50%, #e79a76 100%);
  background-size: cover;
  background-position: center;
  color: rgba(255, 255, 255, 0.9);
}
.selected-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.selected-name {
  font-size: 12.5px;
  font-weight: 500;
  color: rgb(var(--md-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.selected-meta {
  font-size: 10.5px;
  color: rgb(var(--md-on-surface-muted));
}
.offline-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 12px;
  background-color: rgb(var(--md-error-container));
  color: rgb(var(--md-on-error-container));
  font-size: 11.5px;
}
.text-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgb(var(--md-outline) / 0.55);
  border-radius: 12px;
  background-color: rgb(var(--md-surface-container-high));
  color: rgb(var(--md-on-surface));
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}
.text-input:focus {
  border-color: rgb(var(--md-primary));
  box-shadow: 0 0 0 2px rgb(var(--md-primary) / 0.22);
}
.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 10px 6px;
  border-radius: 16px;
  background-color: var(--app-inset);
}
.group + .section-label {
  margin-top: 18px;
}
.prop-row {
  min-height: 38px;
  align-items: center;
}
.prop-select {
  width: 172px;
  flex: 0 0 auto;
}
.align-group {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background-color: rgb(var(--md-surface-container-highest));
}
.align-btn {
  width: 30px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-on-surface-variant));
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.align-btn:hover {
  color: rgb(var(--md-on-surface));
  background-color: rgb(var(--md-on-surface) / var(--md-state-hover-alpha));
}
.align-btn.on {
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
}
.align-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.align-icon {
  width: 16px;
  height: 16px;
}
.preset-btn {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-secondary-container));
  color: rgb(var(--md-on-secondary-container));
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 0.14s ease, transform 0.14s ease;
}
.preset-btn:hover {
  filter: brightness(1.06);
}
.preset-btn:active {
  transform: scale(0.96);
}
.preset-btn:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
</style>

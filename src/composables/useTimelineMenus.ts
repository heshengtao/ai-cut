/**
 * 时间线右键菜单的构建器。
 *
 * 菜单按「点在了什么上」决定内容：
 * - 片段：AI 智能（按音频 / 画面 / 文字分能力）→ 常用编辑 → 更多编辑 / 音频 / 画面 / 属性；
 * - 空白轨道：AI 生成 → 粘贴 / 文字 / 标记 → 轨道操作 → 新建轨道；
 * - 标尺：AI 生成 → 定位 / 此处分割 / 标记；
 * - 标记 / 轨道头：定位与编辑、轨道开关与增删。
 *
 * AI 永远排在第一组；具体能力再按媒体类型裁剪，音频片段不会出现「AI 超分」这种无效项。
 */
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowsRightLeftIcon,
  BoltIcon,
  ChartBarIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  DocumentTextIcon,
  EyeIcon,
  EyeSlashIcon,
  FaceSmileIcon,
  FilmIcon,
  FlagIcon,
  LanguageIcon,
  LockClosedIcon,
  LockOpenIcon,
  MapPinIcon,
  MicrophoneIcon,
  MusicalNoteIcon,
  PhotoIcon,
  PlusIcon,
  QueueListIcon,
  ScissorsIcon,
  SparklesIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  TrashIcon,
  UserIcon,
} from "@heroicons/vue/24/outline";
import {
  addMarker,
  addTrackAt,
  removeTrack,
  setClipColor,
  setClipFadeIn,
  setClipFadeOut,
  setClipGain,
  setClipMuted,
  setClipSpeed,
  setClipTransform,
  setTrackFlag,
  splitClips,
} from "@/core/ops";
import { extractClipAudio } from "@/core/audioEdit";
import { applyClipAttributes, resetClipAttributes } from "@/core/clipAttributes";
import { createMarker } from "@/core/factory";
import { snapToFrame } from "@/core/time";
import { useAiClipActions } from "@/composables/useAiClipActions";
import { useTimelineActions } from "@/composables/useTimelineActions";
import { useTimelineInsert } from "@/composables/useTimelineInsert";
import RippleDeleteIcon from "@/components/common/RippleDeleteIcon.vue";
import { useClipAttributesStore } from "@/stores/clipAttributes";
import { useLayoutStore } from "@/stores/layout";
import { usePlaybackStore } from "@/stores/playback";
import { useProjectStore } from "@/stores/project";
import { useSelectionStore } from "@/stores/selection";
import { confirm } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { copyText } from "@/utils/clipboard";
import { isMacOS } from "@/utils/platform";
import {
  menuAction,
  menuSeparator,
  menuSubmenu,
  type MenuAction,
  type MenuItem,
  type MenuSubmenu,
} from "@/components/common/contextMenu";
import type { AudioDspPreset } from "@/types/models";
import type { Clip, Marker, MediaAsset, Project, Track } from "@/types/project";
import { t } from "@/i18n";

export type TimelineMenuTarget =
  | { kind: "clip"; clipId: string }
  | { kind: "lane"; trackId: string | null; index: number; time: number }
  | { kind: "ruler"; time: number }
  | { kind: "marker"; markerId: string }
  | { kind: "track"; trackId: string };

/** 菜单里需要宿主组件配合的动作（打开标记对话框、确认删除标记）。 */
export interface TimelineMenuHost {
  editMarker?: (marker: Marker) => void;
  removeMarker?: (marker: Marker) => void;
}

const MOD = isMacOS() ? "⌘" : "Ctrl";

/** 翻译 / 译制配音支持的目标语言。 */
const LANGUAGES = ["en", "zh", "ja", "ko", "es", "fr", "de"] as const;
type LanguageId = (typeof LANGUAGES)[number];

const BEAUTIFY_PRESETS: AudioDspPreset[] = ["natural", "bright", "warm"];
const FADE_STEPS = [0.5, 1, 2];
const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface LocatedClip {
  clip: Clip;
  track: Track;
  asset: MediaAsset | null;
}

function action(
  id: string,
  label: string,
  run: () => void,
  extra: Partial<Omit<MenuAction, "kind" | "id" | "label" | "run">> = {},
): MenuAction {
  return menuAction({ id, label, run, ...extra });
}

function submenu(
  id: string,
  label: string,
  items: MenuItem[],
  extra: Partial<Omit<MenuSubmenu, "kind" | "id" | "label" | "items">> = {},
): MenuSubmenu {
  return menuSubmenu({ id, label, items, ...extra });
}

function findClipInDoc(doc: Project, clipId: string): Clip | null {
  for (const track of doc.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return null;
}

export function useTimelineMenus(host: TimelineMenuHost = {}) {
  const project = useProjectStore();
  const playback = usePlaybackStore();
  const selection = useSelectionStore();
  const layout = useLayoutStore();
  const actions = useTimelineActions();
  const insert = useTimelineInsert();
  const ai = useAiClipActions();
  const attributes = useClipAttributesStore();

  function locateClip(clipId: string): LocatedClip | null {
    for (const track of project.doc.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (!clip) continue;
      const asset =
        clip.assetId === ""
          ? null
          : (project.doc.assets.find((candidate) => candidate.id === clip.assetId) ?? null);
      return { clip, track, asset };
    }
    return null;
  }

  function selectedClips(): Clip[] {
    const ids = new Set(selection.selectedClipIds);
    if (ids.size === 0) return [];
    return project.doc.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => ids.has(clip.id));
  }

  function isTextClip(clip: Clip): boolean {
    return clip.assetId === "";
  }

  function isAudioCapable(clip: Clip, asset: MediaAsset | null): boolean {
    if (!asset || asset.offline || !(clip.duration > 0)) return false;
    if (asset.kind === "audio") return true;
    return asset.kind === "video" && asset.hasAudio !== false;
  }

  function isVisualClip(clip: Clip, asset: MediaAsset | null): boolean {
    if (!asset || asset.offline || clip.audioOnly) return false;
    return asset.kind === "video" || asset.kind === "image";
  }

  function assetOf(clip: Clip): MediaAsset | null {
    return project.doc.assets.find((asset) => asset.id === clip.assetId) ?? null;
  }

  function applyToIds(
    ids: string[],
    label: string,
    mutate: (doc: Project, clipId: string) => Project,
  ): void {
    if (ids.length === 0) return;
    project.dispatch((doc) => ids.reduce((next, id) => mutate(next, id), doc), {
      kind: "ui.dispatch",
      actor: "human",
      label,
    });
  }

  function withCount(label: string, count: number): string {
    return count > 1 ? `${label}（${count}）` : label;
  }

  // -------------------------------------------------------------------------
  // 片段 AI
  // -------------------------------------------------------------------------

  function languageItems(clipId: string, dub: boolean): MenuItem[] {
    return LANGUAGES.map((language: LanguageId) =>
      action(
        `ai-${dub ? "dub" : "translate"}-${language}`,
        t(`audio.lang.${language}`),
        () => {
          void ai.translateClip(clipId, language, dub);
        },
        { icon: LanguageIcon, ai: true },
      ),
    );
  }

  function clipAiItems(found: LocatedClip, ids: string[]): MenuItem[] {
    const { clip, asset } = found;
    const items: MenuItem[] = [];

    if (isTextClip(clip)) {
      const textIds = ids.filter((id) => {
        const target = findClipInDoc(project.doc, id);
        return target !== null && isTextClip(target);
      });
      const speakable = textIds.some((id) => {
        const target = findClipInDoc(project.doc, id);
        return target !== null && (target.text ?? "").trim() !== "";
      });
      items.push(
        action(
          "ai-voiceover",
          t("ai.voiceover"),
          () => void ai.voiceover(textIds.length > 0 ? textIds : [clip.id]),
          { icon: MicrophoneIcon, ai: true, disabled: !speakable },
        ),
      );
      items.push(
        action(
          "ai-text-video",
          t("menu.textToVideo"),
          () =>
            ai.openVideoGeneration({
              at: clip.start,
              prompt: (clip.text ?? "").trim(),
            }),
          { icon: FilmIcon, ai: true, disabled: !(clip.text ?? "").trim() },
        ),
      );
      return items;
    }

    const audio = isAudioCapable(clip, asset);
    const visual = isVisualClip(clip, asset);

    if (audio) {
      items.push(
        action("ai-transcribe", t("ai.subtitles"), () => void ai.transcribeClip(clip.id), {
          icon: DocumentTextIcon,
          ai: true,
        }),
      );
      items.push(
        action("ai-cut-filler", t("audio.cutFillers"), () => void ai.cutFiller(clip.id), {
          icon: ScissorsIcon,
          ai: true,
        }),
      );
      items.push(
        submenu("ai-translate", t("menu.translate"), languageItems(clip.id, false), {
          icon: LanguageIcon,
          ai: true,
        }),
      );
      items.push(
        submenu("ai-dub", t("menu.dub"), languageItems(clip.id, true), {
          icon: MicrophoneIcon,
          ai: true,
        }),
      );
      items.push(menuSeparator());
      items.push(
        action("ai-separate", t("audio.separate"), () => void ai.separateClip(clip.id), {
          icon: MusicalNoteIcon,
          ai: true,
        }),
      );
      items.push(
        action("ai-denoise", t("audio.aiDenoise"), () => void ai.denoiseClip(clip.id), {
          icon: SpeakerWaveIcon,
          ai: true,
        }),
      );

      // 变声：只带同选区内真正有音轨的片段（图片 / 文字跳过）。
      const voiceIds = ids.filter((id) => {
        const target = findClipInDoc(project.doc, id);
        if (!target || target.assetId === "") return false;
        const asset = project.doc.assets.find((candidate) => candidate.id === target.assetId);
        return Boolean(asset && (asset.kind === "audio" || asset.kind === "video"));
      });
      items.push(
        action(
          "ai-voice-change",
          t("ai.voiceChange"),
          () => void ai.openVoiceChange(voiceIds.length > 0 ? voiceIds : [clip.id]),
          { icon: MicrophoneIcon, ai: true },
        ),
      );
      items.push(
        action(
          "ai-save-voice",
          t("ai.voiceSave"),
          () => void ai.openVoiceChange([clip.id], clip.id),
          { icon: MicrophoneIcon, ai: true },
        ),
      );
      items.push(
        submenu(
          "ai-beautify",
          t("audio.beautify"),
          BEAUTIFY_PRESETS.map((preset) =>
            action(
              `ai-beautify-${preset}`,
              t(`audio.beautify.${preset}`),
              () => ai.beautifyClip(clip.id, preset),
              { icon: SparklesIcon, ai: true },
            ),
          ),
          { icon: ChartBarIcon, ai: true },
        ),
      );
      items.push(
        action(
          "ai-loudness",
          t("menu.loudnessTarget"),
          () => ai.normalizeLoudness(clip.id),
          { icon: ArrowsRightLeftIcon, ai: true },
        ),
      );
    }

    if (visual && asset?.kind === "video") {
      if (audio) items.push(menuSeparator());
      items.push(
        submenu(
          "ai-enhance",
          t("menu.enhance"),
          [
            action("ai-upscale-2", t("menu.upscale2"), () => void ai.upscaleClip(clip.id, 2), {
              icon: ArrowsPointingOutIcon,
              ai: true,
            }),
            action("ai-upscale-4", t("menu.upscale4"), () => void ai.upscaleClip(clip.id, 4), {
              icon: ArrowsPointingOutIcon,
              ai: true,
            }),
            menuSeparator(),
            action(
              "ai-interpolate-2",
              t("menu.interpolate2"),
              () => void ai.interpolateClip(clip.id, 2),
              { icon: FilmIcon, ai: true },
            ),
            action(
              "ai-interpolate-4",
              t("menu.interpolate4"),
              () => void ai.interpolateClip(clip.id, 4),
              { icon: FilmIcon, ai: true },
            ),
            menuSeparator(),
            action(
              "ai-reframe-face",
              t("menu.reframeFace"),
              () => void ai.reframeClip(clip.id, "face"),
              { icon: FaceSmileIcon, ai: true },
            ),
            action(
              "ai-reframe-person",
              t("menu.reframePerson"),
              () => void ai.reframeClip(clip.id, "person"),
              { icon: UserIcon, ai: true },
            ),
          ],
          { icon: ArrowsPointingOutIcon, ai: true },
        ),
      );
    }

    if (visual && asset?.kind === "image") {
      items.push(
        action("ai-image-upscale-2", t("menu.upscale2"), () => void ai.upscaleClip(clip.id, 2), {
          icon: ArrowsPointingOutIcon,
          ai: true,
        }),
        action("ai-image-upscale-4", t("menu.upscale4"), () => void ai.upscaleClip(clip.id, 4), {
          icon: ArrowsPointingOutIcon,
          ai: true,
        }),
        menuSeparator(),
        action(
          "ai-image-edit",
          t("menu.imageEdit"),
          () =>
            ai.openImageGeneration({
              at: clip.start,
              mode: "edit",
              sourceAssetId: clip.assetId,
            }),
          { icon: PhotoIcon, ai: true },
        ),
        action(
          "ai-image-video",
          t("menu.imageToVideo"),
          () => ai.openVideoGeneration({ at: clip.start, imageAssetId: clip.assetId }),
          { icon: FilmIcon, ai: true },
        ),
      );
    }

    return items;
  }

  // -------------------------------------------------------------------------
  // 片段常用编辑
  // -------------------------------------------------------------------------

  function audioMenu(found: LocatedClip, ids: string[]): MenuItem[] {
    const { clip, asset } = found;
    const muted = ids.every((id) => findClipInDoc(project.doc, id)?.muted === true);
    const items: MenuItem[] = [
      action(
        "clip-mute",
        muted ? t("menu.unmute") : t("menu.mute"),
        () =>
          applyToIds(ids, muted ? t("menu.unmute") : t("menu.mute"), (doc, id) =>
            setClipMuted(doc, id, !muted),
          ),
        { icon: muted ? SpeakerWaveIcon : SpeakerXMarkIcon, checked: muted },
      ),
    ];

    if (ids.length === 1 && asset?.kind === "video" && asset.hasAudio !== false && !clip.audioOnly) {
      items.push(
        action(
          "clip-extract-audio",
          t("inspector.extractAudio"),
          () => {
            const holder: { ids: string[] } = { ids: [] };
            project.dispatch(
              (doc) => {
                const current = findClipInDoc(doc, clip.id);
                if (!current) return doc;
                // 复用检查器同一套纯函数：画面静音、声音落到下面新轨。
                const result = extractClipAudio(
                  doc,
                  current,
                  t("inspector.extractAudioTrack"),
                );
                holder.ids = result.clipId ? [result.clipId] : [];
                return result.doc;
              },
              { kind: "ui.dispatch", actor: "human", label: t("inspector.extractAudio") },
            );
            if (holder.ids.length > 0) selection.selectMany(holder.ids);
            toast(t("inspector.extractAudioDone"));
          },
          { icon: MusicalNoteIcon },
        ),
      );
    }

    items.push(menuSeparator());
    items.push(
      submenu("clip-gain", t("menu.volume"), [
        action("clip-gain-up", t("menu.gainUp"), () => adjustGain(ids, 3), {
          icon: SpeakerWaveIcon,
        }),
        action("clip-gain-down", t("menu.gainDown"), () => adjustGain(ids, -3), {
          icon: SpeakerWaveIcon,
        }),
        action("clip-gain-reset", t("menu.gainReset"), () => resetGain(ids), {
          icon: SpeakerWaveIcon,
        }),
      ], { icon: SpeakerWaveIcon }),
    );
    items.push(
      submenu(
        "clip-fade-in",
        t("menu.fadeIn"),
        FADE_STEPS.map((seconds) =>
          action(
            `clip-fade-in-${seconds}`,
            t("menu.seconds", { value: seconds }),
            () => applyToIds(ids, t("menu.fadeIn"), (doc, id) => setClipFadeIn(doc, id, seconds)),
            { icon: ArrowTrendingUpIcon },
          ),
        ),
        { icon: ArrowPathIcon },
      ),
    );
    items.push(
      submenu(
        "clip-fade-out",
        t("menu.fadeOut"),
        FADE_STEPS.map((seconds) =>
          action(
            `clip-fade-out-${seconds}`,
            t("menu.seconds", { value: seconds }),
            () => applyToIds(ids, t("menu.fadeOut"), (doc, id) => setClipFadeOut(doc, id, seconds)),
            { icon: ArrowTrendingDownIcon },
          ),
        ),
        { icon: ArrowPathIcon },
      ),
    );
    items.push(
      submenu(
        "clip-speed",
        t("menu.speed"),
        SPEED_STEPS.map((speed) =>
          action(
            `clip-speed-${speed}`,
            `${speed}×`,
            () =>
              applyToIds(ids, t("menu.speedValue", { value: speed }), (doc, id) =>
                setClipSpeed(doc, id, speed),
              ),
            { icon: ClockIcon },
          ),
        ),
        { icon: ClockIcon },
      ),
    );
    return items;
  }

  function adjustGain(ids: string[], delta: number): void {
    applyToIds(ids, delta > 0 ? t("menu.gainUp") : t("menu.gainDown"), (doc, id) => {
      const clip = findClipInDoc(doc, id);
      return clip ? setClipGain(doc, id, (clip.gain ?? 0) + delta) : doc;
    });
  }

  function resetGain(ids: string[]): void {
    applyToIds(ids, t("menu.gainReset"), (doc, id) => setClipGain(doc, id, 0));
  }

  function visualMenu(found: LocatedClip, ids: string[]): MenuItem[] {
    const { clip, asset } = found;
    const items: MenuItem[] = [
      action("clip-keyframe", t("timeline.addKeyframeLabel"), () => actions.addKeyframeAtPlayhead(), {
        disabled: !actions.canAddKeyframe,
        icon: CursorArrowRaysIcon,
      }),
      menuSeparator(),
      action(
        "clip-reset-transform",
        t("menu.resetTransform"),
        () => {
          applyToIds(ids, t("menu.resetTransform"), (doc, id) =>
            setClipTransform(doc, id, { x: 0, y: 0, scale: 1, rotation: 0 }),
          );
        },
        { icon: ArrowsPointingOutIcon },
      ),
      action(
        "clip-reset-color",
        t("menu.resetColor"),
        () => {
          applyToIds(ids, t("menu.resetColor"), (doc, id) =>
            setClipColor(doc, id, {
              brightness: 0,
              contrast: 1,
              saturation: 1,
              temperature: 0,
              tint: 0,
            }),
          );
        },
        { icon: ChartBarIcon },
      ),
    ];

    // 无模型 DSP：稳定 / 降噪 / 去闪烁 / 运动模糊，仍属于「画面」而不是 AI 模型。
    if (asset?.kind === "video" && !clip.audioOnly) {
      items.push(
        menuSeparator(),
        submenu(
          "clip-video-fx",
          t("menu.videoProcess"),
          [
            action(
              "fx-stabilize",
              t("menu.stabilize"),
              () => ai.processVideoClip(clip.id, { stabilize: "medium" }, t("menu.stabilize")),
              { icon: ArrowsPointingInIcon },
            ),
            action(
              "fx-video-denoise",
              t("menu.videoDenoise"),
              () => ai.processVideoClip(clip.id, { denoise: "medium" }, t("menu.videoDenoise")),
              { icon: SparklesIcon },
            ),
            action(
              "fx-deflicker",
              t("menu.deflicker"),
              () => ai.processVideoClip(clip.id, { deflicker: "medium" }, t("menu.deflicker")),
              { icon: BoltIcon },
            ),
            action(
              "fx-motion-blur",
              t("menu.motionBlur"),
              () => ai.processVideoClip(clip.id, { motionBlur: 0.6 }, t("menu.motionBlur")),
              { icon: ArrowPathIcon },
            ),
          ],
          { icon: AdjustmentsHorizontalIcon },
        ),
      );
    }

    return items;
  }

  function textMenu(found: LocatedClip): MenuItem[] {
    const { clip } = found;
    return [
      action(
        "clip-copy-text",
        t("menu.copyText"),
        () => {
          void copyText(clip.text ?? "").then((ok) => {
            toast(ok ? t("menu.textCopied") : t("ai.copyFailed"), ok ? "info" : "error");
          });
        },
        { icon: ClipboardDocumentIcon, disabled: !(clip.text ?? "").trim() },
      ),
      action(
        "clip-edit-text",
        t("menu.editInInspector"),
        () => {
          selection.select(clip.id);
          layout.openTab("inspector");
        },
        { icon: DocumentTextIcon },
      ),
    ];
  }

  function attributesMenu(found: LocatedClip, ids: string[]): MenuItem[] {
    const clipboard = attributes.clipboard;
    return [
      action(
        "clip-copy-attributes",
        t("inspector.copyAttributes"),
        () => {
          attributes.copy(found.clip);
          toast(t("inspector.attributesCopied"));
        },
        { icon: DocumentDuplicateIcon },
      ),
      action(
        "clip-paste-attributes",
        t("inspector.pasteAttributes"),
        () => {
          const attrs = attributes.clipboard;
          if (!attrs) return;
          applyToIds(ids, t("inspector.pasteAttributes"), (doc, id) =>
            applyClipAttributes(doc, id, attrs),
          );
          toast(t("inspector.attributesPasted"));
        },
        { icon: ClipboardDocumentIcon, disabled: clipboard === null },
      ),
      action(
        "clip-reset-attributes",
        t("inspector.resetAttributes"),
        () => {
          applyToIds(ids, t("inspector.resetAttributes"), (doc, id) =>
            resetClipAttributes(doc, id),
          );
          toast(t("inspector.attributesReset"));
        },
        { icon: ArrowPathIcon },
      ),
    ];
  }

  function moreEditMenu(found: LocatedClip): MenuItem[] {
    const { clip, track } = found;
    return [
      action("clip-duplicate", t("timeline.duplicateLabel"), () => actions.duplicateSelected(), {
        icon: DocumentDuplicateIcon,
        keys: [MOD, "D"],
        disabled: !actions.canDuplicate,
      }),
      action("clip-split", t("timeline.splitLabel"), () => actions.splitAtPlayhead(), {
        icon: ScissorsIcon,
        keys: ["S"],
        disabled: !actions.canSplit,
      }),
      action("clip-trim-start", t("timeline.trimLeftLabel"), () => actions.trimToPlayhead("start"), {
        disabled: !actions.canTrim,
        icon: ArrowsRightLeftIcon,
      }),
      action("clip-trim-end", t("timeline.trimRightLabel"), () => actions.trimToPlayhead("end"), {
        disabled: !actions.canTrim,
        icon: ArrowsRightLeftIcon,
      }),
      menuSeparator(),
      action("clip-ripple-delete", t("timeline.rippleDeleteLabel"), () =>
        actions.rippleDeleteSelected(),
      {
        icon: RippleDeleteIcon,
        keys: ["Shift", "Delete"],
        danger: true,
      }),
      action(
        "clip-select-track",
        t("menu.selectTrackClips"),
        () => {
          selection.setActiveTrack(track.id);
          selection.selectMany(track.clips.map((item) => item.id));
        },
        { icon: QueueListIcon },
      ),
      action(
        "clip-locate",
        t("menu.locate"),
        () => playback.setPlayhead(clip.start),
        { icon: MapPinIcon },
      ),
    ];
  }

  function buildClipMenu(found: LocatedClip): MenuItem[] {
    const { clip, asset } = found;
    const ids = selection.selectedClipIds.includes(clip.id)
      ? [...selection.selectedClipIds]
      : [clip.id];
    const count = ids.length;
    const audio = isAudioCapable(clip, asset);
    const visual = isVisualClip(clip, asset);
    const text = isTextClip(clip);
    const items: MenuItem[] = [];

    const aiItems = clipAiItems(found, ids);
    if (aiItems.length > 0) {
      items.push(
        submenu("clip-ai", t("menu.ai"), aiItems, {
          icon: SparklesIcon,
          ai: true,
          badge: t("menu.aiBadge"),
          ...(count > 1 ? { hint: t("menu.aiPrimaryOnly") } : {}),
        }),
      );
      items.push(menuSeparator());
    }

    items.push(
      action("clip-copy", withCount(t("timeline.copy"), count), () => actions.copySelected(), {
        icon: DocumentDuplicateIcon,
        keys: [MOD, "C"],
        disabled: !actions.canDelete,
      }),
      action("clip-cut", withCount(t("timeline.cut"), count), () => actions.cutSelected(), {
        icon: ScissorsIcon,
        keys: [MOD, "X"],
        disabled: !actions.canDelete,
      }),
      action("clip-paste", t("timeline.paste"), () => actions.pasteClipboard(), {
        icon: ClipboardDocumentIcon,
        keys: [MOD, "V"],
        disabled: !actions.canPaste,
      }),
      action(
        "clip-delete",
        withCount(t("timeline.deleteLabel"), count),
        () => actions.deleteSelected(),
        { icon: TrashIcon, keys: ["Delete"], danger: true, disabled: !actions.canDelete },
      ),
      menuSeparator(),
      submenu("clip-more", t("menu.moreEdit"), moreEditMenu(found), { icon: ScissorsIcon }),
    );

    if (audio) items.push(submenu("clip-audio", t("menu.audio"), audioMenu(found, ids), { icon: SpeakerWaveIcon }));
    if (visual) items.push(submenu("clip-visual", t("menu.visual"), visualMenu(found, ids), { icon: FilmIcon }));
    if (text) items.push(submenu("clip-text", t("menu.text"), textMenu(found), { icon: DocumentTextIcon }));

    items.push(
      submenu("clip-attributes", t("menu.attributes"), attributesMenu(found, ids), {
        icon: AdjustmentsHorizontalIcon,
      }),
      menuSeparator(),
      action("clip-open-inspector", t("menu.editInInspector"), () => {
        selection.select(clip.id);
        layout.openTab("inspector");
      }, { icon: ChartBarIcon }),
    );

    return items;
  }

  // -------------------------------------------------------------------------
  // 空白区域 / 标尺
  // -------------------------------------------------------------------------

  function generationItems(time: number): MenuItem[] {
    const image = selectedClips().find((clip) => {
      const asset = assetOf(clip);
      return asset?.kind === "image" && !clip.audioOnly;
    });
    return [
      action(
        "gen-video",
        t("menu.genVideo"),
        () => ai.openVideoGeneration({ at: time }),
        { icon: FilmIcon, ai: true },
      ),
      action(
        "gen-video-image",
        t("menu.genVideoFromImage"),
        () =>
          ai.openVideoGeneration({
            at: time,
            ...(image ? { imageAssetId: image.assetId } : {}),
          }),
        { icon: PhotoIcon, ai: true },
      ),
      action(
        "gen-image",
        t("menu.genImage"),
        () => ai.openImageGeneration({ at: time, mode: "draw" }),
        { icon: PhotoIcon, ai: true },
      ),
      action(
        "gen-image-edit",
        t("menu.genEditImage"),
        () =>
          ai.openImageGeneration({
            at: time,
            mode: "edit",
            ...(image ? { sourceAssetId: image.assetId } : {}),
          }),
        { icon: SparklesIcon, ai: true },
      ),
    ];
  }

  function addMarkerAt(time: number): void {
    const at = Math.max(0, snapToFrame(time, project.doc.fps));
    project.dispatch(
      (doc) =>
        addMarker(
          doc,
          createMarker({
            time: at,
            name: t("marker.defaultName", { n: doc.markers.length + 1 }),
          }),
        ),
      { kind: "marker.add", payload: { time: at }, label: t("marker.addLabel") },
    );
  }

  function trackMenu(track: Track): MenuItem[] {
    const items: MenuItem[] = [
      action(
        "track-mute",
        track.muted ? t("menu.trackUnmute") : t("menu.trackMute"),
        () => project.dispatch((doc) => setTrackFlag(doc, track.id, "muted", !track.muted)),
        { icon: track.muted ? SpeakerWaveIcon : SpeakerXMarkIcon, checked: track.muted },
      ),
      action(
        "track-visible",
        track.visible ? t("menu.trackHide") : t("menu.trackShow"),
        () => project.dispatch((doc) => setTrackFlag(doc, track.id, "visible", !track.visible)),
        { icon: track.visible ? EyeSlashIcon : EyeIcon, checked: !track.visible },
      ),
      action(
        "track-lock",
        track.locked ? t("menu.trackUnlock") : t("menu.trackLock"),
        () => project.dispatch((doc) => setTrackFlag(doc, track.id, "locked", !track.locked)),
        { icon: track.locked ? LockOpenIcon : LockClosedIcon, checked: track.locked },
      ),
      menuSeparator(),
      action(
        "track-select-clips",
        t("menu.selectTrackClips"),
        () => {
          selection.setActiveTrack(track.id);
          selection.selectMany(track.clips.map((clip) => clip.id));
        },
        { icon: QueueListIcon, disabled: track.clips.length === 0 },
      ),
      action(
        "track-remove",
        t("menu.removeTrack"),
        () => void removeTrackWithConfirm(track),
        { icon: TrashIcon, danger: true },
      ),
    ];
    return items;
  }

  async function removeTrackWithConfirm(track: Track): Promise<void> {
    if (track.clips.length > 0) {
      const index = project.doc.tracks.findIndex((candidate) => candidate.id === track.id);
      const ok = await confirm({
        title: t("timeline.confirmDeleteTrack"),
        message: t("timeline.confirmDeleteTrackMessage", {
          n: index + 1,
          count: track.clips.length,
        }),
        confirmText: t("confirm.delete"),
        cancelText: t("confirm.cancel"),
        destructive: true,
      });
      if (!ok) return;
    }
    project.dispatch((doc) => removeTrack(doc, track.id));
    selection.clear();
  }

  function buildLaneMenu(
    trackId: string | null,
    index: number,
    time: number,
  ): MenuItem[] {
    const track = trackId
      ? (project.doc.tracks.find((candidate) => candidate.id === trackId) ?? null)
      : null;
    const items: MenuItem[] = [
      submenu("lane-ai", t("menu.aiGenerate"), generationItems(time), {
        icon: SparklesIcon,
        ai: true,
        badge: t("menu.aiBadge"),
      }),
      menuSeparator(),
      action("lane-paste", t("menu.pasteHere"), () => {
        playback.setPlayhead(time);
        actions.pasteClipboard();
      }, { icon: ClipboardDocumentIcon, disabled: !actions.canPaste }),
      action("lane-text", t("menu.addTextHere"), () => insert.addTextAt(time), {
        icon: DocumentTextIcon,
      }),
      action("lane-marker", t("menu.addMarkerHere"), () => addMarkerAt(time), {
        icon: FlagIcon,
      }),
      menuSeparator(),
    ];

    if (track) {
      items.push(submenu("lane-track", t("menu.track"), trackMenu(track), { icon: QueueListIcon }));
    }

    items.push(
      action(
        "lane-new-track",
        track ? t("menu.newTrackBelow") : t("menu.newTrack"),
        () => project.dispatch((doc) => addTrackAt(doc, index)),
        { icon: PlusIcon },
      ),
      menuSeparator(),
      action("lane-seek", t("menu.seekHere"), () => playback.setPlayhead(time), {
        icon: MapPinIcon,
      }),
    );
    return items;
  }

  function buildRulerMenu(time: number): MenuItem[] {
    const at = Math.max(0, snapToFrame(time, project.doc.fps));
    const splittable = project.doc.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => at > clip.start && at < clip.start + clip.duration)
      .map((clip) => clip.id);

    return [
      submenu("ruler-ai", t("menu.aiGenerate"), generationItems(time), {
        icon: SparklesIcon,
        ai: true,
        badge: t("menu.aiBadge"),
      }),
      menuSeparator(),
      action("ruler-seek", t("menu.seekHere"), () => playback.setPlayhead(at), {
        icon: MapPinIcon,
      }),
      action(
        "ruler-split",
        t("menu.splitHere"),
        () => {
          if (splittable.length === 0) return;
          project.dispatch((doc) => splitClips(doc, splittable, at));
        },
        { icon: ScissorsIcon, keys: ["S"], disabled: splittable.length === 0 },
      ),
      action("ruler-marker", t("menu.addMarkerHere"), () => addMarkerAt(at), {
        icon: FlagIcon,
      }),
    ];
  }

  /** 标记：定位 / 编辑（宿主打开对话框）/ 删除。 */
  function buildMarkerMenu(markerId: string): MenuItem[] {
    const marker = project.doc.markers.find((item) => item.id === markerId);
    if (!marker) return [];
    return [
      action(
        "marker-seek",
        t("menu.goToMarker"),
        () => playback.setPlayhead(marker.time),
        { icon: MapPinIcon },
      ),
      action("marker-edit", t("marker.editLabel"), () => host.editMarker?.(marker), {
        icon: FlagIcon,
        disabled: !host.editMarker,
      }),
      menuSeparator(),
      action("marker-delete", t("marker.deleteLabel"), () => void host.removeMarker?.(marker), {
        icon: TrashIcon,
        danger: true,
        disabled: !host.removeMarker,
      }),
    ];
  }

  /** 轨道头：复用空白区域的轨道操作，再补一条「在下方新建轨道」。 */
  function buildTrackHeaderMenu(trackId: string): MenuItem[] {
    const track = project.doc.tracks.find((item) => item.id === trackId);
    if (!track) return [];
    const index = project.doc.tracks.findIndex((item) => item.id === trackId);
    return [
      ...trackMenu(track),
      menuSeparator(),
      action(
        "track-new-below",
        t("menu.newTrackBelow"),
        () => project.dispatch((doc) => addTrackAt(doc, index + 1)),
        { icon: PlusIcon },
      ),
    ];
  }

  function build(target: TimelineMenuTarget): MenuItem[] {
    if (target.kind === "clip") {
      const found = locateClip(target.clipId);
      return found ? buildClipMenu(found) : [];
    }
    if (target.kind === "lane") {
      return buildLaneMenu(target.trackId, target.index, target.time);
    }
    if (target.kind === "marker") return buildMarkerMenu(target.markerId);
    if (target.kind === "track") return buildTrackHeaderMenu(target.trackId);
    return buildRulerMenu(target.time);
  }

  return { build };
}

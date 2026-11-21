"use strict";
var AICUT = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/domain/host.ts
  var host_exports = {};
  __export(host_exports, {
    apply: () => apply,
    blank: () => blank,
    currentRevision: () => currentRevision,
    historyDepth: () => historyDepth,
    load: () => load,
    op: () => op,
    redo: () => redo,
    setLocale: () => setLocale,
    snapshot: () => snapshot,
    undo: () => undo,
    view: () => view
  });

  // src/types/board.ts
  var BOARD_VERSION = 1;
  var DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };

  // src/core/board/dataTypes.ts
  var COLORS = {
    text: "#8b93f8",
    image: "#c084fc",
    video: "#fb7185",
    audio: "#f59e0b",
    integer: "#60a5fa",
    number: "#38bdf8",
    boolean: "#34d399",
    json: "#a3e635",
    any: "#94a3b8"
  };
  function spec(id, label, channels, extra = {}) {
    return { id, label, channels, ...extra };
  }
  var CORE_DATA_TYPES = [
    spec("text", "Text", ["inline", "blob"], {
      mime: "text/*",
      inline: "text",
      color: COLORS.text
    }),
    spec("image", "Image", ["blob", "stream"], { mime: "image/*", color: COLORS.image }),
    spec("video", "Video", ["blob", "stream"], { mime: "video/*", color: COLORS.video }),
    spec("audio", "Audio", ["blob", "stream"], { mime: "audio/*", color: COLORS.audio }),
    // 整数与浮点分开：编辑器精度、运行时解析都不同；连线上互相兼容，避免用错类型接不上。
    spec("integer", "Integer", ["inline"], {
      inline: "number",
      color: COLORS.integer,
      accepts: ["number"]
    }),
    spec("number", "Float", ["inline"], {
      inline: "number",
      color: COLORS.number,
      accepts: ["integer"]
    }),
    spec("boolean", "Boolean", ["inline"], { inline: "boolean", color: COLORS.boolean }),
    spec("json", "JSON", ["inline", "blob"], {
      mime: "application/json",
      inline: "json",
      color: COLORS.json
    }),
    spec("any", "Any", ["inline", "blob", "stream"], { color: COLORS.any })
  ];
  var REGISTRY = /* @__PURE__ */ new Map();
  for (const item of CORE_DATA_TYPES) {
    REGISTRY.set(item.id, { spec: item, owner: "core" });
  }
  var ID_PATTERN = /^[a-z][a-z0-9_.-]{0,47}$/i;
  function isDataTypeId(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
  }

  // src/i18n/en.ts
  var en = {
    // ---- Common ----
    "common.ok": "OK",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.close": "Close",
    "common.none": "None",
    "common.add": "Add",
    "common.remove": "Remove",
    "common.rename": "Rename",
    "common.search": "Search",
    "common.all": "All",
    "common.loading": "Loading\u2026",
    "app.restoring": "Restoring your last project\u2026",
    "common.confirm": "OK",
    "common.back": "Back",
    "common.more": "More actions",
    "common.listSeparator": ", ",
    "value.decrease": "Decrease {name}",
    "value.increase": "Increase {name}",
    "value.none": "value",
    // ---- Project ----
    "project.untitled": "Untitled project",
    "project.current": "Current project",
    "project.fileFilter": "AI Cut project",
    "project.resolution": "{width} \xD7 {height}",
    // ---- Project dialog ----
    "projectDialog.renameTitle": "Rename project",
    "projectDialog.nameLabel": "Project name",
    "projectDialog.confirm": "Save",
    "projectDialog.placeholder": "Untitled project",
    "projectDialog.saveTitle": "Save project",
    "projectDialog.saveHint": "Choose where to save the project next.",
    "projectDialog.confirmSave": "Continue",
    // ---- Top bar ----
    "topbar.history": "Project history",
    "topbar.historyLabel": "Project history",
    "topbar.new": "New project",
    "topbar.newLabel": "New project",
    "topbar.open": "Open project\u2026",
    "topbar.openLabel": "Open project",
    "topbar.save": "Save",
    "topbar.saveLabel": "Save project",
    "topbar.export": "Export video",
    "topbar.exportLabel": "Export video",
    "topbar.settings": "Settings",
    "topbar.backToWorkspace": "Back to workspace",
    "topbar.github": "GitHub repository",
    "topbar.githubLabel": "Open GitHub repository",
    "topbar.rename": "Rename project",
    "topbar.renameLabel": "Rename project",
    "topbar.unsaved": "Unsaved changes",
    "topbar.hidePanel": "Hide sidebar",
    "topbar.showPanel": "Show sidebar",
    "topbar.resolution": "{width}\xD7{height} \xB7 {fps}fps",
    "topbar.shortcuts": "Keyboard shortcuts",
    "topbar.layout": "Layout",
    "topbar.layout.landscape": "Landscape",
    "topbar.layout.landscapeHint": "Preview on top, timeline below",
    "topbar.layout.portrait": "Portrait",
    "topbar.layout.portraitHint": "Preview left; tabs above the timeline",
    "topbar.aiEdit": "AI edit",
    "topbar.aiEditHint": "Open the agent and change the timeline in one sentence",
    "topbar.menu.file": "File",
    "topbar.menu.help": "Help",
    "topbar.menu.new": "New project",
    "topbar.menu.open": "Open project\u2026",
    "topbar.menu.import": "Import media\u2026",
    "topbar.menu.history": "Project history",
    "topbar.menu.workflowGroup": "Workflow",
    "topbar.menu.workflowSave": "Save workflow to library",
    "topbar.menu.workflowLibrary": "Open the workflow library",
    "topbar.menu.workflowExport": "Export workflow\u2026",
    "topbar.menu.workflowImport": "Import workflow\u2026",
    "topbar.menu.saveGroup": "Save & export",
    "topbar.menu.save": "Save",
    "topbar.menu.saveAs": "Save as\u2026",
    "topbar.menu.export": "Export video\u2026",
    "topbar.menu.quickStart": "Quick start",
    "topbar.menu.shortcuts": "Keyboard shortcuts",
    "topbar.menu.github": "GitHub repository",
    // ---- Welcome & onboarding ----
    "onboarding.heroNote": "Media and projects stay on your computer. AI models download on demand, and offline editing always works.",
    "onboarding.eyebrow": "AI video editing \xB7 local first",
    "onboarding.title": "Start with one clip, let AI handle the rest",
    "onboarding.subtitle": "Import video, images or audio, then drag it onto the timeline. Subtitles, voiceover, generation and the agent all live in the right panel.",
    "onboarding.eyebrowBack": "Welcome back",
    "onboarding.titleBack": "Pick up where you left off",
    "onboarding.subBack": "Your timeline, media and undo history are still here. Or start somewhere new below.",
    "onboarding.startResume": "Open the last project",
    "onboarding.startResumeHint": "Pick up \u201C{name}\u201D \u2014 media and timeline are ready",
    "onboarding.startBlank": "Open a blank project",
    "onboarding.startBlankHint": "Start from an empty timeline and build it yourself",
    "onboarding.startImport": "Import media and start",
    "onboarding.startImportHint": "Video, images and audio; drag them in",
    "onboarding.startAi": "Let AI edit for me",
    "onboarding.startAiHint": "Open the agent and describe the change",
    "onboarding.startHistory": "Project history",
    "onboarding.startHistoryHint": "Pick a version from project history",
    "onboarding.startOpen": "Open a project file",
    "onboarding.startOpenHint": "Open a previously saved AI Cut project",
    "onboarding.recommended": "Recommended",
    "onboarding.projectNote": "Current project: {name}",
    "onboarding.later": "Just look around",
    "onboarding.skip": "Close welcome",
    "onboarding.tourCta": "60-second tour",
    "onboarding.tour.title": "Quick start",
    "onboarding.tour.counter": "Step {n} of {total}",
    "onboarding.tour.skip": "End tour",
    "onboarding.tour.prev": "Back",
    "onboarding.tour.next": "Next",
    "onboarding.tour.done": "Start editing",
    "onboarding.tour.previewTitle": "This is the preview",
    "onboarding.tour.previewBody": "The picture updates with your selection. Space plays / pauses, \u2190 / \u2192 steps frame by frame.",
    "onboarding.tour.panelsTitle": "The right panel",
    "onboarding.tour.panelsBody": "Media, inspector, AI and models live here. Use \u201C+\u201D in the title bar for more; drag the left edge to resize.",
    "onboarding.tour.timelineTitle": "The timeline is your cutting table",
    "onboarding.tour.timelineBody": "Drag media in, move clips, drag an edge to trim; right-click for AI actions.",
    "onboarding.tour.aiTitle": "AI edit",
    "onboarding.tour.aiBody": "One click opens the agent: subtitles, voiceover and generated visuals all start with a sentence.",
    "onboarding.tour.fileTitle": "File and export",
    "onboarding.tour.fileBody": "New, open, history, save and export are all here, with shortcuts on the right.",
    "onboarding.tour.settingsTitle": "Settings",
    "onboarding.tour.settingsBody": "Switch theme and language, manage models, storage and the AI backend.",
    // ---- Shortcuts ----
    "shortcuts.title": "Keyboard shortcuts",
    "shortcuts.group.playback": "Playback",
    "shortcuts.group.edit": "Editing",
    "shortcuts.group.project": "Project",
    "shortcuts.group.view": "View",
    "shortcuts.playPause": "Play / pause",
    "shortcuts.prevFrame": "Previous frame",
    "shortcuts.nextFrame": "Next frame",
    "shortcuts.undo": "Undo",
    "shortcuts.redo": "Redo",
    "shortcuts.copy": "Copy clips",
    "shortcuts.cut": "Cut clips",
    "shortcuts.paste": "Paste clips",
    "shortcuts.split": "Split at playhead",
    "shortcuts.delete": "Delete selected clips",
    "shortcuts.new": "New project",
    "shortcuts.open": "Open project",
    "shortcuts.save": "Save project",
    "shortcuts.saveAs": "Save as",
    "shortcuts.togglePanel": "Show / hide right panel",
    "shortcuts.settings": "Open / close settings",
    "shortcuts.zoom": "Zoom timeline",
    "shortcuts.deselect": "Clear selection",
    // ---- Panels ----
    "panel.media": "Media",
    "panel.mediaHint": "Clips, music and subtitle files",
    "panel.inspector": "Inspector",
    "panel.inspectorHint": "Transform, audio and compositing",
    "panel.ops": "Operation log",
    "panel.opsHint": "Every change by you, the built-in assistant and external AI",
    "panel.agent": "Clip agent",
    "panel.agentHint": "Chat-driven editing on the timeline",
    "panel.ai": "AI features",
    "panel.aiHint": "MCP, skills and AI capabilities",
    "panel.models": "Download manager",
    "panel.modelsHint": "Model and plugin downloads",
    "panel.plugins": "OFX plugins",
    "panel.pluginsHint": "Open installed OpenFX plugins",
    "panel.extensions": "App extensions",
    "panel.extensionsHint": "Third-party app extensions that add canvas nodes, commands and copy",
    "extensions.title": "App extensions",
    "extensions.subtitle": "Third-party app extensions that add canvas nodes, commands and copy",
    "extensions.empty": "No app extensions imported yet",
    "extensions.loading": "Loading app extensions\u2026",
    "extensions.install": "Import folder",
    "extensions.enable": "Enable",
    "extensions.reload": "Reload",
    "extensions.disable": "Disable",
    "extensions.incompatible": "Incompatible",
    "extensions.confirmRemove": "Remove app extension {name}? (the source folder on disk is kept)",
    "extensions.tabInstalled": "Installed",
    "extensions.tabDiscover": "Discover",
    "extensions.search": "Search app extensions",
    "extensions.refresh": "Refresh",
    "extensions.installFromMarket": "Install",
    "extensions.updateTo": "Update to {version}",
    "extensions.marketEmpty": "This index has no app extensions yet",
    "extensions.subInstalled": "{count} app extensions",
    "extensions.subDiscover": "{count} available",
    "extensions.marketSource": "Index URL",
    "extensions.marketOnline": "Index: online",
    "extensions.marketCached": "Index: cached",
    "extensions.marketStale": "Index: offline cache",
    "extensions.marketUnknown": "Index: not loaded",
    "extensions.marketSourceSettings": "Index settings",
    "extensions.marketUpdate": "Update available",
    "extensions.marketInstalled": "Installed",
    "extensions.enabled": "Enabled",
    "extensions.disabled": "Disabled",
    "extensions.kindStore": "Managed",
    "extensions.kindLinked": "Local folder",
    "panel.pluginEditor": "Parameters",
    "panel.pluginEditorHint": "Edit the selected OFX effect parameters",
    "panel.emptyTitle": "No panels open",
    "panel.emptySub": "Pick one below, or use \u201C+\u201D in the title bar",
    "panel.pickerTitle": "Panels",
    "panel.newTab": "New tab",
    "panel.closeTab": "Close {name}",
    "panel.opened": "Open",
    // ---- Media ----
    "media.title": "Media library",
    "media.sub": "{assets} clips \xB7 {texts} text",
    "media.search": "Search media",
    "media.filterGroup": "Media type",
    "media.filter.all": "All",
    "media.filter.video": "Video",
    "media.filter.audio": "Audio",
    "media.filter.image": "Image",
    "media.filter.text": "Text",
    "media.dragHint": "Drag to the timeline, or onto the canvas to create an input node",
    "media.import": "Import media",
    "media.importing": "Importing\u2026",
    "media.importMedia": "Import media",
    "media.importAndPlace": "Import & add to timeline",
    "media.empty": "No media yet. Import from the top right.",
    "media.noMatch": "No matching media",
    "media.offline": "Offline",
    "media.deleteNamed": "Delete media \u201C{name}\u201D",
    "media.confirmDelete": "Delete media?",
    "media.confirmDeleteMessage": "\u201C{name}\u201D will be removed from the library and {count} clip(s) using it will be deleted.",
    "media.confirmDeleteEmpty": "\u201C{name}\u201D will be removed from the library.",
    "media.deleted": "Deleted \u201C{name}\u201D",
    "media.confirmDeletePreset": "Delete text preset?",
    "media.confirmDeletePresetMessage": "\u201C{name}\u201D will be removed from the library. Existing clips are kept.",
    "media.presetDeleted": "Deleted preset \u201C{name}\u201D",
    "media.applyPresetNamed": "Apply \u201C{name}\u201D style to selected text",
    "media.applyPresetHint": "Apply to {count} selected text clip(s)",
    "media.applyPresetEmpty": "Select at least one text clip first",
    "media.applyPresetDone": "Applied to {count} text clip(s)",
    "media.imported": "Imported {count} items",
    "media.importedToTimeline": "Imported {count} item(s) and added them to the timeline",
    "media.importFailed": "Import failed: {error}",
    "media.textInfo": "Text \xB7 {seconds}s",
    "media.kind.audio": "Audio",
    "media.kind.image": "Image",
    "media.kind.video": "Video",
    "media.noAudioStream": "No audio stream",
    "media.fileFilter": "Media files",
    "media.collect": "Collect media",
    "media.collectConfirm": 'Copy {count} media files into the "-media" folder next to the project and point the project at the copies. Originals are kept.',
    "media.collectDone": "Collected {count} media files (remember to save the project)",
    "media.collectFailed": "Could not collect media: {message}",
    "media.collectNoProject": "Save the project before collecting media",
    "media.collectEmpty": "The project has no media yet",
    // ---- Text presets ----
    "textPreset.default.name": "Default text",
    "textPreset.default.text": "Default text",
    "textPreset.autoName": "Text style {n}",
    "textPreset.saved": "Saved preset \u201C{name}\u201D",
    "textPreset.saveTitle": "Save text preset",
    "textPreset.nameLabel": "Preset name",
    "textPreset.namePlaceholder": "e.g. Title style",
    "textPreset.save": "Save",
    // ---- Color ----
    "color.hex": "Hex color",
    "color.swatches": "Preset colors",
    // ---- Inspector ----
    "inspector.title": "Inspector",
    "inspector.multiSelected": "{count} clips selected; changes apply to all",
    "inspector.textSelected": "Selected: text clip",
    "inspector.mediaSelected": "Selected: media clip",
    "inspector.nothingSelected": "No clip selected",
    "inspector.emptyHint": "Select a clip on the timeline to edit its properties.",
    "inspector.textClip": "Text clip",
    "inspector.missingAsset": "Missing media",
    "inspector.offline": "Source file is missing",
    "inspector.relink": "Relink",
    "inspector.relinked": "Media relinked",
    "inspector.text": "Text",
    "inspector.transform": "Transform",
    "inspector.positionX": "Position X (%)",
    "inspector.positionY": "Position Y (%)",
    "inspector.scale": "Scale (%)",
    "inspector.rotation": "Rotation (\xB0)",
    "inspector.compositing": "Compositing",
    "inspector.timing": "Timing",
    "inspector.speed": "Speed",
    "inspector.duration": "Duration",
    "inspector.colorGrade": "Color",
    "inspector.brightness": "Brightness",
    "inspector.contrast": "Contrast",
    "inspector.saturation": "Saturation",
    "inspector.temperature": "Temperature",
    "inspector.tint": "Tint",
    "inspector.reset": "Reset",
    "effects.title": "Effects",
    "effects.add": "Add effect",
    "effects.probing": "Probing\u2026",
    "effects.manage": "Manage plugins",
    "effects.empty": "No effects on this clip. Add an installed OFX filter, generator, paint or retimer plugin to start.",
    "effects.loading": "Loading\u2026",
    "effects.unavailable": "Unavailable",
    "effects.notFound": "No OFX plugin found in this bundle",
    "effects.unsupportedContext": "This is a transition / paint / retimer OFX plugin; this version cannot mount it for preview yet",
    "effects.someUnsupported": "Skipped {count} transition / paint / retimer effect(s) that are not supported yet",
    "effects.choosePlugin": "Choose plugin",
    "effects.expand": "Expand parameters",
    "effects.enabled": "Effect enabled",
    "effects.toggle": "Toggle effect",
    "effects.remove": "Remove effect",
    "effects.mixed": "Mixed",
    "effects.openParams": "Edit parameters",
    "effects.moveUp": "Move up",
    "effects.moveDown": "Move down",
    "effects.reorder": "Reorder effects",
    "effects.rendering": "Rendering effects {pct}%",
    "effects.renderQueued": "Waiting to render effects\u2026",
    "effects.renderFailed": "Effect render failed: {error}",
    "effects.renderStalled": "Rendering timed out: the plugin stopped returning frames and was cancelled",
    "effects.prerender": "Pre-render",
    "effects.prerenderQueued": "Queued\u2026",
    "effects.prerenderReady": "Pre-rendered",
    "effects.prerenderRetry": "Retry pre-render",
    "effects.prerenderHint": "Pre-render the whole clip with the current effect chain so playback shows it too",
    "effects.paintHint": "Paint plugins render from parameters only; this host does not provide an interactive brush/overlay yet.",
    "effects.retimerHint": "Retimer plugins must be first in the effect chain because they choose the source time.",
    "effects.retimerOrder": "Retimer is not first in the chain; preview and export will fail. Move it to the top.",
    "inspector.keyframes": "Keyframes",
    "keyframe.time": "Time (s)",
    "keyframe.add": "Add keyframe at playhead",
    "keyframe.update": "Update this keyframe",
    "keyframe.empty": "No keyframes yet",
    "keyframe.seek": "Seek to keyframe",
    "keyframe.remove": "Delete keyframe",
    "inspector.transition": "Transition",
    "transition.in": "In",
    "transition.out": "Out",
    "transition.none": "None",
    "transition.fade": "Fade",
    "transition.slide": "Slide",
    "transition.duration": "Duration (s)",
    "transition.direction": "Direction",
    "transition.left": "From left",
    "transition.right": "From right",
    "transition.up": "From bottom",
    "transition.down": "From top",
    "transition.ofx": "OFX transition",
    "transition.ofxPlugin": "OFX plugin",
    "transition.ofxParams": "Transition parameters",
    "transition.noOfxPlugins": "No OFX transition plugin is installed",
    "inspector.opacity": "Opacity (%)",
    "inspector.audio": "Audio",
    "inspector.volume": "Volume (dB)",
    "inspector.fadeIn": "Fade in (s)",
    "inspector.fadeOut": "Fade out (s)",
    "inspector.pitch": "Pitch (semitones)",
    "inspector.pan": "Stereo balance (L/R)",
    "inspector.extractAudio": "Separate audio",
    "inspector.extractAudioHint": "Split the video picture and sound onto two tracks so the audio can be edited separately",
    "inspector.extractAudioTrack": "Extracted audio",
    "inspector.extractAudioDone": "Audio moved to a new track",
    // ---- Audio AI / DSP ----
    "audio.loudness": "Loudness match",
    "audio.loudnessTarget": "Target",
    "audio.loudnessHint": "Measure the clip and write a non-destructive gain",
    "audio.loudnessApply": "Match loudness",
    "audio.loudnessSelection": "Match selected ({count})",
    "audio.loudnessAll": "All audio",
    "audio.loudnessProgress": "Measuring {index} / {total}",
    "audio.loudnessBatchDone": "Matched loudness on {count} clips",
    "audio.loudnessBatchPartial": "Matched {count} clips; {skipped} had no usable audio",
    "audio.noTargets": "No audio clips to process",
    "audio.loudness.streaming": "-14 LUFS \xB7 Streaming",
    "audio.loudness.podcast": "-16 LUFS \xB7 Podcast",
    "audio.loudness.broadcast": "-23 LUFS \xB7 Broadcast",
    "audio.loudnessResult": "Measured {lufs} LUFS, applied {gain} dB",
    "audio.noSignal": "No usable audio detected",
    "audio.denoise": "Quick denoise",
    "audio.denoiseHint": "Model-free FFT denoise for hiss and room noise",
    "audio.denoise.light": "Light",
    "audio.denoise.medium": "Medium",
    "audio.denoise.strong": "Strong",
    "audio.denoiseDone": "Denoise complete",
    "audio.denoiseTrack": "Denoised",
    "audio.beautifyTrack": "Polished",
    "audio.aiDenoiseTrack": "AI denoise",
    "audio.muteClip": "Mute clip (keep video)",
    "audio.beautify": "Vocal polish",
    "audio.beautifyHint": "EQ + de-esser + gentle compression for speech",
    "audio.beautify.natural": "Natural",
    "audio.beautify.bright": "Bright",
    "audio.beautify.warm": "Warm",
    "audio.beautifyDone": "Vocal polish complete",
    "audio.strength": "Strength",
    "audio.preset": "Preset",
    "audio.apply": "Apply",
    "audio.processing": "Processing\u2026",
    "audio.cancel": "Cancel",
    "audio.cancelled": "Audio processing cancelled",
    "audio.selectClip": "Select a clip with audio on the timeline first",
    "audio.aiDenoise": "AI denoise",
    "audio.aiDenoiseHint": "LocalVQE speech denoise / dereverb; music may be suppressed",
    "audio.noDenoiseModel": "No denoise model available",
    "audio.downloadModel": "Download model \xB7 {size}",
    "audio.separate": "Dialogue isolation",
    "audio.separateHint": "UVR isolates speech from music/ambience; HTDemucs is for music stems",
    "audio.separateModel": "Isolation model",
    "audio.noSeparateModel": "No separation model available",
    "audio.stem.drums": "Drums",
    "audio.stem.bass": "Bass",
    "audio.stem.other": "Other",
    "audio.stem.vocals": "Vocals",
    "audio.stem.guitar": "Guitar",
    "audio.stem.piano": "Piano",
    "audio.stem.accompaniment": "Accompaniment",
    "audio.stemTrack": "Stems",
    "audio.separateDone": "Created {count} audio stems (source clip muted)",
    "audio.translate": "Audio translation",
    "audio.translateHint": "Speech \u2192 translation \u2192 subtitle track, optional dub",
    "audio.translateApply": "Translate & subtitle",
    "audio.targetLanguage": "Target language",
    "audio.lang.en": "English",
    "audio.lang.zh": "Simplified Chinese",
    "audio.lang.ja": "Japanese",
    "audio.lang.ko": "Korean",
    "audio.lang.es": "Spanish",
    "audio.lang.fr": "French",
    "audio.lang.de": "German",
    "audio.dub": "Also generate dub",
    "audio.dubModel": "Dub model",
    "audio.translateVoiceNote": "Dubbing uses the selected TTS model (local or cloud)",
    "audio.dubNoModel": "No dubbing model available \u2014 choose or configure one first",
    "audio.dubLocalNote": "Local dub \xB7 {name}",
    "audio.dubTrack": "Dub",
    "audio.translatedSubtitleTrack": "Translated subtitles",
    "audio.translateDone": "Created {count} translated subtitles",
    "audio.translateDoneDub": "Created {count} translated subtitles and a dub track",
    "audio.dubFailed": "Dub failed: {error}",
    "audio.translateCountMismatch": "Translation count does not match subtitle count",
    // ---- Video processing (no model) ----
    "video.title": "Video processing",
    "video.stabilize": "Stabilize",
    "video.denoise": "Denoise",
    "video.deflicker": "Deflicker",
    "video.motionBlur": "Motion blur",
    "video.upscale": "Quick upscale",
    "video.off": "Off",
    "video.light": "Light",
    "video.medium": "Medium",
    "video.strong": "Strong",
    "video.upscale.1_5": "1.5\xD7",
    "video.upscale.2": "2\xD7",
    "video.applyHint": "One encode for all effects",
    "video.hint": "The result becomes a new asset and replaces this clip. To export at a higher resolution after upscaling, raise the output settings under Settings \u2192 Project.",
    "video.apply": "Apply video processing",
    "video.done": "Video processing complete; clip replaced",
    "video.cancelled": "Video processing cancelled",
    "video.noEffects": "Select at least one effect",
    "video.selectClip": "Select a video clip on the timeline first",
    "video.cancel": "Cancel",
    "inspector.textPreset": "Text preset",
    "inspector.textPresetHint": "Save this style to the library",
    "inspector.saveTextPreset": "Save as preset",
    "inspector.more": "More actions",
    "inspector.copyAttributes": "Copy attributes",
    "inspector.pasteAttributes": "Paste attributes",
    "inspector.resetAttributes": "Reset all properties",
    "inspector.deleteClip": "Delete clip",
    "inspector.attributesCopied": "Attributes copied",
    "inspector.attributesPasted": "Attributes pasted",
    "inspector.attributesReset": "Properties reset",
    "inspector.textStyle": "Text style",
    "inspector.font": "Font",
    "inspector.fontSize": "Font size",
    "inspector.color": "Color",
    "inspector.letterSpacing": "Letter spacing",
    "inspector.lineHeight": "Line height",
    "inspector.align": "Alignment",
    "inspector.align.left": "Align left",
    "inspector.align.center": "Center",
    "inspector.align.right": "Align right",
    "inspector.background": "Background",
    "inspector.backgroundColor": "Background color",
    "inspector.backgroundOpacity": "Background opacity (%)",
    "inspector.glow": "Glow",
    "inspector.glowColor": "Glow color",
    "inspector.glowBlur": "Glow radius",
    "inspector.blendMode": "Blend mode",
    "inspector.stroke": "Stroke",
    "inspector.strokeColor": "Stroke color",
    "inspector.strokeWidth": "Stroke width",
    "inspector.shadow": "Shadow",
    "inspector.shadowColor": "Shadow color",
    "inspector.shadowOpacity": "Shadow opacity",
    "inspector.blur": "Blur",
    "inspector.offsetX": "Offset X",
    "inspector.offsetY": "Offset Y",
    "inspector.appearance": "Appearance",
    "inspector.cornerRadius": "Corner radius",
    // ---- Fonts ----
    "font.pingfang": "PingFang / YaHei",
    "font.system": "System",
    "font.sans": "Sans serif",
    "font.serif": "Serif",
    "font.mono": "Monospace",
    "font.noto": "Noto Sans CJK",
    "font.yahei": "Microsoft YaHei",
    "font.songti": "Songti",
    "font.kaiti": "Kaiti",
    // ---- Font library ----
    "font.libraryTitle": "Font library",
    "font.libraryTab": "Library",
    "font.installedTab": "Installed",
    "font.refresh": "Refresh registry",
    "font.import": "Import local font",
    "font.searchPlaceholder": "Search fonts\u2026",
    "font.searchInstalled": "Search installed fonts\u2026",
    "font.filterAll": "All",
    "font.languageLabel": "Language / script",
    "font.lang.all": "All languages",
    "font.lang.latin": "Latin",
    "font.lang.zhHans": "Simplified Chinese",
    "font.lang.zhHant": "Traditional Chinese",
    "font.lang.ja": "Japanese",
    "font.lang.ko": "Korean",
    "font.lang.cyrillic": "Cyrillic",
    "font.lang.ar": "Arabic",
    "font.lang.he": "Hebrew",
    "font.lang.vi": "Vietnamese",
    "font.lang.devanagari": "Devanagari",
    "font.lang.th": "Thai",
    "font.lang.greek": "Greek",
    "font.lang.bn": "Bengali",
    "font.lang.ta": "Tamil",
    "font.lang.te": "Telugu",
    "font.lang.gu": "Gujarati",
    "font.lang.kn": "Kannada",
    "font.lang.pa": "Gurmukhi",
    "font.lang.ml": "Malayalam",
    "font.lang.si": "Sinhala",
    "font.lang.my": "Myanmar",
    "font.lang.km": "Khmer",
    "font.lang.lo": "Lao",
    "font.lang.bo": "Tibetan",
    "font.lang.ka": "Georgian",
    "font.lang.hy": "Armenian",
    "font.lang.am": "Ethiopic",
    "font.lang.cherokee": "Cherokee",
    "font.lang.canadianAboriginal": "Canadian Aboriginal",
    "font.lang.math": "Math",
    "font.lang.symbols": "Symbols",
    "font.lang.emoji": "Emoji",
    "font.lang.braille": "Braille",
    "font.filterSans": "Sans",
    "font.filterSerif": "Serif",
    "font.filterMono": "Mono",
    "font.filterDisplay": "Display",
    "font.filterHandwriting": "Handwriting",
    "font.installedBadge": "Installed",
    "font.count": "{n} fonts",
    "font.more": "Load more ({n} left)",
    "font.empty": "No matching fonts",
    "font.detailEmpty": "Pick a font on the left",
    "font.previewLoading": "Loading preview\u2026",
    "font.loadingRegistry": "Loading the font registry\u2026",
    "font.previewFailed": "Preview unavailable; install to view it.",
    "font.weights": "Weights",
    "font.subsetsLabel": "Subsets",
    "font.subsetsSlices": "All sliced glyphs (CJK + Latin)",
    "font.subsetsCount": "{n} glyph subsets (multi-language)",
    "font.estimate": "About {size} to download",
    "font.applyAfterInstall": "Apply to the current text clip",
    "font.install": "Install",
    "font.installing": "Installing\u2026",
    "font.cancel": "Cancel",
    "font.downloading": "Downloading {done}/{total} \xB7 {size}",
    "font.alreadyInstalled": "Installed",
    "font.apply": "Apply to clip",
    "font.manage": "Manage",
    "font.reinstall": "Reinstall",
    "font.remove": "Remove",
    "font.reveal": "Show in folder",
    "font.removeConfirmTitle": "Remove font",
    "font.removeConfirmMessage": "Projects using \u201C{name}\u201D will fall back to the default font.",
    "font.removeDone": "Removed {name}",
    "font.installedToast": "Installed {name}",
    "font.appliedToast": "Applied {name}",
    "font.importPromptTitle": "Font details",
    "font.importPromptHint": "Could not read the font name; confirm it to import.",
    "font.familyLabel": "Font name",
    "font.importConfirm": "Import",
    "font.importing": "Importing\u2026",
    "font.importedToast": "Imported {name}",
    "font.staleNotice": "Registry refresh failed; showing cached data.",
    "font.registryFailed": "Failed to load the font registry",
    "font.emptyInstalled": "No fonts installed yet",
    "font.emptyInstalledHint": "Pick one from the library or import a local font.",
    "font.localSource": "Local",
    "font.fontsourceSource": "Fontsource",
    "font.sizeOnDisk": "{size} on disk",
    "font.licenseLabel": "License {license}",
    "font.missing": "Missing: {name}",
    "font.missingHint": "This font is not installed. Install it from the library.",
    "font.openLibrary": "Open library",
    "font.manageEntry": "Font library\u2026",
    "font.manageHint": "Install / remove / import fonts",
    "font.systemGroup": "System fonts",
    "font.installedGroup": "My fonts",
    "font.noWeights": "Select at least one weight",
    "font.category.sans-serif": "Sans",
    "font.category.serif": "Serif",
    "font.category.monospace": "Mono",
    "font.category.display": "Display",
    "font.category.handwriting": "Handwriting",
    // ---- Blend modes ----
    "blend.normal": "Normal",
    "blend.multiply": "Multiply",
    "blend.screen": "Screen",
    "blend.overlay": "Overlay",
    "blend.darken": "Darken",
    "blend.lighten": "Lighten",
    "blend.color-dodge": "Color dodge",
    "blend.color-burn": "Color burn",
    "blend.hard-light": "Hard light",
    "blend.soft-light": "Soft light",
    "blend.difference": "Difference",
    "blend.exclusion": "Exclusion",
    "blend.hue": "Hue",
    "blend.saturation": "Saturation",
    "blend.color": "Color",
    "blend.luminosity": "Luminosity",
    "blend.plus-lighter": "Plus lighter",
    // ---- Subtitles ----
    "subtitle.fileFilter": "Subtitle files",
    "subtitle.track": "Subtitles",
    "subtitle.import": "Import subtitles",
    "subtitle.export": "Export subtitles",
    "subtitle.importLabel": "Import subtitles",
    "subtitle.imported": "Imported {count} subtitles",
    "subtitle.importFailed": "Subtitle import failed",
    "subtitle.importFailedDetail": "Subtitle import failed: {error}",
    "subtitle.exported": "Exported {count} subtitles to {path}",
    "subtitle.exportFailed": "Subtitle export failed: {error}",
    "subtitle.none": "No subtitles to export",
    // ---- Markers ----
    "marker.add": "Add marker (M)",
    "marker.addLabel": "Add marker",
    "marker.defaultName": "Marker {n}",
    "marker.renameTitle": "Rename marker",
    "marker.renameLabel": "Rename marker",
    "marker.nameLabel": "Marker name",
    "marker.namePlaceholder": "e.g. Hook / Turn / Ending",
    "marker.deleteTitle": "Delete marker",
    "marker.deleteMessage": 'Delete marker "{name}"?',
    "marker.deleteLabel": "Delete marker",
    "marker.editTitle": "Marker & review note",
    "marker.editLabel": "Edit review note",
    "marker.noteLabel": "Note",
    "marker.notePlaceholder": "e.g. 31.2s wing clipping, re-render s05",
    "marker.severityLabel": "Severity",
    "marker.severity.none": "None",
    "marker.severity.blocker": "Blocker",
    "marker.severity.high": "High",
    "marker.severity.medium": "Medium",
    "marker.severity.low": "Low",
    "marker.resolvedLabel": "Resolved",
    // ---- Timeline ----
    "timeline.title": "Timeline",
    "timeline.undo": "Undo (\u2318Z)",
    "timeline.undoLabel": "Undo",
    "timeline.redo": "Redo (\u21E7\u2318Z)",
    "timeline.redoLabel": "Redo",
    "timeline.split": "Split (S)",
    "timeline.splitLabel": "Split",
    "timeline.trimLeft": "Trim start to playhead",
    "timeline.trimLeftLabel": "Trim start",
    "timeline.trimRight": "Trim end to playhead",
    "timeline.trimRightLabel": "Trim end",
    "timeline.delete": "Delete selected clips (Delete)",
    "timeline.deleteLabel": "Delete",
    "timeline.copy": "Copy",
    "timeline.cut": "Cut",
    "timeline.paste": "Paste",
    "timeline.cutLabel": "Cut clips",
    "timeline.pasteLabel": "Paste clips",
    "timeline.duplicate": "Duplicate selected clips (\u2318D)",
    "timeline.duplicateLabel": "Duplicate clips",
    "timeline.rippleDelete": "Delete and shift following clips left (Shift+Delete)",
    "timeline.rippleDeleteLabel": "Delete and shift left",
    "timeline.addKeyframe": "Add a keyframe to the selected clip at the playhead",
    "timeline.addKeyframeLabel": "Add keyframe",
    "timeline.addText": "Add text at playhead",
    "timeline.addTextLabel": "Add text",
    "timeline.zoomOut": "Zoom out",
    "timeline.zoomIn": "Zoom in",
    "timeline.zoom": "Timeline zoom",
    "timeline.tracks": "Tracks",
    "timeline.locked": "Target track is locked",
    "timeline.confirmDeleteTrack": "Delete track?",
    "timeline.confirmDeleteTrackMessage": "Track {n} has {count} clips. Deleting the track removes them too.",
    "timeline.missingAsset": "(missing media)",
    "timeline.dropHint": "Drag media here to create a track",
    "timeline.emptyTitle": "The timeline is empty",
    "timeline.emptySub": "Import & add to timeline drops files at the playhead; you can also drag assets in from the library.",
    "timeline.noDuration": "{name} has no usable duration",
    "timeline.nothingToSplit": "Nothing to split at the playhead",
    "timeline.selectForTrim": "Select a clip at the playhead first",
    "timeline.selectForKeyframe": "Select a clip at the playhead first",
    // ---- Context menu ----
    "menu.ai": "AI actions",
    "menu.aiGenerate": "AI generate",
    "menu.aiBadge": "AI",
    "menu.aiPrimaryOnly": "AI runs on the right-clicked clip only; other selected clips are untouched",
    "menu.moreEdit": "More edit",
    "menu.audio": "Audio",
    "menu.visual": "Visual",
    "menu.text": "Text",
    "menu.attributes": "Attributes",
    "menu.track": "Track",
    "menu.copyText": "Copy text",
    "menu.textCopied": "Text copied",
    "menu.editInInspector": "Edit in inspector",
    "menu.selectTrackClips": "Select clips on this track",
    "menu.locate": "Move playhead here",
    "menu.goToMarker": "Go to this marker",
    "menu.mute": "Mute",
    "menu.unmute": "Unmute",
    "menu.volume": "Volume",
    "menu.gainUp": "Volume +3 dB",
    "menu.gainDown": "Volume -3 dB",
    "menu.gainReset": "Reset volume",
    "menu.fadeIn": "Fade in",
    "menu.fadeOut": "Fade out",
    "menu.seconds": "{value}s",
    "menu.speed": "Speed",
    "menu.speedValue": "Speed {value}\xD7",
    "menu.resetTransform": "Reset transform",
    "menu.resetColor": "Reset color",
    "menu.videoProcess": "Video processing",
    "menu.translate": "Translate subtitles",
    "menu.dub": "Translate + dub",
    "menu.loudnessTarget": "Normalize loudness (-14 LUFS)",
    "menu.enhance": "Enhance picture",
    "menu.upscale2": "AI upscale 2\xD7",
    "menu.upscale4": "AI upscale 4\xD7",
    "menu.interpolate2": "AI frame interpolation 2\xD7",
    "menu.interpolate4": "AI frame interpolation 4\xD7",
    "menu.reframeFace": "Smart crop \xB7 9:16",
    "menu.reframePerson": "Subject tracking \xB7 9:16",
    "menu.stabilize": "Stabilize",
    "menu.videoDenoise": "Video denoise",
    "menu.deflicker": "Deflicker",
    "menu.motionBlur": "Motion blur",
    "menu.imageEdit": "Edit this image\u2026",
    "menu.imageToVideo": "Animate this image\u2026",
    "menu.textToVideo": "Generate video from this text\u2026",
    "menu.genVideo": "Text to video\u2026",
    "menu.genVideoFromImage": "Image to video\u2026",
    "menu.genImage": "Text to image\u2026",
    "menu.genEditImage": "Edit an image\u2026",
    "menu.pasteHere": "Paste here",
    "menu.addTextHere": "Add text here",
    "menu.addMarkerHere": "Add marker here",
    "menu.seekHere": "Move playhead here",
    "menu.splitHere": "Split here",
    "menu.newTrack": "New track",
    "menu.newTrackBelow": "New track below",
    "menu.trackMute": "Mute track",
    "menu.trackUnmute": "Unmute track",
    "menu.trackHide": "Hide track",
    "menu.trackShow": "Show track",
    "menu.trackLock": "Lock track",
    "menu.trackUnlock": "Unlock track",
    "menu.removeTrack": "Delete track",
    "menu.aiNeedModel": '"{name}" needs a model download',
    "menu.openModels": "Open model downloads",
    "menu.alignerOnly": "requires the forced aligner",
    "menu.codecOnly": "requires the audio codec",
    "menu.aiBusy": "Another AI task is already running",
    "menu.aiDone": "{name} done",
    "menu.aiFailed": "AI task failed: {error}",
    // ---- Track ----
    "track.name": "Track",
    "track.autoName": "Track {n}",
    "track.label": "Track {n}",
    "track.rename": "Rename track",
    "track.renameHint": "Double-click to rename",
    "track.renameLabel": "Rename track",
    "track.mute": "Mute",
    "track.unmute": "Unmute",
    "track.muteNamed": "Mute {name}",
    "track.show": "Show",
    "track.hide": "Hide",
    "track.showNamed": "Show {name}",
    "track.lock": "Lock track",
    "track.unlock": "Unlock track",
    "track.lockNamed": "Lock {name}",
    "track.delete": "Delete track",
    "track.deleteNamed": "Delete {name}",
    "track.add": "Add track",
    "track.reorder": "Drag to reorder",
    // ---- Preview ----
    "preview.title": "Preview",
    "preview.exportFrame": "Export current frame",
    "preview.frameFilter": "PNG image",
    "preview.frameExported": "Frame exported to {path}",
    "preview.frameFailed": "Failed to export frame: {error}",
    "preview.previousFrame": "Previous frame",
    "preview.nextFrame": "Next frame",
    "preview.play": "Play",
    "preview.pause": "Pause",
    "preview.volume": "Volume",
    "preview.hideTimeline": "Hide timeline",
    "preview.showTimeline": "Show timeline",
    "preview.importHint": "Import media and drag it onto the timeline",
    "preview.emptyTitle": "Start with one clip",
    "preview.emptySub": "Import video, images or audio \u2014 they land on the timeline; or let AI generate a shot.",
    "preview.emptyAi": "AI generate",
    "preview.emptyNote": "You can also drop files straight into the window",
    "preview.resolution": "{width} \xD7 {height} \xB7 {fps} fps",
    "preview.fxFailed": "Effect render failed",
    "preview.zoomIn": "Zoom in",
    "preview.zoomOut": "Zoom out",
    "preview.zoomReset": "Reset to 100%",
    "preview.playMode": "Play mode",
    "preview.playMode.single": "Single part",
    "preview.playMode.series": "Series",
    "preview.playMode.singleHint": "Stop at the end of this part",
    "preview.playMode.seriesHint": "Follow the connections into the next part; branches show choices",
    "preview.quality": "Quality",
    "preview.quality.auto": "Auto",
    "preview.quality.autoHint": "Choose based on playback performance",
    "preview.quality.high": "Original",
    "preview.quality.highHint": "Keep the source sharpness",
    "preview.quality.medium": "Sharp",
    "preview.quality.mediumHint": "Smooth playback, export unaffected",
    "preview.quality.low": "Smooth",
    "preview.quality.lowHint": "Smoothest preview",
    "preview.aspect": "Canvas ratio",
    "preview.aspect.project": "Fit project",
    "preview.aspect.group.auto": "Common",
    "preview.aspect.group.landscape": "Landscape",
    "preview.aspect.group.portrait": "Portrait",
    "preview.aspect.group.square": "Square",
    "preview.aspect.16_9": "16:9",
    "preview.aspect.9_16": "9:16",
    "preview.aspect.1_1": "1:1",
    "preview.aspect.4_3": "4:3",
    "preview.aspect.3_4": "3:4",
    "preview.fullscreen": "Fullscreen",
    "preview.exitFullscreen": "Exit fullscreen",
    // ---- Export ----
    "export.title": "Export",
    "export.format": "Format",
    "export.resolution": "Resolution",
    "export.resolution.project": "Original",
    "export.resolution.1080p": "1080p",
    "export.resolution.720p": "720p",
    "export.resolution.custom": "Custom",
    "export.size": "Size",
    "export.fit": "Fit",
    "export.fit.contain": "Contain",
    "export.fit.cover": "Cover",
    "export.anchor": "Crop focus",
    "export.anchor.top-left": "Top left",
    "export.anchor.top": "Top",
    "export.anchor.top-right": "Top right",
    "export.anchor.left": "Left",
    "export.anchor.center": "Center",
    "export.anchor.right": "Right",
    "export.anchor.bottom-left": "Bottom left",
    "export.anchor.bottom": "Bottom",
    "export.anchor.bottom-right": "Bottom right",
    "export.fps": "Frame rate",
    "export.fps.project": "Project",
    "export.gifColors": "Colors",
    "export.gifDither": "Dither",
    "export.gifLoop": "Loop",
    "export.gifDither.sierra2_4a": "Sierra",
    "export.gifDither.bayer": "Bayer",
    "export.gifDither.floyd_steinberg": "Floyd",
    "export.gifDither.none": "None",
    "export.quality": "Quality",
    "export.quality.high": "High",
    "export.quality.standard": "Standard",
    "export.quality.small": "Small",
    "export.audio": "Audio",
    "export.outputSpec": "Output",
    "export.exportVideo": "Export video",
    "export.exporting": "Exporting\u2026",
    "export.cancel": "Cancel export",
    "export.done": "Exported: {path}",
    "export.hint": "You'll choose a save location; the project is unchanged",
    "export.emptyTimeline": "Timeline is empty. Add something first.",
    "export.frameNoOutput": "Output path is required",
    "export.frameTextFailed": "Failed to render the text layer",
    "export.frameTimeInvalid": "Time is outside the timeline",
    "export.frameNoVideo": "Export plan has no video output",
    "export.missingAssets": "These media files are offline or missing: {names}",
    "export.textRenderFailed": "Could not render the text layer",
    "export.exported": "Exported to {path}",
    "export.failed": "Export failed: {error}",
    "export.cancelled": "Export cancelled",
    "export.warnMissingAsset": "A clip references missing media and was skipped",
    "export.warnMissingTextImage": "Text clip \u201C{text}\u201D has no rendered image and was skipped",
    "export.offlineAsset": "Media is offline: {name}",
    "export.format.mp4.label": "MP4 \xB7 H.264",
    "export.format.mp4.hint": "Universal, great for social media",
    "export.format.mp4.audio": "AAC \xB7 192 kbps",
    "export.format.prores.label": "ProRes 422",
    "export.format.prores.hint": "High-bitrate intermediate for post",
    "export.format.prores.audio": "PCM \xB7 48 kHz",
    "export.format.gif.label": "GIF",
    "export.format.gif.hint": "Short looping image, no sound",
    "export.format.gif.audio": "No audio",
    // ---- Settings ----
    "settings.title": "Settings",
    "settings.back": "Settings",
    "settings.navAria": "Settings sections",
    "settings.section.general": "General",
    "settings.section.general.caption": "Project, startup & language",
    "settings.section.appearance": "Appearance",
    "settings.section.appearance.caption": "Theme & accent",
    "settings.section.layout": "Layout",
    "settings.section.layout.caption": "Panels & widths",
    "settings.section.about": "About",
    "settings.section.about.caption": "Version and licence",
    "settings.section.storage": "Storage",
    "settings.section.storage.caption": "Models, runtimes & data folder",
    "settings.web.title": "Web access",
    "settings.web.local": "Local address",
    "settings.web.localHint": "Open it in a browser on this machine. The URL carries the access token, so it has the same power as the desktop app.",
    "settings.web.copy": "Copy",
    "settings.web.lan": "LAN access",
    "settings.web.lanHint": "Devices on the same network can open the session.",
    "settings.web.lanUnavailable": "Not connected to a LAN",
    "settings.web.restart": "Changed \u2014 restart to apply.",
    "settings.web.open": "Open in browser",
    "settings.web.openHint": "Open the current session in your default browser.",
    "settings.web.openButton": "Open",
    "settings.storage.location": "Data folder",
    "settings.storage.current": "Current location",
    "settings.storage.currentHint": "Models, ONNX Runtime, OFX plugins and project history live here",
    "settings.storage.source.label": "Set by",
    "settings.storage.source.cli": "Command line (portable mode)",
    "settings.storage.source.env": "Environment variable AICUT_DATA_DIR",
    "settings.storage.source.settings": "Settings (this app)",
    "settings.storage.source.installer": "Installer",
    "settings.storage.source.default": "System default (user profile)",
    "settings.storage.default": "System default location",
    "settings.storage.systemDrive": "The data folder is on the system drive and uses {size}; move it to another drive if space is tight.",
    "settings.storage.cache": "Cache location",
    "settings.storage.cacheHint": "Thumbnails and intermediates; rebuildable, never migrated",
    "settings.storage.move": "Move to another drive",
    "settings.storage.moveHint": "Copy everything to a new folder (must be empty); it takes effect after a restart.",
    "settings.storage.choose": "Choose folder & migrate",
    "settings.storage.portable": "This location comes from the command line or environment (portable mode); change the launch arguments instead.",
    "settings.storage.scanning": "Measuring the data to copy\u2026",
    "settings.storage.copying": "Copying {done}",
    "settings.storage.writing": "Rewriting paths inside the copied data\u2026",
    "settings.storage.failed": "Migration failed: {error}",
    "settings.storage.done": "Copied to {path}; it takes effect after a restart.",
    "settings.storage.migratedTitle": "Migration complete",
    "settings.storage.migrated": "New location: {path}",
    "settings.storage.migratedHint": "This process still uses the old folder; the new one is used after a restart, when the old data can be cleaned up.",
    "settings.storage.restartNow": "Restart now",
    "settings.storage.previousTitle": "Old data",
    "settings.storage.previous": "Left over from the previous migration",
    "settings.storage.previousHint": "Once the new folder works, delete it to free space.",
    "settings.storage.cleanup": "Clean up old folder",
    "settings.storage.cleaned": "Cleaned up old folder: {path}",
    "settings.storage.nothingToClean": "There is no old folder to clean up.",
    "settings.storage.cleanupFailed": "Cleanup failed: {error}",
    "settings.storage.confirmTitle": "Migrate the data folder?",
    "settings.storage.confirmBody": "Everything will be copied to {path}. The target folder must be empty, and it takes effect once the copy finishes and the app restarts. Avoid changing settings or downloading models while it runs; old data is not deleted automatically and can be cleaned up here after the restart.",
    "settings.storage.confirmGo": "Start migration",
    "settings.storage.desktopOnly": "The data folder can only be changed in the desktop app.",
    // ---- capability table: the server declares whether a feature works in this shell ----
    "caps.fallback.separator": "; use instead: ",
    "caps.fallback.desktop": "use the desktop app",
    "caps.reason.notPorted": "not available in the browser build yet",
    "caps.reason.pluginRevealDesktopOnly": "plugins can be installed / removed / imported; revealing them in the file manager needs the desktop app",
    "caps.reason.needsPath": "needs system-level permissions; the browser build cannot provide them",
    "caps.feature.agent": "Agent",
    "caps.feature.mcp": "MCP server",
    "caps.feature.cli": "CLI mount",
    "caps.feature.network": "Network",
    "caps.feature.cloudTts": "Cloud TTS",
    "caps.feature.cloudGen": "Cloud image / video",
    "caps.feature.loudness": "Loudness",
    "caps.feature.videoDsp": "Video DSP",
    "caps.feature.runtime": "AI runtime",
    "caps.feature.imageGen": "AI image generation",
    "caps.feature.videoGen": "AI video generation",
    "caps.feature.sdcpp": "local generation engine",
    "caps.feature.dataDir": "data folder",
    "caps.feature.backend": "AI backend",
    "settings.storage.cleanupTitle": "Delete the old data folder?",
    "settings.storage.cleanupBody": "This will delete {path}, keeping only the bootstrap pointer and discovery files. It cannot be undone.",
    "settings.storage.cleanupGo": "Delete",
    "settings.language": "Language",
    "settings.language.label": "Interface language",
    "settings.language.hint": "Applies immediately",
    "settings.startup": "Startup",
    "settings.welcome.label": "Show the welcome screen on launch",
    "settings.welcome.hint": "Gives you a starting point every time; turn it off and replay it from the Help menu.",
    "settings.welcome.replay": "Quick start",
    "settings.welcome.replayHint": "Walk through the main areas with a spotlight",
    "settings.welcome.replayAction": "Replay",
    "settings.project": "Project",
    "settings.project.current": "Current project",
    "settings.project.currentHint": "Name and format",
    "settings.output.label": "Output settings",
    "settings.output.resolution": "Resolution",
    "settings.output.resolutionHint": "Preview canvas and export size; clips refit proportionally",
    "settings.output.fps": "Frame rate",
    "settings.output.fpsHint": "Timeline snapping and export frame rate",
    "settings.output.custom": "Custom",
    "settings.output.1080p": "1920 \xD7 1080",
    "settings.output.720p": "1280 \xD7 720",
    "settings.output.4k": "3840 \xD7 2160",
    "settings.output.vertical": "1080 \xD7 1920",
    "settings.output.square": "1080 \xD7 1080",
    "settings.output.4x3": "1440 \xD7 1080",
    "settings.output.width": "Width",
    "settings.output.height": "Height",
    "settings.theme": "Theme",
    "settings.theme.label": "Theme",
    "settings.theme.hint": "Follow system matches your OS appearance",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.theme.system": "System",
    "settings.accent": "Accent color",
    "settings.accent.label": "Accent",
    "settings.accent.hint": "Used for buttons, selections and sliders",
    "accent.lavender": "Lavender",
    "accent.blue": "Blue",
    "accent.green": "Green",
    "accent.coral": "Coral",
    "accent.amber": "Amber",
    "settings.panels": "Panels",
    "settings.panels.tracks": "Show timeline",
    "settings.panels.tracksHint": "Track area below the preview",
    "settings.panels.inspector": "Show sidebar",
    "settings.panels.inspectorHint": "Media, inspector and AI assistant",
    "settings.width": "Sizes",
    "settings.width.tracks": "Timeline height (px)",
    "settings.width.inspector": "Sidebar width (px)",
    "settings.about.app": "Application",
    "settings.about.version": "Version",
    "settings.about.versionHint": "Current build",
    "settings.about.engine": "Engine",
    "settings.about.engineHint": "Rendering and export backend",
    "settings.about.license": "Licence",
    "settings.about.licenseLabel": "Open-source licence",
    "settings.about.licenseHint": "The app and its local inference code share one licence",
    "settings.update.group": "Updates",
    "settings.update.title": "Software update",
    "settings.update.hint": "Updates come from GitHub Releases",
    "settings.update.notes": "Release notes",
    "settings.update.check": "Check for updates",
    "settings.update.download": "Download and install",
    "settings.update.restart": "Restart app",
    "settings.update.downloading": "Downloading {percent}%",
    "settings.update.availableToast": "Version {version} is available \u2014 update from Settings \u2192 About",
    "settings.update.status.checking": "Checking for updates\u2026",
    "settings.update.status.available": "Version {version} is available",
    "settings.update.status.downloading": "Downloading {version}",
    "settings.update.status.ready": "Update ready",
    "settings.update.status.error": "Update failed: {error}",
    "settings.update.status.idle": "You're up to date",
    "settings.update.status.restartHint": "Restart the app to finish updating",
    "update.notice.message": "Updated from v{from} to v{version}. You're now running the new version.",
    "update.notice.viewNotes": "View release notes",
    "settings.untitled": "Untitled project",
    // ---- AI assistant ----
    "ai.title": "AI assistant",
    "ai.sub": "Describe the edit and I'll do the cutting",
    "ai.intro1": "Tell me what you want. For example:",
    "ai.introExample": "Put \u201CSunset\u201D first, add upbeat music, and keep it under 30 seconds.",
    "ai.intro2": "I'll draft a rough cut, then refine pacing and transitions with your feedback.",
    "ai.suggestion.auto": "Auto rough cut",
    "ai.suggestion.silence": "Remove silence",
    "ai.suggestion.captions": "Generate captions",
    "ai.suggestion.music": "Add music",
    "ai.hint": "Prototype: chat and editing are not connected yet",
    "ai.placeholder": "Describe the edit\u2026",
    "ai.send": "Send",
    // ---- Clip agent ----
    "agent.title": "Clip agent",
    "agent.config": "Configure",
    "agent.newChat": "New chat",
    "agent.history": "History",
    "agent.historyTitle": "Chat history",
    "agent.historySearch": "Search chats",
    "agent.historyEmpty": "No chats yet",
    "agent.historyNoMatch": "No matching chats",
    "agent.historyCount": "{count} messages",
    "agent.close": "Close",
    "agent.unconfiguredTitle": "Configure the clip agent",
    "agent.unconfiguredHint": "Add a text-model provider (endpoint / API key / model) in Settings \u2192 Text generation.",
    "agent.goSettings": "Open settings",
    "agent.placeholder": "Describe the edit you want\u2026",
    "agent.send": "Send",
    "agent.stop": "Stop",
    "agent.edit": "Edit",
    "agent.emptyHint": "Say something and start editing.",
    "agent.think": "Thinking",
    "agent.process.runningThinking": "Thinking",
    "agent.process.runningTools": "Calling {name}",
    "agent.process.stopped": "Stopped",
    "agent.process.failed": "Failed",
    "agent.process.took": "Done in {duration}",
    "agent.process.tools": "{count} tool calls",
    "agent.process.toolsRunning": "Calling {name}",
    "agent.process.toolsFailed": "{count} failed",
    "agent.toolOk": "Done",
    "agent.toolFail": "Failed",
    "agent.toolPending": "Not run",
    "agent.toolRunning": "Running",
    "agent.toolInput": "Input",
    "agent.toolOutput": "Output",
    "agent.durationSeconds": "{s}s",
    "agent.durationMinutes": "{m}m {s}s",
    "agent.durationHours": "{h}h {m}m {s}s",
    "agent.command.editTimeline": "Edit timeline",
    "agent.command.undo": "Undo",
    "agent.command.redo": "Redo",
    "agent.command.renameProject": "Rename project",
    "agent.command.openProject": "Open project",
    // ---- Operation log ----
    "ops.title": "Operation log",
    "ops.summary": "{total} steps \xB7 {applied} applied \xB7 {redo} to redo",
    "ops.filter.all": "All",
    "ops.filter.human": "Human",
    "ops.filter.builtin": "Built-in assistant",
    "ops.filter.external": "External AI",
    "ops.actor.human": "Human",
    "ops.actor.builtin": "Built-in assistant",
    "ops.actor.external": "External AI",
    "ops.search": "Search operations",
    "ops.searchLabel": "Search operation log",
    "ops.undoLast": "Undo last step",
    "ops.redoLast": "Redo next step",
    "ops.current": "Current state",
    "ops.empty": "No operations yet",
    "ops.emptyHint": "Every change you, the built-in assistant or an external AI makes to the project is recorded here.",
    "ops.emptyFilter": "No matching operations",
    "ops.undone": "Undone",
    "ops.revert": "Revert to before this step",
    "ops.reapply": "Redo up to this step",
    "ops.revertHint": "Reverts {count} step(s), including this one",
    "ops.reapplyHint": "Redoes {count} step(s), including this one",
    "ops.clips": "{count} clip(s)",
    "ops.tracks": "{count} track(s)",
    "ops.assets": "{count} asset(s)",
    "ops.batchLabel": "{label} (+{count})",
    "ops.kind.asset.add": "Add media",
    "ops.kind.asset.remove": "Remove media",
    "ops.kind.asset.update": "Update media",
    "ops.kind.clip.add": "Add clip",
    "ops.kind.clip.update": "Edit clip",
    "ops.kind.clip.remove": "Delete clip",
    "ops.kind.clip.split": "Split clip",
    "ops.kind.clip.trim": "Trim clip",
    "ops.kind.clip.move": "Move clip",
    "ops.kind.clip.append": "Append clip",
    "ops.kind.clip.speed": "Change speed",
    "ops.kind.clip.color": "Color grade",
    "ops.kind.clip.transition": "Transition",
    "ops.kind.clip.keyframes": "Keyframes",
    "ops.kind.clip.duplicate": "Duplicate clip",
    "ops.kind.clip.ripple_delete": "Delete and shift left",
    "ops.kind.track.add": "Add track",
    "ops.kind.track.update": "Edit track",
    "ops.kind.track.remove": "Delete track",
    "ops.kind.track.move": "Move track",
    "ops.kind.subtitle.import": "Import subtitles",
    "ops.kind.marker.add": "Add marker",
    "ops.kind.marker.update": "Edit marker",
    "ops.kind.marker.remove": "Delete marker",
    "ops.kind.project.rename": "Rename project",
    "ops.kind.project.output": "Change output settings",
    "ops.kind.project.reset": "New / open project",
    "ops.kind.ui.dispatch": "Timeline edit",
    "ops.kind.history.undo": "Undo",
    "ops.kind.history.redo": "Redo",
    // ---- AI features ----
    "ai.agent": "Clip agent",
    "ai.agentHint": "Chat-driven editing on the timeline",
    "ai.run": "Open",
    "ai.pluginPageHint": "Page provided by a plugin",
    "ai.mcpServer": "MCP server",
    "ai.mcpOn": "Enabled \u2014 harnesses can connect",
    "ai.mcpOff": "Disabled",
    "ai.mcpToggleOn": "Enable MCP",
    "ai.mcpToggleOff": "Disable MCP",
    "ai.endpoint": "Endpoint",
    "ai.copy": "Copy",
    "ai.copied": "MCP endpoint copied",
    "ai.copyFailed": "Copy failed",
    "ai.cli": "CLI & skills",
    "ai.cliHint": "aicut is a thin MCP client; skills control the app through it and the MCP tools.",
    "ai.openCli": "CLI settings",
    "ai.stop": "Stop",
    "ai.tagFilter": "AI capability category",
    "ai.engine.onnx": "ONNX",
    "ai.engine.onnxHint": "Local inference on ONNX Runtime (ONNX models, CPU / DirectML / CoreML / CUDA)",
    "ai.engine.sdcpp": "sd.cpp",
    "ai.engine.sdcppHint": "Local inference on the sd.cpp (ggml) engine: video / image models run on a separate engine (CPU / Vulkan / CUDA 12 / Metal)",
    "ai.engine.cloud": "Cloud",
    "ai.engine.cloudHint": "Calls the cloud service configured in Settings; no model runs locally",
    "ai.tags.all": "All",
    "ai.tags.visual": "Visual",
    "ai.tags.audio": "Audio",
    "ai.tags.text": "Text",
    "ai.textFeatures": "Text",
    "ai.audioFeatures": "Audio",
    "ai.videoGen": "AI video generation",
    "ai.videoGenOpen": "Open video generation",
    "ai.imageGen": "AI image generation",
    "ai.imageEdit": "Image editing",
    "ai.imageGenOpen": "Open image generation",
    "ai.imageEditOpen": "Open image editing",
    "ai.prepare": "Set up",
    "ai.setupNote": "Engine + model: {size} to download",
    "ai.setupReady": "Engine and model ready",
    "ai.cloudReady": "Cloud service: {name}",
    "ai.emptyTag": "No AI capability in this category yet",
    "aiVideo.title": "AI video generation",
    "aiVideo.track": "AI video",
    "aiVideo.engine": "sd.cpp engine",
    "aiVideo.engineMissing": "Engine not installed",
    "aiVideo.engineMissingHint": "Install an sd.cpp engine (CPU / Vulkan / CUDA 12) in the download manager first.",
    "aiVideo.engineMissingTitle": "sd.cpp engine required",
    "aiVideo.engineDownloadBody": '"{name}" needs the sd.cpp engine ({size}). Open the download manager now?',
    "aiVideo.engineReady": "Engine ready",
    "aiVideo.downloadEngine": "Download engine",
    "aiVideo.manageEngine": "Manage engine",
    "aiVideo.configure": "Configure providers\u2026",
    "aiVideo.configureHint": "Add an official API or an aggregator (OpenRouter, SiliconFlow, \u2026)",
    "aiVideo.groupLocal": "Local models",
    "aiVideo.groupCloud": "Cloud services",
    "aiVideo.cloudHint": "Cloud generation: billed by the provider, sampling is decided by the model",
    "aiVideo.cloudFrameNote": "Cloud jobs queue at the provider (usually 1\u20135 min); the first-frame image is used for image-to-video.",
    "aiVideo.backend": "Video backend",
    "aiVideo.backendHint": "Affects sd.cpp generation (video / images) only; separate from the ONNX Runtime backend. Takes effect on the next run.",
    "aiVideo.backendSwitched": "Video backend switched to {name}",
    "aiVideo.model": "Model",
    "aiVideo.modelHint.minimax_h3": "MiniMax-H3 generates picture and stereo audio together; four files, about 30 GB \u2014 the Qwen3-VL 32B text encoder is the memory hog.",
    "aiVideo.modelHint.minimax_h3_ref2va": "MiniMax-H3 Ref2VA conditions on reference images / audio to keep a character and voice consistent. It shares the text encoder and VAEs with H3 (about 18 GB reused on download) and does not take first/last frames.",
    "aiVideo.modelHint.wan21_t2v": "Wan2.1 T2V 1.3B generates video only (no audio); about 6.7 GB across three files, fast to download and run \u2014 good for testing the pipeline.",
    "aiVideo.modelHint.wan22_ti2v": "Wan2.2 TI2V 5B is the newer 1.3B-class model: 24 fps and steadier motion, about 8.5 GB across three files, still video only.",
    "aiVideo.modelHint.wan22_t2v_a14b": "Wan2.2 T2V A14B hands off between high- and low-noise experts for the best quality; about 23 GB, so 16 GB cards must keep weights in RAM.",
    "aiVideo.modelHint.hunyuan_video_15": "HunyuanVideo 1.5 is a 720p text-to-video model with Qwen2.5-VL 7B + ByT5 text encoders; four files, about 29 GB, no audio.",
    "aiVideo.modelHint.ltx_23": "LTX-2.3 22B uses Gemma 3 12B as its text encoder and generates picture plus audio; five files, about 26 GB.",
    "aiVideo.modelHint.ltx_25": "LTX-2.5 22B is the upgrade over 2.3: a Gemma 4 12B text encoder (int8, projection included) and picture plus audio; four files, about 33 GB.",
    "aiVideo.modelReady": "Installed \xB7 {size}",
    "aiVideo.modelNeedsDownload": "Needs {size}",
    "aiVideo.modelMissingHint": "Download the model first ({size}).",
    "aiVideo.noModel": "No video generation model in the catalog yet",
    "aiVideo.downloadModel": "Download model ({size})",
    "aiVideo.downloadModelTitle": "Download video generation model",
    "aiVideo.downloadModelBody": "This downloads {name} ({size}). You can generate on this page afterwards.",
    "aiVideo.downloading": "Downloading\u2026",
    "aiVideo.prompt": "Prompt",
    "aiVideo.promptPlaceholder": "Describe the shot, camera motion, light and sound; this model generates audio too.",
    "aiVideo.promptPlaceholderSilent": "Describe the shot, camera motion and light; this model generates video only (no audio).",
    "aiVideo.resolution": "Resolution",
    "aiVideo.aspect": "Aspect",
    "aiVideo.aspectHint": "The clip is generated at this aspect; set the project output to the same aspect before export to avoid padding or cropping.",
    "aiVideo.refImage": "Reference images",
    "aiVideo.refImageSubBoth": "First + last frame (supported by some models)",
    "aiVideo.refImageSubFirst": "First-frame image-to-video",
    "aiVideo.refImageNone": "None",
    "aiVideo.refImageHint": "Reference images are preprocessed to the canvas; describe the shot and motion in the prompt as usual.",
    "aiVideo.firstFrame": "First frame",
    "aiVideo.lastFrame": "Last frame",
    "aiVideo.lastFrameNeedsFirst": "Pick a first frame before a last frame.",
    "aiVideo.importImage": "Import image",
    "aiVideo.noImageAssets": "No images in the media library yet \u2014 import one first.",
    "aiVideo.refConditions": "Reference conditions (Ref2VA)",
    "aiVideo.refConditionsSub": "Images lock the character, audio locks the voice; multiple allowed",
    "aiVideo.refImages": "Reference images",
    "aiVideo.addRefImage": "Add reference image",
    "aiVideo.refAudios": "Reference audio",
    "aiVideo.addRefAudio": "Add reference audio",
    "aiVideo.noRefImages": "No reference images yet \u2014 pick one from the library or import one.",
    "aiVideo.noRefAudios": "No reference audio yet \u2014 pick one from the library or import one.",
    "aiVideo.importAudio": "Import audio",
    "aiVideo.refConditionsHint": "Images map to <Picture 1>, <Picture 2>\u2026 in the prompt in list order; reference audio is converted to 32 kHz stereo WAV.",
    "aiVideo.duration": "Duration",
    "aiVideo.seconds": "{value} s",
    "aiVideo.frames": "{frames} frames \xB7 {seconds}s actual ({grid})",
    "aiVideo.grid": "frame grid {step}k+{offset}",
    "aiVideo.framesUnit": "frames",
    "aiVideo.steps": "Steps",
    "aiVideo.steps4": "4 steps \xB7 fastest",
    "aiVideo.steps6": "6 steps \xB7 recommended",
    "aiVideo.steps8": "8 steps \xB7 finer",
    "aiVideo.steps10": "10 steps \xB7 two experts",
    "aiVideo.steps20": "20 steps \xB7 slowest",
    "aiVideo.stepsHint": "H3 Turbo is fastest at 4 steps; Wan / LTX / Hunyuan officially recommend around 20 steps \u2014 too few makes the picture mushy.",
    "aiVideo.advanced": "Advanced",
    "aiVideo.seed": "Seed",
    "aiVideo.cfg": "CFG",
    "aiVideo.flowShift": "Flow shift",
    "aiVideo.offload": "Keep weights in RAM",
    "aiVideo.vaeTiling": "VAE tiling",
    "aiVideo.generate": "Generate",
    "aiVideo.stop": "Stop",
    "aiVideo.elapsed": "Generating\u2026 {seconds}s",
    "aiVideo.done": "Generated and added to the timeline",
    "aiVideo.addFailed": "Could not add to the timeline: {error}",
    "aiVideo.result": "Result",
    "aiVideo.addToTimeline": "Add to timeline again",
    "aiVideo.needPrompt": "Write a prompt first",
    "aiVideo.vramWarning": "16 GB VRAM: keep \u2264175 frames (~7.3 s); a 10 s single shot will likely OOM \u2014 generate two segments.",
    "aiVideo.vram720Warning": "At 720p on 16 GB, keep \u226473 frames (~3 s).",
    "aiVideo.chunkWarning": "{frames} frames (~{seconds} s) is this model's recommended single-segment limit; generate longer clips in segments and stitch them.",
    "aiVideo.clampedWarning": "This model tops out at {frames} frames (~{seconds} s) per segment; the clip was shortened automatically.",
    "aiImage.drawTitle": "AI image generation",
    "aiImage.editTitle": "Image editing",
    "aiImage.configure": "Configure providers\u2026",
    "aiImage.configureHint": "Text-to-image, image-to-image and video APIs all live in Settings",
    "aiImage.groupLocal": "Local models",
    "aiImage.groupCloud": "Cloud services",
    "aiImage.cloudHint": "Cloud generation: billed by the provider; sampling and model are decided there",
    "aiImage.cloudEditHint": "Cloud edits re-render the whole image from the prompt; OpenAI's edit endpoint also supports a painted mask.",
    "aiImage.trackDraw": "AI image",
    "aiImage.trackEdit": "AI edit",
    "aiImage.modelHint.sd15": "SD 1.5 Inpainting: the lightest entry, one 4.3 GB file that runs at 512p even on CPU / integrated graphics; a real inpainting checkpoint, used only for mask edits \u2014 not text-to-image.",
    "aiImage.modelHint.sdxl": "SDXL Base 1.0: one 6.9 GB file for general 1024p work; no dedicated inpainting UNet, but mask blending still gives usable local edits.",
    "aiImage.modelHint.z_image_turbo": "Z-Image Turbo: 6B DiT + Qwen3-4B encoder, about 6.7 GB, runs on 4 GB VRAM and draws in 8 steps; the default for both generating and editing.",
    "aiImage.modelHint.flux1_schnell": "FLUX.1 schnell: 12B, 4 steps, about 12.4 GB; follows prompts closely and is great for fast drafts.",
    "aiImage.modelHint.flux1_kontext": 'FLUX.1 Kontext: instruction-based whole-image editing (no mask needed), about 12.4 GB; best for "change A to B" one-liners.',
    "aiImage.modelHint.qwen_image": "Qwen-Image: 20B, the strongest at Chinese and long text rendering, about 18 GB; enable weight offloading on 16 GB cards.",
    "aiImage.modelHint.qwen_image_edit": "Qwen-Image-Edit 2509: Chinese / English instruction editing, about 18.9 GB; a painted mask adds a local-repaint pass on top.",
    "aiImage.noModel": "No image generation model in the catalog yet",
    "aiImage.noEditModel": "No image editing model in the catalog yet",
    "aiImage.downloadModelTitle": "Download image model",
    "aiImage.downloadModelBody": "This downloads {name} ({size}). You can start generating on this page afterwards.",
    "aiImage.prompt": "Prompt",
    "aiImage.promptPlaceholder": "Describe the picture, style, light and framing; name the subject and the shot.",
    "aiImage.promptPlaceholderEdit": 'Describe the change, e.g. "make the background a rainy Tokyo street at night" or "add a red hat to the person".',
    "aiImage.negativePlaceholder": "Negative prompt (optional): blurry, extra fingers, low quality\u2026",
    "aiImage.resolution": "Resolution",
    "aiImage.steps": "Steps",
    "aiImage.strength": "Strength",
    "aiImage.strengthHint": "Higher strength means bigger changes: around 0.35 is a polish, 0.7 and above repaints the masked area.",
    "aiImage.maskBrush": "Brush",
    "aiImage.maskErase": "Eraser",
    "aiImage.maskUndo": "Undo",
    "aiImage.maskClear": "Clear",
    "aiImage.maskHint": "White areas get repainted; everything else stays as it is.",
    "aiImage.maskEmpty": "Nothing painted yet: the whole image is regenerated at the given strength. Paint white to change only part of it.",
    "aiImage.refEditHint": "This model edits the whole image from a reference; without a mask it follows the prompt directly.",
    "aiImage.refEditMaskHint": "A local area is painted: it will be repainted using both the reference image and the mask.",
    "aiImage.maskLoading": "Preparing the canvas\u2026",
    "aiImage.source": "Source image (media library)",
    "aiImage.runtime": "Runtime",
    "aiImage.noSource": "No image selected yet",
    "aiImage.importImage": "Import image",
    "aiImage.noImageAssets": "No images in the media library yet \u2014 import one first.",
    "aiImage.sizeHint": "Output {width} \xD7 {height} (aligned to the model's requirement)",
    "aiImage.generate": "Generate",
    "aiImage.stop": "Stop",
    "aiImage.elapsed": "Generating\u2026 {seconds}s",
    "aiImage.done": "Generated and inserted on a new top track",
    "aiImage.addFailed": "Could not add to the timeline: {error}",
    "aiImage.result": "Result",
    "aiImage.insertedTop": "inserted on a new top track",
    "aiImage.needPrompt": "Write a prompt first",
    "aiImage.needSource": "Pick an image from the media library first",
    "aiImage.vramHint": "Enable weight offloading when VRAM is tight; 20B-class models should stay at or below 1024p on 16 GB cards.",
    "sdcpp.cpu": "CPU",
    "sdcpp.cpu.note": "Pure CPU; slowest, but runs anywhere.",
    "sdcpp.cpuMac.note": "Force CPU (reuses the installed Metal engine, no extra download; for when Metal fails or memory is tight).",
    "sdcpp.vulkan": "Vulkan",
    "sdcpp.vulkan.note": "Vulkan acceleration for AMD / Intel / NVIDIA.",
    "sdcpp.cuda12": "CUDA 12",
    "sdcpp.cuda12.note": "NVIDIA acceleration; the engine pack bundles the CUDA 12 runtime.",
    "sdcpp.rocm": "ROCm",
    "sdcpp.rocm.note": "AMD acceleration (the Windows pack bundles the HIP runtime; Linux needs ROCm installed); pick Vulkan for NVIDIA / Intel.",
    "sdcpp.metal": "Metal",
    "sdcpp.metal.note": "Apple Silicon GPU acceleration.",
    "sdcpp.installed": "Installed",
    "sdcpp.downloadSize": "Needs {size}",
    "sdcpp.current": "Current",
    "sdcpp.group": "sd.cpp generation engine",
    "sdcpp.groupHint": "Shared image / video runtime; separate from ONNX Runtime.",
    "videoAi.section": "Visual",
    "videoAi.upscale": "AI super resolution",
    "videoAi.interpolate": "AI frame interpolation",
    "videoAi.crop": "AI smart crop",
    "videoAi.track": "AI camera tracking",
    "videoAi.model": "Model",
    "videoAi.scale": "Scale",
    "videoAi.factor": "Frame factor",
    "videoAi.subject": "Subject",
    "videoAi.aspect": "Aspect",
    "videoAi.height": "Height",
    "videoAi.smooth": "Smoothing",
    "videoAi.subjectFace": "Face",
    "videoAi.subjectPerson": "Person",
    "videoAi.subjectAuto": "Auto (face first)",
    "videoAi.subjectCenter": "Center",
    "videoAi.aspectSource": "Source aspect",
    "videoAi.smoothLow": "Low",
    "videoAi.smoothMedium": "Medium",
    "videoAi.smoothHigh": "High",
    "videoAi.apply": "Apply",
    "videoAi.source": "Current clip: {name}",
    "videoAi.selectClip": "Select a video clip on the timeline first",
    "videoAi.selectVisual": "Select a video or image clip on the timeline first",
    "videoAi.downloadModel": "Download model ({size})",
    "videoAi.noModel": "No video model available",
    "videoAi.done": "{name} complete",
    "videoAi.failed": "Video AI failed: {error}",
    "videoAi.cancelled": "Cancelled",
    "videoAi.upscaleHint": "2x is faster, 4x keeps more detail. Export scales to the project output size.",
    "videoAi.interpolateHint": "After interpolating, set the project output to 60 / 120 fps or export will drop frames.",
    "videoAi.cropHint": "Face-first reframing for vertical / square output. Set the project size to the target aspect before export.",
    "videoAi.trackHint": "Person-first tracking for interviews and action shots. Higher smoothing keeps the camera steadier.",
    "ai.modelReady": "Model ready",
    "ai.modelMissing": "Model not downloaded",
    "ai.modelNeedsDownload": "Download \xB7 {size}",
    "ai.subtitles": "Generate captions",
    "ai.subtitleHint": "Transcribe the current media into an editable caption track",
    "ai.subtitleSource": "Source: {name}",
    "ai.subtitleNoSource": "Select an audio or video clip on the timeline first",
    "ai.subtitleNoModel": "No speech-recognition model available. Install one in the download manager.",
    "ai.asrBusy": "Another speech task is running. Try again in a moment.",
    "ai.subtitleModel": "Speech model",
    "ai.subtitleGenerate": "Generate captions",
    "ai.subtitleDownloadModel": "Download model \xB7 {size}",
    "ai.subtitleTrack": "Captions",
    "ai.subtitleDone": "Generated {count} captions",
    "ai.subtitleEmpty": "No speech detected",
    "ai.subtitleFailed": "Caption generation failed: {error}",
    "ai.subtitleCancelled": "Caption generation cancelled",
    "ai.subtitleDownloadingModel": "Downloading model from {source}",
    "ai.manageModels": "Open download manager",
    "ai.voiceover": "AI voiceover",
    "ai.voiceDownload": "Download model",
    "ai.voiceChange": "AI voice change",
    "ai.voiceSave": "Save as voice",
    "ai.voiceImportTitle": "Import voice",
    "ai.voiceSource": "Reference audio",
    "ai.voiceName": "Voice name",
    "ai.voiceUseSelection": "Use selected clip",
    "ai.voiceDelete": "Delete",
    "ai.voiceConfirmDelete": "Delete voice \u201C{name}\u201D?",
    "ai.voiceNeedRuntime": "AI voice change needs the local runtime first",
    "ai.voiceImportHint": "A 10-second clip with speech is picked automatically.",
    "ai.voiceLibraryEmpty": "No voices yet \u2014 import one from the media library or use a selected clip.",
    "ai.voiceChangeTrack": "AI voice",
    "ai.voiceChangeRun": "Convert voice",
    "ai.voiceLibrary": "Voice library",
    "ai.voiceFromMedia": "Pick from media\u2026",
    "ai.voiceImported": "Imported voice \u201C{name}\u201D",
    "ai.voiceTooShort": "Reference audio too short \u2014 needs at least 3 seconds of speech",
    "ai.voiceNoAudio": "This asset has no audio",
    "ai.voiceNoVoice": "Choose a voice before converting",
    "ai.voicePickClips": "Clips to convert",
    "ai.voiceModel": "Voice model",
    "ai.voiceEncoding": "Voice model needs a download",
    "ai.voiceEmpty": "Select the clips to convert on the timeline first",
    "ai.voiceoverHint": "Turn selected text clips into speech at their original timing; overlapping audio is split across tracks",
    "ai.voiceoverModel": "Voice model",
    "ai.voiceoverVoice": "Voice source",
    "ai.voiceoverTimbre": "Voice",
    "ai.voiceoverVoiceBuiltin": "Built-in voice",
    "ai.voiceoverVoiceReference": "Media reference",
    "ai.ttsSettings": "Configure TTS services\u2026",
    "ai.ttsSettingsHint": "Add any provider's TTS API, including custom endpoints",
    "ai.voiceoverLocal": "Local models",
    "ai.voiceoverCloud": "Cloud services",
    "ai.voiceoverCloudVoice": "Voice {voice}",
    "ai.voiceoverCloudHint": "Configured cloud TTS service",
    "ai.voiceoverCloudNote": "Cloud synthesis \xB7 {name} \xB7 {voice}",
    "ai.voiceoverCloudNoteNoVoice": "Cloud synthesis \xB7 {name}",
    "ai.voiceoverReference": "Reference audio",
    "ai.voiceoverReferenceMissing": "Pick media with audio from the library first",
    "ai.voiceoverReferenceEmpty": "No usable audio in the media library yet. Import the audio you want to imitate there first.",
    "ai.voiceoverReferenceText": "Reference text",
    "ai.voiceoverReferenceTextPlaceholder": "Exact words spoken in the reference audio",
    "ai.voiceoverReferenceTextHint": "ZipVoice needs the exact transcript of the reference audio. Type it or auto-transcribe.",
    "ai.voiceoverReferenceTextNoAsr": "No speech-recognition model installed. Type the text manually, or install one in the download manager to auto-transcribe.",
    "ai.voiceoverReferenceTextMissing": "Enter the reference transcript first, or use auto-transcribe.",
    "ai.voiceoverTranscribe": "Auto transcribe",
    "ai.voiceoverTranscribing": "Transcribing\u2026",
    "ai.voiceoverTranscribeFailed": "Reference transcription failed: {error}",
    "ai.voiceoverGenerate": "Generate voiceover",
    "ai.voiceoverDownloadModel": "Download model \xB7 {size}",
    "ai.voiceoverDownloadingModel": "Downloading voice model from {source}",
    "ai.voiceoverSelected": "{count} text clips selected",
    "ai.voiceoverNoText": "Select one or more text clips first",
    "ai.voiceoverNoModel": "Pick a voice model or configure a cloud TTS service first",
    "ai.voiceoverTrack": "Voiceover",
    "ai.voiceoverDone": "Generated {count} voiceover clips",
    "ai.voiceoverFailed": "Voiceover failed: {error}",
    "ai.voiceoverCancelled": "Voiceover cancelled",
    "ai.voiceName.junhao": "Junhao",
    "ai.voiceName.zhiming": "Zhiming \xB7 Beijing",
    "ai.voiceName.weiguo": "Weiguo \xB7 Storyteller",
    "ai.voiceName.xiaoyu": "Xiaoyu \xB7 Star",
    "ai.voiceName.yuewen": "Yuewen \xB7 Rider",
    "ai.voiceName.lingyu": "Lingyu \xB7 Late-night radio",
    "ai.voiceName.leijun": "Leijun (default)",
    "ai.voiceGroup.chinese-male": "Chinese male",
    "ai.voiceGroup.chinese-female": "Chinese female",
    "ai.voiceGroup.english-male": "English male",
    "ai.voiceGroup.english-female": "English female",
    "ai.voiceGroup.japanese-male": "Japanese male",
    "ai.voiceGroup.japanese-female": "Japanese female",
    "ai.voiceGroup.korean-male": "Korean male",
    "ai.voiceGroup.korean-female": "Korean female",
    "ai.voiceGroup.other": "Other voices",
    // ---- Download manager ----
    "models.title": "Download manager",
    "models.tab.models": "Models",
    "models.tab.plugins": "Plugins",
    "models.tab.installed": "Installed",
    "models.tab.available": "Available",
    "models.subCounts": "{installed} installed \xB7 {available} available",
    "models.searchPlaceholder": "Search plugins, models, runtimes\u2026",
    "models.kindFilter": "Kind filter",
    "models.kind.all": "All",
    "models.kind.plugin": "Plugins",
    "models.kind.model": "Models",
    "models.kind.runtime": "Runtimes",
    // ---- Local AI runtimes ----
    "runtime.title": "Runtimes",
    "runtime.hint": "CPU / DirectML / CoreML built in; CUDA 12 / 13 on demand, restart to apply.",
    "runtime.partsTitle": "CUDA components",
    "runtime.empty": "No runtimes to download.",
    "runtime.autoDownloading": "CUDA runtime components are missing; downloading {count} item(s)\u2026",
    "runtime.bundled": "Bundled",
    "runtime.installed": "Installed",
    "runtime.notInstalled": "Not installed",
    "runtime.partsNote": "Missing components install automatically when switching to CUDA",
    "runtime.cuda12Parts": "CUDA 12 components",
    "runtime.cuda12PartsHint": "Missing components are filled in when switching to CUDA 12.",
    "runtime.cuda13Parts": "CUDA 13 components",
    "runtime.cuda13PartsHint": "Missing components are filled in when switching to CUDA 13.",
    "runtime.restartBody": "Newly installed runtimes / CUDA components load on the next start.",
    "runtime.restartNow": "Restart now",
    "runtime.restartLater": "Later",
    "runtime.cudart": "CUDA Runtime 12 (cudart)",
    "runtime.cudart.note": "CUDA 12 runtime component.",
    "runtime.cublas": "cuBLAS 12",
    "runtime.cublas.note": "CUDA 12 matrix library.",
    "runtime.cufft": "cuFFT 11 (CUDA 12)",
    "runtime.cufft.note": "CUDA 12 FFT library.",
    "runtime.cudnn": "cuDNN 9 (CUDA 12)",
    "runtime.cudnn.note": "CUDA 12 neural network library.",
    "runtime.cudart13": "CUDA Runtime 13 (cudart)",
    "runtime.cudart13.note": "CUDA 13 runtime component.",
    "runtime.cublas13": "cuBLAS 13",
    "runtime.cublas13.note": "CUDA 13 matrix library.",
    "runtime.cufft13": "cuFFT 12 (CUDA 13)",
    "runtime.cufft13.note": "CUDA 13 FFT library.",
    "runtime.cudnn13": "cuDNN 9 (CUDA 13)",
    "runtime.cudnn13.note": "CUDA 13 neural network library.",
    "runtime.cpu": "CPU",
    "runtime.cpu.note": "Plain CPU build (bundled, works everywhere).",
    "runtime.directml": "DirectML",
    "runtime.directml.note": "DirectX 12 hardware acceleration on Windows (bundled, with CPU fallback).",
    "runtime.coreml": "Apple CoreML",
    "runtime.coreml.note": "Apple Neural Engine / GPU (bundled).",
    "runtime.cuda": "ONNX Runtime (CUDA 12)",
    "runtime.cuda.note": "Older NVIDIA cards / drivers < 580; components included.",
    "runtime.cuda13": "ONNX Runtime (CUDA 13)",
    "runtime.cuda13.note": "Newer NVIDIA cards / driver 580+; components included.",
    "models.pluginsSub": "{count} plugin downloads available",
    "models.subPlugins": "Install, import and update OpenFX plugins",
    "models.sub": "{installed} / {total} models installed",
    "models.bundlePolicy": "Only models under 10 MB can ship with the app; larger models are downloaded on demand.",
    "models.filter": "Model filter",
    "models.filter.all": "All",
    "models.filter.installed": "Installed",
    "models.filter.available": "Available",
    "models.bundled": "Bundled",
    "models.bundleEligible": "\u226410MB",
    "models.installed": "Installed",
    "models.recommended": "Recommended",
    "models.license": "License",
    "models.licenseTier.permissive": "Permissive",
    "models.licenseTier.community": "Community license",
    "models.licenseTier.rail": "RAIL",
    "models.licenseTier.sharealike": "Share-alike",
    "models.licenseTier.noncommercial": "Non-commercial",
    "models.licenseTier.upstream": "Upstream terms",
    "models.licenseHint.permissive": "Permissive license: commercial use allowed",
    "models.licenseHint.community": "Community license: commercial use is allowed but carries thresholds and extra conditions (attribution, acceptable use, company size or revenue) \u2014 check the upstream license before shipping commercially",
    "models.licenseHint.rail": "CreativeML Open RAIL: commercial use is allowed, but the use-based restrictions must be passed on when redistributing",
    "models.licenseHint.sharealike": "CC BY-SA: commercial use is allowed, but adaptations must be shared under the same license with attribution",
    "models.licenseHint.noncommercial": "Non-commercial only: the weights may not be used commercially",
    "models.licenseHint.upstream": "No explicit upstream license: clear commercial use with the authors",
    "models.licenseConfirmTitle": "Download \u201C{name}\u201D?",
    "models.licenseConfirmMessage": "These weights are licensed \u201C{license}\u201D. {note} Make sure your use complies before downloading.",
    "models.licenseConfirmOk": "I understand \u2014 download",
    "models.fileProgress": "{done}/{total} files downloaded",
    "models.reusableHint": "{size} can be reused from a model already on disk; it will not be downloaded again.",
    "models.sharedHint": "{size} is shared with another model (hard links where supported, copies otherwise); deleting this one keeps the other working.",
    "models.download": "Download \xB7 {size}",
    "models.reinstall": "Reinstall",
    "models.cancel": "Cancel",
    "models.remove": "Delete",
    "models.confirmRemove": "Confirm delete",
    "models.reveal": "Show in folder",
    "models.refresh": "Refresh",
    "models.empty": "No matching models",
    "models.feature.asr": "Speech recognition",
    "models.feature.vad": "Voice detection",
    "models.feature.tts": "Speech synthesis",
    "models.feature.tts-codec": "Audio tokenizer",
    "models.feature.align": "Alignment",
    "models.feature.enhance": "Audio denoise",
    "models.feature.separate": "Source separation",
    "models.feature.interpolate": "Frame interpolation",
    "models.feature.superres": "Super resolution",
    "models.feature.track": "Object tracking",
    "models.feature.reframe": "Smart crop",
    "models.feature.video-gen": "Video generation",
    "models.feature.image-gen": "Image generation",
    "models.feature.voice-change": "AI voice change",
    "models.sourceSettings": "Source",
    "models.sourceSettingsHint": "Adjust mirrors, source region and model mirror URLs on the \u201CNetwork\u201D page in settings",
    "models.sourceLine": "Sources",
    "models.testSource": "Test sources",
    "models.probing": "Testing\u2026",
    "models.probeFailed": "Unavailable",
    "models.sources.both": "CN + international",
    "models.sources.cn": "China only",
    "models.sources.intl": "International only",
    "models.source.modelscope": "ModelScope",
    "models.source.huggingface": "HuggingFace",
    "models.source.github": "GitHub",
    "models.source.mirror": "Custom mirror",
    "models.source.unknown": "Download source",
    "models.downloadingFrom": "Downloading from {source}",
    // ---- OFX plugins ----
    "plugins.title": "OFX plugins",
    "plugins.sub": "{installed} installed \xB7 {total} in registry",
    "plugins.installedSub": "{count} installed",
    "plugins.manage": "Manage plugins",
    "plugins.noInstalled": "No OFX plugins installed",
    "plugins.noInstalledHint": "Open the download manager to install or import plugins.",
    "plugins.openInterface": "Parameters",
    // ---- Parameter pane ----
    "plugins.editorTitle": "Parameters",
    "plugins.editorNoSelection": "No effect selected",
    "plugins.editorNoSelectionHint": "Open parameters from an effect card in the inspector, or pick a plugin in the OFX plugins pane to view its defaults.",
    "plugins.editorNoParams": "This plugin declares no parameters.",
    "plugins.editorReadonly": "Read-only",
    "plugins.editorReadonlyHint": "Showing default values. Add the plugin to a clip to edit its parameters.",
    "plugins.editorChoosePlugin": "Choose plugin",
    "plugins.editorOpenInspector": "Open inspector",
    "plugins.editorTargetMissing": "This effect no longer exists.",
    "plugins.editorClear": "Clear selection",
    "plugins.editorProbeFailed": "Could not read plugin parameters",
    "plugins.manager.tabInstalled": "Installed",
    "plugins.manager.tabExternal": "External",
    "plugins.manager.tabAvailable": "Available",
    "plugins.manager.import": "Import plugin",
    "plugins.manager.importBundle": "Import .ofx.bundle",
    "plugins.manager.importBundleHint": "Pick an .ofx.bundle package or folder",
    "plugins.manager.importFile": "Import .ofx / archive",
    "plugins.manager.importFileHint": "Pick an .ofx binary or a zip / tar.gz archive",
    "plugins.manager.imported": "Plugin imported",
    "plugins.manager.searchInstalled": "Search installed plugins",
    "plugins.manager.searchAvailable": "Search plugins",
    "plugins.manager.typeFilter": "Plugin type",
    "plugins.manager.compatibleOnly": "Compatible only",
    "plugins.manager.count": "{shown} / {total}",
    "plugins.manager.externalHint": "Plugins installed outside AI Cut in the standard OFX folders. Read-only.",
    "plugins.manager.emptyInstalled": "No managed plugins installed",
    "plugins.manager.emptyExternal": "No external OFX plugins found",
    "plugins.manager.emptyExternalHint": "Install plugins into a standard OFX folder or import a local .ofx.bundle.",
    "plugins.manager.emptyAvailable": "No matching plugins",
    "plugins.manager.emptyAvailableHint": "Refresh the registry or adjust the filters.",
    "plugins.search": "Search plugins",
    "plugins.filter": "Plugin filter",
    "plugins.filter.all": "All",
    "plugins.filter.installed": "Installed",
    "plugins.filter.available": "Available",
    "plugins.filter.updates": "Updates",
    "plugins.sourceLabel": "Registry source",
    "plugins.source.network": "GitHub",
    "plugins.source.cache": "Cache",
    "plugins.source.stale-cache": "Offline cache",
    "plugins.source.bundled": "Bundled snapshot",
    "plugins.refresh": "Refresh registry",
    "plugins.settings": "Registry settings",
    "plugins.importBundle": "Import .ofx.bundle",
    "plugins.importFile": "Import .ofx / archive",
    "plugins.installed": "Installed",
    "plugins.updateAvailable": "Update available",
    "plugins.install": "Install \xB7 {size}",
    "plugins.installNoSize": "Install",
    "plugins.update": "Update to {version}",
    "plugins.openPage": "Open download page",
    "plugins.remove": "Delete",
    "plugins.confirmRemove": "Confirm delete",
    "plugins.reveal": "Show in folder",
    "plugins.cancel": "Cancel",
    "plugins.license": "License",
    "plugins.gplUpstream": "GPL upstream",
    "plugins.type.filter": "Filter",
    "plugins.type.generator": "Generator",
    "plugins.type.transition": "Transition",
    "plugins.type.general": "General",
    "plugins.type.paint": "Paint",
    "plugins.type.retimer": "Retimer",
    "plugins.system.mac": "macOS",
    "plugins.system.win": "Windows",
    "plugins.system.linux": "Linux",
    "plugins.incompatible": "Not compatible",
    "plugins.externalPlugin": "External",
    "plugins.externalOnly": "External download only",
    "plugins.noResults": "No matching plugins",
    "plugins.loading": "Loading registry\u2026",
    "plugins.downloadingFrom": "{phase}\u2026",
    "plugins.phase.downloading": "Downloading",
    "plugins.phase.extracting": "Extracting",
    "plugins.phase.installing": "Installing",
    "plugins.phase.done": "Done",
    "plugins.phase.error": "Failed",
    // ---- Settings: AI / MCP / network / CLI ----
    "settings.section.text": "Text generation",
    "settings.section.text.caption": "Text-model providers (agent & canvas nodes)",
    "settings.section.ai": "AI / MCP",
    "settings.section.ai.caption": "MCP & local execution backend",
    "settings.section.asr": "Speech recognition",
    "settings.section.asr.caption": "Cloud speech recognition services and custom endpoints",
    "settings.asr.providers": "Recognition services",
    "settings.asr.empty": "No recognition service configured yet. Use \u201CAdd service\u201D below to start.",
    "settings.asr.add": "Add service",
    "settings.asr.edit": "Edit service",
    "settings.asr.new": "New service",
    "settings.asr.name": "Name",
    "settings.asr.nameHint": "Shown in the subtitle model dropdown",
    "settings.asr.kind": "API type",
    "settings.asr.kindHint": "Standard HTTP APIs only",
    "settings.asr.enabled": "Enabled",
    "settings.asr.enabledHint": "Disabled services are hidden from the subtitle dropdown",
    "settings.asr.baseUrl": "Base URL",
    "settings.asr.baseUrlDeepseekHint": "Empty = https://api.deepseek.com",
    "settings.asr.baseUrlOpenaiHint": "Enter up to /v1",
    "settings.asr.apiKey": "API key",
    "settings.asr.apiKeyHint": "Stored locally in asr.json",
    "settings.asr.azureKeyHint": "Key of your Azure Speech resource",
    "settings.asr.googleKeyHint": "Google Cloud API key",
    "settings.asr.aliyunKeyHint": "Bailian DashScope API key",
    "settings.asr.baiduKeyHint": "Baidu Speech API key",
    "settings.asr.secretId": "SecretId",
    "settings.asr.secretIdHint": "Tencent Cloud API SecretId",
    "settings.asr.secretKey": "SecretKey",
    "settings.asr.secretKeyHint": "Tencent Cloud API SecretKey",
    "settings.asr.baiduSecretHint": "Baidu Speech secret key",
    "settings.asr.accessKey": "Access key",
    "settings.asr.accessKeyHint": "Volcengine access key",
    "settings.asr.appId": "App ID",
    "settings.asr.appIdHint": "Tencent Cloud account AppId",
    "settings.asr.volcAppIdHint": "Volcengine application AppId",
    "settings.asr.region": "Region",
    "settings.asr.regionHint": "e.g. eastasia, eastus",
    "settings.asr.resourceId": "Resource ID",
    "settings.asr.resourceIdHint": "e.g. volc.bigasr.auc_turbo",
    "settings.asr.model": "Model",
    "settings.asr.modelHint": "Model name supported by the API",
    "settings.asr.aliyunModelHint": "e.g. qwen3-asr-flash",
    "settings.asr.engine": "Engine",
    "settings.asr.engineHint": "e.g. 16k_zh",
    "settings.asr.devPid": "Model id",
    "settings.asr.devPidHint": "e.g. 1537 (Mandarin)",
    "settings.asr.language": "Language",
    "settings.asr.languageHint": "e.g. zh, en; empty = auto",
    "settings.asr.azureLanguageHint": "e.g. zh-CN",
    "settings.asr.maxSeconds": "Max audio per request",
    "settings.asr.maxSecondsHint": "Seconds; 0 = preset for this API",
    "settings.asr.method": "Method",
    "settings.asr.methodHint": "GET or POST",
    "settings.asr.headers": "Headers (JSON)",
    "settings.asr.headersHint": 'e.g. {"Authorization":"Bearer x"}',
    "settings.asr.body": "Body template",
    "settings.asr.bodyHint": "Supports {{audio}} (base64) and {{mime}}",
    "settings.asr.textPath": "Text field path",
    "settings.asr.textPathHint": "e.g. data.text; empty = whole response",
    "settings.asr.wordsPath": "Word timing path",
    "settings.asr.wordsPathHint": "Items need text/word, start, end (seconds)",
    "settings.asr.url": "Request URL",
    "settings.asr.urlHint": "Supports the {{audio}} placeholder",
    "settings.asr.customKeyHint": "Empty = no Authorization header",
    "settings.asr.customHint": "Self-hosted service: build the body with {{audio}} / {{mime}}, then point the text field path at the result; add a word timing path if it returns timings.",
    "settings.asr.test": "Test",
    "settings.asr.testing": "Testing\u2026",
    "settings.asr.testNoMedia": "No audio or video in the media library \u2014 import one first",
    "settings.asr.testOk": "Transcript: {text}",
    "settings.asr.save": "Save",
    "settings.asr.saving": "Saving\u2026",
    "settings.asr.saved": "Recognition service saved",
    "settings.asr.delete": "Delete",
    "settings.asr.deleteTitle": "Delete recognition service?",
    "settings.asr.deleteMessage": "The API configuration for \u201C{name}\u201D will be removed.",
    "settings.asr.kind.openai": "OpenAI compatible",
    "settings.asr.kind.deepseek": "DeepSeek",
    "settings.asr.kind.azure": "Azure Speech",
    "settings.asr.kind.google": "Google Cloud STT",
    "settings.asr.kind.aliyun": "Aliyun Bailian",
    "settings.asr.kind.tencent": "Tencent Cloud",
    "settings.asr.kind.volcengine": "Volcengine",
    "settings.asr.kind.baidu": "Baidu Speech",
    "settings.asr.kind.custom": "Custom HTTP",
    "ai.asrSettings": "Configure speech-recognition services\u2026",
    "ai.asrSettingsHint": "Add any provider's recognition API, including custom endpoints",
    "ai.asrLocalGroup": "Local models",
    "ai.asrCloudGroup": "Cloud recognition",
    "caps.feature.cloudAsr": "Cloud speech recognition",
    "settings.section.tts": "Speech synthesis",
    "settings.section.tts.caption": "Cloud TTS services and custom endpoints",
    "settings.section.gen": "Image & video",
    "settings.section.gen.caption": "Cloud text-to-image, image-to-image and video APIs",
    "settings.section.network": "Network",
    "settings.section.network.caption": "Proxy, mirrors & model sources",
    "settings.section.cli": "Command line",
    "settings.section.cli.caption": "Use aicut from a terminal",
    "settings.text.providers": "Configured providers",
    "settings.text.empty": "No text-model provider yet. Add one below \u2014 you can keep several at once (OpenAI / DeepSeek / local Ollama \u2026).",
    "settings.text.add": "Add provider",
    "settings.text.edit": "Edit provider",
    "settings.text.new": "New provider",
    "settings.text.provider": "Provider",
    "settings.text.providerHint": "Picking one fills its compatible endpoint and a default model; everything stays editable.",
    "settings.text.providerPlaceholder": "Choose a provider",
    "settings.text.providerNoteFallback": "OpenAI-compatible endpoint: the backend appends /chat/completions.",
    "settings.text.customPreset": "Custom endpoint",
    "settings.text.name": "Name",
    "settings.text.nameHint": "Shown in the model list; useful when the same vendor is configured twice.",
    "settings.text.baseUrl": "Endpoint",
    "settings.text.baseUrlHint": "OpenAI-compatible endpoint (the backend appends /chat/completions)",
    "settings.text.baseUrlPlaceholder": "https://api.openai.com/v1",
    "settings.text.apiKey": "API key",
    "settings.text.apiKeyHint": "Stored locally in ai.json",
    "settings.text.apiKeyLocalHint": "Local endpoints usually need no key; it can stay empty",
    "settings.text.apiKeyPlaceholder": "sk-\u2026",
    "settings.text.apiKeyOptional": "Optional for local endpoints",
    "settings.text.model": "Default model",
    "settings.text.modelHint": "Used when a node picks no model; prefer a tool-calling model (the agent needs it)",
    "settings.text.modelPlaceholder": "gpt-4.1-mini",
    "settings.text.modelEmpty": "Fetch the model list first, or type a model id",
    "settings.text.models": "Model list",
    "settings.text.modelsHint": "One per line; the text node lists these models from every enabled provider.",
    "settings.text.modelsPlaceholder": "Leave empty to expose only the default model",
    "settings.text.enabled": "Enabled",
    "settings.text.enabledHint": "Text nodes only list enabled providers; the first enabled one serves the clip agent.",
    "settings.text.enabledOn": "Enabled",
    "settings.text.enabledOff": "Disabled",
    "settings.text.noModel": "No model",
    "settings.text.modelCount": "{count} models",
    "settings.text.fetchModels": "Fetch models",
    "settings.text.fetching": "Fetching\u2026",
    "settings.text.test": "Test connection",
    "settings.text.testing": "Testing\u2026",
    "settings.text.save": "Save",
    "settings.text.saved": "Provider saved",
    "settings.text.deleted": "Provider deleted",
    "settings.text.deleteTitle": "Delete provider",
    "settings.text.deleteMessage": "\u201C{name}\u201D will be removed from text generation; connected nodes must pick a model again.",
    "settings.text.probeOk": "Connected: {detail} ({ms} ms)",
    "settings.text.probeFail": "Connection failed: {detail}",
    "settings.text.baseUrlRequired": "Enter an endpoint first",
    "settings.text.modelRequired": "Choose a default model",
    "settings.text.keyRequired": "This provider needs an API key",
    "settings.text.noModelList": "This provider has no model list endpoint; type the model id",
    "settings.text.modelsFound": "{count} models found",
    "settings.text.tip": "Every text-model provider lives here: the clip agent and canvas text nodes share this config. Nodes pick their own \u201Cmodel \xB7 provider\u201D.",
    "settings.text.group.cloud": "Cloud services",
    "settings.text.group.aggregator": "Aggregators",
    "settings.text.group.local": "Local / self-hosted",
    "settings.text.group.custom": "Custom",
    "settings.text.localKey": "Local, key optional",
    "settings.ai.title": "Clip agent",
    "settings.ai.baseUrl": "Base URL",
    "settings.ai.baseUrlHint": "OpenAI-compatible endpoint",
    "settings.ai.baseUrlPlaceholder": "https://api.openai.com/v1",
    "settings.ai.apiKey": "API key",
    "settings.ai.apiKeyHint": "Stored locally in ai.json",
    "settings.ai.apiKeyPlaceholder": "sk-\u2026",
    "settings.ai.model": "Model",
    "settings.ai.modelHint": "Must support tool calls",
    "settings.ai.modelPlaceholder": "gpt-4o-mini",
    "settings.ai.modelEmpty": "No model selected",
    "settings.ai.fetchModels": "Fetch models",
    "settings.ai.fetching": "Fetching\u2026",
    "settings.ai.test": "Test connection",
    "settings.ai.testing": "Testing\u2026",
    "settings.ai.save": "Save",
    "settings.ai.saved": "Saved",
    "settings.ai.probeOk": "Connected: {detail} ({ms} ms)",
    "settings.ai.probeFail": "Failed: {detail}",
    "settings.ai.backendGroup": "Local AI execution backend",
    "settings.ai.ortGroup": "ONNX Runtime backend (ASR / audio / visual)",
    "settings.ai.sdcppGroup": "sd.cpp backend (video / image generation)",
    "settings.ai.sdcppHint": "Separate from ONNX Runtime; applies on the next run.",
    "settings.ai.sdcppMissing": "The sd.cpp engine is not installed",
    "settings.ai.sdcppOpen": "Open download manager",
    "settings.ai.sdcppApplied": "Video backend switched to {backend} (next run)",
    "settings.ai.sdcppNeedDownload": '"{backend}" needs the sd.cpp engine ({size}). Open the download manager now?',
    "settings.ai.sdcppDownloadGo": "Download",
    "settings.ai.backend": "Execution backend",
    "settings.ai.backendHint": "Which ONNX Runtime runs the local models; only usable options are listed.",
    "settings.ai.platform": "This device: {platform}",
    "settings.ai.backendUnsupported": "Not included in this ONNX Runtime build",
    "settings.ai.backendUnavailableHint": "Unavailable backends need their runtime installed first (download manager \u2192 Runtimes).",
    "settings.ai.cudaRuntimeHint": "Install the CUDA runtime in the download manager \u2192 Runtimes, then restart and pick CUDA here.",
    "settings.ai.backendCpuFaster": "These local models are usually faster on CPU; CoreML / DirectML only help for some models.",
    "settings.ai.cudaCoreMissing": "The CUDA {version} runtime itself is not downloaded yet (download manager \u2192 Runtimes).",
    "settings.ai.cudaPartsMissing": "CUDA components are incomplete: {parts}. Install them and restart to actually use the GPU.",
    "settings.ai.cudaNotActive": "CUDA is not active (provider registration failed); this session falls back to CPU. Restart the app, and reinstall the CUDA components if it persists.",
    "settings.ai.backendAppliedCurrent": "Switched to {backend}; the current session is already using it \u2014 no restart needed.",
    "settings.ai.backendAppliedNext": "Switched to {backend}; it takes effect the next time an AI session is created \u2014 no restart needed.",
    "settings.mcp.server": "MCP server",
    "settings.mcp.enable": "Enable MCP server",
    "settings.mcp.enableHint": "Listens on loopback only",
    "settings.mcp.port": "Port",
    "settings.mcp.portHint": "0 = ephemeral; falls back automatically if busy",
    "settings.mcp.status": "Status",
    "settings.mcp.running": "Running",
    "settings.mcp.stopped": "Stopped",
    "settings.mcp.notListening": "Not listening",
    "settings.mcp.portConflict": "Port conflict",
    "settings.mcp.portConflictBusy": "Port {port} is taken by another program (possibly a second AI Cut instance), so this run uses ephemeral port {bound}. Point external clients at the endpoint below.",
    "settings.mcp.portConflictDenied": "Port {port} is reserved by the system or needs privileges (Windows Hyper-V / WSL excluded ranges, ports below 1024), so this run uses ephemeral port {bound}. Point external clients at the endpoint below.",
    "settings.mcp.usage": "Endpoint",
    "settings.mcp.endpoint": "MCP endpoint",
    "settings.mcp.copy": "Copy",
    "settings.mcp.security": "Security",
    "settings.mcp.securityHint": "Loopback only. Any local process can connect \u2014 only run trusted harnesses.",
    "settings.skills.group": "Skills",
    "settings.skills.title": "Bundled skills",
    "settings.skills.hint": "Skill docs are served on demand through the aicut_help tool; the CLI is a thin MCP client.",
    "settings.skills.openCli": "Open CLI settings",
    "settings.skills.mount": "Mount the aicut command",
    "settings.skills.mountHint": "Lets skills and terminals call aicut directly; the full path works even when unmounted.",
    "settings.gen.providers": "Generation services",
    "settings.gen.lead": "Official APIs first: OpenAI, Google Gemini, Stability, FLUX, Alibaba Bailian, Volcengine Ark, Kling, MiniMax, Runway, Luma; aggregators second: OpenRouter, SiliconFlow, Replicate, fal.ai.",
    "settings.gen.empty": "No generation service yet. Use \u201CAdd service\u201D below to start.",
    "settings.gen.add": "Add service",
    "settings.gen.edit": "Edit service",
    "settings.gen.new": "New service",
    "settings.gen.name": "Name",
    "settings.gen.nameHint": "Shown in the AI page model dropdown",
    "settings.gen.kind": "API type",
    "settings.gen.kindHint": "The base URL and default models are filled in automatically",
    "settings.gen.groupOfficial": "Official APIs",
    "settings.gen.groupAggregator": "Aggregators",
    "settings.gen.enabled": "Enabled",
    "settings.gen.enabledHint": "Disabled services are hidden from the AI page dropdown",
    "settings.gen.enabledOn": "Enabled",
    "settings.gen.enabledOff": "Disabled",
    "settings.gen.cap.t2i": "Text to image",
    "settings.gen.cap.t2iHint": "Generate an image straight from a prompt",
    "settings.gen.cap.i2i": "Image to image",
    "settings.gen.cap.i2iHint": "Edit a library image by instruction / reference",
    "settings.gen.cap.video": "Video",
    "settings.gen.cap.videoHint": "Text to video; services with first-frame support also do image to video",
    "settings.gen.baseUrl": "Base URL",
    "settings.gen.baseUrlHint": "Empty = official endpoint; proxies and gateways work too",
    "settings.gen.apiKey": "API key",
    "settings.gen.apiKeyHint": "Stored locally in cloud-gen.json",
    "settings.gen.apiSecret": "Secret key",
    "settings.gen.apiSecretHint": "Kling needs both the Access Key and the Secret Key",
    "settings.gen.groupId": "Group ID",
    "settings.gen.groupIdHint": "MiniMax account GroupId",
    "settings.gen.imageModel": "Text-to-image model",
    "settings.gen.imageModelHint": "e.g. gpt-image-1, qwen-image, gemini-2.5-flash-image",
    "settings.gen.editModel": "Image-to-image model",
    "settings.gen.editModelHint": "e.g. qwen-image-edit, flux-kontext-pro",
    "settings.gen.videoModel": "Video model",
    "settings.gen.videoModelHint": "e.g. doubao-seedance-1-0-pro, kling-v2-1, veo-3.1",
    "settings.gen.test": "Test",
    "settings.gen.testing": "Testing\u2026",
    "settings.gen.testHint": "Generates a 512 test image with the current config; may incur a charge",
    "settings.gen.testOk": "Test passed: {width} \xD7 {height}",
    "settings.gen.save": "Save",
    "settings.gen.saving": "Saving\u2026",
    "settings.gen.saved": "Generation service saved",
    "settings.gen.delete": "Delete",
    "settings.gen.deleteTitle": "Delete generation service?",
    "settings.gen.deleteMessage": "The API configuration for \u201C{name}\u201D will be removed.",
    "settings.gen.kind.openai": "OpenAI",
    "settings.gen.kind.gemini": "Google Gemini",
    "settings.gen.kind.stability": "Stability AI",
    "settings.gen.kind.bfl": "Black Forest Labs (FLUX)",
    "settings.gen.kind.dashscope": "Alibaba Bailian",
    "settings.gen.kind.ark": "Volcengine Ark (Doubao)",
    "settings.gen.kind.kling": "Kling",
    "settings.gen.kind.minimax": "MiniMax Hailuo",
    "settings.gen.kind.runway": "Runway",
    "settings.gen.kind.luma": "Luma AI",
    "settings.gen.kind.replicate": "Replicate",
    "settings.gen.kind.fal": "fal.ai",
    "settings.gen.kind.openrouter": "OpenRouter",
    "settings.gen.kind.siliconflow": "SiliconFlow",
    "settings.tts.providers": "TTS services",
    "settings.tts.empty": "No TTS service configured yet. Use \u201CAdd service\u201D below to start.",
    "settings.tts.add": "Add service",
    "settings.tts.edit": "Edit service",
    "settings.tts.new": "New service",
    "settings.tts.noVoice": "No voice set",
    "settings.tts.enabledOn": "Enabled",
    "settings.tts.enabledOff": "Disabled",
    "settings.tts.name": "Name",
    "settings.tts.nameHint": "Shown in the voiceover model dropdown",
    "settings.tts.kind": "API type",
    "settings.tts.kindHint": "Standard HTTP APIs only",
    "settings.tts.enabled": "Enabled",
    "settings.tts.enabledHint": "Disabled services are hidden from the voiceover dropdown",
    "settings.tts.baseUrl": "Base URL",
    "settings.tts.baseUrlOpenaiHint": "Enter up to /v1; /audio/speech is appended automatically",
    "settings.tts.baseUrlElevenHint": "Empty = https://api.elevenlabs.io/v1",
    "settings.tts.baseUrlMinimaxHint": "Empty = https://api.minimax.chat",
    "settings.tts.baseUrlVolcHint": "Empty = official unidirectional endpoint",
    "settings.tts.url": "Request URL",
    "settings.tts.urlHint": "GET supports {{text}}, {{voice}} and other placeholders",
    "settings.tts.apiKey": "API key",
    "settings.tts.apiKeyHint": "Stored locally in tts.json",
    "settings.tts.apiKeyGoogleHint": "Google Cloud API key; proxy URLs are fine too",
    "settings.tts.apiSecret": "Secret key",
    "settings.tts.apiSecretHint": "Baidu Speech secret key",
    "settings.tts.appId": "App ID",
    "settings.tts.appIdHint": "Volcengine application App ID",
    "settings.tts.accessKey": "Access key",
    "settings.tts.accessKeyHint": "Volcengine Access Key",
    "settings.tts.groupId": "Group ID",
    "settings.tts.groupIdHint": "MiniMax account GroupId",
    "settings.tts.region": "Region",
    "settings.tts.regionHint": "e.g. eastasia, eastus",
    "settings.tts.model": "Model",
    "settings.tts.modelHint": "Model name supported by the API",
    "settings.tts.modelElevenHint": "e.g. eleven_multilingual_v2",
    "settings.tts.modelMiniMaxHint": "e.g. speech-01",
    "settings.tts.resourceId": "Resource ID",
    "settings.tts.resourceIdHint": "e.g. volc_tts_release, seed-tts-2.0",
    "settings.tts.voice": "Default voice",
    "settings.tts.voiceHint": "Voice ID required by the provider",
    "settings.tts.voiceId": "Voice ID",
    "settings.tts.voiceIdHint": "ElevenLabs voice ID",
    "settings.tts.voiceAzureHint": "e.g. zh-CN-XiaoxiaoNeural",
    "settings.tts.voiceGoogleHint": "e.g. cmn-CN-Wavenet-A",
    "settings.tts.voiceBaiduHint": "Baidu persona id, e.g. 0, 3, 5118",
    "settings.tts.voiceVolcHint": "e.g. zh_female_cancan_mars_bigtts",
    "settings.tts.format": "Output format",
    "settings.tts.formatHint": "MP3 by default; PCM is wrapped with a WAV header",
    "settings.tts.speed": "Speed",
    "settings.tts.speedHint": "1.0 = original speed",
    "settings.tts.volume": "Volume",
    "settings.tts.volumeHint": "1.0 = original volume",
    "settings.tts.pitch": "Pitch",
    "settings.tts.pitchHint": "0 = original pitch",
    "settings.tts.method": "Method",
    "settings.tts.methodHint": "GET uses query parameters, POST uses JSON",
    "settings.tts.headers": "Headers (JSON)",
    "settings.tts.headersHint": "Supports {{api_key}} and {{api_secret}} placeholders",
    "settings.tts.customKeyHint": "Empty = no Authorization header; you can also set it here",
    "settings.tts.body": "Body template",
    "settings.tts.bodyHint": "Supports {{text}}, {{voice}}, {{speed}}, {{format}} placeholders",
    "settings.tts.audioPath": "Audio field path",
    "settings.tts.audioPathHint": "Empty if the response is raw audio; use e.g. data.audio for JSON base64",
    "settings.tts.voices": "Voice list",
    "settings.tts.voicesHint": "One per line; empty = use the API result or built-in list",
    "settings.tts.voicesPlaceholder": "voice-1\nvoice-2",
    "settings.tts.voicesEmpty": "No fetched voices \u2014 type an ID",
    "settings.tts.testText": "Test text",
    "settings.tts.testTextHint": "\u201CTest\u201D synthesizes and plays this sentence",
    "settings.tts.testTextDefault": "Hello, this is a speech synthesis test.",
    "settings.tts.test": "Test",
    "settings.tts.testing": "Testing\u2026",
    "settings.tts.play": "Play",
    "settings.tts.testOk": "Test passed \u2014 {duration}s of audio",
    "settings.tts.fetchVoices": "Fetch voices",
    "settings.tts.fetchingVoices": "Fetching\u2026",
    "settings.tts.voicesFetched": "Fetched {count} voices",
    "settings.tts.save": "Save",
    "settings.tts.saving": "Saving\u2026",
    "settings.tts.saved": "TTS service saved",
    "settings.tts.delete": "Delete",
    "settings.tts.deleteTitle": "Delete TTS service?",
    "settings.tts.deleteMessage": "The API configuration for \u201C{name}\u201D will be removed.",
    "settings.tts.kind.openai": "OpenAI compatible",
    "settings.tts.kind.elevenlabs": "ElevenLabs",
    "settings.tts.kind.azure": "Azure Speech",
    "settings.tts.kind.google": "Google Cloud TTS",
    "settings.tts.kind.baidu": "Baidu Speech",
    "settings.tts.kind.minimax": "MiniMax",
    "settings.tts.kind.volcengine": "Volcengine (Doubao)",
    "settings.tts.baseUrlDeepseekHint": "Empty = https://api.deepseek.com",
    "settings.tts.voiceDeepseekHint": "stella (female, default) or tide (male)",
    "settings.tts.kind.deepseek": "DeepSeek",
    "settings.tts.kind.custom": "Custom HTTP",
    "settings.tts.customHint": "For self-hosted CosyVoice, IndexTTS, GPT-SoVITS, Fish-Speech and similar: pick GET or POST, build the request with {{text}} / {{voice}} / {{speed}} / {{format}} placeholders, and return raw audio or JSON base64.",
    "settings.proxy.group": "Proxy",
    "settings.proxy.mode": "Proxy mode",
    "settings.proxy.modeHint": "The clip agent, speech synthesis and model downloads all use it. \u201CSystem\u201D follows the Windows / macOS system proxy settings automatically (including environment variables and bypass rules); PAC scripts are not supported.",
    "settings.proxy.modeDirect": "Direct",
    "settings.proxy.modeSystem": "System",
    "settings.proxy.modeManual": "Manual",
    "settings.proxy.url": "Proxy URL",
    "settings.proxy.urlPlaceholder": "http://127.0.0.1:7892",
    "settings.proxy.urlHint": "http(s):// or socks5://; used in manual mode",
    "settings.proxy.current": "Effective route",
    "settings.proxy.test": "Test",
    "settings.proxy.testing": "Testing\u2026",
    "settings.proxy.save": "Save",
    "settings.proxy.saved": "Saved",
    "settings.proxy.probeOk": "Connected: {detail}",
    "settings.proxy.probeFail": "Failed: {detail}",
    "settings.proxy.direct": "Direct (no proxy)",
    "settings.proxy.system": "System proxy",
    "settings.store.group": "Mirrors & download URLs",
    "settings.store.models": "Model mirrors",
    "settings.store.modelsHint": "One prefix per line, tried before the official model sources. Empty = official sources only. Use the {url} placeholder or the prefix is prepended. sha256 is verified either way.",
    "settings.store.modelsPlaceholder": "https://mirror.example/",
    "settings.store.source": "Model download source",
    "settings.store.sourceHint": "Each model has an international and a China source. Pick which region to try first; failures fall back to the other region (sha256 is always verified).",
    "settings.store.sourceAuto": "Auto",
    "settings.store.sourceIntl": "Prefer international",
    "settings.store.sourceCn": "Prefer China",
    "settings.store.prefix": "Download proxy prefix",
    "settings.store.prefixHint": "Only rewrites GitHub download URLs; empty = direct. Use the {url} placeholder or the prefix is prepended. sha256 is verified either way.",
    "settings.store.prefixPlaceholder": "https://<proxy>/",
    "settings.store.saveHint": "Save to apply to the next model download.",
    "settings.store.save": "Save",
    "settings.store.saving": "Saving\u2026",
    "settings.store.saved": "Download source settings saved",
    "settings.store.saveFailed": "Save failed: {error}",
    "settings.market.group": "App extension index source",
    "settings.market.url": "Index URL",
    "settings.market.urlHint": "Static JSON index for the app extension store. HTTPS only (localhost http is allowed).",
    "settings.market.urlPlaceholder": "https://heshengtao.github.io/ai-cut-plugin/index.json",
    "settings.market.saveHint": "Saving an empty URL restores the default source. The app fetches and validates the index; the UI only gets one page.",
    "settings.market.reset": "Restore default",
    "settings.market.save": "Save",
    "settings.market.saving": "Saving\u2026",
    "settings.market.saved": "Saved",
    "settings.plugins.group": "OFX plugin registry",
    "settings.plugins.url": "Registry URL",
    "settings.plugins.urlHint": "Leave empty to use the official GitHub raw registry.",
    "settings.plugins.urlPlaceholder": "https://raw.githubusercontent.com/...",
    "settings.plugins.mirrors": "Registry mirrors",
    "settings.plugins.mirrorsHint": "One per line, tried before the official URL. {url} is replaced with the official registry.",
    "settings.plugins.mirrorsPlaceholder": "https://your-mirror/registry.json",
    "settings.plugins.saveHint": "Save to apply on the next registry refresh.",
    "settings.plugins.save": "Save registry",
    "settings.plugins.saving": "Saving\u2026",
    "settings.plugins.saved": "Registry settings saved",
    "settings.plugins.reset": "Restore default",
    "settings.plugins.saveFailed": "Save failed: {error}",
    "backend.cpu": "CPU",
    "backend.cpu.note": "Plain CPU (default, available on every platform)",
    "backend.coreml": "Apple CoreML",
    "backend.coreml.note": "Apple Neural Engine / GPU (measured slower than CPU for these small models on this machine)",
    "backend.directml": "DirectML",
    "backend.directml.note": "DirectX 12 hardware acceleration (Windows)",
    "backend.cuda": "NVIDIA CUDA",
    "backend.cuda.note": "NVIDIA GPU acceleration (downloads a fully matched ONNX Runtime + CUDA 12 / cuFFT / cuDNN 9 set; no system CUDA needed)",
    "backend.cuda12": "CUDA 12",
    "backend.cuda12.note": "NVIDIA GPU acceleration (CUDA 12; best compatibility for older cards / drivers < 580)",
    "backend.cuda13": "CUDA 13",
    "backend.cuda13.note": "NVIDIA GPU acceleration for newer cards (CUDA 13; Turing+ with driver 580+, faster)",
    "settings.ai.runtimes": "Runtimes",
    "settings.ai.runtimesHint": "CPU / DirectML / CoreML ship with the app; the full CUDA 12 / CUDA 13 sets are downloaded on demand",
    "settings.ai.runtimeActive": "In use",
    "settings.ai.runtimesMissing": "CUDA runtime is not installed \u2014 use the button to download",
    "settings.ai.runtimesLibsMissing": "ONNX Runtime (CUDA) is installed; components still missing: {libs}",
    "settings.ai.runtimesRestart": "Runtime switched \u2014 restart the app to apply",
    "settings.ai.runtimeOpen": "Open download manager",
    "settings.ai.restartRequired": "Restart to apply",
    "settings.ai.runtimeMissing": "This backend needs its runtime first (download manager \u2192 Runtimes)",
    "settings.ai.cudaMissing": "CUDA components incomplete: {libs}",
    "settings.ai.runtimeMissingTitle": "Runtime not downloaded",
    "settings.ai.runtimeMissingBody": "\u201C{backend}\u201D needs its runtime first ({size}). Open the download manager and start downloading now?",
    "settings.ai.runtimeMissingBodyUnknown": "\u201C{backend}\u201D needs its runtime first. Open the download manager now?",
    "settings.ai.runtimeMissingGo": "Download",
    "settings.ai.cudaMissingTitle": "CUDA components incomplete",
    "settings.ai.cudaMissingBody": "The ONNX Runtime CUDA build is installed, but the CUDA components it depends on are incomplete: {libs}. Open download manager \u2192 Runtimes to fetch the matching set automatically (no CUDA Toolkit install required).",
    "settings.ai.cudaDownloadTitle": "Download CUDA runtime components",
    "settings.ai.cudaDownloadBody": "Switching to CUDA requires: {list} ({size}). Clicking \u201CDownload and switch\u201D jumps to the download manager, installs everything, then prompts for a restart.",
    "settings.ai.cudaDownloadGo": "Download and switch",
    "settings.ai.cudaDownloadFailed": "Some components were not installed; the previous backend is kept. You can continue from the download manager \u2192 Available.",
    "settings.ai.restartTitle": "Runtime switched",
    "settings.ai.restartBody": "The new runtime loads on the next start. Restart the app now?",
    "settings.ai.restartDevHint": "(Auto-restart is disabled in development builds \u2014 close and rerun the app manually.)",
    "settings.ai.restartNow": "Restart now",
    "settings.cli.group": "Command line",
    "settings.cli.mount": "Use aicut in a terminal",
    "settings.cli.mountHint": "When enabled, aicut is available in any terminal; macOS / Linux asks for admin permission once.",
    "settings.cli.status": "Mount status",
    "settings.cli.state.installed": "Mounted",
    "settings.cli.state.missing": "Not mounted",
    "settings.cli.state.conflict": "Conflict",
    "settings.cli.state.system": "System install",
    "settings.cli.state.unsupported": "Not available in this build",
    "settings.cli.command": "Command",
    "settings.cli.bundled": "Bundled binary",
    "settings.cli.notBundled": "This build does not bundle aicut",
    "settings.cli.fullPath": "Full path (when unmounted)",
    "settings.cli.copy": "Copy",
    "settings.cli.manual": "Manual mount command",
    "settings.cli.busy": "Working\u2026",
    "settings.cli.mountedToast": "aicut mounted",
    "settings.cli.unmountedToast": "aicut unmounted",
    "settings.cli.statusHint": "Mounting is optional; the bundled full path always works.",
    "settings.cli.desktopOnly": "Mounting must be done in the desktop app; the browser preview cannot modify PATH.",
    "settings.cli.systemInstalled": "aicut is already installed system-wide; no need to mount again.",
    "settings.cli.hint.conflict": "Another aicut already exists; left untouched.",
    "settings.cli.hint.dev_build": "This is a dev build; mounting points at a temporary artifact and may need re-mounting after rebuilds.",
    "settings.cli.hint.needs_manual": "Run the command below manually.",
    "settings.cli.hint.appimage": "AppImage paths change on every launch and cannot be mounted safely.",
    "settings.copy.ok": "Copied",
    "copy.failed": "Copy failed",
    // ---- Confirm ----
    "confirm.unsavedTitle": "Discard unsaved changes?",
    "confirm.unsavedNew": "This project has unsaved changes. Create a new one?",
    "confirm.unsavedOpen": "This project has unsaved changes. Open another one?",
    "confirm.newProject": "Create",
    "confirm.continueOpen": "Open",
    "confirm.delete": "Delete",
    "confirm.cancel": "Cancel",
    "confirm.recoveryTitle": "Restore unsaved draft?",
    "confirm.recoveryMessage": "An unsaved draft from {when} was found. Restore it?",
    "confirm.restore": "Restore",
    "confirm.discard": "Discard",
    // ---- Project history ----
    "history.title": "Project history",
    "history.loading": "Loading project history\u2026",
    "history.empty": "No project history yet",
    "history.emptyHint": "When you create or open another project, the current one is saved here automatically.",
    "history.failed": "Could not read project history: {error}",
    "history.restoreFailed": "Could not restore project: {error}",
    "history.restored": "Back to \u201C{name}\u201D",
    "history.dirty": "Unsaved",
    "history.unsaved": "Unsaved project",
    "history.tracks": "{count} tracks",
    "history.clips": "{count} clips",
    "history.version": "Version",
    "history.versions": "{count} versions",
    "history.hint": "Click a card to return to the selected version; the current project is saved to history first.",
    "history.delete": "Delete history entry",
    "history.deleteTitle": "Delete this history entry?",
    "history.deleteMessage": "\u201C{name}\u201D will be removed from project history. The project file on disk is not affected.",
    "history.deleteGroupMessage": "All {count} history versions of \u201C{name}\u201D will be removed from the list. The project file on disk is not affected.",
    "history.deleted": "History entry deleted",
    "history.deleteFailed": "Could not delete history entry: {error}",
    // ---- Download model confirmation ----
    "dialog.downloadModelTitle": "Download model?",
    "dialog.downloadModelMessage": "\u201C{name}\u201D is not installed (about {size}). Continue to the download manager to download it?",
    "dialog.downloadModelOk": "Download",
    // ---- Prepare the runtime (engine / runtime / model) ----
    "setup.title.image": "Set up \u201CAI image generation\u201D",
    "setup.title.image-edit": "Set up \u201CImage editing\u201D",
    "setup.title.video": "Set up \u201CAI video generation\u201D",
    "setup.title.aligner": "Prepare the cut-review aligner",
    "cutReview.noCloudService": "The selected recognition service is disabled \u2014 enable it in Settings \u2192 Speech recognition.",
    "ai.cutCloudNeedsAligner": "No word timings from this service; the local aligner fills them in",
    "setup.title.voice": "Set up \u201CAI voice change\u201D",
    "setup.title.voiceover": "Prepare AI voiceover",
    "setup.title.dub": "Prepare dubbing for audio translation",
    "setup.title.runtime": "Set up the local AI runtime",
    "setup.lead": "This machine works best with {backend} ({reason}). These need to be downloaded first:",
    "setup.leadModel": "These model weights are still missing:",
    "setup.recommended": "Recommended",
    "setup.reason.nvidia": "detected {name}",
    "setup.reason.apple": "Apple Silicon \u2014 Metal / CoreML",
    "setup.reason.vulkan": "no NVIDIA GPU \u2014 using Vulkan",
    "setup.reason.cpu": "no usable GPU \u2014 using CPU (slower)",
    "setup.reason.generic": "matched to this machine",
    "setup.dep.bundle": "Pulls in {count} matching components",
    "setup.dep.files": "{count} weight files",
    "setup.installed": "Installed",
    "setup.total": "{size} to download",
    "setup.download": "Download & install ({size})",
    "setup.background": "Download in background",
    "setup.busy": "Downloading {name}\u2026",
    "setup.busyStep": "{index}/{total} \xB7 {pct}",
    "setup.later": "Later",
    "setup.back": "Back",
    "setup.switch": "Change backend",
    "setup.done": "Runtime ready",
    "setup.failed": "\u201C{name}\u201D failed to download: {error}",
    "setup.diskLow": "Not enough disk space: this needs about {size} (including extraction). Free some space and try again.",
    "setup.restartTitle": "Restart to enable {backend}",
    "setup.restartBody": "The new runtime occupies the same slot in this process and loads on next launch. Restart now?",
    "setup.restartLater": "Restart later",
    // ---- Toast ----
    "toast.saved": "Saved",
    "toast.savedAs": "Saved as",
    "toast.imported": "Imported {count} items",
    "toast.relinked": "Media relinked",
    "toast.exported": "Exported to {path}",
    "toast.exportCancelled": "Export cancelled",
    "toast.recoveryRestored": "Draft restored \u2014 remember to save",
    "toast.nothingToUndo": "Nothing to undo",
    "toast.nothingToRedo": "Nothing to redo",
    // ---- Errors ----
    "error.operation": "Action failed: {error}",
    "error.save": "Save failed: {error}",
    "error.open": "Open failed: {error}",
    "error.import": "Import failed: {error}",
    "error.export": "Export failed: {error}",
    "error.unsupportedType": "Unsupported file type: {name}",
    "error.noDuration": "Could not read duration: {name}",
    "error.serialize.notObject": "Invalid project file: root is not an object",
    "error.serialize.version": "Unsupported project version: expected {expected}, got {actual}",
    "error.serialize.missingName": "Invalid project file: missing name",
    "error.serialize.badFps": "Invalid project file: invalid fps",
    "error.serialize.badResolution": "Invalid project file: invalid resolution",
    "error.serialize.badAssets": "Invalid project file: assets is not an array",
    "error.serialize.badTracks": "Invalid project file: tracks is not an array",
    "episode.defaultName": "Part {index}",
    "error.serialize.badEpisodes": "Invalid project file: no episodes",
    "error.serialize.badActiveEpisode": "Invalid project file: no active episode",
    "error.serialize.badEpisode": "Invalid project file: corrupted episode",
    "error.serialize.badTrack": "Invalid project file: track is not an object",
    "error.serialize.badClips": "Invalid project file: track clips is not an array",
    "error.serialize.badClip": "Invalid project file: clip is not an object",
    "error.serialize.badClipTime": "Invalid project file: invalid clip time",
    "error.serialize.badJson": "Project file is not valid JSON",
    "error.command.readOnly": "Following the desktop session is read-only. Choose \u201CEdit a copy\u201D to make changes.",
    "session.following": "Following the desktop session",
    "session.followingHint": "Changes on the desktop appear here live (read-only).",
    "session.copy": "Edit a copy",
    "error.command.stale": "Command is based on an old revision (current {expected}, got {actual}). Re-read the project.",
    "error.command.unknownKind": "Unknown or non-executable command: {kind}",
    "error.command.invalidPayload": "Invalid command payload",
    "error.command.overlap": "Clip overlaps an existing clip on track {n}",
    // ---- Window controls ----
    "window.minimize": "Minimize",
    "window.maximize": "Maximize",
    "window.restore": "Restore",
    "window.close": "Close",
    // ---- Cut filler words ----
    "panel.cutReview": "Cut review",
    "panel.cutReviewHint": "Review filler and pause cuts; click a struck word to restore it",
    "cutReview.title": "Smart cut",
    "cutReview.hint": "Finds filler words and long pauses, cuts them, then lets you review every cut in the transcript. Click a struck word to restore it.",
    "cutReview.start": "Analyze",
    "cutReview.rerun": "Analyze again",
    "cutReview.running": "Transcribing\u2026",
    "cutReview.processing": "Working\u2026",
    "cutReview.cancel": "Cancel",
    "cutReview.noModel": "No speech model available. Smart cut needs Paraformer (word timestamps); download it on the Models page first.",
    "cutReview.noSpeech": "No speech detected.",
    "cutReview.nothingFound": "No filler words or long pauses found.",
    "cutReview.done": "Cut {count} spots, saved {seconds}",
    "cutReview.empty": "Select a clip with speech on the timeline, then start the analysis.",
    "cutReview.emptyCount": "{count} cuts \xB7 {seconds} saved",
    "cutReview.removedAll": "Restore all",
    "cutReview.restoreOne": "Restore this cut",
    "cutReview.restoreLabel": "Restore \u201C{text}\u201D",
    "cutReview.restoreAllLabel": "Restore all {count} cuts",
    "cutReview.commandLabel": "Smart cut: {count} cuts",
    "cutReview.pauseText": "pause",
    "cutReview.estimated": "This model has no word timestamps. Fillers and pauses are cut on real speech-segment boundaries, so those cuts are accurate; words inside one breath group are distributed by length, which only affects manual single-word cuts.",
    "cutReview.minPause": "Pause threshold",
    "cutReview.includeSoft": "Also cut filler phrases like \u201Cyou know\u201D",
    "cutReview.cueTrack": "Cut transcript",
    "cutReview.silenceLabel": "Silence {value}s",
    "cutReview.silenceCut": "Cut \u2014 click to restore",
    "cutReview.silenceKeep": "Click to cut",
    "cutReview.filterWords": "Filter words",
    "cutReview.filterWordsHint": "Add your own filler words or phrases (any language). A match is cut without requiring a pause around it.",
    "cutReview.filterPlaceholder": "Type and press Enter",
    "cutReview.asrModel": "Speech model",
    "cutReview.downloadMany": "Smart cut needs these models first: {names} ({size} in total).",
    "cutReview.noAligner": "Smart cut needs the Qwen3 forced aligner; download it on the Models page first.",
    "cutReview.locate": "Go to",
    "cutReview.cutNoop": "That range is already cut",
    "cutReview.selectHint": "Click a word to select it (Delete cuts it); drag to cut a range. Edit wording on the \u201CCut transcript\u201D track.",
    "cutReview.selectClip": "Select a clip with speech on the timeline first.",
    "cutReview.kind.filler": "Filler",
    "cutReview.kind.pause": "Pause",
    "cutReview.kind.retake": "Retake",
    "cutReview.kind.manual": "Manual",
    "cutReview.seconds": "{value}s",
    "cutReview.cutSelection": "Cut {value}",
    "cutReview.selectionHint": "{count} characters \xB7 {value}",
    "cutReview.analysisDone": "Cut {count} spots \u2014 review them in the transcript",
    "cutReview.review": "Review",
    "cutReview.failed": "Analysis failed: {error}",
    "cutReview.editLabel": "Edit word: {text}",
    "cutReview.wordsCount": "{count} words",
    "cutReview.toReview": "Review",
    "cutReview.settings": "Smart cut settings",
    "cutReview.settingsOpen": "Settings",
    "cutReview.settingsHint": "Filter words, pause threshold and cut-point trimming",
    "cutReview.settings.subtitle": "Filter words cut on sight; pauses and cut points are tuned here.",
    "cutReview.settings.custom": "Custom filter words",
    "cutReview.settings.customEmpty": "No custom words yet. Type \u201Cum\u201D or \u201Cyou know\u201D and press Enter.",
    "cutReview.settings.defaultWords": "Default filter words",
    "cutReview.settings.hardGroup": "Fillers \xB7 cut on sight",
    "cutReview.settings.softGroup": "Verbal tics \xB7 cut only when isolated",
    "cutReview.settings.restoreWords": "Restore default words",
    "cutReview.settings.removedDefaults": "{count} default words removed",
    "cutReview.settings.pause": "Pauses",
    "cutReview.settings.minPause": "Long-pause threshold",
    "cutReview.settings.minPauseHint": "Silence longer than this between two phrases gets shortened.",
    "cutReview.settings.keep": "Keep inside a sentence",
    "cutReview.settings.keepHint": "Breathing room left between phrases after a pause is cut.",
    "cutReview.settings.sentenceKeep": "Keep at sentence end",
    "cutReview.settings.sentenceKeepHint": "Pauses after a full stop or question mark keep a little more.",
    "cutReview.settings.includeSoft": "Also cut \u201Cyou know / like\u201D",
    "cutReview.settings.includeSoftHint": "Turn off to cut only pure fillers such as \u201Cum\u201D or \u201Cuh\u201D.",
    "cutReview.settings.trim": "Cut-point trimming",
    "cutReview.settings.trimPad": "Trim into silence",
    "cutReview.settings.trimPadHint": "Timestamps often sit on a word\u2019s loudest peak. Cutting a little further into the silence on both sides removes the leftover half-sound.",
    "cutReview.settings.trimPadValue": "{value} ms",
    "cutReview.settings.seconds": "{value}s",
    "cutReview.settings.add": "Add",
    "cutReview.settings.resetAll": "Reset everything",
    "cutReview.settings.done": "Done",
    "cutReview.settings.added": "Added filter word \u201C{word}\u201D",
    "cutReview.settings.duplicate": "That filter word is already in the list",
    "cutReview.settings.wordsRestored": "Default filter words restored",
    "cutReview.settings.allReset": "Settings reset to defaults",
    "audio.cutFillers": "Smart cut",
    "audio.cutFillersHint": "Find and cut filler words and long pauses, review each cut in the transcript, restore with one click",
    "audio.cutFillersRun": "Analyze",
    "audio.cutFillersReview": "Review",
    "settings.store.hfToken": "Hugging Face token",
    "settings.store.hfTokenHint": "Only for gated models that need a license acceptance; sent to huggingface.co only and stored locally.",
    "settings.store.hfTokenPlaceholder": "hf_\u2026 (empty = anonymous download)",
    "settings.store.hfTokenSet": "configured {hint}",
    "settings.store.hfTokenSave": "Save",
    "settings.store.hfTokenClear": "Clear",
    // ---- Views / episodes / board ----
    "view.switch": "Switch view",
    "view.preview": "Preview",
    "view.previewHint": "Preview stage and timeline (\u23181)",
    "view.board": "Canvas",
    "view.boardHint": "Infinite canvas for composing AI nodes (\u23182)",
    "view.series": "Episodes",
    "view.seriesHint": "All parts in this project (\u23183)",
    "series.title": "Parts",
    "series.total": "{count} parts",
    "series.search": "Search parts",
    "series.viewMode": "View",
    "series.view.tile": "Tiles",
    "series.view.graph": "Flow",
    "series.preview": "Preview",
    "series.branchCount": "{count} choices",
    "series.orphan": "Not linked",
    "series.graph.fit": "Fit view",
    "series.graph.autoLayout": "Auto layout",
    "series.graph.rebuild": "Rebuild in time order",
    "series.graph.rebuildTitle": "Rebuild episode flow",
    "series.graph.rebuildMessage": "This removes every manual connection and choice, and generates a single time-ordered chain from the current part order.",
    "series.graph.rebuildDone": "Rebuilt in time order",
    "series.graph.zoomIn": "Zoom in",
    "series.graph.zoomOut": "Zoom out",
    "series.edge.label": "Choice label",
    "series.edge.labelPlaceholder": "Choice {index}",
    "series.edge.delete": "Delete connection",
    "series.edge.route": "{from} \u2192 {to}",
    "series.graph.toolbar": "Episode canvas tools",
    "series.mode.drag": "Pan canvas",
    "series.mode.marquee": "Marquee select",
    "series.ctx.duplicate": "Duplicate",
    "series.ctx.copy": "Copy",
    "series.ctx.cut": "Cut",
    "series.ctx.paste": "Paste",
    "series.ctx.copied": "Part copied",
    "series.ctx.cutDone": "Part cut",
    "series.ctx.pasted": "Part pasted",
    "series.choice.unnamed": "Choice {index}",
    "series.choices.title": "This part ended \u2014 what plays next?",
    "series.playback.ended": "The series ended",
    "series.playback.loop": "The flow looped back to \u201C{name}\u201D; autoplay stopped",
    "series.timeline": "Timeline",
    "series.newEpisode": "New part",
    "series.newEpisodeName": "Part {index}",
    "series.duplicate": "Duplicate part",
    "series.duplicateSuffix": "{name} copy",
    "series.deleteTitle": "Delete part",
    "series.deleteMessage": "The timeline of \u201C{name}\u201D will be removed. Media and the canvas are untouched.",
    "series.keepLast": "Keep at least one part",
    "series.empty": "This project has no parts yet",
    "series.emptyHint": "Create a part and start cutting this episode.",
    "series.emptySearch": "No matching parts",
    "series.tracks": "{count} tracks",
    "series.clips": "{count} clips",
    "series.current": "Current",
    "board.emptyTitle": "Compose AI capabilities with nodes",
    "board.emptyHint": "Input \u2192 model \u2192 display. Wire images, audio and video references into one model node; results land in the media library.",
    "board.addNode": "Add node",
    "board.showTimeline": "Show timeline",
    "board.hideTimeline": "Hide timeline",
    "board.toolbar": "Canvas toolbar",
    "board.pan": "Pan mode",
    "board.zoomOut": "Zoom out",
    "board.zoom": "{value}%",
    "board.zoomGroup": "Zoom",
    // ---- Board nodes ----
    "board.undo": "Undo",
    "board.redo": "Redo",
    "board.fit": "Fit view",
    "board.zoomIn": "Zoom in",
    "board.panHint": "Scroll to pan \xB7 drag to marquee",
    "board.category.input": "Input",
    "board.category.display": "Display",
    "board.category.model": "Model",
    "board.category.group": "Logic",
    "board.type.text": "Text",
    "board.type.image": "Image",
    "board.type.video": "Video",
    "board.type.audio": "Audio",
    "board.type.integer": "Integer",
    "board.type.number": "Float",
    "board.type.boolean": "Boolean",
    "board.type.json": "JSON",
    "board.type.any": "Any",
    "board.value.empty": "No value",
    "board.value.legacyText": "Text (legacy)",
    "board.value.true": "True",
    "board.value.false": "False",
    "board.node.inputImage": "Image input",
    "board.node.inputVideo": "Video input",
    "board.node.inputAudio": "Audio input",
    "board.node.inputText": "Text input",
    "board.node.inputValue": "Value input",
    "board.node.displayText": "Text display",
    "board.node.displayValue": "Value display",
    "board.node.loop": "Loop",
    "board.node.loopStart": "Loop start",
    "board.param.loopInputs": "Inputs",
    "board.loop.inputs": "Inputs",
    "board.loop.inputN": "Input {n}",
    "board.loop.addInput": "Add input",
    "board.loop.removeInput": "Remove input",
    "board.port.number": "Number",
    "board.port.integer": "Integer",
    "board.port.boolean": "Boolean",
    "board.port.json": "JSON",
    "board.port.any": "Any",
    "board.node.loopEnd": "Loop end",
    "board.param.loopMode": "Loop mode",
    "board.param.loopCount": "Iterations",
    "board.param.loopSlots": "Output slots",
    "board.loopMode.array": "Over array",
    "board.loopMode.count": "Fixed count",
    "board.port.items": "Items",
    "board.port.item": "Current item",
    "board.port.index": "Index",
    "board.port.slot": "Value",
    "board.port.list": "List",
    "board.node.displayImage": "Image display",
    "board.node.displayVideo": "Video display",
    "board.node.displayAudio": "Audio display",
    "board.node.noAsset": "No media yet",
    "board.node.noText": "Empty text",
    "board.node.modelHint": "Model node",
    "board.port.image": "Image",
    "board.port.video": "Video",
    "board.port.audio": "Audio",
    "board.port.text": "Text",
    "board.port.value": "Value",
    "board.port.prompt": "Prompt input",
    "board.port.negative": "Negative prompt input",
    "board.port.stemVocals": "Vocals",
    "board.port.stemDrums": "Drums",
    "board.port.stemBass": "Bass",
    "board.port.stemOther": "Other",
    "board.port.stemGuitar": "Guitar",
    "board.port.stemPiano": "Piano",
    "board.port.stemAccompaniment": "Accompaniment",
    "board.param.textMode": "Display",
    "board.param.valueKind": "Value type",
    "board.param.value": "Value",
    "board.textMode.markdown": "Markdown",
    "board.textMode.plain": "Plain text",
    "board.inspect.localGroup": "Local engines",
    "board.param.text": "Text",
    "board.status.skipped": "Skipped",
    "board.node.group": "Group",
    "board.group.count": "{count} nodes",
    "board.group.empty": "Drag nodes into this frame, or select nodes and press \u2318G.",
    "board.group.tone": "Frame tone",
    "board.group.tone.lavender": "Lavender",
    "board.group.tone.blue": "Blue",
    "board.group.tone.green": "Green",
    "board.group.tone.coral": "Coral",
    "board.group.tone.amber": "Amber",
    "board.group.needSelection": "Select at least two nodes to create a group",
    "board.run.runHint": "Run the whole workflow in dependency order",
    "board.run.alwaysHint": "When an upstream output updates, run the nodes after it",
    "board.ctx.bypass": "Bypass node",
    "board.ctx.bypassOff": "Remove bypass",
    "board.ctx.groupCreate": "Create group",
    "board.ctx.groupCreateHint": "Box the selected nodes into a group (\u2318G)",
    "board.ctx.groupSelect": "Select group members",
    "board.ctx.ungroup": "Ungroup",
    // ---- Workflow library / group nodes / parallel scheduling ----
    "board.library.title": "Workflow library",
    "board.library.sub": "Default workflows plus saved canvases, with versions",
    "board.library.save": "Save",
    "board.library.saveCurrent": "Save the current canvas to the workflow library",
    "board.library.saveTitle": "Save workflow",
    "board.library.nameLabel": "Workflow name",
    "board.library.namePlaceholder": "e.g. Vertical talking-head intro",
    "board.library.search": "Search workflows",
    "board.library.filterAll": "All",
    "board.library.filterBuiltin": "Default",
    "board.library.filterMine": "Mine",
    "board.library.empty": "No saved workflows yet",
    "board.library.emptyHint": "Save from the canvas toolbar, or save the current canvas here",
    "board.library.loading": "Loading the workflow library\u2026",
    "board.library.insert": "Insert into canvas",
    "board.library.insertVersion": "Insert this version",
    "board.library.restore": "Insert",
    "board.library.rename": "Rename",
    "board.library.renameTitle": "Rename workflow",
    "board.library.delete": "Delete workflow",
    "board.library.deleteTitle": "Delete workflow",
    "board.library.deleteMessage": 'All versions of "{name}" will be removed from the library. The canvas and project are untouched.',
    "board.library.deleted": "Workflow deleted",
    "board.library.saved": 'Saved "{name}" v{version}',
    "board.library.savedAndCleared": 'Saved "{name}" and cleared the canvas',
    "board.library.clearedWithoutSave": "Canvas cleared (saving failed)",
    "board.library.inserted": "Inserted {count} nodes",
    "board.library.loadFailed": "Could not load the workflow",
    "board.library.currentVersion": "Current: {name} \xB7 v{version}",
    "board.library.currentBadge": "Current canvas",
    "board.library.builtinBadge": "Default",
    "board.library.mineBadge": "Mine",
    "board.library.meta": "{nodes} nodes \xB7 {edges} links \xB7 {date}",
    "board.library.defaultName": "{name} \xB7 workflow",
    "board.library.untitled": "Untitled project",
    "board.library.emptyCanvas": "The canvas is empty \u2014 add nodes before saving",
    "board.library.openLibrary": "Open the workflow library",
    "board.library.builtin.textToImage": "Text to image",
    "board.library.builtin.textToImageHint": "Text \u2192 image generation \u2192 image display (pick a model in the inspector)",
    "board.library.builtin.imageEdit": "Reference image edit",
    "board.library.builtin.imageEditHint": "Reference image + prompt \u2192 image generation \u2192 image display (pick a model in the inspector)",
    "board.library.builtin.imageToVideo": "Image to video",
    "board.library.builtin.imageToVideoHint": "First frame + prompt \u2192 video generation \u2192 video display (pick a model in the inspector)",
    "board.library.builtin.textRevise": "Text rewrite",
    "board.library.builtin.textReviseHint": "Text \u2192 text generation \u2192 text display (pick a text model)",
    "board.ctx.copy": "Copy",
    "board.ctx.selectionHint": "{count} nodes selected \u2014 actions apply to all",
    "board.ctx.cut": "Cut",
    "board.ctx.paste": "Paste",
    "board.ctx.copied": "Copied {count} nodes",
    "board.ctx.pasted": "Pasted {count} nodes",
    "board.ctx.groupRun": "Run the whole group",
    "board.ctx.rebuildGroup": "Rebuild the whole group",
    "board.drop.workflow": "Drop to insert the workflow",
    "board.lane.instant": "Instant",
    "board.lane.api": "Cloud API",
    "board.lane.gpu": "Local GPU",
    "board.lane.cpu": "Local CPU",
    "board.workflow.filter": "AI Cut workflow",
    "board.workflow.suffix": "workflow",
    "board.workflow.exported": "Workflow exported",
    "board.workflow.imported": "Imported {count} nodes",
    "board.workflow.invalid": "This file is not a valid AI Cut workflow",
    "board.workflow.empty": "The canvas is empty \u2014 nothing to export",
    "board.workflow.dropHint": "Drop to import the workflow",
    "board.status.idle": "Idle",
    "board.status.queued": "Queued",
    "board.status.running": "Running",
    "board.status.done": "Done",
    "board.status.error": "Failed",
    "board.status.stale": "Upstream changed",
    "board.status.streaming": "Streaming",
    "board.status.thinking": "Thinking\u2026",
    "board.status.processing": "Processing",
    "board.status.generating": "Generating",
    "panel.boardInspector": "Canvas inspector",
    "panel.boardInspectorHint": "Canvas list, node parameters, workflow signature and publishing",
    "panel.workflowLibrary": "Workflow library",
    "panel.workflowLibraryHint": "Default workflows and saved canvases, with versions",
    "board.inspect.node": "Node",
    "board.inspect.media": "Media",
    "board.inspect.params": "Parameters",
    "board.inspect.actions": "Actions",
    "board.inspect.pickFile": "Choose file",
    "board.inspect.pickAsset": "Pick from library",
    "board.inspect.clearMedia": "Clear",
    "board.inspect.insertTimeline": "Insert into current part",
    "board.inspect.inserted": "Inserted into the current part",
    "board.inspect.insertFailed": "Unknown duration \u2014 could not insert",
    "board.inspect.copyPath": "Copy path",
    "board.inspect.pathCopied": "Media path copied",
    "board.inspect.empty": "No node selected",
    "board.inspect.emptyHint": "Select a node on the canvas to edit its parameters, media and run state here.",
    "board.node.modelImage": "Image generation",
    "board.node.modelVideo": "Video generation",
    "board.node.modelTts": "Text to speech",
    "board.node.modelAsr": "Speech to text",
    "board.node.modelText": "Text generation",
    "board.node.modelEnhance": "Picture enhance",
    "board.node.modelSeparate": "Audio separation",
    "board.node.modelDemux": "Video / audio split",
    "board.node.demuxSubtitle": "Muted video + extracted audio",
    "board.node.modelTextKind": "Text model",
    "board.node.modelCloud": "Cloud service",
    "board.node.localProcess": "Local processing",
    "board.node.nextOutput": "Next output",
    "board.node.imageNeedsInput": "Prompt is empty: add a prompt for text-to-image, or connect a reference image first",
    "board.node.defaultEditPrompt": "Redraw the reference image, keeping the composition and subject with natural detail.",
    "board.param.model": "Model",
    "board.param.prompt": "Prompt",
    "board.param.promptOptionalHint": "May stay empty: with a reference image it becomes an edit; text-to-image needs a prompt. A connected Prompt input overrides this field.",
    "board.param.negative": "Negative prompt",
    "board.param.negativeVideoHint": "Some cloud video services accept a negative prompt; local models use their built-in negative terms.",
    "board.param.negativeOptionalHint": "You can also connect a text node to Negative prompt input in the inspector; the link wins over this field.",
    "board.param.size": "Resolution",
    "board.param.sizeHint": "Output size / aspect ratio of the generated media \u2014 unrelated to the node card size (drag its bottom-right corner for that).",
    "board.param.sizeCustom": "Custom\u2026",
    "board.param.sizeAuto": "Set by the model / input media (no size parameter)",
    "board.param.width": "Output width",
    "board.param.height": "Output height",
    "board.param.steps": "Steps",
    "board.param.seed": "Seed",
    "board.param.seconds": "Seconds",
    "board.param.scale": "Scale",
    "board.param.factor": "Interpolation",
    "board.param.enhanceOp": "Operation",
    "board.param.refImage": "Reference image",
    "board.port.firstFrame": "First frame",
    "board.port.lastFrame": "Last frame",
    "board.port.refImage": "Ref image",
    "board.port.refImageN": "Reference image {n}",
    "board.port.refAudioN": "Reference audio {n}",
    "board.port.refVideoN": "Reference video {n}",
    "board.port.refAudio": "Ref audio",
    "board.port.refText": "Reference text",
    "board.port.refVideo": "Ref video",
    "board.param.systemPromptPlaceholder": "Describe the model's role, tone and limits, e.g. you are a short-video copywriter and output one title",
    "board.param.promptPlaceholder": "Write what to generate; upstream text is appended to it",
    "board.param.textModel": "Text model",
    "board.param.systemPrompt": "System prompt",
    "board.param.temperature": "Temperature",
    "board.param.maxTokens": "Max tokens",
    "board.param.stream": "Stream output",
    "board.param.streamHint": "Show tokens as they arrive; turn off to wait for the full reply",
    "board.param.reasoning": "Reasoning effort",
    "board.param.reasoningHint": "Passed as reasoning_effort; models without support ignore it",
    "board.param.topP": "Top P",
    "board.param.topPHint": "Sampling range 0\u20131; 1 keeps the full distribution",
    "board.param.count": "Image count",
    "board.param.countHint": "Generate several at once and switch between them in the output sheet",
    "board.reasoning.off": "Off",
    "board.reasoning.low": "Low",
    "board.reasoning.medium": "Medium",
    "board.reasoning.high": "High",
    "board.node.output": "Output",
    "board.node.contentTab": "Content",
    "board.node.reasoningTab": "Reasoning",
    "board.node.llmUnconfigured": "No text model: Settings \u2192 Text generation",
    "board.enhance.upscale": "Upscale",
    "board.enhance.interpolate": "Interpolate",
    "board.run.run": "Run",
    "board.run.stop": "Stop",
    "board.run.mode": "Run mode",
    "board.run.manual": "Run whole workflow",
    "board.run.always": "Auto-rerun downstream",
    "board.run.repeat": "Repeat N times",
    "board.run.queued": "{count} queued",
    "board.run.done": "Run finished",
    "board.run.failed": "Run failed",
    "board.run.empty": "No runnable node",
    "board.run.needSelection": "Select a node first",
    "board.inspect.runControls": "Run controls",
    "board.inspect.bypassHint": "Skip only this node: downstream uses its same-type input instead, or empty",
    "board.inspect.ignoreHint": "Disable this node and everything after it",
    "board.inspect.run": "Run this node",
    "board.inspect.model": "Model source",
    "board.inspect.output": "Output",
    "board.inspect.outputEmpty": "No output yet",
    "board.inspect.missing": "not installed",
    "board.inspect.local": "Local",
    "board.inspect.cloud": "cloud",
    "board.inspect.pickModel": "Pick a model",
    "board.inspect.modelSettings": "Configure cloud API",
    "board.inspect.modelSettingsHint": "Open settings to enter the endpoint and API key",
    "board.inspect.outputContent": "Content",
    "board.inspect.outputReasoning": "Reasoning",
    "board.inspect.outputCount": "{count}",
    "board.inspect.chars": "{count} chars",
    "board.ctx.ignore": "Disable node",
    "board.ctx.enable": "Enable node",
    "board.ctx.duplicate": "Duplicate",
    "board.dropHint": "Drop to import and create an input node",
    "board.inspect.download": "Download",
    "board.ctx.download": "Download media",
    "board.ctx.downloadHint": "Save the node\u2019s selected media / published output as a file",
    "board.download.done": "Saved {name}",
    "board.ctx.run": "Run node",
    "board.ctx.rebuild": "Rebuild node",
    "board.ctx.rebuildHint": "Reset to the default initial state without running",
    "board.ctx.runDownstream": "Run node and downstream",
    "board.ctx.edit": "Edit in inspector",
    "board.ctx.selectAll": "Select all",
    "board.ctx.removeEdge": "Delete connection",
    "board.ctx.clear": "Clear canvas",
    "board.ctx.canvasList": "Show canvas list",
    "board.clear": "Clear",
    "board.clearTitle": "Clear canvas",
    "board.clearMessage": "Only this canvas is cleared \u2014 no new workflow version is saved. The media library and timeline are untouched.",
    "board.addSearch": "Search nodes\u2026",
    "board.addNoResults": "No matching node",
    "board.run.repeatTimes": "Repeat count",
    "board.mode.drag": "Pan canvas",
    "board.mode.marquee": "Marquee select",
    "board.gridSnap": "Snap to grid",
    "board.connect.title": "Connect to a new node",
    "board.connect.fromInput": "Feed this input",
    "board.connect.none": "No compatible nodes",
    "board.node.dropImage": "Drop or pick images",
    "board.node.dropVideo": "Drop or pick a video",
    "board.node.dropAudio": "Drop or pick audio",
    "board.node.dropHint": "Multiple images are supported",
    "board.node.prevImage": "Previous image",
    "board.node.removeImage": "Remove this image",
    "board.node.nextImage": "Next image",
    "board.inspect.addImages": "Add images",
    "board.inspect.runSection": "Run",
    "board.inspect.stackCount": "{count} images",
    "board.node.waitingRun": "Waiting for a run",
    "board.node.waitingRunHint": "Run the upstream node and its output shows up here.",
    "board.node.waitingMedia": "Waiting for upstream",
    "board.node.waitingHint": "Connect an input or model output here",
    "board.node.uploadImage": "Upload image",
    "board.node.imageHint": "Drop images, or pick several files. The card keeps a stacked deck.",
    "board.node.chooseFile": "Choose file",
    "board.node.brokenImage": "Image failed to load",
    "board.node.brokenHint": "Pick another image to try again",
    "board.node.brokenVideo": "This video cannot play",
    "board.node.brokenAudio": "This audio cannot play",
    "board.node.videoHint": "Drop a video file, or pick one from the library.",
    "board.node.audioHint": "Drop an audio file, or pick one from the library.",
    "board.node.textPlaceholder": "Describe the shot, the line, or the prompt\u2026",
    "board.node.promptPlaceholder": "Describe the shot, style and constraints\u2026",
    "board.node.paramPlaceholder": "Not set",
    "board.node.chars": "{count} chars",
    "board.node.copyText": "Copy text",
    "board.node.clearText": "Clear text",
    "board.node.textCopied": "Text copied",
    "board.node.missingPlugin": "Node definition missing",
    "board.node.missingPluginHint": "The plugin did not load (disabled / incompatible / installing). The node and its edges are kept and will show up once the plugin is back.",
    "board.node.copyOutputText": "Copy all text",
    "board.node.play": "Play",
    "board.node.pause": "Pause",
    "board.node.mute": "Mute",
    "board.node.unmute": "Unmute",
    "board.node.fullscreen": "Fullscreen",
    "board.node.agentModel": "Text model",
    "board.node.noModel": "No model selected",
    "board.node.modelLocal": "Local model",
    "board.node.refSummary": "9 images \xB7 3 audios \xB7 3 videos",
    "board.node.stemSummary": "{count} stems",
    "board.node.multiRefSummary": "up to {count} references",
    "board.node.hasOutput": "Output ready",
    "board.node.collapseOutput": "Collapse output",
    "board.node.expandOutput": "Expand output",
    "board.node.outputs": "Outputs",
    "board.node.selectOutput": "Show output {index}",
    // ---- canvas asset picker (MD3 dialog) ----
    "board.picker.imageTitle": "Choose an image",
    "board.picker.videoTitle": "Choose a video",
    "board.picker.audioTitle": "Choose an audio clip",
    "board.picker.search": "Search the asset library\u2026",
    "board.picker.empty": "No assets of this kind yet",
    "board.picker.emptyHint": "Import in the media pane, or drop files straight onto the canvas.",
    "board.picker.noMatch": "No matching assets",
    "board.picker.add": "Add",
    "board.picker.selected": "{count} selected",
    // ---- media library → canvas drag ----
    "board.drop.createNode": "Drop to create an {kind} input node",
    "board.drop.importHere": "Drop to import into \u201C{name}\u201D",
    "board.drop.typeMismatch": "This node only accepts {kind}",
    "board.drop.imported": "Imported {count} assets",
    // ---- inspector (ai-board layout) ----
    "board.inspect.inputs": "Inputs",
    "board.inspect.inputsTitle": "Input ports",
    "board.inspect.bindings": "Bound {bound}/{total}",
    "board.inspect.selectedCount": "{count} selected",
    "board.inspect.pickMultiple": "Pick one or more upstreams",
    "board.inspect.moveUp": "Move up",
    "board.inspect.moveDown": "Move down",
    "board.inspect.removeBinding": "Disconnect this input",
    "board.inspect.outBindings": "Output links",
    "board.inspect.outBindingsHint": "Connect a downstream node, then choose which output it follows (vocals / drums / video / audio\u2026).",
    "board.inspect.outputRebound": "Output port changed for this link",
    "board.inspect.connected": "Connected \xB7 {name}",
    "board.inspect.unconnected": "Not connected",
    "board.inspect.outputs": "Outputs",
    "board.inspect.published": "Published",
    "board.inspect.notRun": "Not run",
    "board.inspect.title": "Title",
    "board.inspect.titlePlaceholder": "Node title",
    "board.inspect.mediaSection": "Media",
    "board.inspect.mediaHint": "Pick a local file or add straight from the library; images can stack.",
    "board.inspect.aspectHint": "Image nodes resize their height to the asset ratio.",
    "board.inspect.aspectHintVideo": "Video nodes resize their height to the asset ratio.",
    "board.inspect.connectedHint": "Connect an upstream node to this port on the canvas.",
    "board.inspect.boundTo": "Connected to {name}",
    "board.inspect.connectFirst": "Connect a {type} node upstream first.",
    "board.inspect.outputReady": "Publishes after run",
    "board.inspect.noMedia": "No media yet",
    "board.run.schedule": "Parallel scheduling",
    "board.run.smartOrder": "Smart ordering",
    "board.run.smartOrderHint": "Run the nodes that unlock the most downstream work first",
    "board.run.smartMemory": "Smart VRAM allocation",
    "board.run.smartMemoryHint": "Queue local tasks by the VRAM / RAM budget; pure API branches run fully in parallel",
    "board.run.plan": "This run: {instant} instant \xB7 {api} API \xB7 {gpu} local GPU \xB7 {cpu} local CPU",
    "board.run.modeTip": "Run mode: {mode}",
    "board.run.modeShort.manual": "Manual",
    "board.run.modeShort.always": "Auto",
    "board.run.modeShort.repeat": "Repeat",
    "board.resize.hint": "Drag the bottom-right corner to resize",
    // ---- Canvas inspector / multiple canvases / workflow signature ----
    "board.canvas.title": "Canvas",
    "board.canvas.list": "Canvases",
    "board.canvas.count": "{count}",
    "board.canvas.current": "Current",
    "board.canvas.defaultTitle": "Canvas {n}",
    "board.canvas.copySuffix": "copy",
    "board.canvas.new": "New canvas",
    "board.canvas.duplicate": "Duplicate canvas",
    "board.canvas.rename": "Rename canvas",
    "board.canvas.delete": "Delete canvas",
    "board.canvas.deleteTitle": "Delete canvas",
    "board.canvas.deleteMessage": "Delete \u201C{name}\u201D? Its nodes and edges go with it; versions already saved to the workflow library are untouched.",
    "board.canvas.switch": "Switch",
    "board.canvas.emptyTitle": "No node selected",
    "board.canvas.emptyHint": "Click empty canvas space to come back here. This list manages every canvas in the project.",
    "board.canvas.selectHint": "Select a node to edit its parameters; click empty space to return to the canvas list.",
    "board.canvas.nodeCount": "{count} nodes",
    "board.canvas.publish": "Publish",
    "board.canvas.publishTitle": "Publish workflow",
    "board.canvas.publishTarget": "Canvas: {name}",
    "board.canvas.publishedBadge": "Published",
    "board.canvas.publishHint": "A canvas with a paired workflow start/end and a valid graph can be saved as a callable sub-workflow or API.",
    "board.canvas.publishReady": "Ready to publish",
    "board.canvas.publishBlocked": "Not publishable yet",
    "board.canvas.api": "Callable API",
    "board.canvas.apiHint": "Expose it to AI Harness / MCP callers (filter \u201CAPI\u201D in the workflow library).",
    "board.canvas.subworkflow": "Embeddable",
    "board.canvas.subworkflowHint": "Let other canvases call it with the \u201CEmbed workflow\u201D node (filter \u201CSub-workflow\u201D in the library).",
    "board.canvas.savePublish": "Save & publish",
    "board.canvas.savedPublish": "Published: {name} v{version}",
    "board.canvas.publishName": "Workflow name",
    "board.canvas.publishNamePlaceholder": "e.g. Product image workflow",
    "board.canvas.signature": "Signature",
    "board.canvas.signatureSummary": "{inputs} inputs \xB7 {outputs} outputs",
    "board.canvas.signatureNone": "No inputs or outputs declared",
    "board.canvas.problemCount": "{count} problems",
    "board.canvas.problem.missingWorkflowNodes": "Missing sub-workflow nodes",
    "board.canvas.problem.missingStart": "Missing workflow start node",
    "board.canvas.problem.missingEnd": "Missing workflow end node",
    "board.canvas.problem.multipleStart": "Only one workflow start node is allowed",
    "board.canvas.problem.multipleEnd": "Only one workflow end node is allowed",
    "board.canvas.problem.pairBroken": "The workflow start/end nodes are not paired",
    "board.canvas.problem.inputNameEmpty": "An input has no name",
    "board.canvas.problem.outputNameEmpty": "An output has no name",
    "board.canvas.problem.duplicateInput": "Duplicate input name: {name}",
    "board.canvas.problem.duplicateOutput": "Duplicate output name: {name}",
    "board.canvas.problem.unknownType": "Unknown type: {name} \u2192 {type}",
    "board.canvas.problem.unboundOutput": "Output \u201C{name}\u201D has no upstream",
    "board.canvas.problem.cycle": "The canvas has a cycle and cannot run in order",
    "board.inspect.workflowInputs": "Workflow inputs",
    "board.inspect.workflowOutputs": "Workflow outputs",
    "board.inspect.addSignatureInput": "Add input",
    "board.inspect.addSignatureOutput": "Add output",
    "board.inspect.signatureName": "Name",
    "board.inspect.signatureLabel": "Label",
    "board.inspect.signatureType": "Type",
    "board.inspect.signatureDefault": "Default",
    "board.inspect.signatureRequired": "Required",
    "board.inspect.signatureRemove": "Remove this row",
    "board.inspect.signatureEmpty": "Nothing declared yet. Use the button below to add a row.",
    "board.inspect.workflowTarget": "Target workflow",
    "board.inspect.workflowTargetEmpty": "Pick a sub-workflow to embed",
    "board.inspect.workflowTargetHint": "The child\u2019s inputs and outputs come from its start/end nodes; rows map by signature port.",
    "board.inspect.workflowMissing": "The target workflow no longer exists; ports and edges are kept and the run reports it.",
    "board.inspect.workflowTargetPublished": "No published sub-workflow yet \u2014 publish a canvas from the canvas inspector or the workflow library first.",
    "board.inspect.signatureTypeHint": "Types come from the data-type registry \u2014 plugin types show up here too.",
    "board.node.workflow": "Sub-workflow",
    "board.node.workflowStart": "Workflow start",
    "board.node.workflowEnd": "Workflow end",
    "board.node.workflowCall": "Embed workflow",
    "board.node.workflowEmbed": "Embed workflow",
    "board.param.workflow": "Target workflow",
    "board.param.workflowName": "Workflow name",
    "board.port.workflowInput": "Input",
    "board.port.workflowOutput": "Output",
    "board.workflow.defaultInput": "Prompt",
    "board.workflow.defaultOutput": "Result",
    "board.workflow.inIndex": "IN {n}",
    "board.workflow.outIndex": "OUT {n}",
    "board.workflow.newInput": "Input {n}",
    "board.workflow.newOutput": "Output {n}",
    "board.workflow.noTarget": "No workflow selected to embed",
    "board.workflow.missingInput": "Missing required input: {name}",
    "board.workflow.signatureChanged": "\u201C{name}\u201D changed its input signature \u2014 re-select the target workflow in the inspector",
    "board.workflow.notRunnable": "\u201C{name}\u201D is missing a paired workflow start/end",
    "board.workflow.missing": "Workflow \u201C{name}\u201D was not found (it may have been deleted)",
    "board.workflow.cycle": "Nested workflow cycle: {name}",
    "board.workflow.tooDeep": "Nested workflows exceed 8 levels: {name}",
    "board.loop.source": "Source",
    "board.library.filterWorkflow": "Sub-workflows",
    "board.library.filterApi": "API",
    "board.library.untitledWorkflow": "Untitled workflow",
    "board.library.badgeBase": "Workflow",
    "board.library.badgeWorkflow": "Sub-workflow",
    "board.library.badgeApi": "API",
    "board.library.publishHint": "Save a signed workflow to the library so it can be embedded or called through the API / AI Harness.",
    "board.clear.unsavedTitle": "Clear canvas",
    "board.clear.unsavedMessage": "This canvas has not been saved as a workflow yet. Clearing now loses what you built.",
    "board.clear.saveAndClear": "Save & clear",
    "board.clear.clearWithoutSave": "Clear without saving",
    "board.clear.cleared": "Canvas cleared",
    "board.run.stopped": "Cancelled"
  };
  var en_default = en;

  // src/i18n/zh.ts
  var zh = {
    // ---- 通用 ----
    "common.ok": "\u597D",
    "common.cancel": "\u53D6\u6D88",
    "common.save": "\u4FDD\u5B58",
    "common.delete": "\u5220\u9664",
    "common.close": "\u5173\u95ED",
    "common.none": "\u65E0",
    "common.add": "\u6DFB\u52A0",
    "common.remove": "\u79FB\u9664",
    "common.rename": "\u91CD\u547D\u540D",
    "common.search": "\u641C\u7D22",
    "common.all": "\u5168\u90E8",
    "common.loading": "\u52A0\u8F7D\u4E2D\u2026",
    "app.restoring": "\u6B63\u5728\u6062\u590D\u4E0A\u6B21\u7684\u5DE5\u7A0B\u2026",
    "common.confirm": "\u786E\u5B9A",
    "common.back": "\u8FD4\u56DE",
    "common.more": "\u66F4\u591A\u64CD\u4F5C",
    "common.listSeparator": "\u3001",
    "value.decrease": "\u51CF\u5C11{name}",
    "value.increase": "\u589E\u52A0{name}",
    "value.none": "\u6570\u503C",
    // ---- 工程 ----
    "project.untitled": "\u672A\u547D\u540D\u9879\u76EE",
    "project.current": "\u5F53\u524D\u5DE5\u7A0B",
    "project.fileFilter": "AI Cut \u5DE5\u7A0B",
    "project.resolution": "{width} \xD7 {height}",
    // ---- 工程名对话框 ----
    "projectDialog.renameTitle": "\u91CD\u547D\u540D\u5DE5\u7A0B",
    "projectDialog.nameLabel": "\u5DE5\u7A0B\u540D\u79F0",
    "projectDialog.confirm": "\u4FDD\u5B58",
    "projectDialog.placeholder": "\u672A\u547D\u540D\u9879\u76EE",
    "projectDialog.saveTitle": "\u4FDD\u5B58\u5DE5\u7A0B",
    "projectDialog.saveHint": "\u63A5\u4E0B\u6765\u9009\u62E9\u5DE5\u7A0B\u7684\u4FDD\u5B58\u4F4D\u7F6E\u3002",
    "projectDialog.confirmSave": "\u7EE7\u7EED",
    // ---- 顶栏 ----
    "topbar.history": "\u5386\u53F2\u5DE5\u7A0B",
    "topbar.historyLabel": "\u5386\u53F2\u5DE5\u7A0B",
    "topbar.new": "\u65B0\u5EFA\u5DE5\u7A0B",
    "topbar.newLabel": "\u65B0\u5EFA\u5DE5\u7A0B",
    "topbar.open": "\u6253\u5F00\u5DE5\u7A0B\u2026",
    "topbar.openLabel": "\u6253\u5F00\u5DE5\u7A0B",
    "topbar.save": "\u4FDD\u5B58",
    "topbar.saveLabel": "\u4FDD\u5B58\u5DE5\u7A0B",
    "topbar.export": "\u5BFC\u51FA\u89C6\u9891",
    "topbar.exportLabel": "\u5BFC\u51FA\u89C6\u9891",
    "topbar.settings": "\u8BBE\u7F6E",
    "topbar.backToWorkspace": "\u8FD4\u56DE\u5DE5\u4F5C\u533A",
    "topbar.github": "GitHub \u4ED3\u5E93",
    "topbar.githubLabel": "\u6253\u5F00 GitHub \u4ED3\u5E93",
    "topbar.rename": "\u91CD\u547D\u540D\u5DE5\u7A0B",
    "topbar.renameLabel": "\u91CD\u547D\u540D\u5DE5\u7A0B",
    "topbar.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8",
    "topbar.hidePanel": "\u6536\u8D77\u53F3\u4FA7\u8FB9\u680F",
    "topbar.showPanel": "\u5C55\u5F00\u53F3\u4FA7\u8FB9\u680F",
    "topbar.resolution": "{width}\xD7{height} \xB7 {fps}fps",
    "topbar.shortcuts": "\u5FEB\u6377\u952E",
    "topbar.layout": "\u5E03\u5C40",
    "topbar.layout.landscape": "\u6A2A\u5C4F",
    "topbar.layout.landscapeHint": "\u9884\u89C8\u5728\u4E0A\uFF0C\u65F6\u95F4\u7EBF\u5728\u4E0B",
    "topbar.layout.portrait": "\u7AD6\u5C4F",
    "topbar.layout.portraitHint": "\u9884\u89C8\u5728\u5DE6\uFF0C\u6807\u7B7E\u9875\u5728\u4E0A\u3001\u65F6\u95F4\u7EBF\u5728\u4E0B",
    "topbar.aiEdit": "AI \u526A\u8F91",
    "topbar.aiEditHint": "\u53EB\u51FA\u667A\u80FD\u4F53\uFF0C\u7528\u4E00\u53E5\u8BDD\u6539\u65F6\u95F4\u7EBF",
    "topbar.menu.file": "\u6587\u4EF6",
    "topbar.menu.help": "\u5E2E\u52A9",
    "topbar.menu.new": "\u65B0\u5EFA\u5DE5\u7A0B",
    "topbar.menu.open": "\u6253\u5F00\u5DE5\u7A0B\u2026",
    "topbar.menu.import": "\u5BFC\u5165\u7D20\u6750\u2026",
    "topbar.menu.history": "\u5386\u53F2\u5DE5\u7A0B",
    "topbar.menu.workflowGroup": "\u5DE5\u4F5C\u6D41",
    "topbar.menu.workflowSave": "\u4FDD\u5B58\u5DE5\u4F5C\u6D41\u5230\u5E93",
    "topbar.menu.workflowLibrary": "\u6253\u5F00\u5DE5\u4F5C\u6D41\u5E93",
    "topbar.menu.workflowExport": "\u5BFC\u51FA\u5DE5\u4F5C\u6D41\u2026",
    "topbar.menu.workflowImport": "\u5BFC\u5165\u5DE5\u4F5C\u6D41\u2026",
    "topbar.menu.saveGroup": "\u4FDD\u5B58\u4E0E\u5BFC\u51FA",
    "topbar.menu.save": "\u4FDD\u5B58",
    "topbar.menu.saveAs": "\u53E6\u5B58\u4E3A\u2026",
    "topbar.menu.export": "\u5BFC\u51FA\u89C6\u9891\u2026",
    "topbar.menu.quickStart": "\u5FEB\u901F\u4E0A\u624B",
    "topbar.menu.shortcuts": "\u5FEB\u6377\u952E\u901F\u67E5",
    "topbar.menu.github": "GitHub \u4ED3\u5E93",
    // ---- 欢迎页与新手引导 ----
    "onboarding.heroNote": "\u7D20\u6750\u548C\u5DE5\u7A0B\u90FD\u7559\u5728\u4F60\u7684\u7535\u8111\u4E0A\uFF1BAI \u6A21\u578B\u6309\u9700\u4E0B\u8F7D\uFF0C\u968F\u65F6\u53EF\u4EE5\u79BB\u7EBF\u526A\u8F91\u3002",
    "onboarding.eyebrow": "AI \u89C6\u9891\u526A\u8F91 \xB7 \u672C\u5730\u4F18\u5148",
    "onboarding.title": "\u4ECE\u4E00\u6BB5\u7D20\u6750\u5F00\u59CB\uFF0C\u5269\u4E0B\u7684\u4EA4\u7ED9 AI",
    "onboarding.subtitle": "\u5BFC\u5165\u89C6\u9891\u3001\u56FE\u7247\u6216\u97F3\u9891\uFF0C\u62D6\u5230\u65F6\u95F4\u7EBF\u4E0A\u5C31\u80FD\u526A\u3002\u5B57\u5E55\u3001\u914D\u97F3\u3001\u753B\u9762\u751F\u6210\u548C\u667A\u80FD\u4F53\u90FD\u5728\u53F3\u4FA7\u9762\u677F\u91CC\u3002",
    "onboarding.eyebrowBack": "\u6B22\u8FCE\u56DE\u6765",
    "onboarding.titleBack": "\u63A5\u7740\u4E0A\u6B21\u7684\u8FDB\u5EA6\u7EE7\u7EED",
    "onboarding.subBack": "\u65F6\u95F4\u7EBF\u3001\u7D20\u6750\u548C\u64A4\u9500\u8BB0\u5F55\u90FD\u8FD8\u5728\u3002\u4E5F\u53EF\u4EE5\u4ECE\u4E0B\u9762\u6311\u4E00\u4E2A\u65B0\u7684\u8D77\u70B9\u3002",
    "onboarding.startResume": "\u6253\u5F00\u4E0A\u6B21\u5DE5\u7A0B",
    "onboarding.startResumeHint": "\u63A5\u7740\u300C{name}\u300D\u7EE7\u7EED\uFF0C\u7D20\u6750\u548C\u65F6\u95F4\u7EBF\u90FD\u5728",
    "onboarding.startBlank": "\u6253\u5F00\u7A7A\u767D\u5DE5\u7A0B",
    "onboarding.startBlankHint": "\u4ECE\u4E00\u6761\u7A7A\u65F6\u95F4\u7EBF\u5F00\u59CB\uFF0C\u81EA\u5DF1\u642D",
    "onboarding.startImport": "\u5BFC\u5165\u7D20\u6750\uFF0C\u5F00\u59CB\u526A",
    "onboarding.startImportHint": "\u89C6\u9891\u3001\u56FE\u7247\u3001\u97F3\u9891\u90FD\u652F\u6301\uFF0C\u62D6\u8FDB\u6765\u5C31\u80FD\u7528",
    "onboarding.startAi": "AI \u5E2E\u6211\u526A",
    "onboarding.startAiHint": "\u53EB\u51FA\u667A\u80FD\u4F53\uFF0C\u7528\u4E00\u53E5\u8BDD\u6539\u65F6\u95F4\u7EBF",
    "onboarding.startHistory": "\u5386\u53F2\u5DE5\u7A0B",
    "onboarding.startHistoryHint": "\u4ECE\u5386\u53F2\u5DE5\u7A0B\u91CC\u6311\u4E00\u4E2A\u7248\u672C\u7EE7\u7EED",
    "onboarding.startOpen": "\u6253\u5F00\u5DE5\u7A0B\u6587\u4EF6",
    "onboarding.startOpenHint": "\u6253\u5F00\u4E4B\u524D\u4FDD\u5B58\u7684 AI Cut \u5DE5\u7A0B",
    "onboarding.recommended": "\u63A8\u8350",
    "onboarding.projectNote": "\u5F53\u524D\u5DE5\u7A0B\uFF1A{name}",
    "onboarding.later": "\u5148\u968F\u4FBF\u770B\u770B",
    "onboarding.skip": "\u5173\u95ED\u6B22\u8FCE\u9875",
    "onboarding.tourCta": "60 \u79D2\u4E0A\u624B",
    "onboarding.tour.title": "\u5FEB\u901F\u4E0A\u624B",
    "onboarding.tour.counter": "\u7B2C {n} / {total} \u6B65",
    "onboarding.tour.skip": "\u7ED3\u675F\u5F15\u5BFC",
    "onboarding.tour.prev": "\u4E0A\u4E00\u6B65",
    "onboarding.tour.next": "\u4E0B\u4E00\u6B65",
    "onboarding.tour.done": "\u5F00\u59CB\u526A",
    "onboarding.tour.previewTitle": "\u8FD9\u91CC\u662F\u9884\u89C8",
    "onboarding.tour.previewBody": "\u9009\u4E2D\u7247\u6BB5\u540E\u753B\u9762\u5B9E\u65F6\u66F4\u65B0\u3002\u7A7A\u683C\u64AD\u653E / \u6682\u505C\uFF0C\u2190 / \u2192 \u9010\u5E27\u68C0\u67E5\u3002",
    "onboarding.tour.panelsTitle": "\u53F3\u4FA7\u9762\u677F",
    "onboarding.tour.panelsBody": "\u5A92\u4F53\u5E93\u3001\u68C0\u67E5\u5668\u3001AI\u3001\u6A21\u578B\u90FD\u5728\u8FD9\u91CC\u3002\u7528\u6807\u9898\u680F\u7684\u300C+\u300D\u6253\u5F00\u66F4\u591A\uFF0C\u62D6\u5DE6\u8FB9\u7F18\u8C03\u5BBD\u5EA6\u3002",
    "onboarding.tour.timelineTitle": "\u65F6\u95F4\u7EBF\u5C31\u662F\u526A\u8F91\u53F0",
    "onboarding.tour.timelineBody": "\u628A\u7D20\u6750\u62D6\u8FDB\u6765\uFF0C\u62D6\u52A8\u7247\u6BB5\u79FB\u52A8\uFF0C\u62D6\u8FB9\u7F18\u6539\u957F\u5EA6\uFF1B\u53F3\u952E\u8FD8\u6709 AI \u52A8\u4F5C\u3002",
    "onboarding.tour.aiTitle": "AI \u526A\u8F91",
    "onboarding.tour.aiBody": "\u70B9\u4E00\u4E0B\u53EB\u51FA\u667A\u80FD\u4F53\uFF1A\u5B57\u5E55\u3001\u914D\u97F3\u3001\u751F\u6210\u753B\u9762\u90FD\u53EF\u4EE5\u7528\u4E00\u53E5\u8BDD\u53D1\u8D77\u3002",
    "onboarding.tour.fileTitle": "\u6587\u4EF6\u4E0E\u5BFC\u51FA",
    "onboarding.tour.fileBody": "\u65B0\u5EFA\u3001\u6253\u5F00\u3001\u5386\u53F2\u3001\u4FDD\u5B58\u3001\u5BFC\u51FA\u90FD\u5728\u8FD9\u91CC\uFF0C\u53F3\u8FB9\u5199\u7740\u5FEB\u6377\u952E\u3002",
    "onboarding.tour.settingsTitle": "\u8BBE\u7F6E",
    "onboarding.tour.settingsBody": "\u6362\u4E3B\u9898\u3001\u8BED\u8A00\uFF0C\u7BA1\u7406\u6A21\u578B\u3001\u5B58\u50A8\u548C AI \u540E\u7AEF\u3002",
    // ---- 快捷键速查 ----
    "shortcuts.title": "\u5FEB\u6377\u952E",
    "shortcuts.group.playback": "\u64AD\u653E",
    "shortcuts.group.edit": "\u7F16\u8F91",
    "shortcuts.group.project": "\u5DE5\u7A0B",
    "shortcuts.group.view": "\u89C6\u56FE",
    "shortcuts.playPause": "\u64AD\u653E / \u6682\u505C",
    "shortcuts.prevFrame": "\u4E0A\u4E00\u5E27",
    "shortcuts.nextFrame": "\u4E0B\u4E00\u5E27",
    "shortcuts.undo": "\u64A4\u9500",
    "shortcuts.redo": "\u91CD\u505A",
    "shortcuts.copy": "\u590D\u5236\u7247\u6BB5",
    "shortcuts.cut": "\u526A\u5207\u7247\u6BB5",
    "shortcuts.paste": "\u7C98\u8D34\u7247\u6BB5",
    "shortcuts.split": "\u5728\u64AD\u653E\u5934\u5904\u5206\u5272",
    "shortcuts.delete": "\u5220\u9664\u9009\u4E2D\u7247\u6BB5",
    "shortcuts.new": "\u65B0\u5EFA\u5DE5\u7A0B",
    "shortcuts.open": "\u6253\u5F00\u5DE5\u7A0B",
    "shortcuts.save": "\u4FDD\u5B58\u5DE5\u7A0B",
    "shortcuts.saveAs": "\u53E6\u5B58\u4E3A",
    "shortcuts.togglePanel": "\u663E\u793A / \u6536\u8D77\u53F3\u4FA7\u9762\u677F",
    "shortcuts.settings": "\u6253\u5F00 / \u5173\u95ED\u8BBE\u7F6E",
    "shortcuts.zoom": "\u7F29\u653E\u65F6\u95F4\u7EBF",
    "shortcuts.deselect": "\u53D6\u6D88\u9009\u62E9",
    // ---- 面板 ----
    "panel.media": "\u5A92\u4F53\u5E93",
    "panel.mediaHint": "\u7D20\u6750\u3001\u97F3\u4E50\u4E0E\u5B57\u5E55\u6587\u4EF6",
    "panel.inspector": "\u68C0\u67E5\u5668",
    "panel.inspectorHint": "\u53D8\u6362\u3001\u97F3\u9891\u4E0E\u5408\u6210\u53C2\u6570",
    "panel.ops": "\u64CD\u4F5C\u8BB0\u5F55",
    "panel.opsHint": "\u4EBA\u3001\u5185\u7F6E\u52A9\u624B\u4E0E\u5916\u90E8 AI \u7684\u6BCF\u4E00\u6B65\u6539\u52A8",
    "panel.agent": "\u526A\u8F91\u667A\u80FD\u4F53",
    "panel.agentHint": "\u5BF9\u8BDD\u5F0F\u526A\u8F91\uFF0C\u76F4\u63A5\u6539\u65F6\u95F4\u7EBF",
    "panel.ai": "AI \u529F\u80FD",
    "panel.aiHint": "MCP\u3001Skills \u4E0E AI \u80FD\u529B",
    "panel.models": "\u4E0B\u8F7D\u7BA1\u7406\u5668",
    "panel.modelsHint": "\u6A21\u578B\u4E0E\u63D2\u4EF6\u4E0B\u8F7D",
    "panel.plugins": "OFX \u63D2\u4EF6",
    "panel.pluginsHint": "\u6253\u5F00\u5DF2\u5B89\u88C5\u7684 OpenFX \u63D2\u4EF6",
    "panel.extensions": "\u5E94\u7528\u6269\u5C55",
    "panel.extensionsHint": "\u80FD\u52A0\u753B\u5E03\u8282\u70B9\u3001\u547D\u4EE4\u4E0E\u6587\u6848\u7684\u7B2C\u4E09\u65B9\u5E94\u7528\u6269\u5C55",
    "extensions.title": "\u5E94\u7528\u6269\u5C55",
    "extensions.subtitle": "\u80FD\u52A0\u753B\u5E03\u8282\u70B9\u3001\u547D\u4EE4\u4E0E\u6587\u6848\u7684\u7B2C\u4E09\u65B9\u5E94\u7528\u6269\u5C55",
    "extensions.empty": "\u8FD8\u6CA1\u6709\u5BFC\u5165\u4EFB\u4F55\u5E94\u7528\u6269\u5C55",
    "extensions.loading": "\u6B63\u5728\u8BFB\u53D6\u5E94\u7528\u6269\u5C55\u2026",
    "extensions.install": "\u5BFC\u5165\u672C\u5730\u76EE\u5F55",
    "extensions.enable": "\u542F\u7528",
    "extensions.reload": "\u91CD\u65B0\u52A0\u8F7D",
    "extensions.disable": "\u7981\u7528",
    "extensions.incompatible": "\u7248\u672C\u4E0D\u517C\u5BB9",
    "extensions.confirmRemove": "\u79FB\u9664\u5E94\u7528\u6269\u5C55 {name}\uFF1F\uFF08\u4E0D\u4F1A\u5220\u9664\u78C1\u76D8\u4E0A\u7684\u6E90\u76EE\u5F55\uFF09",
    "extensions.tabInstalled": "\u5DF2\u5B89\u88C5",
    "extensions.tabDiscover": "\u53D1\u73B0",
    "extensions.search": "\u641C\u7D22\u5E94\u7528\u6269\u5C55",
    "extensions.refresh": "\u5237\u65B0",
    "extensions.installFromMarket": "\u5B89\u88C5",
    "extensions.updateTo": "\u66F4\u65B0\u5230 {version}",
    "extensions.marketEmpty": "\u8FD9\u4E2A\u7D22\u5F15\u91CC\u8FD8\u6CA1\u6709\u5E94\u7528\u6269\u5C55",
    "extensions.subInstalled": "{count} \u4E2A\u5E94\u7528\u6269\u5C55",
    "extensions.subDiscover": "{count} \u4E2A\u53EF\u5B89\u88C5",
    "extensions.marketSource": "\u7D22\u5F15\u6E90",
    "extensions.marketOnline": "\u7D22\u5F15\uFF1A\u5728\u7EBF",
    "extensions.marketCached": "\u7D22\u5F15\uFF1A\u7F13\u5B58",
    "extensions.marketStale": "\u7D22\u5F15\uFF1A\u79BB\u7EBF\u7F13\u5B58",
    "extensions.marketUnknown": "\u7D22\u5F15\uFF1A\u672A\u52A0\u8F7D",
    "extensions.marketSourceSettings": "\u7D22\u5F15\u6E90\u8BBE\u7F6E",
    "extensions.marketUpdate": "\u6709\u65B0\u7248\u672C",
    "extensions.marketInstalled": "\u5DF2\u5B89\u88C5",
    "extensions.enabled": "\u5DF2\u542F\u7528",
    "extensions.disabled": "\u5DF2\u7981\u7528",
    "extensions.kindStore": "\u6258\u7BA1\u5B89\u88C5",
    "extensions.kindLinked": "\u672C\u5730\u76EE\u5F55",
    "panel.pluginEditor": "\u53C2\u6570\u754C\u9762",
    "panel.pluginEditorHint": "\u7F16\u8F91\u5F53\u524D OFX \u7279\u6548\u7684\u53C2\u6570",
    "panel.emptyTitle": "\u8FD8\u6CA1\u6709\u6253\u5F00\u7684\u9762\u677F",
    "panel.emptySub": "\u4ECE\u4E0B\u9762\u6311\u4E00\u4E2A\uFF0C\u6216\u8005\u7528\u6807\u9898\u680F\u7684\u300C+\u300D",
    "panel.pickerTitle": "\u9762\u677F",
    "panel.newTab": "\u65B0\u5EFA\u6807\u7B7E\u9875",
    "panel.closeTab": "\u5173\u95ED{name}",
    "panel.opened": "\u5DF2\u6253\u5F00",
    // ---- 媒体库 ----
    "media.title": "\u5A92\u4F53\u5E93",
    "media.sub": "{assets} \u4E2A\u7D20\u6750 \xB7 {texts} \u4E2A\u6587\u672C",
    "media.search": "\u641C\u7D22\u7D20\u6750",
    "media.filterGroup": "\u7D20\u6750\u7C7B\u578B",
    "media.filter.all": "\u5168\u90E8",
    "media.filter.video": "\u89C6\u9891",
    "media.filter.audio": "\u97F3\u9891",
    "media.filter.image": "\u56FE\u7247",
    "media.filter.text": "\u6587\u672C",
    "media.dragHint": "\u62D6\u5230\u65F6\u95F4\u7EBF\uFF0C\u6216\u62D6\u5230\u753B\u5E03\u4E0A\u521B\u5EFA\u8F93\u5165\u8282\u70B9",
    "media.import": "\u5BFC\u5165\u7D20\u6750",
    "media.importing": "\u5BFC\u5165\u4E2D\u2026",
    "media.importMedia": "\u5BFC\u5165\u5A92\u4F53",
    "media.importAndPlace": "\u5BFC\u5165\u5E76\u653E\u5230\u65F6\u95F4\u7EBF",
    "media.empty": "\u8FD8\u6CA1\u6709\u7D20\u6750\uFF0C\u70B9\u53F3\u4E0A\u89D2\u5BFC\u5165",
    "media.noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u7D20\u6750",
    "media.offline": "\u79BB\u7EBF",
    "media.deleteNamed": "\u5220\u9664\u7D20\u6750\u300C{name}\u300D",
    "media.confirmDelete": "\u5220\u9664\u7D20\u6750\uFF1F",
    "media.confirmDeleteMessage": "\u300C{name}\u300D\u4F1A\u4ECE\u5A92\u4F53\u5E93\u5220\u9664\uFF0C\u65F6\u95F4\u7EBF\u4E0A\u5F15\u7528\u5B83\u7684 {count} \u4E2A\u7247\u6BB5\u4E5F\u4F1A\u4E00\u5E76\u5220\u9664\u3002",
    "media.confirmDeleteEmpty": "\u300C{name}\u300D\u4F1A\u4ECE\u5A92\u4F53\u5E93\u5220\u9664\u3002",
    "media.deleted": "\u5DF2\u5220\u9664\u300C{name}\u300D",
    "media.confirmDeletePreset": "\u5220\u9664\u6587\u5B57\u9884\u8BBE\uFF1F",
    "media.confirmDeletePresetMessage": "\u300C{name}\u300D\u4F1A\u4ECE\u5A92\u4F53\u5E93\u5220\u9664\uFF0C\u5DF2\u63D2\u5165\u7684\u7247\u6BB5\u4E0D\u53D7\u5F71\u54CD\u3002",
    "media.presetDeleted": "\u5DF2\u5220\u9664\u9884\u8BBE\u300C{name}\u300D",
    "media.applyPresetNamed": "\u628A\u300C{name}\u300D\u6837\u5F0F\u5E94\u7528\u5230\u9009\u4E2D\u7684\u6587\u5B57",
    "media.applyPresetHint": "\u5E94\u7528\u5230\u9009\u4E2D\u7684 {count} \u4E2A\u6587\u5B57\u7247\u6BB5",
    "media.applyPresetEmpty": "\u5148\u9009\u4E2D\u81F3\u5C11\u4E00\u4E2A\u6587\u5B57\u7247\u6BB5",
    "media.applyPresetDone": "\u5DF2\u5E94\u7528\u5230 {count} \u4E2A\u6587\u5B57\u7247\u6BB5",
    "media.imported": "\u5DF2\u5BFC\u5165 {count} \u4E2A\u7D20\u6750",
    "media.importedToTimeline": "\u5DF2\u5BFC\u5165 {count} \u4E2A\u7D20\u6750\uFF0C\u5E76\u653E\u5230\u65F6\u95F4\u7EBF",
    "media.importFailed": "\u5BFC\u5165\u5931\u8D25\uFF1A{error}",
    "media.textInfo": "\u6587\u672C \xB7 {seconds} \u79D2",
    "media.kind.audio": "\u97F3\u9891",
    "media.kind.image": "\u56FE\u7247",
    "media.kind.video": "\u89C6\u9891",
    "media.noAudioStream": "\u65E0\u97F3\u9891\u6D41",
    "media.fileFilter": "\u5A92\u4F53\u6587\u4EF6",
    "media.collect": "\u6574\u7406\u5DE5\u7A0B\u7D20\u6750",
    "media.collectConfirm": "\u628A {count} \u4E2A\u7D20\u6750\u590D\u5236\u5230\u5DE5\u7A0B\u65C1\u8FB9\u7684\u300C-media\u300D\u6587\u4EF6\u5939\uFF0C\u5E76\u628A\u5DE5\u7A0B\u6539\u4E3A\u5F15\u7528\u526F\u672C\u3002\u539F\u6587\u4EF6\u4E0D\u4F1A\u88AB\u5220\u9664\u3002",
    "media.collectDone": "\u5DF2\u6574\u7406 {count} \u4E2A\u7D20\u6750\u5230\u5DE5\u7A0B\u76EE\u5F55\uFF08\u8BB0\u5F97\u4FDD\u5B58\u5DE5\u7A0B\uFF09",
    "media.collectFailed": "\u6574\u7406\u7D20\u6750\u5931\u8D25\uFF1A{message}",
    "media.collectNoProject": "\u5148\u4FDD\u5B58\u5DE5\u7A0B\uFF0C\u518D\u6574\u7406\u7D20\u6750",
    "media.collectEmpty": "\u5DE5\u7A0B\u91CC\u8FD8\u6CA1\u6709\u7D20\u6750",
    // ---- 文本预设 ----
    "textPreset.default.name": "\u9ED8\u8BA4\u6587\u672C",
    "textPreset.default.text": "\u9ED8\u8BA4\u6587\u672C",
    "textPreset.autoName": "\u6587\u5B57\u6837\u5F0F {n}",
    "textPreset.saved": "\u5DF2\u4FDD\u5B58\u9884\u8BBE\u300C{name}\u300D",
    "textPreset.saveTitle": "\u4FDD\u5B58\u6587\u5B57\u9884\u8BBE",
    "textPreset.nameLabel": "\u9884\u8BBE\u540D\u79F0",
    "textPreset.namePlaceholder": "\u4F8B\u5982\uFF1A\u6807\u9898\u6837\u5F0F",
    "textPreset.save": "\u4FDD\u5B58",
    // ---- 颜色 ----
    "color.hex": "\u5341\u516D\u8FDB\u5236\u989C\u8272",
    "color.swatches": "\u9884\u8BBE\u989C\u8272",
    // ---- 检查器 ----
    "inspector.title": "\u68C0\u67E5\u5668",
    "inspector.multiSelected": "\u5DF2\u9009\u4E2D {count} \u4E2A\u7247\u6BB5\uFF0C\u5C5E\u6027\u4FEE\u6539\u4F1A\u5E94\u7528\u5230\u5168\u90E8",
    "inspector.textSelected": "\u5F53\u524D\u9009\u4E2D\uFF1A\u6587\u5B57\u7247\u6BB5",
    "inspector.mediaSelected": "\u5F53\u524D\u9009\u4E2D\uFF1A\u5A92\u4F53\u7247\u6BB5",
    "inspector.nothingSelected": "\u672A\u9009\u4E2D\u7247\u6BB5",
    "inspector.emptyHint": "\u5728\u65F6\u95F4\u7EBF\u4E0A\u70B9\u4E00\u4E2A\u7247\u6BB5\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u5B83\u7684\u53C2\u6570\u3002",
    "inspector.textClip": "\u6587\u5B57\u7247\u6BB5",
    "inspector.missingAsset": "\u7F3A\u5931\u7D20\u6750",
    "inspector.offline": "\u6E90\u6587\u4EF6\u5DF2\u4E22\u5931",
    "inspector.relink": "\u91CD\u65B0\u94FE\u63A5",
    "inspector.relinked": "\u5DF2\u91CD\u65B0\u94FE\u63A5\u7D20\u6750",
    "inspector.text": "\u6587\u5B57",
    "inspector.transform": "\u53D8\u6362",
    "inspector.positionX": "\u4F4D\u7F6E X\uFF08%\uFF09",
    "inspector.positionY": "\u4F4D\u7F6E Y\uFF08%\uFF09",
    "inspector.scale": "\u7F29\u653E\uFF08%\uFF09",
    "inspector.rotation": "\u65CB\u8F6C\uFF08\xB0\uFF09",
    "inspector.compositing": "\u5408\u6210",
    "inspector.timing": "\u65F6\u95F4",
    "inspector.speed": "\u901F\u5EA6",
    "inspector.duration": "\u65F6\u957F",
    "inspector.colorGrade": "\u8C03\u8272",
    "inspector.brightness": "\u4EAE\u5EA6",
    "inspector.contrast": "\u5BF9\u6BD4\u5EA6",
    "inspector.saturation": "\u9971\u548C\u5EA6",
    "inspector.temperature": "\u8272\u6E29",
    "inspector.tint": "\u8272\u8C03",
    "inspector.reset": "\u91CD\u7F6E",
    "effects.title": "\u7279\u6548",
    "effects.add": "\u6DFB\u52A0\u7279\u6548",
    "effects.probing": "\u63A2\u6D4B\u4E2D\u2026",
    "effects.manage": "\u7BA1\u7406\u63D2\u4EF6",
    "effects.empty": "\u8FD9\u4E2A\u7247\u6BB5\u8FD8\u6CA1\u6709\u7279\u6548\u3002\u6DFB\u52A0\u4E00\u4E2A\u5DF2\u5B89\u88C5\u7684 OFX \u6EE4\u955C\u3001\u751F\u6210\u5668\u3001\u7ED8\u5236\u6216\u53D8\u901F\u63D2\u4EF6\u5F00\u59CB\u3002",
    "effects.loading": "\u52A0\u8F7D\u4E2D\u2026",
    "effects.unavailable": "\u4E0D\u53EF\u7528",
    "effects.notFound": "\u8FD9\u4E2A\u63D2\u4EF6\u5305\u91CC\u6CA1\u6709\u627E\u5230 OFX \u63D2\u4EF6",
    "effects.unsupportedContext": "\u8FD9\u662F\u8F6C\u573A / \u7ED8\u5236 / \u53D8\u901F\u7C7B OFX \u63D2\u4EF6\uFF0C\u5F53\u524D\u7248\u672C\u8FD8\u4E0D\u80FD\u6302\u5230\u7247\u6BB5\u4E0A\u9884\u89C8",
    "effects.someUnsupported": "\u5DF2\u8DF3\u8FC7 {count} \u4E2A\u6682\u4E0D\u652F\u6301\u7684\u8F6C\u573A / \u7ED8\u5236 / \u53D8\u901F\u6548\u679C",
    "effects.choosePlugin": "\u9009\u62E9\u63D2\u4EF6",
    "effects.expand": "\u5C55\u5F00\u53C2\u6570",
    "effects.enabled": "\u542F\u7528\u7279\u6548",
    "effects.toggle": "\u5207\u6362\u7279\u6548",
    "effects.remove": "\u79FB\u9664\u7279\u6548",
    "effects.mixed": "\u6DF7\u5408",
    "effects.openParams": "\u7F16\u8F91\u53C2\u6570",
    "effects.moveUp": "\u4E0A\u79FB",
    "effects.moveDown": "\u4E0B\u79FB",
    "effects.reorder": "\u8C03\u6574\u7279\u6548\u987A\u5E8F",
    "effects.rendering": "\u6B63\u5728\u6E32\u67D3\u6548\u679C {pct}%",
    "effects.renderQueued": "\u7B49\u5F85\u6E32\u67D3\u6548\u679C\u2026",
    "effects.renderFailed": "\u6548\u679C\u6E32\u67D3\u5931\u8D25\uFF1A{error}",
    "effects.renderStalled": "\u6E32\u67D3\u8D85\u65F6\uFF1A\u63D2\u4EF6\u957F\u65F6\u95F4\u6CA1\u6709\u8FD4\u56DE\u753B\u9762\uFF0C\u5DF2\u53D6\u6D88",
    "effects.prerender": "\u9884\u6E32\u67D3",
    "effects.prerenderQueued": "\u6392\u961F\u4E2D\u2026",
    "effects.prerenderReady": "\u5DF2\u9884\u6E32\u67D3",
    "effects.prerenderRetry": "\u91CD\u8BD5\u9884\u6E32\u67D3",
    "effects.prerenderHint": "\u6309\u5F53\u524D\u7279\u6548\u94FE\u9884\u6E32\u67D3\u6574\u4E2A\u7247\u6BB5\uFF1B\u5B8C\u6210\u540E\u64AD\u653E\u4E5F\u80FD\u770B\u5230\u6548\u679C",
    "effects.paintHint": "\u7ED8\u5236\u7C7B\u63D2\u4EF6\u4EE5\u53C2\u6570\u9A71\u52A8\u6E32\u67D3\uFF1B\u5F53\u524D\u5BBF\u4E3B\u6682\u4E0D\u63D0\u4F9B\u4EA4\u4E92\u753B\u7B14 / overlay\u3002",
    "effects.retimerHint": "\u53D8\u901F\uFF08Retimer\uFF09\u63D2\u4EF6\u5FC5\u987B\u653E\u5728\u6548\u679C\u94FE\u7B2C\u4E00\u4F4D\uFF0C\u5B83\u51B3\u5B9A\u6E90\u7D20\u6750\u65F6\u95F4\u3002",
    "effects.retimerOrder": "Retimer \u4E0D\u5728\u6548\u679C\u94FE\u7B2C\u4E00\u4F4D\uFF0C\u9884\u89C8 / \u5BFC\u51FA\u4F1A\u62A5\u9519\uFF1B\u8BF7\u628A\u5B83\u79FB\u5230\u6700\u4E0A\u9762\u3002",
    "inspector.keyframes": "\u5173\u952E\u5E27",
    "keyframe.time": "\u65F6\u95F4\uFF08\u79D2\uFF09",
    "keyframe.add": "\u5728\u64AD\u653E\u5934\u6DFB\u52A0\u5173\u952E\u5E27",
    "keyframe.update": "\u66F4\u65B0\u6B64\u5173\u952E\u5E27",
    "keyframe.empty": "\u8FD8\u6CA1\u6709\u5173\u952E\u5E27",
    "keyframe.seek": "\u8DF3\u5230\u8BE5\u5173\u952E\u5E27",
    "keyframe.remove": "\u5220\u9664\u5173\u952E\u5E27",
    "inspector.transition": "\u8F6C\u573A",
    "transition.in": "\u5165\u573A",
    "transition.out": "\u51FA\u573A",
    "transition.none": "\u65E0",
    "transition.fade": "\u6DE1\u5316",
    "transition.slide": "\u6ED1\u52A8",
    "transition.duration": "\u65F6\u957F\uFF08\u79D2\uFF09",
    "transition.direction": "\u65B9\u5411",
    "transition.left": "\u4ECE\u5DE6",
    "transition.right": "\u4ECE\u53F3",
    "transition.up": "\u4ECE\u4E0B",
    "transition.down": "\u4ECE\u4E0A",
    "transition.ofx": "OFX \u8F6C\u573A",
    "transition.ofxPlugin": "OFX \u63D2\u4EF6",
    "transition.ofxParams": "\u8F6C\u573A\u53C2\u6570",
    "transition.noOfxPlugins": "\u6CA1\u6709\u5B89\u88C5\u652F\u6301\u8F6C\u573A\u7684 OFX \u63D2\u4EF6",
    "inspector.opacity": "\u4E0D\u900F\u660E\u5EA6\uFF08%\uFF09",
    "inspector.audio": "\u97F3\u9891",
    "inspector.volume": "\u97F3\u91CF\uFF08dB\uFF09",
    "inspector.fadeIn": "\u6DE1\u5165\u65F6\u957F\uFF08\u79D2\uFF09",
    "inspector.fadeOut": "\u6DE1\u51FA\u65F6\u957F\uFF08\u79D2\uFF09",
    "inspector.pitch": "\u53D8\u8C03\uFF08\u534A\u97F3\uFF09",
    "inspector.pan": "\u7ACB\u4F53\u58F0\u5E73\u8861\uFF08L/R\uFF09",
    "inspector.extractAudio": "\u5206\u79BB\u97F3\u9891",
    "inspector.extractAudioHint": "\u628A\u89C6\u9891\u753B\u9762\u548C\u58F0\u97F3\u62C6\u5230\u4E24\u6761\u8F68\u9053\uFF0C\u97F3\u9891\u53EF\u4EE5\u5355\u72EC\u5904\u7406",
    "inspector.extractAudioTrack": "\u5206\u79BB\u97F3\u9891",
    "inspector.extractAudioDone": "\u5DF2\u628A\u97F3\u9891\u5206\u79BB\u5230\u65B0\u8F68\u9053",
    // ---- 音频 AI / DSP ----
    "audio.loudness": "\u54CD\u5EA6\u7EDF\u4E00",
    "audio.loudnessTarget": "\u76EE\u6807\u54CD\u5EA6",
    "audio.loudnessHint": "\u6D4B\u91CF\u7247\u6BB5\u5E76\u5199\u5165\u975E\u7834\u574F\u6027\u589E\u76CA",
    "audio.loudnessApply": "\u7EDF\u4E00\u54CD\u5EA6",
    "audio.loudnessSelection": "\u7EDF\u4E00\u6240\u9009\uFF08{count} \u6BB5\uFF09",
    "audio.loudnessAll": "\u5168\u90E8\u97F3\u9891",
    "audio.loudnessProgress": "\u6B63\u5728\u6D4B\u91CF {index} / {total}",
    "audio.loudnessBatchDone": "\u5DF2\u7EDF\u4E00 {count} \u6BB5\u54CD\u5EA6",
    "audio.loudnessBatchPartial": "\u5DF2\u7EDF\u4E00 {count} \u6BB5\uFF1B{skipped} \u6BB5\u6CA1\u6709\u6709\u6548\u97F3\u9891",
    "audio.noTargets": "\u6CA1\u6709\u53EF\u5904\u7406\u7684\u97F3\u9891\u7247\u6BB5",
    "audio.loudness.streaming": "-14 LUFS \xB7 \u6D41\u5A92\u4F53",
    "audio.loudness.podcast": "-16 LUFS \xB7 \u64AD\u5BA2",
    "audio.loudness.broadcast": "-23 LUFS \xB7 \u5E7F\u7535",
    "audio.loudnessResult": "\u6D4B\u5F97 {lufs} LUFS\uFF0C\u5DF2\u5199\u5165 {gain} dB \u589E\u76CA",
    "audio.noSignal": "\u6CA1\u6709\u68C0\u6D4B\u5230\u6709\u6548\u97F3\u9891",
    "audio.denoise": "\u5FEB\u901F\u964D\u566A",
    "audio.denoiseHint": "\u65E0\u6A21\u578B FFT \u964D\u566A\uFF0C\u9002\u5408\u5E95\u566A / \u5636\u58F0",
    "audio.denoise.light": "\u8F7B",
    "audio.denoise.medium": "\u4E2D",
    "audio.denoise.strong": "\u5F3A",
    "audio.denoiseDone": "\u964D\u566A\u5B8C\u6210",
    "audio.denoiseTrack": "\u964D\u566A",
    "audio.beautifyTrack": "\u4EBA\u58F0\u7F8E\u5316",
    "audio.aiDenoiseTrack": "AI \u964D\u566A",
    "audio.muteClip": "\u9759\u97F3\u8BE5\u7247\u6BB5\uFF08\u4FDD\u7559\u753B\u9762\uFF09",
    "audio.beautify": "\u4EBA\u58F0\u7F8E\u5316",
    "audio.beautifyHint": "EQ + \u53BB\u9F7F\u97F3 + \u8F7B\u538B\u7F29\uFF0C\u9002\u5408\u53E3\u64AD",
    "audio.beautify.natural": "\u81EA\u7136",
    "audio.beautify.bright": "\u660E\u4EAE",
    "audio.beautify.warm": "\u539A\u5B9E",
    "audio.beautifyDone": "\u4EBA\u58F0\u7F8E\u5316\u5B8C\u6210",
    "audio.strength": "\u5F3A\u5EA6",
    "audio.preset": "\u9884\u8BBE",
    "audio.apply": "\u5E94\u7528",
    "audio.processing": "\u5904\u7406\u4E2D\u2026",
    "audio.cancel": "\u53D6\u6D88",
    "audio.cancelled": "\u5DF2\u53D6\u6D88\u97F3\u9891\u5904\u7406",
    "audio.selectClip": "\u5148\u5728\u65F6\u95F4\u7EBF\u9009\u4E2D\u4E00\u4E2A\u5E26\u58F0\u97F3\u7684\u7247\u6BB5",
    "audio.aiDenoise": "AI \u964D\u566A",
    "audio.aiDenoiseHint": "LocalVQE \u8BED\u97F3\u964D\u566A / \u53BB\u6DF7\u54CD\uFF0C\u5BF9\u7EAF\u97F3\u4E50\u4F1A\u538B\u6389\u5185\u5BB9",
    "audio.noDenoiseModel": "\u6CA1\u6709\u53EF\u7528\u7684\u964D\u566A\u6A21\u578B",
    "audio.downloadModel": "\u4E0B\u8F7D\u6A21\u578B \xB7 {size}",
    "audio.separate": "\u4EBA\u58F0\u63D0\u53D6",
    "audio.separateHint": "UVR \u4ECE\u80CC\u666F\u97F3\u4E50 / \u73AF\u5883\u58F0\u4E2D\u63D0\u53D6\u4EBA\u58F0\uFF1BHTDemucs \u7528\u4E8E\u97F3\u4E50\u5206\u8F68",
    "audio.separateModel": "\u63D0\u53D6\u6A21\u578B",
    "audio.noSeparateModel": "\u6CA1\u6709\u53EF\u7528\u7684\u5206\u79BB\u6A21\u578B",
    "audio.stem.drums": "\u9F13",
    "audio.stem.bass": "\u8D1D\u65AF",
    "audio.stem.other": "\u5176\u4ED6",
    "audio.stem.vocals": "\u4EBA\u58F0",
    "audio.stem.guitar": "\u5409\u4ED6",
    "audio.stem.piano": "\u94A2\u7434",
    "audio.stem.accompaniment": "\u4F34\u594F/\u80CC\u666F",
    "audio.stemTrack": "\u5206\u8F68",
    "audio.separateDone": "\u5DF2\u751F\u6210 {count} \u6761\u97F3\u8F68\uFF08\u539F\u7247\u6BB5\u5DF2\u9759\u97F3\uFF09",
    "audio.translate": "\u97F3\u9891\u7FFB\u8BD1",
    "audio.translateHint": "\u8BC6\u522B\u8BED\u97F3 \u2192 \u7FFB\u8BD1 \u2192 \u751F\u6210\u8BD1\u6587\u5B57\u5E55\uFF0C\u53EF\u9009\u914D\u97F3",
    "audio.translateApply": "\u7FFB\u8BD1\u5E76\u751F\u6210\u5B57\u5E55",
    "audio.targetLanguage": "\u76EE\u6807\u8BED\u8A00",
    "audio.lang.en": "\u82F1\u8BED",
    "audio.lang.zh": "\u7B80\u4F53\u4E2D\u6587",
    "audio.lang.ja": "\u65E5\u8BED",
    "audio.lang.ko": "\u97E9\u8BED",
    "audio.lang.es": "\u897F\u73ED\u7259\u8BED",
    "audio.lang.fr": "\u6CD5\u8BED",
    "audio.lang.de": "\u5FB7\u8BED",
    "audio.dub": "\u540C\u65F6\u751F\u6210\u914D\u97F3",
    "audio.dubModel": "\u914D\u97F3\u6A21\u578B",
    "audio.translateVoiceNote": "\u914D\u97F3\u4F7F\u7528\u6240\u9009 TTS \u6A21\u578B\uFF08\u672C\u5730\u6216\u4E91\u7AEF\uFF09",
    "audio.dubNoModel": "\u6CA1\u6709\u53EF\u7528\u7684\u914D\u97F3\u6A21\u578B\uFF0C\u8BF7\u5148\u9009\u62E9\u6216\u914D\u7F6E\u4E00\u4E2A",
    "audio.dubLocalNote": "\u672C\u5730\u914D\u97F3 \xB7 {name}",
    "audio.dubTrack": "\u8BD1\u97F3",
    "audio.translatedSubtitleTrack": "\u8BD1\u6587\u5B57\u5E55",
    "audio.translateDone": "\u5DF2\u751F\u6210 {count} \u6761\u8BD1\u6587\u5B57\u5E55",
    "audio.translateDoneDub": "\u5DF2\u751F\u6210 {count} \u6761\u8BD1\u6587\u5B57\u5E55\u4E0E\u914D\u97F3",
    "audio.dubFailed": "\u914D\u97F3\u5931\u8D25\uFF1A{error}",
    "audio.translateCountMismatch": "\u7FFB\u8BD1\u7ED3\u679C\u6570\u91CF\u4E0E\u5B57\u5E55\u6761\u6570\u4E0D\u4E00\u81F4",
    // ---- 视频处理（无模型） ----
    "video.title": "\u89C6\u9891\u5904\u7406",
    "video.stabilize": "\u9632\u6296",
    "video.denoise": "\u964D\u566A",
    "video.deflicker": "\u53BB\u9891\u95EA",
    "video.motionBlur": "\u8FD0\u52A8\u6A21\u7CCA",
    "video.upscale": "\u5FEB\u901F\u653E\u5927",
    "video.off": "\u5173\u95ED",
    "video.light": "\u8F7B",
    "video.medium": "\u4E2D",
    "video.strong": "\u5F3A",
    "video.upscale.1_5": "1.5\xD7",
    "video.upscale.2": "2\xD7",
    "video.applyHint": "\u5408\u5E76\u4E3A\u4E00\u6B21\u8F6C\u7801",
    "video.hint": "\u5E94\u7528\u540E\u4F1A\u751F\u6210\u65B0\u7D20\u6750\u5E76\u66FF\u6362\u5F53\u524D\u7247\u6BB5\u3002\u653E\u5927\u540E\u5982\u9700\u66F4\u9AD8\u5BFC\u51FA\u5206\u8FA8\u7387\uFF0C\u8BF7\u5230\u8BBE\u7F6E \u2192 \u5DE5\u7A0B\u8C03\u6574\u8F93\u51FA\u8BBE\u7F6E\u3002",
    "video.apply": "\u5E94\u7528\u89C6\u9891\u5904\u7406",
    "video.done": "\u89C6\u9891\u5904\u7406\u5B8C\u6210\uFF0C\u5DF2\u66FF\u6362\u7247\u6BB5",
    "video.cancelled": "\u5DF2\u53D6\u6D88\u89C6\u9891\u5904\u7406",
    "video.noEffects": "\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5904\u7406\u9879",
    "video.selectClip": "\u5148\u5728\u65F6\u95F4\u7EBF\u9009\u4E2D\u4E00\u4E2A\u89C6\u9891\u7247\u6BB5",
    "video.cancel": "\u53D6\u6D88",
    "inspector.textPreset": "\u6587\u5B57\u9884\u8BBE",
    "inspector.textPresetHint": "\u628A\u5F53\u524D\u6837\u5F0F\u5B58\u8FDB\u5A92\u4F53\u5E93",
    "inspector.saveTextPreset": "\u4FDD\u5B58\u4E3A\u9884\u8BBE",
    "inspector.more": "\u66F4\u591A\u64CD\u4F5C",
    "inspector.copyAttributes": "\u590D\u5236\u5C5E\u6027",
    "inspector.pasteAttributes": "\u7C98\u8D34\u5C5E\u6027",
    "inspector.resetAttributes": "\u91CD\u7F6E\u5168\u90E8\u5C5E\u6027",
    "inspector.deleteClip": "\u5220\u9664\u7247\u6BB5",
    "inspector.attributesCopied": "\u5DF2\u590D\u5236\u5C5E\u6027",
    "inspector.attributesPasted": "\u5DF2\u7C98\u8D34\u5C5E\u6027",
    "inspector.attributesReset": "\u5DF2\u91CD\u7F6E\u5C5E\u6027",
    "inspector.textStyle": "\u6587\u5B57\u6837\u5F0F",
    "inspector.font": "\u5B57\u4F53",
    "inspector.fontSize": "\u5B57\u53F7",
    "inspector.color": "\u989C\u8272",
    "inspector.letterSpacing": "\u5B57\u95F4\u8DDD",
    "inspector.lineHeight": "\u884C\u95F4\u8DDD",
    "inspector.align": "\u5BF9\u9F50\u65B9\u5F0F",
    "inspector.align.left": "\u5DE6\u5BF9\u9F50",
    "inspector.align.center": "\u5C45\u4E2D",
    "inspector.align.right": "\u53F3\u5BF9\u9F50",
    "inspector.background": "\u80CC\u666F",
    "inspector.backgroundColor": "\u80CC\u666F\u8272",
    "inspector.backgroundOpacity": "\u80CC\u666F\u4E0D\u900F\u660E\u5EA6\uFF08%\uFF09",
    "inspector.glow": "\u53D1\u5149",
    "inspector.glowColor": "\u53D1\u5149\u989C\u8272",
    "inspector.glowBlur": "\u53D1\u5149\u8303\u56F4",
    "inspector.blendMode": "\u6DF7\u5408\u6A21\u5F0F",
    "inspector.stroke": "\u63CF\u8FB9",
    "inspector.strokeColor": "\u63CF\u8FB9\u989C\u8272",
    "inspector.strokeWidth": "\u63CF\u8FB9\u5BBD\u5EA6",
    "inspector.shadow": "\u9634\u5F71",
    "inspector.shadowColor": "\u9634\u5F71\u989C\u8272",
    "inspector.shadowOpacity": "\u9634\u5F71\u4E0D\u900F\u660E\u5EA6",
    "inspector.blur": "\u6A21\u7CCA",
    "inspector.offsetX": "\u6C34\u5E73\u504F\u79FB",
    "inspector.offsetY": "\u5782\u76F4\u504F\u79FB",
    "inspector.appearance": "\u5916\u89C2",
    "inspector.cornerRadius": "\u5706\u89D2",
    // ---- 字体 ----
    "font.pingfang": "\u82F9\u65B9 / \u5FAE\u8F6F\u96C5\u9ED1",
    "font.system": "\u7CFB\u7EDF\u9ED8\u8BA4",
    "font.sans": "\u65E0\u886C\u7EBF",
    "font.serif": "\u886C\u7EBF",
    "font.mono": "\u7B49\u5BBD",
    "font.noto": "\u601D\u6E90\u9ED1\u4F53",
    "font.yahei": "\u5FAE\u8F6F\u96C5\u9ED1",
    "font.songti": "\u5B8B\u4F53",
    "font.kaiti": "\u6977\u4F53",
    // ---- 字体库 ----
    "font.libraryTitle": "\u5B57\u4F53\u5E93",
    "font.libraryTab": "\u5B57\u4F53\u5E93",
    "font.installedTab": "\u5DF2\u5B89\u88C5",
    "font.refresh": "\u5237\u65B0\u6CE8\u518C\u8868",
    "font.import": "\u5BFC\u5165\u672C\u5730\u5B57\u4F53",
    "font.searchPlaceholder": "\u641C\u7D22\u5B57\u4F53\u2026",
    "font.searchInstalled": "\u641C\u7D22\u5DF2\u5B89\u88C5\u5B57\u4F53\u2026",
    "font.filterAll": "\u5168\u90E8",
    "font.languageLabel": "\u8BED\u8A00 / \u6587\u5B57",
    "font.lang.all": "\u5168\u90E8\u8BED\u8A00",
    "font.lang.latin": "\u62C9\u4E01\u6587\u5B57",
    "font.lang.zhHans": "\u7B80\u4F53\u4E2D\u6587",
    "font.lang.zhHant": "\u7E41\u4F53\u4E2D\u6587",
    "font.lang.ja": "\u65E5\u6587",
    "font.lang.ko": "\u97E9\u6587",
    "font.lang.cyrillic": "\u897F\u91CC\u5C14\u6587",
    "font.lang.ar": "\u963F\u62C9\u4F2F\u6587",
    "font.lang.he": "\u5E0C\u4F2F\u6765\u6587",
    "font.lang.vi": "\u8D8A\u5357\u6587",
    "font.lang.devanagari": "\u5929\u57CE\u6587\uFF08\u5370\u5730\u8BED\u7B49\uFF09",
    "font.lang.th": "\u6CF0\u6587",
    "font.lang.greek": "\u5E0C\u814A\u6587",
    "font.lang.bn": "\u5B5F\u52A0\u62C9\u6587",
    "font.lang.ta": "\u6CF0\u7C73\u5C14\u6587",
    "font.lang.te": "\u6CF0\u5362\u56FA\u6587",
    "font.lang.gu": "\u53E4\u5409\u62C9\u7279\u6587",
    "font.lang.kn": "\u5361\u7EB3\u8FBE\u6587",
    "font.lang.pa": "\u53E4\u6728\u57FA\u6587\uFF08\u65C1\u906E\u666E\u8BED\uFF09",
    "font.lang.ml": "\u9A6C\u62C9\u96C5\u62C9\u59C6\u6587",
    "font.lang.si": "\u50E7\u4F3D\u7F57\u6587",
    "font.lang.my": "\u7F05\u7538\u6587",
    "font.lang.km": "\u9AD8\u68C9\u6587",
    "font.lang.lo": "\u8001\u631D\u6587",
    "font.lang.bo": "\u85CF\u6587",
    "font.lang.ka": "\u683C\u9C81\u5409\u4E9A\u6587",
    "font.lang.hy": "\u4E9A\u7F8E\u5C3C\u4E9A\u6587",
    "font.lang.am": "\u57C3\u585E\u4FC4\u6BD4\u4E9A\u6587",
    "font.lang.cherokee": "\u5207\u7F57\u57FA\u6587",
    "font.lang.canadianAboriginal": "\u52A0\u62FF\u5927\u539F\u4F4F\u6C11\u6587\u5B57",
    "font.lang.math": "\u6570\u5B66\u7B26\u53F7",
    "font.lang.symbols": "\u7B26\u53F7",
    "font.lang.emoji": "\u8868\u60C5\u7B26\u53F7",
    "font.lang.braille": "\u76F2\u6587",
    "font.filterSans": "\u65E0\u886C\u7EBF",
    "font.filterSerif": "\u886C\u7EBF",
    "font.filterMono": "\u7B49\u5BBD",
    "font.filterDisplay": "\u5C55\u793A",
    "font.filterHandwriting": "\u624B\u5199",
    "font.installedBadge": "\u5DF2\u5B89\u88C5",
    "font.count": "\u5171 {n} \u6B3E",
    "font.more": "\u52A0\u8F7D\u66F4\u591A\uFF08\u5269\u4F59 {n}\uFF09",
    "font.empty": "\u6CA1\u6709\u5339\u914D\u7684\u5B57\u4F53",
    "font.detailEmpty": "\u9009\u62E9\u5DE6\u4FA7\u5B57\u4F53\u67E5\u770B\u8BE6\u60C5",
    "font.previewLoading": "\u9884\u89C8\u52A0\u8F7D\u4E2D\u2026",
    "font.loadingRegistry": "\u6B63\u5728\u62C9\u53D6\u5B57\u4F53\u6CE8\u518C\u8868\u2026",
    "font.previewFailed": "\u9884\u89C8\u52A0\u8F7D\u5931\u8D25\uFF0C\u5B89\u88C5\u540E\u53EF\u67E5\u770B\u3002",
    "font.weights": "\u5B57\u91CD",
    "font.subsetsLabel": "\u5B50\u96C6",
    "font.subsetsSlices": "\u5168\u90E8\u5206\u7247\u5B57\u5F62\uFF08\u8986\u76D6\u4E2D\u65E5\u97E9\u4E0E\u62C9\u4E01\uFF09",
    "font.subsetsCount": "{n} \u4E2A\u5B57\u5F62\u5B50\u96C6\uFF08\u8986\u76D6\u591A\u79CD\u8BED\u8A00\uFF09",
    "font.estimate": "\u9884\u8BA1\u4E0B\u8F7D\u7EA6 {size}",
    "font.applyAfterInstall": "\u5B89\u88C5\u540E\u5E94\u7528\u5230\u5F53\u524D\u6587\u5B57\u7247\u6BB5",
    "font.install": "\u5B89\u88C5",
    "font.installing": "\u6B63\u5728\u5B89\u88C5\u2026",
    "font.cancel": "\u53D6\u6D88",
    "font.downloading": "\u4E0B\u8F7D {done}/{total} \xB7 {size}",
    "font.alreadyInstalled": "\u5DF2\u5B89\u88C5",
    "font.apply": "\u5E94\u7528\u5230\u5F53\u524D\u7247\u6BB5",
    "font.manage": "\u7BA1\u7406",
    "font.reinstall": "\u91CD\u88C5",
    "font.remove": "\u79FB\u9664",
    "font.reveal": "\u5728\u6587\u4EF6\u5939\u4E2D\u663E\u793A",
    "font.removeConfirmTitle": "\u79FB\u9664\u5B57\u4F53",
    "font.removeConfirmMessage": "\u5F15\u7528\u300C{name}\u300D\u7684\u5DE5\u7A0B\u4F1A\u56DE\u9000\u5230\u9ED8\u8BA4\u5B57\u4F53\u3002",
    "font.removeDone": "\u5DF2\u79FB\u9664 {name}",
    "font.installedToast": "\u5DF2\u5B89\u88C5 {name}",
    "font.appliedToast": "\u5DF2\u5E94\u7528 {name}",
    "font.importPromptTitle": "\u8865\u5145\u5B57\u4F53\u4FE1\u606F",
    "font.importPromptHint": "\u6CA1\u80FD\u4ECE\u6587\u4EF6\u91CC\u8BFB\u51FA\u5B57\u4F53\u540D\u79F0\uFF0C\u786E\u8BA4\u540E\u5BFC\u5165\u3002",
    "font.familyLabel": "\u5B57\u4F53\u540D\u79F0",
    "font.importConfirm": "\u5BFC\u5165",
    "font.importing": "\u6B63\u5728\u5BFC\u5165\u2026",
    "font.importedToast": "\u5DF2\u5BFC\u5165 {name}",
    "font.staleNotice": "\u6CE8\u518C\u8868\u5237\u65B0\u5931\u8D25\uFF0C\u5F53\u524D\u663E\u793A\u7684\u662F\u7F13\u5B58\u3002",
    "font.registryFailed": "\u5B57\u4F53\u6CE8\u518C\u8868\u52A0\u8F7D\u5931\u8D25",
    "font.emptyInstalled": "\u8FD8\u6CA1\u6709\u5B89\u88C5\u5B57\u4F53",
    "font.emptyInstalledHint": "\u53BB\u5B57\u4F53\u5E93\u6311\u9009\uFF0C\u6216\u5BFC\u5165\u672C\u5730\u5B57\u4F53\u3002",
    "font.localSource": "\u672C\u5730",
    "font.fontsourceSource": "Fontsource",
    "font.sizeOnDisk": "\u5360\u7528 {size}",
    "font.licenseLabel": "\u8BB8\u53EF {license}",
    "font.missing": "\u7F3A\u5931\uFF1A{name}",
    "font.missingHint": "\u8BE5\u5B57\u4F53\u672A\u5B89\u88C5\uFF0C\u70B9\u51FB\u4ECE\u5B57\u4F53\u5E93\u5B89\u88C5\u3002",
    "font.openLibrary": "\u53BB\u5B57\u4F53\u5E93",
    "font.manageEntry": "\u5B57\u4F53\u5E93\u2026",
    "font.manageHint": "\u5B89\u88C5 / \u79FB\u9664 / \u5BFC\u5165\u5B57\u4F53",
    "font.systemGroup": "\u7CFB\u7EDF\u5B57\u4F53",
    "font.installedGroup": "\u6211\u7684\u5B57\u4F53",
    "font.noWeights": "\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u5B57\u91CD",
    "font.category.sans-serif": "\u65E0\u886C\u7EBF",
    "font.category.serif": "\u886C\u7EBF",
    "font.category.monospace": "\u7B49\u5BBD",
    "font.category.display": "\u5C55\u793A",
    "font.category.handwriting": "\u624B\u5199",
    // ---- 混合模式 ----
    "blend.normal": "\u6B63\u5E38",
    "blend.multiply": "\u6B63\u7247\u53E0\u5E95",
    "blend.screen": "\u6EE4\u8272",
    "blend.overlay": "\u53E0\u52A0",
    "blend.darken": "\u53D8\u6697",
    "blend.lighten": "\u53D8\u4EAE",
    "blend.color-dodge": "\u989C\u8272\u51CF\u6DE1",
    "blend.color-burn": "\u989C\u8272\u52A0\u6DF1",
    "blend.hard-light": "\u5F3A\u5149",
    "blend.soft-light": "\u67D4\u5149",
    "blend.difference": "\u5DEE\u503C",
    "blend.exclusion": "\u6392\u9664",
    "blend.hue": "\u8272\u76F8",
    "blend.saturation": "\u9971\u548C\u5EA6",
    "blend.color": "\u989C\u8272",
    "blend.luminosity": "\u660E\u5EA6",
    "blend.plus-lighter": "\u7EBF\u6027\u51CF\u6DE1",
    // ---- 字幕 ----
    "subtitle.fileFilter": "\u5B57\u5E55\u6587\u4EF6",
    "subtitle.track": "\u5B57\u5E55",
    "subtitle.import": "\u5BFC\u5165\u5B57\u5E55",
    "subtitle.export": "\u5BFC\u51FA\u5B57\u5E55",
    "subtitle.importLabel": "\u5BFC\u5165\u5B57\u5E55",
    "subtitle.imported": "\u5DF2\u5BFC\u5165 {count} \u6761\u5B57\u5E55",
    "subtitle.importFailed": "\u5B57\u5E55\u5BFC\u5165\u5931\u8D25",
    "subtitle.importFailedDetail": "\u5B57\u5E55\u5BFC\u5165\u5931\u8D25\uFF1A{error}",
    "subtitle.exported": "\u5DF2\u5BFC\u51FA {count} \u6761\u5B57\u5E55\u5230 {path}",
    "subtitle.exportFailed": "\u5B57\u5E55\u5BFC\u51FA\u5931\u8D25\uFF1A{error}",
    "subtitle.none": "\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u5B57\u5E55",
    // ---- 标记 ----
    "marker.add": "\u6DFB\u52A0\u6807\u8BB0 (M)",
    "marker.addLabel": "\u6DFB\u52A0\u6807\u8BB0",
    "marker.defaultName": "\u6807\u8BB0 {n}",
    "marker.renameTitle": "\u91CD\u547D\u540D\u6807\u8BB0",
    "marker.renameLabel": "\u91CD\u547D\u540D\u6807\u8BB0",
    "marker.nameLabel": "\u6807\u8BB0\u540D\u79F0",
    "marker.namePlaceholder": "\u4F8B\u5982\uFF1A\u5F00\u573A / \u8F6C\u6298 / \u7ED3\u5C3E",
    "marker.deleteTitle": "\u5220\u9664\u6807\u8BB0",
    "marker.deleteMessage": "\u5220\u9664\u6807\u8BB0\u300C{name}\u300D\uFF1F",
    "marker.deleteLabel": "\u5220\u9664\u6807\u8BB0",
    "marker.editTitle": "\u6807\u8BB0\u4E0E\u5BA1\u7247\u6279\u6CE8",
    "marker.editLabel": "\u4FEE\u6539\u5BA1\u7247\u6279\u6CE8",
    "marker.noteLabel": "\u5907\u6CE8",
    "marker.notePlaceholder": "\u4F8B\u5982\uFF1A31.2s \u7FC5\u8180\u7A7F\u6A21\uFF0C\u9700\u8981\u91CD\u6E32 s05",
    "marker.severityLabel": "\u4E25\u91CD\u7A0B\u5EA6",
    "marker.severity.none": "\u4E0D\u8BBE",
    "marker.severity.blocker": "\u963B\u585E",
    "marker.severity.high": "\u9AD8",
    "marker.severity.medium": "\u4E2D",
    "marker.severity.low": "\u4F4E",
    "marker.resolvedLabel": "\u5DF2\u89E3\u51B3",
    // ---- 时间线 ----
    "timeline.title": "\u65F6\u95F4\u7EBF",
    "timeline.undo": "\u64A4\u9500 (\u2318Z)",
    "timeline.undoLabel": "\u64A4\u9500",
    "timeline.redo": "\u91CD\u505A (\u21E7\u2318Z)",
    "timeline.redoLabel": "\u91CD\u505A",
    "timeline.split": "\u5206\u5272 (S)",
    "timeline.splitLabel": "\u5206\u5272",
    "timeline.trimLeft": "\u5411\u5DE6\u88C1\u526A\u5230\u64AD\u653E\u5934",
    "timeline.trimLeftLabel": "\u5411\u5DE6\u88C1\u526A",
    "timeline.trimRight": "\u5411\u53F3\u88C1\u526A\u5230\u64AD\u653E\u5934",
    "timeline.trimRightLabel": "\u5411\u53F3\u88C1\u526A",
    "timeline.delete": "\u5220\u9664\u9009\u4E2D\u7247\u6BB5 (Delete)",
    "timeline.deleteLabel": "\u5220\u9664",
    "timeline.copy": "\u590D\u5236",
    "timeline.cut": "\u526A\u5207",
    "timeline.paste": "\u7C98\u8D34",
    "timeline.cutLabel": "\u526A\u5207\u7247\u6BB5",
    "timeline.pasteLabel": "\u7C98\u8D34\u7247\u6BB5",
    "timeline.duplicate": "\u590D\u5236\u9009\u4E2D\u7247\u6BB5 (\u2318D)",
    "timeline.duplicateLabel": "\u590D\u5236\u7247\u6BB5",
    "timeline.rippleDelete": "\u5220\u9664\u5E76\u5DE6\u79FB\u540E\u7EED\u7247\u6BB5 (Shift+Delete)",
    "timeline.rippleDeleteLabel": "\u5220\u9664\u5E76\u5DE6\u79FB\u540E\u7EED\u7247\u6BB5",
    "timeline.addKeyframe": "\u5728\u64AD\u653E\u5934\u7ED9\u9009\u4E2D\u7247\u6BB5\u6253\u5173\u952E\u5E27",
    "timeline.addKeyframeLabel": "\u6DFB\u52A0\u5173\u952E\u5E27",
    "timeline.addText": "\u5728\u64AD\u653E\u5934\u5904\u6DFB\u52A0\u6587\u5B57",
    "timeline.addTextLabel": "\u6DFB\u52A0\u6587\u5B57",
    "timeline.zoomOut": "\u7F29\u5C0F",
    "timeline.zoomIn": "\u653E\u5927",
    "timeline.zoom": "\u65F6\u95F4\u7EBF\u7F29\u653E",
    "timeline.tracks": "\u8F68\u9053",
    "timeline.locked": "\u76EE\u6807\u8F68\u9053\u5DF2\u9501\u5B9A",
    "timeline.confirmDeleteTrack": "\u5220\u9664\u8F68\u9053\uFF1F",
    "timeline.confirmDeleteTrackMessage": "\u8F68\u9053 {n} \u4E0A\u6709 {count} \u4E2A\u7247\u6BB5\uFF0C\u5220\u9664\u8F68\u9053\u4F1A\u4E00\u5E76\u5220\u9664\u3002",
    "timeline.missingAsset": "\uFF08\u7F3A\u5931\u7D20\u6750\uFF09",
    "timeline.dropHint": "\u628A\u7D20\u6750\u62D6\u5230\u8FD9\u91CC\uFF0C\u81EA\u52A8\u521B\u5EFA\u8F68\u9053",
    "timeline.emptyTitle": "\u65F6\u95F4\u7EBF\u8FD8\u662F\u7A7A\u7684",
    "timeline.emptySub": "\u70B9\u300C\u5BFC\u5165\u5E76\u653E\u5230\u65F6\u95F4\u7EBF\u300D\u4F1A\u76F4\u63A5\u94FA\u5230\u64AD\u653E\u5934\uFF1B\u4E5F\u53EF\u4EE5\u628A\u5A92\u4F53\u5E93\u91CC\u7684\u7D20\u6750\u62D6\u8FDB\u6765\u3002",
    "timeline.noDuration": "{name} \u6CA1\u6709\u53EF\u7528\u65F6\u957F",
    "timeline.nothingToSplit": "\u64AD\u653E\u5934\u5904\u6CA1\u6709\u53EF\u5206\u5272\u7684\u7247\u6BB5",
    "timeline.selectForTrim": "\u8BF7\u5148\u9009\u4E2D\u64AD\u653E\u5934\u5904\u7684\u7247\u6BB5",
    "timeline.selectForKeyframe": "\u8BF7\u5148\u9009\u4E2D\u64AD\u653E\u5934\u5904\u7684\u7247\u6BB5",
    // ---- 右键菜单 ----
    "menu.ai": "AI \u667A\u80FD",
    "menu.aiGenerate": "AI \u751F\u6210",
    "menu.aiBadge": "AI",
    "menu.aiPrimaryOnly": "AI \u53EA\u5904\u7406\u53F3\u952E\u7684\u90A3\u4E2A\u7247\u6BB5\uFF0C\u5176\u4F59\u9009\u4E2D\u9879\u4E0D\u53D7\u5F71\u54CD",
    "menu.moreEdit": "\u66F4\u591A\u7F16\u8F91",
    "menu.audio": "\u97F3\u9891",
    "menu.visual": "\u753B\u9762",
    "menu.text": "\u6587\u5B57",
    "menu.attributes": "\u5C5E\u6027",
    "menu.track": "\u8F68\u9053",
    "menu.copyText": "\u590D\u5236\u6587\u6848",
    "menu.textCopied": "\u5DF2\u590D\u5236\u6587\u6848",
    "menu.editInInspector": "\u5728\u68C0\u67E5\u5668\u4E2D\u7F16\u8F91",
    "menu.selectTrackClips": "\u9009\u4E2D\u540C\u8F68\u7247\u6BB5",
    "menu.locate": "\u5B9A\u4F4D\u5230\u6B64\u7247\u6BB5",
    "menu.goToMarker": "\u5B9A\u4F4D\u5230\u6B64\u6807\u8BB0",
    "menu.mute": "\u9759\u97F3",
    "menu.unmute": "\u53D6\u6D88\u9759\u97F3",
    "menu.volume": "\u97F3\u91CF",
    "menu.gainUp": "\u97F3\u91CF +3 dB",
    "menu.gainDown": "\u97F3\u91CF -3 dB",
    "menu.gainReset": "\u97F3\u91CF\u5F52\u96F6",
    "menu.fadeIn": "\u6DE1\u5165",
    "menu.fadeOut": "\u6DE1\u51FA",
    "menu.seconds": "{value} \u79D2",
    "menu.speed": "\u53D8\u901F",
    "menu.speedValue": "\u53D8\u901F {value}\xD7",
    "menu.resetTransform": "\u91CD\u7F6E\u53D8\u6362",
    "menu.resetColor": "\u91CD\u7F6E\u8C03\u8272",
    "menu.videoProcess": "\u89C6\u9891\u5904\u7406",
    "menu.translate": "\u7FFB\u8BD1\u5E76\u751F\u6210\u5B57\u5E55",
    "menu.dub": "\u8BD1\u5236\u914D\u97F3",
    "menu.loudnessTarget": "\u7EDF\u4E00\u54CD\u5EA6\uFF08-14 LUFS\uFF09",
    "menu.enhance": "\u753B\u9762\u589E\u5F3A",
    "menu.upscale2": "AI \u8D85\u5206 2\xD7",
    "menu.upscale4": "AI \u8D85\u5206 4\xD7",
    "menu.interpolate2": "AI \u8865\u5E27 2\xD7",
    "menu.interpolate4": "AI \u8865\u5E27 4\xD7",
    "menu.reframeFace": "\u667A\u80FD\u88C1\u526A \xB7 \u7AD6\u5C4F 9:16",
    "menu.reframePerson": "\u955C\u5934\u8FFD\u8E2A \xB7 \u7AD6\u5C4F 9:16",
    "menu.stabilize": "\u89C6\u9891\u7A33\u5B9A",
    "menu.videoDenoise": "\u89C6\u9891\u53BB\u566A",
    "menu.deflicker": "\u53BB\u95EA\u70C1",
    "menu.motionBlur": "\u8FD0\u52A8\u6A21\u7CCA",
    "menu.imageEdit": "\u7528\u8FD9\u5F20\u56FE\u6539\u56FE\u2026",
    "menu.imageToVideo": "\u7528\u8FD9\u5F20\u56FE\u751F\u6210\u89C6\u9891\u2026",
    "menu.textToVideo": "\u7528\u8FD9\u6BB5\u6587\u6848\u751F\u6210\u89C6\u9891\u2026",
    "menu.genVideo": "\u6587\u751F\u89C6\u9891\u2026",
    "menu.genVideoFromImage": "\u56FE\u751F\u89C6\u9891\u2026",
    "menu.genImage": "\u6587\u751F\u56FE\u2026",
    "menu.genEditImage": "\u56FE\u7247\u6539\u56FE\u2026",
    "menu.pasteHere": "\u7C98\u8D34\u5230\u6B64\u5904",
    "menu.addTextHere": "\u5728\u6B64\u6DFB\u52A0\u6587\u5B57",
    "menu.addMarkerHere": "\u5728\u6B64\u6DFB\u52A0\u6807\u8BB0",
    "menu.seekHere": "\u5B9A\u4F4D\u64AD\u653E\u5934\u5230\u6B64",
    "menu.splitHere": "\u5728\u6B64\u5206\u5272",
    "menu.newTrack": "\u65B0\u5EFA\u8F68\u9053",
    "menu.newTrackBelow": "\u5728\u4E0B\u65B9\u65B0\u5EFA\u8F68\u9053",
    "menu.trackMute": "\u9759\u97F3\u8F68\u9053",
    "menu.trackUnmute": "\u53D6\u6D88\u9759\u97F3\u8F68\u9053",
    "menu.trackHide": "\u9690\u85CF\u8F68\u9053",
    "menu.trackShow": "\u663E\u793A\u8F68\u9053",
    "menu.trackLock": "\u9501\u5B9A\u8F68\u9053",
    "menu.trackUnlock": "\u89E3\u9501\u8F68\u9053",
    "menu.removeTrack": "\u5220\u9664\u8F68\u9053",
    "menu.aiNeedModel": "\u300C{name}\u300D\u9700\u8981\u5148\u4E0B\u8F7D\u6A21\u578B",
    "menu.openModels": "\u6253\u5F00\u6A21\u578B\u4E0B\u8F7D",
    "menu.alignerOnly": "\u9700\u8981\u5F3A\u5236\u5BF9\u9F50\u5668",
    "menu.codecOnly": "\u9700\u8981\u97F3\u9891\u7F16\u89E3\u7801\u5668",
    "menu.aiBusy": "\u5DF2\u6709 AI \u4EFB\u52A1\u5728\u8FD0\u884C\uFF0C\u8BF7\u7A0D\u5019",
    "menu.aiDone": "{name} \u5B8C\u6210",
    "menu.aiFailed": "AI \u4EFB\u52A1\u5931\u8D25\uFF1A{error}",
    // ---- 轨道 ----
    "track.name": "\u8F68\u9053",
    "track.autoName": "\u8F68\u9053 {n}",
    "track.label": "\u8F68\u9053 {n}",
    "track.rename": "\u91CD\u547D\u540D\u8F68\u9053",
    "track.renameHint": "\u53CC\u51FB\u91CD\u547D\u540D",
    "track.renameLabel": "\u91CD\u547D\u540D\u8F68\u9053",
    "track.mute": "\u9759\u97F3",
    "track.unmute": "\u53D6\u6D88\u9759\u97F3",
    "track.muteNamed": "{name} \u9759\u97F3",
    "track.show": "\u663E\u793A",
    "track.hide": "\u9690\u85CF",
    "track.showNamed": "{name} \u663E\u793A",
    "track.lock": "\u9501\u5B9A\u8F68\u9053",
    "track.unlock": "\u89E3\u9501\u8F68\u9053",
    "track.lockNamed": "{name} \u9501\u5B9A",
    "track.delete": "\u5220\u9664\u8F68\u9053",
    "track.deleteNamed": "\u5220\u9664{name}",
    "track.add": "\u6DFB\u52A0\u8F68\u9053",
    "track.reorder": "\u62D6\u52A8\u6392\u5E8F",
    // ---- 预览 ----
    "preview.title": "\u9884\u89C8",
    "preview.exportFrame": "\u5BFC\u51FA\u5F53\u524D\u5E27",
    "preview.frameFilter": "PNG \u56FE\u7247",
    "preview.frameExported": "\u5F53\u524D\u5E27\u5DF2\u5BFC\u51FA\u5230 {path}",
    "preview.frameFailed": "\u5BFC\u51FA\u5F53\u524D\u5E27\u5931\u8D25\uFF1A{error}",
    "preview.previousFrame": "\u4E0A\u4E00\u5E27",
    "preview.nextFrame": "\u4E0B\u4E00\u5E27",
    "preview.play": "\u64AD\u653E",
    "preview.pause": "\u6682\u505C",
    "preview.volume": "\u97F3\u91CF",
    "preview.hideTimeline": "\u6536\u8D77\u8F68\u9053\u9762\u677F",
    "preview.showTimeline": "\u5C55\u5F00\u8F68\u9053\u9762\u677F",
    "preview.importHint": "\u5BFC\u5165\u7D20\u6750\u540E\u62D6\u5230\u65F6\u95F4\u7EBF",
    "preview.emptyTitle": "\u4ECE\u4E00\u6BB5\u7D20\u6750\u5F00\u59CB",
    "preview.emptySub": "\u5BFC\u5165\u89C6\u9891\u3001\u56FE\u7247\u6216\u97F3\u9891\uFF0C\u4F1A\u76F4\u63A5\u653E\u5230\u65F6\u95F4\u7EBF\uFF1B\u4E5F\u53EF\u4EE5\u8BA9 AI \u751F\u6210\u753B\u9762\u3002",
    "preview.emptyAi": "AI \u751F\u6210",
    "preview.emptyNote": "\u4E5F\u53EF\u4EE5\u628A\u6587\u4EF6\u76F4\u63A5\u62D6\u8FDB\u7A97\u53E3",
    "preview.resolution": "{width} \xD7 {height} \xB7 {fps} fps",
    "preview.fxFailed": "\u6548\u679C\u6E32\u67D3\u5931\u8D25",
    "preview.zoomIn": "\u653E\u5927\u753B\u5E03",
    "preview.zoomOut": "\u7F29\u5C0F\u753B\u5E03",
    "preview.zoomReset": "\u6062\u590D 100%",
    "preview.playMode": "\u64AD\u653E\u6A21\u5F0F",
    "preview.playMode.single": "\u5355\u96C6\u64AD\u653E",
    "preview.playMode.series": "\u5267\u96C6\u64AD\u653E",
    "preview.playMode.singleHint": "\u64AD\u5B8C\u505C\u5728\u5F53\u524D\u5206P",
    "preview.playMode.seriesHint": "\u6CBF\u8FDE\u7EBF\u81EA\u52A8\u8FDB\u5165\u4E0B\u4E00\u96C6\uFF0C\u9047\u5206\u652F\u663E\u793A\u9009\u9879",
    "preview.quality": "\u753B\u8D28",
    "preview.quality.auto": "\u81EA\u52A8",
    "preview.quality.autoHint": "\u6309\u8BBE\u5907\u6027\u80FD\u81EA\u52A8\u9009\u62E9",
    "preview.quality.high": "\u539F\u753B\u8D28",
    "preview.quality.highHint": "\u4FDD\u6301\u539F\u7247\u6E05\u6670\u5EA6",
    "preview.quality.medium": "\u6E05\u6670\u753B\u8D28",
    "preview.quality.mediumHint": "\u64AD\u653E\u6D41\u7545\uFF0C\u4E0D\u5F71\u54CD\u5BFC\u51FA",
    "preview.quality.low": "\u6D41\u7545\u753B\u8D28",
    "preview.quality.lowHint": "\u64AD\u653E\u6700\u6D41\u7545",
    "preview.aspect": "\u753B\u5E03\u6BD4\u4F8B",
    "preview.aspect.project": "\u9002\u5E94\u5DE5\u7A0B",
    "preview.aspect.group.auto": "\u5E38\u7528",
    "preview.aspect.group.landscape": "\u6A2A\u5C4F",
    "preview.aspect.group.portrait": "\u7AD6\u5C4F",
    "preview.aspect.group.square": "\u65B9\u5F62",
    "preview.aspect.16_9": "16:9",
    "preview.aspect.9_16": "9:16",
    "preview.aspect.1_1": "1:1",
    "preview.aspect.4_3": "4:3",
    "preview.aspect.3_4": "3:4",
    "preview.fullscreen": "\u5168\u5C4F",
    "preview.exitFullscreen": "\u9000\u51FA\u5168\u5C4F",
    // ---- 导出 ----
    "export.title": "\u5BFC\u51FA",
    "export.format": "\u683C\u5F0F",
    "export.resolution": "\u5206\u8FA8\u7387",
    "export.resolution.project": "\u539F\u59CB",
    "export.resolution.1080p": "1080p",
    "export.resolution.720p": "720p",
    "export.resolution.custom": "\u81EA\u5B9A\u4E49",
    "export.size": "\u5C3A\u5BF8",
    "export.fit": "\u753B\u9762\u9002\u914D",
    "export.fit.contain": "\u5B8C\u6574\u663E\u793A",
    "export.fit.cover": "\u88C1\u5207\u586B\u6EE1",
    "export.anchor": "\u88C1\u5207\u4F4D\u7F6E",
    "export.anchor.top-left": "\u5DE6\u4E0A",
    "export.anchor.top": "\u4E0A",
    "export.anchor.top-right": "\u53F3\u4E0A",
    "export.anchor.left": "\u5DE6",
    "export.anchor.center": "\u4E2D",
    "export.anchor.right": "\u53F3",
    "export.anchor.bottom-left": "\u5DE6\u4E0B",
    "export.anchor.bottom": "\u4E0B",
    "export.anchor.bottom-right": "\u53F3\u4E0B",
    "export.fps": "\u5E27\u7387",
    "export.fps.project": "\u9879\u76EE",
    "export.gifColors": "\u989C\u8272\u6570",
    "export.gifDither": "\u6296\u52A8",
    "export.gifLoop": "\u5FAA\u73AF",
    "export.gifDither.sierra2_4a": "Sierra",
    "export.gifDither.bayer": "Bayer",
    "export.gifDither.floyd_steinberg": "Floyd",
    "export.gifDither.none": "\u65E0",
    "export.quality": "\u8D28\u91CF",
    "export.quality.high": "\u9AD8",
    "export.quality.standard": "\u6807\u51C6",
    "export.quality.small": "\u5C0F\u4F53\u79EF",
    "export.audio": "\u97F3\u9891",
    "export.outputSpec": "\u8F93\u51FA\u89C4\u683C",
    "export.exportVideo": "\u5BFC\u51FA\u89C6\u9891",
    "export.exporting": "\u5BFC\u51FA\u4E2D\u2026",
    "export.cancel": "\u53D6\u6D88\u5BFC\u51FA",
    "export.done": "\u5DF2\u5BFC\u51FA\uFF1A{path}",
    "export.hint": "\u5BFC\u51FA\u540E\u9009\u62E9\u4FDD\u5B58\u4F4D\u7F6E\uFF0C\u4E0D\u4F1A\u6539\u52A8\u5F53\u524D\u5DE5\u7A0B",
    "export.emptyTimeline": "\u65F6\u95F4\u7EBF\u4E3A\u7A7A\uFF0C\u5148\u5F80\u8F68\u9053\u91CC\u653E\u70B9\u4E1C\u897F",
    "export.frameNoOutput": "\u9700\u8981\u8F93\u51FA\u8DEF\u5F84",
    "export.frameTextFailed": "\u6587\u5B57\u56FE\u5C42\u6E32\u67D3\u5931\u8D25",
    "export.frameTimeInvalid": "\u65F6\u95F4\u8D85\u51FA\u65F6\u95F4\u7EBF\u8303\u56F4",
    "export.frameNoVideo": "\u5BFC\u51FA\u8BA1\u5212\u7F3A\u5C11\u753B\u9762\u8F93\u51FA",
    "export.missingAssets": "\u8FD9\u4E9B\u7D20\u6750\u5DF2\u79BB\u7EBF\u6216\u4E22\u5931\uFF1A{names}",
    "export.textRenderFailed": "\u65E0\u6CD5\u6E32\u67D3\u6587\u5B57\u56FE\u5C42",
    "export.exported": "\u5DF2\u5BFC\u51FA\u5230 {path}",
    "export.failed": "\u5BFC\u51FA\u5931\u8D25\uFF1A{error}",
    "export.cancelled": "\u5DF2\u53D6\u6D88\u5BFC\u51FA",
    "export.warnMissingAsset": "\u6709\u7247\u6BB5\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u7D20\u6750\uFF0C\u5DF2\u8DF3\u8FC7",
    "export.warnMissingTextImage": "\u6587\u5B57\u7247\u6BB5\u300C{text}\u300D\u7F3A\u5C11\u6E32\u67D3\u56FE\uFF0C\u5DF2\u8DF3\u8FC7",
    "export.offlineAsset": "\u7D20\u6750\u5DF2\u79BB\u7EBF\uFF1A{name}",
    "export.format.mp4.label": "MP4 \xB7 H.264",
    "export.format.mp4.hint": "\u901A\u7528\uFF0C\u9002\u5408\u5206\u4EAB\u5230\u793E\u4EA4\u5E73\u53F0",
    "export.format.mp4.audio": "AAC \xB7 192 kbps",
    "export.format.prores.label": "ProRes 422",
    "export.format.prores.hint": "\u9AD8\u7801\u7387\u4E2D\u95F4\u683C\u5F0F\uFF0C\u9002\u5408\u540E\u671F",
    "export.format.prores.audio": "PCM \xB7 48 kHz",
    "export.format.gif.label": "GIF",
    "export.format.gif.hint": "\u77ED\u5FAA\u73AF\u52A8\u56FE\uFF0C\u65E0\u58F0\u97F3",
    "export.format.gif.audio": "\u65E0\u97F3\u8F68",
    // ---- 设置 ----
    "settings.title": "\u8BBE\u7F6E",
    "settings.back": "\u8BBE\u7F6E",
    "settings.navAria": "\u8BBE\u7F6E\u5206\u7C7B",
    "settings.section.general": "\u5E38\u89C4",
    "settings.section.general.caption": "\u5DE5\u7A0B\u3001\u542F\u52A8\u4E0E\u8BED\u8A00",
    "settings.section.appearance": "\u5916\u89C2",
    "settings.section.appearance.caption": "\u4E3B\u9898\u4E0E\u914D\u8272",
    "settings.section.layout": "\u5E03\u5C40",
    "settings.section.layout.caption": "\u9762\u677F\u4E0E\u5BBD\u5EA6",
    "settings.section.about": "\u5173\u4E8E",
    "settings.section.about.caption": "\u7248\u672C\u4E0E\u8BB8\u53EF",
    "settings.section.storage": "\u5B58\u50A8",
    "settings.section.storage.caption": "\u6A21\u578B\u3001\u8FD0\u884C\u65F6\u4E0E\u6570\u636E\u76EE\u5F55",
    "settings.web.title": "Web \u8BBF\u95EE",
    "settings.web.local": "\u672C\u673A\u5730\u5740",
    "settings.web.localHint": "\u5728\u672C\u673A\u6D4F\u89C8\u5668\u6253\u5F00\uFF1B\u5730\u5740\u91CC\u5E26\u8BBF\u95EE\u4EE4\u724C\uFF0C\u6743\u9650\u7B49\u540C\u684C\u9762\u7AEF\u3002",
    "settings.web.copy": "\u590D\u5236",
    "settings.web.lan": "\u5C40\u57DF\u7F51\u8BBF\u95EE",
    "settings.web.lanHint": "\u5F00\u542F\u540E\u540C\u4E00\u7F51\u6BB5\u7684\u8BBE\u5907\u53EF\u4EE5\u6253\u5F00\u3002",
    "settings.web.lanUnavailable": "\u672A\u8FDE\u63A5\u5230\u5C40\u57DF\u7F51",
    "settings.web.restart": "\u5DF2\u4FEE\u6539\uFF0C\u91CD\u542F\u540E\u751F\u6548\u3002",
    "settings.web.open": "\u5728\u6D4F\u89C8\u5668\u6253\u5F00",
    "settings.web.openHint": "\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u6D4F\u89C8\u5668\u6253\u5F00\u5F53\u524D\u4F1A\u8BDD\u3002",
    "settings.web.openButton": "\u6253\u5F00",
    "settings.storage.location": "\u6570\u636E\u76EE\u5F55",
    "settings.storage.current": "\u5F53\u524D\u4F4D\u7F6E",
    "settings.storage.currentHint": "\u6A21\u578B\u3001ONNX Runtime\u3001OFX \u63D2\u4EF6\u4E0E\u5DE5\u7A0B\u5386\u53F2\u90FD\u653E\u5728\u8FD9\u91CC",
    "settings.storage.source.label": "\u7531\u8C01\u6307\u5B9A",
    "settings.storage.source.cli": "\u547D\u4EE4\u884C\uFF08\u4FBF\u643A\u6A21\u5F0F\uFF09",
    "settings.storage.source.env": "\u73AF\u5883\u53D8\u91CF AICUT_DATA_DIR",
    "settings.storage.source.settings": "\u8BBE\u7F6E\uFF08\u672C\u5E94\u7528\uFF09",
    "settings.storage.source.installer": "\u5B89\u88C5\u7A0B\u5E8F",
    "settings.storage.source.default": "\u7CFB\u7EDF\u9ED8\u8BA4\uFF08\u8DDF\u968F\u7528\u6237\u76EE\u5F55\uFF09",
    "settings.storage.default": "\u7CFB\u7EDF\u9ED8\u8BA4\u4F4D\u7F6E",
    "settings.storage.systemDrive": "\u6570\u636E\u76EE\u5F55\u5728\u7CFB\u7EDF\u76D8\u4E0A\uFF0C\u5F53\u524D\u5360\u7528 {size}\uFF1B\u7A7A\u95F4\u7D27\u5F20\u65F6\u53EF\u4EE5\u8FC1\u5230\u5176\u4ED6\u78C1\u76D8\u3002",
    "settings.storage.cache": "\u7F13\u5B58\u4F4D\u7F6E",
    "settings.storage.cacheHint": "\u7F29\u7565\u56FE\u4E0E\u4E2D\u95F4\u4EA7\u7269\uFF0C\u53EF\u91CD\u5EFA\uFF1B\u8FC1\u79FB\u65F6\u4E0D\u590D\u5236",
    "settings.storage.move": "\u8FC1\u79FB\u5230\u5176\u4ED6\u78C1\u76D8",
    "settings.storage.moveHint": "\u628A\u5F53\u524D\u6570\u636E\u6574\u4F53\u590D\u5236\u5230\u65B0\u76EE\u5F55\uFF08\u5FC5\u987B\u662F\u7A7A\u6587\u4EF6\u5939\uFF09\uFF0C\u590D\u5236\u5B8C\u91CD\u542F\u751F\u6548\u3002",
    "settings.storage.choose": "\u9009\u62E9\u76EE\u5F55\u5E76\u8FC1\u79FB",
    "settings.storage.portable": "\u5F53\u524D\u76EE\u5F55\u7531\u547D\u4EE4\u884C\u6216\u73AF\u5883\u53D8\u91CF\u6307\u5B9A\uFF08\u4FBF\u643A\u6A21\u5F0F\uFF09\uFF1B\u8981\u6539\u8BF7\u4FEE\u6539\u542F\u52A8\u53C2\u6570\u3002",
    "settings.storage.scanning": "\u6B63\u5728\u7EDF\u8BA1\u8981\u590D\u5236\u7684\u6570\u636E\u2026",
    "settings.storage.copying": "\u6B63\u5728\u590D\u5236 {done}",
    "settings.storage.writing": "\u6B63\u5728\u91CD\u5199\u6570\u636E\u91CC\u7684\u8DEF\u5F84\u2026",
    "settings.storage.failed": "\u8FC1\u79FB\u5931\u8D25\uFF1A{error}",
    "settings.storage.done": "\u5DF2\u590D\u5236\u5230 {path}\uFF0C\u91CD\u542F\u540E\u751F\u6548\u3002",
    "settings.storage.migratedTitle": "\u8FC1\u79FB\u5B8C\u6210",
    "settings.storage.migrated": "\u65B0\u76EE\u5F55\uFF1A{path}",
    "settings.storage.migratedHint": "\u5F53\u524D\u8FDB\u7A0B\u4ECD\u5728\u7528\u65E7\u76EE\u5F55\uFF1B\u91CD\u542F\u540E\u624D\u4F1A\u4ECE\u65B0\u76EE\u5F55\u8BFB\u5199\uFF0C\u90A3\u65F6\u5C31\u80FD\u6E05\u7406\u65E7\u6570\u636E\u3002",
    "settings.storage.restartNow": "\u7ACB\u5373\u91CD\u542F",
    "settings.storage.previousTitle": "\u65E7\u6570\u636E",
    "settings.storage.previous": "\u4E0A\u4E00\u6B21\u8FC1\u79FB\u7559\u4E0B\u7684\u76EE\u5F55",
    "settings.storage.previousHint": "\u786E\u8BA4\u65B0\u76EE\u5F55\u5DE5\u4F5C\u6B63\u5E38\u540E\u53EF\u4EE5\u5220\u6389\u5B83\u91CA\u653E\u7A7A\u95F4\u3002",
    "settings.storage.cleanup": "\u6E05\u7406\u65E7\u76EE\u5F55",
    "settings.storage.cleaned": "\u5DF2\u6E05\u7406\u65E7\u76EE\u5F55\uFF1A{path}",
    "settings.storage.nothingToClean": "\u6CA1\u6709\u9700\u8981\u6E05\u7406\u7684\u65E7\u76EE\u5F55\u3002",
    "settings.storage.cleanupFailed": "\u6E05\u7406\u5931\u8D25\uFF1A{error}",
    "settings.storage.confirmTitle": "\u8FC1\u79FB\u6570\u636E\u76EE\u5F55\uFF1F",
    "settings.storage.confirmBody": "\u5C06\u628A\u5F53\u524D\u6570\u636E\u76EE\u5F55\u6574\u4F53\u590D\u5236\u5230 {path}\u3002\u76EE\u6807\u6587\u4EF6\u5939\u5FC5\u987B\u662F\u7A7A\u7684\uFF1B\u590D\u5236\u5B8C\u6210\u5E76\u91CD\u542F\u5E94\u7528\u540E\u751F\u6548\u3002\u8FC1\u79FB\u8FC7\u7A0B\u4E2D\u8BF7\u4E0D\u8981\u6539\u8BBE\u7F6E\u6216\u4E0B\u8F7D\u6A21\u578B\uFF0C\u65E7\u6570\u636E\u4E0D\u4F1A\u81EA\u52A8\u5220\u9664\uFF0C\u91CD\u542F\u540E\u53EF\u5728\u8FD9\u91CC\u6E05\u7406\u3002",
    "settings.storage.confirmGo": "\u5F00\u59CB\u8FC1\u79FB",
    "settings.storage.desktopOnly": "\u6570\u636E\u76EE\u5F55\u53EA\u5728\u684C\u9762\u5E94\u7528\u91CC\u53EF\u6539\u3002",
    // ---- 能力表：服务端声明"这个功能在当前形态能不能用" ----
    "caps.fallback.separator": "\uFF1B\u53EF\u6539\u7528\uFF1A",
    "caps.fallback.desktop": "\u5728\u684C\u9762\u5E94\u7528\u4E2D\u4F7F\u7528",
    "caps.reason.notPorted": "\u5C1A\u672A\u5728\u6D4F\u89C8\u5668\u7248\u672C\u63D0\u4F9B",
    "caps.reason.pluginRevealDesktopOnly": "\u63D2\u4EF6\u53EF\u88C5 / \u53EF\u5220 / \u53EF\u5BFC\u5165\uFF1B\u300C\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u91CC\u663E\u793A\u300D\u9700\u8981\u684C\u9762\u5E94\u7528",
    "caps.reason.needsPath": "\u9700\u8981\u7CFB\u7EDF\u7EA7\u6743\u9650\uFF0C\u6D4F\u89C8\u5668\u7248\u672C\u65E0\u6CD5\u63D0\u4F9B",
    "caps.feature.agent": "\u667A\u80FD\u4F53",
    "caps.feature.mcp": "MCP \u670D\u52A1",
    "caps.feature.cli": "\u547D\u4EE4\u884C\u6302\u8F7D",
    "caps.feature.network": "\u7F51\u7EDC\u8BBE\u7F6E",
    "caps.feature.cloudTts": "\u4E91\u7AEF\u6717\u8BFB",
    "caps.feature.cloudGen": "\u4E91\u7AEF\u51FA\u56FE / \u51FA\u89C6\u9891",
    "caps.feature.loudness": "\u54CD\u5EA6\u6D4B\u91CF",
    "caps.feature.videoDsp": "\u89C6\u9891\u5904\u7406",
    "caps.feature.runtime": "AI \u8FD0\u884C\u5E93",
    "caps.feature.imageGen": "AI \u51FA\u56FE",
    "caps.feature.videoGen": "AI \u89C6\u9891\u751F\u6210",
    "caps.feature.sdcpp": "\u672C\u5730\u751F\u6210\u5F15\u64CE",
    "caps.feature.dataDir": "\u6570\u636E\u76EE\u5F55",
    "caps.feature.backend": "AI \u6267\u884C\u540E\u7AEF",
    "settings.storage.cleanupTitle": "\u5220\u9664\u65E7\u6570\u636E\u76EE\u5F55\uFF1F",
    "settings.storage.cleanupBody": "\u5C06\u5220\u9664 {path}\uFF0C\u53EA\u4FDD\u7559\u542F\u52A8\u7528\u7684\u6307\u9488\u4E0E\u53D1\u73B0\u6587\u4EF6\u3002\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
    "settings.storage.cleanupGo": "\u5220\u9664",
    "settings.language": "\u8BED\u8A00",
    "settings.language.label": "\u754C\u9762\u8BED\u8A00",
    "settings.language.hint": "\u5207\u6362\u540E\u7ACB\u5373\u751F\u6548",
    "settings.startup": "\u542F\u52A8",
    "settings.welcome.label": "\u542F\u52A8\u65F6\u663E\u793A\u6B22\u8FCE\u9875",
    "settings.welcome.hint": "\u6BCF\u6B21\u6253\u5F00\u90FD\u7ED9\u51FA\u8D77\u6B65\u5165\u53E3\uFF1B\u5173\u6389\u540E\u4ECD\u53EF\u4ECE\u5E2E\u52A9\u83DC\u5355\u91CD\u770B\u3002",
    "settings.welcome.replay": "\u5FEB\u901F\u4E0A\u624B",
    "settings.welcome.replayHint": "\u7528\u805A\u5149\u706F\u628A\u4E3B\u8981\u533A\u57DF\u518D\u8BB2\u4E00\u904D",
    "settings.welcome.replayAction": "\u518D\u770B\u4E00\u6B21",
    "settings.project": "\u5DE5\u7A0B",
    "settings.project.current": "\u5F53\u524D\u5DE5\u7A0B",
    "settings.project.currentHint": "\u540D\u79F0\u4E0E\u683C\u5F0F",
    "settings.output.label": "\u8F93\u51FA\u8BBE\u7F6E",
    "settings.output.resolution": "\u5206\u8FA8\u7387",
    "settings.output.resolutionHint": "\u9884\u89C8\u753B\u5E03\u4E0E\u5BFC\u51FA\u5C3A\u5BF8\uFF1B\u4FEE\u6539\u540E\u7247\u6BB5\u6309\u6BD4\u4F8B\u91CD\u65B0\u9002\u914D",
    "settings.output.fps": "\u5E27\u7387",
    "settings.output.fpsHint": "\u65F6\u95F4\u7EBF\u5438\u9644\u4E0E\u5BFC\u51FA\u5E27\u7387",
    "settings.output.custom": "\u81EA\u5B9A\u4E49",
    "settings.output.1080p": "1920 \xD7 1080",
    "settings.output.720p": "1280 \xD7 720",
    "settings.output.4k": "3840 \xD7 2160",
    "settings.output.vertical": "1080 \xD7 1920",
    "settings.output.square": "1080 \xD7 1080",
    "settings.output.4x3": "1440 \xD7 1080",
    "settings.output.width": "\u5BBD\u5EA6",
    "settings.output.height": "\u9AD8\u5EA6",
    "settings.theme": "\u4E3B\u9898",
    "settings.theme.label": "\u4E3B\u9898",
    "settings.theme.hint": "\u8DDF\u968F\u7CFB\u7EDF\u4F1A\u968F\u7CFB\u7EDF\u5916\u89C2\u5207\u6362",
    "settings.theme.light": "\u6D45\u8272",
    "settings.theme.dark": "\u6DF1\u8272",
    "settings.theme.system": "\u8DDF\u968F\u7CFB\u7EDF",
    "settings.accent": "\u4E3B\u9898\u8272",
    "settings.accent.label": "\u5F3A\u8C03\u8272",
    "settings.accent.hint": "\u7528\u4E8E\u6309\u94AE\u3001\u9009\u4E2D\u6001\u4E0E\u6ED1\u5757",
    "accent.lavender": "\u85B0\u8863\u8349\u7D2B",
    "accent.blue": "\u84DD\u8272",
    "accent.green": "\u7EFF\u8272",
    "accent.coral": "\u73CA\u745A\u7EA2",
    "accent.amber": "\u7425\u73C0\u9EC4",
    "settings.panels": "\u9762\u677F",
    "settings.panels.tracks": "\u663E\u793A\u65F6\u95F4\u7EBF",
    "settings.panels.tracksHint": "\u9884\u89C8\u4E0B\u65B9\u7684\u8F68\u9053\u533A\u57DF",
    "settings.panels.inspector": "\u663E\u793A\u53F3\u4FA7\u9762\u677F",
    "settings.panels.inspectorHint": "\u5A92\u4F53\u5E93\u3001\u68C0\u67E5\u5668\u4E0E AI \u52A9\u624B",
    "settings.width": "\u5C3A\u5BF8",
    "settings.width.tracks": "\u65F6\u95F4\u7EBF\u9AD8\u5EA6\uFF08px\uFF09",
    "settings.width.inspector": "\u53F3\u4FA7\u9762\u677F\u5BBD\u5EA6\uFF08px\uFF09",
    "settings.about.app": "\u5E94\u7528",
    "settings.about.version": "\u7248\u672C",
    "settings.about.versionHint": "\u5F53\u524D\u6784\u5EFA\u7248\u672C",
    "settings.about.engine": "\u5F15\u64CE",
    "settings.about.engineHint": "\u6E32\u67D3\u4E0E\u5BFC\u51FA\u540E\u7AEF",
    "settings.about.license": "\u8BB8\u53EF",
    "settings.about.licenseLabel": "\u5F00\u6E90\u8BB8\u53EF",
    "settings.about.licenseHint": "\u5E94\u7528\u4E0E\u672C\u5730\u63A8\u7406\u4EE3\u7801\u4F7F\u7528\u540C\u4E00\u8BB8\u53EF",
    "settings.update.group": "\u8F6F\u4EF6\u66F4\u65B0",
    "settings.update.title": "\u8F6F\u4EF6\u66F4\u65B0",
    "settings.update.hint": "\u4ECE GitHub Releases \u83B7\u53D6\u66F4\u65B0",
    "settings.update.notes": "\u66F4\u65B0\u8BF4\u660E",
    "settings.update.check": "\u68C0\u67E5\u66F4\u65B0",
    "settings.update.download": "\u4E0B\u8F7D\u5E76\u5B89\u88C5",
    "settings.update.restart": "\u91CD\u542F\u5E94\u7528",
    "settings.update.downloading": "\u4E0B\u8F7D\u4E2D {percent}%",
    "settings.update.availableToast": "\u53D1\u73B0\u65B0\u7248\u672C {version}\uFF0C\u53EF\u5728 \u8BBE\u7F6E \u2192 \u5173\u4E8E \u4E2D\u66F4\u65B0",
    "settings.update.status.checking": "\u6B63\u5728\u68C0\u67E5\u66F4\u65B0\u2026",
    "settings.update.status.available": "\u53D1\u73B0\u65B0\u7248\u672C {version}",
    "settings.update.status.downloading": "\u6B63\u5728\u4E0B\u8F7D {version}",
    "settings.update.status.ready": "\u66F4\u65B0\u5DF2\u5C31\u7EEA",
    "settings.update.status.error": "\u66F4\u65B0\u5931\u8D25\uFF1A{error}",
    "settings.update.status.idle": "\u5DF2\u662F\u6700\u65B0\u7248\u672C",
    "settings.update.status.restartHint": "\u91CD\u542F\u5E94\u7528\u4EE5\u5B8C\u6210\u66F4\u65B0",
    "update.notice.message": "\u5DF2\u4ECE v{from} \u66F4\u65B0\u5230 v{version}\uFF0C\u5F53\u524D\u8FD0\u884C\u7684\u5DF2\u662F\u65B0\u7248\u672C\u3002",
    "update.notice.viewNotes": "\u67E5\u770B\u66F4\u65B0\u65E5\u5FD7",
    "settings.untitled": "\u672A\u547D\u540D\u9879\u76EE",
    // ---- AI 助手 ----
    "ai.title": "AI \u52A9\u624B",
    "ai.sub": "\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u6210\u7247\uFF0C\u6211\u6765\u52A8\u624B\u526A",
    "ai.intro1": "\u544A\u8BC9\u6211\u4F60\u60F3\u526A\u6210\u4EC0\u4E48\u6837\u3002\u6BD4\u5982\uFF1A",
    "ai.introExample": "\u628A\u300C\u6D77\u8FB9\u65E5\u843D\u300D\u653E\u5728\u5F00\u5934\uFF0C\u914D\u4E00\u6BB5\u8F7B\u5FEB\u7684\u97F3\u4E50\uFF0C\u603B\u957F\u63A7\u5236\u5728 30 \u79D2\u3002",
    "ai.intro2": "\u6211\u4F1A\u5148\u7ED9\u51FA\u7C97\u526A\u65B9\u6848\uFF0C\u518D\u6309\u4F60\u7684\u53CD\u9988\u8C03\u6574\u8282\u594F\u4E0E\u8F6C\u573A\u3002",
    "ai.suggestion.auto": "\u81EA\u52A8\u7C97\u526A",
    "ai.suggestion.silence": "\u53BB\u9664\u9759\u97F3",
    "ai.suggestion.captions": "\u751F\u6210\u5B57\u5E55",
    "ai.suggestion.music": "\u914D\u4E00\u6BB5\u97F3\u4E50",
    "ai.hint": "\u539F\u578B\u9636\u6BB5\uFF1A\u5BF9\u8BDD\u4E0E\u526A\u8F91\u80FD\u529B\u5C1A\u672A\u63A5\u5165",
    "ai.placeholder": "\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u526A\u8F91\u2026",
    "ai.send": "\u53D1\u9001",
    // ---- 剪辑智能体 ----
    "agent.title": "\u526A\u8F91\u667A\u80FD\u4F53",
    "agent.config": "\u914D\u7F6E",
    "agent.newChat": "\u65B0\u5BF9\u8BDD",
    "agent.history": "\u5386\u53F2",
    "agent.historyTitle": "\u5BF9\u8BDD\u5386\u53F2",
    "agent.historySearch": "\u641C\u7D22\u5BF9\u8BDD",
    "agent.historyEmpty": "\u8FD8\u6CA1\u6709\u5BF9\u8BDD",
    "agent.historyNoMatch": "\u6CA1\u6709\u5339\u914D\u7684\u5BF9\u8BDD",
    "agent.historyCount": "{count} \u6761\u6D88\u606F",
    "agent.close": "\u5173\u95ED",
    "agent.unconfiguredTitle": "\u5148\u914D\u7F6E\u526A\u8F91\u667A\u80FD\u4F53",
    "agent.unconfiguredHint": "\u5148\u5230\u300C\u8BBE\u7F6E \u2192 \u6587\u672C\u751F\u6210\u300D\u6DFB\u52A0\u4E00\u4E2A\u6587\u672C\u6A21\u578B\u4F9B\u5E94\u5546\uFF08\u7AEF\u70B9 / API Key / \u6A21\u578B\uFF09\u3002",
    "agent.goSettings": "\u53BB\u8BBE\u7F6E",
    "agent.placeholder": "\u63CF\u8FF0\u4F60\u60F3\u600E\u4E48\u526A\u2026",
    "agent.send": "\u53D1\u9001",
    "agent.stop": "\u505C\u6B62",
    "agent.edit": "\u7F16\u8F91",
    "agent.emptyHint": "\u8BF4\u70B9\u4EC0\u4E48\uFF0C\u5F00\u59CB\u526A\u8F91",
    "agent.think": "\u601D\u8003",
    "agent.process.runningThinking": "\u6B63\u5728\u601D\u8003",
    "agent.process.runningTools": "\u6B63\u5728\u8C03\u7528 {name}",
    "agent.process.stopped": "\u5DF2\u505C\u6B62",
    "agent.process.failed": "\u5904\u7406\u5931\u8D25",
    "agent.process.took": "\u5DF2\u5B8C\u6210\uFF0C\u7528\u65F6 {duration}",
    "agent.process.tools": "{count} \u4E2A\u5DE5\u5177\u8C03\u7528",
    "agent.process.toolsRunning": "\u6B63\u5728\u8C03\u7528 {name}",
    "agent.process.toolsFailed": "{count} \u4E2A\u5931\u8D25",
    "agent.toolOk": "\u5B8C\u6210",
    "agent.toolFail": "\u5931\u8D25",
    "agent.toolPending": "\u672A\u6267\u884C",
    "agent.toolRunning": "\u8FD0\u884C\u4E2D",
    "agent.toolInput": "\u8F93\u5165",
    "agent.toolOutput": "\u8F93\u51FA",
    "agent.durationSeconds": "{s} \u79D2",
    "agent.durationMinutes": "{m} \u5206 {s} \u79D2",
    "agent.durationHours": "{h} \u65F6 {m} \u5206 {s} \u79D2",
    "agent.command.editTimeline": "\u7F16\u8F91\u65F6\u95F4\u7EBF",
    "agent.command.undo": "\u64A4\u9500",
    "agent.command.redo": "\u91CD\u505A",
    "agent.command.renameProject": "\u91CD\u547D\u540D\u5DE5\u7A0B",
    "agent.command.openProject": "\u6253\u5F00\u5DE5\u7A0B",
    // ---- 操作记录 ----
    "ops.title": "\u64CD\u4F5C\u8BB0\u5F55",
    "ops.summary": "\u5171 {total} \u6B65 \xB7 \u5DF2\u5E94\u7528 {applied} \xB7 \u53EF\u91CD\u505A {redo}",
    "ops.filter.all": "\u5168\u90E8",
    "ops.filter.human": "\u4EBA\u7C7B",
    "ops.filter.builtin": "\u5185\u7F6E\u52A9\u624B",
    "ops.filter.external": "\u5916\u90E8 AI",
    "ops.actor.human": "\u4EBA\u7C7B",
    "ops.actor.builtin": "\u5185\u7F6E\u52A9\u624B",
    "ops.actor.external": "\u5916\u90E8 AI",
    "ops.search": "\u641C\u7D22\u64CD\u4F5C",
    "ops.searchLabel": "\u641C\u7D22\u64CD\u4F5C\u8BB0\u5F55",
    "ops.undoLast": "\u64A4\u9500\u4E0A\u4E00\u6B65",
    "ops.redoLast": "\u91CD\u505A\u4E0B\u4E00\u6B65",
    "ops.current": "\u5F53\u524D\u72B6\u6001",
    "ops.empty": "\u8FD8\u6CA1\u6709\u64CD\u4F5C",
    "ops.emptyHint": "\u4EBA\u7C7B\u3001\u5185\u7F6E\u52A9\u624B\u548C\u5916\u90E8 AI \u5BF9\u5DE5\u7A0B\u7684\u6BCF\u4E00\u6B65\u6539\u52A8\u90FD\u4F1A\u8BB0\u5F55\u5728\u8FD9\u91CC\u3002",
    "ops.emptyFilter": "\u6CA1\u6709\u5339\u914D\u7684\u64CD\u4F5C",
    "ops.undone": "\u5DF2\u64A4\u9500",
    "ops.revert": "\u56DE\u64A4\u5230\u6B64\u6B65\u4E4B\u524D",
    "ops.reapply": "\u91CD\u505A\u5230\u6B64\u6B65",
    "ops.revertHint": "\u4F1A\u64A4\u9500 {count} \u6B65\uFF08\u542B\u8FD9\u4E00\u6B65\uFF09",
    "ops.reapplyHint": "\u4F1A\u91CD\u505A {count} \u6B65\uFF08\u542B\u8FD9\u4E00\u6B65\uFF09",
    "ops.clips": "{count} \u7247\u6BB5",
    "ops.tracks": "{count} \u8F68\u9053",
    "ops.assets": "{count} \u7D20\u6750",
    "ops.batchLabel": "{label} \u7B49 {count} \u9879",
    "ops.kind.asset.add": "\u6DFB\u52A0\u7D20\u6750",
    "ops.kind.asset.remove": "\u79FB\u9664\u7D20\u6750",
    "ops.kind.asset.update": "\u66F4\u65B0\u7D20\u6750",
    "ops.kind.clip.add": "\u6DFB\u52A0\u7247\u6BB5",
    "ops.kind.clip.update": "\u4FEE\u6539\u7247\u6BB5",
    "ops.kind.clip.remove": "\u5220\u9664\u7247\u6BB5",
    "ops.kind.clip.split": "\u5207\u5206\u7247\u6BB5",
    "ops.kind.clip.trim": "\u4FEE\u526A\u7247\u6BB5",
    "ops.kind.clip.move": "\u79FB\u52A8\u7247\u6BB5",
    "ops.kind.clip.append": "\u8FFD\u52A0\u7247\u6BB5",
    "ops.kind.clip.speed": "\u53D8\u901F",
    "ops.kind.clip.color": "\u8C03\u8272",
    "ops.kind.clip.transition": "\u8F6C\u573A",
    "ops.kind.clip.keyframes": "\u5173\u952E\u5E27",
    "ops.kind.clip.duplicate": "\u590D\u5236\u7247\u6BB5",
    "ops.kind.clip.ripple_delete": "\u5220\u9664\u5E76\u5DE6\u79FB\u540E\u7EED\u7247\u6BB5",
    "ops.kind.track.add": "\u6DFB\u52A0\u8F68\u9053",
    "ops.kind.track.update": "\u4FEE\u6539\u8F68\u9053",
    "ops.kind.track.remove": "\u5220\u9664\u8F68\u9053",
    "ops.kind.track.move": "\u79FB\u52A8\u8F68\u9053",
    "ops.kind.subtitle.import": "\u5BFC\u5165\u5B57\u5E55",
    "ops.kind.marker.add": "\u6DFB\u52A0\u6807\u8BB0",
    "ops.kind.marker.update": "\u4FEE\u6539\u6807\u8BB0",
    "ops.kind.marker.remove": "\u5220\u9664\u6807\u8BB0",
    "ops.kind.project.rename": "\u91CD\u547D\u540D\u5DE5\u7A0B",
    "ops.kind.project.output": "\u4FEE\u6539\u8F93\u51FA\u8BBE\u7F6E",
    "ops.kind.project.reset": "\u65B0\u5EFA / \u6253\u5F00\u5DE5\u7A0B",
    "ops.kind.ui.dispatch": "\u65F6\u95F4\u7EBF\u7F16\u8F91",
    "ops.kind.history.undo": "\u64A4\u9500",
    "ops.kind.history.redo": "\u91CD\u505A",
    // ---- AI 功能 ----
    "ai.agent": "\u526A\u8F91\u667A\u80FD\u4F53",
    "ai.agentHint": "\u5BF9\u8BDD\u5F0F\u526A\u8F91\uFF0C\u76F4\u63A5\u6539\u65F6\u95F4\u7EBF",
    "ai.run": "\u6253\u5F00",
    "ai.pluginPageHint": "\u63D2\u4EF6\u63D0\u4F9B\u7684\u9875\u9762",
    "ai.mcpServer": "MCP \u670D\u52A1\u5668",
    "ai.mcpOn": "\u5DF2\u5F00\u542F\uFF0CHarness \u53EF\u4EE5\u8FDE\u63A5",
    "ai.mcpOff": "\u5DF2\u5173\u95ED",
    "ai.mcpToggleOn": "\u5F00\u542F MCP",
    "ai.mcpToggleOff": "\u5173\u95ED MCP",
    "ai.endpoint": "\u63A5\u5165\u5730\u5740",
    "ai.copy": "\u590D\u5236",
    "ai.copied": "\u5DF2\u590D\u5236 MCP \u5730\u5740",
    "ai.copyFailed": "\u590D\u5236\u5931\u8D25",
    "ai.cli": "\u547D\u4EE4\u884C\u4E0E Skills",
    "ai.cliHint": "aicut \u662F MCP \u7684\u8584\u5BA2\u6237\u7AEF\uFF1BSkills \u901A\u8FC7\u5B83\u548C MCP \u5DE5\u5177\u63A7\u5236 App\u3002",
    "ai.openCli": "\u547D\u4EE4\u884C\u8BBE\u7F6E",
    "ai.stop": "\u505C\u6B62",
    "ai.tagFilter": "AI \u80FD\u529B\u5206\u7C7B",
    "ai.engine.onnx": "ONNX",
    "ai.engine.onnxHint": "ONNX Runtime \u672C\u5730\u63A8\u7406\uFF08ONNX \u6A21\u578B\uFF0CCPU / DirectML / CoreML / CUDA\uFF09",
    "ai.engine.sdcpp": "sd.cpp",
    "ai.engine.sdcppHint": "sd.cpp\uFF08ggml\uFF09\u672C\u5730\u63A8\u7406\uFF1A\u89C6\u9891 / \u56FE\u50CF\u6A21\u578B\u8D70\u72EC\u7ACB\u5F15\u64CE\uFF0CCPU / Vulkan / CUDA 12 / Metal",
    "ai.engine.cloud": "\u4E91\u7AEF",
    "ai.engine.cloudHint": "\u8C03\u7528\u8BBE\u7F6E\u91CC\u914D\u7F6E\u7684\u4E91\u7AEF\u670D\u52A1\uFF0C\u672C\u673A\u4E0D\u8DD1\u6A21\u578B",
    "ai.tags.all": "\u5168\u90E8",
    "ai.tags.visual": "\u753B\u9762",
    "ai.tags.audio": "\u97F3\u9891",
    "ai.tags.text": "\u6587\u672C",
    "ai.textFeatures": "\u6587\u672C",
    "ai.audioFeatures": "\u97F3\u9891",
    "ai.videoGen": "AI \u89C6\u9891\u751F\u6210",
    "ai.videoGenOpen": "\u6253\u5F00\u89C6\u9891\u751F\u6210",
    "ai.imageGen": "AI \u753B\u56FE",
    "ai.imageEdit": "\u56FE\u50CF\u7F16\u8F91",
    "ai.imageGenOpen": "\u6253\u5F00\u753B\u56FE",
    "ai.imageEditOpen": "\u6253\u5F00\u56FE\u50CF\u7F16\u8F91",
    "ai.prepare": "\u51C6\u5907",
    "ai.setupNote": "\u5F15\u64CE + \u6A21\u578B\u9700\u4E0B\u8F7D {size}",
    "ai.setupReady": "\u5F15\u64CE\u4E0E\u6A21\u578B\u5DF2\u5C31\u7EEA",
    "ai.cloudReady": "\u4E91\u7AEF\u670D\u52A1\uFF1A{name}",
    "ai.emptyTag": "\u8FD9\u4E00\u7C7B\u8FD8\u6CA1\u6709\u53EF\u7528\u7684 AI \u80FD\u529B",
    "aiVideo.title": "AI \u89C6\u9891\u751F\u6210",
    "aiVideo.track": "AI \u89C6\u9891",
    "aiVideo.engine": "sd.cpp \u5F15\u64CE",
    "aiVideo.engineMissing": "\u5F15\u64CE\u672A\u4E0B\u8F7D",
    "aiVideo.engineMissingHint": "\u5148\u5728\u4E0B\u8F7D\u7BA1\u7406\u5668\u5B89\u88C5 sd.cpp \u5F15\u64CE\uFF08CPU / Vulkan / CUDA 12\uFF09\u3002",
    "aiVideo.engineMissingTitle": "\u9700\u8981\u4E0B\u8F7D sd.cpp \u5F15\u64CE",
    "aiVideo.engineDownloadBody": "\u300C{name}\u300D\u9700\u8981\u5148\u4E0B\u8F7D sd.cpp \u5F15\u64CE\uFF08{size}\uFF09\u3002\u73B0\u5728\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668\u5417\uFF1F",
    "aiVideo.engineReady": "\u5F15\u64CE\u5C31\u7EEA",
    "aiVideo.downloadEngine": "\u4E0B\u8F7D\u5F15\u64CE",
    "aiVideo.manageEngine": "\u7BA1\u7406\u5F15\u64CE",
    "aiVideo.configure": "\u914D\u7F6E\u751F\u6210\u670D\u52A1\u2026",
    "aiVideo.configureHint": "\u6DFB\u52A0\u5B98\u65B9 API \u6216\u805A\u5408\u7AD9\uFF08OpenRouter\u3001\u7845\u57FA\u6D41\u52A8\u7B49\uFF09",
    "aiVideo.groupLocal": "\u672C\u5730\u6A21\u578B",
    "aiVideo.groupCloud": "\u4E91\u7AEF\u670D\u52A1",
    "aiVideo.cloudHint": "\u4E91\u7AEF\u751F\u6210\uFF1A\u6309\u670D\u52A1\u5546\u8BA1\u8D39\uFF0C\u91C7\u6837\u53C2\u6570\u7531\u6A21\u578B\u51B3\u5B9A",
    "aiVideo.cloudFrameNote": "\u4E91\u7AEF\u89C6\u9891\u4F1A\u5728\u670D\u52A1\u5546\u4FA7\u6392\u961F\uFF0C\u901A\u5E38 1 ~ 5 \u5206\u949F\uFF1B\u9996\u5E27\u56FE\u7528\u4E8E\u56FE\u751F\u89C6\u9891\u3002",
    "aiVideo.backend": "\u89C6\u9891\u540E\u7AEF",
    "aiVideo.backendHint": "\u53EA\u5F71\u54CD sd.cpp \u751F\u6210\uFF08\u89C6\u9891 / \u56FE\u50CF\uFF09\uFF0C\u4E0E ONNX Runtime \u540E\u7AEF\u5206\u5F00\u9009\u62E9\uFF1B\u5207\u6362\u540E\u4E0B\u6B21\u751F\u6210\u751F\u6548\u3002",
    "aiVideo.backendSwitched": "\u89C6\u9891\u540E\u7AEF\u5DF2\u5207\u6362\u5230 {name}",
    "aiVideo.model": "\u6A21\u578B",
    "aiVideo.modelHint.minimax_h3": "MiniMax-H3 \u540C\u65F6\u751F\u6210\u753B\u9762\u548C\u7ACB\u4F53\u58F0\u97F3\u9891\uFF0C4 \u4E2A\u6587\u4EF6\u7EA6 30 GB\uFF1BQwen3-VL 32B \u6587\u672C\u7F16\u7801\u5668\u6700\u5403\u5185\u5B58\u3002",
    "aiVideo.modelHint.minimax_h3_ref2va": "MiniMax-H3 Ref2VA \u7528\u53C2\u8003\u56FE / \u53C2\u8003\u97F3\u9891\u9501\u5B9A\u89D2\u8272\u4E0E\u58F0\u97F3\uFF0C\u548C H3 \u5171\u7528\u6587\u672C\u7F16\u7801\u5668 / VAE\uFF08\u4E0B\u8F7D\u65F6\u81EA\u52A8\u590D\u7528\u7EA6 18 GB\uFF09\uFF0C\u4E0D\u80FD\u63A5\u9996\u5E27 / \u5C3E\u5E27\u3002",
    "aiVideo.modelHint.wan21_t2v": "Wan2.1 T2V 1.3B \u53EA\u751F\u6210\u753B\u9762\uFF08\u65E0\u97F3\u9891\uFF09\uFF0C3 \u4E2A\u6587\u4EF6\u7EA6 6.7 GB\uFF0C\u4E0B\u8F7D\u5FEB\u3001\u51FA\u7247\u4E5F\u5FEB\uFF0C\u9002\u5408\u5148\u8DD1\u901A\u94FE\u8DEF\u3002",
    "aiVideo.modelHint.wan22_ti2v": "Wan2.2 TI2V 5B \u662F 1.3B \u7684\u6362\u4EE3\u7248\uFF1A24 fps\u3001\u5C0F\u52A8\u4F5C\u66F4\u7A33\uFF0C3 \u4E2A\u6587\u4EF6\u7EA6 8.5 GB\uFF0C\u4ECD\u7136\u53EA\u6709\u753B\u9762\u3002",
    "aiVideo.modelHint.wan22_t2v_a14b": "Wan2.2 T2V A14B \u7528 high / low noise \u4E24\u4E2A\u4E13\u5BB6\u63A5\u529B\u53BB\u566A\uFF0C\u753B\u8D28\u6700\u597D\uFF0C\u6574\u5305\u7EA6 23 GB\uFF0C16 GB \u663E\u5B58\u5FC5\u987B\u5F00\u300C\u6743\u91CD\u653E\u5185\u5B58\u300D\u3002",
    "aiVideo.modelHint.hunyuan_video_15": "HunyuanVideo 1.5 \u662F 720p \u6587\u751F\u89C6\u9891\uFF0CQwen2.5-VL 7B + ByT5 \u53CC\u6587\u672C\u7F16\u7801\u5668\uFF0C4 \u4E2A\u6587\u4EF6\u7EA6 29 GB\uFF0C\u65E0\u97F3\u9891\u3002",
    "aiVideo.modelHint.ltx_23": "LTX-2.3 22B \u7528 Gemma 3 12B \u5F53\u6587\u672C\u7F16\u7801\u5668\uFF0C\u753B\u9762\u548C\u97F3\u9891\u4E00\u8D77\u751F\u6210\uFF0C5 \u4E2A\u6587\u4EF6\u7EA6 26 GB\u3002",
    "aiVideo.modelHint.ltx_25": "LTX-2.5 22B \u662F LTX-2.3 \u7684\u5347\u7EA7\u7248\uFF1AGemma 4 12B \u6587\u672C\u7F16\u7801\u5668\uFF08int8\uFF0C\u5DF2\u542B\u6295\u5F71\u5C42\uFF09\uFF0C\u753B\u9762\u548C\u97F3\u9891\u4E00\u8D77\u751F\u6210\uFF0C4 \u4E2A\u6587\u4EF6\u7EA6 33 GB\u3002",
    "aiVideo.modelReady": "\u5DF2\u5B89\u88C5 \xB7 {size}",
    "aiVideo.modelNeedsDownload": "\u9700\u4E0B\u8F7D {size}",
    "aiVideo.modelMissingHint": "\u5148\u4E0B\u8F7D\u6A21\u578B\uFF08\u9700 {size}\uFF09\u3002",
    "aiVideo.noModel": "\u6E05\u5355\u91CC\u8FD8\u6CA1\u6709\u89C6\u9891\u751F\u6210\u6A21\u578B",
    "aiVideo.downloadModel": "\u4E0B\u8F7D\u6A21\u578B\uFF08{size}\uFF09",
    "aiVideo.downloadModelTitle": "\u4E0B\u8F7D\u89C6\u9891\u751F\u6210\u6A21\u578B",
    "aiVideo.downloadModelBody": "\u9700\u8981\u4E0B\u8F7D {name}\uFF08{size}\uFF09\u3002\u4E0B\u8F7D\u5B8C\u6210\u540E\u53EF\u4EE5\u5728\u672C\u9875\u76F4\u63A5\u751F\u6210\u3002",
    "aiVideo.downloading": "\u4E0B\u8F7D\u4E2D\u2026",
    "aiVideo.prompt": "\u63D0\u793A\u8BCD",
    "aiVideo.promptPlaceholder": "\u63CF\u8FF0\u753B\u9762\u3001\u955C\u5934\u8FD0\u52A8\u3001\u5149\u7EBF\u548C\u58F0\u97F3\uFF1B\u8FD9\u4E2A\u6A21\u578B\u4F1A\u540C\u65F6\u751F\u6210\u97F3\u9891\u3002",
    "aiVideo.promptPlaceholderSilent": "\u63CF\u8FF0\u753B\u9762\u3001\u955C\u5934\u8FD0\u52A8\u548C\u5149\u7EBF\uFF1B\u8FD9\u4E2A\u6A21\u578B\u53EA\u751F\u6210\u753B\u9762\uFF08\u65E0\u97F3\u9891\uFF09\u3002",
    "aiVideo.resolution": "\u5206\u8FA8\u7387",
    "aiVideo.aspect": "\u753B\u5E45",
    "aiVideo.aspectHint": "\u751F\u6210\u7ED3\u679C\u6309\u6240\u9009\u753B\u5E45\u8F93\u51FA\uFF1B\u5BFC\u51FA\u524D\u8BF7\u628A\u5DE5\u7A0B\u8F93\u51FA\u5C3A\u5BF8\u6539\u6210\u76F8\u540C\u6BD4\u4F8B\uFF0C\u907F\u514D\u52A0\u8FB9\u6216\u88C1\u5207\u3002",
    "aiVideo.refImage": "\u53C2\u8003\u56FE",
    "aiVideo.refImageSubBoth": "\u9996\u5E27 + \u5C3E\u5E27\uFF08\u90E8\u5206\u6A21\u578B\u652F\u6301\u9996\u5C3E\u5E27\uFF09",
    "aiVideo.refImageSubFirst": "\u9996\u5E27\u56FE\u751F\u89C6\u9891",
    "aiVideo.refImageNone": "\u4E0D\u4F7F\u7528",
    "aiVideo.refImageHint": "\u53C2\u8003\u56FE\u4F1A\u6309\u753B\u5E03\u5C3A\u5BF8\u9884\u5904\u7406\uFF1B\u9996\u5E27 / \u5C3E\u5E27\u6A21\u5F0F\u4ECD\u9700\u8981\u63D0\u793A\u8BCD\u63CF\u8FF0\u955C\u5934\u4E0E\u52A8\u4F5C\u3002",
    "aiVideo.firstFrame": "\u9996\u5E27",
    "aiVideo.lastFrame": "\u5C3E\u5E27",
    "aiVideo.lastFrameNeedsFirst": "\u5C3E\u5E27\u9700\u8981\u5148\u9009\u9996\u5E27\u3002",
    "aiVideo.importImage": "\u5BFC\u5165\u56FE\u7247",
    "aiVideo.noImageAssets": "\u7D20\u6750\u5E93\u91CC\u8FD8\u6CA1\u6709\u56FE\u7247\uFF0C\u5148\u5BFC\u5165\u4E00\u5F20\u3002",
    "aiVideo.refConditions": "\u53C2\u8003\u6761\u4EF6\uFF08Ref2VA\uFF09",
    "aiVideo.refConditionsSub": "\u53C2\u8003\u56FE\u9501\u89D2\u8272\uFF0C\u53C2\u8003\u97F3\u9891\u9501\u58F0\u97F3\uFF1B\u53EF\u591A\u6761",
    "aiVideo.refImages": "\u53C2\u8003\u56FE",
    "aiVideo.addRefImage": "\u6DFB\u52A0\u53C2\u8003\u56FE",
    "aiVideo.refAudios": "\u53C2\u8003\u97F3\u9891",
    "aiVideo.addRefAudio": "\u6DFB\u52A0\u53C2\u8003\u97F3\u9891",
    "aiVideo.noRefImages": "\u8FD8\u6CA1\u6709\u53C2\u8003\u56FE\uFF1B\u5148\u4ECE\u7D20\u6750\u5E93\u6DFB\u52A0\uFF0C\u6216\u5BFC\u5165\u4E00\u5F20\u3002",
    "aiVideo.noRefAudios": "\u8FD8\u6CA1\u6709\u53C2\u8003\u97F3\u9891\uFF1B\u5148\u4ECE\u7D20\u6750\u5E93\u6DFB\u52A0\uFF0C\u6216\u5BFC\u5165\u4E00\u6BB5\u3002",
    "aiVideo.importAudio": "\u5BFC\u5165\u97F3\u9891",
    "aiVideo.refConditionsHint": "\u53C2\u8003\u56FE\u6309\u5217\u8868\u987A\u5E8F\u5BF9\u5E94\u63D0\u793A\u8BCD\u91CC\u7684 <Picture 1>\u3001<Picture 2>\uFF1B\u53C2\u8003\u97F3\u9891\u4F1A\u7EDF\u4E00\u8F6C\u6210 32 kHz \u7ACB\u4F53\u58F0 WAV\u3002",
    "aiVideo.duration": "\u65F6\u957F",
    "aiVideo.seconds": "{value} \u79D2",
    "aiVideo.frames": "{frames} \u5E27 \xB7 \u5B9E\u9645 {seconds}s\uFF08{grid}\uFF09",
    "aiVideo.grid": "\u5E27\u6570\u7F51\u683C {step}k+{offset}",
    "aiVideo.framesUnit": "\u5E27",
    "aiVideo.steps": "\u91C7\u6837\u6B65\u6570",
    "aiVideo.steps4": "4 \u6B65 \xB7 \u6700\u5FEB",
    "aiVideo.steps6": "6 \u6B65 \xB7 \u63A8\u8350",
    "aiVideo.steps8": "8 \u6B65 \xB7 \u66F4\u7EC6",
    "aiVideo.steps10": "10 \u6B65 \xB7 \u53CC\u4E13\u5BB6",
    "aiVideo.steps20": "20 \u6B65 \xB7 \u6700\u6162",
    "aiVideo.stepsHint": "H3 Turbo 4 \u6B65\u6700\u5FEB\uFF1BWan / LTX / Hunyuan \u5B98\u65B9\u5EFA\u8BAE 20 \u6B65\u5DE6\u53F3\uFF0C\u6B65\u6570\u592A\u5C11\u753B\u9762\u4F1A\u7CCA\u3002",
    "aiVideo.advanced": "\u8FDB\u9636\u53C2\u6570",
    "aiVideo.seed": "\u79CD\u5B50",
    "aiVideo.cfg": "CFG",
    "aiVideo.flowShift": "Flow shift",
    "aiVideo.offload": "\u6743\u91CD\u653E\u5185\u5B58",
    "aiVideo.vaeTiling": "VAE \u5206\u5757",
    "aiVideo.generate": "\u751F\u6210",
    "aiVideo.stop": "\u505C\u6B62",
    "aiVideo.elapsed": "\u751F\u6210\u4E2D\u2026\u5DF2 {seconds} \u79D2",
    "aiVideo.done": "\u5DF2\u751F\u6210\u5E76\u52A0\u5165\u65F6\u95F4\u7EBF",
    "aiVideo.addFailed": "\u52A0\u5165\u65F6\u95F4\u7EBF\u5931\u8D25\uFF1A{error}",
    "aiVideo.result": "\u751F\u6210\u7ED3\u679C",
    "aiVideo.addToTimeline": "\u518D\u6B21\u52A0\u5165\u65F6\u95F4\u7EBF",
    "aiVideo.needPrompt": "\u5148\u5199\u63D0\u793A\u8BCD",
    "aiVideo.vramWarning": "16 GB \u663E\u5B58\u5EFA\u8BAE \u2264175 \u5E27\uFF08\u7EA6 7.3 \u79D2\uFF09\uFF1B10 \u79D2\u5355\u6BB5\u5927\u6982\u7387 OOM\uFF0C\u5EFA\u8BAE\u5206\u4E24\u6BB5\u751F\u6210\u3002",
    "aiVideo.vram720Warning": "720p \u5728 16 GB \u4E0A\u5EFA\u8BAE \u226473 \u5E27\uFF08\u7EA6 3 \u79D2\uFF09\u3002",
    "aiVideo.chunkWarning": "{frames} \u5E27\uFF08\u7EA6 {seconds} \u79D2\uFF09\u5DF2\u7ECF\u662F\u8FD9\u4E2A\u6A21\u578B\u7684\u5355\u6BB5\u5EFA\u8BAE\u4E0A\u9650\uFF0C\u66F4\u957F\u5EFA\u8BAE\u5206\u6BB5\u751F\u6210\u518D\u62FC\u3002",
    "aiVideo.clampedWarning": "\u8FD9\u4E2A\u6A21\u578B\u5355\u6BB5\u6700\u591A {frames} \u5E27\uFF08\u7EA6 {seconds} \u79D2\uFF09\uFF0C\u8D85\u51FA\u90E8\u5206\u5DF2\u81EA\u52A8\u622A\u77ED\u3002",
    "aiImage.drawTitle": "AI \u753B\u56FE",
    "aiImage.editTitle": "\u56FE\u50CF\u7F16\u8F91",
    "aiImage.configure": "\u914D\u7F6E\u751F\u6210\u670D\u52A1\u2026",
    "aiImage.configureHint": "\u6587\u751F\u56FE\u3001\u56FE\u751F\u56FE\u3001\u89C6\u9891\u751F\u6210\u7684 API \u90FD\u5728\u8BBE\u7F6E\u91CC\u914D\u7F6E",
    "aiImage.groupLocal": "\u672C\u5730\u6A21\u578B",
    "aiImage.groupCloud": "\u4E91\u7AEF\u670D\u52A1",
    "aiImage.cloudHint": "\u4E91\u7AEF\u751F\u6210\uFF1A\u6309\u670D\u52A1\u5546\u8BA1\u8D39\uFF0C\u91C7\u6837\u53C2\u6570\u4E0E\u6A21\u578B\u90FD\u7531\u670D\u52A1\u51B3\u5B9A",
    "aiImage.cloudEditHint": "\u4E91\u7AEF\u6539\u56FE\u76F4\u63A5\u6309\u63D0\u793A\u8BCD\u6574\u56FE\u91CD\u7ED8\uFF1BOpenAI \u7684\u7F16\u8F91\u63A5\u53E3\u8FD8\u652F\u6301\u6D82\u62B9\u533A\u57DF\u3002",
    "aiImage.trackDraw": "AI \u753B\u56FE",
    "aiImage.trackEdit": "AI \u6539\u56FE",
    "aiImage.modelHint.sd15": "SD 1.5 \u91CD\u7ED8\uFF1A\u6E05\u5355\u91CC\u6700\u8F7B\u7684\u4E00\u6863\uFF0C\u5355\u6587\u4EF6\u7EA6 4.3 GB\uFF0C512p \u5728 CPU / \u6838\u663E\u4E0A\u4E5F\u80FD\u8DD1\uFF1B\u771F\u6B63\u7684 inpainting \u6743\u91CD\uFF0C\u53EA\u7528\u4E8E mask \u5C40\u90E8\u91CD\u7ED8\uFF0C\u4E0D\u53C2\u4E0E\u6587\u751F\u56FE\u3002",
    "aiImage.modelHint.sdxl": "SDXL Base 1.0\uFF1A\u5355\u6587\u4EF6\u7EA6 6.9 GB\uFF0C1024p \u901A\u7528\u753B\u8D28\uFF1B\u6CA1\u6709\u4E13\u95E8\u7684 inpainting UNet\uFF0C\u4F46 mask \u6F5C\u7A7A\u95F4\u6DF7\u5408\u4ECD\u7136\u80FD\u5C40\u90E8\u91CD\u7ED8\u3002",
    "aiImage.modelHint.z_image_turbo": "Z-Image Turbo\uFF1A6B DiT + Qwen3-4B \u7F16\u7801\u5668\uFF0C\u7EA6 6.7 GB\uFF0C4 GB \u663E\u5B58\u53EF\u8DD1\uFF0C8 \u6B65\u51FA\u56FE\uFF1B\u753B\u56FE\u548C\u6539\u56FE\u7684\u9ED8\u8BA4\u6863\u3002",
    "aiImage.modelHint.flux1_schnell": "FLUX.1 schnell\uFF1A12B\u30014 \u6B65\u3001\u7EA6 12.4 GB\uFF1B\u63D0\u793A\u8BCD\u8DDF\u968F\u597D\uFF0C\u9002\u5408\u5FEB\u901F\u51FA\u8349\u56FE\u3002",
    "aiImage.modelHint.flux1_kontext": "FLUX.1 Kontext\uFF1A\u6307\u4EE4\u5F0F\u6574\u56FE\u6539\u56FE\uFF08\u4E0D\u9700\u8981 mask\uFF09\uFF0C\u7EA6 12.4 GB\uFF1B\u300C\u628A A \u6539\u6210 B\u300D\u8FD9\u79CD\u4E00\u53E5\u8BDD\u7F16\u8F91\u6700\u987A\u624B\u3002",
    "aiImage.modelHint.qwen_image": "Qwen-Image\uFF1A20B\uFF0C\u4E2D\u6587\u548C\u957F\u6587\u5B57\u6E32\u67D3\u6700\u5F3A\uFF0C\u6574\u5305\u7EA6 18 GB\uFF1B16 GB \u663E\u5B58\u5EFA\u8BAE\u5F00\u300C\u6743\u91CD\u653E\u5185\u5B58\u300D\u3002",
    "aiImage.modelHint.qwen_image_edit": "Qwen-Image-Edit 2509\uFF1A\u4E2D\u82F1\u6587\u6307\u4EE4\u6539\u56FE\uFF0C\u6574\u5305\u7EA6 18.9 GB\uFF1B\u6D82\u62B9 mask \u65F6\u4F1A\u989D\u5916\u6309\u5C40\u90E8\u91CD\u7ED8\u5904\u7406\u3002",
    "aiImage.noModel": "\u6E05\u5355\u91CC\u8FD8\u6CA1\u6709\u56FE\u50CF\u751F\u6210\u6A21\u578B",
    "aiImage.noEditModel": "\u6E05\u5355\u91CC\u8FD8\u6CA1\u6709\u56FE\u50CF\u7F16\u8F91\u6A21\u578B",
    "aiImage.downloadModelTitle": "\u4E0B\u8F7D\u56FE\u50CF\u6A21\u578B",
    "aiImage.downloadModelBody": "\u9700\u8981\u4E0B\u8F7D {name}\uFF08{size}\uFF09\u3002\u4E0B\u8F7D\u5B8C\u6210\u540E\u53EF\u4EE5\u5728\u672C\u9875\u76F4\u63A5\u5F00\u59CB\u751F\u6210\u3002",
    "aiImage.prompt": "\u63D0\u793A\u8BCD",
    "aiImage.promptPlaceholder": "\u63CF\u8FF0\u753B\u9762\u3001\u98CE\u683C\u3001\u5149\u7EBF\u548C\u6784\u56FE\uFF1B\u5199\u6E05\u4E3B\u4F53\u548C\u955C\u5934\u3002",
    "aiImage.promptPlaceholderEdit": "\u63CF\u8FF0\u8981\u6539\u4EC0\u4E48\uFF0C\u4F8B\u5982\u300C\u628A\u80CC\u666F\u6362\u6210\u591C\u665A\u7684\u4E1C\u4EAC\u8857\u5934\u300D\u300C\u7ED9\u4EBA\u7269\u52A0\u4E00\u9876\u7EA2\u8272\u5E3D\u5B50\u300D\u3002",
    "aiImage.negativePlaceholder": "\u8D1F\u5411\u63D0\u793A\u8BCD\uFF08\u53EF\u9009\uFF09\uFF1A\u6A21\u7CCA\u3001\u591A\u624B\u6307\u3001\u4F4E\u8D28\u91CF\u2026",
    "aiImage.resolution": "\u5206\u8FA8\u7387",
    "aiImage.steps": "\u91C7\u6837\u6B65\u6570",
    "aiImage.strength": "\u91CD\u7ED8\u5F3A\u5EA6",
    "aiImage.strengthHint": "\u5F3A\u5EA6\u8D8A\u9AD8\u6539\u52A8\u8D8A\u5927\uFF1A0.35 \u5DE6\u53F3\u63A5\u8FD1\u6DA6\u8272\uFF0C0.7 \u4EE5\u4E0A\u4F1A\u91CD\u753B\u6D82\u62B9\u533A\u57DF\u3002",
    "aiImage.maskBrush": "\u753B\u7B14",
    "aiImage.maskErase": "\u6A61\u76AE",
    "aiImage.maskUndo": "\u64A4\u9500",
    "aiImage.maskClear": "\u6E05\u7A7A",
    "aiImage.maskHint": "\u767D\u8272\u8986\u76D6\u7684\u533A\u57DF\u4F1A\u88AB\u91CD\u7ED8\uFF0C\u5176\u4F59\u90E8\u5206\u4FDD\u6301\u4E0D\u53D8\u3002",
    "aiImage.maskEmpty": "\u8FD8\u6CA1\u6709\u6D82\u62B9\uFF1A\u6574\u5F20\u56FE\u4F1A\u6309\u91CD\u7ED8\u5F3A\u5EA6\u91CD\u65B0\u751F\u6210\uFF1B\u60F3\u53EA\u6539\u5C40\u90E8\u5C31\u5148\u6D82\u767D\u3002",
    "aiImage.refEditHint": "\u8FD9\u4E2A\u6A21\u578B\u6309\u6574\u56FE\u53C2\u8003\u7F16\u8F91\uFF1A\u4E0D\u6D82 mask \u65F6\u76F4\u63A5\u6309\u63D0\u793A\u8BCD\u6539\u6574\u5F20\u56FE\u3002",
    "aiImage.refEditMaskHint": "\u5DF2\u6D82\u62B9\u5C40\u90E8\u533A\u57DF\uFF1A\u4F1A\u540C\u65F6\u6309\u53C2\u8003\u56FE\u548C mask \u505A\u5C40\u90E8\u91CD\u7ED8\u3002",
    "aiImage.maskLoading": "\u6B63\u5728\u51C6\u5907\u753B\u5E03\u2026",
    "aiImage.source": "\u539F\u56FE\uFF08\u7D20\u6750\u5E93\uFF09",
    "aiImage.runtime": "\u8FD0\u884C\u73AF\u5883",
    "aiImage.noSource": "\u8FD8\u6CA1\u6709\u9009\u62E9\u56FE\u7247",
    "aiImage.importImage": "\u5BFC\u5165\u56FE\u7247",
    "aiImage.noImageAssets": "\u7D20\u6750\u5E93\u91CC\u8FD8\u6CA1\u6709\u56FE\u7247\uFF0C\u5148\u5BFC\u5165\u4E00\u5F20\u3002",
    "aiImage.sizeHint": "\u8F93\u51FA\u5C3A\u5BF8 {width} \xD7 {height}\uFF08\u81EA\u52A8\u5BF9\u9F50\u5230\u6A21\u578B\u8981\u6C42\uFF09",
    "aiImage.generate": "\u751F\u6210",
    "aiImage.stop": "\u505C\u6B62",
    "aiImage.elapsed": "\u751F\u6210\u4E2D\u2026\u5DF2 {seconds} \u79D2",
    "aiImage.done": "\u5DF2\u751F\u6210\u5E76\u63D2\u5165\u6700\u4E0A\u5C42\u8F68\u9053",
    "aiImage.addFailed": "\u52A0\u5165\u65F6\u95F4\u7EBF\u5931\u8D25\uFF1A{error}",
    "aiImage.result": "\u751F\u6210\u7ED3\u679C",
    "aiImage.insertedTop": "\u5DF2\u63D2\u5165\u6700\u4E0A\u5C42\u7684\u65B0\u8F68\u9053",
    "aiImage.needPrompt": "\u5148\u5199\u63D0\u793A\u8BCD",
    "aiImage.needSource": "\u5148\u5728\u7D20\u6750\u5E93\u91CC\u9009\u62E9\u4E00\u5F20\u56FE\u7247",
    "aiImage.vramHint": "\u663E\u5B58\u4E0D\u591F\u65F6\u5F00\u300C\u6743\u91CD\u653E\u5185\u5B58\u300D\uFF1B20B \u7EA7\u6A21\u578B\u5728 16 GB \u663E\u5B58\u4E0A\u5EFA\u8BAE 1024p \u4EE5\u5185\u3002",
    "sdcpp.cpu": "CPU",
    "sdcpp.cpu.note": "\u7EAF CPU\uFF0C\u6700\u6162\u4F46\u4EFB\u4F55\u673A\u5668\u90FD\u80FD\u8DD1\u3002",
    "sdcpp.cpuMac.note": "\u5F3A\u5236 CPU\uFF08\u590D\u7528 Metal \u5F15\u64CE\uFF0C\u4E0D\u989D\u5916\u4E0B\u8F7D\uFF09\u3002",
    "sdcpp.vulkan": "Vulkan",
    "sdcpp.vulkan.note": "Vulkan \u663E\u5361\u52A0\u901F\uFF0CAMD / Intel / NVIDIA \u901A\u7528\u3002",
    "sdcpp.cuda12": "CUDA 12",
    "sdcpp.cuda12.note": "NVIDIA \u52A0\u901F\uFF1B\u5305\u5185\u81EA\u5E26 CUDA 12\u3002",
    "sdcpp.rocm": "ROCm",
    "sdcpp.rocm.note": "AMD \u52A0\u901F\uFF1BLinux \u9700\u81EA\u88C5 ROCm\u3002",
    "sdcpp.metal": "Metal",
    "sdcpp.metal.note": "Apple Silicon GPU \u52A0\u901F\u3002",
    "sdcpp.installed": "\u5DF2\u5B89\u88C5",
    "sdcpp.downloadSize": "\u9700\u4E0B\u8F7D {size}",
    "sdcpp.current": "\u5F53\u524D",
    "sdcpp.group": "sd.cpp \u751F\u6210\u5F15\u64CE",
    "sdcpp.groupHint": "\u56FE\u50CF / \u89C6\u9891\u751F\u6210\u5171\u7528\uFF1B\u4E0E ONNX Runtime \u5206\u5F00\u4E0B\u8F7D\u3002",
    "videoAi.section": "\u753B\u9762",
    "videoAi.upscale": "AI \u8D85\u5206",
    "videoAi.interpolate": "AI \u89C6\u9891\u8865\u5E27",
    "videoAi.crop": "AI \u667A\u80FD\u88C1\u526A",
    "videoAi.track": "AI \u955C\u5934\u8FFD\u8E2A",
    "videoAi.model": "\u6A21\u578B",
    "videoAi.scale": "\u653E\u5927\u500D\u6570",
    "videoAi.factor": "\u8865\u5E27\u500D\u6570",
    "videoAi.subject": "\u8DDF\u8E2A\u5BF9\u8C61",
    "videoAi.aspect": "\u8F93\u51FA\u6BD4\u4F8B",
    "videoAi.height": "\u8F93\u51FA\u9AD8\u5EA6",
    "videoAi.smooth": "\u5E73\u6ED1",
    "videoAi.subjectFace": "\u4EBA\u8138",
    "videoAi.subjectPerson": "\u4EBA\u7269",
    "videoAi.subjectAuto": "\u81EA\u52A8\uFF08\u4EBA\u8138\u4F18\u5148\uFF09",
    "videoAi.subjectCenter": "\u5C45\u4E2D",
    "videoAi.aspectSource": "\u539F\u59CB\u6BD4\u4F8B",
    "videoAi.smoothLow": "\u5F31",
    "videoAi.smoothMedium": "\u4E2D",
    "videoAi.smoothHigh": "\u5F3A",
    "videoAi.apply": "\u5E94\u7528",
    "videoAi.source": "\u5F53\u524D\u7247\u6BB5\uFF1A{name}",
    "videoAi.selectClip": "\u5148\u5728\u65F6\u95F4\u7EBF\u9009\u4E2D\u4E00\u4E2A\u89C6\u9891\u7247\u6BB5",
    "videoAi.selectVisual": "\u5148\u5728\u65F6\u95F4\u7EBF\u9009\u4E2D\u4E00\u4E2A\u89C6\u9891\u6216\u56FE\u7247\u7247\u6BB5",
    "videoAi.downloadModel": "\u4E0B\u8F7D\u6A21\u578B\uFF08{size}\uFF09",
    "videoAi.noModel": "\u7F3A\u5C11\u53EF\u7528\u7684\u89C6\u9891\u6A21\u578B",
    "videoAi.done": "{name}\u5B8C\u6210",
    "videoAi.failed": "\u89C6\u9891 AI \u5931\u8D25\uFF1A{error}",
    "videoAi.cancelled": "\u5DF2\u53D6\u6D88",
    "videoAi.upscaleHint": "2x \u66F4\u5FEB\uFF0C4x \u7EC6\u8282\u66F4\u591A\uFF1B\u5BFC\u51FA\u4F1A\u6309\u5DE5\u7A0B\u8F93\u51FA\u5C3A\u5BF8\u7F29\u653E\u3002",
    "videoAi.interpolateHint": "\u8865\u5E27\u540E\u8BF7\u628A\u5DE5\u7A0B\u8F93\u51FA\u5E27\u7387\u8BBE\u4E3A 60 / 120\uFF0C\u5426\u5219\u5BFC\u51FA\u4F1A\u6309\u5DE5\u7A0B\u5E27\u7387\u4E22\u5E27\u3002",
    "videoAi.cropHint": "\u4EBA\u8138\u4F18\u5148\uFF0C\u81EA\u52A8\u628A\u4E3B\u4F53\u653E\u8FDB\u7AD6\u5C4F / \u65B9\u5C4F\u753B\u5E45\uFF1B\u5BFC\u51FA\u524D\u8BF7\u628A\u5DE5\u7A0B\u5C3A\u5BF8\u6539\u6210\u76EE\u6807\u6BD4\u4F8B\u3002",
    "videoAi.trackHint": "\u4EBA\u7269\u4F18\u5148\uFF0C\u9002\u5408\u8BBF\u8C08\u3001\u8FD0\u52A8\u955C\u5934\uFF1B\u5E73\u6ED1\u8D8A\u9AD8\uFF0C\u955C\u5934\u8D8A\u7A33\u3002",
    "ai.modelReady": "\u6A21\u578B\u5DF2\u5C31\u7EEA",
    "ai.modelMissing": "\u672A\u4E0B\u8F7D\u6A21\u578B",
    "ai.modelNeedsDownload": "\u9700\u4E0B\u8F7D \xB7 {size}",
    "ai.subtitles": "\u4E00\u952E\u751F\u6210\u5B57\u5E55",
    "ai.subtitleHint": "\u81EA\u52A8\u8F6C\u5199\u5F53\u524D\u7D20\u6750\uFF0C\u751F\u6210\u4E00\u6761\u53EF\u7F16\u8F91\u7684\u5B57\u5E55\u8F68\u9053",
    "ai.subtitleSource": "\u8F6C\u5199\u7D20\u6750\uFF1A{name}",
    "ai.subtitleNoSource": "\u5148\u5728\u65F6\u95F4\u7EBF\u9009\u4E2D\u4E00\u4E2A\u97F3\u9891 / \u89C6\u9891\u7247\u6BB5",
    "ai.subtitleNoModel": "\u6CA1\u6709\u53EF\u7528\u7684\u8BED\u97F3\u8BC6\u522B\u6A21\u578B\uFF0C\u8BF7\u5148\u5728\u4E0B\u8F7D\u7BA1\u7406\u5668\u5B89\u88C5",
    "ai.asrBusy": "\u6B63\u5728\u5904\u7406\u53E6\u4E00\u9879\u8BED\u97F3\u4EFB\u52A1\uFF0C\u8BF7\u7A0D\u5019",
    "ai.subtitleModel": "\u8BC6\u522B\u6A21\u578B",
    "ai.subtitleGenerate": "\u751F\u6210\u5B57\u5E55",
    "ai.subtitleDownloadModel": "\u4E0B\u8F7D\u6A21\u578B \xB7 {size}",
    "ai.subtitleTrack": "\u5B57\u5E55",
    "ai.subtitleDone": "\u5DF2\u751F\u6210 {count} \u6761\u5B57\u5E55",
    "ai.subtitleEmpty": "\u6CA1\u6709\u68C0\u6D4B\u5230\u8BED\u97F3",
    "ai.subtitleFailed": "\u751F\u6210\u5B57\u5E55\u5931\u8D25\uFF1A{error}",
    "ai.subtitleCancelled": "\u5DF2\u53D6\u6D88\u5B57\u5E55\u751F\u6210",
    "ai.subtitleDownloadingModel": "\u6B63\u5728\u4ECE {source} \u4E0B\u8F7D\u6A21\u578B",
    "ai.manageModels": "\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668",
    "ai.voiceover": "AI \u6717\u8BFB",
    "ai.voiceDownload": "\u4E0B\u8F7D\u6A21\u578B",
    "ai.voiceChange": "AI \u53D8\u58F0",
    "ai.voiceSave": "\u5B58\u4E3A\u97F3\u8272",
    "ai.voiceImportTitle": "\u5BFC\u5165\u97F3\u8272",
    "ai.voiceSource": "\u53C2\u8003\u97F3\u9891",
    "ai.voiceName": "\u97F3\u8272\u540D\u79F0",
    "ai.voiceUseSelection": "\u7528\u9009\u4E2D\u7247\u6BB5",
    "ai.voiceDelete": "\u5220\u9664",
    "ai.voiceConfirmDelete": "\u5220\u9664\u97F3\u8272\u300C{name}\u300D\uFF1F",
    "ai.voiceNeedRuntime": "\u53D8\u58F0\u9700\u8981\u5148\u4E0B\u8F7D\u672C\u5730\u8FD0\u884C\u65F6",
    "ai.voiceImportHint": "\u4F1A\u81EA\u52A8\u4ECE\u97F3\u9891\u91CC\u622A\u53D6\u4E00\u6BB5\u6709\u58F0\u7684 10 \u79D2\u505A\u53C2\u8003\u3002",
    "ai.voiceLibraryEmpty": "\u8FD8\u6CA1\u6709\u97F3\u8272\u3002\u53EF\u4EE5\u4ECE\u5A92\u4F53\u5E93\u5BFC\u5165\uFF0C\u6216\u7528\u65F6\u95F4\u7EBF\u91CC\u9009\u4E2D\u7684\u7247\u6BB5\u3002",
    "ai.voiceChangeTrack": "AI \u53D8\u58F0",
    "ai.voiceChangeRun": "\u5F00\u59CB\u53D8\u58F0",
    "ai.voiceLibrary": "\u97F3\u8272\u5E93",
    "ai.voiceFromMedia": "\u4ECE\u5A92\u4F53\u5E93\u9009\u2026",
    "ai.voiceImported": "\u5DF2\u5BFC\u5165\u97F3\u8272\u300C{name}\u300D",
    "ai.voiceTooShort": "\u53C2\u8003\u97F3\u9891\u592A\u77ED\uFF0C\u81F3\u5C11\u9700\u8981 3 \u79D2\u6709\u58F0\u5185\u5BB9",
    "ai.voiceNoAudio": "\u8FD9\u6BB5\u7D20\u6750\u6CA1\u6709\u97F3\u9891",
    "ai.voiceNoVoice": "\u5148\u9009\u4E00\u4E2A\u97F3\u8272\uFF0C\u518D\u5F00\u59CB\u53D8\u58F0",
    "ai.voicePickClips": "\u5F85\u5904\u7406\u7247\u6BB5",
    "ai.voiceModel": "\u53D8\u58F0\u6A21\u578B",
    "ai.voiceEncoding": "\u9700\u8981\u5148\u4E0B\u8F7D\u53D8\u58F0\u6A21\u578B",
    "ai.voiceEmpty": "\u5148\u5728\u65F6\u95F4\u7EBF\u9009\u4E2D\u8981\u53D8\u58F0\u7684\u7247\u6BB5",
    "ai.voiceoverHint": "\u628A\u9009\u4E2D\u7684\u6587\u5B57\u7247\u6BB5\u8F6C\u6210\u8BED\u97F3\uFF0C\u6309\u539F\u65F6\u95F4\u5BF9\u9F50\uFF1B\u97F3\u9891\u91CD\u53E0\u65F6\u81EA\u52A8\u5206\u8F68",
    "ai.voiceoverModel": "\u6717\u8BFB\u6A21\u578B",
    "ai.voiceoverVoice": "\u97F3\u8272\u6765\u6E90",
    "ai.voiceoverTimbre": "\u97F3\u8272",
    "ai.voiceoverVoiceBuiltin": "\u9ED8\u8BA4\u97F3\u8272",
    "ai.voiceoverVoiceReference": "\u5A92\u4F53\u5E93\u53C2\u8003",
    "ai.ttsSettings": "\u914D\u7F6E TTS \u670D\u52A1\u2026",
    "ai.ttsSettingsHint": "\u6DFB\u52A0\u4EFB\u610F\u4F9B\u5E94\u5546\u7684 TTS API\uFF0C\u4E5F\u652F\u6301\u81EA\u5B9A\u4E49\u63A5\u53E3",
    "ai.voiceoverLocal": "\u672C\u5730\u6A21\u578B",
    "ai.voiceoverCloud": "\u4E91\u7AEF\u670D\u52A1",
    "ai.voiceoverCloudVoice": "\u97F3\u8272 {voice}",
    "ai.voiceoverCloudHint": "\u5DF2\u914D\u7F6E\u7684\u4E91\u7AEF TTS \u670D\u52A1",
    "ai.voiceoverCloudNote": "\u4E91\u7AEF\u5408\u6210 \xB7 {name} \xB7 {voice}",
    "ai.voiceoverCloudNoteNoVoice": "\u4E91\u7AEF\u5408\u6210 \xB7 {name}",
    "ai.voiceoverReference": "\u53C2\u8003\u97F3\u9891",
    "ai.voiceoverReferenceMissing": "\u8BF7\u5148\u5728\u5A92\u4F53\u5E93\u9009\u62E9\u4E00\u6BB5\u5E26\u58F0\u97F3\u7684\u7D20\u6750",
    "ai.voiceoverReferenceEmpty": "\u5A92\u4F53\u5E93\u91CC\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u97F3\u9891\uFF0C\u8BF7\u5148\u5728\u5A92\u4F53\u5E93\u5BFC\u5165\u8981\u6A21\u4EFF\u7684\u97F3\u9891",
    "ai.voiceoverReferenceText": "\u53C2\u8003\u6587\u672C",
    "ai.voiceoverReferenceTextPlaceholder": "\u53C2\u8003\u97F3\u9891\u91CC\u8BF4\u7684\u539F\u8BDD",
    "ai.voiceoverReferenceTextHint": "ZipVoice \u9700\u8981\u4E0E\u53C2\u8003\u97F3\u9891\u4E00\u81F4\u7684\u6587\u672C\uFF1B\u53EF\u624B\u52A8\u586B\u5199\u6216\u81EA\u52A8\u8BC6\u522B",
    "ai.voiceoverReferenceTextNoAsr": "\u672A\u5B89\u88C5\u8BED\u97F3\u8BC6\u522B\u6A21\u578B\uFF1A\u53EF\u624B\u52A8\u586B\u5199\uFF0C\u6216\u5230\u4E0B\u8F7D\u7BA1\u7406\u5668\u5B89\u88C5\u540E\u81EA\u52A8\u8BC6\u522B",
    "ai.voiceoverReferenceTextMissing": "\u8BF7\u5148\u586B\u5199\u53C2\u8003\u97F3\u9891\u7684\u6587\u672C\uFF0C\u6216\u70B9\u51FB\u81EA\u52A8\u8BC6\u522B",
    "ai.voiceoverTranscribe": "\u81EA\u52A8\u8BC6\u522B",
    "ai.voiceoverTranscribing": "\u8BC6\u522B\u4E2D\u2026",
    "ai.voiceoverTranscribeFailed": "\u53C2\u8003\u97F3\u9891\u8BC6\u522B\u5931\u8D25\uFF1A{error}",
    "ai.voiceoverGenerate": "\u751F\u6210\u6717\u8BFB",
    "ai.voiceoverDownloadModel": "\u4E0B\u8F7D\u6A21\u578B \xB7 {size}",
    "ai.voiceoverDownloadingModel": "\u6B63\u5728\u4ECE {source} \u4E0B\u8F7D\u6717\u8BFB\u6A21\u578B",
    "ai.voiceoverSelected": "\u5DF2\u9009\u4E2D {count} \u6BB5\u6587\u5B57",
    "ai.voiceoverNoText": "\u5148\u9009\u4E2D\u4E00\u6BB5\u6216\u591A\u6BB5\u6587\u5B57\u7247\u6BB5",
    "ai.voiceoverNoModel": "\u5148\u9009\u62E9\u4E00\u4E2A\u6717\u8BFB\u6A21\u578B\u6216\u914D\u7F6E\u4E91\u7AEF TTS \u670D\u52A1",
    "ai.voiceoverTrack": "\u6717\u8BFB",
    "ai.voiceoverDone": "\u5DF2\u751F\u6210 {count} \u6BB5\u6717\u8BFB",
    "ai.voiceoverFailed": "\u751F\u6210\u6717\u8BFB\u5931\u8D25\uFF1A{error}",
    "ai.voiceoverCancelled": "\u5DF2\u53D6\u6D88\u6717\u8BFB\u751F\u6210",
    "ai.voiceName.junhao": "\u4FCA\u8C6A",
    "ai.voiceName.zhiming": "\u5FD7\u660E \xB7 \u4EAC\u5473",
    "ai.voiceName.weiguo": "\u536B\u56FD \xB7 \u8BF4\u4E66",
    "ai.voiceName.xiaoyu": "\u5C0F\u96E8 \xB7 \u660E\u661F",
    "ai.voiceName.yuewen": "\u6708\u96EF \xB7 \u673A\u8F66",
    "ai.voiceName.lingyu": "\u51CC\u96E8 \xB7 \u6DF1\u591C\u7535\u53F0",
    "ai.voiceName.leijun": "Leijun\uFF08\u9ED8\u8BA4\uFF09",
    "ai.voiceGroup.chinese-male": "\u4E2D\u6587\u7537\u58F0",
    "ai.voiceGroup.chinese-female": "\u4E2D\u6587\u5973\u58F0",
    "ai.voiceGroup.english-male": "\u82F1\u6587\u7537\u58F0",
    "ai.voiceGroup.english-female": "\u82F1\u6587\u5973\u58F0",
    "ai.voiceGroup.japanese-male": "\u65E5\u6587\u7537\u58F0",
    "ai.voiceGroup.japanese-female": "\u65E5\u6587\u5973\u58F0",
    "ai.voiceGroup.korean-male": "\u97E9\u6587\u7537\u58F0",
    "ai.voiceGroup.korean-female": "\u97E9\u6587\u5973\u58F0",
    "ai.voiceGroup.other": "\u5176\u4ED6\u97F3\u8272",
    // ---- 下载管理器 ----
    "models.title": "\u4E0B\u8F7D\u7BA1\u7406\u5668",
    "models.tab.models": "\u6A21\u578B",
    "models.tab.plugins": "\u63D2\u4EF6",
    "models.tab.installed": "\u5DF2\u5B89\u88C5",
    "models.tab.available": "\u53EF\u4E0B\u8F7D",
    "models.subCounts": "{installed} \u5DF2\u5B89\u88C5 \xB7 {available} \u53EF\u4E0B\u8F7D",
    "models.searchPlaceholder": "\u641C\u7D22\u63D2\u4EF6\u3001\u6A21\u578B\u3001\u8FD0\u884C\u65F6\u2026",
    "models.kindFilter": "\u7C7B\u578B\u7B5B\u9009",
    "models.kind.all": "\u5168\u90E8",
    "models.kind.plugin": "\u63D2\u4EF6",
    "models.kind.model": "\u6A21\u578B",
    "models.kind.runtime": "\u8FD0\u884C\u65F6",
    // ---- 本地 AI 运行时 ----
    "runtime.title": "\u8FD0\u884C\u65F6",
    "runtime.hint": "CPU / DirectML / CoreML \u968F\u5305\uFF1BCUDA 12 / 13 \u6309\u9700\u4E0B\u8F7D\uFF0C\u91CD\u542F\u751F\u6548\u3002",
    "runtime.partsTitle": "CUDA \u7EC4\u4EF6",
    "runtime.empty": "\u6CA1\u6709\u9700\u8981\u4E0B\u8F7D\u7684\u8FD0\u884C\u65F6\u3002",
    "runtime.autoDownloading": "\u7F3A\u5C11 CUDA \u8FD0\u884C\u7EC4\u4EF6\uFF0C\u6B63\u5728\u81EA\u52A8\u4E0B\u8F7D\uFF08{count} \u9879\uFF09\u2026",
    "runtime.bundled": "\u968F\u5305\u5185\u7F6E",
    "runtime.installed": "\u5DF2\u5B89\u88C5",
    "runtime.notInstalled": "\u672A\u5B89\u88C5",
    "runtime.partsNote": "\u5207\u6362 CUDA \u65F6\u81EA\u52A8\u5B89\u88C5\u7F3A\u5931\u7EC4\u4EF6",
    "runtime.cuda12Parts": "CUDA 12 \u7EC4\u4EF6",
    "runtime.cuda12PartsHint": "\u5207\u6362 CUDA 12 \u65F6\u81EA\u52A8\u8865\u9F50\u7F3A\u5931\u7EC4\u4EF6\u3002",
    "runtime.cuda13Parts": "CUDA 13 \u7EC4\u4EF6",
    "runtime.cuda13PartsHint": "\u5207\u6362 CUDA 13 \u65F6\u81EA\u52A8\u8865\u9F50\u7F3A\u5931\u7EC4\u4EF6\u3002",
    "runtime.restartBody": "\u65B0\u88C5\u7684\u8FD0\u884C\u5E93 / CUDA \u7EC4\u4EF6\u4F1A\u5728\u4E0B\u6B21\u542F\u52A8\u65F6\u52A0\u8F7D\u3002",
    "runtime.restartNow": "\u7ACB\u5373\u91CD\u542F",
    "runtime.restartLater": "\u7A0D\u540E",
    "runtime.cudart": "CUDA Runtime 12 (cudart)",
    "runtime.cudart.note": "CUDA 12 \u8FD0\u884C\u65F6\u7EC4\u4EF6\u3002",
    "runtime.cublas": "cuBLAS 12",
    "runtime.cublas.note": "CUDA 12 \u77E9\u9635\u8FD0\u7B97\u5E93\u3002",
    "runtime.cufft": "cuFFT 11\uFF08CUDA 12\uFF09",
    "runtime.cufft.note": "CUDA 12 FFT \u5E93\u3002",
    "runtime.cudnn": "cuDNN 9\uFF08CUDA 12\uFF09",
    "runtime.cudnn.note": "CUDA 12 \u6DF1\u5EA6\u795E\u7ECF\u7F51\u7EDC\u5E93\u3002",
    "runtime.cudart13": "CUDA Runtime 13 (cudart)",
    "runtime.cudart13.note": "CUDA 13 \u8FD0\u884C\u65F6\u7EC4\u4EF6\u3002",
    "runtime.cublas13": "cuBLAS 13",
    "runtime.cublas13.note": "CUDA 13 \u77E9\u9635\u8FD0\u7B97\u5E93\u3002",
    "runtime.cufft13": "cuFFT 12\uFF08CUDA 13\uFF09",
    "runtime.cufft13.note": "CUDA 13 FFT \u5E93\u3002",
    "runtime.cudnn13": "cuDNN 9\uFF08CUDA 13\uFF09",
    "runtime.cudnn13.note": "CUDA 13 \u6DF1\u5EA6\u795E\u7ECF\u7F51\u7EDC\u5E93\u3002",
    "runtime.cpu": "CPU",
    "runtime.cpu.note": "\u7EAF CPU \u6784\u5EFA\uFF08\u968F\u5305\uFF0C\u5168\u5E73\u53F0\u53EF\u7528\uFF09\u3002",
    "runtime.directml": "DirectML",
    "runtime.directml.note": "Windows \u4E0A\u7684 DirectX 12 \u786C\u4EF6\u52A0\u901F\uFF08\u968F\u5305\uFF0C\u542B CPU \u56DE\u9000\uFF09\u3002",
    "runtime.coreml": "Apple CoreML",
    "runtime.coreml.note": "Apple \u795E\u7ECF\u5F15\u64CE / GPU\uFF08\u968F\u5305\uFF09\u3002",
    "runtime.cuda": "ONNX Runtime\uFF08CUDA 12\uFF09",
    "runtime.cuda.note": "NVIDIA \u8001\u5361 / \u9A71\u52A8 < 580\uFF1B\u7EC4\u4EF6\u968F\u4E0B\u8F7D\uFF0C\u65E0\u9700\u7CFB\u7EDF CUDA\u3002",
    "runtime.cuda13": "ONNX Runtime\uFF08CUDA 13\uFF09",
    "runtime.cuda13.note": "NVIDIA \u65B0\u5361 / \u9A71\u52A8 580+\uFF1B\u7EC4\u4EF6\u968F\u4E0B\u8F7D\u3002",
    "models.pluginsSub": "{count} \u4E2A\u63D2\u4EF6\u53EF\u4E0B\u8F7D\u6216\u66F4\u65B0",
    "models.subPlugins": "\u5B89\u88C5\u3001\u5BFC\u5165\u4E0E\u66F4\u65B0 OpenFX \u63D2\u4EF6",
    "models.sub": "{installed} / {total} \u4E2A\u6A21\u578B\u5DF2\u5B89\u88C5",
    "models.bundlePolicy": "\u53EA\u6709 10 MB \u4EE5\u5185\u7684\u6A21\u578B\u53EF\u4EE5\u968F\u5305\u5206\u53D1\uFF0C\u66F4\u5927\u7684\u6A21\u578B\u6309\u9700\u4E0B\u8F7D\u3002",
    "models.filter": "\u6A21\u578B\u7B5B\u9009",
    "models.filter.all": "\u5168\u90E8",
    "models.filter.installed": "\u5DF2\u5B89\u88C5",
    "models.filter.available": "\u53EF\u4E0B\u8F7D",
    "models.bundled": "\u968F\u5305",
    "models.bundleEligible": "\u226410MB",
    "models.installed": "\u5DF2\u5B89\u88C5",
    "models.recommended": "\u63A8\u8350",
    "models.license": "\u8BB8\u53EF",
    "models.licenseTier.permissive": "\u5BBD\u677E\u8BB8\u53EF",
    "models.licenseTier.community": "\u793E\u533A\u8BB8\u53EF",
    "models.licenseTier.rail": "RAIL",
    "models.licenseTier.sharealike": "\u76F8\u540C\u65B9\u5F0F\u5171\u4EAB",
    "models.licenseTier.noncommercial": "\u975E\u5546\u4E1A",
    "models.licenseTier.upstream": "\u4E0A\u6E38\u6761\u6B3E",
    "models.licenseHint.permissive": "\u5BBD\u677E\u8BB8\u53EF\uFF1A\u53EF\u5546\u7528",
    "models.licenseHint.community": "\u793E\u533A\u8BB8\u53EF\uFF1A\u53EF\u5546\u7528\uFF0C\u4F46\u6709\u95E8\u69DB\u4E0E\u9644\u52A0\u6761\u4EF6\uFF08\u7F72\u540D / \u53EF\u63A5\u53D7\u4F7F\u7528 / \u516C\u53F8\u89C4\u6A21\u6216\u8425\u6536\uFF09\uFF1B\u5546\u4E1A\u53D1\u884C\u524D\u8BF7\u6838\u5BF9\u4E0A\u6E38\u8BB8\u53EF",
    "models.licenseHint.rail": "CreativeML Open RAIL\uFF1A\u53EF\u5546\u7528\uFF0C\u4F46\u4F7F\u7528\u9650\u5236\u5FC5\u987B\u968F\u518D\u5206\u53D1\u4E00\u8D77\u4F20\u9012",
    "models.licenseHint.sharealike": "CC BY-SA\uFF1A\u53EF\u5546\u7528\uFF0C\u4F46\u6F14\u7ECE\u4F5C\u54C1\u9700\u6309\u76F8\u540C\u8BB8\u53EF\u5206\u53D1\u5E76\u7F72\u540D",
    "models.licenseHint.noncommercial": "\u4EC5\u9650\u975E\u5546\u4E1A\u4F7F\u7528\uFF1A\u6743\u91CD\u4E0D\u53EF\u7528\u4E8E\u5546\u4E1A\u7528\u9014",
    "models.licenseHint.upstream": "\u4E0A\u6E38\u672A\u63D0\u4F9B\u660E\u786E\u8BB8\u53EF\uFF1A\u5546\u7528\u524D\u8BF7\u4E0E\u4F5C\u8005\u786E\u8BA4",
    "models.licenseConfirmTitle": "\u4E0B\u8F7D\u300C{name}\u300D\uFF1F",
    "models.licenseConfirmMessage": "\u8BE5\u6A21\u578B\u6743\u91CD\u91C7\u7528\u300C{license}\u300D\u3002{note}\u3002\u4E0B\u8F7D\u524D\u8BF7\u786E\u8BA4\u4F60\u7684\u7528\u9014\u7B26\u5408\u8BE5\u8BB8\u53EF\u3002",
    "models.licenseConfirmOk": "\u4E86\u89E3\uFF0C\u4E0B\u8F7D",
    "models.fileProgress": "\u5DF2\u4E0B\u8F7D {done}/{total} \u4E2A\u6587\u4EF6",
    "models.reusableHint": "\u5176\u4E2D {size} \u53EF\u4ECE\u5DF2\u6709\u6A21\u578B\u590D\u7528\uFF0C\u4E0D\u4F1A\u91CD\u590D\u4E0B\u8F7D\u3002",
    "models.sharedHint": "\u5176\u4E2D {size} \u4E0E\u53E6\u4E00\u4E2A\u6A21\u578B\u5171\u7528\u540C\u4E00\u4EFD\u6743\u91CD\uFF08\u4F18\u5148\u786C\u94FE\u63A5\uFF1B\u4E0D\u652F\u6301\u65F6\u7528\u526F\u672C\uFF09\uFF1B\u5220\u9664\u672C\u6A21\u578B\u4E0D\u4F1A\u5F71\u54CD\u5BF9\u65B9\u3002",
    "models.download": "\u4E0B\u8F7D \xB7 {size}",
    "models.reinstall": "\u91CD\u65B0\u5B89\u88C5",
    "models.cancel": "\u53D6\u6D88",
    "models.remove": "\u5220\u9664",
    "models.confirmRemove": "\u786E\u8BA4\u5220\u9664",
    "models.reveal": "\u5728\u6587\u4EF6\u5939\u4E2D\u663E\u793A",
    "models.refresh": "\u5237\u65B0",
    "models.empty": "\u6CA1\u6709\u5339\u914D\u7684\u6A21\u578B",
    "models.feature.asr": "\u8BED\u97F3\u8BC6\u522B",
    "models.feature.vad": "\u8BED\u97F3\u68C0\u6D4B",
    "models.feature.tts": "\u8BED\u97F3\u5408\u6210",
    "models.feature.tts-codec": "\u97F3\u9891\u7F16\u7801",
    "models.feature.align": "\u5F3A\u5236\u5BF9\u9F50",
    "models.feature.enhance": "\u97F3\u9891\u964D\u566A",
    "models.feature.separate": "\u97F3\u6E90\u5206\u79BB",
    "models.feature.interpolate": "\u89C6\u9891\u8865\u5E27",
    "models.feature.superres": "\u89C6\u9891\u8D85\u5206",
    "models.feature.track": "\u76EE\u6807\u8FFD\u8E2A",
    "models.feature.reframe": "\u667A\u80FD\u88C1\u526A",
    "models.feature.video-gen": "\u89C6\u9891\u751F\u6210",
    "models.feature.image-gen": "\u56FE\u50CF\u751F\u6210",
    "models.feature.voice-change": "AI \u53D8\u58F0",
    "models.sourceSettings": "\u4E0B\u8F7D\u6E90",
    "models.sourceSettingsHint": "\u5728\u8BBE\u7F6E\u9875\u7684\u300C\u7F51\u7EDC\u300D\u91CC\u8C03\u6574\u955C\u50CF\u3001\u4E0B\u8F7D\u6E90\u533A\u57DF\u4E0E\u6A21\u578B\u955C\u50CF\u5730\u5740",
    "models.sourceLine": "\u4E0B\u8F7D\u6E90",
    "models.testSource": "\u6D4B\u8BD5\u6E90",
    "models.probing": "\u6D4B\u8BD5\u4E2D\u2026",
    "models.probeFailed": "\u4E0D\u53EF\u7528",
    "models.sources.both": "\u56FD\u5185\u5916\u53CC\u6E90",
    "models.sources.cn": "\u4EC5\u56FD\u5185\u6E90",
    "models.sources.intl": "\u4EC5\u56FD\u9645\u6E90",
    "models.source.modelscope": "\u9B54\u642D",
    "models.source.huggingface": "HuggingFace",
    "models.source.github": "GitHub",
    "models.source.mirror": "\u81EA\u5B9A\u4E49\u955C\u50CF",
    "models.source.unknown": "\u4E0B\u8F7D\u6E90",
    "models.downloadingFrom": "\u6B63\u5728\u4ECE {source} \u4E0B\u8F7D",
    // ---- OFX 插件 ----
    "plugins.title": "OFX \u63D2\u4EF6",
    "plugins.sub": "\u5DF2\u5B89\u88C5 {installed} \u4E2A \xB7 \u6CE8\u518C\u8868\u5171 {total} \u4E2A",
    "plugins.installedSub": "\u5DF2\u5B89\u88C5 {count} \u4E2A",
    "plugins.manage": "\u7BA1\u7406\u63D2\u4EF6",
    "plugins.noInstalled": "\u8FD8\u6CA1\u6709\u5B89\u88C5 OFX \u63D2\u4EF6",
    "plugins.noInstalledHint": "\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668\u5B89\u88C5\u6216\u5BFC\u5165\u63D2\u4EF6\u3002",
    "plugins.openInterface": "\u53C2\u6570",
    // ---- 参数面板 ----
    "plugins.editorTitle": "\u53C2\u6570\u754C\u9762",
    "plugins.editorNoSelection": "\u672A\u9009\u62E9\u7279\u6548",
    "plugins.editorNoSelectionHint": "\u4ECE\u68C0\u67E5\u5668\u7684\u7279\u6548\u5361\u7247\u6253\u5F00\u53C2\u6570\uFF0C\u6216\u5728\u300COFX \u63D2\u4EF6\u300D\u9762\u677F\u9009\u62E9\u63D2\u4EF6\u67E5\u770B\u9ED8\u8BA4\u53C2\u6570\u3002",
    "plugins.editorNoParams": "\u8BE5\u63D2\u4EF6\u6CA1\u6709\u58F0\u660E\u53C2\u6570\u3002",
    "plugins.editorReadonly": "\u53EA\u8BFB",
    "plugins.editorReadonlyHint": "\u5F53\u524D\u663E\u793A\u9ED8\u8BA4\u503C\u3002\u628A\u63D2\u4EF6\u6DFB\u52A0\u5230\u7247\u6BB5\u540E\u5373\u53EF\u7F16\u8F91\u53C2\u6570\u3002",
    "plugins.editorChoosePlugin": "\u9009\u62E9\u63D2\u4EF6",
    "plugins.editorOpenInspector": "\u6253\u5F00\u68C0\u67E5\u5668",
    "plugins.editorTargetMissing": "\u8BE5\u7279\u6548\u5DF2\u4E0D\u5B58\u5728\u3002",
    "plugins.editorClear": "\u6E05\u9664\u9009\u62E9",
    "plugins.editorProbeFailed": "\u8BFB\u53D6\u63D2\u4EF6\u53C2\u6570\u5931\u8D25",
    "plugins.manager.tabInstalled": "\u5DF2\u5B89\u88C5",
    "plugins.manager.tabExternal": "\u5916\u90E8",
    "plugins.manager.tabAvailable": "\u53EF\u4E0B\u8F7D",
    "plugins.manager.import": "\u5BFC\u5165\u63D2\u4EF6",
    "plugins.manager.importBundle": "\u5BFC\u5165 .ofx.bundle",
    "plugins.manager.importBundleHint": "\u9009\u62E9 .ofx.bundle \u5305\u6216\u6587\u4EF6\u5939",
    "plugins.manager.importFile": "\u5BFC\u5165 .ofx / \u5F52\u6863",
    "plugins.manager.importFileHint": "\u9009\u62E9 .ofx \u6587\u4EF6\uFF0C\u6216 zip / tar.gz \u538B\u7F29\u5305",
    "plugins.manager.imported": "\u63D2\u4EF6\u5DF2\u5BFC\u5165",
    "plugins.manager.searchInstalled": "\u641C\u7D22\u5DF2\u5B89\u88C5\u63D2\u4EF6",
    "plugins.manager.searchAvailable": "\u641C\u7D22\u63D2\u4EF6",
    "plugins.manager.typeFilter": "\u63D2\u4EF6\u7C7B\u578B",
    "plugins.manager.compatibleOnly": "\u53EA\u770B\u517C\u5BB9",
    "plugins.manager.count": "{shown} / {total}",
    "plugins.manager.externalHint": "\u7528\u6237\u81EA\u5DF1\u88C5\u5728\u6807\u51C6 OFX \u76EE\u5F55\u91CC\u7684\u63D2\u4EF6\uFF0C\u53EA\u8BFB\u3002",
    "plugins.manager.emptyInstalled": "\u8FD8\u6CA1\u6709\u672C\u5E94\u7528\u5B89\u88C5\u7684\u63D2\u4EF6",
    "plugins.manager.emptyExternal": "\u6CA1\u6709\u53D1\u73B0\u5916\u90E8 OFX \u63D2\u4EF6",
    "plugins.manager.emptyExternalHint": "\u628A\u63D2\u4EF6\u88C5\u8FDB\u6807\u51C6 OFX \u76EE\u5F55\uFF0C\u6216\u5BFC\u5165\u672C\u5730 .ofx.bundle\u3002",
    "plugins.manager.emptyAvailable": "\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6",
    "plugins.manager.emptyAvailableHint": "\u5237\u65B0\u6CE8\u518C\u8868\u6216\u8C03\u6574\u7B5B\u9009\u6761\u4EF6\u3002",
    "plugins.search": "\u641C\u7D22\u63D2\u4EF6",
    "plugins.filter": "\u63D2\u4EF6\u7B5B\u9009",
    "plugins.filter.all": "\u5168\u90E8",
    "plugins.filter.installed": "\u5DF2\u5B89\u88C5",
    "plugins.filter.available": "\u53EF\u4E0B\u8F7D",
    "plugins.filter.updates": "\u6709\u66F4\u65B0",
    "plugins.sourceLabel": "\u6CE8\u518C\u8868\u6765\u6E90",
    "plugins.source.network": "GitHub",
    "plugins.source.cache": "\u672C\u5730\u7F13\u5B58",
    "plugins.source.stale-cache": "\u79BB\u7EBF\u7F13\u5B58",
    "plugins.source.bundled": "\u5185\u7F6E\u5FEB\u7167",
    "plugins.refresh": "\u5237\u65B0\u6CE8\u518C\u8868",
    "plugins.settings": "\u6CE8\u518C\u8868\u8BBE\u7F6E",
    "plugins.importBundle": "\u5BFC\u5165 .ofx.bundle",
    "plugins.importFile": "\u5BFC\u5165 .ofx / \u5F52\u6863",
    "plugins.installed": "\u5DF2\u5B89\u88C5",
    "plugins.updateAvailable": "\u6709\u66F4\u65B0",
    "plugins.install": "\u5B89\u88C5 \xB7 {size}",
    "plugins.installNoSize": "\u5B89\u88C5",
    "plugins.update": "\u66F4\u65B0\u5230 {version}",
    "plugins.openPage": "\u6253\u5F00\u4E0B\u8F7D\u9875",
    "plugins.remove": "\u5220\u9664",
    "plugins.confirmRemove": "\u786E\u8BA4\u5220\u9664",
    "plugins.reveal": "\u5728\u6587\u4EF6\u5939\u4E2D\u663E\u793A",
    "plugins.cancel": "\u53D6\u6D88",
    "plugins.license": "\u8BB8\u53EF",
    "plugins.gplUpstream": "GPL \u4E0A\u6E38",
    "plugins.type.filter": "\u6EE4\u955C",
    "plugins.type.generator": "\u751F\u6210\u5668",
    "plugins.type.transition": "\u8F6C\u573A",
    "plugins.type.general": "\u901A\u7528",
    "plugins.type.paint": "\u7ED8\u5236",
    "plugins.type.retimer": "\u53D8\u901F",
    "plugins.system.mac": "macOS",
    "plugins.system.win": "Windows",
    "plugins.system.linux": "Linux",
    "plugins.incompatible": "\u4E0D\u517C\u5BB9",
    "plugins.externalPlugin": "\u5916\u90E8\u5B89\u88C5",
    "plugins.externalOnly": "\u4EC5\u63D0\u4F9B\u5916\u90E8\u4E0B\u8F7D",
    "plugins.noResults": "\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6",
    "plugins.loading": "\u6B63\u5728\u52A0\u8F7D\u6CE8\u518C\u8868\u2026",
    "plugins.downloadingFrom": "{phase}\u2026",
    "plugins.phase.downloading": "\u4E0B\u8F7D\u4E2D",
    "plugins.phase.extracting": "\u89E3\u538B\u4E2D",
    "plugins.phase.installing": "\u5B89\u88C5\u4E2D",
    "plugins.phase.done": "\u5B8C\u6210",
    "plugins.phase.error": "\u5931\u8D25",
    // ---- 设置：AI / MCP / 网络 / 命令行 ----
    "settings.section.text": "\u6587\u672C\u751F\u6210",
    "settings.section.text.caption": "\u6587\u672C\u6A21\u578B\u4F9B\u5E94\u5546\uFF08\u667A\u80FD\u4F53\u4E0E\u753B\u5E03\u8282\u70B9\u5171\u7528\uFF09",
    "settings.section.ai": "AI / MCP",
    "settings.section.ai.caption": "MCP \u4E0E\u672C\u5730\u6267\u884C\u540E\u7AEF",
    "settings.section.asr": "\u8BED\u97F3\u8BC6\u522B",
    "settings.section.asr.caption": "\u4E91\u7AEF\u8BED\u97F3\u8BC6\u522B\u670D\u52A1\u4E0E\u81EA\u5B9A\u4E49\u63A5\u53E3",
    "settings.asr.providers": "\u8BC6\u522B\u670D\u52A1",
    "settings.asr.empty": "\u8FD8\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u8BC6\u522B\u670D\u52A1\u3002\u70B9\u51FB\u4E0B\u65B9\u300C\u6DFB\u52A0\u670D\u52A1\u300D\u5F00\u59CB\u3002",
    "settings.asr.add": "\u6DFB\u52A0\u670D\u52A1",
    "settings.asr.edit": "\u7F16\u8F91\u670D\u52A1",
    "settings.asr.new": "\u65B0\u5EFA\u670D\u52A1",
    "settings.asr.name": "\u540D\u79F0",
    "settings.asr.nameHint": "\u663E\u793A\u5728\u5B57\u5E55\u6A21\u578B\u4E0B\u62C9\u5217\u8868\u91CC",
    "settings.asr.kind": "\u63A5\u53E3\u7C7B\u578B",
    "settings.asr.kindHint": "\u53EA\u63A5\u5165\u6807\u51C6 HTTP \u63A5\u53E3",
    "settings.asr.enabled": "\u542F\u7528",
    "settings.asr.enabledHint": "\u505C\u7528\u540E\u4E0D\u4F1A\u51FA\u73B0\u5728\u5B57\u5E55\u4E0B\u62C9\u5217\u8868",
    "settings.asr.baseUrl": "\u63A5\u53E3\u5730\u5740",
    "settings.asr.baseUrlDeepseekHint": "\u7559\u7A7A\u4F7F\u7528 https://api.deepseek.com",
    "settings.asr.baseUrlOpenaiHint": "\u586B\u5230 /v1 \u4E3A\u6B62",
    "settings.asr.apiKey": "API Key",
    "settings.asr.apiKeyHint": "\u4FDD\u5B58\u5728\u672C\u5730 asr.json",
    "settings.asr.azureKeyHint": "Azure \u8BED\u97F3\u8D44\u6E90\u7684\u5BC6\u94A5",
    "settings.asr.googleKeyHint": "Google Cloud API Key",
    "settings.asr.aliyunKeyHint": "\u767E\u70BC DashScope API Key",
    "settings.asr.baiduKeyHint": "\u767E\u5EA6\u8BED\u97F3\u7684 API Key",
    "settings.asr.secretId": "SecretId",
    "settings.asr.secretIdHint": "\u817E\u8BAF\u4E91 API \u5BC6\u94A5 SecretId",
    "settings.asr.secretKey": "SecretKey",
    "settings.asr.secretKeyHint": "\u817E\u8BAF\u4E91 API \u5BC6\u94A5 SecretKey",
    "settings.asr.baiduSecretHint": "\u767E\u5EA6\u8BED\u97F3\u7684 Secret Key",
    "settings.asr.accessKey": "Access Key",
    "settings.asr.accessKeyHint": "\u706B\u5C71\u5F15\u64CE Access Key",
    "settings.asr.appId": "App ID",
    "settings.asr.appIdHint": "\u817E\u8BAF\u4E91\u8D26\u53F7\u7684 AppId",
    "settings.asr.volcAppIdHint": "\u706B\u5C71\u5F15\u64CE\u5E94\u7528 AppId",
    "settings.asr.region": "\u533A\u57DF",
    "settings.asr.regionHint": "\u5982 eastasia\u3001eastus",
    "settings.asr.resourceId": "\u8D44\u6E90 ID",
    "settings.asr.resourceIdHint": "\u5982 volc.bigasr.auc_turbo",
    "settings.asr.model": "\u6A21\u578B",
    "settings.asr.modelHint": "\u63A5\u53E3\u652F\u6301\u7684\u6A21\u578B\u540D",
    "settings.asr.aliyunModelHint": "\u5982 qwen3-asr-flash",
    "settings.asr.engine": "\u8BC6\u522B\u5F15\u64CE",
    "settings.asr.engineHint": "\u5982 16k_zh",
    "settings.asr.devPid": "\u6A21\u578B\u7F16\u53F7",
    "settings.asr.devPidHint": "\u5982 1537\uFF08\u666E\u901A\u8BDD\uFF09",
    "settings.asr.language": "\u8BED\u8A00",
    "settings.asr.languageHint": "\u5982 zh\u3001en\uFF1B\u7559\u7A7A\u81EA\u52A8",
    "settings.asr.azureLanguageHint": "\u5982 zh-CN",
    "settings.asr.maxSeconds": "\u5355\u6B21\u65F6\u957F\u4E0A\u9650",
    "settings.asr.maxSecondsHint": "\u79D2\uFF1B0 = \u4F7F\u7528\u8BE5\u63A5\u53E3\u7684\u9884\u7F6E\u503C",
    "settings.asr.method": "\u8BF7\u6C42\u65B9\u6CD5",
    "settings.asr.methodHint": "GET \u6216 POST",
    "settings.asr.headers": "\u8BF7\u6C42\u5934\uFF08JSON\uFF09",
    "settings.asr.headersHint": '\u5982 {"Authorization":"Bearer x"}',
    "settings.asr.body": "\u8BF7\u6C42\u4F53\u6A21\u677F",
    "settings.asr.bodyHint": "\u652F\u6301 {{audio}}\uFF08base64\uFF09\u4E0E {{mime}}",
    "settings.asr.textPath": "\u6587\u672C\u5B57\u6BB5\u8DEF\u5F84",
    "settings.asr.textPathHint": "\u5982 data.text\uFF1B\u7559\u7A7A\u8868\u793A\u6574\u4E2A\u54CD\u5E94",
    "settings.asr.wordsPath": "\u8BCD\u65F6\u95F4\u5B57\u6BB5\u8DEF\u5F84",
    "settings.asr.wordsPathHint": "\u5143\u7D20\u9700\u542B text/word\u3001start\u3001end\uFF08\u79D2\uFF09",
    "settings.asr.url": "\u8BF7\u6C42 URL",
    "settings.asr.urlHint": "\u652F\u6301 {{audio}} \u5360\u4F4D\u7B26",
    "settings.asr.customKeyHint": "\u7559\u7A7A\u5219\u4E0D\u52A0 Authorization",
    "settings.asr.customHint": "\u81EA\u5EFA\u8BC6\u522B\u670D\u52A1\uFF1A\u7528 {{audio}} / {{mime}} \u62FC\u8BF7\u6C42\u4F53\uFF0C\u518D\u7528\u6587\u672C\u5B57\u6BB5\u8DEF\u5F84\u53D6\u7ED3\u679C\uFF1B\u8FD4\u56DE\u8BCD\u65F6\u95F4\u65F6\u518D\u586B\u8BCD\u65F6\u95F4\u5B57\u6BB5\u8DEF\u5F84\u3002",
    "settings.asr.test": "\u6D4B\u8BD5",
    "settings.asr.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "settings.asr.testNoMedia": "\u5A92\u4F53\u5E93\u91CC\u6CA1\u6709\u53EF\u7528\u7684\u97F3\u89C6\u9891\u7D20\u6750\uFF0C\u5148\u5BFC\u5165\u4E00\u4E2A\u518D\u6D4B\u8BD5",
    "settings.asr.testOk": "\u8BC6\u522B\u7ED3\u679C\uFF1A{text}",
    "settings.asr.save": "\u4FDD\u5B58",
    "settings.asr.saving": "\u4FDD\u5B58\u4E2D\u2026",
    "settings.asr.saved": "\u8BC6\u522B\u670D\u52A1\u5DF2\u4FDD\u5B58",
    "settings.asr.delete": "\u5220\u9664",
    "settings.asr.deleteTitle": "\u5220\u9664\u8BC6\u522B\u670D\u52A1\uFF1F",
    "settings.asr.deleteMessage": "\u300C{name}\u300D\u7684\u63A5\u53E3\u914D\u7F6E\u4F1A\u88AB\u79FB\u9664\u3002",
    "settings.asr.kind.openai": "OpenAI \u517C\u5BB9",
    "settings.asr.kind.deepseek": "DeepSeek",
    "settings.asr.kind.azure": "Azure \u8BED\u97F3",
    "settings.asr.kind.google": "Google Cloud STT",
    "settings.asr.kind.aliyun": "\u963F\u91CC\u767E\u70BC",
    "settings.asr.kind.tencent": "\u817E\u8BAF\u4E91",
    "settings.asr.kind.volcengine": "\u706B\u5C71\u5F15\u64CE",
    "settings.asr.kind.baidu": "\u767E\u5EA6\u8BED\u97F3",
    "settings.asr.kind.custom": "\u81EA\u5B9A\u4E49 HTTP",
    "ai.asrSettings": "\u914D\u7F6E\u8BED\u97F3\u8BC6\u522B\u670D\u52A1\u2026",
    "ai.asrSettingsHint": "\u6DFB\u52A0\u4EFB\u610F\u4F9B\u5E94\u5546\u7684\u8BC6\u522B API\uFF0C\u4E5F\u652F\u6301\u81EA\u5B9A\u4E49\u63A5\u53E3",
    "ai.asrLocalGroup": "\u672C\u5730\u6A21\u578B",
    "ai.asrCloudGroup": "\u4E91\u7AEF\u8BC6\u522B",
    "caps.feature.cloudAsr": "\u4E91\u7AEF\u8BED\u97F3\u8BC6\u522B",
    "settings.section.tts": "\u8BED\u97F3\u5408\u6210",
    "settings.section.tts.caption": "\u4E91\u7AEF TTS \u670D\u52A1\u4E0E\u81EA\u5B9A\u4E49\u63A5\u53E3",
    "settings.section.gen": "\u56FE\u50CF\u4E0E\u89C6\u9891",
    "settings.section.gen.caption": "\u4E91\u7AEF\u6587\u751F\u56FE / \u56FE\u751F\u56FE / \u89C6\u9891\u751F\u6210 API",
    "settings.section.network": "\u7F51\u7EDC",
    "settings.section.network.caption": "\u4EE3\u7406\u3001\u955C\u50CF\u4E0E\u6A21\u578B\u4E0B\u8F7D\u6E90",
    "settings.section.cli": "\u547D\u4EE4\u884C",
    "settings.section.cli.caption": "\u5728\u7EC8\u7AEF\u4F7F\u7528 aicut",
    "settings.text.providers": "\u5DF2\u914D\u7F6E\u7684\u4F9B\u5E94\u5546",
    "settings.text.empty": "\u8FD8\u6CA1\u6709\u914D\u7F6E\u6587\u672C\u6A21\u578B\u4F9B\u5E94\u5546\u3002\u70B9\u4E0B\u9762\u7684\u300C\u6DFB\u52A0\u4F9B\u5E94\u5546\u300D\uFF0C\u53EF\u4EE5\u540C\u65F6\u914D\u591A\u5BB6\uFF08OpenAI / DeepSeek / \u672C\u5730 Ollama \u2026\uFF09\u3002",
    "settings.text.add": "\u6DFB\u52A0\u4F9B\u5E94\u5546",
    "settings.text.edit": "\u7F16\u8F91\u4F9B\u5E94\u5546",
    "settings.text.new": "\u65B0\u4F9B\u5E94\u5546",
    "settings.text.provider": "\u4F9B\u5E94\u5546",
    "settings.text.providerHint": "\u9009\u4E00\u5BB6\u81EA\u52A8\u586B\u597D\u517C\u5BB9\u7AEF\u70B9\u4E0E\u9ED8\u8BA4\u6A21\u578B\uFF0C\u4E4B\u540E\u90FD\u53EF\u4EE5\u6539\u3002",
    "settings.text.providerPlaceholder": "\u9009\u62E9\u4F9B\u5E94\u5546",
    "settings.text.providerNoteFallback": "OpenAI \u517C\u5BB9\u7AEF\u70B9\uFF1A\u540E\u7AEF\u4F1A\u81EA\u52A8\u62FC /chat/completions\u3002",
    "settings.text.customPreset": "\u81EA\u5B9A\u4E49\u7AEF\u70B9",
    "settings.text.name": "\u540D\u79F0",
    "settings.text.nameHint": "\u663E\u793A\u5728\u6A21\u578B\u5217\u8868\u91CC\u7684\u4F9B\u5E94\u5546\u540D\uFF08\u540C\u4E00\u5BB6\u914D\u4E24\u53F0\u65F6\u7528\u5F97\u4E0A\uFF09\u3002",
    "settings.text.baseUrl": "\u7AEF\u70B9\u5730\u5740",
    "settings.text.baseUrlHint": "OpenAI \u517C\u5BB9\u7AEF\u70B9\uFF08\u540E\u7AEF\u4F1A\u81EA\u52A8\u62FC /chat/completions\uFF09",
    "settings.text.baseUrlPlaceholder": "https://api.openai.com/v1",
    "settings.text.apiKey": "API Key",
    "settings.text.apiKeyHint": "\u53EA\u4FDD\u5B58\u5728\u672C\u673A ai.json",
    "settings.text.apiKeyLocalHint": "\u672C\u5730\u7AEF\u70B9\u901A\u5E38\u4E0D\u9700\u8981 Key\uFF0C\u53EF\u4EE5\u7559\u7A7A",
    "settings.text.apiKeyPlaceholder": "sk-\u2026",
    "settings.text.apiKeyOptional": "\u672C\u5730\u7AEF\u70B9\u53EF\u7559\u7A7A",
    "settings.text.model": "\u9ED8\u8BA4\u6A21\u578B",
    "settings.text.modelHint": "\u8282\u70B9\u6CA1\u5355\u72EC\u9009\u6A21\u578B\u65F6\u7528\u5B83\uFF1B\u5EFA\u8BAE\u586B\u652F\u6301\u5DE5\u5177\u8C03\u7528\u7684\u6A21\u578B\uFF08\u667A\u80FD\u4F53\u8981\u7528\uFF09",
    "settings.text.modelPlaceholder": "gpt-4.1-mini",
    "settings.text.modelEmpty": "\u5148\u70B9\u300C\u83B7\u53D6\u6A21\u578B\u5217\u8868\u300D\uFF0C\u4E5F\u53EF\u4EE5\u76F4\u63A5\u624B\u586B",
    "settings.text.models": "\u6A21\u578B\u5217\u8868",
    "settings.text.modelsHint": "\u4E00\u884C\u4E00\u4E2A\uFF1B\u6587\u672C\u751F\u6210\u8282\u70B9\u7684\u6A21\u578B\u4E0B\u62C9\u4F1A\u5217\u51FA\u6240\u6709\u542F\u7528\u4F9B\u5E94\u5546\u7684\u8FD9\u4E9B\u6A21\u578B\u3002",
    "settings.text.modelsPlaceholder": "\u7559\u7A7A\u5219\u53EA\u63D0\u4F9B\u4E0A\u9762\u7684\u9ED8\u8BA4\u6A21\u578B",
    "settings.text.enabled": "\u542F\u7528",
    "settings.text.enabledHint": "\u753B\u5E03\u7684\u6587\u672C\u751F\u6210\u8282\u70B9\u53EA\u5217\u51FA\u542F\u7528\u7684\u4F9B\u5E94\u5546\uFF1B\u7B2C\u4E00\u4E2A\u542F\u7528\u7684\u4F9B\u526A\u8F91\u667A\u80FD\u4F53\u4F7F\u7528\u3002",
    "settings.text.enabledOn": "\u5DF2\u542F\u7528",
    "settings.text.enabledOff": "\u672A\u542F\u7528",
    "settings.text.noModel": "\u672A\u9009\u6A21\u578B",
    "settings.text.modelCount": "{count} \u4E2A\u6A21\u578B",
    "settings.text.fetchModels": "\u83B7\u53D6\u6A21\u578B\u5217\u8868",
    "settings.text.fetching": "\u83B7\u53D6\u4E2D\u2026",
    "settings.text.test": "\u6D4B\u8BD5\u8FDE\u901A\u6027",
    "settings.text.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "settings.text.save": "\u4FDD\u5B58",
    "settings.text.saved": "\u4F9B\u5E94\u5546\u5DF2\u4FDD\u5B58",
    "settings.text.deleted": "\u4F9B\u5E94\u5546\u5DF2\u5220\u9664",
    "settings.text.deleteTitle": "\u5220\u9664\u4F9B\u5E94\u5546",
    "settings.text.deleteMessage": "\u300C{name}\u300D\u4F1A\u4ECE\u6587\u672C\u751F\u6210\u91CC\u79FB\u9664\uFF0C\u5DF2\u8FDE\u63A5\u7684\u8282\u70B9\u9700\u8981\u91CD\u65B0\u9009\u6A21\u578B\u3002",
    "settings.text.probeOk": "\u8FDE\u63A5\u6210\u529F\uFF1A{detail}\uFF08{ms} ms\uFF09",
    "settings.text.probeFail": "\u8FDE\u63A5\u5931\u8D25\uFF1A{detail}",
    "settings.text.baseUrlRequired": "\u8BF7\u586B\u5199\u7AEF\u70B9\u5730\u5740",
    "settings.text.modelRequired": "\u8BF7\u9009\u62E9\u9ED8\u8BA4\u6A21\u578B",
    "settings.text.keyRequired": "\u8FD9\u5BB6\u4F9B\u5E94\u5546\u9700\u8981 API Key",
    "settings.text.noModelList": "\u8FD9\u5BB6\u4F9B\u5E94\u5546\u4E0D\u63D0\u4F9B\u6A21\u578B\u5217\u8868\u63A5\u53E3\uFF0C\u8BF7\u76F4\u63A5\u624B\u586B\u6A21\u578B\u540D",
    "settings.text.modelsFound": "\u62FF\u5230 {count} \u4E2A\u6A21\u578B",
    "settings.text.tip": "\u8FD9\u91CC\u662F\u6240\u6709\u6587\u672C\u6A21\u578B\u4F9B\u5E94\u5546\uFF1A\u526A\u8F91\u667A\u80FD\u4F53\u548C\u753B\u5E03\u7684\u6587\u672C\u751F\u6210\u8282\u70B9\u5171\u7528\u540C\u4E00\u4EFD\u914D\u7F6E\u3002\u8282\u70B9\u4E0A\u53EF\u4EE5\u9010\u6761\u9009\u62E9\u300C\u6A21\u578B \xB7 \u4F9B\u5E94\u5546\u300D\u3002",
    "settings.text.group.cloud": "\u4E91\u7AEF\u670D\u52A1",
    "settings.text.group.aggregator": "\u805A\u5408\u5E73\u53F0",
    "settings.text.group.local": "\u672C\u5730 / \u81EA\u5EFA",
    "settings.text.group.custom": "\u81EA\u5B9A\u4E49",
    "settings.text.localKey": "\u672C\u5730\uFF0C\u53EF\u65E0 Key",
    "settings.ai.title": "\u526A\u8F91\u667A\u80FD\u4F53",
    "settings.ai.baseUrl": "\u57FA\u7840 URL",
    "settings.ai.baseUrlHint": "OpenAI \u517C\u5BB9\u7AEF\u70B9",
    "settings.ai.baseUrlPlaceholder": "https://api.openai.com/v1",
    "settings.ai.apiKey": "API Key",
    "settings.ai.apiKeyHint": "\u53EA\u4FDD\u5B58\u5728\u672C\u673A ai.json",
    "settings.ai.apiKeyPlaceholder": "sk-\u2026",
    "settings.ai.model": "\u6A21\u578B",
    "settings.ai.modelHint": "\u9700\u8981\u652F\u6301\u5DE5\u5177\u8C03\u7528",
    "settings.ai.modelPlaceholder": "gpt-4o-mini",
    "settings.ai.modelEmpty": "\u5C1A\u672A\u8BBE\u7F6E\u6A21\u578B",
    "settings.ai.fetchModels": "\u83B7\u53D6\u6A21\u578B\u5217\u8868",
    "settings.ai.fetching": "\u83B7\u53D6\u4E2D\u2026",
    "settings.ai.test": "\u6D4B\u8BD5\u8FDE\u901A\u6027",
    "settings.ai.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "settings.ai.save": "\u4FDD\u5B58",
    "settings.ai.saved": "\u5DF2\u4FDD\u5B58",
    "settings.ai.probeOk": "\u8FDE\u63A5\u6210\u529F\uFF1A{detail}\uFF08{ms} ms\uFF09",
    "settings.ai.probeFail": "\u8FDE\u63A5\u5931\u8D25\uFF1A{detail}",
    "settings.ai.backendGroup": "\u672C\u5730 AI \u6267\u884C\u540E\u7AEF",
    "settings.ai.ortGroup": "ONNX Runtime \u540E\u7AEF\uFF08\u8BC6\u522B / \u97F3\u9891 / \u753B\u9762\u5904\u7406\uFF09",
    "settings.ai.sdcppGroup": "sd.cpp \u540E\u7AEF\uFF08\u89C6\u9891 / \u56FE\u50CF\u751F\u6210\uFF09",
    "settings.ai.sdcppHint": "\u4E0E ONNX Runtime \u5206\u5F00\uFF1B\u5207\u6362\u540E\u4E0B\u6B21\u751F\u6210\u751F\u6548\u3002",
    "settings.ai.sdcppMissing": "sd.cpp \u5F15\u64CE\u8FD8\u6CA1\u4E0B\u8F7D",
    "settings.ai.sdcppOpen": "\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668",
    "settings.ai.sdcppApplied": "\u89C6\u9891\u540E\u7AEF\u5DF2\u5207\u6362\u5230 {backend}\uFF08\u4E0B\u6B21\u751F\u6210\u751F\u6548\uFF09",
    "settings.ai.sdcppNeedDownload": "\u300C{backend}\u300D\u9700\u8981\u5148\u4E0B\u8F7D sd.cpp \u5F15\u64CE\uFF08{size}\uFF09\u3002\u73B0\u5728\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668\u5417\uFF1F",
    "settings.ai.sdcppDownloadGo": "\u53BB\u4E0B\u8F7D",
    "settings.ai.backend": "\u6267\u884C\u540E\u7AEF",
    "settings.ai.backendHint": "\u672C\u5730\u6A21\u578B\u7528\u54EA\u4E2A ONNX Runtime\uFF1B\u53EA\u5217\u672C\u673A\u53EF\u7528\u7684\u3002",
    "settings.ai.platform": "\u672C\u673A\u8BBE\u5907\uFF1A{platform}",
    "settings.ai.backendUnsupported": "\u5F53\u524D\u6784\u5EFA\u7684 ONNX Runtime \u672A\u5305\u542B\u8BE5\u540E\u7AEF",
    "settings.ai.backendUnavailableHint": "\u4E0D\u53EF\u7528\u7684\u540E\u7AEF\u9700\u8981\u5148\u5B89\u88C5\u5BF9\u5E94\u7684\u8FD0\u884C\u65F6\uFF08\u4E0B\u8F7D\u7BA1\u7406\u5668 \u2192 \u8FD0\u884C\u65F6\uFF09\u3002",
    "settings.ai.cudaRuntimeHint": "CUDA \u8FD0\u884C\u65F6\u53EF\u5728 \u4E0B\u8F7D\u7BA1\u7406\u5668 \u2192 \u8FD0\u884C\u65F6 \u91CC\u4E0B\u8F7D\uFF1B\u88C5\u5B8C\u91CD\u542F\u5E76\u5728\u8FD9\u91CC\u9009\u62E9 CUDA \u5373\u53EF\u3002",
    "settings.ai.backendCpuFaster": "\u5B9E\u6D4B\u8FD9\u4E9B\u672C\u5730\u6A21\u578B CPU \u901A\u5E38\u66F4\u5FEB\uFF1BCoreML / DirectML \u53EA\u5728\u90E8\u5206\u6A21\u578B\u4E0A\u6709\u6536\u76CA\u3002",
    "settings.ai.cudaCoreMissing": "CUDA {version} \u8FD0\u884C\u65F6\u672C\u4F53\u8FD8\u6CA1\u4E0B\u8F7D\uFF08\u4E0B\u8F7D\u7BA1\u7406\u5668 \u2192 \u8FD0\u884C\u65F6\uFF09\u3002",
    "settings.ai.cudaPartsMissing": "CUDA \u7EC4\u4EF6\u4E0D\u5B8C\u6574\uFF1A{parts}\u3002\u8865\u9F50\u5E76\u91CD\u542F\u540E\u624D\u4F1A\u771F\u6B63\u8D70\u663E\u5361\u3002",
    "settings.ai.cudaNotActive": "CUDA \u6CA1\u542F\u7528\uFF08provider \u672A\u6CE8\u518C\u6210\u529F\uFF09\uFF0C\u672C\u6B21\u4F1A\u8BDD\u4F1A\u56DE\u843D CPU\uFF1B\u8BF7\u91CD\u542F\u5E94\u7528\uFF0C\u4ECD\u4E0D\u884C\u5C31\u91CD\u88C5 CUDA \u7EC4\u4EF6\u3002",
    "settings.ai.backendAppliedCurrent": "\u5DF2\u5207\u6362\u5230 {backend}\uFF1B\u5F53\u524D\u4F1A\u8BDD\u5DF2\u7ECF\u5728\u7528\u5B83\uFF0C\u65E0\u9700\u91CD\u542F\u3002",
    "settings.ai.backendAppliedNext": "\u5DF2\u5207\u6362\u5230 {backend}\uFF1B\u4E0B\u6B21\u521B\u5EFA AI \u4F1A\u8BDD\u65F6\u81EA\u52A8\u4F7F\u7528\uFF0C\u672C\u6B21\u4F1A\u8BDD\u65E0\u9700\u91CD\u542F\u3002",
    "settings.mcp.server": "MCP \u670D\u52A1\u5668",
    "settings.mcp.enable": "\u542F\u7528 MCP \u670D\u52A1\u5668",
    "settings.mcp.enableHint": "\u4EC5\u76D1\u542C\u672C\u673A\u56DE\u73AF\u5730\u5740",
    "settings.mcp.port": "\u76D1\u542C\u7AEF\u53E3",
    "settings.mcp.portHint": "0 = \u81EA\u52A8\u5206\u914D\uFF1B\u88AB\u5360\u7528\u65F6\u81EA\u52A8\u9000\u56DE\u4E34\u65F6\u7AEF\u53E3",
    "settings.mcp.status": "\u8FD0\u884C\u72B6\u6001",
    "settings.mcp.running": "\u8FD0\u884C\u4E2D",
    "settings.mcp.stopped": "\u5DF2\u505C\u6B62",
    "settings.mcp.notListening": "\u672A\u76D1\u542C",
    "settings.mcp.portConflict": "\u7AEF\u53E3\u51B2\u7A81",
    "settings.mcp.portConflictBusy": "\u7AEF\u53E3 {port} \u5DF2\u88AB\u5176\u4ED6\u7A0B\u5E8F\u5360\u7528\uFF08\u53EF\u80FD\u662F\u53E6\u4E00\u4E2A AI Cut \u5B9E\u4F8B\uFF09\uFF0C\u672C\u6B21\u8FD0\u884C\u6539\u7528\u7CFB\u7EDF\u4E34\u65F6\u7AEF\u53E3 {bound}\u3002\u5916\u90E8\u5BA2\u6237\u7AEF\u8BF7\u4F7F\u7528\u4E0B\u9762\u7684\u63A5\u5165\u5730\u5740\u3002",
    "settings.mcp.portConflictDenied": "\u7AEF\u53E3 {port} \u88AB\u7CFB\u7EDF\u4FDD\u7559\u6216\u5F53\u524D\u7528\u6237\u6CA1\u6709\u6743\u9650\uFF08Windows \u7684 Hyper-V / WSL \u6392\u9664\u7AEF\u53E3\u533A\u30011024 \u4EE5\u4E0B\u7684\u7279\u6743\u7AEF\u53E3\uFF09\uFF0C\u672C\u6B21\u8FD0\u884C\u6539\u7528\u7CFB\u7EDF\u4E34\u65F6\u7AEF\u53E3 {bound}\u3002\u5916\u90E8\u5BA2\u6237\u7AEF\u8BF7\u4F7F\u7528\u4E0B\u9762\u7684\u63A5\u5165\u5730\u5740\u3002",
    "settings.mcp.usage": "\u63A5\u5165\u5730\u5740",
    "settings.mcp.endpoint": "MCP \u7AEF\u70B9",
    "settings.mcp.copy": "\u590D\u5236",
    "settings.mcp.security": "\u5B89\u5168",
    "settings.mcp.securityHint": "\u53EA\u76D1\u542C 127.0.0.1\uFF1B\u540C\u4E00\u53F0\u673A\u5668\u4E0A\u7684\u8FDB\u7A0B\u53EF\u4EE5\u8FDE\u63A5\uFF0C\u8BF7\u53EA\u8FD0\u884C\u53EF\u4FE1\u7684 Harness\u3002",
    "settings.skills.group": "Skills",
    "settings.skills.title": "\u5185\u7F6E\u6280\u80FD",
    "settings.skills.hint": "\u6280\u80FD\u6587\u6863\u901A\u8FC7 aicut_help \u5DE5\u5177\u6309\u9700\u53D6\u7528\uFF1B\u547D\u4EE4\u884C\u662F MCP \u7684\u8584\u5BA2\u6237\u7AEF\u3002",
    "settings.skills.openCli": "\u6253\u5F00\u547D\u4EE4\u884C\u8BBE\u7F6E",
    "settings.skills.mount": "\u6302\u8F7D aicut \u547D\u4EE4",
    "settings.skills.mountHint": "\u8BA9 Skills \u548C\u7EC8\u7AEF\u53EF\u4EE5\u76F4\u63A5\u8C03\u7528 aicut\uFF1B\u672A\u6302\u8F7D\u65F6\u4E5F\u53EF\u4F7F\u7528\u5168\u8DEF\u5F84\u3002",
    "settings.gen.providers": "\u751F\u6210\u670D\u52A1",
    "settings.gen.lead": "\u5B98\u65B9 API \u4F18\u5148\uFF1AOpenAI\u3001Google Gemini\u3001Stability\u3001FLUX\u3001\u963F\u91CC\u4E91\u767E\u70BC\u3001\u706B\u5C71\u65B9\u821F\u3001\u53EF\u7075\u3001MiniMax\u3001Runway\u3001Luma\uFF1B\u805A\u5408\u7AD9\u5176\u6B21\uFF1AOpenRouter\u3001\u7845\u57FA\u6D41\u52A8\u3001Replicate\u3001fal.ai\u3002",
    "settings.gen.empty": "\u8FD8\u6CA1\u6709\u914D\u7F6E\u751F\u6210\u670D\u52A1\u3002\u70B9\u51FB\u4E0B\u65B9\u300C\u6DFB\u52A0\u670D\u52A1\u300D\u5F00\u59CB\u3002",
    "settings.gen.add": "\u6DFB\u52A0\u670D\u52A1",
    "settings.gen.edit": "\u7F16\u8F91\u670D\u52A1",
    "settings.gen.new": "\u65B0\u5EFA\u670D\u52A1",
    "settings.gen.name": "\u540D\u79F0",
    "settings.gen.nameHint": "\u663E\u793A\u5728 AI \u9875\u9762\u7684\u6A21\u578B\u4E0B\u62C9\u5217\u8868\u91CC",
    "settings.gen.kind": "\u63A5\u53E3\u7C7B\u578B",
    "settings.gen.kindHint": "\u9009\u4E2D\u540E\u5730\u5740\u4E0E\u9ED8\u8BA4\u6A21\u578B\u4F1A\u81EA\u52A8\u586B\u597D\uFF0C\u53EA\u6539\u6A21\u578B\u540D\u5373\u53EF",
    "settings.gen.groupOfficial": "\u5B98\u65B9 API",
    "settings.gen.groupAggregator": "\u805A\u5408\u7AD9",
    "settings.gen.enabled": "\u542F\u7528",
    "settings.gen.enabledHint": "\u505C\u7528\u540E\u4E0D\u4F1A\u51FA\u73B0\u5728 AI \u9875\u9762\u7684\u4E0B\u62C9\u5217\u8868",
    "settings.gen.enabledOn": "\u5DF2\u542F\u7528",
    "settings.gen.enabledOff": "\u5DF2\u505C\u7528",
    "settings.gen.cap.t2i": "\u6587\u751F\u56FE",
    "settings.gen.cap.t2iHint": "\u7528\u63D0\u793A\u8BCD\u76F4\u63A5\u751F\u6210\u56FE\u7247",
    "settings.gen.cap.i2i": "\u56FE\u751F\u56FE",
    "settings.gen.cap.i2iHint": "\u4EE5\u7D20\u6750\u5E93\u91CC\u7684\u56FE\u7247\u4E3A\u53C2\u8003\u6539\u56FE\uFF08\u6307\u4EE4\u6539\u56FE\uFF09",
    "settings.gen.cap.video": "\u89C6\u9891\u751F\u6210",
    "settings.gen.cap.videoHint": "\u6587\u751F\u89C6\u9891\uFF1B\u652F\u6301\u56FE\u751F\u89C6\u9891\u7684\u670D\u52A1\u8FD8\u80FD\u63A5\u9996\u5E27",
    "settings.gen.baseUrl": "\u63A5\u53E3\u5730\u5740",
    "settings.gen.baseUrlHint": "\u7559\u7A7A\u7528\u5B98\u65B9\u5730\u5740\uFF1B\u4EE3\u7406 / \u7F51\u5173\u4E5F\u53EF\u4EE5\u586B\u8FD9\u91CC",
    "settings.gen.apiKey": "API Key",
    "settings.gen.apiKeyHint": "\u53EA\u4FDD\u5B58\u5728\u672C\u673A cloud-gen.json",
    "settings.gen.apiSecret": "Secret Key",
    "settings.gen.apiSecretHint": "\u53EF\u7075\u9700\u8981 Access Key + Secret Key \u4E24\u628A\u94A5\u5319",
    "settings.gen.groupId": "Group ID",
    "settings.gen.groupIdHint": "MiniMax \u8D26\u53F7\u7684 GroupId",
    "settings.gen.imageModel": "\u6587\u751F\u56FE\u6A21\u578B",
    "settings.gen.imageModelHint": "\u4F8B\u5982 gpt-image-1\u3001qwen-image\u3001gemini-2.5-flash-image",
    "settings.gen.editModel": "\u56FE\u751F\u56FE\u6A21\u578B",
    "settings.gen.editModelHint": "\u4F8B\u5982 qwen-image-edit\u3001flux-kontext-pro",
    "settings.gen.videoModel": "\u89C6\u9891\u6A21\u578B",
    "settings.gen.videoModelHint": "\u4F8B\u5982 doubao-seedance-1-0-pro\u3001kling-v2-1\u3001veo-3.1",
    "settings.gen.test": "\u6D4B\u8BD5",
    "settings.gen.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "settings.gen.testHint": "\u4F1A\u7528\u5F53\u524D\u914D\u7F6E\u751F\u6210\u4E00\u5F20 512 \u7684\u6837\u5F20\uFF0C\u53EF\u80FD\u4EA7\u751F\u8D39\u7528",
    "settings.gen.testOk": "\u6D4B\u8BD5\u6210\u529F\uFF1A{width} \xD7 {height}",
    "settings.gen.save": "\u4FDD\u5B58",
    "settings.gen.saving": "\u4FDD\u5B58\u4E2D\u2026",
    "settings.gen.saved": "\u751F\u6210\u670D\u52A1\u5DF2\u4FDD\u5B58",
    "settings.gen.delete": "\u5220\u9664",
    "settings.gen.deleteTitle": "\u5220\u9664\u751F\u6210\u670D\u52A1\uFF1F",
    "settings.gen.deleteMessage": "\u300C{name}\u300D\u7684\u63A5\u53E3\u914D\u7F6E\u4F1A\u88AB\u79FB\u9664\u3002",
    "settings.gen.kind.openai": "OpenAI",
    "settings.gen.kind.gemini": "Google Gemini",
    "settings.gen.kind.stability": "Stability AI",
    "settings.gen.kind.bfl": "Black Forest Labs\uFF08FLUX\uFF09",
    "settings.gen.kind.dashscope": "\u963F\u91CC\u4E91\u767E\u70BC",
    "settings.gen.kind.ark": "\u706B\u5C71\u65B9\u821F\uFF08\u8C46\u5305\uFF09",
    "settings.gen.kind.kling": "\u53EF\u7075 Kling",
    "settings.gen.kind.minimax": "MiniMax \u6D77\u87BA",
    "settings.gen.kind.runway": "Runway",
    "settings.gen.kind.luma": "Luma AI",
    "settings.gen.kind.replicate": "Replicate",
    "settings.gen.kind.fal": "fal.ai",
    "settings.gen.kind.openrouter": "OpenRouter",
    "settings.gen.kind.siliconflow": "\u7845\u57FA\u6D41\u52A8 SiliconFlow",
    "settings.tts.providers": "TTS \u670D\u52A1",
    "settings.tts.empty": "\u8FD8\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55 TTS \u670D\u52A1\u3002\u70B9\u51FB\u4E0B\u65B9\u300C\u6DFB\u52A0\u670D\u52A1\u300D\u5F00\u59CB\u3002",
    "settings.tts.add": "\u6DFB\u52A0\u670D\u52A1",
    "settings.tts.edit": "\u7F16\u8F91\u670D\u52A1",
    "settings.tts.new": "\u65B0\u5EFA\u670D\u52A1",
    "settings.tts.noVoice": "\u672A\u8BBE\u7F6E\u97F3\u8272",
    "settings.tts.enabledOn": "\u5DF2\u542F\u7528",
    "settings.tts.enabledOff": "\u5DF2\u505C\u7528",
    "settings.tts.name": "\u540D\u79F0",
    "settings.tts.nameHint": "\u663E\u793A\u5728\u6717\u8BFB\u6A21\u578B\u4E0B\u62C9\u5217\u8868\u91CC",
    "settings.tts.kind": "\u63A5\u53E3\u7C7B\u578B",
    "settings.tts.kindHint": "\u53EA\u63A5\u5165\u6807\u51C6 HTTP \u63A5\u53E3",
    "settings.tts.enabled": "\u542F\u7528",
    "settings.tts.enabledHint": "\u505C\u7528\u540E\u4E0D\u4F1A\u51FA\u73B0\u5728\u6717\u8BFB\u4E0B\u62C9\u5217\u8868",
    "settings.tts.baseUrl": "\u63A5\u53E3\u5730\u5740",
    "settings.tts.baseUrlOpenaiHint": "\u586B\u5230 /v1 \u5373\u53EF\uFF0C\u4F1A\u81EA\u52A8\u62FC\u63A5 /audio/speech",
    "settings.tts.baseUrlElevenHint": "\u7559\u7A7A\u4F7F\u7528 https://api.elevenlabs.io/v1",
    "settings.tts.baseUrlMinimaxHint": "\u7559\u7A7A\u4F7F\u7528 https://api.minimax.chat",
    "settings.tts.baseUrlVolcHint": "\u7559\u7A7A\u4F7F\u7528\u5B98\u65B9 unidirectional \u63A5\u53E3",
    "settings.tts.url": "\u8BF7\u6C42 URL",
    "settings.tts.urlHint": "GET \u65F6\u652F\u6301 {{text}} {{voice}} \u7B49\u5360\u4F4D\u7B26",
    "settings.tts.apiKey": "API Key",
    "settings.tts.apiKeyHint": "\u4FDD\u5B58\u5728\u672C\u5730 tts.json",
    "settings.tts.apiKeyGoogleHint": "Google Cloud API Key\uFF1B\u4E5F\u652F\u6301\u4EE3\u7406\u5730\u5740",
    "settings.tts.apiSecret": "Secret Key",
    "settings.tts.apiSecretHint": "\u767E\u5EA6\u8BED\u97F3\u7684 Secret Key",
    "settings.tts.appId": "App ID",
    "settings.tts.appIdHint": "\u706B\u5C71\u5F15\u64CE\u5E94\u7528\u7684 App ID",
    "settings.tts.accessKey": "Access Key",
    "settings.tts.accessKeyHint": "\u706B\u5C71\u5F15\u64CE\u7684 Access Key",
    "settings.tts.groupId": "Group ID",
    "settings.tts.groupIdHint": "MiniMax \u8D26\u53F7\u7684 GroupId",
    "settings.tts.region": "\u533A\u57DF",
    "settings.tts.regionHint": "\u5982 eastasia\u3001eastus",
    "settings.tts.model": "\u6A21\u578B",
    "settings.tts.modelHint": "\u63A5\u53E3\u652F\u6301\u7684\u6A21\u578B\u540D",
    "settings.tts.modelElevenHint": "\u5982 eleven_multilingual_v2",
    "settings.tts.modelMiniMaxHint": "\u5982 speech-01",
    "settings.tts.resourceId": "\u8D44\u6E90 ID",
    "settings.tts.resourceIdHint": "\u5982 volc_tts_release\u3001seed-tts-2.0",
    "settings.tts.voice": "\u9ED8\u8BA4\u97F3\u8272",
    "settings.tts.voiceHint": "\u670D\u52A1\u5546\u8981\u6C42\u7684\u97F3\u8272 ID",
    "settings.tts.voiceId": "Voice ID",
    "settings.tts.voiceIdHint": "ElevenLabs \u7684\u97F3\u8272 ID",
    "settings.tts.voiceAzureHint": "\u5982 zh-CN-XiaoxiaoNeural",
    "settings.tts.voiceGoogleHint": "\u5982 cmn-CN-Wavenet-A",
    "settings.tts.voiceBaiduHint": "\u767E\u5EA6\u53D1\u97F3\u4EBA\u7F16\u53F7\uFF0C\u5982 0\u30013\u30015118",
    "settings.tts.voiceVolcHint": "\u5982 zh_female_cancan_mars_bigtts",
    "settings.tts.format": "\u8F93\u51FA\u683C\u5F0F",
    "settings.tts.formatHint": "\u9ED8\u8BA4 MP3\uFF1BPCM \u4F1A\u81EA\u52A8\u8865 WAV \u5934",
    "settings.tts.speed": "\u8BED\u901F",
    "settings.tts.speedHint": "1.0 \u4E3A\u539F\u901F",
    "settings.tts.volume": "\u97F3\u91CF",
    "settings.tts.volumeHint": "1.0 \u4E3A\u539F\u59CB\u97F3\u91CF",
    "settings.tts.pitch": "\u97F3\u8C03",
    "settings.tts.pitchHint": "0 \u4E3A\u539F\u59CB\u97F3\u8C03",
    "settings.tts.method": "\u8BF7\u6C42\u65B9\u6CD5",
    "settings.tts.methodHint": "GET \u7528\u67E5\u8BE2\u53C2\u6570\uFF0CPOST \u7528 JSON",
    "settings.tts.headers": "\u8BF7\u6C42\u5934\uFF08JSON\uFF09",
    "settings.tts.headersHint": "\u652F\u6301 {{api_key}} {{api_secret}} \u5360\u4F4D\u7B26",
    "settings.tts.customKeyHint": "\u7559\u7A7A\u5219\u4E0D\u52A0 Authorization\uFF1B\u4E5F\u53EF\u5199\u5728\u8BF7\u6C42\u5934\u91CC",
    "settings.tts.body": "\u8BF7\u6C42\u4F53\u6A21\u677F",
    "settings.tts.bodyHint": "\u652F\u6301 {{text}} {{voice}} {{speed}} {{format}} \u7B49\u5360\u4F4D\u7B26",
    "settings.tts.audioPath": "\u97F3\u9891\u5B57\u6BB5\u8DEF\u5F84",
    "settings.tts.audioPathHint": "\u54CD\u5E94\u76F4\u63A5\u662F\u97F3\u9891\u65F6\u7559\u7A7A\uFF1BJSON + base64 \u65F6\u586B\u5982 data.audio",
    "settings.tts.voices": "\u97F3\u8272\u5217\u8868",
    "settings.tts.voicesHint": "\u6BCF\u884C\u4E00\u4E2A\uFF1B\u7559\u7A7A\u5219\u4F7F\u7528\u63A5\u53E3\u8FD4\u56DE\u6216\u5185\u7F6E\u5217\u8868",
    "settings.tts.voicesPlaceholder": "voice-1\nvoice-2",
    "settings.tts.voicesEmpty": "\u672A\u83B7\u53D6\u5230\u97F3\u8272\uFF0C\u53EF\u76F4\u63A5\u8F93\u5165 ID",
    "settings.tts.testText": "\u6D4B\u8BD5\u6587\u672C",
    "settings.tts.testTextHint": "\u70B9\u51FB\u300C\u6D4B\u8BD5\u300D\u4F1A\u5408\u6210\u5E76\u64AD\u653E\u8FD9\u53E5\u8BDD",
    "settings.tts.testTextDefault": "\u4F60\u597D\uFF0C\u8FD9\u662F\u4E00\u6BB5\u8BED\u97F3\u5408\u6210\u6D4B\u8BD5\u3002",
    "settings.tts.test": "\u6D4B\u8BD5",
    "settings.tts.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "settings.tts.play": "\u64AD\u653E",
    "settings.tts.testOk": "\u6D4B\u8BD5\u6210\u529F\uFF0C\u65F6\u957F {duration} \u79D2",
    "settings.tts.fetchVoices": "\u83B7\u53D6\u97F3\u8272",
    "settings.tts.fetchingVoices": "\u83B7\u53D6\u4E2D\u2026",
    "settings.tts.voicesFetched": "\u5DF2\u83B7\u53D6 {count} \u4E2A\u97F3\u8272",
    "settings.tts.save": "\u4FDD\u5B58",
    "settings.tts.saving": "\u4FDD\u5B58\u4E2D\u2026",
    "settings.tts.saved": "TTS \u670D\u52A1\u5DF2\u4FDD\u5B58",
    "settings.tts.delete": "\u5220\u9664",
    "settings.tts.deleteTitle": "\u5220\u9664 TTS \u670D\u52A1\uFF1F",
    "settings.tts.deleteMessage": "\u300C{name}\u300D\u7684\u63A5\u53E3\u914D\u7F6E\u4F1A\u88AB\u79FB\u9664\u3002",
    "settings.tts.kind.openai": "OpenAI \u517C\u5BB9",
    "settings.tts.kind.elevenlabs": "ElevenLabs",
    "settings.tts.kind.azure": "Azure \u8BED\u97F3",
    "settings.tts.kind.google": "Google Cloud TTS",
    "settings.tts.kind.baidu": "\u767E\u5EA6\u8BED\u97F3",
    "settings.tts.kind.minimax": "MiniMax",
    "settings.tts.kind.volcengine": "\u706B\u5C71\u5F15\u64CE\uFF08\u8C46\u5305\uFF09",
    "settings.tts.baseUrlDeepseekHint": "\u7559\u7A7A\u4F7F\u7528 https://api.deepseek.com",
    "settings.tts.voiceDeepseekHint": "stella\uFF08\u5973\uFF0C\u9ED8\u8BA4\uFF09\u6216 tide\uFF08\u7537\uFF09",
    "settings.tts.kind.deepseek": "DeepSeek",
    "settings.tts.kind.custom": "\u81EA\u5B9A\u4E49 HTTP",
    "settings.tts.customHint": "\u9002\u7528\u4E8E CosyVoice\u3001IndexTTS\u3001GPT-SoVITS\u3001Fish-Speech \u7B49\u81EA\u5EFA\u670D\u52A1\uFF1A\u9009\u62E9 GET \u6216 POST\uFF0C\u7528 {{text}} / {{voice}} / {{speed}} / {{format}} \u5360\u4F4D\u7B26\u62FC\u8BF7\u6C42\uFF0C\u54CD\u5E94\u662F\u539F\u59CB\u97F3\u9891\u6216 JSON base64 \u90FD\u652F\u6301\u3002",
    "settings.proxy.group": "\u4EE3\u7406",
    "settings.proxy.mode": "\u4EE3\u7406\u65B9\u5F0F",
    "settings.proxy.modeHint": "\u526A\u8F91\u667A\u80FD\u4F53\u3001\u8BED\u97F3\u5408\u6210\u4E0E\u6A21\u578B\u4E0B\u8F7D\u90FD\u8D70\u5B83\uFF1B\u300C\u7CFB\u7EDF\u4EE3\u7406\u300D\u4F1A\u81EA\u52A8\u8DDF\u968F Windows / macOS \u7684\u7CFB\u7EDF\u4EE3\u7406\u8BBE\u7F6E\uFF08\u542B\u73AF\u5883\u53D8\u91CF\u4E0E\u7ED5\u8FC7\u5217\u8868\uFF09\uFF0CPAC \u811A\u672C\u6682\u4E0D\u652F\u6301\u3002",
    "settings.proxy.modeDirect": "\u76F4\u8FDE",
    "settings.proxy.modeSystem": "\u7CFB\u7EDF\u4EE3\u7406",
    "settings.proxy.modeManual": "\u624B\u52A8",
    "settings.proxy.url": "\u4EE3\u7406\u5730\u5740",
    "settings.proxy.urlPlaceholder": "http://127.0.0.1:7892",
    "settings.proxy.urlHint": "\u652F\u6301 http(s):// \u4E0E socks5://\uFF1B\u4EC5\u624B\u52A8\u6A21\u5F0F\u4F7F\u7528",
    "settings.proxy.current": "\u5F53\u524D\u5B9E\u9645\u8D70",
    "settings.proxy.test": "\u6D4B\u8BD5",
    "settings.proxy.testing": "\u6D4B\u8BD5\u4E2D\u2026",
    "settings.proxy.save": "\u4FDD\u5B58",
    "settings.proxy.saved": "\u5DF2\u4FDD\u5B58",
    "settings.proxy.probeOk": "\u8FDE\u63A5\u6210\u529F\uFF1A{detail}",
    "settings.proxy.probeFail": "\u8FDE\u63A5\u5931\u8D25\uFF1A{detail}",
    "settings.proxy.direct": "\u76F4\u8FDE\uFF08\u4E0D\u4F7F\u7528\u4EE3\u7406\uFF09",
    "settings.proxy.system": "\u7CFB\u7EDF\u4EE3\u7406",
    "settings.store.group": "\u955C\u50CF\u4E0E\u4E0B\u8F7D\u5730\u5740",
    "settings.store.models": "\u6A21\u578B\u955C\u50CF",
    "settings.store.modelsHint": "\u4E00\u884C\u4E00\u4E2A\u5730\u5740\uFF0C\u4F5C\u4E3A\u6A21\u578B\u6743\u91CD\u7684\u4E0B\u8F7D\u524D\u7F00/\u524D\u7F6E\u4EE3\u7406\uFF1B\u7559\u7A7A = \u53EA\u7528\u6E05\u5355\u91CC\u7684\u5B98\u65B9\u6E90\u3002\u53EF\u7528 {url} \u5360\u4F4D\u7B26\uFF0C\u5426\u5219\u76F4\u63A5\u62FC\u5728\u5730\u5740\u524D\u9762\u3002\u65E0\u8BBA\u8D70\u4E0D\u8D70\u955C\u50CF\uFF0C\u90FD\u4F1A\u6821\u9A8C sha256",
    "settings.store.modelsPlaceholder": "https://mirror.example/",
    "settings.store.source": "\u6A21\u578B\u4E0B\u8F7D\u6E90",
    "settings.store.sourceHint": "\u56FD\u5185\u5916\u5404\u6709\u4E00\u6761\u6E90\uFF0C\u8FD9\u91CC\u51B3\u5B9A\u5148\u8BD5\u54EA\u4E2A\u5730\u533A\uFF1B\u4E0B\u8F7D\u5931\u8D25\u4F1A\u81EA\u52A8\u6362\u53E6\u4E00\u4E2A\u5730\u533A\uFF08\u59CB\u7EC8\u6821\u9A8C sha256\uFF09",
    "settings.store.sourceAuto": "\u81EA\u52A8",
    "settings.store.sourceIntl": "\u4F18\u5148\u56FD\u5916",
    "settings.store.sourceCn": "\u4F18\u5148\u56FD\u5185",
    "settings.store.prefix": "\u4E0B\u8F7D\u4EE3\u7406\u524D\u7F00",
    "settings.store.prefixHint": "\u53EA\u5BF9 GitHub \u7684\u4E0B\u8F7D\u5730\u5740\u751F\u6548\uFF1B\u7559\u7A7A = \u76F4\u8FDE\u3002\u53EF\u7528 {url} \u5360\u4F4D\u7B26\uFF0C\u5426\u5219\u76F4\u63A5\u62FC\u5728\u5730\u5740\u524D\u9762\u3002\u65E0\u8BBA\u8D70\u4E0D\u8D70\u4EE3\u7406\uFF0C\u90FD\u4F1A\u6821\u9A8C sha256",
    "settings.store.prefixPlaceholder": "https://<\u52A0\u901F\u7AD9>/",
    "settings.store.saveHint": "\u6539\u5B8C\u70B9\u4FDD\u5B58\uFF1B\u4E0B\u6B21\u4E0B\u8F7D\u6A21\u578B\u5373\u751F\u6548",
    "settings.store.save": "\u4FDD\u5B58",
    "settings.store.saving": "\u4FDD\u5B58\u4E2D\u2026",
    "settings.store.saved": "\u5DF2\u4FDD\u5B58\u4E0B\u8F7D\u6E90\u8BBE\u7F6E",
    "settings.store.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{error}",
    "settings.market.group": "\u5E94\u7528\u6269\u5C55\u7D22\u5F15\u6E90",
    "settings.market.url": "\u7D22\u5F15\u5730\u5740",
    "settings.market.urlHint": "\u5E94\u7528\u6269\u5C55\u5546\u5E97\u7684\u9759\u6001 JSON \u7D22\u5F15\uFF1B\u53EA\u652F\u6301 https\uFF08\u672C\u673A http \u4F8B\u5916\uFF09\u3002",
    "settings.market.urlPlaceholder": "https://heshengtao.github.io/ai-cut-plugin/index.json",
    "settings.market.saveHint": "\u7559\u7A7A\u4FDD\u5B58 = \u6062\u590D\u9ED8\u8BA4\u6E90\u3002\u7D22\u5F15\u7531\u8F6F\u4EF6\u6293\u53D6\u4E0E\u6821\u9A8C\uFF0C\u754C\u9762\u53EA\u53D6\u4E00\u9875\u7ED3\u679C\u3002",
    "settings.market.reset": "\u6062\u590D\u9ED8\u8BA4",
    "settings.market.save": "\u4FDD\u5B58",
    "settings.market.saving": "\u4FDD\u5B58\u4E2D\u2026",
    "settings.market.saved": "\u5DF2\u4FDD\u5B58",
    "settings.plugins.group": "OFX \u63D2\u4EF6\u6CE8\u518C\u8868",
    "settings.plugins.url": "\u6CE8\u518C\u8868\u5730\u5740",
    "settings.plugins.urlHint": "\u7559\u7A7A = \u4F7F\u7528\u5B98\u65B9 GitHub raw \u6CE8\u518C\u8868\u3002",
    "settings.plugins.urlPlaceholder": "https://raw.githubusercontent.com/...",
    "settings.plugins.mirrors": "\u6CE8\u518C\u8868\u955C\u50CF",
    "settings.plugins.mirrorsHint": "\u4E00\u884C\u4E00\u4E2A\u5730\u5740\uFF0C\u5728\u5B98\u65B9\u5730\u5740\u4E4B\u524D\u5C1D\u8BD5\uFF1B{url} \u4F1A\u66FF\u6362\u6210\u5B98\u65B9\u6CE8\u518C\u8868\u5730\u5740\u3002",
    "settings.plugins.mirrorsPlaceholder": "https://your-mirror/registry.json",
    "settings.plugins.saveHint": "\u4FDD\u5B58\u540E\u4E0B\u6B21\u5237\u65B0\u6CE8\u518C\u8868\u751F\u6548\u3002",
    "settings.plugins.save": "\u4FDD\u5B58\u6CE8\u518C\u8868",
    "settings.plugins.saving": "\u4FDD\u5B58\u4E2D\u2026",
    "settings.plugins.saved": "\u6CE8\u518C\u8868\u8BBE\u7F6E\u5DF2\u4FDD\u5B58",
    "settings.plugins.reset": "\u6062\u590D\u9ED8\u8BA4",
    "settings.plugins.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{error}",
    "backend.cpu": "CPU",
    "backend.cpu.note": "\u7EAF CPU\uFF08\u9ED8\u8BA4\uFF0C\u5168\u5E73\u53F0\u53EF\u7528\uFF09",
    "backend.coreml": "Apple CoreML",
    "backend.coreml.note": "Apple \u795E\u7ECF\u5F15\u64CE / GPU\uFF08\u5B9E\u6D4B\u5728\u672C\u673A\u7684\u8FD9\u4E9B\u5C0F\u6A21\u578B\u4E0A\u6BD4 CPU \u6162\uFF09",
    "backend.directml": "DirectML",
    "backend.directml.note": "DirectX 12 \u786C\u4EF6\u52A0\u901F\uFF08Windows\uFF09",
    "backend.cuda": "NVIDIA CUDA",
    "backend.cuda.note": "NVIDIA \u663E\u5361\u52A0\u901F\uFF08\u4E0B\u8F7D\u5B8C\u6574\u5339\u914D\u7684 ONNX Runtime + CUDA 12 / cuFFT / cuDNN 9\uFF0C\u4E0D\u4F9D\u8D56\u7CFB\u7EDF CUDA\uFF09",
    "backend.cuda12": "CUDA 12",
    "backend.cuda12.note": "NVIDIA \u663E\u5361\u52A0\u901F\uFF08CUDA 12\uFF1B\u8001\u5361 / \u9A71\u52A8 < 580\uFF0C\u517C\u5BB9\u6027\u6700\u597D\uFF09",
    "backend.cuda13": "CUDA 13",
    "backend.cuda13.note": "NVIDIA \u65B0\u5361\u52A0\u901F\uFF08CUDA 13\uFF1BTuring \u8D77\u4E14\u9A71\u52A8 580+\uFF0C\u66F4\u5FEB\uFF09",
    "settings.ai.runtimes": "\u8FD0\u884C\u5E93",
    "settings.ai.runtimesHint": "CPU / DirectML / CoreML \u968F\u5305\uFF1BCUDA 12 / CUDA 13 \u5B8C\u6574\u5957\u4EF6\u6309\u9700\u4E0B\u8F7D",
    "settings.ai.runtimeActive": "\u4F7F\u7528\u4E2D",
    "settings.ai.runtimesMissing": "CUDA \u8FD0\u884C\u65F6\u672A\u5B89\u88C5\uFF0C\u70B9\u53F3\u4FA7\u6309\u94AE\u4E0B\u8F7D",
    "settings.ai.runtimesLibsMissing": "ONNX Runtime\uFF08CUDA\uFF09\u5DF2\u5B89\u88C5\uFF1B\u8FD8\u7F3A\u7EC4\u4EF6\uFF1A{libs}",
    "settings.ai.runtimesRestart": "\u8FD0\u884C\u5E93\u5DF2\u5207\u6362\uFF0C\u91CD\u542F\u5E94\u7528\u540E\u751F\u6548",
    "settings.ai.runtimeOpen": "\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668",
    "settings.ai.restartRequired": "\u91CD\u542F\u540E\u751F\u6548",
    "settings.ai.runtimeMissing": "\u8FD9\u4E2A\u540E\u7AEF\u9700\u8981\u5148\u4E0B\u8F7D\u8FD0\u884C\u65F6\uFF08\u4E0B\u8F7D\u7BA1\u7406\u5668 \u2192 \u8FD0\u884C\u65F6\uFF09",
    "settings.ai.cudaMissing": "CUDA \u7EC4\u4EF6\u4E0D\u5B8C\u6574\uFF1A{libs}",
    "settings.ai.runtimeMissingTitle": "\u8FD0\u884C\u65F6\u8FD8\u6CA1\u4E0B\u8F7D",
    "settings.ai.runtimeMissingBody": "\u300C{backend}\u300D\u9700\u8981\u5148\u4E0B\u8F7D\u8FD0\u884C\u65F6\uFF08{size}\uFF09\u3002\u73B0\u5728\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668\u5E76\u5F00\u59CB\u4E0B\u8F7D\u5417\uFF1F",
    "settings.ai.runtimeMissingBodyUnknown": "\u300C{backend}\u300D\u9700\u8981\u5148\u4E0B\u8F7D\u8FD0\u884C\u65F6\u3002\u73B0\u5728\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668\u5417\uFF1F",
    "settings.ai.runtimeMissingGo": "\u53BB\u4E0B\u8F7D",
    "settings.ai.cudaMissingTitle": "CUDA \u7EC4\u4EF6\u4E0D\u5B8C\u6574",
    "settings.ai.cudaMissingBody": "ONNX Runtime\uFF08CUDA\uFF09\u5DF2\u7ECF\u88C5\u597D\uFF0C\u4F46\u5B83\u4F9D\u8D56\u7684 CUDA \u7EC4\u4EF6\u4E0D\u5B8C\u6574\uFF1A{libs}\u3002\u5230 \u4E0B\u8F7D\u7BA1\u7406\u5668 \u2192 \u8FD0\u884C\u65F6 \u4E00\u952E\u8865\u9F50\u5373\u53EF\uFF08\u81EA\u52A8\u4E0B\u8F7D\u4E0E\u672C\u4F53\u7248\u672C\u5339\u914D\u7684\u90A3\u4E00\u5957\uFF0C\u4E0D\u9700\u8981\u81EA\u5DF1\u88C5 CUDA Toolkit\uFF09\u3002",
    "settings.ai.cudaDownloadTitle": "\u4E0B\u8F7D CUDA \u8FD0\u884C\u7EC4\u4EF6",
    "settings.ai.cudaDownloadBody": "\u5207\u6362\u5230 CUDA \u9700\u8981\u5148\u8865\u9F50\uFF1A{list}\uFF08\u5171 {size}\uFF09\u3002\u70B9\u51FB\u300C\u4E0B\u8F7D\u5E76\u5207\u6362\u300D\u4F1A\u8DF3\u5230\u4E0B\u8F7D\u7BA1\u7406\u5668\u81EA\u52A8\u4E0B\u8F7D\uFF0C\u88C5\u5B8C\u63D0\u793A\u91CD\u542F\u3002",
    "settings.ai.cudaDownloadGo": "\u4E0B\u8F7D\u5E76\u5207\u6362",
    "settings.ai.cudaDownloadFailed": "\u8FD0\u884C\u7EC4\u4EF6\u6CA1\u6709\u88C5\u5B8C\uFF0C\u5DF2\u4FDD\u6301\u539F\u540E\u7AEF\uFF1B\u53EF\u4EE5\u5728\u4E0B\u8F7D\u7BA1\u7406\u5668 \u2192 \u53EF\u4E0B\u8F7D \u91CC\u7EE7\u7EED\u3002",
    "settings.ai.restartTitle": "\u8FD0\u884C\u5E93\u5DF2\u5207\u6362",
    "settings.ai.restartBody": "\u65B0\u7684\u8FD0\u884C\u5E93\u4F1A\u5728\u4E0B\u6B21\u542F\u52A8\u65F6\u52A0\u8F7D\uFF0C\u73B0\u5728\u91CD\u542F\u5E94\u7528\u5417\uFF1F",
    "settings.ai.restartDevHint": "\uFF08\u5F00\u53D1\u6A21\u5F0F\u4E0B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u542F\uFF0C\u8BF7\u624B\u52A8\u5173\u95ED\u5E94\u7528\u540E\u91CD\u65B0\u8FD0\u884C\u3002\uFF09",
    "settings.ai.restartNow": "\u7ACB\u5373\u91CD\u542F",
    "settings.cli.group": "\u547D\u4EE4\u884C",
    "settings.cli.mount": "\u5728\u7EC8\u7AEF\u4F7F\u7528 aicut",
    "settings.cli.mountHint": "\u6253\u5F00\u540E\u53EF\u5728\u4EFB\u610F\u7EC8\u7AEF\u76F4\u63A5\u6572 aicut\uFF1BmacOS / Linux \u4F1A\u8BF7\u6C42\u4E00\u6B21\u7BA1\u7406\u5458\u6388\u6743",
    "settings.cli.status": "\u6302\u8F7D\u72B6\u6001",
    "settings.cli.state.installed": "\u5DF2\u6302\u8F7D",
    "settings.cli.state.missing": "\u672A\u6302\u8F7D",
    "settings.cli.state.conflict": "\u5B58\u5728\u51B2\u7A81",
    "settings.cli.state.system": "\u7CFB\u7EDF\u5B89\u88C5",
    "settings.cli.state.unsupported": "\u5F53\u524D\u6784\u5EFA\u4E0D\u652F\u6301",
    "settings.cli.command": "\u547D\u4EE4",
    "settings.cli.bundled": "\u5305\u5185\u4E8C\u8FDB\u5236",
    "settings.cli.notBundled": "\u5F53\u524D\u6784\u5EFA\u672A\u6253\u5305 aicut",
    "settings.cli.fullPath": "\u5168\u8DEF\u5F84\uFF08\u672A\u6302\u8F7D\u65F6\u7528\uFF09",
    "settings.cli.copy": "\u590D\u5236",
    "settings.cli.manual": "\u624B\u5DE5\u6302\u8F7D\u547D\u4EE4",
    "settings.cli.busy": "\u5904\u7406\u4E2D\u2026",
    "settings.cli.mountedToast": "\u5DF2\u6302\u8F7D aicut",
    "settings.cli.unmountedToast": "\u5DF2\u5378\u8F7D aicut",
    "settings.cli.statusHint": "\u6302\u8F7D\u662F\u53EF\u9009\u7684\uFF1B\u672A\u6302\u8F7D\u65F6\u4ECD\u53EF\u4F7F\u7528\u5305\u5185\u5168\u8DEF\u5F84\u3002",
    "settings.cli.desktopOnly": "\u6302\u8F7D\u9700\u8981\u5728\u684C\u9762\u5E94\u7528\u4E2D\u64CD\u4F5C\uFF1B\u6D4F\u89C8\u5668\u9884\u89C8\u65E0\u6CD5\u4FEE\u6539\u7CFB\u7EDF PATH\u3002",
    "settings.cli.systemInstalled": "\u7CFB\u7EDF\u91CC\u5DF2\u7ECF\u5B89\u88C5\u4E86 aicut\uFF0C\u65E0\u9700\u91CD\u590D\u6302\u8F7D\u3002",
    "settings.cli.hint.conflict": "\u5DF2\u5B58\u5728\u53E6\u4E00\u4E2A aicut\uFF1B\u4E3A\u907F\u514D\u8986\u76D6\uFF0C\u672A\u505A\u4FEE\u6539\u3002",
    "settings.cli.hint.dev_build": "\u5F53\u524D\u662F\u5F00\u53D1\u6784\u5EFA\uFF0C\u6302\u8F7D\u4F1A\u6307\u5411\u4E34\u65F6\u4EA7\u7269\uFF1B\u91CD\u65B0\u6784\u5EFA\u540E\u53EF\u80FD\u9700\u8981\u518D\u6B21\u6302\u8F7D\u3002",
    "settings.cli.hint.needs_manual": "\u9700\u8981\u624B\u52A8\u6267\u884C\u4E0B\u9762\u7684\u547D\u4EE4\u3002",
    "settings.cli.hint.appimage": "AppImage \u8DEF\u5F84\u6BCF\u6B21\u542F\u52A8\u90FD\u4F1A\u53D8\uFF0C\u65E0\u6CD5\u5B89\u5168\u6302\u8F7D\u3002",
    "settings.copy.ok": "\u5DF2\u590D\u5236",
    "copy.failed": "\u590D\u5236\u5931\u8D25",
    // ---- 确认框 ----
    "confirm.unsavedTitle": "\u653E\u5F03\u672A\u4FDD\u5B58\u7684\u6539\u52A8\uFF1F",
    "confirm.unsavedNew": "\u5F53\u524D\u5DE5\u7A0B\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8\uFF0C\u786E\u5B9A\u65B0\u5EFA\uFF1F",
    "confirm.unsavedOpen": "\u5F53\u524D\u5DE5\u7A0B\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8\uFF0C\u786E\u5B9A\u6253\u5F00\u522B\u7684\u5DE5\u7A0B\uFF1F",
    "confirm.newProject": "\u65B0\u5EFA",
    "confirm.continueOpen": "\u7EE7\u7EED\u6253\u5F00",
    "confirm.delete": "\u5220\u9664",
    "confirm.cancel": "\u53D6\u6D88",
    "confirm.recoveryTitle": "\u6062\u590D\u672A\u4FDD\u5B58\u7684\u8349\u7A3F\uFF1F",
    "confirm.recoveryMessage": "\u68C0\u6D4B\u5230 {when} \u7684\u672A\u4FDD\u5B58\u8349\u7A3F\uFF0C\u662F\u5426\u6062\u590D\uFF1F",
    "confirm.restore": "\u6062\u590D",
    "confirm.discard": "\u4E0D\u6062\u590D",
    // ---- 历史工程 ----
    "history.title": "\u5386\u53F2\u5DE5\u7A0B",
    "history.loading": "\u6B63\u5728\u8BFB\u53D6\u5386\u53F2\u5DE5\u7A0B\u2026",
    "history.empty": "\u8FD8\u6CA1\u6709\u5386\u53F2\u5DE5\u7A0B",
    "history.emptyHint": "\u65B0\u5EFA\u6216\u6253\u5F00\u5176\u4ED6\u5DE5\u7A0B\u65F6\uFF0C\u5F53\u524D\u5DE5\u7A0B\u4F1A\u81EA\u52A8\u4FDD\u5B58\u5728\u8FD9\u91CC\u3002",
    "history.failed": "\u8BFB\u53D6\u5386\u53F2\u5DE5\u7A0B\u5931\u8D25\uFF1A{error}",
    "history.restoreFailed": "\u6062\u590D\u5386\u53F2\u5DE5\u7A0B\u5931\u8D25\uFF1A{error}",
    "history.restored": "\u5DF2\u56DE\u5230\u300C{name}\u300D",
    "history.dirty": "\u672A\u4FDD\u5B58",
    "history.unsaved": "\u672A\u4FDD\u5B58\u7684\u5DE5\u7A0B",
    "history.tracks": "{count} \u6761\u8F68\u9053",
    "history.clips": "{count} \u4E2A\u7247\u6BB5",
    "history.version": "\u7248\u672C",
    "history.versions": "{count} \u4E2A\u7248\u672C",
    "history.hint": "\u70B9\u51FB\u5361\u7247\u56DE\u5230\u9009\u4E2D\u7684\u7248\u672C\uFF1B\u5F53\u524D\u5DE5\u7A0B\u4F1A\u5148\u81EA\u52A8\u5B58\u5165\u5386\u53F2\u3002",
    "history.delete": "\u5220\u9664\u5386\u53F2\u5DE5\u7A0B",
    "history.deleteTitle": "\u5220\u9664\u8FD9\u4EFD\u5386\u53F2\u5DE5\u7A0B\uFF1F",
    "history.deleteMessage": "\u300C{name}\u300D\u4F1A\u4ECE\u5386\u53F2\u5DE5\u7A0B\u5217\u8868\u4E2D\u79FB\u9664\uFF1B\u78C1\u76D8\u4E0A\u7684\u5DE5\u7A0B\u6587\u4EF6\u4E0D\u53D7\u5F71\u54CD\u3002",
    "history.deleteGroupMessage": "\u300C{name}\u300D\u7684 {count} \u4E2A\u5386\u53F2\u7248\u672C\u4F1A\u4ECE\u5217\u8868\u4E2D\u79FB\u9664\uFF1B\u78C1\u76D8\u4E0A\u7684\u5DE5\u7A0B\u6587\u4EF6\u4E0D\u53D7\u5F71\u54CD\u3002",
    "history.deleted": "\u5DF2\u5220\u9664\u5386\u53F2\u5DE5\u7A0B",
    "history.deleteFailed": "\u5220\u9664\u5386\u53F2\u5DE5\u7A0B\u5931\u8D25\uFF1A{error}",
    // ---- 下载模型确认 ----
    "dialog.downloadModelTitle": "\u4E0B\u8F7D\u6A21\u578B\uFF1F",
    "dialog.downloadModelMessage": "\u300C{name}\u300D\u5C1A\u672A\u4E0B\u8F7D\uFF08\u7EA6 {size}\uFF09\u3002\u786E\u8BA4\u540E\u8DF3\u5230\u4E0B\u8F7D\u7BA1\u7406\u5668\u5F00\u59CB\u4E0B\u8F7D\u3002",
    "dialog.downloadModelOk": "\u4E0B\u8F7D",
    // ---- 准备运行环境（引擎 / 运行时 / 模型）----
    "setup.title.image": "\u51C6\u5907\u300CAI \u753B\u56FE\u300D",
    "setup.title.image-edit": "\u51C6\u5907\u300C\u56FE\u50CF\u7F16\u8F91\u300D",
    "setup.title.video": "\u51C6\u5907\u300CAI \u89C6\u9891\u751F\u6210\u300D",
    "setup.title.aligner": "\u51C6\u5907\u300C\u667A\u80FD\u526A\u53E3\u64AD\u300D\u5BF9\u9F50\u5668",
    "cutReview.noCloudService": "\u6240\u9009\u8BC6\u522B\u670D\u52A1\u672A\u542F\u7528\uFF0C\u8BF7\u5728\u8BBE\u7F6E \u2192 \u8BED\u97F3\u8BC6\u522B\u91CC\u542F\u7528\u3002",
    "ai.cutCloudNeedsAligner": "\u8BE5\u670D\u52A1\u65E0\u8BCD\u7EA7\u65F6\u95F4\u6233\uFF0C\u526A\u53E3\u64AD\u4F1A\u7528\u672C\u5730\u5BF9\u9F50\u5668\u8865\u65F6\u95F4",
    "setup.title.voice": "\u51C6\u5907\u300CAI \u53D8\u58F0\u300D",
    "setup.title.voiceover": "\u51C6\u5907\u300CAI \u6717\u8BFB\u300D",
    "setup.title.dub": "\u51C6\u5907\u300C\u97F3\u9891\u7FFB\u8BD1\u300D\u914D\u97F3",
    "setup.title.runtime": "\u51C6\u5907\u672C\u5730 AI \u8FD0\u884C\u65F6",
    "setup.lead": "\u8FD9\u53F0\u673A\u5668\u9002\u5408\u7528 {backend}\uFF08{reason}\uFF09\u3002\u4EE5\u4E0B\u5185\u5BB9\u9700\u8981\u5148\u4E0B\u8F7D\uFF1A",
    "setup.leadModel": "\u8FD8\u7F3A\u4EE5\u4E0B\u6A21\u578B\u6743\u91CD\uFF1A",
    "setup.recommended": "\u63A8\u8350",
    "setup.reason.nvidia": "\u68C0\u6D4B\u5230 {name}",
    "setup.reason.apple": "Apple Silicon\uFF0C\u4F7F\u7528 Metal / CoreML",
    "setup.reason.vulkan": "\u672A\u68C0\u6D4B\u5230 NVIDIA \u663E\u5361\uFF0C\u6539\u7528 Vulkan",
    "setup.reason.cpu": "\u672A\u68C0\u6D4B\u5230\u53EF\u7528\u663E\u5361\uFF0C\u6539\u7528 CPU\uFF08\u8F83\u6162\uFF09",
    "setup.reason.generic": "\u6309\u5F53\u524D\u786C\u4EF6\u9009\u62E9",
    "setup.dep.bundle": "\u4E0B\u8F7D\u540E\u4F1A\u987A\u5E26\u8865\u9F50 {count} \u4E2A\u914D\u5957\u7EC4\u4EF6",
    "setup.dep.files": "{count} \u4E2A\u6743\u91CD\u6587\u4EF6",
    "setup.installed": "\u5DF2\u5B89\u88C5",
    "setup.total": "\u5408\u8BA1\u9700\u8981\u4E0B\u8F7D {size}",
    "setup.download": "\u4E0B\u8F7D\u5E76\u5B89\u88C5\uFF08{size}\uFF09",
    "setup.background": "\u5728\u540E\u53F0\u4E0B\u8F7D",
    "setup.busy": "\u6B63\u5728\u4E0B\u8F7D {name}\u2026",
    "setup.busyStep": "\u7B2C {index}/{total} \u9879 \xB7 {pct}",
    "setup.later": "\u7A0D\u540E",
    "setup.back": "\u8FD4\u56DE",
    "setup.switch": "\u66F4\u6362\u540E\u7AEF",
    "setup.done": "\u8FD0\u884C\u73AF\u5883\u5DF2\u5C31\u7EEA",
    "setup.failed": "\u300C{name}\u300D\u4E0B\u8F7D\u5931\u8D25\uFF1A{error}",
    "setup.diskLow": "\u78C1\u76D8\u5269\u4F59\u7A7A\u95F4\u4E0D\u8DB3\uFF1A\u8FD9\u6B21\u9700\u8981\u7EA6 {size}\uFF08\u542B\u89E3\u538B\u4F59\u91CF\uFF09\uFF0C\u8BF7\u5148\u6E05\u7406\u78C1\u76D8\u518D\u8BD5\u3002",
    "setup.restartTitle": "\u9700\u8981\u91CD\u542F\u624D\u80FD\u542F\u7528 {backend}",
    "setup.restartBody": "\u65B0\u88C5\u7684\u8FD0\u884C\u65F6\u4F1A\u5360\u7528\u540C\u4E00\u4E2A\u8FDB\u7A0B\u4F4D\u7F6E\uFF0C\u4E0B\u6B21\u542F\u52A8\u624D\u4F1A\u52A0\u8F7D\u3002\u73B0\u5728\u5C31\u91CD\u542F\u5417\uFF1F",
    "setup.restartLater": "\u7A0D\u540E\u91CD\u542F",
    // ---- Toast ----
    "toast.saved": "\u5DF2\u4FDD\u5B58",
    "toast.savedAs": "\u5DF2\u53E6\u5B58\u4E3A",
    "toast.imported": "\u5DF2\u5BFC\u5165 {count} \u4E2A\u7D20\u6750",
    "toast.relinked": "\u5DF2\u91CD\u65B0\u94FE\u63A5\u7D20\u6750",
    "toast.exported": "\u5DF2\u5BFC\u51FA\u5230 {path}",
    "toast.exportCancelled": "\u5DF2\u53D6\u6D88\u5BFC\u51FA",
    "toast.recoveryRestored": "\u5DF2\u6062\u590D\u8349\u7A3F\uFF0C\u8BB0\u5F97\u4FDD\u5B58",
    "toast.nothingToUndo": "\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C",
    "toast.nothingToRedo": "\u6CA1\u6709\u53EF\u91CD\u505A\u7684\u64CD\u4F5C",
    // ---- 错误 ----
    "error.operation": "\u64CD\u4F5C\u5931\u8D25\uFF1A{error}",
    "error.save": "\u4FDD\u5B58\u5931\u8D25\uFF1A{error}",
    "error.open": "\u6253\u5F00\u5931\u8D25\uFF1A{error}",
    "error.import": "\u5BFC\u5165\u5931\u8D25\uFF1A{error}",
    "error.export": "\u5BFC\u51FA\u5931\u8D25\uFF1A{error}",
    "error.unsupportedType": "\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u7C7B\u578B\uFF1A{name}",
    "error.noDuration": "\u65E0\u6CD5\u8BFB\u53D6\u65F6\u957F\uFF1A{name}",
    "error.serialize.notObject": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u6839\u8282\u70B9\u4E0D\u662F\u5BF9\u8C61",
    "error.serialize.version": "\u5DE5\u7A0B\u7248\u672C\u4E0D\u652F\u6301\uFF1A\u671F\u671B version {expected}\uFF0C\u5B9E\u9645\u4E3A {actual}",
    "error.serialize.missingName": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u7F3A\u5C11 name",
    "error.serialize.badFps": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1Afps \u975E\u6CD5",
    "error.serialize.badResolution": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u5206\u8FA8\u7387\u975E\u6CD5",
    "error.serialize.badAssets": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1Aassets \u4E0D\u662F\u6570\u7EC4",
    "error.serialize.badTracks": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1Atracks \u4E0D\u662F\u6570\u7EC4",
    "episode.defaultName": "\u5206P {index}",
    "error.serialize.badEpisodes": "\u5DE5\u7A0B\u7F3A\u5C11\u5206P \u6570\u636E",
    "error.serialize.badActiveEpisode": "\u5DE5\u7A0B\u7F3A\u5C11\u5F53\u524D\u5206P",
    "error.serialize.badEpisode": "\u5206P \u6570\u636E\u635F\u574F",
    "error.serialize.badTrack": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u8F68\u9053\u4E0D\u662F\u5BF9\u8C61",
    "error.serialize.badClips": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u8F68\u9053\u7684 clips \u4E0D\u662F\u6570\u7EC4",
    "error.serialize.badClip": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u7247\u6BB5\u4E0D\u662F\u5BF9\u8C61",
    "error.serialize.badClipTime": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u7247\u6BB5\u7684\u65F6\u95F4\u5B57\u6BB5\u975E\u6CD5",
    "error.serialize.badJson": "\u5DE5\u7A0B\u6587\u4EF6\u4E0D\u662F\u5408\u6CD5 JSON",
    "error.command.readOnly": "\u6B63\u5728\u8DDF\u968F\u684C\u9762\u4F1A\u8BDD\uFF0C\u6682\u4E0D\u80FD\u7F16\u8F91\uFF1B\u70B9\u300C\u4EE5\u526F\u672C\u7F16\u8F91\u300D\u540E\u53EF\u4FEE\u6539\u3002",
    "session.following": "\u6B63\u5728\u8DDF\u968F\u684C\u9762\u4F1A\u8BDD",
    "session.followingHint": "\u684C\u9762\u7AEF\u7684\u6539\u52A8\u4F1A\u5B9E\u65F6\u540C\u6B65\u5230\u8FD9\u91CC\uFF08\u53EA\u8BFB\uFF09\u3002",
    "session.copy": "\u4EE5\u526F\u672C\u7F16\u8F91",
    "error.command.stale": "\u547D\u4EE4\u57FA\u4E8E\u65E7\u7248\u672C\uFF08\u5F53\u524D {expected}\uFF0C\u6536\u5230 {actual}\uFF09\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5DE5\u7A0B",
    "error.command.unknownKind": "\u672A\u77E5\u6216\u4E0D\u53EF\u6267\u884C\u7684\u547D\u4EE4\uFF1A{kind}",
    "error.command.invalidPayload": "\u547D\u4EE4\u53C2\u6570\u4E0D\u5408\u6CD5",
    "error.command.overlap": "\u7247\u6BB5\u4E0E\u8F68\u9053 {n} \u4E0A\u7684\u73B0\u6709\u7247\u6BB5\u91CD\u53E0",
    // ---- 窗口按钮 ----
    "window.minimize": "\u6700\u5C0F\u5316",
    "window.maximize": "\u6700\u5927\u5316",
    "window.restore": "\u8FD8\u539F",
    "window.close": "\u5173\u95ED",
    // ---- 智能剪口播 ----
    "panel.cutReview": "\u526A\u53E3\u64AD",
    "panel.cutReviewHint": "\u5BA1\u67E5\u53E3\u7656\u4E0E\u957F\u505C\u987F\u7684\u526A\u5207\uFF0C\u70B9\u4E00\u4E0B\u8FD8\u539F",
    "cutReview.title": "\u667A\u80FD\u526A\u53E3\u64AD",
    "cutReview.hint": "\u8BC6\u522B\u53E3\u7656\u3001\u957F\u505C\u987F\uFF0C\u526A\u5B8C\u5728\u6587\u7A3F\u91CC\u5212\u7EBF\u5BA1\u67E5\uFF1B\u70B9\u5212\u6389\u7684\u5B57\u5C31\u80FD\u8FD8\u539F\u3002",
    "cutReview.start": "\u5F00\u59CB\u8BC6\u522B",
    "cutReview.rerun": "\u91CD\u65B0\u8BC6\u522B",
    "cutReview.running": "\u6B63\u5728\u8BC6\u522B\u2026",
    "cutReview.processing": "\u5904\u7406\u4E2D\u2026",
    "cutReview.cancel": "\u53D6\u6D88",
    "cutReview.noModel": "\u6CA1\u6709\u53EF\u7528\u7684\u8BED\u97F3\u8BC6\u522B\u6A21\u578B\u3002\u526A\u53E3\u64AD\u9700\u8981 Paraformer\uFF08\u6709\u8BCD\u7EA7\u65F6\u95F4\uFF09\uFF0C\u8BF7\u5148\u5728\u6A21\u578B\u9875\u4E0B\u8F7D\u3002",
    "cutReview.noSpeech": "\u6CA1\u6709\u8BC6\u522B\u5230\u8BED\u97F3\u3002",
    "cutReview.nothingFound": "\u6CA1\u6709\u627E\u5230\u53EF\u526A\u7684\u53E3\u7656\u6216\u957F\u505C\u987F\u3002",
    "cutReview.done": "\u526A\u6389 {count} \u5904\uFF0C\u7701\u4E0B {seconds}",
    "cutReview.empty": "\u5728\u65F6\u95F4\u7EBF\u4E0A\u9009\u4E00\u4E2A\u5E26\u4EBA\u58F0\u7684\u7247\u6BB5\uFF0C\u7136\u540E\u5F00\u59CB\u8BC6\u522B\u3002",
    "cutReview.emptyCount": "\u5DF2\u526A {count} \u5904 \xB7 \u7701\u4E0B {seconds}",
    "cutReview.removedAll": "\u5168\u90E8\u8FD8\u539F",
    "cutReview.restoreOne": "\u8FD8\u539F\u8FD9\u4E00\u5904",
    "cutReview.restoreLabel": "\u8FD8\u539F\u300C{text}\u300D",
    "cutReview.restoreAllLabel": "\u8FD8\u539F\u5168\u90E8 {count} \u5904\u526A\u53E3",
    "cutReview.commandLabel": "\u667A\u80FD\u526A\u53E3\u64AD\uFF1A\u526A\u6389 {count} \u5904",
    "cutReview.pauseText": "\u505C\u987F",
    "cutReview.estimated": "\u8FD9\u4E2A\u6A21\u578B\u6CA1\u6709\u8BCD\u7EA7\u65F6\u95F4\u6233\uFF1A\u53E3\u7656\u548C\u505C\u987F\u6309\u8BED\u97F3\u6BB5\u8FB9\u754C\u526A\uFF0C\u4F4D\u7F6E\u662F\u51C6\u7684\uFF1B\u540C\u4E00\u6BB5\u91CC\u7684\u591A\u5B57\u6309\u5B57\u6570\u4F30\u7B97\uFF0C\u53EA\u6709\u624B\u52A8\u9009\u5355\u5B57\u65F6\u53EF\u80FD\u504F\u4E00\u70B9\u3002",
    "cutReview.minPause": "\u957F\u505C\u987F\u9608\u503C",
    "cutReview.includeSoft": "\u8FDE\u300C\u90A3\u4E2A / \u5C31\u662F\u300D\u8FD9\u7C7B\u53E3\u5934\u7985\u4E00\u8D77\u526A",
    "cutReview.cueTrack": "\u53E3\u64AD\u5B57\u5E55",
    "cutReview.silenceLabel": "\u9759\u97F3 {value}s",
    "cutReview.silenceCut": "\u5DF2\u526A \xB7 \u70B9\u6B64\u8FD8\u539F",
    "cutReview.silenceKeep": "\u70B9\u6B64\u526A\u6389",
    "cutReview.filterWords": "\u8FC7\u6EE4\u8BCD",
    "cutReview.filterWordsHint": "\u81EA\u5DF1\u8865\u5145\u8981\u526A\u6389\u7684\u53E3\u5934\u7985\uFF0C\u4E2D\u82F1\u6587\u90FD\u884C\uFF1B\u547D\u4E2D\u5C31\u526A\uFF0C\u4E0D\u8981\u6C42\u524D\u540E\u505C\u987F\u3002",
    "cutReview.filterPlaceholder": "\u8F93\u5165\u540E\u56DE\u8F66\u6DFB\u52A0",
    "cutReview.asrModel": "\u8BC6\u522B\u6A21\u578B",
    "cutReview.downloadMany": "\u526A\u53E3\u64AD\u9700\u8981\u5148\u4E0B\u8F7D\uFF1A{names}\uFF08\u5171 {size}\uFF09\u3002",
    "cutReview.noAligner": "\u526A\u53E3\u64AD\u9700\u8981\u5F3A\u5236\u5BF9\u9F50\u5668\uFF0C\u8BF7\u5148\u5728\u6A21\u578B\u9875\u4E0B\u8F7D Qwen3 \u5F3A\u5236\u5BF9\u9F50\u5668\u3002",
    "cutReview.locate": "\u5B9A\u4F4D",
    "cutReview.cutNoop": "\u8FD9\u6BB5\u5DF2\u7ECF\u526A\u8FC7\u4E86",
    "cutReview.selectHint": "\u70B9\u5B57\u9009\u4E2D\uFF08Delete \u526A\u6389\uFF09\uFF0C\u62D6\u9009\u53EF\u4E00\u6B21\u526A\u4E00\u6BB5\uFF1B\u6539\u5B57\u8BF7\u5230\u300C\u53E3\u64AD\u5B57\u5E55\u300D\u8F68\u7684\u7247\u6BB5\u4E0A\u6539\u3002",
    "cutReview.selectClip": "\u5148\u5728\u65F6\u95F4\u7EBF\u4E0A\u9009\u4E00\u4E2A\u5E26\u4EBA\u58F0\u7684\u7247\u6BB5\u3002",
    "cutReview.kind.filler": "\u53E3\u7656",
    "cutReview.kind.pause": "\u505C\u987F",
    "cutReview.kind.retake": "\u91CD\u590D",
    "cutReview.kind.manual": "\u624B\u52A8",
    "cutReview.seconds": "{value} \u79D2",
    "cutReview.cutSelection": "\u526A\u6389 {value}",
    "cutReview.selectionHint": "\u5DF2\u9009 {count} \u4E2A\u5B57 \xB7 {value}",
    "cutReview.analysisDone": "\u526A\u6389 {count} \u5904\uFF0C\u53BB\u6587\u7A3F\u91CC\u5BA1\u67E5",
    "cutReview.review": "\u53BB\u5BA1\u67E5",
    "cutReview.failed": "\u8BC6\u522B\u5931\u8D25\uFF1A{error}",
    "cutReview.editLabel": "\u6539\u5B57\uFF1A{text}",
    "cutReview.wordsCount": "{count} \u4E2A\u5B57",
    "cutReview.toReview": "\u53BB\u5BA1\u67E5",
    "cutReview.settings": "\u526A\u53E3\u64AD\u8BBE\u7F6E",
    "cutReview.settingsOpen": "\u8BBE\u7F6E",
    "cutReview.settingsHint": "\u8FC7\u6EE4\u8BCD\u3001\u505C\u987F\u9608\u503C\u4E0E\u5207\u70B9\u9002\u914D",
    "cutReview.settings.subtitle": "\u8FC7\u6EE4\u8BCD\u547D\u4E2D\u5C31\u526A\uFF1B\u505C\u987F\u4E0E\u5207\u70B9\u5728\u8FD9\u91CC\u7EDF\u4E00\u8C03\u3002",
    "cutReview.settings.custom": "\u81EA\u5B9A\u4E49\u8FC7\u6EE4\u8BCD",
    "cutReview.settings.customEmpty": "\u8FD8\u6CA1\u6709\u81EA\u5B9A\u4E49\u8FC7\u6EE4\u8BCD\u3002\u8F93\u5165\u300C\u554A\u5C31\u300D\u6216\u300Cyou know\u300D\uFF0C\u56DE\u8F66\u5373\u53EF\u6DFB\u52A0\u3002",
    "cutReview.settings.defaultWords": "\u9ED8\u8BA4\u8FC7\u6EE4\u8BCD",
    "cutReview.settings.hardGroup": "\u8BED\u6C14\u8BCD \xB7 \u76F4\u63A5\u526A",
    "cutReview.settings.softGroup": "\u53E3\u5934\u7985 \xB7 \u524D\u540E\u6709\u505C\u987F\u624D\u526A",
    "cutReview.settings.restoreWords": "\u6062\u590D\u9ED8\u8BA4\u8FC7\u6EE4\u8BCD",
    "cutReview.settings.removedDefaults": "\u5DF2\u79FB\u9664 {count} \u4E2A\u9ED8\u8BA4\u8BCD",
    "cutReview.settings.pause": "\u505C\u987F",
    "cutReview.settings.minPause": "\u957F\u505C\u987F\u9608\u503C",
    "cutReview.settings.minPauseHint": "\u4E24\u6BB5\u8BDD\u4E4B\u95F4\u8D85\u8FC7\u8FD9\u4E2A\u65F6\u957F\u5C31\u526A\u77ED\u3002",
    "cutReview.settings.keep": "\u6BB5\u4E2D\u4FDD\u7559",
    "cutReview.settings.keepHint": "\u526A\u5B8C\u505C\u987F\u540E\uFF0C\u53E5\u4E0E\u53E5\u4E4B\u95F4\u7559\u4E0B\u7684\u547C\u5438\u65F6\u95F4\u3002",
    "cutReview.settings.sentenceKeep": "\u53E5\u672B\u4FDD\u7559",
    "cutReview.settings.sentenceKeepHint": "\u53E5\u53F7\u3001\u95EE\u53F7\u540E\u9762\u7684\u505C\u987F\u7559\u5F97\u7A0D\u957F\u4E00\u70B9\u3002",
    "cutReview.settings.includeSoft": "\u8FDE\u300C\u90A3\u4E2A / \u5C31\u662F\u300D\u4E00\u8D77\u526A",
    "cutReview.settings.includeSoftHint": "\u5173\u6389\u540E\u53EA\u526A\u300C\u55EF / \u5443 / um\u300D\u8FD9\u7C7B\u7EAF\u8BED\u6C14\u8BCD\u3002",
    "cutReview.settings.trim": "\u5207\u70B9\u9002\u914D",
    "cutReview.settings.trimPad": "\u5411\u9759\u97F3\u6269\u5C55\u5207\u70B9",
    "cutReview.settings.trimPadHint": "\u65F6\u95F4\u6233\u5E38\u5E38\u5361\u5728\u5B57\u97F3\u7684\u5CF0\u503C\u4E0A\uFF1B\u5411\u4E24\u4FA7\u9759\u97F3\u591A\u5207\u4E00\u70B9\uFF0C\u526A\u5B8C\u5C31\u4E0D\u4F1A\u6B8B\u7559\u534A\u58F0\u300C\u55EF\u300D\u3002",
    "cutReview.settings.trimPadValue": "{value} \u6BEB\u79D2",
    "cutReview.settings.seconds": "{value} \u79D2",
    "cutReview.settings.add": "\u6DFB\u52A0",
    "cutReview.settings.resetAll": "\u5168\u90E8\u6062\u590D\u9ED8\u8BA4",
    "cutReview.settings.done": "\u5B8C\u6210",
    "cutReview.settings.added": "\u5DF2\u6DFB\u52A0\u8FC7\u6EE4\u8BCD\u300C{word}\u300D",
    "cutReview.settings.duplicate": "\u8FD9\u4E2A\u8FC7\u6EE4\u8BCD\u5DF2\u7ECF\u5728\u5217\u8868\u91CC\u4E86",
    "cutReview.settings.wordsRestored": "\u5DF2\u6062\u590D\u9ED8\u8BA4\u8FC7\u6EE4\u8BCD",
    "cutReview.settings.allReset": "\u5DF2\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E",
    "audio.cutFillers": "\u667A\u80FD\u526A\u53E3\u64AD",
    "audio.cutFillersHint": "\u8BC6\u522B\u53E3\u7656\u3001\u957F\u505C\u987F\u5E76\u526A\u6389\uFF0C\u5728\u6587\u7A3F\u91CC\u5212\u7EBF\u5BA1\u67E5\uFF0C\u70B9\u4E00\u4E0B\u8FD8\u539F",
    "audio.cutFillersRun": "\u5F00\u59CB\u8BC6\u522B",
    "audio.cutFillersReview": "\u53BB\u5BA1\u67E5",
    "settings.store.hfToken": "Hugging Face token",
    "settings.store.hfTokenHint": "\u53EA\u7528\u4E8E\u9700\u8981\u5148\u540C\u610F\u8BB8\u53EF\u7684\u6A21\u578B\uFF08gated \u4ED3\u5E93\uFF09\uFF1B\u53EA\u53D1\u7ED9 huggingface.co\uFF0C\u4FDD\u5B58\u5728\u672C\u673A\u3002",
    "settings.store.hfTokenPlaceholder": "hf_\u2026\uFF08\u7559\u7A7A = \u533F\u540D\u4E0B\u8F7D\uFF09",
    "settings.store.hfTokenSet": "\u5DF2\u914D\u7F6E {hint}",
    "settings.store.hfTokenSave": "\u4FDD\u5B58",
    "settings.store.hfTokenClear": "\u6E05\u9664",
    // ---- 三视图 / 剧集 / 画布 ----
    "view.switch": "\u5207\u6362\u754C\u9762",
    "view.preview": "\u9884\u89C8",
    "view.previewHint": "\u9884\u89C8\u53F0\u4E0E\u65F6\u95F4\u7EBF\uFF08\u23181\uFF09",
    "view.board": "\u753B\u5E03",
    "view.boardHint": "\u65E0\u9650\u753B\u5E03\uFF1A\u7528\u8282\u70B9\u7EC4\u5408 AI \u80FD\u529B\uFF08\u23182\uFF09",
    "view.series": "\u5267\u96C6",
    "view.seriesHint": "\u672C\u5DE5\u7A0B\u6240\u6709\u5206P \u7684\u603B\u89C8\uFF08\u23183\uFF09",
    "series.title": "\u5206P",
    "series.total": "\u5171 {count} \u4E2A\u5206P",
    "series.search": "\u641C\u7D22\u5206P",
    "series.viewMode": "\u663E\u793A\u65B9\u5F0F",
    "series.view.tile": "\u5E73\u94FA",
    "series.view.graph": "\u8FDE\u7EBF",
    "series.preview": "\u9884\u89C8",
    "series.branchCount": "{count} \u4E2A\u9009\u9879",
    "series.orphan": "\u672A\u63A5\u5165",
    "series.graph.fit": "\u9002\u5E94\u89C6\u56FE",
    "series.graph.autoLayout": "\u81EA\u52A8\u6392\u5217",
    "series.graph.rebuild": "\u6309\u65F6\u95F4\u987A\u5E8F\u91CD\u5EFA",
    "series.graph.rebuildTitle": "\u91CD\u5EFA\u5267\u96C6\u8FDE\u7EBF",
    "series.graph.rebuildMessage": "\u8FD9\u4F1A\u5220\u6389\u6240\u6709\u624B\u52A8\u8FDE\u7EBF\u548C\u9009\u9879\uFF0C\u6309\u5206P \u7684\u5F53\u524D\u987A\u5E8F\u751F\u6210\u4E00\u6761\u65F6\u95F4\u94FE\u3002",
    "series.graph.rebuildDone": "\u5DF2\u6309\u65F6\u95F4\u987A\u5E8F\u91CD\u5EFA",
    "series.graph.zoomIn": "\u653E\u5927",
    "series.graph.zoomOut": "\u7F29\u5C0F",
    "series.edge.label": "\u9009\u9879\u540D",
    "series.edge.labelPlaceholder": "\u9009\u9879 {index}",
    "series.edge.delete": "\u5220\u9664\u8FDE\u7EBF",
    "series.edge.route": "{from} \u2192 {to}",
    "series.graph.toolbar": "\u5267\u96C6\u753B\u5E03\u5DE5\u5177",
    "series.mode.drag": "\u62D6\u52A8\u753B\u9762",
    "series.mode.marquee": "\u6846\u9009",
    "series.ctx.duplicate": "\u521B\u5EFA\u526F\u672C",
    "series.ctx.copy": "\u590D\u5236",
    "series.ctx.cut": "\u526A\u5207",
    "series.ctx.paste": "\u7C98\u8D34",
    "series.ctx.copied": "\u5DF2\u590D\u5236\u5206P",
    "series.ctx.cutDone": "\u5DF2\u526A\u5207\u5206P",
    "series.ctx.pasted": "\u5DF2\u7C98\u8D34\u5206P",
    "series.choice.unnamed": "\u9009\u9879 {index}",
    "series.choices.title": "\u672C\u96C6\u7ED3\u675F\uFF0C\u9009\u62E9\u63A5\u4E0B\u6765\u64AD\u653E",
    "series.playback.ended": "\u5267\u96C6\u7ED3\u675F",
    "series.playback.loop": "\u5267\u96C6\u7ED5\u56DE\u4E86\u300C{name}\u300D\uFF0C\u81EA\u52A8\u8FDE\u64AD\u5DF2\u505C\u6B62",
    "series.timeline": "\u65F6\u95F4\u7EBF",
    "series.newEpisode": "\u65B0\u5EFA\u5206P",
    "series.newEpisodeName": "\u5206P {index}",
    "series.duplicate": "\u590D\u5236\u5206P",
    "series.duplicateSuffix": "{name} \u526F\u672C",
    "series.deleteTitle": "\u5220\u9664\u5206P",
    "series.deleteMessage": "\u300C{name}\u300D\u7684\u65F6\u95F4\u7EBF\u4F1A\u88AB\u5220\u9664\uFF0C\u7D20\u6750\u4E0E\u753B\u5E03\u4E0D\u53D7\u5F71\u54CD\u3002",
    "series.keepLast": "\u81F3\u5C11\u8981\u4FDD\u7559\u4E00\u4E2A\u5206P",
    "series.empty": "\u8FD9\u4E2A\u5DE5\u7A0B\u8FD8\u6CA1\u6709\u5206P",
    "series.emptyHint": "\u65B0\u5EFA\u4E00\u4E2A\u5206P\uFF0C\u5F00\u59CB\u526A\u8F91\u8FD9\u4E00\u96C6\u3002",
    "series.emptySearch": "\u6CA1\u6709\u5339\u914D\u7684\u5206P",
    "series.tracks": "{count} \u6761\u8F68\u9053",
    "series.clips": "{count} \u4E2A\u7247\u6BB5",
    "series.current": "\u5F53\u524D",
    "board.emptyTitle": "\u7528\u8282\u70B9\u7EC4\u5408 AI \u80FD\u529B",
    "board.emptyHint": "\u8F93\u5165 \u2192 \u6A21\u578B \u2192 \u663E\u793A\uFF0C\u628A\u56FE\u7247\u3001\u97F3\u9891\u3001\u89C6\u9891\u53C2\u8003\u63A5\u5230\u4E00\u4E2A\u6A21\u578B\u8282\u70B9\u4E0A\uFF0C\u8DD1\u5B8C\u81EA\u52A8\u8FDB\u7D20\u6750\u5E93\u3002",
    "board.addNode": "\u6DFB\u52A0\u8282\u70B9",
    "board.showTimeline": "\u5C55\u5F00\u65F6\u95F4\u7EBF",
    "board.hideTimeline": "\u6536\u8D77\u65F6\u95F4\u7EBF",
    "board.toolbar": "\u753B\u5E03\u5DE5\u5177\u680F",
    "board.pan": "\u62D6\u52A8\u6A21\u5F0F",
    "board.zoomOut": "\u7F29\u5C0F",
    "board.zoom": "{value}%",
    "board.zoomGroup": "\u7F29\u653E",
    // ---- 画布节点 ----
    "board.undo": "\u64A4\u9500",
    "board.redo": "\u91CD\u505A",
    "board.fit": "\u9002\u5E94\u89C6\u56FE",
    "board.zoomIn": "\u653E\u5927",
    "board.panHint": "\u6EDA\u8F6E\u5E73\u79FB \xB7 \u6846\u9009\u591A\u9009",
    "board.category.input": "\u8F93\u5165",
    "board.category.display": "\u663E\u793A",
    "board.category.model": "\u6A21\u578B",
    "board.category.group": "\u903B\u8F91",
    "board.type.text": "\u6587\u672C",
    "board.type.image": "\u56FE\u7247",
    "board.type.video": "\u89C6\u9891",
    "board.type.audio": "\u97F3\u9891",
    "board.type.integer": "\u6574\u6570",
    "board.type.number": "\u6D6E\u70B9\u6570",
    "board.type.boolean": "\u5E03\u5C14\u503C",
    "board.type.json": "JSON",
    "board.type.any": "\u4EFB\u610F",
    "board.value.empty": "\u6682\u65E0\u503C",
    "board.value.legacyText": "\u6587\u672C\uFF08\u9057\u7559\uFF09",
    "board.value.true": "\u662F",
    "board.value.false": "\u5426",
    "board.node.inputImage": "\u56FE\u7247\u8F93\u5165",
    "board.node.inputVideo": "\u89C6\u9891\u8F93\u5165",
    "board.node.inputAudio": "\u97F3\u9891\u8F93\u5165",
    "board.node.inputText": "\u6587\u672C\u8F93\u5165",
    "board.node.inputValue": "\u503C\u8F93\u5165",
    "board.node.displayText": "\u6587\u672C\u663E\u793A",
    "board.node.displayValue": "\u503C\u663E\u793A",
    "board.node.loop": "\u5FAA\u73AF",
    "board.node.loopStart": "\u5FAA\u73AF\u5F00\u59CB",
    "board.param.loopInputs": "\u8F93\u5165\u6570\u91CF",
    "board.loop.inputs": "\u8F93\u5165",
    "board.loop.inputN": "\u8F93\u5165 {n}",
    "board.loop.addInput": "\u65B0\u5EFA\u8F93\u5165",
    "board.loop.removeInput": "\u5220\u9664\u8F93\u5165",
    "board.port.number": "\u6570\u5B57",
    "board.port.integer": "\u6574\u6570",
    "board.port.boolean": "\u5E03\u5C14\u503C",
    "board.port.json": "JSON",
    "board.port.any": "\u4EFB\u610F",
    "board.node.loopEnd": "\u5FAA\u73AF\u7ED3\u675F",
    "board.param.loopMode": "\u5FAA\u73AF\u65B9\u5F0F",
    "board.param.loopCount": "\u5FAA\u73AF\u6B21\u6570",
    "board.param.loopSlots": "\u8F93\u51FA\u69FD\u4F4D",
    "board.loopMode.array": "\u6309\u6570\u7EC4",
    "board.loopMode.count": "\u6309\u6B21\u6570",
    "board.port.items": "\u5217\u8868",
    "board.port.item": "\u5F53\u524D\u9879",
    "board.port.index": "\u5E8F\u53F7",
    "board.port.slot": "\u503C",
    "board.port.list": "\u6574\u7EC4",
    "board.node.displayImage": "\u56FE\u7247\u663E\u793A",
    "board.node.displayVideo": "\u89C6\u9891\u663E\u793A",
    "board.node.displayAudio": "\u97F3\u9891\u663E\u793A",
    "board.node.noAsset": "\u672A\u9009\u62E9\u7D20\u6750",
    "board.node.noText": "\u7A7A\u6587\u672C",
    "board.node.modelHint": "\u6A21\u578B\u8282\u70B9",
    "board.port.image": "\u56FE\u7247",
    "board.port.video": "\u89C6\u9891",
    "board.port.audio": "\u97F3\u9891",
    "board.port.text": "\u6587\u672C",
    "board.port.value": "\u503C",
    "board.port.prompt": "\u63D0\u793A\u8BCD\u8F93\u5165",
    "board.port.negative": "\u53CD\u5411\u63D0\u793A\u8BCD\u8F93\u5165",
    "board.port.stemVocals": "\u4EBA\u58F0",
    "board.port.stemDrums": "\u9F13",
    "board.port.stemBass": "\u8D1D\u65AF",
    "board.port.stemOther": "\u5176\u5B83",
    "board.port.stemGuitar": "\u5409\u4ED6",
    "board.port.stemPiano": "\u94A2\u7434",
    "board.port.stemAccompaniment": "\u4F34\u594F",
    "board.param.textMode": "\u663E\u793A\u65B9\u5F0F",
    "board.param.valueKind": "\u503C\u7C7B\u578B",
    "board.param.value": "\u503C",
    "board.textMode.markdown": "Markdown",
    "board.textMode.plain": "\u7EAF\u6587\u672C",
    "board.inspect.localGroup": "\u672C\u5730\u5F15\u64CE",
    "board.param.text": "\u6587\u672C\u5185\u5BB9",
    "board.status.skipped": "\u5DF2\u8DF3\u8FC7",
    "board.node.group": "\u7EC4",
    "board.group.count": "{count} \u4E2A\u8282\u70B9",
    "board.group.empty": "\u628A\u8282\u70B9\u62D6\u8FDB\u8FD9\u4E2A\u6846\uFF0C\u6216\u9009\u4E2D\u8282\u70B9\u540E\u6309 \u2318G \u521B\u5EFA\u7EC4",
    "board.group.tone": "\u7EC4\u6846\u8272\u8C03",
    "board.group.tone.lavender": "\u85B0\u8863\u8349",
    "board.group.tone.blue": "\u84DD\u8272",
    "board.group.tone.green": "\u7EFF\u8272",
    "board.group.tone.coral": "\u73CA\u745A",
    "board.group.tone.amber": "\u7425\u73C0",
    "board.group.needSelection": "\u5148\u9009\u4E2D\u81F3\u5C11\u4E24\u4E2A\u8282\u70B9\uFF0C\u518D\u521B\u5EFA\u7EC4",
    "board.run.runHint": "\u8FD0\u884C\u6574\u4E2A\u5DE5\u4F5C\u6D41\uFF08\u6309\u4F9D\u8D56\u987A\u5E8F\uFF09",
    "board.run.alwaysHint": "\u4E0A\u6E38\u8F93\u51FA\u66F4\u65B0\u540E\uFF0C\u81EA\u52A8\u8FD0\u884C\u5B83\u540E\u9762\u7684\u8282\u70B9",
    "board.ctx.bypass": "\u65C1\u8DEF\u8282\u70B9",
    "board.ctx.bypassOff": "\u53D6\u6D88\u65C1\u8DEF",
    "board.ctx.groupCreate": "\u521B\u5EFA\u7EC4",
    "board.ctx.groupCreateHint": "\u628A\u9009\u4E2D\u7684\u8282\u70B9\u6846\u8FDB\u4E00\u4E2A\u7EC4\uFF08\u5FEB\u6377\u952E \u2318G\uFF09",
    "board.ctx.groupSelect": "\u9009\u4E2D\u7EC4\u5185\u8282\u70B9",
    "board.ctx.ungroup": "\u89E3\u6563\u7EC4",
    // ---- 工作流库 / 组节点 / 并行调度 ----
    "board.library.title": "\u5DE5\u4F5C\u6D41\u5E93",
    "board.library.sub": "\u9ED8\u8BA4\u5DE5\u4F5C\u6D41 + \u4FDD\u5B58\u8FC7\u7684\u753B\u5E03\uFF0C\u6309\u7248\u672C\u7BA1\u7406",
    "board.library.save": "\u4FDD\u5B58",
    "board.library.saveCurrent": "\u4FDD\u5B58\u5F53\u524D\u753B\u5E03\u5230\u5DE5\u4F5C\u6D41\u5E93",
    "board.library.saveTitle": "\u4FDD\u5B58\u5DE5\u4F5C\u6D41",
    "board.library.nameLabel": "\u5DE5\u4F5C\u6D41\u540D\u79F0",
    "board.library.namePlaceholder": "\u4F8B\u5982\uFF1A\u7AD6\u5C4F\u53E3\u64AD\u7247\u5934",
    "board.library.search": "\u641C\u7D22\u5DE5\u4F5C\u6D41",
    "board.library.filterAll": "\u5168\u90E8",
    "board.library.filterBuiltin": "\u9ED8\u8BA4",
    "board.library.filterMine": "\u6211\u7684",
    "board.library.empty": "\u8FD8\u6CA1\u6709\u4FDD\u5B58\u7684\u5DE5\u4F5C\u6D41",
    "board.library.emptyHint": "\u5728\u753B\u5E03\u5DE5\u5177\u680F\u70B9\u4FDD\u5B58\uFF0C\u6216\u4ECE\u8FD9\u91CC\u4FDD\u5B58\u5F53\u524D\u753B\u5E03",
    "board.library.loading": "\u6B63\u5728\u8BFB\u53D6\u5DE5\u4F5C\u6D41\u5E93\u2026",
    "board.library.insert": "\u63D2\u5165\u5230\u753B\u5E03",
    "board.library.insertVersion": "\u63D2\u5165\u8FD9\u4E2A\u7248\u672C",
    "board.library.restore": "\u63D2\u5165",
    "board.library.rename": "\u91CD\u547D\u540D",
    "board.library.renameTitle": "\u91CD\u547D\u540D\u5DE5\u4F5C\u6D41",
    "board.library.delete": "\u5220\u9664\u5DE5\u4F5C\u6D41",
    "board.library.deleteTitle": "\u5220\u9664\u5DE5\u4F5C\u6D41",
    "board.library.deleteMessage": "\u300C{name}\u300D\u7684\u5168\u90E8\u7248\u672C\u4F1A\u4ECE\u5DE5\u4F5C\u6D41\u5E93\u5220\u9664\uFF0C\u753B\u5E03\u4E0E\u5DE5\u7A0B\u4E0D\u53D7\u5F71\u54CD\u3002",
    "board.library.deleted": "\u5DE5\u4F5C\u6D41\u5DF2\u5220\u9664",
    "board.library.saved": "\u5DF2\u4FDD\u5B58\u300C{name}\u300Dv{version}",
    "board.library.savedAndCleared": "\u5DF2\u4FDD\u5B58\u300C{name}\u300D\u5E76\u6E05\u7A7A\u753B\u5E03",
    "board.library.clearedWithoutSave": "\u753B\u5E03\u5DF2\u6E05\u7A7A\uFF08\u4FDD\u5B58\u5931\u8D25\uFF09",
    "board.library.inserted": "\u5DF2\u63D2\u5165 {count} \u4E2A\u8282\u70B9",
    "board.library.loadFailed": "\u5DE5\u4F5C\u6D41\u8BFB\u53D6\u5931\u8D25",
    "board.library.currentVersion": "\u5F53\u524D\uFF1A{name} \xB7 v{version}",
    "board.library.currentBadge": "\u5F53\u524D\u753B\u5E03",
    "board.library.builtinBadge": "\u9ED8\u8BA4",
    "board.library.mineBadge": "\u6211\u7684",
    "board.library.meta": "{nodes} \u8282\u70B9 \xB7 {edges} \u8FDE\u7EBF \xB7 {date}",
    "board.library.defaultName": "{name} \xB7 \u5DE5\u4F5C\u6D41",
    "board.library.untitled": "\u672A\u547D\u540D\u5DE5\u7A0B",
    "board.library.emptyCanvas": "\u753B\u5E03\u662F\u7A7A\u7684\uFF0C\u5148\u6DFB\u52A0\u8282\u70B9\u518D\u4FDD\u5B58",
    "board.library.openLibrary": "\u6253\u5F00\u5DE5\u4F5C\u6D41\u5E93",
    "board.library.builtin.textToImage": "\u6587\u751F\u56FE",
    "board.library.builtin.textToImageHint": "\u6587\u672C \u2192 \u56FE\u50CF\u751F\u6210 \u2192 \u56FE\u7247\u663E\u793A\uFF08\u5728\u68C0\u67E5\u5668\u9009\u597D\u6A21\u578B\uFF09",
    "board.library.builtin.imageEdit": "\u53C2\u8003\u56FE\u6539\u56FE",
    "board.library.builtin.imageEditHint": "\u53C2\u8003\u56FE + \u6307\u4EE4 \u2192 \u56FE\u50CF\u751F\u6210 \u2192 \u56FE\u7247\u663E\u793A\uFF08\u5728\u68C0\u67E5\u5668\u9009\u597D\u6A21\u578B\uFF09",
    "board.library.builtin.imageToVideo": "\u56FE\u751F\u89C6\u9891",
    "board.library.builtin.imageToVideoHint": "\u9996\u5E27 + \u63D0\u793A\u8BCD \u2192 \u89C6\u9891\u751F\u6210 \u2192 \u89C6\u9891\u663E\u793A\uFF08\u5728\u68C0\u67E5\u5668\u9009\u597D\u6A21\u578B\uFF09",
    "board.library.builtin.textRevise": "\u6587\u672C\u6539\u5199",
    "board.library.builtin.textReviseHint": "\u6587\u672C \u2192 \u6587\u672C\u751F\u6210 \u2192 \u6587\u672C\u663E\u793A\uFF08\u9009\u597D\u6587\u672C\u6A21\u578B\uFF09",
    "board.ctx.copy": "\u590D\u5236",
    "board.ctx.selectionHint": "\u5DF2\u9009 {count} \u4E2A\u8282\u70B9\uFF0C\u4EE5\u4E0B\u64CD\u4F5C\u4F5C\u7528\u4E8E\u5168\u90E8",
    "board.ctx.cut": "\u526A\u5207",
    "board.ctx.paste": "\u7C98\u8D34",
    "board.ctx.copied": "\u5DF2\u590D\u5236 {count} \u4E2A\u8282\u70B9",
    "board.ctx.pasted": "\u5DF2\u7C98\u8D34 {count} \u4E2A\u8282\u70B9",
    "board.ctx.groupRun": "\u8FD0\u884C\u6574\u7EC4",
    "board.ctx.rebuildGroup": "\u91CD\u5EFA\u6574\u7EC4",
    "board.drop.workflow": "\u677E\u624B\u63D2\u5165\u5DE5\u4F5C\u6D41",
    "board.lane.instant": "\u5373\u65F6\u53D1\u5E03",
    "board.lane.api": "\u4E91\u7AEF API",
    "board.lane.gpu": "\u672C\u5730 GPU",
    "board.lane.cpu": "\u672C\u5730 CPU",
    "board.workflow.filter": "AI Cut \u5DE5\u4F5C\u6D41",
    "board.workflow.suffix": "\u5DE5\u4F5C\u6D41",
    "board.workflow.exported": "\u5DE5\u4F5C\u6D41\u5DF2\u5BFC\u51FA",
    "board.workflow.imported": "\u5DF2\u5BFC\u5165 {count} \u4E2A\u8282\u70B9",
    "board.workflow.invalid": "\u8FD9\u4E2A\u6587\u4EF6\u4E0D\u662F\u6709\u6548\u7684 AI Cut \u5DE5\u4F5C\u6D41",
    "board.workflow.empty": "\u753B\u5E03\u8FD8\u662F\u7A7A\u7684\uFF0C\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u5DE5\u4F5C\u6D41",
    "board.workflow.dropHint": "\u677E\u624B\u5BFC\u5165\u5DE5\u4F5C\u6D41",
    "board.status.idle": "\u7A7A\u95F2",
    "board.status.queued": "\u6392\u961F\u4E2D",
    "board.status.running": "\u8FD0\u884C\u4E2D",
    "board.status.done": "\u5B8C\u6210",
    "board.status.error": "\u5931\u8D25",
    "board.status.stale": "\u5DF2\u8FC7\u671F",
    "board.status.streaming": "\u6D41\u5F0F\u8F93\u51FA",
    "board.status.thinking": "\u601D\u8003\u4E2D",
    "board.status.processing": "\u5904\u7406\u4E2D",
    "board.status.generating": "\u751F\u6210\u4E2D",
    "panel.boardInspector": "\u753B\u5E03\u68C0\u67E5\u5668",
    "panel.boardInspectorHint": "\u753B\u5E03\u5217\u8868\u3001\u8282\u70B9\u53C2\u6570\u3001\u5DE5\u4F5C\u6D41\u7B7E\u540D\u4E0E\u53D1\u5E03",
    "panel.workflowLibrary": "\u5DE5\u4F5C\u6D41\u5E93",
    "panel.workflowLibraryHint": "\u9ED8\u8BA4\u5DE5\u4F5C\u6D41\u4E0E\u4FDD\u5B58\u8FC7\u7684\u753B\u5E03\uFF08\u5E26\u7248\u672C\uFF09",
    "board.inspect.node": "\u8282\u70B9",
    "board.inspect.media": "\u7D20\u6750",
    "board.inspect.params": "\u53C2\u6570",
    "board.inspect.actions": "\u64CD\u4F5C",
    "board.inspect.pickFile": "\u9009\u62E9\u672C\u5730\u6587\u4EF6",
    "board.inspect.pickAsset": "\u4ECE\u7D20\u6750\u5E93\u9009\u62E9",
    "board.inspect.clearMedia": "\u6E05\u9664",
    "board.inspect.insertTimeline": "\u63D2\u5165\u5F53\u524D\u5206P \u65F6\u95F4\u7EBF",
    "board.inspect.inserted": "\u5DF2\u63D2\u5165\u5F53\u524D\u5206P \u65F6\u95F4\u7EBF",
    "board.inspect.insertFailed": "\u7D20\u6750\u65F6\u957F\u672A\u77E5\uFF0C\u672A\u80FD\u63D2\u5165\u65F6\u95F4\u7EBF",
    "board.inspect.copyPath": "\u590D\u5236\u8DEF\u5F84",
    "board.inspect.pathCopied": "\u5DF2\u590D\u5236\u7D20\u6750\u8DEF\u5F84",
    "board.inspect.empty": "\u6CA1\u6709\u9009\u4E2D\u8282\u70B9",
    "board.inspect.emptyHint": "\u5728\u753B\u5E03\u4E0A\u70B9\u9009\u4E00\u4E2A\u8282\u70B9\uFF0C\u53C2\u6570\u3001\u7D20\u6750\u4E0E\u8FD0\u884C\u72B6\u6001\u90FD\u5728\u8FD9\u91CC\u7F16\u8F91\u3002",
    "board.node.modelImage": "\u56FE\u50CF\u751F\u6210",
    "board.node.modelVideo": "\u89C6\u9891\u751F\u6210",
    "board.node.modelTts": "\u8BED\u97F3\u5408\u6210",
    "board.node.modelAsr": "\u8BED\u97F3\u8BC6\u522B",
    "board.node.modelText": "\u6587\u672C\u751F\u6210",
    "board.node.modelEnhance": "\u753B\u9762\u589E\u5F3A",
    "board.node.modelSeparate": "\u97F3\u9891\u5206\u79BB",
    "board.node.modelDemux": "\u89C6\u9891\u97F3\u9891\u5206\u79BB",
    "board.node.demuxSubtitle": "\u753B\u9762\u53BB\u97F3\u8F68 + \u62BD\u53D6\u72EC\u7ACB\u97F3\u8F68",
    "board.node.modelTextKind": "\u6587\u672C\u6A21\u578B",
    "board.node.modelCloud": "\u4E91\u7AEF\u670D\u52A1",
    "board.node.localProcess": "\u672C\u5730\u5904\u7406",
    "board.node.nextOutput": "\u4E0B\u4E00\u5F20\u8F93\u51FA",
    "board.node.imageNeedsInput": "\u63D0\u793A\u8BCD\u4E3A\u7A7A\uFF1A\u6587\u751F\u56FE\u9700\u8981\u5199\u63D0\u793A\u8BCD\uFF0C\u6216\u5148\u63A5\u4E00\u5F20\u53C2\u8003\u56FE",
    "board.node.defaultEditPrompt": "\u57FA\u4E8E\u53C2\u8003\u56FE\u91CD\u65B0\u7ED8\u5236\uFF0C\u4FDD\u7559\u6784\u56FE\u4E0E\u4E3B\u4F53\uFF0C\u7EC6\u8282\u81EA\u7136\u3002",
    "board.param.model": "\u6A21\u578B",
    "board.param.prompt": "\u63D0\u793A\u8BCD",
    "board.param.promptOptionalHint": "\u53EF\u4EE5\u7559\u7A7A\uFF1A\u53EA\u63A5\u53C2\u8003\u56FE\u65F6\u6309\u53C2\u8003\u56FE\u91CD\u7ED8\uFF1B\u6587\u751F\u56FE\u5FC5\u987B\u5199\u63D0\u793A\u8BCD\u3002\u68C0\u67E5\u5668\u91CC\u8FDE\u4E86\u63D0\u793A\u8BCD\u8F93\u5165\u65F6\u4EE5\u8FDE\u7EBF\u4E3A\u51C6\u3002",
    "board.param.negative": "\u53CD\u5411\u63D0\u793A\u8BCD",
    "board.param.negativeVideoHint": "\u90E8\u5206\u4E91\u7AEF\u89C6\u9891\u670D\u52A1\u652F\u6301\u8D1F\u5411\u63D0\u793A\u8BCD\uFF1B\u672C\u5730\u6A21\u578B\u4F7F\u7528\u5BB6\u65CF\u5185\u7F6E\u7684\u8D1F\u5411\u8BCD\u3002",
    "board.param.negativeOptionalHint": "\u4E5F\u53EF\u4EE5\u4ECE\u68C0\u67E5\u5668\u7684\u300C\u53CD\u5411\u63D0\u793A\u8BCD\u8F93\u5165\u300D\u8FDE\u4E00\u4E2A\u6587\u672C\u8282\u70B9\uFF1B\u8FDE\u7EBF\u4F18\u5148\u4E8E\u8FD9\u91CC\u7684\u5185\u5BB9\u3002",
    "board.param.size": "\u5206\u8FA8\u7387",
    "board.param.sizeHint": "\u751F\u6210\u7ED3\u679C\u7684\u8F93\u51FA\u5C3A\u5BF8 / \u753B\u5E45\uFF0C\u548C\u8282\u70B9\u5361\u7247\u5927\u5C0F\u65E0\u5173\uFF08\u5361\u7247\u5927\u5C0F\u62D6\u53F3\u4E0B\u89D2\u8C03\u6574\uFF09\u3002",
    "board.param.sizeCustom": "\u81EA\u5B9A\u4E49\u2026",
    "board.param.sizeAuto": "\u7531\u6A21\u578B / \u8F93\u5165\u7D20\u6750\u51B3\u5B9A\uFF08\u63A5\u53E3\u4E0D\u4F20\u5C3A\u5BF8\uFF09",
    "board.param.width": "\u751F\u6210\u5BBD\u5EA6",
    "board.param.height": "\u751F\u6210\u9AD8\u5EA6",
    "board.param.steps": "\u91C7\u6837\u6B65\u6570",
    "board.param.seed": "\u968F\u673A\u79CD\u5B50",
    "board.param.seconds": "\u65F6\u957F\uFF08\u79D2\uFF09",
    "board.param.scale": "\u653E\u5927\u500D\u6570",
    "board.param.factor": "\u63D2\u5E27\u500D\u6570",
    "board.param.enhanceOp": "\u5904\u7406\u65B9\u5F0F",
    "board.param.refImage": "\u53C2\u8003\u56FE",
    "board.port.firstFrame": "\u9996\u5E27",
    "board.port.lastFrame": "\u5C3E\u5E27",
    "board.port.refImage": "\u53C2\u8003\u56FE",
    "board.port.refImageN": "\u53C2\u8003\u56FE {n}",
    "board.port.refAudioN": "\u53C2\u8003\u97F3\u9891 {n}",
    "board.port.refVideoN": "\u53C2\u8003\u89C6\u9891 {n}",
    "board.port.refAudio": "\u53C2\u8003\u97F3\u9891",
    "board.port.refText": "\u53C2\u8003\u6587\u672C",
    "board.port.refVideo": "\u53C2\u8003\u89C6\u9891",
    "board.param.systemPromptPlaceholder": "\u63CF\u8FF0\u6A21\u578B\u7684\u8EAB\u4EFD\u3001\u8BED\u6C14\u4E0E\u9650\u5236\uFF0C\u4F8B\u5982\uFF1A\u4F60\u662F\u77ED\u89C6\u9891\u6587\u6848\u52A9\u624B\uFF0C\u53EA\u8F93\u51FA\u4E00\u6761\u6807\u9898",
    "board.param.promptPlaceholder": "\u5199\u4E0B\u8FD9\u6B21\u8981\u751F\u6210\u7684\u5185\u5BB9\uFF1B\u4E0A\u6E38\u8FDE\u8FDB\u6765\u7684\u6587\u672C\u4F1A\u4E00\u8D77\u5E26\u4E0A",
    "board.param.textModel": "\u6587\u672C\u6A21\u578B",
    "board.param.systemPrompt": "\u7CFB\u7EDF\u63D0\u793A\u8BCD",
    "board.param.temperature": "\u6E29\u5EA6",
    "board.param.maxTokens": "\u6700\u5927 token",
    "board.param.stream": "\u6D41\u5F0F\u8F93\u51FA",
    "board.param.streamHint": "\u8FB9\u751F\u6210\u8FB9\u663E\u793A\uFF1B\u5173\u95ED\u540E\u7B49\u5B8C\u6574\u7ED3\u679C\u518D\u4E00\u6B21\u6027\u51FA\u73B0",
    "board.param.reasoning": "\u601D\u8003\u5F3A\u5EA6",
    "board.param.reasoningHint": "\u63A8\u7406\u6A21\u578B\u53EF\u9009\u7684 reasoning_effort\uFF1B\u4E0D\u652F\u6301\u7684\u6A21\u578B\u4F1A\u5FFD\u7565",
    "board.param.topP": "Top P",
    "board.param.topPHint": "\u91C7\u6837\u8303\u56F4 0\u20131\uFF1B1 \u8868\u793A\u4E0D\u88C1\u526A",
    "board.param.count": "\u751F\u6210\u6570\u91CF",
    "board.param.countHint": "\u4E00\u6B21\u751F\u6210\u591A\u5F20\uFF0C\u8F93\u51FA\u9644\u4EF6\u5361\u91CC\u53EF\u4EE5\u5207\u6362",
    "board.reasoning.off": "\u5173\u95ED",
    "board.reasoning.low": "\u4F4E",
    "board.reasoning.medium": "\u4E2D",
    "board.reasoning.high": "\u9AD8",
    "board.node.output": "\u8F93\u51FA",
    "board.node.contentTab": "\u5185\u5BB9",
    "board.node.reasoningTab": "\u601D\u8003",
    "board.node.llmUnconfigured": "\u672A\u914D\u7F6E\u6587\u672C\u6A21\u578B\uFF1A\u8BBE\u7F6E \u2192 \u6587\u672C\u751F\u6210",
    "board.enhance.upscale": "\u8D85\u5206",
    "board.enhance.interpolate": "\u63D2\u5E27",
    "board.run.run": "\u8FD0\u884C",
    "board.run.stop": "\u505C\u6B62",
    "board.run.mode": "\u8FD0\u884C\u6A21\u5F0F",
    "board.run.manual": "\u8FD0\u884C\u6574\u4E2A\u5DE5\u4F5C\u6D41",
    "board.run.always": "\u81EA\u52A8\u91CD\u8DD1\u4E0B\u6E38",
    "board.run.repeat": "\u91CD\u590D N \u6B21",
    "board.run.queued": "\u961F\u5217 {count}",
    "board.run.done": "\u8FD0\u884C\u5B8C\u6210",
    "board.run.failed": "\u8FD0\u884C\u5931\u8D25",
    "board.run.empty": "\u6CA1\u6709\u53EF\u8FD0\u884C\u7684\u8282\u70B9",
    "board.run.needSelection": "\u5148\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9",
    "board.inspect.runControls": "\u8FD0\u884C\u63A7\u5236",
    "board.inspect.bypassHint": "\u53EA\u8DF3\u8FC7\u8FD9\u4E2A\u8282\u70B9\uFF1A\u4E0B\u6E38\u6539\u7528\u5B83\u540C\u7C7B\u578B\u7684\u8F93\u5165\uFF0C\u6CA1\u6709\u5C31\u5F53\u4F5C\u7A7A",
    "board.inspect.ignoreHint": "\u7981\u7528\u8FD9\u4E2A\u8282\u70B9\u4EE5\u53CA\u5B83\u4E4B\u540E\u7684\u6240\u6709\u8282\u70B9",
    "board.inspect.run": "\u8FD0\u884C\u6B64\u8282\u70B9",
    "board.inspect.model": "\u6A21\u578B\u6765\u6E90",
    "board.inspect.output": "\u8F93\u51FA",
    "board.inspect.outputEmpty": "\u8FD8\u6CA1\u6709\u8F93\u51FA",
    "board.inspect.missing": "\u672A\u5B89\u88C5",
    "board.inspect.local": "\u672C\u5730",
    "board.inspect.cloud": "\u4E91\u7AEF",
    "board.inspect.pickModel": "\u9009\u62E9\u6A21\u578B",
    "board.inspect.modelSettings": "\u914D\u7F6E\u4E91\u7AEF API",
    "board.inspect.modelSettingsHint": "\u6253\u5F00\u8BBE\u7F6E\uFF0C\u586B\u5199\u7AEF\u70B9\u4E0E Key",
    "board.inspect.outputContent": "\u5185\u5BB9",
    "board.inspect.outputReasoning": "\u601D\u8003",
    "board.inspect.outputCount": "{count} \u4E2A",
    "board.inspect.chars": "{count} \u5B57",
    "board.ctx.ignore": "\u7981\u7528\u8282\u70B9",
    "board.ctx.enable": "\u542F\u7528\u8282\u70B9",
    "board.ctx.duplicate": "\u521B\u5EFA\u526F\u672C",
    "board.dropHint": "\u677E\u624B\u5BFC\u5165\u7D20\u6750\u5E76\u521B\u5EFA\u8F93\u5165\u8282\u70B9",
    "board.inspect.download": "\u4E0B\u8F7D\u5230\u672C\u5730",
    "board.ctx.download": "\u4E0B\u8F7D\u7D20\u6750\u5230\u672C\u5730",
    "board.ctx.downloadHint": "\u628A\u8282\u70B9\u5F53\u524D\u9009\u4E2D\u7684\u7D20\u6750 / \u5DF2\u53D1\u5E03\u7684\u4EA7\u7269\u53E6\u5B58\u4E3A\u6587\u4EF6",
    "board.download.done": "\u5DF2\u4FDD\u5B58 {name}",
    "board.ctx.run": "\u8FD0\u884C\u6B64\u8282\u70B9",
    "board.ctx.rebuild": "\u91CD\u5EFA\u8282\u70B9",
    "board.ctx.rebuildHint": "\u56DE\u5230\u9ED8\u8BA4\u521D\u59CB\u72B6\u6001\uFF08\u4E0D\u8FD0\u884C\uFF09",
    "board.ctx.runDownstream": "\u8FD0\u884C\u6B64\u8282\u70B9\u53CA\u4E0B\u6E38",
    "board.ctx.edit": "\u5728\u68C0\u67E5\u5668\u4E2D\u7F16\u8F91",
    "board.ctx.selectAll": "\u5168\u9009",
    "board.ctx.removeEdge": "\u5220\u9664\u8FDE\u7EBF",
    "board.ctx.clear": "\u6E05\u7A7A\u753B\u5E03",
    "board.ctx.canvasList": "\u67E5\u770B\u753B\u5E03\u5217\u8868",
    "board.clear": "\u6E05\u7A7A",
    "board.clearTitle": "\u6E05\u7A7A\u753B\u5E03",
    "board.clearMessage": "\u53EA\u6E05\u7A7A\u8FD9\u5F20\u753B\u5E03\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5F80\u5DE5\u4F5C\u6D41\u5E93\u4FDD\u5B58\u65B0\u7248\u672C\uFF1B\u7D20\u6750\u5E93\u4E0E\u65F6\u95F4\u7EBF\u4E0D\u53D7\u5F71\u54CD\u3002",
    "board.addSearch": "\u641C\u7D22\u8282\u70B9\u2026",
    "board.addNoResults": "\u6CA1\u6709\u5339\u914D\u7684\u8282\u70B9",
    "board.run.repeatTimes": "\u91CD\u590D\u6B21\u6570",
    "board.mode.drag": "\u62D6\u52A8\u753B\u9762",
    "board.mode.marquee": "\u6846\u9009",
    "board.gridSnap": "\u7F51\u683C\u5438\u9644",
    "board.connect.title": "\u8FDE\u63A5\u5230\u65B0\u8282\u70B9",
    "board.connect.fromInput": "\u63A5\u5165\u8FD9\u4E2A\u8F93\u5165",
    "board.connect.none": "\u6CA1\u6709\u53EF\u8FDE\u63A5\u7684\u8282\u70B9",
    "board.node.dropImage": "\u62D6\u5165\u6216\u70B9\u51FB\u9009\u62E9\u56FE\u7247",
    "board.node.dropVideo": "\u62D6\u5165\u6216\u70B9\u51FB\u9009\u62E9\u89C6\u9891",
    "board.node.dropAudio": "\u62D6\u5165\u6216\u70B9\u51FB\u9009\u62E9\u97F3\u9891",
    "board.node.dropHint": "\u652F\u6301\u4E00\u6B21\u9009\u591A\u5F20\u56FE\u7247",
    "board.node.prevImage": "\u4E0A\u4E00\u5F20",
    "board.node.removeImage": "\u5220\u9664\u8FD9\u5F20\u56FE\u7247",
    "board.node.nextImage": "\u4E0B\u4E00\u5F20",
    "board.inspect.addImages": "\u6DFB\u52A0\u56FE\u7247",
    "board.inspect.runSection": "\u8FD0\u884C",
    "board.inspect.stackCount": "{count} \u5F20",
    "board.node.waitingRun": "\u7B49\u5F85\u8FD0\u884C",
    "board.node.waitingRunHint": "\u8FD0\u884C\u4E0A\u6E38\u8282\u70B9\u540E\uFF0C\u4EA7\u7269\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002",
    "board.node.waitingMedia": "\u7B49\u5F85\u4E0A\u6E38\u7D20\u6750",
    "board.node.waitingHint": "\u628A\u8F93\u5165\u8282\u70B9\u6216\u6A21\u578B\u8282\u70B9\u7684\u8F93\u51FA\u8FDE\u5230\u8FD9\u91CC",
    "board.node.uploadImage": "\u4E0A\u4F20\u56FE\u7247",
    "board.node.imageHint": "\u62D6\u5165\u56FE\u7247\uFF0C\u6216\u4E00\u6B21\u9009\u62E9\u591A\u5F20\u3002\u5361\u7247\u4F1A\u4EE5\u53E0\u724C\u4FDD\u7559\u5176\u4F59\u56FE\u7247\u3002",
    "board.node.chooseFile": "\u9009\u62E9\u6587\u4EF6",
    "board.node.brokenImage": "\u56FE\u7247\u65E0\u6CD5\u6253\u5F00",
    "board.node.brokenHint": "\u91CD\u65B0\u9009\u62E9\u4E00\u5F20\u56FE\u7247\u8BD5\u8BD5",
    "board.node.brokenVideo": "\u89C6\u9891\u65E0\u6CD5\u64AD\u653E",
    "board.node.brokenAudio": "\u97F3\u9891\u65E0\u6CD5\u64AD\u653E",
    "board.node.videoHint": "\u62D6\u5165\u89C6\u9891\u6587\u4EF6\uFF0C\u6216\u4ECE\u7D20\u6750\u5E93\u91CC\u6311\u4E00\u6761\u3002",
    "board.node.audioHint": "\u62D6\u5165\u97F3\u9891\u6587\u4EF6\uFF0C\u6216\u4ECE\u7D20\u6750\u5E93\u91CC\u6311\u4E00\u6761\u3002",
    "board.node.textPlaceholder": "\u5199\u4E0B\u4E00\u6BB5\u63CF\u8FF0\u3001\u53F0\u8BCD\u6216\u63D0\u793A\u8BCD\u2026",
    "board.node.promptPlaceholder": "\u63CF\u8FF0\u753B\u9762\u3001\u98CE\u683C\u4E0E\u9650\u5236\u2026",
    "board.node.paramPlaceholder": "\u672A\u586B\u5199",
    "board.node.chars": "{count} \u5B57\u7B26",
    "board.node.copyText": "\u590D\u5236\u6587\u672C",
    "board.node.clearText": "\u6E05\u7A7A\u6587\u672C",
    "board.node.textCopied": "\u5DF2\u590D\u5236\u6587\u672C",
    "board.node.missingPlugin": "\u8282\u70B9\u5B9A\u4E49\u7F3A\u5931",
    "board.node.missingPluginHint": "\u63D2\u4EF6\u6CA1\u52A0\u8F7D\u6210\u529F\uFF08\u88AB\u7981\u7528 / \u7248\u672C\u4E0D\u517C\u5BB9 / \u5B89\u88C5\u4E2D\uFF09\u3002\u8282\u70B9\u4E0E\u8FDE\u7EBF\u90FD\u8FD8\u5728\uFF0C\u63D2\u4EF6\u6062\u590D\u540E\u4F1A\u81EA\u52A8\u663E\u793A\u3002",
    "board.node.copyOutputText": "\u590D\u5236\u5168\u90E8\u6587\u672C",
    "board.node.play": "\u64AD\u653E",
    "board.node.pause": "\u6682\u505C",
    "board.node.mute": "\u9759\u97F3",
    "board.node.unmute": "\u53D6\u6D88\u9759\u97F3",
    "board.node.fullscreen": "\u5168\u5C4F",
    "board.node.agentModel": "\u6587\u672C\u6A21\u578B",
    "board.node.noModel": "\u672A\u9009\u62E9\u6A21\u578B",
    "board.node.modelLocal": "\u672C\u5730\u6A21\u578B",
    "board.node.refSummary": "9 \u56FE \xB7 3 \u97F3\u9891 \xB7 3 \u89C6\u9891\u53C2\u8003",
    "board.node.stemSummary": "{count} \u6761\u97F3\u8F68",
    "board.node.multiRefSummary": "\u6700\u591A {count} \u5F20\u53C2\u8003\u56FE",
    "board.node.hasOutput": "\u6709\u8F93\u51FA",
    "board.node.collapseOutput": "\u6536\u8D77\u8F93\u51FA",
    "board.node.expandOutput": "\u5C55\u5F00\u8F93\u51FA",
    "board.node.outputs": "\u8F93\u51FA\u5217\u8868",
    "board.node.selectOutput": "\u67E5\u770B\u7B2C {index} \u4E2A\u8F93\u51FA",
    // ---- 画布素材选择器（MD3 对话框，替代下拉） ----
    "board.picker.imageTitle": "\u9009\u62E9\u56FE\u7247",
    "board.picker.videoTitle": "\u9009\u62E9\u89C6\u9891",
    "board.picker.audioTitle": "\u9009\u62E9\u97F3\u9891",
    "board.picker.search": "\u641C\u7D22\u7D20\u6750\u5E93\u2026",
    "board.picker.empty": "\u7D20\u6750\u5E93\u91CC\u8FD8\u6CA1\u6709\u8FD9\u7C7B\u7D20\u6750",
    "board.picker.emptyHint": "\u5148\u5728\u5A92\u4F53\u5E93\u91CC\u5BFC\u5165\uFF0C\u6216\u5728\u753B\u5E03\u4E0A\u76F4\u63A5\u62D6\u5165\u6587\u4EF6\u3002",
    "board.picker.noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u7D20\u6750",
    "board.picker.add": "\u6DFB\u52A0",
    "board.picker.selected": "\u5DF2\u9009 {count} \u4E2A",
    // ---- 媒体库 → 画布拖拽 ----
    "board.drop.createNode": "\u677E\u624B\u521B\u5EFA{kind}\u8F93\u5165\u8282\u70B9",
    "board.drop.importHere": "\u677E\u624B\u5BFC\u5165\u5230\u300C{name}\u300D",
    "board.drop.typeMismatch": "\u8FD9\u4E2A\u8282\u70B9\u53EA\u80FD\u63A5\u6536{kind}",
    "board.drop.imported": "\u5DF2\u5BFC\u5165 {count} \u4E2A\u7D20\u6750",
    // ---- 检查器（ai-board 版式） ----
    "board.inspect.inputs": "\u8F93\u5165",
    "board.inspect.inputsTitle": "\u8F93\u5165\u53C2\u6570",
    "board.inspect.bindings": "\u5DF2\u8FDE\u63A5 {bound}/{total}",
    "board.inspect.selectedCount": "\u5DF2\u9009 {count} \u4E2A",
    "board.inspect.pickMultiple": "\u9009\u62E9\u4E00\u4E2A\u6216\u591A\u4E2A\u4E0A\u6E38",
    "board.inspect.moveUp": "\u4E0A\u79FB",
    "board.inspect.moveDown": "\u4E0B\u79FB",
    "board.inspect.removeBinding": "\u65AD\u5F00\u8FD9\u4E00\u8DEF",
    "board.inspect.outBindings": "\u8F93\u51FA\u8FDE\u7EBF",
    "board.inspect.outBindingsHint": "\u628A\u4E0B\u6E38\u8282\u70B9\u8FDE\u5230\u672C\u8282\u70B9\u540E\uFF0C\u5728\u8FD9\u91CC\u9009\u62E9\u5B83\u8D70\u54EA\u4E00\u8DEF\u8F93\u51FA\uFF08\u4EBA\u58F0 / \u9F13 / \u89C6\u9891 / \u97F3\u9891\u2026\uFF09\u3002",
    "board.inspect.outputRebound": "\u5DF2\u5207\u6362\u8FD9\u6761\u8FDE\u7EBF\u7684\u8F93\u51FA\u7AEF\u53E3",
    "board.inspect.connected": "\u5DF2\u8FDE\u63A5 \xB7 {name}",
    "board.inspect.unconnected": "\u672A\u8FDE\u63A5",
    "board.inspect.outputs": "\u8F93\u51FA",
    "board.inspect.published": "\u5DF2\u53D1\u5E03",
    "board.inspect.notRun": "\u672A\u8FD0\u884C",
    "board.inspect.title": "\u6807\u9898",
    "board.inspect.titlePlaceholder": "\u8282\u70B9\u6807\u9898",
    "board.inspect.mediaSection": "\u7D20\u6750",
    "board.inspect.mediaHint": "\u4ECE\u672C\u5730\u9009\u62E9\uFF0C\u6216\u76F4\u63A5\u4ECE\u7D20\u6750\u5E93\u6DFB\u52A0\uFF1B\u56FE\u7247\u53EF\u4EE5\u5806\u591A\u5F20\u3002",
    "board.inspect.aspectHint": "\u56FE\u7247\u8282\u70B9\u4F1A\u6309\u7D20\u6750\u6BD4\u4F8B\u81EA\u52A8\u8C03\u6574\u9AD8\u5EA6\u3002",
    "board.inspect.aspectHintVideo": "\u89C6\u9891\u8282\u70B9\u4F1A\u6309\u7D20\u6750\u6BD4\u4F8B\u81EA\u52A8\u8C03\u6574\u9AD8\u5EA6\u3002",
    "board.inspect.connectedHint": "\u5728\u753B\u5E03\u4E0A\u628A\u4E0A\u6E38\u8282\u70B9\u8FDE\u5230\u8FD9\u4E2A\u7AEF\u53E3\u3002",
    "board.inspect.boundTo": "\u5DF2\u8FDE\u63A5\u5230 {name}",
    "board.inspect.connectFirst": "\u5148\u5728\u4E0A\u6E38\u8FDE\u63A5\u4E00\u4E2A {type} \u8282\u70B9\u3002",
    "board.inspect.outputReady": "\u8FD0\u884C\u540E\u53D1\u5E03",
    "board.inspect.noMedia": "\u8FD8\u6CA1\u6709\u7D20\u6750",
    "board.run.schedule": "\u5E76\u884C\u8C03\u5EA6",
    "board.run.smartOrder": "\u667A\u80FD\u6392\u5E8F\u8C03\u5EA6",
    "board.run.smartOrderHint": "\u4F18\u5148\u8DD1\u89E3\u9501\u4E0B\u6E38\u6700\u591A\u7684\u8282\u70B9\uFF0C\u5206\u652F\u591A\u65F6\u66F4\u65E9\u5B8C\u6210",
    "board.run.smartMemory": "\u667A\u80FD\u663E\u5B58\u5206\u914D",
    "board.run.smartMemoryHint": "\u672C\u5730\u4EFB\u52A1\u6309\u663E\u5B58 / \u5185\u5B58\u9884\u7B97\u6392\u961F\uFF0C\u7EAF API \u5206\u652F\u5B8C\u5168\u5E76\u884C",
    "board.run.plan": "\u672C\u6B21\uFF1A{instant} \u5373\u65F6 \xB7 {api} API \xB7 {gpu} \u672C\u5730 GPU \xB7 {cpu} \u672C\u5730 CPU",
    "board.run.modeTip": "\u8FD0\u884C\u6A21\u5F0F\uFF1A{mode}",
    "board.run.modeShort.manual": "\u624B\u52A8",
    "board.run.modeShort.always": "\u81EA\u52A8",
    "board.run.modeShort.repeat": "\u91CD\u590D",
    "board.resize.hint": "\u62D6\u52A8\u53F3\u4E0B\u89D2\u8C03\u6574\u8282\u70B9\u5C3A\u5BF8",
    // ---- 画布检查器 / 多画布 / 工作流签名 ----
    "board.canvas.title": "\u753B\u5E03",
    "board.canvas.list": "\u753B\u5E03\u5217\u8868",
    "board.canvas.count": "{count} \u5F20",
    "board.canvas.current": "\u5F53\u524D",
    "board.canvas.defaultTitle": "\u753B\u5E03 {n}",
    "board.canvas.copySuffix": "\u526F\u672C",
    "board.canvas.new": "\u65B0\u5EFA\u753B\u5E03",
    "board.canvas.duplicate": "\u590D\u5236\u753B\u5E03",
    "board.canvas.rename": "\u91CD\u547D\u540D\u753B\u5E03",
    "board.canvas.delete": "\u5220\u9664\u753B\u5E03",
    "board.canvas.deleteTitle": "\u5220\u9664\u753B\u5E03",
    "board.canvas.deleteMessage": "\u5220\u9664\u300C{name}\u300D\uFF1F\u753B\u5E03\u91CC\u7684\u8282\u70B9\u548C\u8FDE\u7EBF\u4F1A\u4E00\u8D77\u5220\u6389\uFF1B\u5DF2\u4FDD\u5B58\u5230\u5DE5\u4F5C\u6D41\u5E93\u7684\u7248\u672C\u4E0D\u53D7\u5F71\u54CD\u3002",
    "board.canvas.switch": "\u5207\u6362",
    "board.canvas.emptyTitle": "\u6CA1\u6709\u9009\u4E2D\u8282\u70B9",
    "board.canvas.emptyHint": "\u70B9\u753B\u5E03\u7A7A\u767D\u5904\u56DE\u5230\u8FD9\u91CC\u3002\u8FD9\u91CC\u7BA1\u7406\u5F53\u524D\u5DE5\u7A0B\u7684\u5168\u90E8\u753B\u5E03\u3002",
    "board.canvas.selectHint": "\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9\u7F16\u8F91\u5B83\u7684\u53C2\u6570\uFF1B\u70B9\u7A7A\u767D\u5904\u56DE\u5230\u753B\u5E03\u5217\u8868\u3002",
    "board.canvas.nodeCount": "{count} \u4E2A\u8282\u70B9",
    "board.canvas.publish": "\u53D1\u5E03",
    "board.canvas.publishTitle": "\u53D1\u5E03\u5DE5\u4F5C\u6D41",
    "board.canvas.publishTarget": "\u753B\u5E03\uFF1A{name}",
    "board.canvas.publishedBadge": "\u5DF2\u53D1\u5E03",
    "board.canvas.publishHint": "\u753B\u5E03\u6709\u6210\u5BF9\u7684\u5DE5\u4F5C\u6D41\u5F00\u59CB / \u7ED3\u675F\u8282\u70B9\u4E14\u642D\u5EFA\u5B8C\u6574\u65F6\uFF0C\u53EF\u4EE5\u4FDD\u5B58\u6210\u53EF\u8C03\u7528\u7684\u5B50\u5DE5\u4F5C\u6D41\u6216 API\u3002",
    "board.canvas.publishReady": "\u53EF\u4EE5\u53D1\u5E03",
    "board.canvas.publishBlocked": "\u8FD8\u4E0D\u80FD\u53D1\u5E03",
    "board.canvas.api": "\u53EF\u8C03\u7528 API",
    "board.canvas.apiHint": "\u66B4\u9732\u6210 AI Harness / MCP \u53EF\u8C03\u7528\u7684\u5DE5\u4F5C\u6D41\uFF08\u5DE5\u4F5C\u6D41\u5E93\u6309\u300CAPI\u300D\u7B5B\u9009\uFF09\u3002",
    "board.canvas.subworkflow": "\u53EF\u88AB\u5D4C\u5165",
    "board.canvas.subworkflowHint": "\u5141\u8BB8\u522B\u7684\u753B\u5E03\u7528\u300C\u5D4C\u5165\u5DE5\u4F5C\u6D41\u300D\u8282\u70B9\u8C03\u7528\u5B83\uFF08\u5DE5\u4F5C\u6D41\u5E93\u6309\u300C\u5B50\u5DE5\u4F5C\u6D41\u300D\u7B5B\u9009\uFF09\u3002",
    "board.canvas.savePublish": "\u4FDD\u5B58\u5E76\u53D1\u5E03",
    "board.canvas.savedPublish": "\u5DF2\u53D1\u5E03\uFF1A{name} v{version}",
    "board.canvas.publishName": "\u5DE5\u4F5C\u6D41\u540D\u79F0",
    "board.canvas.publishNamePlaceholder": "\u4F8B\u5982\uFF1A\u4EA7\u54C1\u56FE\u751F\u6210",
    "board.canvas.signature": "\u7B7E\u540D",
    "board.canvas.signatureSummary": "{inputs} \u4E2A\u8F93\u5165 \xB7 {outputs} \u4E2A\u8F93\u51FA",
    "board.canvas.signatureNone": "\u8FD8\u6CA1\u6709\u58F0\u660E\u8F93\u5165\u8F93\u51FA",
    "board.canvas.problemCount": "{count} \u4E2A\u95EE\u9898",
    "board.canvas.problem.missingWorkflowNodes": "\u7F3A\u5C11\u5B50\u5DE5\u4F5C\u6D41\u8282\u70B9",
    "board.canvas.problem.missingStart": "\u7F3A\u5C11\u5DE5\u4F5C\u6D41\u5F00\u59CB\u8282\u70B9",
    "board.canvas.problem.missingEnd": "\u7F3A\u5C11\u5DE5\u4F5C\u6D41\u7ED3\u675F\u8282\u70B9",
    "board.canvas.problem.multipleStart": "\u5DE5\u4F5C\u6D41\u5F00\u59CB\u8282\u70B9\u53EA\u80FD\u6709\u4E00\u4E2A",
    "board.canvas.problem.multipleEnd": "\u5DE5\u4F5C\u6D41\u7ED3\u675F\u8282\u70B9\u53EA\u80FD\u6709\u4E00\u4E2A",
    "board.canvas.problem.pairBroken": "\u5DE5\u4F5C\u6D41\u5F00\u59CB / \u7ED3\u675F\u8282\u70B9\u6CA1\u6709\u914D\u5BF9",
    "board.canvas.problem.inputNameEmpty": "\u6709\u8F93\u5165\u6CA1\u6709\u540D\u5B57",
    "board.canvas.problem.outputNameEmpty": "\u6709\u8F93\u51FA\u6CA1\u6709\u540D\u5B57",
    "board.canvas.problem.duplicateInput": "\u8F93\u5165\u540D\u5B57\u91CD\u590D\uFF1A{name}",
    "board.canvas.problem.duplicateOutput": "\u8F93\u51FA\u540D\u5B57\u91CD\u590D\uFF1A{name}",
    "board.canvas.problem.unknownType": "\u7C7B\u578B\u6CA1\u6709\u6CE8\u518C\uFF1A{name} \u2192 {type}",
    "board.canvas.problem.unboundOutput": "\u8F93\u51FA\u300C{name}\u300D\u8FD8\u6CA1\u6709\u63A5\u4E0A\u6E38",
    "board.canvas.problem.cycle": "\u753B\u5E03\u91CC\u6709\u73AF\uFF0C\u65E0\u6CD5\u6309\u987A\u5E8F\u6267\u884C",
    "board.inspect.workflowInputs": "\u5DE5\u4F5C\u6D41\u8F93\u5165",
    "board.inspect.workflowOutputs": "\u5DE5\u4F5C\u6D41\u8F93\u51FA",
    "board.inspect.addSignatureInput": "\u65B0\u5EFA\u8F93\u5165",
    "board.inspect.addSignatureOutput": "\u65B0\u5EFA\u8F93\u51FA",
    "board.inspect.signatureName": "\u540D\u79F0",
    "board.inspect.signatureLabel": "\u6807\u7B7E",
    "board.inspect.signatureType": "\u7C7B\u578B",
    "board.inspect.signatureDefault": "\u9ED8\u8BA4\u503C",
    "board.inspect.signatureRequired": "\u5FC5\u586B",
    "board.inspect.signatureRemove": "\u5220\u9664\u8FD9\u4E00\u884C",
    "board.inspect.signatureEmpty": "\u8FD8\u6CA1\u6709\u58F0\u660E\uFF0C\u70B9\u4E0B\u9762\u7684\u6309\u94AE\u52A0\u4E00\u884C\u3002",
    "board.inspect.workflowTarget": "\u76EE\u6807\u5DE5\u4F5C\u6D41",
    "board.inspect.workflowTargetEmpty": "\u9009\u62E9\u8981\u5D4C\u5165\u7684\u5B50\u5DE5\u4F5C\u6D41",
    "board.inspect.workflowTargetHint": "\u5B50\u5DE5\u4F5C\u6D41\u7684\u8F93\u5165 / \u8F93\u51FA\u7531\u5B83\u7684\u5F00\u59CB / \u7ED3\u675F\u8282\u70B9\u58F0\u660E\uFF0C\u8FD9\u91CC\u6309\u7B7E\u540D\u7AEF\u53E3\u6620\u5C04\u3002",
    "board.inspect.workflowMissing": "\u76EE\u6807\u5DE5\u4F5C\u6D41\u5DF2\u4E0D\u5B58\u5728\uFF1B\u7AEF\u53E3\u4E0E\u8FDE\u7EBF\u4FDD\u7559\uFF0C\u8FD0\u884C\u65F6\u4F1A\u7ED9\u51FA\u660E\u786E\u62A5\u9519\u3002",
    "board.inspect.workflowTargetPublished": "\u8FD8\u6CA1\u6709\u53D1\u5E03\u4E3A\u5B50\u5DE5\u4F5C\u6D41\u7684\u5DE5\u4F5C\u6D41\uFF1B\u5148\u5728\u5DE5\u4F5C\u6D41\u5E93 / \u753B\u5E03\u68C0\u67E5\u5668\u91CC\u53D1\u5E03\u4E00\u5F20\u3002",
    "board.inspect.signatureTypeHint": "\u7C7B\u578B\u6765\u81EA\u6570\u636E\u7C7B\u578B\u6CE8\u518C\u8868\uFF0C\u63D2\u4EF6\u6CE8\u518C\u7684\u7C7B\u578B\u4E5F\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
    "board.node.workflow": "\u5B50\u5DE5\u4F5C\u6D41",
    "board.node.workflowStart": "\u5DE5\u4F5C\u6D41\u5F00\u59CB",
    "board.node.workflowEnd": "\u5DE5\u4F5C\u6D41\u7ED3\u675F",
    "board.node.workflowCall": "\u5D4C\u5165\u5DE5\u4F5C\u6D41",
    "board.node.workflowEmbed": "\u5D4C\u5165\u5DE5\u4F5C\u6D41",
    "board.param.workflow": "\u76EE\u6807\u5DE5\u4F5C\u6D41",
    "board.param.workflowName": "\u5DE5\u4F5C\u6D41\u540D\u79F0",
    "board.port.workflowInput": "\u8F93\u5165",
    "board.port.workflowOutput": "\u8F93\u51FA",
    "board.workflow.defaultInput": "\u63D0\u793A\u8BCD",
    "board.workflow.defaultOutput": "\u7ED3\u679C",
    "board.workflow.inIndex": "\u8F93\u5165 {n}",
    "board.workflow.outIndex": "\u8F93\u51FA {n}",
    "board.workflow.newInput": "\u8F93\u5165 {n}",
    "board.workflow.newOutput": "\u8F93\u51FA {n}",
    "board.workflow.noTarget": "\u8FD8\u6CA1\u6709\u9009\u62E9\u8981\u5D4C\u5165\u7684\u5DE5\u4F5C\u6D41",
    "board.workflow.missingInput": "\u7F3A\u5C11\u5FC5\u586B\u8F93\u5165\uFF1A{name}",
    "board.workflow.signatureChanged": "\u300C{name}\u300D\u7684\u8F93\u5165\u7B7E\u540D\u53D8\u4E86\uFF0C\u8BF7\u5728\u68C0\u67E5\u5668\u91CC\u91CD\u65B0\u9009\u4E00\u6B21\u76EE\u6807\u5DE5\u4F5C\u6D41",
    "board.workflow.notRunnable": "\u300C{name}\u300D\u7F3A\u5C11\u6210\u5BF9\u7684\u5DE5\u4F5C\u6D41\u5F00\u59CB / \u7ED3\u675F\u8282\u70B9",
    "board.workflow.missing": "\u627E\u4E0D\u5230\u5DE5\u4F5C\u6D41\u300C{name}\u300D\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\uFF09",
    "board.workflow.cycle": "\u5DE5\u4F5C\u6D41\u5D4C\u5957\u6210\u73AF\uFF1A{name}",
    "board.workflow.tooDeep": "\u5DE5\u4F5C\u6D41\u5D4C\u5957\u8D85\u8FC7 8 \u5C42\uFF1A{name}",
    "board.loop.source": "\u6765\u6E90",
    "board.library.filterWorkflow": "\u5B50\u5DE5\u4F5C\u6D41",
    "board.library.filterApi": "API",
    "board.library.untitledWorkflow": "\u672A\u547D\u540D\u5DE5\u4F5C\u6D41",
    "board.library.badgeBase": "\u5DE5\u4F5C\u6D41",
    "board.library.badgeWorkflow": "\u5B50\u5DE5\u4F5C\u6D41",
    "board.library.badgeApi": "API",
    "board.library.publishHint": "\u628A\u5E26\u7B7E\u540D\u7684\u5DE5\u4F5C\u6D41\u4FDD\u5B58\u5230\u5E93\u91CC\uFF0C\u4E4B\u540E\u53EF\u4EE5\u88AB\u5D4C\u5165\u6216\u901A\u8FC7 API / AI Harness \u8C03\u7528\u3002",
    "board.clear.unsavedTitle": "\u6E05\u7A7A\u753B\u5E03",
    "board.clear.unsavedMessage": "\u5F53\u524D\u753B\u5E03\u8FD8\u6CA1\u4FDD\u5B58\u6210\u5DE5\u4F5C\u6D41\u3002\u76F4\u63A5\u6E05\u7A7A\u4F1A\u4E22\u6389\u8FD9\u6B21\u642D\u5EFA\u7684\u5185\u5BB9\u3002",
    "board.clear.saveAndClear": "\u4FDD\u5B58\u5E76\u6E05\u7A7A",
    "board.clear.clearWithoutSave": "\u76F4\u63A5\u6E05\u7A7A",
    "board.clear.cleared": "\u753B\u5E03\u5DF2\u6E05\u7A7A",
    "board.run.stopped": "\u5DF2\u53D6\u6D88"
  };
  var zh_default = zh;

  // src/i18n/translate.ts
  var LOCALES = [
    { id: "zh", label: "\u7B80\u4F53\u4E2D\u6587" },
    { id: "en", label: "English" }
  ];
  var FALLBACK = LOCALES[0].id;
  var MESSAGES = { zh: zh_default, en: en_default };
  function isKnownMessageKey(value) {
    const key = value?.trim();
    if (!key || key.length > 64) return false;
    if (!/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i.test(key)) return false;
    return LOCALES.some(
      (locale) => Object.prototype.hasOwnProperty.call(MESSAGES[locale.id] ?? {}, key)
    );
  }
  var PLUGIN_MESSAGES = /* @__PURE__ */ new Map();
  function pluginMessage(key) {
    if (!key.startsWith("@")) return null;
    const dot = key.indexOf(".");
    if (dot <= 1) return null;
    const pluginId = key.slice(1, dot);
    const inner = key.slice(dot + 1);
    const dicts = PLUGIN_MESSAGES.get(pluginId);
    if (!dicts) return null;
    return dicts[current]?.[inner] ?? dicts.en?.[inner] ?? dicts[FALLBACK]?.[inner] ?? null;
  }
  var current = FALLBACK;
  function setTranslateLocale(next) {
    current = next;
  }
  function t(key, vars) {
    const dict = MESSAGES[current] ?? MESSAGES[FALLBACK];
    let text = dict[key] ?? MESSAGES[FALLBACK][key] ?? pluginMessage(key) ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  // src/core/board/workflowNodes.ts
  function newDeclId(prefix) {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function cleanText(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }
  function normalizePortDecl(raw, index) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw;
    const id = cleanText(item.id).trim() || newDeclId(index % 2 === 0 ? "in" : "out");
    const type = isDataTypeId(item.type) ? item.type : "any";
    const label = cleanText(item.label).trim();
    const name = cleanText(item.name).trim() || label || `field_${index + 1}`;
    const decl = { id, name, label: label || name, type };
    if (item.required === true) decl.required = true;
    if (item.default !== void 0 && isJsonish(item.default, 0)) decl.default = item.default;
    return decl;
  }
  function isJsonish(value, depth) {
    if (depth > 3) return false;
    if (value === null) return true;
    const kind = typeof value;
    if (kind === "string" || kind === "boolean") return true;
    if (kind === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => isJsonish(item, depth + 1));
    if (kind === "object") {
      return Object.values(value).every(
        (item) => isJsonish(item, depth + 1)
      );
    }
    return false;
  }
  var MAX_DECLS = 32;
  function normalizeSignature(raw) {
    if (!raw || typeof raw !== "object") return void 0;
    const value = raw;
    const list = (input) => Array.isArray(input) ? input.slice(0, MAX_DECLS).map((item, index) => normalizePortDecl(item, index)).filter((item) => item !== null) : [];
    const signature = { inputs: list(value.inputs), outputs: list(value.outputs) };
    if (signature.inputs.length === 0 && signature.outputs.length === 0) return void 0;
    return signature;
  }

  // src/core/board/schema.ts
  function emptyBoard() {
    return {
      version: BOARD_VERSION,
      nodes: [],
      edges: [],
      viewport: { ...DEFAULT_VIEWPORT },
      updatedAt: Date.now()
    };
  }
  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isPortType(value) {
    return isDataTypeId(value);
  }
  var MAX_VALUE_BYTES = 64 * 1024;
  var MAX_VALUE_DEPTH = 4;
  function isJsonValue(value, depth) {
    if (depth > MAX_VALUE_DEPTH) return false;
    if (value === null) return true;
    const kind = typeof value;
    if (kind === "string" || kind === "boolean") return true;
    if (kind === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
    if (isObject(value)) {
      return Object.values(value).every((item) => isJsonValue(item, depth + 1));
    }
    return false;
  }
  function normalizeValues(raw) {
    if (!isObject(raw)) return void 0;
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isDataTypeId(key)) continue;
      if (value === void 0) continue;
      if (!isJsonValue(value, 0)) continue;
      out[key] = value;
    }
    const keys = Object.keys(out);
    if (keys.length === 0) return void 0;
    let encoded = "";
    try {
      encoded = JSON.stringify(out);
    } catch {
      return void 0;
    }
    return encoded.length > MAX_VALUE_BYTES ? void 0 : out;
  }
  function normalizeParams(raw) {
    if (!isObject(raw)) return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === void 0) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        out[key] = value;
      }
    }
    return out;
  }
  function normalizePorts(raw) {
    if (!isObject(raw)) return void 0;
    const inputs = normalizePortList(raw.inputs);
    const outputs = normalizePortList(raw.outputs);
    if (inputs === null || outputs === null) return void 0;
    return { inputs, outputs };
  }
  function normalizePortList(raw) {
    if (!Array.isArray(raw)) return null;
    const list = [];
    for (const item of raw) {
      if (!isObject(item)) return null;
      if (typeof item.id !== "string" || !item.id) return null;
      if (!isPortType(item.type)) return null;
      if (typeof item.labelKey !== "string") return null;
      list.push({
        id: item.id,
        type: item.type,
        labelKey: item.labelKey,
        ...typeof item.label === "string" && item.label ? { label: item.label } : {},
        ...typeof item.max === "number" ? { max: item.max } : {},
        ...item.channel === "inline" || item.channel === "blob" || item.channel === "stream" ? { channel: item.channel } : {}
      });
    }
    return list;
  }
  function normalizeBindings(raw) {
    if (!isObject(raw)) return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!isObject(value)) continue;
      if (typeof value.nodeId !== "string" || typeof value.portId !== "string") continue;
      out[key] = { nodeId: value.nodeId, portId: value.portId };
    }
    return out;
  }
  function normalizeNode(raw) {
    if (!isObject(raw)) return null;
    if (typeof raw.id !== "string" || !raw.id || typeof raw.type !== "string" || !raw.type) return null;
    const position = isObject(raw.position) ? raw.position : {};
    const x = typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0;
    const y = typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0;
    const rawData = isObject(raw.data) ? raw.data : {};
    const data = {
      params: normalizeParams(rawData.params),
      bindings: normalizeBindings(rawData.bindings)
    };
    const ports = normalizePorts(rawData.ports);
    if (ports) data.ports = ports;
    if (typeof rawData.pairId === "string" && rawData.pairId) data.pairId = rawData.pairId;
    const signature = normalizeSignature(rawData.signature);
    if (signature) data.signature = signature;
    if (typeof rawData.title === "string" && rawData.title) data.title = rawData.title;
    if (typeof rawData.assetId === "string" && rawData.assetId) data.assetId = rawData.assetId;
    if (Array.isArray(rawData.items)) {
      const items = rawData.items.filter((item) => isJsonValue(item, 0)).slice(0, 200);
      if (items.length > 0) data.items = items;
    }
    if (Array.isArray(rawData.assetIds)) {
      const ids = rawData.assetIds.filter(
        (id) => typeof id === "string" && id.length > 0
      );
      if (ids.length > 0) {
        data.assetIds = ids;
        if (!data.assetId) data.assetId = ids[0];
      }
    }
    if (typeof rawData.stackIndex === "number" && Number.isFinite(rawData.stackIndex)) {
      data.stackIndex = Math.max(0, Math.floor(rawData.stackIndex));
    }
    if (typeof rawData.outputAssetId === "string" && rawData.outputAssetId) {
      data.outputAssetId = rawData.outputAssetId;
    }
    const values = normalizeValues(rawData.values);
    if (values) data.values = values;
    if (Array.isArray(rawData.outputAssetIds)) {
      const ids = rawData.outputAssetIds.filter(
        (id) => typeof id === "string" && id.length > 0
      );
      if (ids.length > 0) {
        data.outputAssetIds = [...new Set(ids)];
        if (!data.outputAssetId || !data.outputAssetIds.includes(data.outputAssetId)) {
          data.outputAssetId = data.outputAssetIds[0];
        }
      }
    }
    if (isObject(rawData.outputs)) {
      const outputs = {};
      for (const [portId, assetId] of Object.entries(rawData.outputs)) {
        if (typeof assetId === "string" && assetId) outputs[portId] = assetId;
      }
      if (Object.keys(outputs).length > 0) data.outputs = outputs;
    }
    if (rawData.outputOpen === false) data.outputOpen = false;
    if (typeof rawData.outputText === "string" && rawData.outputText) data.outputText = rawData.outputText;
    if (typeof rawData.outputReasoning === "string" && rawData.outputReasoning) {
      data.outputReasoning = rawData.outputReasoning;
    }
    if (typeof rawData.startedAt === "number" && Number.isFinite(rawData.startedAt)) {
      data.startedAt = rawData.startedAt;
    }
    if (typeof rawData.durationMs === "number" && Number.isFinite(rawData.durationMs)) {
      data.durationMs = Math.max(0, rawData.durationMs);
    }
    if (typeof rawData.error === "string" && rawData.error) data.error = rawData.error;
    if (typeof rawData.progress === "number" && Number.isFinite(rawData.progress)) {
      data.progress = Math.max(0, Math.min(1, rawData.progress));
    }
    if (rawData.ignored === true) data.ignored = true;
    if (rawData.bypassed === true) data.bypassed = true;
    const tone = rawData.tone;
    if (tone === "lavender" || tone === "blue" || tone === "green" || tone === "coral" || tone === "amber") {
      data.tone = tone;
    }
    if (Array.isArray(rawData.children)) {
      const children = rawData.children.filter(
        (id) => typeof id === "string" && id.length > 0
      );
      if (children.length > 0) data.children = [...new Set(children)];
    }
    const status = rawData.status;
    if (status === "idle" || status === "queued" || status === "running" || status === "done" || status === "error" || status === "stale" || status === "skipped") {
      data.status = status;
    }
    const node = { id: raw.id, type: raw.type, position: { x, y }, data };
    if (isObject(raw.size)) {
      const width = typeof raw.size.width === "number" ? raw.size.width : 0;
      const height = typeof raw.size.height === "number" ? raw.size.height : 0;
      if (width > 80 && height > 60) node.size = { width, height };
    }
    return node;
  }
  function normalizeBoardSource(raw) {
    if (!isObject(raw)) return void 0;
    const source = {};
    if (typeof raw.rootId === "string" && raw.rootId) source.rootId = raw.rootId;
    if (typeof raw.builtinId === "string" && raw.builtinId) source.builtinId = raw.builtinId;
    if (typeof raw.name === "string" && raw.name) source.name = raw.name;
    if (typeof raw.version === "number" && Number.isFinite(raw.version)) {
      source.version = Math.max(1, Math.floor(raw.version));
    }
    return Object.keys(source).length > 0 ? source : void 0;
  }
  function normalizeBoard(raw, portTypeOf) {
    if (!isObject(raw)) return emptyBoard();
    const nodes = Array.isArray(raw.nodes) ? raw.nodes.map(normalizeNode).filter((node) => node !== null) : [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = [];
    const seen = /* @__PURE__ */ new Set();
    if (Array.isArray(raw.edges)) {
      for (const item of raw.edges) {
        if (!isObject(item)) continue;
        const { id, source: source2, sourcePort, target, targetPort } = item;
        if (typeof id !== "string" || !id || seen.has(id)) continue;
        if (typeof source2 !== "string" || typeof target !== "string") continue;
        if (typeof sourcePort !== "string" || typeof targetPort !== "string") continue;
        if (!nodeIds.has(source2) || !nodeIds.has(target)) continue;
        const kind = item.kind === "pair" ? "pair" : void 0;
        if (source2 === target) continue;
        if (portTypeOf) {
          const from = portTypeOf(source2, sourcePort, "out");
          const to = portTypeOf(target, targetPort, "in");
          if (!from || !to || !isPortType(from) || !isPortType(to)) continue;
        }
        seen.add(id);
        edges.push({ id, source: source2, sourcePort, target, targetPort, ...kind ? { kind } : {} });
      }
    }
    const rawViewport = isObject(raw.viewport) ? raw.viewport : {};
    const zoom = typeof rawViewport.zoom === "number" && Number.isFinite(rawViewport.zoom) ? Math.min(2.2, Math.max(0.15, rawViewport.zoom)) : 1;
    const viewport = {
      x: typeof rawViewport.x === "number" && Number.isFinite(rawViewport.x) ? rawViewport.x : 0,
      y: typeof rawViewport.y === "number" && Number.isFinite(rawViewport.y) ? rawViewport.y : 0,
      zoom
    };
    const source = normalizeBoardSource(raw.source);
    return {
      version: BOARD_VERSION,
      nodes,
      edges,
      viewport,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      ...source ? { source } : {}
    };
  }

  // src/core/board/projectBoards.ts
  var attached = /* @__PURE__ */ new WeakSet();
  function isBoardViewAttached(doc2) {
    return attached.has(doc2);
  }
  function newCanvasId() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return `canvas-${cryptoApi.randomUUID()}`;
    return `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function looksLikeBoard(value) {
    if (!value || typeof value !== "object") return false;
    const doc2 = value;
    return Array.isArray(doc2.nodes) && Array.isArray(doc2.edges);
  }
  function attachBoardView(input) {
    const descriptor = Object.getOwnPropertyDescriptor(input, "board");
    const hasAccessor = Boolean(descriptor?.get);
    const raw = input.boards;
    const list = Array.isArray(raw) && raw.length > 0 ? raw : [];
    const ownBoard = !hasAccessor && looksLikeBoard(descriptor?.value) ? descriptor?.value : void 0;
    let boards;
    if (list.length === 0) {
      const doc2 = ownBoard ? normalizeBoard(ownBoard) : emptyBoard();
      boards = [{ id: newCanvasId(), title: "", doc: doc2 }];
    } else {
      const activeIndex = Math.max(
        0,
        list.findIndex((canvas) => canvas.id === input.activeBoardId)
      );
      const patched = ownBoard && list[activeIndex]?.doc !== ownBoard ? normalizeBoard(ownBoard) : void 0;
      let changed = patched !== void 0;
      boards = list.map((canvas, index) => {
        const id = typeof canvas?.id === "string" && canvas.id ? canvas.id : newCanvasId();
        const rawTitle = typeof canvas?.title === "string" ? canvas.title.trim() : "";
        const title = isKnownMessageKey(rawTitle) ? "" : rawTitle;
        const doc2 = patched && index === activeIndex ? patched : looksLikeBoard(canvas?.doc) ? canvas.doc : normalizeBoard(canvas?.doc);
        if (id !== canvas?.id || title !== canvas?.title || doc2 !== canvas?.doc) changed = true;
        return { id, title, doc: doc2 };
      });
      if (!changed && attached.has(input) && hasAccessor && input.boards === list) {
        return input;
      }
    }
    const active = boards.find((canvas) => canvas.id === input.activeBoardId) ?? boards[0];
    const next = { ...input, boards, activeBoardId: active.id };
    delete next.board;
    Object.defineProperty(next, "board", {
      // 和 episodes 的 tracks / markers 一样是**可枚举**访问器：
      // `{ ...doc }` 展开时把活动画布文档带过去，外部展开过的文档仍然有 `board`。
      // 代价是 JSON 里会出现一份重复，由 `serializeProject()` 负责剔除。
      enumerable: true,
      configurable: true,
      get: () => {
        const current2 = next.boards ?? [];
        return (current2.find((canvas) => canvas.id === next.activeBoardId) ?? current2[0])?.doc;
      },
      set: (value) => {
        if (!value) return;
        const current2 = next.boards ?? [];
        const index = Math.max(
          0,
          current2.findIndex((canvas) => canvas.id === next.activeBoardId)
        );
        next.boards = current2.map(
          (canvas, item) => item === index ? { ...canvas, doc: value } : canvas
        );
      }
    });
    attached.add(next);
    return next;
  }

  // src/core/episodes.ts
  var attached2 = /* @__PURE__ */ new WeakSet();
  function hasEpisodes(doc2) {
    const episodes = doc2.episodes;
    return Array.isArray(episodes) && episodes.length > 0;
  }
  function activeEpisode(doc2) {
    const found = doc2.episodes.find((episode) => episode.id === doc2.activeEpisodeId);
    return found ?? doc2.episodes[0];
  }
  function newEpisode(name, order) {
    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      name,
      order,
      tracks: [],
      markers: [],
      createdAt: now,
      updatedAt: now
    };
  }
  function migrateToEpisodes(doc2) {
    if (hasEpisodes(doc2)) return doc2;
    const episode = {
      id: crypto.randomUUID(),
      name: t("episode.defaultName", { index: 1 }),
      order: 0,
      tracks: Array.isArray(doc2.tracks) ? doc2.tracks : [],
      markers: Array.isArray(doc2.markers) ? doc2.markers : [],
      createdAt: doc2.createdAt ?? Date.now(),
      updatedAt: Date.now()
    };
    return { ...doc2, version: 2, episodes: [episode], activeEpisodeId: episode.id };
  }
  function replaceActiveEpisode(doc2, patch) {
    const target = activeEpisode(doc2);
    doc2.episodes = doc2.episodes.map(
      (episode) => episode.id === target.id ? { ...episode, ...patch, updatedAt: Date.now() } : episode
    );
  }
  function defineView(doc2) {
    Object.defineProperties(doc2, {
      tracks: {
        // 必须是**可枚举**访问器：`{ ...doc }` 展开时才会把数组值拷过去，
        // 外部展开出来的文档因此仍然有 `doc.tracks`，不需要改造那 300 多处调用。
        // 代价是 JSON 里会出现重复字段，由 `serializeProject()` 负责剔除。
        enumerable: true,
        configurable: true,
        get: () => activeEpisode(doc2).tracks,
        set: (value) => replaceActiveEpisode(doc2, { tracks: value })
      },
      markers: {
        enumerable: true,
        configurable: true,
        get: () => activeEpisode(doc2).markers,
        set: (value) => replaceActiveEpisode(doc2, { markers: value })
      }
    });
    attached2.add(doc2);
    return doc2;
  }
  function attachEpisodeView(input) {
    const doc2 = hasEpisodes(input) ? input : migrateToEpisodes(input);
    const target = activeEpisode(doc2);
    const trackAccessor = Boolean(Object.getOwnPropertyDescriptor(doc2, "tracks")?.get);
    const markerAccessor = Boolean(Object.getOwnPropertyDescriptor(doc2, "markers")?.get);
    const ownTracks = !trackAccessor && Array.isArray(doc2.tracks);
    const ownMarkers = !markerAccessor && Array.isArray(doc2.markers);
    if (attached2.has(doc2) && isBoardViewAttached(doc2) && doc2.activeEpisodeId === target.id && trackAccessor && markerAccessor) {
      return doc2;
    }
    const tracks = ownTracks ? doc2.tracks : target.tracks;
    const markers2 = ownMarkers ? doc2.markers : target.markers;
    const episodes = doc2.episodes.map(
      (episode) => episode.id === target.id ? { ...episode, tracks, markers: markers2 } : episode
    );
    const next = { ...doc2, episodes, activeEpisodeId: target.id };
    delete next.tracks;
    delete next.markers;
    return defineView(attachBoardView(next));
  }
  function patchProjectMeta(doc2, patch) {
    const next = { ...doc2, ...patch };
    delete next.tracks;
    delete next.markers;
    return attachEpisodeView(next);
  }

  // src/core/ops/internal.ts
  function withTouch(doc2, patch) {
    return attachEpisodeView({ ...doc2, ...patch, updatedAt: Date.now() });
  }
  function replaceTrack(doc2, trackId, next) {
    const index = doc2.tracks.findIndex((t2) => t2.id === trackId);
    if (index < 0 || doc2.tracks[index] === next) return doc2;
    const tracks = doc2.tracks.slice();
    tracks[index] = next;
    return withTouch(doc2, { tracks });
  }
  function mapTrack(doc2, trackId, fn) {
    const track = doc2.tracks.find((t2) => t2.id === trackId);
    if (!track) return doc2;
    return replaceTrack(doc2, trackId, fn(track));
  }
  function mapTrackClips(doc2, trackId, fn) {
    return mapTrack(doc2, trackId, (track) => {
      const clips = fn(track.clips);
      return clips === track.clips ? track : { ...track, clips };
    });
  }
  function findClip(doc2, clipId) {
    for (const track of doc2.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }
  function sortClips(clips) {
    return clips.slice().sort((a, b) => a.start - b.start);
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // src/core/ops/assets.ts
  function addAsset(doc2, asset) {
    if (doc2.assets.some((a) => a.id === asset.id)) return doc2;
    return withTouch(doc2, { assets: [...doc2.assets, asset] });
  }
  function removeAsset(doc2, assetId) {
    const assets = doc2.assets.filter((a) => a.id !== assetId);
    if (assets.length === doc2.assets.length) return doc2;
    let changed = false;
    const tracks = doc2.tracks.map((track) => {
      const clips = track.clips.filter((c) => c.assetId !== assetId);
      if (clips.length === track.clips.length) return track;
      changed = true;
      return { ...track, clips };
    });
    return withTouch(doc2, changed ? { assets, tracks } : { assets });
  }
  function updateAsset(doc2, assetId, patch) {
    const index = doc2.assets.findIndex((a) => a.id === assetId);
    if (index < 0) return doc2;
    const assets = doc2.assets.slice();
    assets[index] = { ...assets[index], ...patch };
    return withTouch(doc2, { assets });
  }

  // src/types/project.ts
  var PROJECT_VERSION = 2;

  // src/core/factory.ts
  function newId() {
    return crypto.randomUUID();
  }
  function nextTrackName(project) {
    return t("track.autoName", { n: project.tracks.length + 1 });
  }
  function createTrack(name) {
    return {
      id: newId(),
      name: name ?? t("track.name"),
      muted: false,
      visible: true,
      locked: false,
      clips: []
    };
  }
  function createClip(input) {
    return {
      id: newId(),
      assetId: input.assetId,
      trackId: input.trackId,
      start: input.start,
      duration: input.duration,
      in: input.in ?? 0,
      ...input.speed !== void 0 && input.speed !== 1 ? { speed: input.speed } : {},
      ...input.text !== void 0 ? { text: input.text } : {},
      ...input.textStyle !== void 0 ? { textStyle: input.textStyle } : {}
    };
  }
  function newProject(name = "untitled") {
    const now = Date.now();
    const episode = newEpisode(t("episode.defaultName", { index: 1 }), 0);
    return attachEpisodeView({
      version: PROJECT_VERSION,
      name,
      createdAt: now,
      updatedAt: now,
      fps: 30,
      width: 1920,
      height: 1080,
      assets: [],
      episodes: [episode],
      activeEpisodeId: episode.id,
      tracks: episode.tracks,
      markers: episode.markers
    });
  }

  // src/core/ops/tracks.ts
  function addTrackAt(doc2, index, name) {
    const track = createTrack(name ?? nextTrackName(doc2));
    const at = Math.min(Math.max(0, index), doc2.tracks.length);
    const tracks = doc2.tracks.slice();
    tracks.splice(at, 0, track);
    return withTouch(doc2, { tracks });
  }
  function addTrack(doc2, name) {
    return addTrackAt(doc2, doc2.tracks.length, name);
  }
  function moveTrack(doc2, trackId, toIndex) {
    const from = doc2.tracks.findIndex((t2) => t2.id === trackId);
    if (from < 0) return doc2;
    const to = Math.min(Math.max(0, toIndex), doc2.tracks.length - 1);
    if (to === from) return doc2;
    const tracks = doc2.tracks.slice();
    const [track] = tracks.splice(from, 1);
    tracks.splice(to, 0, track);
    return withTouch(doc2, { tracks });
  }
  function raiseTracks(doc2, trackIds) {
    const wanted = new Set(trackIds);
    if (wanted.size === 0) return doc2;
    const raised = trackIds.map((id) => doc2.tracks.find((track) => track.id === id)).filter((track) => track !== void 0);
    if (raised.length === 0) return doc2;
    const tracks = [...raised, ...doc2.tracks.filter((track) => !wanted.has(track.id))];
    if (tracks.length === doc2.tracks.length && tracks.every((track, index) => track === doc2.tracks[index])) {
      return doc2;
    }
    return withTouch(doc2, { tracks });
  }
  function renameTrack(doc2, trackId, name) {
    const track = doc2.tracks.find((candidate) => candidate.id === trackId);
    const next = name.trim();
    if (!track || !next || track.name === next) return doc2;
    return replaceTrack(doc2, trackId, { ...track, name: next });
  }
  function removeTrack(doc2, trackId) {
    const tracks = doc2.tracks.filter((t2) => t2.id !== trackId);
    if (tracks.length === doc2.tracks.length) return doc2;
    return withTouch(doc2, { tracks });
  }
  function setTrackFlag(doc2, trackId, flag, value) {
    const track = doc2.tracks.find((t2) => t2.id === trackId);
    if (!track || track[flag] === value) return doc2;
    const next = flag === "muted" ? { ...track, muted: value } : flag === "visible" ? { ...track, visible: value } : { ...track, locked: value };
    return replaceTrack(doc2, trackId, next);
  }

  // src/core/clipColor.ts
  function clamp2(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function normalizeClipColor(input) {
    return {
      brightness: clamp2(input?.brightness ?? 0, -1, 1),
      contrast: clamp2(input?.contrast ?? 1, 0, 2),
      saturation: clamp2(input?.saturation ?? 1, 0, 3),
      temperature: clamp2(input?.temperature ?? 0, -1, 1),
      tint: clamp2(input?.tint ?? 0, -1, 1)
    };
  }
  function resolveClipColor(clip) {
    return normalizeClipColor(clip.color);
  }
  function isDefaultClipColor(color) {
    return Math.abs(color.brightness) < 1e-6 && Math.abs(color.contrast - 1) < 1e-6 && Math.abs(color.saturation - 1) < 1e-6 && Math.abs(color.temperature) < 1e-6 && Math.abs(color.tint) < 1e-6;
  }
  function clipColorFilters(clip) {
    const color = resolveClipColor(clip);
    if (isDefaultClipColor(color)) return [];
    const filters = [
      `eq=brightness=${color.brightness.toFixed(4)}:contrast=${color.contrast.toFixed(4)}:saturation=${color.saturation.toFixed(4)}`
    ];
    if (Math.abs(color.temperature) > 1e-6 || Math.abs(color.tint) > 1e-6) {
      const warm = color.temperature * 0.18;
      const green = color.tint * 0.18;
      filters.push(
        `colorbalance=rs=${warm.toFixed(4)}:gs=${green.toFixed(4)}:bs=${(-warm).toFixed(4)}:rm=${(warm * 0.7).toFixed(4)}:gm=${(green * 0.7).toFixed(4)}:bm=${(-warm * 0.7).toFixed(4)}:rh=${(warm * 0.4).toFixed(4)}:gh=${(green * 0.4).toFixed(4)}:bh=${(-warm * 0.4).toFixed(4)}`
      );
    }
    return filters;
  }

  // src/core/effects.ts
  var OFX_CLIP_EFFECT_CONTEXTS = /* @__PURE__ */ new Set([
    "OfxImageEffectContextFilter",
    "OfxImageEffectContextGeneral",
    "OfxImageEffectContextGenerator",
    "OfxImageEffectContextPaint",
    "OfxImageEffectContextRetimer"
  ]);
  var OFX_TRANSITION_CONTEXT = "OfxImageEffectContextTransition";
  var OFX_ALL_CONTEXTS = /* @__PURE__ */ new Set([
    ...OFX_CLIP_EFFECT_CONTEXTS,
    OFX_TRANSITION_CONTEXT
  ]);
  function normalizeClipEffect(value) {
    if (typeof value !== "object" || value === null) return null;
    const record = value;
    if (typeof record.plugin !== "string" || record.plugin === "") return null;
    if (typeof record.bundle !== "string" || record.bundle === "") return null;
    const params = {};
    if (typeof record.params === "object" && record.params !== null) {
      for (const [key, raw] of Object.entries(record.params)) {
        if (typeof raw === "number" && Number.isFinite(raw)) params[key] = raw;
        else if (typeof raw === "boolean") params[key] = raw;
        else if (typeof raw === "string") params[key] = raw;
        else if (Array.isArray(raw) && raw.every((v) => Number.isFinite(v))) {
          params[key] = raw;
        }
      }
    }
    return {
      id: typeof record.id === "string" && record.id ? record.id : crypto.randomUUID(),
      plugin: record.plugin,
      name: typeof record.name === "string" && record.name ? record.name : record.plugin,
      bundle: record.bundle,
      ...typeof record.context === "string" && record.context ? { context: record.context } : {},
      params,
      enabled: record.enabled !== false
    };
  }
  function normalizeClipEffects(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => normalizeClipEffect(item)).filter((item) => item !== null);
  }

  // src/core/clipTransition.ts
  var TYPES = ["fade", "slide", "ofx"];
  var DIRECTIONS = ["left", "right", "up", "down"];
  var MAX_OFX_TRANSITION_DURATION = 10;
  var DEFAULT_OFX_TRANSITION_DURATION = 1;
  var DEFAULT_TRANSITION_DURATION = 0.5;
  function normalizeClipTransition(input, clipDuration) {
    if (!input?.type || !TYPES.includes(input.type)) return null;
    if (input.type === "ofx") {
      const effect = normalizeClipEffect(input.effect ?? null);
      if (!effect) return null;
      if (effect.context && effect.context !== OFX_TRANSITION_CONTEXT) {
        return null;
      }
      const duration2 = Math.min(
        Math.max(input.duration ?? DEFAULT_OFX_TRANSITION_DURATION, 0.1),
        MAX_OFX_TRANSITION_DURATION
      );
      return { type: "ofx", duration: duration2, effect };
    }
    const duration = Math.min(
      Math.max(input.duration ?? DEFAULT_TRANSITION_DURATION, 0),
      Math.max(0, clipDuration)
    );
    if (!(duration > 0)) return null;
    return {
      type: input.type,
      duration,
      ...input.type === "slide" ? {
        direction: input.direction && DIRECTIONS.includes(input.direction) ? input.direction : "left"
      } : {}
    };
  }

  // src/core/transform.ts
  var DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0 };
  var DEFAULT_TEXT_TRANSFORM = { x: 0, y: 30, scale: 1, rotation: 0 };
  function resolveTransform(clip) {
    if (clip.transform) return clip.transform;
    return clip.text !== void 0 ? DEFAULT_TEXT_TRANSFORM : DEFAULT_TRANSFORM;
  }
  function sameTransform(a, b) {
    return a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation;
  }
  function isDefaultTransform(value) {
    return sameTransform(value, DEFAULT_TRANSFORM);
  }

  // src/core/keyframes.ts
  var KEYFRAME_PROPERTIES = [
    "opacity",
    "x",
    "y",
    "scale",
    "rotation"
  ];
  var KEYFRAME_RANGES = {
    opacity: [0, 1],
    x: [-100, 100],
    y: [-100, 100],
    scale: [0.01, 10],
    rotation: [-360, 360]
  };
  function clamp3(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function number(value) {
    return String(Number(value.toFixed(6)));
  }
  function baseKeyframeValues(clip) {
    const transform = resolveTransform(clip);
    return {
      opacity: clamp3(clip.opacity ?? 1, 0, 1),
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
      rotation: transform.rotation
    };
  }
  function normalizeKeyframes(input, duration, base) {
    const sorted = (input ?? []).filter((frame) => Number.isFinite(frame.time)).map((frame) => {
      const values = { ...base };
      for (const property of KEYFRAME_PROPERTIES) {
        const value = frame[property];
        if (typeof value === "number" && Number.isFinite(value)) {
          const [min, max] = KEYFRAME_RANGES[property];
          values[property] = clamp3(value, min, max);
        }
      }
      return {
        time: clamp3(frame.time, 0, Math.max(0, duration)),
        ...values
      };
    }).sort((a, b) => a.time - b.time);
    const deduped = [];
    for (const frame of sorted) {
      if (deduped.length > 0 && Math.abs(deduped[deduped.length - 1].time - frame.time) < 1e-6) {
        deduped[deduped.length - 1] = frame;
      } else {
        deduped.push(frame);
      }
    }
    return deduped;
  }
  function keyframeExpression(keyframes, property, variable, offset = 0) {
    if (!keyframes || keyframes.length === 0) return null;
    const points = keyframes.map((frame) => ({
      time: frame.time + offset,
      value: frame[property]
    }));
    if (points.length === 1) return number(points[0].value);
    let expression = number(points[points.length - 1].value);
    for (let index = points.length - 1; index > 0; index -= 1) {
      const prev = points[index - 1];
      const next = points[index];
      const span = next.time - prev.time;
      if (span <= 0) continue;
      const segment = `(${number(prev.value)}+(${number(next.value)}-${number(prev.value)})*(${variable}-${number(prev.time)})/${number(span)})`;
      expression = `if(lt(${variable},${number(next.time)}),${segment},${expression})`;
    }
    expression = `if(lt(${variable},${number(points[0].time)}),${number(points[0].value)},${expression})`;
    return expression;
  }

  // src/core/ops/clips.ts
  function clipSpeed(clip) {
    return clamp(clip.speed ?? 1, 0.1, 4);
  }
  function addClip(doc2, trackId, clip) {
    const track = doc2.tracks.find((t2) => t2.id === trackId);
    if (!track || track.clips.some((c) => c.id === clip.id)) return doc2;
    return mapTrack(doc2, trackId, (t2) => ({
      ...t2,
      clips: sortClips([...t2.clips, { ...clip, trackId }])
    }));
  }
  function removeClips(doc2, clipIds) {
    if (clipIds.length === 0) return doc2;
    const ids = new Set(clipIds);
    let changed = false;
    const tracks = doc2.tracks.map((track) => {
      const clips = track.clips.filter((c) => !ids.has(c.id));
      if (clips.length === track.clips.length) return track;
      changed = true;
      return { ...track, clips };
    });
    return changed ? withTouch(doc2, { tracks }) : doc2;
  }
  function updateClip(doc2, clipId, patch) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const next = { ...found.clip, ...patch, id: found.clip.id, trackId: found.clip.trackId };
    return mapTrackClips(
      doc2,
      found.track.id,
      (clips) => clips.map((c) => c.id === clipId ? next : c)
    );
  }
  function constrainAgainst(moving, stationary) {
    let start = moving.start;
    const duration = moving.duration;
    for (const other of stationary) {
      const otherEnd = other.start + other.duration;
      const overlaps2 = start < otherEnd && other.start < start + duration;
      if (!overlaps2) continue;
      const rightEdge = otherEnd;
      const leftEdge = other.start - duration;
      if (leftEdge < 0) {
        start = rightEdge;
        continue;
      }
      start = Math.abs(rightEdge - start) <= Math.abs(leftEdge - start) ? rightEdge : leftEdge;
    }
    return { ...moving, start: Math.max(0, start) };
  }
  function moveClips(doc2, clipIds, deltaSec, targetTrackId) {
    const ids = new Set(clipIds);
    if (ids.size === 0) return doc2;
    if (targetTrackId && !doc2.tracks.some((t2) => t2.id === targetTrackId)) return doc2;
    const moving = [];
    for (const track of doc2.tracks) {
      for (const clip of track.clips) if (ids.has(clip.id)) moving.push(clip);
    }
    if (moving.length === 0) return doc2;
    if (deltaSec === 0 && (!targetTrackId || moving.every((c) => c.trackId === targetTrackId))) {
      return doc2;
    }
    const stationaryByTrack = /* @__PURE__ */ new Map();
    for (const track of doc2.tracks) {
      stationaryByTrack.set(track.id, track.clips.filter((c) => !ids.has(c.id)));
    }
    const resultByTrack = /* @__PURE__ */ new Map();
    for (const track of doc2.tracks) resultByTrack.set(track.id, [...stationaryByTrack.get(track.id) ?? []]);
    const moved = sortClips(
      moving.map((c) => ({ ...c, trackId: targetTrackId ?? c.trackId, start: Math.max(0, c.start + deltaSec) }))
    );
    for (const clip of moved) {
      const list = resultByTrack.get(clip.trackId) ?? [];
      const constrained = constrainAgainst(clip, list);
      resultByTrack.set(clip.trackId, sortClips([...list, constrained]));
    }
    const tracks = doc2.tracks.map((track) => {
      const clips = resultByTrack.get(track.id);
      return clips ? { ...track, clips } : track;
    });
    return withTouch(doc2, { tracks });
  }
  function neighbourBounds(track, clip) {
    let prevEnd = 0;
    let nextStart = Number.POSITIVE_INFINITY;
    for (const other of track.clips) {
      if (other.id === clip.id) continue;
      if (other.start + other.duration <= clip.start) {
        prevEnd = Math.max(prevEnd, other.start + other.duration);
      } else if (other.start >= clip.start + clip.duration) {
        nextStart = Math.min(nextStart, other.start);
      }
    }
    return { prevEnd, nextStart };
  }
  function hasUnboundedSource(asset, clip) {
    return clip.assetId === "" || !asset || asset.kind === "image";
  }
  function trimClip(doc2, clipId, edge, newTimeSec) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const { track, clip } = found;
    const asset = doc2.assets.find((a) => a.id === clip.assetId);
    const unbounded = hasUnboundedSource(asset, clip);
    const speed = clipSpeed(clip);
    const minDuration = 1 / doc2.fps;
    const snapped = Math.round(newTimeSec * doc2.fps) / doc2.fps;
    const { prevEnd, nextStart } = neighbourBounds(track, clip);
    const clipEnd = clip.start + clip.duration;
    let next;
    if (edge === "start") {
      const sourceStartLimit = unbounded ? 0 : clip.start - clip.in / speed;
      const minStart = Math.max(0, prevEnd, sourceStartLimit);
      const maxStart = clipEnd - minDuration;
      const start = maxStart <= minStart ? Math.max(0, maxStart) : Math.min(Math.max(snapped, minStart), maxStart);
      if (start === clip.start) return doc2;
      const delta = start - clip.start;
      next = {
        ...clip,
        start,
        duration: clip.duration - delta,
        // 无限素材向左延长时不搬动入点（入点保持 0）。
        in: unbounded ? clip.in : clip.in + delta * speed
      };
    } else {
      const sourceLimit = unbounded ? Infinity : clip.start + Math.max(0, (asset?.duration ?? 0) - clip.in) / speed;
      const maxEnd = Math.min(sourceLimit, nextStart);
      const minEnd = clip.start + minDuration;
      const end = maxEnd <= minEnd ? Math.max(clip.start, maxEnd) : Math.min(Math.max(snapped, minEnd), maxEnd);
      if (end === clipEnd) return doc2;
      next = { ...clip, duration: end - clip.start };
    }
    if (!(next.duration > 0)) return doc2;
    return mapTrackClips(doc2, track.id, (clips) => clips.map((c) => c.id === clipId ? next : c));
  }
  function splitClips(doc2, clipIds, atSec) {
    const ids = new Set(clipIds);
    if (ids.size === 0) return doc2;
    const at = Math.round(atSec * doc2.fps) / doc2.fps;
    let changed = false;
    const tracks = doc2.tracks.map((track) => {
      const targets = track.clips.filter(
        (c) => ids.has(c.id) && at > c.start && at < c.start + c.duration
      );
      if (targets.length === 0) return track;
      const targetIds = new Set(targets.map((c) => c.id));
      changed = true;
      const clips = [];
      for (const clip of track.clips) {
        if (!targetIds.has(clip.id)) {
          clips.push(clip);
          continue;
        }
        const leftDuration = at - clip.start;
        clips.push({ ...clip, duration: leftDuration });
        clips.push({
          ...clip,
          id: crypto.randomUUID(),
          start: at,
          duration: clip.duration - leftDuration,
          in: clip.in + leftDuration * clipSpeed(clip)
        });
      }
      return { ...track, clips: sortClips(clips) };
    });
    return changed ? withTouch(doc2, { tracks }) : doc2;
  }
  function duplicateClips(doc2, clipIds, offsetSec = 0, targetTrackId) {
    const ids = [...new Set(clipIds)];
    if (ids.length === 0) return doc2;
    if (targetTrackId && !doc2.tracks.some((track) => track.id === targetTrackId)) {
      throw new Error(`\u672A\u77E5\u8F68\u9053\uFF1A${targetTrackId}`);
    }
    const sources = [];
    for (const id of ids) {
      const found = findClip(doc2, id);
      if (!found) throw new Error(`\u7247\u6BB5\u4E0D\u5B58\u5728\uFF1A${id}`);
      sources.push(found.clip);
    }
    const placed = /* @__PURE__ */ new Map();
    for (const track of doc2.tracks) placed.set(track.id, [...track.clips]);
    for (const source of sources) {
      const trackId = targetTrackId ?? source.trackId;
      const start = Math.max(0, source.start + offsetSec);
      const next = {
        ...source,
        id: crypto.randomUUID(),
        trackId,
        start
      };
      const list = placed.get(trackId) ?? [];
      const clash = list.find(
        (other) => start < other.start + other.duration && other.start < start + next.duration
      );
      if (clash) {
        const index = doc2.tracks.findIndex((track) => track.id === trackId) + 1;
        throw new Error(
          `\u590D\u5236\u540E\u7684\u7247\u6BB5\u4F1A\u4E0E\u7B2C ${index} \u8F68\u7684\u73B0\u6709\u7247\u6BB5\u91CD\u53E0\uFF0C\u8BF7\u589E\u5927 offset \u6216\u6362\u4E00\u6761\u8F68\u9053`
        );
      }
      list.push(next);
      placed.set(trackId, list);
    }
    const tracks = doc2.tracks.map((track) => {
      const clips = placed.get(track.id);
      return clips ? { ...track, clips: sortClips(clips) } : track;
    });
    return withTouch(doc2, { tracks });
  }
  function rippleDeleteClips(doc2, clipIds) {
    const ids = new Set(clipIds);
    if (ids.size === 0) return doc2;
    let changed = false;
    const tracks = doc2.tracks.map((track) => {
      const removed = track.clips.filter((clip) => ids.has(clip.id));
      if (removed.length === 0) return track;
      changed = true;
      const gaps = removed.map((clip) => ({ start: clip.start, end: clip.start + clip.duration })).sort((a, b) => a.start - b.start);
      const clips = track.clips.filter((clip) => !ids.has(clip.id)).map((clip) => {
        let shift = 0;
        for (const gap of gaps) {
          if (gap.end <= clip.start + 1e-9) shift += gap.end - gap.start;
        }
        return shift > 0 ? { ...clip, start: Math.max(0, clip.start - shift) } : clip;
      });
      return { ...track, clips: sortClips(clips) };
    });
    return changed ? withTouch(doc2, { tracks }) : doc2;
  }
  function setClipGain(doc2, clipId, db) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const value = clamp(db, -60, 12);
    if (found.clip.gain === value) return doc2;
    return updateClip(doc2, clipId, { gain: value });
  }
  function setClipSpeed(doc2, clipId, value) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const { track, clip } = found;
    if (clip.assetId === "") return doc2;
    const asset = doc2.assets.find((candidate) => candidate.id === clip.assetId);
    const current2 = clipSpeed(clip);
    const speed = clamp(value, 0.1, 4);
    if (Math.abs(speed - current2) < 1e-6) return doc2;
    const sourceSpan = clip.duration * current2;
    if (!(sourceSpan > 0)) return doc2;
    const minDuration = 1 / doc2.fps;
    const position = track.clips.findIndex((candidate) => candidate.id === clipId);
    const nextClip = position >= 0 ? track.clips[position + 1] : null;
    let maxDuration = nextClip ? nextClip.start - clip.start : Number.POSITIVE_INFINITY;
    if (asset && asset.kind !== "image") {
      maxDuration = Math.min(
        maxDuration,
        Math.max(minDuration, (asset.duration - clip.in) / speed)
      );
    }
    if (!(maxDuration >= minDuration)) return doc2;
    let nextSpeed = speed;
    const natural = sourceSpan / nextSpeed;
    if (natural < minDuration) nextSpeed = sourceSpan / minDuration;
    else if (natural > maxDuration) nextSpeed = sourceSpan / maxDuration;
    nextSpeed = clamp(nextSpeed, 0.1, 4);
    const duration = Math.max(minDuration, sourceSpan / nextSpeed);
    if (!(duration >= minDuration) || duration > maxDuration + 1e-6) return doc2;
    if (Math.abs(nextSpeed - current2) < 1e-6 && Math.abs(duration - clip.duration) < 1e-9) {
      return doc2;
    }
    return updateClip(doc2, clipId, { speed: nextSpeed, duration });
  }
  function setClipColor(doc2, clipId, patch) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const current2 = resolveClipColor(found.clip);
    const next = normalizeClipColor({ ...current2, ...patch });
    if (isDefaultClipColor(next)) {
      return found.clip.color === void 0 ? doc2 : updateClip(doc2, clipId, { color: void 0 });
    }
    if (found.clip.color !== void 0 && next.brightness === current2.brightness && next.contrast === current2.contrast && next.saturation === current2.saturation && next.temperature === current2.temperature && next.tint === current2.tint) {
      return doc2;
    }
    return updateClip(doc2, clipId, { color: next });
  }
  function setClipTransition(doc2, clipId, edge, patch) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const current2 = edge === "in" ? found.clip.transitionIn : found.clip.transitionOut;
    const next = patch === null ? null : normalizeClipTransition({ ...current2 ?? {}, ...patch }, found.clip.duration);
    if (!next) {
      if (current2 === void 0) return doc2;
      return edge === "in" ? updateClip(doc2, clipId, { transitionIn: void 0 }) : updateClip(doc2, clipId, { transitionOut: void 0 });
    }
    if (current2 && current2.type === next.type && current2.duration === next.duration && current2.direction === next.direction && JSON.stringify(current2.effect ?? null) === JSON.stringify(next.effect ?? null)) {
      return doc2;
    }
    return edge === "in" ? updateClip(doc2, clipId, { transitionIn: next }) : updateClip(doc2, clipId, { transitionOut: next });
  }
  function setClipKeyframes(doc2, clipId, keyframes) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    if (keyframes === null) {
      return found.clip.keyframes === void 0 ? doc2 : updateClip(doc2, clipId, { keyframes: void 0 });
    }
    const normalized = normalizeKeyframes(
      keyframes,
      found.clip.duration,
      baseKeyframeValues(found.clip)
    );
    if (normalized.length === 0) {
      return found.clip.keyframes === void 0 ? doc2 : updateClip(doc2, clipId, { keyframes: void 0 });
    }
    return updateClip(doc2, clipId, { keyframes: normalized });
  }
  function setClipMuted(doc2, clipId, muted) {
    const found = findClip(doc2, clipId);
    if (!found || Boolean(found.clip.muted) === muted) return doc2;
    return updateClip(doc2, clipId, { muted });
  }

  // src/core/ops/markers.ts
  var MARKER_KINDS = ["scene", "hit", "review", "chapter"];
  var SEVERITIES = ["blocker", "high", "medium", "low"];
  function sortMarkers(markers2) {
    return markers2.slice().sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  }
  function normalizeBBox(input) {
    if (!input) return void 0;
    const values = [input.x, input.y, input.width, input.height];
    if (values.some((value) => !Number.isFinite(value))) return void 0;
    return {
      x: Math.min(1, Math.max(0, input.x)),
      y: Math.min(1, Math.max(0, input.y)),
      width: Math.min(1, Math.max(0, input.width)),
      height: Math.min(1, Math.max(0, input.height))
    };
  }
  function normalizeMarker(marker) {
    const kind = MARKER_KINDS.includes(marker.kind) ? marker.kind : void 0;
    const severity = SEVERITIES.includes(marker.severity) ? marker.severity : void 0;
    const note = marker.note?.trim();
    const sceneId = marker.sceneId?.trim();
    const screenshot = marker.screenshot?.trim();
    const tags = marker.tags?.map((tag) => tag.trim()).filter(Boolean);
    const bbox = normalizeBBox(marker.bbox);
    return {
      id: marker.id,
      time: Math.max(0, marker.time),
      name: marker.name.trim(),
      ...marker.color ? { color: marker.color } : {},
      ...kind ? { kind } : {},
      ...sceneId ? { sceneId } : {},
      ...note ? { note } : {},
      ...severity ? { severity } : {},
      ...marker.resolved === true ? { resolved: true } : {},
      ...bbox ? { bbox } : {},
      ...screenshot ? { screenshot } : {},
      ...tags && tags.length > 0 ? { tags } : {},
      ...typeof marker.createdAt === "number" ? { createdAt: marker.createdAt } : {}
    };
  }
  function sameBBox(a, b) {
    if (!a || !b) return a === b;
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }
  function sameMarker(a, b) {
    return a.time === b.time && a.name === b.name && a.color === b.color && a.kind === b.kind && a.sceneId === b.sceneId && a.note === b.note && a.severity === b.severity && a.resolved === b.resolved && sameBBox(a.bbox, b.bbox) && a.screenshot === b.screenshot && (a.tags ?? []).join("\0") === (b.tags ?? []).join("\0") && a.createdAt === b.createdAt;
  }
  function addMarker(doc2, marker) {
    const now = Date.now();
    const next = normalizeMarker({ createdAt: now, ...marker });
    if (doc2.markers.some((candidate) => candidate.id === next.id)) return doc2;
    return withTouch(doc2, { markers: sortMarkers([...doc2.markers, next]) });
  }
  function updateMarker(doc2, markerId, patch) {
    const index = doc2.markers.findIndex((marker) => marker.id === markerId);
    if (index < 0) return doc2;
    const current2 = doc2.markers[index];
    const next = normalizeMarker({ ...current2, updatedAt: Date.now(), ...patch });
    if (sameMarker(current2, next)) return doc2;
    const markers2 = doc2.markers.slice();
    markers2[index] = next;
    return withTouch(doc2, { markers: sortMarkers(markers2) });
  }
  function removeMarker(doc2, markerId) {
    const markers2 = doc2.markers.filter((marker) => marker.id !== markerId);
    if (markers2.length === doc2.markers.length) return doc2;
    return withTouch(doc2, { markers: markers2 });
  }

  // src/core/projectOutput.ts
  var MIN_PROJECT_DIMENSION = 16;
  var MAX_PROJECT_DIMENSION = 8192;
  var MIN_PROJECT_FPS = 1;
  var MAX_PROJECT_FPS = 120;
  function evenDimension(value) {
    if (!Number.isFinite(value)) return MIN_PROJECT_DIMENSION;
    const rounded = Math.round(value);
    const even = rounded % 2 === 0 ? rounded : rounded + 1;
    return Math.min(MAX_PROJECT_DIMENSION, Math.max(MIN_PROJECT_DIMENSION, even));
  }
  function normalizeFps(value) {
    if (!Number.isFinite(value) || value <= 0) return 30;
    const clamped = Math.min(MAX_PROJECT_FPS, Math.max(MIN_PROJECT_FPS, value));
    return Math.round(clamped * 1e3) / 1e3;
  }

  // src/core/ops/project.ts
  function renameProject(doc2, name) {
    if (doc2.name === name) return doc2;
    return withTouch(doc2, { name });
  }
  function setProjectOutput(doc2, patch) {
    const width = patch.width === void 0 ? doc2.width : evenDimension(patch.width);
    const height = patch.height === void 0 ? doc2.height : evenDimension(patch.height);
    const fps = patch.fps === void 0 ? doc2.fps : normalizeFps(patch.fps);
    if (width === doc2.width && height === doc2.height && fps === doc2.fps) return doc2;
    return withTouch(doc2, { width, height, fps });
  }

  // src/core/subtitleTrack.ts
  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function cueTrackPattern(baseName) {
    return new RegExp(`^${escapeRegExp(baseName)}(?:\\s+\\d+)?$`);
  }
  function uniqueCueTrackName(doc2, baseName) {
    const taken = new Set(doc2.tracks.map((track) => track.name));
    if (!taken.has(baseName)) return baseName;
    let index = 2;
    while (taken.has(`${baseName} ${index}`)) index += 1;
    return `${baseName} ${index}`;
  }
  function insertCueTrack(doc2, cues, baseName) {
    const usable = cues.filter((cue) => cue.text.trim().length > 0);
    if (usable.length === 0) return doc2;
    let next = addTrackAt(doc2, 0, uniqueCueTrackName(doc2, baseName));
    const trackId = next.tracks[0].id;
    for (const cue of usable) {
      next = addClip(
        next,
        trackId,
        createClip({
          assetId: "",
          trackId,
          start: cue.start,
          duration: cue.duration,
          text: cue.text
        })
      );
    }
    return next;
  }
  function raiseCueTracks(doc2, pattern) {
    const ids = doc2.tracks.filter((track) => pattern.test(track.name)).map((track) => track.id);
    return raiseTracks(doc2, ids);
  }
  function placeSubtitleCues(doc2, entries, baseName, offset = 0) {
    if (entries.length === 0) return doc2;
    const pattern = cueTrackPattern(baseName);
    const lanes = [];
    for (const track of doc2.tracks) {
      if (track.locked || !pattern.test(track.name)) continue;
      lanes.push({
        id: track.id,
        spans: track.clips.map((clip) => ({
          start: clip.start,
          end: clip.start + clip.duration
        }))
      });
    }
    let next = doc2;
    const ordered2 = entries.filter((entry) => entry.text.trim().length > 0).slice().sort((a, b) => a.start - b.start || a.end - b.end);
    for (const entry of ordered2) {
      const start = Math.max(0, entry.start + offset);
      const duration = Math.max(1 / doc2.fps, entry.end - entry.start);
      const end = start + duration;
      let lane = lanes.find(
        (candidate) => candidate.spans.every((span) => end <= span.start || start >= span.end)
      );
      if (!lane) {
        next = addTrackAt(next, 0, uniqueCueTrackName(next, baseName));
        const track = next.tracks[0];
        lane = { id: track.id, spans: [] };
        lanes.push(lane);
      }
      next = addClip(
        next,
        lane.id,
        createClip({
          assetId: "",
          trackId: lane.id,
          start,
          duration,
          text: entry.text.trim()
        })
      );
      lane.spans.push({ start, end });
    }
    return raiseCueTracks(next, pattern);
  }

  // src/core/commands/index.ts
  var EMPTY_AFFECTED = { clipIds: [], trackIds: [], assetIds: [] };
  function invalid(message) {
    throw new Error(`${t("error.command.invalidPayload")}\uFF1A${message}`);
  }
  function asRecord(value, field) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      invalid(`${field} \u5FC5\u987B\u662F\u5BF9\u8C61`);
    }
    return value;
  }
  function asString(value, field) {
    if (typeof value !== "string" || value.length === 0) invalid(`${field} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
    return value;
  }
  function asNumber(value, field) {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${field} \u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57`);
    return value;
  }
  function asStringArray(value, field) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      invalid(`${field} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4`);
    }
    return value;
  }
  var MARKER_KINDS2 = ["scene", "hit", "review", "chapter"];
  var REVIEW_SEVERITIES = ["blocker", "high", "medium", "low"];
  function optionalString(value, field) {
    if (value === void 0 || value === null) return void 0;
    if (typeof value !== "string") invalid(`${field} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
    return value;
  }
  function optionalBoolean(value, field) {
    if (value === void 0 || value === null) return void 0;
    if (typeof value !== "boolean") invalid(`${field} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
    return value;
  }
  function optionalMarkerKind(value) {
    if (value === void 0 || value === null) return void 0;
    if (!MARKER_KINDS2.includes(value)) {
      invalid(`marker.kind \u5FC5\u987B\u662F ${MARKER_KINDS2.join(" / ")}`);
    }
    return value;
  }
  function optionalSeverity(value) {
    if (value === void 0 || value === null) return void 0;
    if (!REVIEW_SEVERITIES.includes(value)) {
      invalid(`severity \u5FC5\u987B\u662F ${REVIEW_SEVERITIES.join(" / ")}`);
    }
    return value;
  }
  function optionalBBox(value) {
    if (value === void 0) return void 0;
    if (value === null) return null;
    const record = asRecord(value, "bbox");
    const bbox = {
      x: asNumber(record.x, "bbox.x"),
      y: asNumber(record.y, "bbox.y"),
      width: asNumber(record.width, "bbox.width"),
      height: asNumber(record.height, "bbox.height")
    };
    for (const [key, item] of Object.entries(bbox)) {
      if (item < 0 || item > 1) invalid(`bbox.${key} \u5FC5\u987B\u5728 0 \u5230 1 \u4E4B\u95F4`);
    }
    return bbox;
  }
  function optionalTags(value) {
    if (value === void 0 || value === null) return void 0;
    return asStringArray(value, "tags").map((tag) => tag.trim()).filter(Boolean);
  }
  function asAsset(value) {
    const record = asRecord(value, "asset");
    asString(record.id, "asset.id");
    asString(record.name, "asset.name");
    asString(record.kind, "asset.kind");
    asString(record.src, "asset.src");
    asNumber(record.duration, "asset.duration");
    return record;
  }
  function asNewClip(value, trackId) {
    const record = asRecord(value, "clip");
    const start = asNumber(record.start, "clip.start");
    const duration = asNumber(record.duration, "clip.duration");
    if (!(duration > 0)) invalid("clip.duration \u5FC5\u987B\u5927\u4E8E 0");
    if (typeof record.assetId !== "string") invalid("clip.assetId \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
    return {
      ...record,
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : crypto.randomUUID(),
      assetId: record.assetId,
      trackId,
      start,
      duration,
      in: record.in === void 0 ? 0 : asNumber(record.in, "clip.in")
    };
  }
  function clipIndex(doc2) {
    const map = /* @__PURE__ */ new Map();
    for (const track of doc2.tracks) {
      for (const clip of track.clips) map.set(clip.id, clip);
    }
    return map;
  }
  function resolveTrack(doc2, value, field) {
    if (typeof value === "string" && value.length > 0) {
      const byId = doc2.tracks.find((track) => track.id === value);
      if (byId) return byId;
      const index = Number(value);
      if (Number.isInteger(index) && index >= 1 && index <= doc2.tracks.length) {
        return doc2.tracks[index - 1];
      }
    }
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= doc2.tracks.length) {
      return doc2.tracks[value - 1];
    }
    invalid(`${field} \u5FC5\u987B\u662F\u8F68\u9053 id \u6216 1 \u8D77\u59CB index`);
  }
  function validateClip(doc2, clip, trackId, ignoreClipId) {
    if (!(clip.duration > 0)) invalid("clip.duration \u5FC5\u987B\u5927\u4E8E 0");
    if (!(clip.start >= 0)) invalid("clip.start \u4E0D\u80FD\u4E3A\u8D1F");
    if (!(clip.in >= 0)) invalid("clip.in \u4E0D\u80FD\u4E3A\u8D1F");
    const speed = clip.speed ?? 1;
    if (!(speed >= 0.1 && speed <= 4)) invalid("clip.speed \u5FC5\u987B\u5728 0.1 \u5230 4 \u4E4B\u95F4");
    const track = doc2.tracks.find((candidate) => candidate.id === trackId);
    if (!track) invalid(`\u672A\u77E5\u8F68\u9053\uFF1A${trackId}`);
    if (clip.assetId !== "") {
      const asset = doc2.assets.find((candidate) => candidate.id === clip.assetId);
      if (!asset) invalid(`\u672A\u77E5\u7D20\u6750\uFF1A${clip.assetId}`);
      if (asset.kind !== "image") {
        const epsilon = 1 / doc2.fps + 1e-6;
        if (clip.in + clip.duration * speed > asset.duration + epsilon) {
          invalid(`\u7247\u6BB5\u8D85\u51FA\u7D20\u6750\u8303\u56F4\uFF1Ain + duration \xD7 speed > ${asset.duration}`);
        }
      }
    }
    const end = clip.start + clip.duration;
    for (const other of track.clips) {
      if (other.id === ignoreClipId) continue;
      if (clip.start < other.start + other.duration && other.start < end) {
        throw new Error(t("error.command.overlap", { n: doc2.tracks.indexOf(track) + 1 }));
      }
    }
  }
  function diffAffected(before, after) {
    if (before === after) return { ...EMPTY_AFFECTED, episodeId: after.activeEpisodeId };
    const clipIds = /* @__PURE__ */ new Set();
    const trackIds = /* @__PURE__ */ new Set();
    const assetIds = /* @__PURE__ */ new Set();
    const beforeClips = clipIndex(before);
    const afterClips = clipIndex(after);
    for (const [id, clip] of beforeClips) {
      const next = afterClips.get(id);
      if (!next || next !== clip) clipIds.add(id);
    }
    for (const [id, clip] of afterClips) {
      if (!beforeClips.has(id) || beforeClips.get(id) !== clip) clipIds.add(id);
    }
    const beforeTracks = new Map(before.tracks.map((track) => [track.id, track]));
    const afterTracks = new Map(after.tracks.map((track) => [track.id, track]));
    for (const [id, track] of beforeTracks) {
      const next = afterTracks.get(id);
      if (!next || next !== track) trackIds.add(id);
    }
    for (const [id, track] of afterTracks) {
      if (!beforeTracks.has(id) || beforeTracks.get(id) !== track) trackIds.add(id);
    }
    const beforeAssets = new Map(before.assets.map((asset) => [asset.id, asset]));
    const afterAssets = new Map(after.assets.map((asset) => [asset.id, asset]));
    for (const [id, asset] of beforeAssets) {
      const next = afterAssets.get(id);
      if (!next || next !== asset) assetIds.add(id);
    }
    for (const [id, asset] of afterAssets) {
      if (!beforeAssets.has(id) || beforeAssets.get(id) !== asset) assetIds.add(id);
    }
    let range;
    if (clipIds.size > 0) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const id of clipIds) {
        const clip = afterClips.get(id) ?? beforeClips.get(id);
        if (!clip) continue;
        min = Math.min(min, clip.start);
        max = Math.max(max, clip.start + clip.duration);
      }
      if (Number.isFinite(min) && Number.isFinite(max)) range = [min, max];
    }
    return {
      clipIds: [...clipIds],
      trackIds: [...trackIds],
      assetIds: [...assetIds],
      ...range ? { range } : {},
      // 会话广播靠它把补丁打到同一分P（工程文档 v2）。
      episodeId: after.activeEpisodeId
    };
  }
  function applyCommandToDoc(doc2, command) {
    const payload = asRecord(command.payload, "payload");
    let next = doc2;
    switch (command.kind) {
      case "asset.add": {
        next = addAsset(doc2, asAsset(payload.asset));
        break;
      }
      case "asset.remove": {
        next = removeAsset(doc2, asString(payload.assetId, "assetId"));
        break;
      }
      case "asset.update": {
        next = updateAsset(
          doc2,
          asString(payload.assetId, "assetId"),
          asRecord(payload.patch, "patch")
        );
        break;
      }
      case "clip.add": {
        const trackId = resolveTrack(doc2, payload.trackId, "trackId").id;
        const clip = asNewClip(payload.clip, trackId);
        validateClip(doc2, clip, trackId);
        next = addClip(doc2, trackId, clip);
        break;
      }
      case "clip.update": {
        const clipId = asString(payload.clipId, "clipId");
        const patch = asRecord(payload.patch, "patch");
        if ("id" in patch || "trackId" in patch) {
          invalid("clip.update \u4E0D\u652F\u6301\u4FEE\u6539 id / trackId\uFF1B\u8DE8\u8F68\u8BF7\u7528 clip.move");
        }
        const found = clipIndex(doc2).get(clipId);
        if (!found) invalid(`\u7247\u6BB5\u4E0D\u5B58\u5728\uFF1A${clipId}`);
        const updated = { ...found, ...patch, id: found.id, trackId: found.trackId };
        validateClip(doc2, updated, found.trackId, clipId);
        next = updateClip(doc2, clipId, patch);
        break;
      }
      case "clip.remove": {
        next = removeClips(doc2, asStringArray(payload.clipIds, "clipIds"));
        break;
      }
      case "clip.split": {
        next = splitClips(
          doc2,
          asStringArray(payload.clipIds, "clipIds"),
          asNumber(payload.at, "at")
        );
        break;
      }
      case "clip.trim": {
        const edge = payload.edge;
        if (edge !== "start" && edge !== "end") invalid("edge \u5FC5\u987B\u662F start \u6216 end");
        next = trimClip(
          doc2,
          asString(payload.clipId, "clipId"),
          edge,
          asNumber(payload.time, "time")
        );
        break;
      }
      case "clip.move": {
        next = moveClips(
          doc2,
          asStringArray(payload.clipIds, "clipIds"),
          asNumber(payload.delta, "delta"),
          payload.targetTrackId === void 0 ? void 0 : resolveTrack(doc2, payload.targetTrackId, "targetTrackId").id
        );
        break;
      }
      case "clip.append": {
        const assetId = asString(payload.assetId, "assetId");
        const asset = doc2.assets.find((candidate) => candidate.id === assetId);
        if (!asset) invalid(`\u672A\u77E5\u7D20\u6750\uFF1A${assetId}`);
        let base = doc2;
        let track;
        if (payload.trackId !== void 0) {
          track = resolveTrack(base, payload.trackId, "trackId");
        } else if (base.tracks.length > 0) {
          track = base.tracks[base.tracks.length - 1];
        } else {
          const name = payload.trackName === void 0 ? void 0 : asString(payload.trackName, "trackName").trim();
          if (name !== void 0 && name.length === 0) invalid("trackName \u4E0D\u80FD\u4E3A\u7A7A");
          base = addTrackAt(base, base.tracks.length, name);
          track = base.tracks[base.tracks.length - 1];
        }
        const inPoint = payload.in === void 0 ? 0 : asNumber(payload.in, "in");
        const start = payload.start === void 0 ? track.clips.reduce((end, clip2) => Math.max(end, clip2.start + clip2.duration), 0) : asNumber(payload.start, "start");
        const fallback = asset.kind === "image" ? 5 : Math.max(0, asset.duration - inPoint);
        const duration = payload.duration === void 0 ? fallback : asNumber(payload.duration, "duration");
        if (!(duration > 0)) invalid("duration \u5FC5\u987B\u5927\u4E8E 0\uFF1B\u56FE\u7247\u7D20\u6750\u8BF7\u663E\u5F0F\u4F20\u5165 duration");
        const clip = createClip({
          assetId,
          trackId: track.id,
          start,
          duration,
          in: inPoint
        });
        validateClip(base, clip, track.id);
        next = addClip(base, track.id, clip);
        break;
      }
      case "clip.speed": {
        const clipId = asString(payload.clipId, "clipId");
        const speed = asNumber(payload.speed, "speed");
        if (!(speed >= 0.1 && speed <= 4)) invalid("speed \u5FC5\u987B\u5728 0.1 \u5230 4 \u4E4B\u95F4");
        next = setClipSpeed(doc2, clipId, speed);
        break;
      }
      case "clip.color": {
        const clipId = asString(payload.clipId, "clipId");
        const patch = asRecord(payload.patch, "patch");
        const clean = {};
        const ranges = {
          brightness: [-1, 1],
          contrast: [0, 2],
          saturation: [0, 3],
          temperature: [-1, 1],
          tint: [-1, 1]
        };
        for (const key of Object.keys(ranges)) {
          if (patch[key] === void 0) continue;
          const value = asNumber(patch[key], key);
          const [min, max] = ranges[key];
          if (value < min || value > max) {
            invalid(`${key} \u5FC5\u987B\u5728 ${min} \u5230 ${max} \u4E4B\u95F4`);
          }
          clean[key] = value;
        }
        next = setClipColor(doc2, clipId, clean);
        break;
      }
      case "clip.transition": {
        const clipId = asString(payload.clipId, "clipId");
        const edgeValue = asString(payload.edge, "edge");
        if (edgeValue !== "in" && edgeValue !== "out") invalid("edge \u5FC5\u987B\u662F in / out");
        if (payload.transition === null) {
          next = setClipTransition(doc2, clipId, edgeValue, null);
          break;
        }
        const transition = asRecord(payload.transition, "transition");
        const clean = {};
        if (transition.type !== void 0) {
          const type = asString(transition.type, "type");
          if (type !== "fade" && type !== "slide" && type !== "ofx") {
            invalid("type \u5FC5\u987B\u662F fade / slide / ofx");
          }
          clean.type = type;
        }
        if (transition.duration !== void 0) {
          const duration = asNumber(transition.duration, "duration");
          if (duration < 0) invalid("duration \u4E0D\u80FD\u4E3A\u8D1F");
          clean.duration = duration;
        }
        if (transition.effect !== void 0) {
          const effect = asRecord(transition.effect, "effect");
          const normalized = normalizeClipEffect(effect);
          if (!normalized) invalid("effect \u5FC5\u987B\u662F\u6709\u6548\u7684 OFX \u6548\u679C");
          clean.effect = normalized;
        }
        if (transition.type === "ofx" && !clean.effect) {
          invalid("ofx \u8F6C\u573A\u5FC5\u987B\u5E26 effect");
        }
        if (transition.direction !== void 0) {
          const direction = asString(transition.direction, "direction");
          if (direction !== "left" && direction !== "right" && direction !== "up" && direction !== "down") {
            invalid("direction \u5FC5\u987B\u662F left / right / up / down");
          }
          clean.direction = direction;
        }
        next = setClipTransition(doc2, clipId, edgeValue, clean);
        break;
      }
      case "clip.keyframes": {
        const clipId = asString(payload.clipId, "clipId");
        if (payload.keyframes === null) {
          next = setClipKeyframes(doc2, clipId, null);
          break;
        }
        if (!Array.isArray(payload.keyframes)) invalid("keyframes \u5FC5\u987B\u662F\u6570\u7EC4\u6216 null");
        const frames = payload.keyframes.map((frame, index) => {
          const record = asRecord(frame, `keyframes[${index}]`);
          const time = asNumber(record.time, `keyframes[${index}].time`);
          if (time < 0) invalid(`keyframes[${index}].time \u4E0D\u80FD\u4E3A\u8D1F`);
          const values = { time };
          for (const property of KEYFRAME_PROPERTIES) {
            if (record[property] === void 0) continue;
            const value = asNumber(record[property], `keyframes[${index}].${property}`);
            const [min, max] = KEYFRAME_RANGES[property];
            if (value < min || value > max) {
              invalid(`keyframes[${index}].${property} \u5FC5\u987B\u5728 ${min} \u5230 ${max} \u4E4B\u95F4`);
            }
            values[property] = value;
          }
          return values;
        });
        next = setClipKeyframes(doc2, clipId, frames);
        break;
      }
      case "clip.duplicate": {
        const target = payload.targetTrackId === void 0 ? void 0 : resolveTrack(doc2, payload.targetTrackId, "targetTrackId").id;
        next = duplicateClips(
          doc2,
          asStringArray(payload.clipIds, "clipIds"),
          payload.offset === void 0 ? 0 : asNumber(payload.offset, "offset"),
          target
        );
        break;
      }
      case "clip.ripple_delete": {
        const clipIds = asStringArray(payload.clipIds, "clipIds");
        const known = clipIndex(doc2);
        for (const id of clipIds) {
          if (!known.has(id)) invalid(`\u7247\u6BB5\u4E0D\u5B58\u5728\uFF1A${id}`);
        }
        next = rippleDeleteClips(doc2, clipIds);
        break;
      }
      case "track.add": {
        const name = payload.name === void 0 ? void 0 : asString(payload.name, "name").trim();
        if (name !== void 0 && name.length === 0) invalid("name \u4E0D\u80FD\u4E3A\u7A7A");
        next = addTrackAt(
          doc2,
          payload.index === void 0 ? doc2.tracks.length : asNumber(payload.index, "index"),
          name
        );
        break;
      }
      case "track.update": {
        const trackId = resolveTrack(doc2, payload.trackId, "trackId").id;
        const patch = asRecord(payload.patch, "patch");
        if (patch.name !== void 0) {
          next = renameTrack(next, trackId, asString(patch.name, "name"));
        }
        for (const flag of ["muted", "visible", "locked"]) {
          const value = patch[flag];
          if (value === void 0) continue;
          if (typeof value !== "boolean") invalid(`${flag} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
          next = setTrackFlag(next, trackId, flag, value);
        }
        break;
      }
      case "track.remove": {
        next = removeTrack(doc2, resolveTrack(doc2, payload.trackId, "trackId").id);
        break;
      }
      case "track.move": {
        next = moveTrack(
          doc2,
          resolveTrack(doc2, payload.trackId, "trackId").id,
          asNumber(payload.toIndex, "toIndex")
        );
        break;
      }
      case "subtitle.import": {
        const raw = payload.entries;
        if (!Array.isArray(raw) || raw.length === 0) {
          invalid("entries \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
        }
        const entries = raw.map((item, index) => {
          const record = asRecord(item, `entries[${index}]`);
          const start = asNumber(record.start, `entries[${index}].start`);
          const end = asNumber(record.end, `entries[${index}].end`);
          const text = asString(record.text, `entries[${index}].text`);
          if (!(end > start)) invalid(`entries[${index}] \u7684 end \u5FC5\u987B\u5927\u4E8E start`);
          return { start, end, text };
        });
        const trackName = payload.trackName === void 0 ? void 0 : asString(payload.trackName, "trackName").trim();
        if (trackName !== void 0 && trackName.length === 0) {
          invalid("trackName \u4E0D\u80FD\u4E3A\u7A7A");
        }
        const offset = payload.offset === void 0 ? 0 : asNumber(payload.offset, "offset");
        next = placeSubtitleCues(
          doc2,
          entries,
          trackName || t("subtitle.track"),
          offset
        );
        break;
      }
      case "marker.add": {
        const time = asNumber(payload.time, "time");
        if (time < 0) invalid("time \u4E0D\u80FD\u4E3A\u8D1F");
        const name = payload.name === void 0 ? "" : asString(payload.name, "name").trim();
        const color = payload.color === void 0 ? void 0 : asString(payload.color, "color");
        const id = typeof payload.id === "string" && payload.id.length > 0 ? payload.id : crypto.randomUUID();
        const bbox = optionalBBox(payload.bbox);
        const kind = optionalMarkerKind(payload.kind);
        const severity = optionalSeverity(payload.severity);
        const sceneId = optionalString(payload.sceneId, "sceneId")?.trim();
        const note = optionalString(payload.note, "note")?.trim();
        const screenshot = optionalString(payload.screenshot, "screenshot")?.trim();
        const tags = optionalTags(payload.tags);
        const resolved = optionalBoolean(payload.resolved, "resolved");
        next = addMarker(doc2, {
          id,
          time,
          name: name || t("marker.defaultName", { n: doc2.markers.length + 1 }),
          ...color ? { color } : {},
          ...kind ? { kind } : {},
          ...sceneId ? { sceneId } : {},
          ...note ? { note } : {},
          ...severity ? { severity } : {},
          ...resolved === true ? { resolved: true } : {},
          ...bbox ? { bbox } : {},
          ...screenshot ? { screenshot } : {},
          ...tags && tags.length > 0 ? { tags } : {}
        });
        break;
      }
      case "marker.update": {
        const markerId = asString(payload.markerId, "markerId");
        const patch = asRecord(payload.patch, "patch");
        const clean = {};
        if (patch.time !== void 0) clean.time = asNumber(patch.time, "time");
        if (patch.name !== void 0) clean.name = asString(patch.name, "name");
        if (patch.color !== void 0) clean.color = asString(patch.color, "color");
        if (patch.kind !== void 0) clean.kind = optionalMarkerKind(patch.kind);
        if (patch.sceneId !== void 0) clean.sceneId = optionalString(patch.sceneId, "sceneId");
        if (patch.note !== void 0) clean.note = optionalString(patch.note, "note");
        if (patch.severity !== void 0) clean.severity = optionalSeverity(patch.severity);
        if (patch.resolved !== void 0) {
          clean.resolved = optionalBoolean(patch.resolved, "resolved");
        }
        if (patch.bbox !== void 0) clean.bbox = optionalBBox(patch.bbox);
        if (patch.screenshot !== void 0) {
          clean.screenshot = optionalString(patch.screenshot, "screenshot");
        }
        if (patch.tags !== void 0) clean.tags = optionalTags(patch.tags);
        next = updateMarker(doc2, markerId, clean);
        break;
      }
      case "marker.remove": {
        next = removeMarker(doc2, asString(payload.markerId, "markerId"));
        break;
      }
      case "project.rename": {
        next = renameProject(doc2, asString(payload.name, "name"));
        break;
      }
      case "project.output": {
        const patch = {};
        if (payload.width !== void 0) patch.width = asNumber(payload.width, "width");
        if (payload.height !== void 0) patch.height = asNumber(payload.height, "height");
        if (payload.fps !== void 0) patch.fps = asNumber(payload.fps, "fps");
        if (patch.width === void 0 && patch.height === void 0 && patch.fps === void 0) {
          invalid("project.output \u81F3\u5C11\u9700\u8981 width / height / fps \u4E4B\u4E00");
        }
        next = setProjectOutput(doc2, patch);
        break;
      }
      case "project.reset":
      case "ui.dispatch":
      case "history.undo":
      case "history.redo": {
        throw new Error(t("error.command.unknownKind", { kind: command.kind }));
      }
      default: {
        throw new Error(t("error.command.unknownKind", { kind: String(command.kind) }));
      }
    }
    return { doc: next, affected: diffAffected(doc2, next) };
  }

  // src/core/series/sanitize.ts
  function isObject2(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function normalizeSeriesGraph(value) {
    if (!isObject2(value)) return void 0;
    const edges = [];
    const seen = /* @__PURE__ */ new Set();
    if (Array.isArray(value.edges)) {
      for (const raw of value.edges) {
        if (!isObject2(raw)) continue;
        const id = typeof raw.id === "string" ? raw.id : "";
        const from = typeof raw.from === "string" ? raw.from : "";
        const to = typeof raw.to === "string" ? raw.to : "";
        if (!id || !from || !to || seen.has(id)) continue;
        seen.add(id);
        const label = typeof raw.label === "string" ? raw.label : "";
        edges.push(label ? { id, from, to, label } : { id, from, to });
      }
    }
    const positions = {};
    if (isObject2(value.positions)) {
      for (const [id, point] of Object.entries(value.positions)) {
        if (!isObject2(point) || !finite(point.x) || !finite(point.y)) continue;
        positions[id] = { x: point.x, y: point.y };
      }
    }
    return { custom: value.custom === true, edges, positions };
  }

  // src/core/serialize.ts
  function serializeProject(project) {
    const doc2 = attachEpisodeView(project);
    const wire = { ...doc2 };
    delete wire.tracks;
    delete wire.markers;
    delete wire.board;
    return JSON.stringify(wire, null, 2);
  }
  function isObject3(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function isNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function assertTracks(tracks) {
    for (const track of tracks) {
      if (!isObject3(track)) throw new Error(t("error.serialize.badTrack"));
      if (!Array.isArray(track.clips)) throw new Error(t("error.serialize.badClips"));
      for (const clip of track.clips) {
        if (!isObject3(clip)) throw new Error(t("error.serialize.badClip"));
        if (!isNumber(clip.start) || !isNumber(clip.duration) || !isNumber(clip.in)) {
          throw new Error(t("error.serialize.badClipTime"));
        }
      }
    }
  }
  function assertProjectShape(value) {
    if (!isObject3(value)) throw new Error(t("error.serialize.notObject"));
    if (value.version !== 1 && value.version !== PROJECT_VERSION) {
      throw new Error(
        t("error.serialize.version", {
          expected: PROJECT_VERSION,
          actual: String(value.version)
        })
      );
    }
    if (typeof value.name !== "string") throw new Error(t("error.serialize.missingName"));
    if (!isNumber(value.fps) || value.fps <= 0)
      throw new Error(t("error.serialize.badFps"));
    if (!isNumber(value.width) || !isNumber(value.height))
      throw new Error(t("error.serialize.badResolution"));
    if (!Array.isArray(value.assets)) throw new Error(t("error.serialize.badAssets"));
    if (value.version === 1) {
      if (!Array.isArray(value.tracks)) throw new Error(t("error.serialize.badTracks"));
      assertTracks(value.tracks);
      return;
    }
    if (!Array.isArray(value.episodes) || value.episodes.length === 0)
      throw new Error(t("error.serialize.badEpisodes"));
    if (typeof value.activeEpisodeId !== "string" || !value.activeEpisodeId)
      throw new Error(t("error.serialize.badActiveEpisode"));
    for (const episode of value.episodes) {
      if (!isObject3(episode) || typeof episode.id !== "string" || !episode.id)
        throw new Error(t("error.serialize.badEpisode"));
      if (!Array.isArray(episode.tracks) || !Array.isArray(episode.markers))
        throw new Error(t("error.serialize.badEpisode"));
      assertTracks(episode.tracks);
    }
  }
  function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function legacyKeyframeValue(frames, time, fallback) {
    if (!Array.isArray(frames)) return fallback;
    const points = frames.filter(
      (frame) => isObject3(frame) && isNumber(frame.time) && isNumber(frame.value)
    ).map((frame) => ({
      time: frame.time,
      value: frame.value
    })).sort((a, b) => a.time - b.time);
    if (points.length === 0) return fallback;
    if (time <= points[0].time) return points[0].value;
    for (let index = 1; index < points.length; index += 1) {
      if (time <= points[index].time) {
        const prev = points[index - 1];
        const next = points[index];
        const span = next.time - prev.time;
        if (span <= 0) return next.value;
        return prev.value + (next.value - prev.value) * (time - prev.time) / span;
      }
    }
    return points[points.length - 1].value;
  }
  function migrateClipKeyframes(clip) {
    const raw = clip.keyframes;
    if (raw === void 0 || raw === null) return void 0;
    const base = baseKeyframeValues(clip);
    if (Array.isArray(raw)) {
      const frames2 = normalizeKeyframes(raw, clip.duration, base);
      return frames2.length > 0 ? frames2 : void 0;
    }
    if (!isObject3(raw)) return void 0;
    const times = /* @__PURE__ */ new Set();
    for (const property of KEYFRAME_PROPERTIES) {
      const frames2 = raw[property];
      if (!Array.isArray(frames2)) continue;
      for (const frame of frames2) {
        if (isObject3(frame) && isNumber(frame.time)) {
          times.add(clampValue(frame.time, 0, Math.max(0, clip.duration)));
        }
      }
    }
    if (times.size === 0) return void 0;
    const inputs = [...times].sort((a, b) => a - b).map((time) => ({
      time,
      opacity: legacyKeyframeValue(raw.opacity, time, base.opacity),
      x: legacyKeyframeValue(raw.x, time, base.x),
      y: legacyKeyframeValue(raw.y, time, base.y),
      scale: legacyKeyframeValue(raw.scale, time, base.scale),
      rotation: legacyKeyframeValue(raw.rotation, time, base.rotation)
    }));
    const frames = normalizeKeyframes(inputs, clip.duration, base);
    return frames.length > 0 ? frames : void 0;
  }
  function normalizeCutScopes(project) {
    const raw = project.cutScopes;
    if (!Array.isArray(raw)) return void 0;
    const scopes = [];
    for (const item of raw) {
      if (!isObject3(item)) continue;
      if (typeof item.id !== "string" || typeof item.assetId !== "string" || typeof item.trackId !== "string" || !isNumber(item.baseIn) || !isNumber(item.baseOut) || !isNumber(item.baseStart) || !isObject3(item.template) || !Array.isArray(item.pieces) || !Array.isArray(item.cuts)) {
        continue;
      }
      const cuts = [];
      for (const cut of item.cuts) {
        if (!isObject3(cut) || !isNumber(cut.srcStart) || !isNumber(cut.srcEnd)) continue;
        cuts.push({
          id: typeof cut.id === "string" && cut.id ? cut.id : crypto.randomUUID(),
          srcStart: cut.srcStart,
          srcEnd: cut.srcEnd,
          kind: cut.kind === "pause" || cut.kind === "retake" || cut.kind === "manual" ? cut.kind : "filler",
          text: typeof cut.text === "string" ? cut.text : "",
          createdAt: isNumber(cut.createdAt) ? cut.createdAt : Date.now()
        });
      }
      const words = Array.isArray(item.words) ? item.words.filter(
        (word) => isObject3(word) && typeof word.text === "string" && isNumber(word.start) && isNumber(word.end)
      ).map((word) => ({ text: word.text, start: word.start, end: word.end })) : [];
      scopes.push({
        id: item.id,
        assetId: item.assetId,
        trackId: item.trackId,
        baseIn: item.baseIn,
        baseOut: item.baseOut,
        baseStart: item.baseStart,
        template: item.template,
        pieces: item.pieces.filter((id) => typeof id === "string"),
        cuts,
        ...words.length > 0 ? { words } : {},
        ...typeof item.timed === "boolean" ? { timed: item.timed } : {}
      });
    }
    return scopes.length > 0 ? scopes : void 0;
  }
  function normalizeTracks(source) {
    return source.map((track) => {
      const record = { ...track };
      const visible = record.visible !== false;
      delete record.solo;
      const clips = track.clips.map((clip) => {
        const next = { ...clip };
        delete next.mask;
        const normalized = next;
        const keyframes = migrateClipKeyframes(normalized);
        if (keyframes) normalized.keyframes = keyframes;
        else delete normalized.keyframes;
        const effects = normalizeClipEffects(normalized.effects);
        if (effects.length === 0) delete normalized.effects;
        else normalized.effects = effects;
        for (const edge of ["in", "out"]) {
          const key = edge === "in" ? "transitionIn" : "transitionOut";
          const current2 = normalized[key];
          if (!current2) continue;
          const transition = normalizeClipTransition(current2, normalized.duration);
          if (transition) normalized[key] = transition;
          else delete normalized[key];
        }
        return normalized;
      });
      return { ...record, visible, clips };
    });
  }
  function normalizeMarkers(source) {
    return Array.isArray(source) ? source.filter((marker) => isObject3(marker) && isNumber(marker.time)).map((marker) => {
      const severity = marker.severity === "blocker" || marker.severity === "high" || marker.severity === "medium" || marker.severity === "low" ? marker.severity : void 0;
      const kind = marker.kind === "scene" || marker.kind === "hit" || marker.kind === "review" || marker.kind === "chapter" ? marker.kind : void 0;
      const bbox = isObject3(marker.bbox) && isNumber(marker.bbox.x) && isNumber(marker.bbox.y) && isNumber(marker.bbox.width) && isNumber(marker.bbox.height) ? {
        x: marker.bbox.x,
        y: marker.bbox.y,
        width: marker.bbox.width,
        height: marker.bbox.height
      } : void 0;
      const tags = Array.isArray(marker.tags) ? marker.tags.filter((tag) => typeof tag === "string") : void 0;
      return {
        id: typeof marker.id === "string" && marker.id ? marker.id : crypto.randomUUID(),
        time: Math.max(0, marker.time),
        name: typeof marker.name === "string" ? marker.name : "",
        ...typeof marker.color === "string" ? { color: marker.color } : {},
        ...kind ? { kind } : {},
        ...typeof marker.sceneId === "string" && marker.sceneId ? { sceneId: marker.sceneId } : {},
        ...typeof marker.note === "string" && marker.note ? { note: marker.note } : {},
        ...severity ? { severity } : {},
        ...marker.resolved === true ? { resolved: true } : {},
        ...bbox ? { bbox } : {},
        ...typeof marker.screenshot === "string" && marker.screenshot ? { screenshot: marker.screenshot } : {},
        ...tags && tags.length > 0 ? { tags } : {},
        ...isNumber(marker.createdAt) ? { createdAt: marker.createdAt } : {},
        ...isNumber(marker.updatedAt) ? { updatedAt: marker.updatedAt } : {}
      };
    }) : [];
  }
  function normalizeProject(input) {
    const migrated = attachEpisodeView(migrateToEpisodes(input));
    const episodes = migrated.episodes.map((episode) => ({
      ...episode,
      tracks: normalizeTracks(episode.tracks),
      markers: normalizeMarkers(episode.markers)
    }));
    const doc2 = patchProjectMeta(migrated, { episodes });
    const cutScopes2 = normalizeCutScopes(doc2);
    const boards = Array.isArray(doc2.boards) ? doc2.boards.map((canvas) => ({
      ...canvas,
      doc: normalizeBoard(canvas.doc)
    })) : void 0;
    const board = doc2.board === void 0 ? void 0 : normalizeBoard(doc2.board);
    const seriesGraph = normalizeSeriesGraph(
      doc2.seriesGraph
    );
    return patchProjectMeta(doc2, {
      ...seriesGraph ? { seriesGraph } : {},
      cutScopes: cutScopes2,
      ...boards ? { boards } : {},
      ...board ? { board } : {}
    });
  }
  function parseProject(json) {
    let raw;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error(t("error.serialize.badJson"));
    }
    assertProjectShape(raw);
    return normalizeProject(raw);
  }

  // src/core/projectView.ts
  var DEFAULT_PAGE = 40;
  var MAX_PAGE = 100;
  var MAX_ASSET_PAGE = 200;
  var SUMMARY_TEXT = 200;
  var PAGE_TEXT = 1e3;
  function clampPage(value, fallback = DEFAULT_PAGE, max = MAX_PAGE) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(1, Math.floor(value)));
  }
  function clampOffset(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
  }
  function truncate(text, max) {
    if (text === void 0) return void 0;
    return text.length > max ? `${text.slice(0, max)}\u2026` : text;
  }
  function projectDuration(doc2) {
    let end = 0;
    for (const track of doc2.tracks) {
      for (const clip of track.clips) {
        end = Math.max(end, clip.start + clip.duration);
      }
    }
    return end;
  }
  function resolveTrack2(doc2, ref) {
    if (ref === void 0 || ref === null) return null;
    if (typeof ref === "string" && ref.length > 0) {
      const byId = doc2.tracks.find((track) => track.id === ref);
      if (byId) return byId;
      if (/^\d+$/.test(ref)) {
        const index = Number(ref);
        if (index >= 1 && index <= doc2.tracks.length) return doc2.tracks[index - 1];
      }
      return null;
    }
    if (typeof ref === "number" && Number.isInteger(ref) && ref >= 1 && ref <= doc2.tracks.length) {
      return doc2.tracks[ref - 1];
    }
    return null;
  }
  function trackSummary(track, index) {
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const clip of track.clips) {
      start = Math.min(start, clip.start);
      end = Math.max(end, clip.start + clip.duration);
    }
    return {
      id: track.id,
      index,
      name: track.name,
      muted: track.muted,
      visible: track.visible,
      locked: track.locked,
      clipCount: track.clips.length,
      start: Number.isFinite(start) ? start : 0,
      end
    };
  }
  function assetSummary(asset) {
    const { wave, thumb, ...rest } = asset;
    void wave;
    void thumb;
    return rest;
  }
  function clipSummary(doc2, track, trackIndex, clip) {
    const asset = clip.assetId === "" ? null : doc2.assets.find((candidate) => candidate.id === clip.assetId) ?? null;
    return {
      id: clip.id,
      trackId: track.id,
      trackIndex,
      trackName: track.name,
      assetId: clip.assetId,
      assetName: asset?.name ?? null,
      ...clip.sceneId ? { sceneId: clip.sceneId } : {},
      kind: clip.assetId === "" ? "text" : asset?.kind ?? "missing",
      start: clip.start,
      duration: clip.duration,
      in: clip.in,
      ...clip.speed === void 0 || clip.speed === 1 ? {} : { speed: clip.speed },
      ...clip.text === void 0 ? {} : { text: truncate(clip.text, SUMMARY_TEXT) },
      ...clip.muted === void 0 ? {} : { muted: clip.muted },
      ...clip.audioOnly === void 0 ? {} : { audioOnly: clip.audioOnly }
    };
  }
  function clipForPage(clip) {
    if (clip.text === void 0) return clip;
    const text = truncate(clip.text, PAGE_TEXT);
    return text === clip.text ? clip : { ...clip, text };
  }
  function findClip2(doc2, clipId) {
    for (let index = 0; index < doc2.tracks.length; index += 1) {
      const track = doc2.tracks[index];
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return { track, index: index + 1, clip };
    }
    return null;
  }
  function overview(doc2, revision2) {
    const assetsByKind = { video: 0, audio: 0, image: 0 };
    for (const asset of doc2.assets) assetsByKind[asset.kind] += 1;
    return {
      revision: revision2,
      project: {
        name: doc2.name,
        version: doc2.version,
        fps: doc2.fps,
        width: doc2.width,
        height: doc2.height,
        duration: projectDuration(doc2),
        trackCount: doc2.tracks.length,
        assetCount: doc2.assets.length,
        assetsByKind,
        markerCount: doc2.markers.length
      },
      tracks: doc2.tracks.map((track, index) => trackSummary(track, index + 1)),
      hint: "\u8FD9\u662F\u5DE5\u7A0B\u6982\u89C8\uFF0C\u4E0D\u542B\u7247\u6BB5\u4E0E\u7D20\u6750\u660E\u7EC6\u3002\u6309\u5173\u6CE8\u70B9\u7EE7\u7EED\u8BFB\uFF1Aget_context\uFF08\u64AD\u653E\u5934/\u9009\u4E2D\uFF09\u3001get_track\uFF08\u67D0\u8F68\u5206\u9875\uFF09\u3001find_clips\uFF08\u6309\u65F6\u95F4/\u7D20\u6750/\u6587\u5B57\u68C0\u7D22\uFF09\u3001get_clip\uFF08\u5355\u7247\u6BB5\uFF09\u3001get_assets\uFF08\u7D20\u6750\uFF09\u3001get_markers\uFF08\u6807\u8BB0\uFF09\u3002\u6279\u91CF\u5199\u64CD\u4F5C\u7528 apply_commands\u3002"
    };
  }
  function trackPage(doc2, revision2, ref, offsetInput, limitInput) {
    const track = resolveTrack2(doc2, ref);
    if (!track) return null;
    const index = doc2.tracks.indexOf(track) + 1;
    const offset = Math.min(clampOffset(offsetInput), track.clips.length);
    const limit = clampPage(limitInput);
    const page = track.clips.slice(offset, offset + limit).map(clipForPage);
    return {
      revision: revision2,
      track: trackSummary(track, index),
      offset,
      total: track.clips.length,
      hasMore: offset + page.length < track.clips.length,
      nextOffset: offset + page.length,
      clips: page
    };
  }
  function clipDetail(doc2, revision2, clipId) {
    const found = findClip2(doc2, clipId);
    if (!found) return null;
    const { track, index, clip } = found;
    const position = track.clips.findIndex((candidate) => candidate.id === clip.id);
    const previous = position > 0 ? track.clips[position - 1] : null;
    const next = position >= 0 && position < track.clips.length - 1 ? track.clips[position + 1] : null;
    const asset = clip.assetId === "" ? null : doc2.assets.find((candidate) => candidate.id === clip.assetId) ?? null;
    return {
      revision: revision2,
      clip,
      track: trackSummary(track, index),
      asset: asset ? assetSummary(asset) : null,
      neighbors: {
        previous: previous ? clipSummary(doc2, track, index, previous) : null,
        next: next ? clipSummary(doc2, track, index, next) : null
      }
    };
  }
  function findClips(doc2, revision2, query) {
    let scoped = null;
    if (query.trackId !== void 0) {
      const track = resolveTrack2(doc2, query.trackId);
      if (!track) return null;
      scoped = [{ track, index: doc2.tracks.indexOf(track) + 1 }];
    }
    const from = typeof query.from === "number" ? query.from : Number.NEGATIVE_INFINITY;
    const to = typeof query.to === "number" ? query.to : Number.POSITIVE_INFINITY;
    const needle = query.text?.toLowerCase();
    const kind = query.kind?.toLowerCase();
    const matches = [];
    const tracks = scoped ?? doc2.tracks.map((track, index) => ({ track, index: index + 1 }));
    for (const { track, index } of tracks) {
      for (const clip of track.clips) {
        const end = clip.start + clip.duration;
        if (end <= from || clip.start >= to) continue;
        if (query.assetId !== void 0 && clip.assetId !== query.assetId) continue;
        if (needle !== void 0 && !(clip.text ?? "").toLowerCase().includes(needle)) continue;
        if (kind !== void 0) {
          const asset = clip.assetId === "" ? null : doc2.assets.find((candidate) => candidate.id === clip.assetId) ?? null;
          const clipKind = clip.assetId === "" ? "text" : asset?.kind ?? "missing";
          if (clipKind !== kind) continue;
        }
        matches.push({ track, trackIndex: index, clip });
      }
    }
    matches.sort((a, b) => a.clip.start - b.clip.start || a.trackIndex - b.trackIndex);
    const offset = Math.min(clampOffset(query.offset), matches.length);
    const limit = clampPage(query.limit);
    const page = matches.slice(offset, offset + limit);
    return {
      revision: revision2,
      total: matches.length,
      offset,
      limit,
      hasMore: offset + page.length < matches.length,
      nextOffset: offset + page.length,
      clips: page.map(
        ({ track, trackIndex, clip }) => clipSummary(doc2, track, trackIndex, clip)
      )
    };
  }
  function assetsPage(doc2, revision2, query) {
    const needle = query.name?.toLowerCase();
    const kind = query.kind?.toLowerCase();
    const matches = doc2.assets.filter((asset) => {
      if (kind !== void 0 && asset.kind !== kind) return false;
      if (query.offline !== void 0 && Boolean(asset.offline) !== query.offline) return false;
      if (needle !== void 0 && !asset.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    const offset = Math.min(clampOffset(query.offset), matches.length);
    const limit = clampPage(query.limit, 50, MAX_ASSET_PAGE);
    const page = matches.slice(offset, offset + limit);
    return {
      revision: revision2,
      total: matches.length,
      offset,
      limit,
      hasMore: offset + page.length < matches.length,
      nextOffset: offset + page.length,
      assets: page.map(assetSummary)
    };
  }
  function markers(doc2, revision2, query = {}) {
    const from = typeof query.from === "number" ? query.from : Number.NEGATIVE_INFINITY;
    const to = typeof query.to === "number" ? query.to : Number.POSITIVE_INFINITY;
    const list = doc2.markers.filter((marker) => marker.time >= from && marker.time <= to).filter((marker) => query.sceneId === void 0 ? true : marker.sceneId === query.sceneId).filter((marker) => query.kind === void 0 ? true : marker.kind === query.kind).filter(
      (marker) => query.severity === void 0 ? true : marker.severity === query.severity
    ).filter(
      (marker) => query.resolved === void 0 ? true : marker.resolved === true === query.resolved
    ).filter((marker) => query.noteOnly ? Boolean(marker.note) : true).slice().sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
    const offset = Math.min(clampOffset(query.offset), list.length);
    const limit = clampPage(query.limit, 200, 1e3);
    const page = list.slice(offset, offset + limit);
    return {
      revision: revision2,
      total: list.length,
      offset,
      limit,
      hasMore: offset + page.length < list.length,
      nextOffset: offset + page.length,
      markers: page
    };
  }

  // src/core/audioEdit.ts
  var TRUE_PEAK_CEILING_DBTP = -1;
  function loudnessGain(report, targetLufs, ceilingDbtp = TRUE_PEAK_CEILING_DBTP) {
    const lufs = report.integrated_lufs;
    if (lufs === null || !Number.isFinite(lufs)) return null;
    let gain = targetLufs - lufs;
    const peak = report.true_peak_dbtp;
    if (peak !== null && Number.isFinite(peak)) {
      gain = Math.min(gain, ceilingDbtp - peak);
    }
    return Math.max(-60, Math.min(12, gain));
  }
  function replaceClipAudio(doc2, clipId, assetId, assetDuration, clipDuration) {
    const duration = assetDuration > 0 ? Math.min(clipDuration, assetDuration) : clipDuration;
    return updateClip(doc2, clipId, { assetId, in: 0, duration });
  }
  function applyProcessedAudio(doc2, clip, assetId, assetDuration, sourceKind, trackName) {
    if (sourceKind === "audio" || clip.audioOnly) {
      return replaceClipAudio(doc2, clip.id, assetId, assetDuration, clip.duration);
    }
    const sourceIndex = doc2.tracks.findIndex((track2) => track2.id === clip.trackId);
    const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : doc2.tracks.length;
    let next = updateClip(doc2, clip.id, { muted: true });
    next = addTrackAt(next, insertAt, trackName);
    const track = next.tracks[insertAt];
    const duration = Math.min(
      clip.duration,
      assetDuration > 0 ? assetDuration : clip.duration
    );
    if (duration > 0) {
      next = addClip(
        next,
        track.id,
        createClip({
          assetId,
          trackId: track.id,
          start: clip.start,
          duration,
          in: 0
        })
      );
    }
    return next;
  }
  function extractClipAudio(doc2, sourceClip, trackName) {
    if (sourceClip.assetId === "" || !(sourceClip.duration > 0)) {
      return { doc: doc2, clipId: null, trackId: null };
    }
    const sourceIndex = doc2.tracks.findIndex((track2) => track2.id === sourceClip.trackId);
    const insertAt = sourceIndex >= 0 ? sourceIndex + 1 : doc2.tracks.length;
    let next = updateClip(doc2, sourceClip.id, { muted: true });
    next = addTrackAt(next, insertAt, trackName);
    const track = next.tracks[insertAt];
    const audio = createClip({
      assetId: sourceClip.assetId,
      trackId: track.id,
      start: sourceClip.start,
      duration: sourceClip.duration,
      in: sourceClip.in ?? 0
    });
    next = addClip(next, track.id, { ...audio, audioOnly: true });
    return { doc: next, clipId: audio.id, trackId: track.id };
  }
  function addStemTracks(doc2, sourceClip, stems, baseName, muteSource = true) {
    if (stems.length === 0) return doc2;
    const sourceIndex = doc2.tracks.findIndex((track) => track.id === sourceClip.trackId);
    let next = muteSource ? updateClip(doc2, sourceClip.id, { muted: true }) : doc2;
    let insertAt = sourceIndex >= 0 ? sourceIndex + 1 : next.tracks.length;
    for (const stem of stems) {
      next = addTrackAt(next, insertAt, `${baseName} \xB7 ${stem.label}`);
      const track = next.tracks[insertAt];
      const duration = Math.min(sourceClip.duration, stem.duration);
      if (duration > 0) {
        next = addClip(
          next,
          track.id,
          createClip({
            assetId: stem.assetId,
            trackId: track.id,
            start: sourceClip.start,
            duration,
            in: 0
          })
        );
      }
      insertAt += 1;
    }
    return next;
  }

  // src/core/videoEdit.ts
  function replaceClipVideo(doc2, clipId, assetId, assetDuration, clipDuration) {
    const duration = assetDuration > 0 ? Math.min(clipDuration, assetDuration) : clipDuration;
    return updateClip(doc2, clipId, { assetId, in: 0, duration });
  }

  // src/core/voiceover.ts
  function escapeRegExp2(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function trackPattern(baseName) {
    return new RegExp(`^${escapeRegExp2(baseName)}(?:\\s+\\d+)?$`);
  }
  function findFreeLane(lanes, start, end) {
    return lanes.find(
      (lane) => lane.spans.every((span) => end <= span.start || start >= span.end)
    ) ?? null;
  }
  function placeVoiceover(doc2, items, baseName) {
    if (items.length === 0) return doc2;
    const pattern = trackPattern(baseName);
    const lanes = [];
    for (const track of doc2.tracks) {
      if (track.locked || !pattern.test(track.name)) continue;
      lanes.push({
        id: track.id,
        name: track.name,
        spans: track.clips.map((clip) => ({
          start: clip.start,
          end: clip.start + clip.duration
        }))
      });
    }
    let next = doc2;
    const ordered2 = items.filter((item) => item.duration > 0).slice().sort((a, b) => a.start - b.start || a.duration - b.duration);
    for (const item of ordered2) {
      const end = item.start + item.duration;
      let lane = findFreeLane(lanes, item.start, end);
      if (!lane) {
        let name = baseName;
        let index = 2;
        while (next.tracks.some((track2) => track2.name === name)) {
          name = `${baseName} ${index++}`;
        }
        next = addTrack(next, name);
        const track = next.tracks[next.tracks.length - 1];
        lane = { id: track.id, name, spans: [] };
        lanes.push(lane);
      }
      const clip = createClip({
        assetId: item.assetId,
        trackId: lane.id,
        start: item.start,
        duration: item.duration
      });
      next = addClip(next, lane.id, clip);
      lane.spans.push({ start: item.start, end });
    }
    return next;
  }

  // src/core/voiceEdit.ts
  function locate(doc2, clipId) {
    for (const track of doc2.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (clip) return clip;
    }
    return null;
  }
  function placeConvertedVoice(doc2, items, baseName) {
    if (items.length === 0) return doc2;
    const ordered2 = items.map((item) => ({ item, clip: locate(doc2, item.clipId) })).filter((entry) => entry.clip !== null).sort((a, b) => a.clip.start - b.clip.start);
    let next = doc2;
    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped}(?:\\s+\\d+)?$`);
    const lanes = [];
    for (const track of next.tracks) {
      if (track.locked || !pattern.test(track.name)) continue;
      lanes.push({
        id: track.id,
        spans: track.clips.map((clip) => ({
          start: clip.start,
          end: clip.start + clip.duration
        }))
      });
    }
    for (const { item, clip } of ordered2) {
      next = setClipMuted(next, clip.id, true);
      const duration = Math.min(item.duration, clip.duration);
      if (!(duration > 0)) continue;
      const end = clip.start + duration;
      let lane = lanes.find(
        (candidate) => candidate.spans.every((span) => end <= span.start || clip.start >= span.end)
      );
      if (!lane) {
        let name = baseName;
        let index = 2;
        while (next.tracks.some((track2) => track2.name === name)) name = `${baseName} ${index++}`;
        next = addTrack(next, name);
        const track = next.tracks[next.tracks.length - 1];
        lane = { id: track.id, spans: [] };
        lanes.push(lane);
      }
      next = addClip(
        next,
        lane.id,
        createClip({
          assetId: item.assetId,
          trackId: lane.id,
          start: clip.start,
          duration,
          in: 0
        })
      );
      lane.spans.push({ start: clip.start, end });
    }
    return next;
  }

  // src/core/subtitleFile.ts
  function stripTags(text) {
    return text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").trim();
  }
  function parseTimestamp(raw) {
    const match = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!match) return null;
    const hours = match[1] ? Number(match[1]) : 0;
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4].padEnd(3, "0"));
    if (minutes >= 60 || seconds >= 60) return null;
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1e3;
  }
  function timeRange(line) {
    const arrow = line.indexOf("-->");
    if (arrow < 0) return null;
    const left = line.slice(0, arrow).trim();
    const right = line.slice(arrow + 3).trim().split(/\s+/)[0] ?? "";
    const start = parseTimestamp(left);
    const end = parseTimestamp(right);
    if (start === null || end === null || end <= start) return null;
    return { start, end };
  }
  function parseBlocks(text, vtt) {
    const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const blocks = normalized.split(/\n{2,}/);
    const entries = [];
    for (const block of blocks) {
      const lines = block.split("\n").filter((line) => line.trim().length > 0);
      if (lines.length === 0) continue;
      const head = lines[0].trim().toUpperCase();
      if (vtt && (head === "WEBVTT" || head.startsWith("NOTE") || head === "STYLE" || head === "REGION")) {
        continue;
      }
      const rangeIndex = lines.findIndex((line) => line.includes("-->"));
      if (rangeIndex < 0) continue;
      const range = timeRange(lines[rangeIndex]);
      if (!range) continue;
      const body = lines.slice(rangeIndex + 1).join("\n");
      const text2 = stripTags(body);
      if (!text2) continue;
      entries.push({ start: range.start, end: range.end, text: text2 });
    }
    return entries.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function parseSrt(text) {
    return parseBlocks(text, false);
  }
  function parseVtt(text) {
    return parseBlocks(text, true);
  }
  function subtitleFormatFromPath(path) {
    return path.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
  }
  function parseSubtitleText(text, path = "") {
    return subtitleFormatFromPath(path) === "vtt" || /^\uFEFF?WEBVTT\b/i.test(text) ? parseVtt(text) : parseSrt(text);
  }
  function formatTimestamp(seconds, separator) {
    const total = Math.max(0, seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const secs = Math.floor(total % 60);
    const millis = Math.round((total - Math.floor(total)) * 1e3);
    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      `${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`
    ].join(":");
  }
  function ordered(entries) {
    return entries.filter((entry) => entry.text.trim().length > 0).map((entry) => ({
      start: Math.max(0, entry.start),
      end: Math.max(entry.start + 1e-3, entry.end),
      text: entry.text.trim()
    })).sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function serializeSrt(entries) {
    return ordered(entries).map(
      (entry, index) => `${index + 1}
${formatTimestamp(entry.start, ",")} --> ${formatTimestamp(entry.end, ",")}
${entry.text}
`
    ).join("\n");
  }
  function serializeVtt(entries) {
    return `WEBVTT

${ordered(entries).map(
      (entry) => `${formatTimestamp(entry.start, ".")} --> ${formatTimestamp(entry.end, ".")}
${entry.text}
`
    ).join("\n")}`;
  }
  function serializeSubtitles(entries, format) {
    return format === "vtt" ? serializeVtt(entries) : serializeSrt(entries);
  }

  // src/core/playback/activeClips.ts
  function isAudible(track) {
    return !track.muted;
  }
  function isVisible(track) {
    return track.visible !== false;
  }
  function projectDuration2(doc2) {
    let max = 0;
    for (const track of doc2.tracks) {
      for (const clip of track.clips) max = Math.max(max, clip.start + clip.duration);
    }
    return max;
  }

  // src/types/export.ts
  var GIF_DITHERS = [
    "sierra2_4a",
    "bayer",
    "floyd_steinberg",
    "none"
  ];

  // src/core/export/escape.ts
  function formatSeconds(seconds) {
    return String(Number(seconds.toFixed(6)));
  }

  // src/core/export/plan.ts
  function clipSpeed2(clip) {
    return Math.min(4, Math.max(0.1, clip.speed ?? 1));
  }
  function clipWindowOf(clip, speed, window) {
    const clipEnd = clip.start + clip.duration;
    if (!window) {
      return {
        localStart: clip.start,
        localDuration: clip.duration,
        localIn: clip.in,
        sourceDuration: clip.duration * speed,
        offsetIntoClip: 0,
        cutsHead: false,
        cutsTail: false
      };
    }
    const visibleStart = Math.max(clip.start, window.start);
    const visibleEnd = Math.min(clipEnd, window.end);
    if (!(visibleEnd > visibleStart + 1e-9)) return null;
    const offsetIntoClip = Math.max(0, visibleStart - clip.start);
    return {
      localStart: visibleStart - window.start,
      localDuration: visibleEnd - visibleStart,
      localIn: clip.in + offsetIntoClip * speed,
      sourceDuration: (visibleEnd - visibleStart) * speed,
      offsetIntoClip,
      cutsHead: offsetIntoClip > 1e-9,
      cutsTail: visibleEnd < clipEnd - 1e-9
    };
  }
  function windowedFadeFilters(clip, localDuration, cutsHead, cutsTail, warnings) {
    const filters = [];
    const number2 = (value) => String(Number(value.toFixed(6)));
    if (clip.transitionIn?.type === "fade") {
      if (cutsHead) {
        warnings.push(`\u7247\u6BB5 ${clip.id} \u7684\u5165\u573A\u6DE1\u5165\u88AB\u533A\u95F4\u622A\u65AD\uFF0C\u5DF2\u8DF3\u8FC7`);
      } else {
        filters.push(
          `fade=t=in:st=0:d=${number2(Math.min(clip.transitionIn.duration, localDuration))}:alpha=1`
        );
      }
    }
    if (clip.transitionOut?.type === "fade") {
      if (cutsTail) {
        warnings.push(`\u7247\u6BB5 ${clip.id} \u7684\u51FA\u573A\u6DE1\u51FA\u88AB\u533A\u95F4\u622A\u65AD\uFF0C\u5DF2\u8DF3\u8FC7`);
      } else {
        filters.push(
          `fade=t=out:st=${number2(Math.max(0, localDuration - clip.transitionOut.duration))}:d=${number2(Math.min(clip.transitionOut.duration, localDuration))}:alpha=1`
        );
      }
    }
    return filters;
  }
  function atempoFilters(speed) {
    if (Math.abs(speed - 1) < 1e-6) return [];
    const out = [];
    let value = speed;
    while (value > 2) {
      out.push("atempo=2");
      value /= 2;
    }
    while (value < 0.5) {
      out.push("atempo=0.5");
      value /= 0.5;
    }
    if (Math.abs(value - 1) >= 1e-6) out.push(`atempo=${value.toFixed(6)}`);
    return out;
  }
  function resolveDimensions(project, options) {
    const aspect = project.width / project.height;
    let width;
    let height;
    if (options.resolution === "custom") {
      const customWidth = options.width && options.width > 0 ? options.width : null;
      const customHeight = options.height && options.height > 0 ? options.height : null;
      if (customWidth !== null && customHeight !== null) {
        width = customWidth;
        height = customHeight;
      } else if (customWidth !== null) {
        width = customWidth;
        height = Math.round(customWidth / aspect);
      } else if (customHeight !== null) {
        height = customHeight;
        width = Math.round(customHeight * aspect);
      } else {
        width = project.width;
        height = project.height;
      }
    } else {
      height = options.resolution === "720p" ? 720 : options.resolution === "1080p" ? 1080 : project.height;
      width = options.resolution === "project" ? project.width : Math.round(height * aspect);
    }
    const fps = options.format === "gif" ? Math.min(120, Math.max(1, Math.round(options.fps ?? 15))) : normalizeFps(options.fps ?? project.fps);
    return { width: evenDimension(width), height: evenDimension(height), fps };
  }
  var ANCHOR_OFFSETS = {
    "top-left": [0, 0],
    top: [0.5, 0],
    "top-right": [1, 0],
    left: [0, 0.5],
    center: [0.5, 0.5],
    right: [1, 0.5],
    "bottom-left": [0, 1],
    bottom: [0.5, 1],
    "bottom-right": [1, 1]
  };
  function fitFilters(width, height, fit, anchor) {
    if (fit === "cover") {
      const [x, y] = ANCHOR_OFFSETS[anchor] ?? ANCHOR_OFFSETS.center;
      const crop = x === 0.5 && y === 0.5 ? `crop=${width}:${height}` : `crop=${width}:${height}:(iw-ow)*${x}:(ih-oh)*${y}`;
      return [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`,
        crop
      ];
    }
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
    ];
  }
  function hasAudio(asset) {
    return asset.kind === "audio" || asset.kind === "video" && asset.hasAudio === true;
  }
  function crfOf(quality) {
    return quality === "high" ? "18" : quality === "small" ? "28" : "23";
  }
  function transformFilters(clip, transform, streamOffset = 0) {
    const filters = [];
    const scaleExpr = keyframeExpression(clip.keyframes, "scale", "t", streamOffset);
    if (scaleExpr) {
      filters.push(
        `scale=w='iw*(${scaleExpr})':h='ih*(${scaleExpr})':eval=frame`
      );
    } else if (transform.scale !== 1) {
      filters.push(`scale=iw*${transform.scale}:ih*${transform.scale}`);
    }
    const rotationExpr = keyframeExpression(clip.keyframes, "rotation", "t", streamOffset);
    if (rotationExpr) {
      filters.push(
        `rotate=angle='(${rotationExpr})*PI/180':ow=iw:oh=ih:c=none`
      );
    } else if (transform.rotation !== 0) {
      const angle = `${transform.rotation}*PI/180`;
      filters.push(
        `rotate=${angle}:ow=rotw(${angle}):oh=roth(${angle}):c=none`
      );
    }
    return filters;
  }
  function opacityFilters(clip, opacity, streamOffset = 0) {
    const expression = keyframeExpression(clip.keyframes, "opacity", "T", streamOffset);
    if (!expression) {
      return Math.abs(opacity - 1) < 1e-6 ? [] : [`colorchannelmixer=aa=${opacity}`];
    }
    return [
      "format=rgba",
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${expression})'`,
      "format=yuva420p"
    ];
  }
  function slideExpr(clip, edge, timeShift = 0) {
    const transition = edge === "in" ? clip.transitionIn : clip.transitionOut;
    if (transition?.type !== "slide") return { x: "0", y: "0" };
    const duration = formatSeconds(transition.duration);
    const start = formatSeconds(clip.start - timeShift);
    const end = formatSeconds(clip.start + clip.duration - timeShift);
    const direction = transition.direction ?? "left";
    const sign = direction === "right" || direction === "down" ? 1 : -1;
    const expr = edge === "in" ? `if(between(t,${start},${start}+${duration}),${sign * 100}*(1-(t-${start})/${duration}),0)` : `if(between(t,${end}-${duration},${end}),${sign * 100}*(1-(${end}-t)/${duration}),0)`;
    return direction === "up" || direction === "down" ? { x: "0", y: expr } : { x: expr, y: "0" };
  }
  function overlayPosition(clip, transform, localStart = clip.start, timeShift = 0) {
    const enter = slideExpr(clip, "in", timeShift);
    const exit = slideExpr(clip, "out", timeShift);
    const xKey = keyframeExpression(clip.keyframes, "x", "t", localStart);
    const yKey = keyframeExpression(clip.keyframes, "y", "t", localStart);
    const hasMotion = xKey !== null || yKey !== null;
    const hasSlide = enter.x !== "0" || enter.y !== "0" || exit.x !== "0" || exit.y !== "0";
    if (!hasMotion && !hasSlide && isDefaultTransform(transform)) return "";
    const x = `${xKey ?? transform.x}+${enter.x}+${exit.x}`;
    const y = `${yKey ?? transform.y}+${enter.y}+${exit.y}`;
    return `:x='(main_w-overlay_w)/2+(${x})*main_w/100':y='(main_h-overlay_h)/2+(${y})*main_h/100'`;
  }
  function buildExportPlan(project, options, textImages, outputPath, effectVideos = /* @__PURE__ */ new Map(), window, transitionVideos = /* @__PURE__ */ new Map()) {
    const fullDuration = projectDuration2(project);
    if (!(fullDuration > 0)) throw new Error(t("export.emptyTimeline"));
    let windowStart = 0;
    let duration = fullDuration;
    if (window) {
      windowStart = Math.max(0, window.start);
      const windowEnd = Math.min(window.end, fullDuration);
      duration = windowEnd - windowStart;
      if (!(duration > 0)) throw new Error(t("export.emptyTimeline"));
    }
    const { width, height, fps } = resolveDimensions(project, options);
    const warnings = [];
    const warned = /* @__PURE__ */ new Set();
    const warnOnce = (key, message) => {
      if (warned.has(key)) return;
      warned.add(key);
      warnings.push(message);
    };
    const filters = [
      `color=c=black:s=${width}x${height}:r=${fps}:d=${formatSeconds(duration)}[b0]`
    ];
    const inputs = [];
    let inputCount = 0;
    function pushInput(args) {
      const index = inputCount;
      inputs.push(...args);
      inputCount += 1;
      return index;
    }
    function assetOf(clip) {
      return project.assets.find((a) => a.id === clip.assetId);
    }
    function assertOnline(asset) {
      if (asset.offline) throw new Error(t("export.offlineAsset", { name: asset.name }));
    }
    const clipWindows = /* @__PURE__ */ new Map();
    function windowOf(clip) {
      if (clipWindows.has(clip.id)) return clipWindows.get(clip.id) ?? null;
      const value = clipWindowOf(clip, clipSpeed2(clip), window);
      clipWindows.set(clip.id, value);
      return value;
    }
    const visualTracks = project.tracks.filter((track) => isVisible(track));
    const preparedVideo = [];
    const visualLayers = [];
    const bakedClipIds = /* @__PURE__ */ new Set();
    for (const track of [...visualTracks].reverse()) {
      const trackIndex = project.tracks.indexOf(track);
      for (const clip of track.clips) {
        if (!(clip.duration > 0)) continue;
        if (clip.audioOnly) continue;
        if (!clip.assetId) continue;
        const asset = assetOf(clip);
        if (!asset) {
          warnings.push(t("export.warnMissingAsset"));
          continue;
        }
        if (asset.kind !== "video" && asset.kind !== "image") continue;
        assertOnline(asset);
        const win = windowOf(clip);
        if (!win) continue;
        const baked = effectVideos.get(clip.id);
        const args = baked ? [
          "-ss",
          formatSeconds(win.offsetIntoClip),
          "-t",
          formatSeconds(win.localDuration),
          "-i",
          baked
        ] : asset.kind === "image" ? ["-loop", "1", "-t", formatSeconds(win.localDuration), "-i", asset.src] : [
          "-ss",
          formatSeconds(win.localIn),
          "-t",
          formatSeconds(win.sourceDuration),
          "-i",
          asset.src
        ];
        const inputIndex = pushInput(args);
        if (baked) bakedClipIds.add(clip.id);
        preparedVideo.push({ clip, asset, inputIndex });
        visualLayers.push({
          clip,
          inputIndex,
          kind: "video",
          trackIndex,
          window: win
        });
      }
    }
    for (const track of [...visualTracks].reverse()) {
      const trackIndex = project.tracks.indexOf(track);
      for (const clip of track.clips) {
        const text = (clip.text ?? "").trim();
        if (text === "" || !(clip.duration > 0)) continue;
        const image = textImages.get(clip.id);
        if (!image) {
          warnings.push(t("export.warnMissingTextImage", { text }));
          continue;
        }
        const win = windowOf(clip);
        if (!win) continue;
        const inputIndex = pushInput([
          "-loop",
          "1",
          "-t",
          formatSeconds(win.localDuration),
          "-i",
          image
        ]);
        visualLayers.push({ clip, inputIndex, kind: "text", trackIndex, window: win });
      }
    }
    visualLayers.sort(
      (a, b) => b.trackIndex - a.trackIndex || a.clip.start - b.clip.start
    );
    const transitionLayers = [];
    for (const [key, video] of transitionVideos) {
      const separator = key.lastIndexOf(":");
      const clipId = separator >= 0 ? key.slice(0, separator) : key;
      const trackIndex = project.tracks.findIndex(
        (track) => track.clips.some((clip) => clip.id === clipId)
      );
      transitionLayers.push({
        path: video.path,
        start: video.start,
        duration: video.duration,
        trackIndex
      });
    }
    transitionLayers.sort((a, b) => b.trackIndex - a.trackIndex);
    let transitionCount = 0;
    let transitionCursor = 0;
    const emitTransition = (video) => {
      const visibleStart = Math.max(video.start, windowStart);
      const visibleEnd = Math.min(
        video.start + video.duration,
        windowStart + duration
      );
      if (!(visibleEnd > visibleStart + 1e-6)) return;
      const offset = visibleStart - video.start;
      const inputIndex = pushInput([
        "-ss",
        formatSeconds(offset),
        "-t",
        formatSeconds(visibleEnd - visibleStart),
        "-i",
        video.path
      ]);
      const start = formatSeconds(visibleStart - windowStart);
      const end = formatSeconds(visibleEnd - windowStart);
      filters.push(
        `[${inputIndex}:v]format=yuva420p,setsar=1,fps=${fps},setpts=PTS-STARTPTS+${start}/TB[tr${transitionCount}]`
      );
      filters.push(
        `${videoLabel}[tr${transitionCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'[vtr${transitionCount}]`
      );
      videoLabel = `[vtr${transitionCount}]`;
      transitionCount += 1;
    };
    const emitTransitionsAbove = (trackIndex) => {
      while (transitionCursor < transitionLayers.length && transitionLayers[transitionCursor].trackIndex > trackIndex) {
        emitTransition(transitionLayers[transitionCursor]);
        transitionCursor += 1;
      }
    };
    let videoLabel = "[b0]";
    let videoCount = 0;
    let textCount = 0;
    for (const layer of visualLayers) {
      emitTransitionsAbove(layer.trackIndex);
      const { clip, inputIndex, window: win } = layer;
      const start = formatSeconds(win.localStart);
      const end = formatSeconds(win.localStart + win.localDuration);
      const streamOffset = -win.offsetIntoClip;
      const transform = resolveTransform(clip);
      const opacity = Math.min(1, Math.max(0, clip.opacity ?? 1));
      const fades = windowedFadeFilters(
        clip,
        win.localDuration,
        win.cutsHead,
        win.cutsTail,
        warnings
      );
      if (layer.kind === "video") {
        const speed = clipSpeed2(clip);
        const baked = bakedClipIds.has(clip.id);
        const tail2 = [
          ...transformFilters(clip, transform, streamOffset),
          ...clipColorFilters(clip),
          ...opacityFilters(clip, opacity, streamOffset),
          ...fades,
          `setpts=PTS-STARTPTS+${start}/TB[v${videoCount}]`
        ];
        const [scaleFilter, ...fitTail] = fitFilters(
          width,
          height,
          options.fit,
          options.fitAnchor
        );
        const base = baked ? [`[${inputIndex}:v]format=yuva420p`, `fps=${fps}`] : [
          `[${inputIndex}:v]${scaleFilter}`,
          ...fitTail,
          "setsar=1",
          ...speed === 1 ? [] : [`setpts=(PTS-STARTPTS)/${speed}`],
          `fps=${fps}`
        ];
        filters.push(
          [base[0], "format=yuva420p", ...base.slice(1), ...tail2].join(",")
        );
        filters.push(
          `${videoLabel}[v${videoCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'${overlayPosition(clip, transform, win.localStart - win.offsetIntoClip, windowStart)}[vout${videoCount}]`
        );
        videoLabel = `[vout${videoCount}]`;
        videoCount += 1;
        continue;
      }
      filters.push(
        [
          `[${inputIndex}:v]format=yuva420p`,
          `fps=${fps}`,
          ...transformFilters(clip, transform, streamOffset),
          ...clipColorFilters(clip),
          ...opacityFilters(clip, opacity, streamOffset),
          ...fades,
          `setpts=PTS-STARTPTS+${start}/TB[t${textCount}]`
        ].join(",")
      );
      filters.push(
        `${videoLabel}[t${textCount}]overlay=eof_action=pass:enable='between(t,${start},${end})'${overlayPosition(clip, transform, win.localStart - win.offsetIntoClip, windowStart)}[vtext${textCount}]`
      );
      videoLabel = `[vtext${textCount}]`;
      textCount += 1;
    }
    emitTransitionsAbove(-2);
    const wantsAudio = options.audio !== false && options.format !== "gif";
    const preparedAudio = [];
    const videoInputByClip = new Map(preparedVideo.map((p) => [p.clip.id, p.inputIndex]));
    if (wantsAudio) {
      for (const track of project.tracks) {
        if (!isAudible(track)) continue;
        for (const clip of track.clips) {
          if (!(clip.duration > 0)) continue;
          if (clip.muted) continue;
          const asset = assetOf(clip);
          if (!asset || !hasAudio(asset)) continue;
          assertOnline(asset);
          const win = windowOf(clip);
          if (!win) continue;
          const reused = bakedClipIds.has(clip.id) ? void 0 : videoInputByClip.get(clip.id);
          const inputIndex = reused !== void 0 ? reused : pushInput([
            "-ss",
            formatSeconds(win.localIn),
            "-t",
            formatSeconds(win.sourceDuration),
            "-i",
            asset.src
          ]);
          preparedAudio.push({ clip, inputIndex, window: win });
        }
      }
    }
    preparedAudio.forEach(({ clip, inputIndex, window: win }, index) => {
      const gain = clip.gain ?? 0;
      const delayMs = Math.max(0, Math.round(win.localStart * 1e3));
      let fadeIn = Math.min(Math.max(clip.fadeIn ?? 0, 0), win.localDuration);
      if (win.cutsHead && fadeIn > 0) {
        warnOnce(`audio-fade-in:${clip.id}`, `\u7247\u6BB5 ${clip.id} \u7684\u97F3\u9891\u6DE1\u5165\u88AB\u533A\u95F4\u622A\u65AD\uFF0C\u5DF2\u8DF3\u8FC7`);
        fadeIn = 0;
      }
      let fadeOut = Math.min(
        Math.max(clip.fadeOut ?? 0, 0),
        Math.max(0, win.localDuration - fadeIn)
      );
      if (win.cutsTail && fadeOut > 0) {
        warnOnce(`audio-fade-out:${clip.id}`, `\u7247\u6BB5 ${clip.id} \u7684\u97F3\u9891\u6DE1\u51FA\u88AB\u533A\u95F4\u622A\u65AD\uFF0C\u5DF2\u8DF3\u8FC7`);
        fadeOut = 0;
      }
      const pitch = Math.min(12, Math.max(-12, clip.pitch ?? 0));
      const pan = Math.min(1, Math.max(-1, clip.pan ?? 0));
      const speed = clipSpeed2(clip);
      const sourceDuration = win.sourceDuration;
      const chain = [
        `[${inputIndex}:a]atrim=duration=${formatSeconds(sourceDuration)}`,
        "asetpts=PTS-STARTPTS",
        "aresample=48000",
        "aformat=sample_fmts=fltp:channel_layouts=stereo"
      ];
      if (pitch !== 0) {
        const ratio = 2 ** (pitch / 12);
        chain.push(
          `asetrate=${Math.round(48e3 * ratio)}`,
          "aresample=48000",
          `atempo=${(1 / ratio).toFixed(6)}`
        );
      }
      chain.push(...atempoFilters(speed));
      if (gain !== 0) chain.push(`volume=${gain}dB`);
      if (pan !== 0) {
        const left = pan > 0 ? 1 - pan : 1;
        const right = pan < 0 ? 1 + pan : 1;
        chain.push(`pan=stereo|c0=c0*${left.toFixed(3)}|c1=c1*${right.toFixed(3)}`);
      }
      if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${formatSeconds(fadeIn)}`);
      if (fadeOut > 0) {
        chain.push(
          `afade=t=out:st=${formatSeconds(Math.max(0, win.localDuration - fadeOut))}:d=${formatSeconds(fadeOut)}`
        );
      }
      chain.push(`adelay=${delayMs}:all=1[a${index}]`);
      filters.push(chain.join(","));
    });
    if (window && visualLayers.length === 0 && preparedAudio.length === 0) {
      throw new Error(t("export.emptyTimeline"));
    }
    let audioLabel = "";
    if (wantsAudio) {
      if (preparedAudio.length === 0) {
        filters.push(`anullsrc=r=48000:cl=stereo:d=${formatSeconds(duration)}[aout]`);
        audioLabel = "[aout]";
      } else if (preparedAudio.length === 1) {
        filters.push(`[a0]anull[aout]`);
        audioLabel = "[aout]";
      } else {
        const labels = preparedAudio.map((_, i) => `[a${i}]`).join("");
        filters.push(
          `${labels}amix=inputs=${preparedAudio.length}:duration=longest:dropout_transition=0:normalize=0[aout]`
        );
        audioLabel = "[aout]";
      }
    }
    let finalVideoLabel = videoLabel;
    let gifLoop = 0;
    if (options.format === "gif") {
      const colors = Math.min(256, Math.max(2, Math.round(options.gifColors ?? 256)));
      const dither = GIF_DITHERS.includes(options.gifDither) ? options.gifDither : "sierra2_4a";
      gifLoop = Number.isFinite(options.gifLoop) ? Math.max(-1, Math.round(options.gifLoop)) : 0;
      filters.push(
        `${videoLabel}split[g0][g1]`,
        `[g0]palettegen=max_colors=${colors}:stats_mode=diff[pal]`,
        `[g1][pal]paletteuse=dither=${dither}[gifout]`
      );
      finalVideoLabel = "[gifout]";
    }
    const tail = ["-t", formatSeconds(duration), outputPath];
    const audioMap = wantsAudio && audioLabel ? ["-map", audioLabel] : [];
    const outputArgs = options.format === "mp4" ? [
      "-map",
      finalVideoLabel,
      ...audioMap,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      crfOf(options.quality),
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      ...wantsAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"],
      "-movflags",
      "+faststart",
      ...tail
    ] : options.format === "prores" ? [
      "-map",
      finalVideoLabel,
      ...audioMap,
      "-c:v",
      "prores_ks",
      "-profile:v",
      "2",
      "-pix_fmt",
      "yuv422p10le",
      "-r",
      String(fps),
      ...wantsAudio ? ["-c:a", "pcm_s16le", "-ar", "48000"] : ["-an"],
      ...tail
    ] : ["-map", finalVideoLabel, "-loop", String(gifLoop), "-an", ...tail];
    return {
      format: options.format,
      width,
      height,
      fps,
      duration,
      inputs,
      filterGraph: filters.join(";"),
      outputArgs,
      warnings
    };
  }

  // src/core/export/contactLayout.ts
  function buildContactLayout(count, cols, cellWidth, cellHeight) {
    const safeCols = Math.min(Math.max(1, Math.floor(cols || 1)), Math.max(1, count));
    const rows = Math.ceil(count / safeCols);
    const parts = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < safeCols; col += 1) {
        parts.push(`${col * cellWidth}_${row * cellHeight}`);
      }
    }
    return { cols: safeCols, rows, layout: parts.join("|") };
  }

  // src/core/export/ssim.ts
  var FRAME_RE = /n:\s*(\d+)/;
  var ALL_RE = /\bAll:\s*([0-9.]+)/;
  var Y_RE = /\bY:\s*([0-9.]+)/;
  function parseSsimStats(text, fps, start = 0) {
    const frames = [];
    for (const line of text.split(/\r?\n/)) {
      const frameMatch = FRAME_RE.exec(line);
      if (!frameMatch) continue;
      const scoreMatch = ALL_RE.exec(line) ?? Y_RE.exec(line);
      if (!scoreMatch) continue;
      const score = Number(scoreMatch[1]);
      if (!Number.isFinite(score)) continue;
      const frame = Number(frameMatch[1]);
      frames.push({
        frame,
        time: start + (Math.max(1, frame) - 1) / (fps > 0 ? fps : 30),
        score
      });
    }
    if (frames.length === 0) {
      return { frames, mean: 1, min: 1, samples: 0 };
    }
    const scores = frames.map((frame) => frame.score);
    return {
      frames,
      mean: scores.reduce((sum, value) => sum + value, 0) / scores.length,
      min: Math.min(...scores),
      samples: frames.length
    };
  }
  function changedSamples(summary, threshold) {
    const changed = summary.frames.filter((frame) => frame.score < threshold).map((frame) => ({ time: frame.time, score: frame.score }));
    const merged = [];
    for (const sample of changed) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(sample.time - last.time) < 1e-3) continue;
      merged.push(sample);
    }
    return merged;
  }

  // src/core/film/manifest.ts
  var FILM_MANIFEST_VERSION = 1;
  var REVIEW_SEVERITIES2 = ["blocker", "high", "medium", "low"];
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isNumber2(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function isAbsolutePath(value) {
    return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  }
  function normalizePath(value) {
    const absolute = isAbsolutePath(value);
    const drive = /^([A-Za-z]:)[\\/]/.exec(value)?.[1] ?? "";
    const unified = value.replace(/\\/g, "/");
    const parts = unified.split("/");
    const stack = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (stack.length > 0 && stack[stack.length - 1] !== "..") stack.pop();
        else if (!absolute) stack.push("..");
        continue;
      }
      stack.push(part);
    }
    if (drive) return `${drive}/${stack.slice(1).join("/")}`;
    if (value.startsWith("//")) return `//${stack.join("/")}`;
    return absolute ? `/${stack.join("/")}` : stack.join("/");
  }
  function resolveManifestPath(baseDir, value) {
    if (isAbsolutePath(value)) return normalizePath(value);
    return normalizePath(`${baseDir}/${value}`);
  }
  function relativeToManifest(baseDir, absolute) {
    const base = normalizePath(baseDir);
    const target = normalizePath(absolute);
    if (base === "" || base === ".") return target;
    const baseParts = base.split("/").filter(Boolean);
    const targetParts = target.split("/").filter(Boolean);
    const sameDrive = baseParts.length === 0 || targetParts.length === 0 || baseParts[0].endsWith(":") === targetParts[0].endsWith(":") && (!baseParts[0].endsWith(":") || baseParts[0] === targetParts[0]);
    if (!sameDrive) return target;
    let common = 0;
    while (common < baseParts.length && common < targetParts.length && baseParts[common] === targetParts[common]) {
      common += 1;
    }
    const up = baseParts.length - common;
    const rest = targetParts.slice(common);
    if (up === 0 && rest.length === 0) return ".";
    return [...Array.from({ length: up }, () => ".."), ...rest].join("/");
  }
  function parseNote(value, label, warnings, baseDir) {
    if (!isRecord(value)) {
      warnings.push(`${label} \u4E0D\u662F\u5BF9\u8C61\uFF0C\u5DF2\u5FFD\u7565`);
      return null;
    }
    if (!isNumber2(value.t) || value.t < 0) {
      warnings.push(`${label}.t \u5FC5\u987B\u662F\u975E\u8D1F\u6570\u5B57\uFF0C\u5DF2\u5FFD\u7565`);
      return null;
    }
    if (typeof value.text !== "string" || value.text.trim() === "") {
      warnings.push(`${label}.text \u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u5DF2\u5FFD\u7565`);
      return null;
    }
    const severity = REVIEW_SEVERITIES2.includes(value.severity) ? value.severity : void 0;
    if (value.severity !== void 0 && !severity) {
      warnings.push(`${label}.severity \u975E\u6CD5\uFF0C\u5DF2\u4E22\u5F03`);
    }
    let bbox;
    if (isRecord(value.bbox)) {
      const x = value.bbox.x;
      const y = value.bbox.y;
      const width = value.bbox.width;
      const height = value.bbox.height;
      if (isNumber2(x) && isNumber2(y) && isNumber2(width) && isNumber2(height)) {
        bbox = { x, y, width, height };
      } else {
        warnings.push(`${label}.bbox \u5B57\u6BB5\u4E0D\u5B8C\u6574\uFF0C\u5DF2\u4E22\u5F03`);
      }
    }
    const tags = Array.isArray(value.tags) ? value.tags.filter((tag) => typeof tag === "string") : void 0;
    return {
      ...typeof value.id === "string" && value.id ? { id: value.id } : {},
      t: value.t,
      text: value.text,
      ...severity ? { severity } : {},
      ...typeof value.resolved === "boolean" ? { resolved: value.resolved } : {},
      ...bbox ? { bbox } : {},
      ...typeof value.screenshot === "string" && value.screenshot ? { screenshot: resolveManifestPath(baseDir, value.screenshot) } : {},
      ...tags && tags.length > 0 ? { tags } : {}
    };
  }
  function parseFilmManifest(raw, manifestPath) {
    if (!isRecord(raw)) throw new Error("film.json \u5FC5\u987B\u662F JSON \u5BF9\u8C61");
    if (raw.version !== FILM_MANIFEST_VERSION) {
      throw new Error(
        `\u4E0D\u652F\u6301\u7684 film.json \u7248\u672C\uFF1A${String(raw.version)}\uFF08\u9700\u8981 ${FILM_MANIFEST_VERSION}\uFF09`
      );
    }
    if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
      throw new Error("film.json \u7684 scenes \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4");
    }
    const normalizedManifestPath = normalizePath(manifestPath);
    const slash = normalizedManifestPath.lastIndexOf("/");
    const baseDir = slash > 0 ? normalizedManifestPath.slice(0, slash) : slash === 0 ? "/" : ".";
    const warnings = [];
    const seen = /* @__PURE__ */ new Set();
    const takePaths = /* @__PURE__ */ new Map();
    const scenes = [];
    raw.scenes.forEach((item, index) => {
      const label = `scenes[${index}]`;
      if (!isRecord(item)) {
        warnings.push(`${label} \u4E0D\u662F\u5BF9\u8C61\uFF0C\u5DF2\u5FFD\u7565`);
        return;
      }
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) {
        warnings.push(`${label}.id \u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u5DF2\u5FFD\u7565`);
        return;
      }
      if (seen.has(id)) {
        warnings.push(`${label}.id \u91CD\u590D\uFF08${id}\uFF09\uFF0C\u5DF2\u5FFD\u7565`);
        return;
      }
      const t0 = isNumber2(item.t0) ? item.t0 : Number.NaN;
      const t1 = isNumber2(item.t1) ? item.t1 : Number.NaN;
      if (!(t0 >= 0) || !(t1 > t0)) {
        warnings.push(`${label} \u7684 t0/t1 \u975E\u6CD5\uFF08\u9700\u8981 0 <= t0 < t1\uFF09\uFF0C\u5DF2\u5FFD\u7565`);
        return;
      }
      seen.add(id);
      const review = [];
      if (Array.isArray(item.review)) {
        item.review.forEach((note, noteIndex) => {
          const parsed = parseNote(note, `${label}.review[${noteIndex}]`, warnings, baseDir);
          if (!parsed) return;
          if (parsed.t < t0 || parsed.t > t1) {
            warnings.push(`${label}.review[${noteIndex}] \u7684\u65F6\u95F4 ${parsed.t} \u4E0D\u5728\u573A\u666F [${t0},${t1}] \u5185`);
          }
          review.push(parsed);
        });
      }
      const markers2 = Array.isArray(item.markers) ? item.markers.filter((time) => isNumber2(time) && time >= 0) : [];
      if (Array.isArray(item.markers) && markers2.length !== item.markers.length) {
        warnings.push(`${label}.markers \u542B\u975E\u6CD5\u65F6\u95F4\uFF0C\u5DF2\u4E22\u5F03`);
      }
      const take = typeof item.take === "string" && item.take.trim() ? item.take.trim() : void 0;
      if (take) takePaths.set(id, resolveManifestPath(baseDir, take));
      scenes.push({
        id,
        t0,
        t1,
        ...typeof item.title === "string" && item.title ? { title: item.title } : {},
        ...take ? { take } : {},
        ...markers2.length > 0 ? { markers: markers2 } : {},
        ...review.length > 0 ? { review } : {}
      });
    });
    if (scenes.length === 0) throw new Error("film.json \u6CA1\u6709\u53EF\u7528\u7684 scenes");
    scenes.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1 || a.id.localeCompare(b.id));
    for (let index = 1; index < scenes.length; index += 1) {
      const prev = scenes[index - 1];
      const current2 = scenes[index];
      if (current2.t0 < prev.t1 - 1e-6) {
        warnings.push(
          `\u573A\u666F ${prev.id} \u4E0E ${current2.id} \u91CD\u53E0\uFF08${current2.t0} < ${prev.t1}\uFF09\uFF1B\u6309\u8F6C\u573A\u5904\u7406`
        );
      }
    }
    const duration = isNumber2(raw.duration) && raw.duration > 0 ? raw.duration : void 0;
    if (duration !== void 0) {
      for (const scene of scenes) {
        if (scene.t1 > duration + 1e-6) {
          warnings.push(`\u573A\u666F ${scene.id} \u7684\u7ED3\u675F\u65F6\u95F4 ${scene.t1} \u8D85\u8FC7 duration ${duration}`);
        }
      }
    }
    const topReview = [];
    if (Array.isArray(raw.review)) {
      raw.review.forEach((note, index) => {
        const parsed = parseNote(note, `review[${index}]`, warnings, baseDir);
        if (parsed) topReview.push(parsed);
      });
    }
    const music = isRecord(raw.music) ? raw.music : void 0;
    return {
      manifest: {
        version: FILM_MANIFEST_VERSION,
        ...typeof raw.name === "string" && raw.name ? { name: raw.name } : {},
        ...isNumber2(raw.fps) && raw.fps > 0 ? { fps: raw.fps } : {},
        ...isNumber2(raw.width) && raw.width > 0 ? { width: raw.width } : {},
        ...isNumber2(raw.height) && raw.height > 0 ? { height: raw.height } : {},
        ...duration !== void 0 ? { duration } : {},
        scenes,
        ...topReview.length > 0 ? { review: topReview } : {},
        ...music ? { music } : {}
      },
      baseDir,
      takePaths,
      raw,
      warnings
    };
  }

  // src/core/film/import.ts
  var FILM_TAG = "film-manifest";
  function snap(seconds, fps) {
    if (!(fps > 0)) return Math.round(seconds * 1e3) / 1e3;
    return Math.round(seconds * fps) / fps;
  }
  function markerTitle(note) {
    const prefix = note.severity ? `[${note.severity}] ` : "";
    const text = note.text.replace(/\s+/g, " ").trim();
    return `${prefix}${text.length > 40 ? `${text.slice(0, 40)}\u2026` : text}`;
  }
  function markerKey(kind, sceneId, time, identity) {
    return [kind, sceneId ?? "", time.toFixed(3), identity ?? ""].join("|");
  }
  function noteIdentity(note) {
    return note.text.trim();
  }
  function fromNote(note, sceneId, fps) {
    const time = snap(note.t, fps);
    return {
      key: markerKey("review", sceneId, time, noteIdentity(note)),
      time,
      marker: {
        time,
        name: markerTitle(note),
        kind: "review",
        ...sceneId ? { sceneId } : {},
        note: note.text,
        ...note.severity ? { severity: note.severity } : {},
        ...note.resolved === true ? { resolved: true } : {},
        ...note.bbox ? { bbox: note.bbox } : {},
        ...note.screenshot ? { screenshot: note.screenshot } : {},
        ...note.tags ? { tags: [...note.tags, FILM_TAG] } : { tags: [FILM_TAG] }
      }
    };
  }
  function sameNoteMarker(existing, desired) {
    return existing.time === desired.time && existing.name === desired.name && existing.kind === desired.kind && existing.sceneId === desired.sceneId && existing.note === desired.note && existing.severity === desired.severity && existing.resolved === desired.resolved && existing.screenshot === desired.screenshot && JSON.stringify(existing.bbox ?? null) === JSON.stringify(desired.bbox ?? null) && JSON.stringify(existing.tags ?? []) === JSON.stringify(desired.tags ?? []);
  }
  function sameClip(existing, desired) {
    return existing.start === desired.start && existing.duration === desired.duration && existing.in === desired.in && existing.assetId === desired.assetId && existing.sceneId === desired.sceneId;
  }
  function assetFor(path, assets) {
    return assets.get(normalizePath(path));
  }
  function buildManifestCommands(project, parsed, options) {
    const now = options.now ?? Date.now();
    const drafts = [];
    const warnings = [...parsed.warnings];
    const summary = {
      scenes: parsed.manifest.scenes.length,
      clipsAdded: 0,
      clipsUpdated: 0,
      clipsRemoved: 0,
      markersAdded: 0,
      markersUpdated: 0,
      markersRemoved: 0,
      assetsAdded: 0,
      warnings
    };
    if (parsed.manifest.fps && Math.abs(parsed.manifest.fps - project.fps) > 1e-6) {
      warnings.push(
        options.conform ? `manifest fps=${parsed.manifest.fps}\uFF1B\u5DF2\u81EA\u52A8 conform \u5DE5\u7A0B\u8F93\u51FA\u89C4\u683C` : `manifest fps=${parsed.manifest.fps} \u4E0E\u5DE5\u7A0B fps=${project.fps} \u4E0D\u4E00\u81F4\uFF1B\u65F6\u95F4\u6309\u5DE5\u7A0B\u5E27\u7387\u5438\u9644\uFF08\u53EF\u4F20 conform:true\uFF09`
      );
    }
    if (options.conform) {
      const patch = {};
      if (parsed.manifest.fps && Math.abs(parsed.manifest.fps - project.fps) > 1e-6) {
        patch.fps = parsed.manifest.fps;
      }
      if (parsed.manifest.width && parsed.manifest.width !== project.width) {
        patch.width = parsed.manifest.width;
      }
      if (parsed.manifest.height && parsed.manifest.height !== project.height) {
        patch.height = parsed.manifest.height;
      }
      if (Object.keys(patch).length > 0) {
        drafts.push({
          kind: "project.output",
          payload: patch,
          label: "\u5339\u914D\u5F71\u7247\u89C4\u683C"
        });
      }
    }
    const frameRate = options.conform && parsed.manifest.fps ? parsed.manifest.fps : project.fps;
    const assetBySrc = new Map(
      project.assets.map((asset) => [normalizePath(asset.src), asset])
    );
    const incomingAssets = new Map(
      options.assets.map((asset) => [normalizePath(asset.path), asset])
    );
    const resolveAssetId = (path) => {
      const key = normalizePath(path);
      const existing = assetBySrc.get(key);
      if (existing) return existing.id;
      const meta = assetFor(path, incomingAssets);
      if (!meta) return null;
      const asset = {
        id: crypto.randomUUID(),
        name: path.replace(/\\/g, "/").split("/").pop() ?? path,
        kind: meta.kind,
        src: path,
        duration: meta.kind === "image" ? 0 : meta.duration,
        addedAt: now,
        hasAudio: meta.hasAudio ?? false,
        ...meta.width != null ? { width: meta.width } : {},
        ...meta.height != null ? { height: meta.height } : {},
        ...meta.fps != null ? { fps: meta.fps } : {}
      };
      assetBySrc.set(key, asset);
      incomingAssets.delete(key);
      summary.assetsAdded += 1;
      drafts.push({
        kind: "asset.add",
        payload: { asset },
        label: `\u5BFC\u5165\u7D20\u6750 ${asset.name}`
      });
      return asset.id;
    };
    const sceneEnds = /* @__PURE__ */ new Map();
    parsed.manifest.scenes.forEach((scene, index) => {
      const next = parsed.manifest.scenes[index + 1];
      sceneEnds.set(scene.id, next && next.t0 < scene.t1 ? next.t0 : scene.t1);
    });
    const takes = parsed.manifest.scenes.filter((scene) => scene.take);
    let track = project.tracks.find((candidate) => candidate.name === options.trackName);
    let trackRef = track?.id;
    if (!track && takes.length > 0) {
      drafts.push({
        kind: "track.add",
        payload: { name: options.trackName },
        label: `\u65B0\u5EFA\u573A\u666F\u8F68 ${options.trackName}`
      });
      trackRef = project.tracks.length + 1;
    }
    const existingMarkers = /* @__PURE__ */ new Map();
    for (const marker of project.markers) {
      if (!marker.tags?.includes(FILM_TAG)) continue;
      const kind = marker.kind;
      if (kind !== "scene" && kind !== "hit" && kind !== "review") continue;
      const time = snap(marker.time, frameRate);
      const key = kind === "review" ? markerKey(kind, marker.sceneId, time, marker.note?.trim() ?? "") : markerKey(kind, marker.sceneId, time);
      existingMarkers.set(key, marker);
    }
    const desiredMarkerIds = /* @__PURE__ */ new Set();
    const pushMarker = (desired, key) => {
      const existing = existingMarkers.get(key);
      if (existing) {
        desiredMarkerIds.add(existing.id);
        if (!sameNoteMarker(existing, desired)) {
          drafts.push({
            kind: "marker.update",
            payload: { markerId: existing.id, patch: desired },
            label: `\u66F4\u65B0\u6807\u8BB0 ${desired.name}`
          });
          summary.markersUpdated += 1;
        }
        return;
      }
      const id = crypto.randomUUID();
      desiredMarkerIds.add(id);
      drafts.push({
        kind: "marker.add",
        payload: { id, ...desired },
        label: `\u6DFB\u52A0\u6807\u8BB0 ${desired.name}`
      });
      summary.markersAdded += 1;
    };
    const existingClips = /* @__PURE__ */ new Map();
    for (const candidate of project.tracks) {
      for (const clip of candidate.clips) {
        if (clip.sceneId) existingClips.set(clip.sceneId, clip);
      }
    }
    const desiredSceneIds = new Set(parsed.manifest.scenes.map((scene) => scene.id));
    for (const scene of parsed.manifest.scenes) {
      const sceneEnd = sceneEnds.get(scene.id) ?? scene.t1;
      if (scene.take) {
        const takePath = parsed.takePaths.get(scene.id);
        const assetId = takePath ? resolveAssetId(takePath) : null;
        if (takePath && assetId) {
          const meta = assetFor(takePath, incomingAssets) ?? options.assets.find((a) => normalizePath(a.path) === normalizePath(takePath));
          let duration = sceneEnd - scene.t0;
          if (meta && meta.kind !== "image" && meta.duration > 0 && duration > meta.duration) {
            warnings.push(
              `\u573A\u666F ${scene.id} \u7684 ${duration.toFixed(2)}s \u8D85\u8FC7 take \u65F6\u957F ${meta.duration.toFixed(2)}s\uFF0C\u5DF2\u622A\u65AD`
            );
            duration = meta.duration;
          }
          const desired = {
            assetId,
            trackId: "",
            start: scene.t0,
            duration,
            in: 0,
            sceneId: scene.id
          };
          const existing = existingClips.get(scene.id);
          if (existing) {
            if (!sameClip(existing, desired)) {
              drafts.push({
                kind: "clip.update",
                payload: {
                  clipId: existing.id,
                  patch: {
                    assetId,
                    start: desired.start,
                    duration: desired.duration,
                    in: 0,
                    sceneId: scene.id
                  }
                },
                label: `\u66F4\u65B0\u573A\u666F ${scene.id}`
              });
              summary.clipsUpdated += 1;
            }
          } else {
            if (trackRef === void 0) {
              warnings.push(`\u573A\u666F ${scene.id} \u6CA1\u6709\u53EF\u7528\u7684\u573A\u666F\u8F68\uFF0C\u5DF2\u8DF3\u8FC7\u753B\u9762`);
            } else {
              const clipId = crypto.randomUUID();
              drafts.push({
                kind: "clip.add",
                payload: { trackId: trackRef, clip: { id: clipId, ...desired } },
                label: `\u6DFB\u52A0\u573A\u666F ${scene.id}`
              });
              summary.clipsAdded += 1;
            }
          }
        } else if (takePath) {
          warnings.push(`\u573A\u666F ${scene.id} \u7684 take \u63A2\u6D4B\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7\u753B\u9762\uFF1A${takePath}`);
        }
      }
      const sceneMarker = {
        time: snap(scene.t0, frameRate),
        name: scene.title ? `${scene.id} \xB7 ${scene.title}` : scene.id,
        kind: "scene",
        sceneId: scene.id,
        tags: [FILM_TAG]
      };
      pushMarker(sceneMarker, markerKey("scene", scene.id, sceneMarker.time));
      for (const time of scene.markers ?? []) {
        const snapped = snap(time, frameRate);
        pushMarker(
          {
            time: snapped,
            name: `hit ${snapped.toFixed(2)}s`,
            kind: "hit",
            sceneId: scene.id,
            tags: [FILM_TAG]
          },
          markerKey("hit", scene.id, snapped)
        );
      }
      for (const note of scene.review ?? []) {
        const { marker, key } = fromNote(note, scene.id, frameRate);
        pushMarker(marker, key);
      }
    }
    for (const note of parsed.manifest.review ?? []) {
      const { marker, key } = fromNote(note, void 0, frameRate);
      pushMarker(marker, key);
    }
    if (options.mode === "replace") {
      for (const marker of project.markers) {
        if (!marker.tags?.includes(FILM_TAG)) continue;
        if (desiredMarkerIds.has(marker.id)) continue;
        drafts.push({
          kind: "marker.remove",
          payload: { markerId: marker.id },
          label: `\u79FB\u9664\u8FC7\u671F\u6807\u8BB0 ${marker.name}`
        });
        summary.markersRemoved += 1;
      }
      for (const sceneId of existingClips.keys()) {
        if (desiredSceneIds.has(sceneId)) continue;
        const clip = existingClips.get(sceneId);
        if (!clip) continue;
        drafts.push({
          kind: "clip.remove",
          payload: { clipIds: [clip.id] },
          label: `\u79FB\u9664\u8FC7\u671F\u573A\u666F ${sceneId}`
        });
        summary.clipsRemoved += 1;
      }
    }
    const commands = drafts.map((draft, index) => ({
      id: crypto.randomUUID(),
      baseRevision: options.baseRevision,
      actor: options.actor,
      ...options.sessionId ? { sessionId: options.sessionId } : {},
      kind: draft.kind,
      payload: draft.payload,
      label: options.label ?? `\u5BFC\u5165 film.json\uFF08${drafts.length} \u6B65\uFF09`,
      timestamp: now + index
    }));
    if (trackRef !== void 0 && typeof trackRef === "number") {
      summary.trackId = void 0;
    } else {
      summary.trackId = typeof trackRef === "string" ? trackRef : void 0;
    }
    return { commands, summary };
  }

  // src/core/film/export.ts
  function durationOf(project) {
    let end = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
    }
    return end;
  }
  function noteOf(marker) {
    return {
      ...marker.id ? { id: marker.id } : {},
      t: marker.time,
      text: marker.note ?? marker.name,
      ...marker.severity ? { severity: marker.severity } : {},
      ...marker.resolved === true ? { resolved: true } : {},
      ...marker.bbox ? { bbox: marker.bbox } : {},
      ...marker.screenshot ? { screenshot: marker.screenshot } : {},
      ...marker.tags && marker.tags.length > 0 ? { tags: marker.tags } : {}
    };
  }
  function isReviewMarker(marker) {
    return marker.kind === "review" || Boolean(marker.note);
  }
  function projectToManifest(project, options) {
    const clipsByScene = /* @__PURE__ */ new Map();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (!clip.sceneId) continue;
        const list = clipsByScene.get(clip.sceneId) ?? [];
        list.push(clip);
        clipsByScene.set(clip.sceneId, list);
      }
    }
    const sceneMarkers = /* @__PURE__ */ new Map();
    const hits = /* @__PURE__ */ new Map();
    const reviews = /* @__PURE__ */ new Map();
    const looseReviews = [];
    for (const marker of project.markers) {
      const sceneId = marker.sceneId;
      if (marker.kind === "scene" && sceneId) {
        sceneMarkers.set(sceneId, marker);
      } else if (marker.kind === "hit" && sceneId) {
        const list = hits.get(sceneId) ?? [];
        list.push(marker.time);
        hits.set(sceneId, list);
      } else if (isReviewMarker(marker)) {
        if (sceneId) {
          const list = reviews.get(sceneId) ?? [];
          list.push(noteOf(marker));
          reviews.set(sceneId, list);
        } else {
          looseReviews.push(noteOf(marker));
        }
      }
    }
    const sceneIds = /* @__PURE__ */ new Set([
      ...clipsByScene.keys(),
      ...sceneMarkers.keys(),
      ...hits.keys(),
      ...reviews.keys()
    ]);
    const assetById = new Map(project.assets.map((asset) => [asset.id, asset]));
    const scenes = [];
    for (const id of sceneIds) {
      const clips = (clipsByScene.get(id) ?? []).slice().sort((a, b) => a.start - b.start);
      const marker = sceneMarkers.get(id);
      const t0 = clips.length > 0 ? clips[0].start : marker?.time ?? 0;
      const t1 = clips.length > 0 ? Math.max(...clips.map((clip) => clip.start + clip.duration)) : t0;
      const takeClip = clips.find((clip) => clip.assetId !== "");
      const asset = takeClip ? assetById.get(takeClip.assetId) : void 0;
      const titleSource = marker?.name ?? "";
      const title = titleSource.includes(" \xB7 ") ? titleSource.slice(titleSource.indexOf(" \xB7 ") + 3) : void 0;
      const sceneHits = (hits.get(id) ?? []).slice().sort((a, b) => a - b);
      const sceneReviews = (reviews.get(id) ?? []).slice().sort((a, b) => a.t - b.t);
      scenes.push({
        id,
        t0,
        t1,
        ...title ? { title } : {},
        ...asset ? { take: relativeToManifest(options.baseDir, asset.src) } : {},
        ...sceneHits.length > 0 ? { markers: sceneHits } : {},
        ...sceneReviews.length > 0 ? { review: sceneReviews } : {}
      });
    }
    scenes.sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      if (scene.t1 > scene.t0) continue;
      const following = scenes[index + 1];
      const t1 = following && following.t0 > scene.t0 ? following.t0 : scene.t0 + 1 / Math.max(1, project.fps);
      scenes[index] = { ...scene, t1 };
    }
    const next = {
      version: FILM_MANIFEST_VERSION,
      name: project.name,
      fps: project.fps,
      width: project.width,
      height: project.height,
      duration: durationOf(project),
      scenes,
      ...looseReviews.length > 0 ? { review: looseReviews } : {}
    };
    const previous = options.previous;
    const merged = {
      ...previous ?? {},
      ...next
    };
    if (next.music === void 0 && previous && previous.music !== void 0) {
      merged.music = previous.music;
    }
    return merged;
  }

  // src/core/time.ts
  function secToFrame(sec, fps) {
    return Math.round(sec * fps);
  }
  function frameToSec(frame, fps) {
    return frame / fps;
  }
  function snapToFrame(sec, fps) {
    return frameToSec(secToFrame(sec, fps), fps);
  }

  // src/core/subtitles.ts
  function mapCueToTimeline(cue, clip, fps) {
    let start = cue.start;
    let end = cue.end;
    if (clip) {
      const inPoint = clip.in ?? 0;
      const outPoint = inPoint + clip.duration;
      if (end <= inPoint || start >= outPoint) return null;
      start = clip.start + Math.max(0, start - inPoint);
      end = clip.start + Math.min(clip.duration, end - inPoint);
    }
    start = snapToFrame(Math.max(0, start), fps);
    end = snapToFrame(Math.max(0, end), fps);
    if (end - start < 0.1) return null;
    end = snapToFrame(Math.max(start + 0.2, end), fps);
    if (end - start < 0.1) return null;
    return { start, duration: end - start, text: cue.text };
  }

  // src/core/cuts.ts
  var EPS = 1e-6;
  var MERGE_GAP = 0.02;
  function isTextClip(clip) {
    return clip.assetId === "" && typeof clip.text === "string";
  }
  function clipSpeed3(clip) {
    return Math.min(4, Math.max(0.1, clip.speed ?? 1));
  }
  function newCut(kind, srcStart, srcEnd, text) {
    return {
      id: crypto.randomUUID(),
      srcStart: Math.min(srcStart, srcEnd),
      srcEnd: Math.max(srcStart, srcEnd),
      kind,
      text,
      createdAt: Date.now()
    };
  }
  function cutScopes(doc2) {
    return doc2.cutScopes ?? [];
  }
  function scopeOfClip(doc2, clipId) {
    return cutScopes(doc2).find((scope) => scope.pieces.includes(clipId));
  }
  function cutTimelineStart(scope, cut) {
    const removed = scope.cuts.filter((other) => other.srcEnd <= cut.srcStart + EPS && other.id !== cut.id).reduce((sum, other) => sum + (other.srcEnd - other.srcStart), 0);
    return scope.baseStart + (cut.srcStart - scope.baseIn - removed) / clipSpeed3(scope.template);
  }
  function cutTimelineLength(scope, cut) {
    return (cut.srcEnd - cut.srcStart) / clipSpeed3(scope.template);
  }
  function keptSpans(baseIn, baseOut, cuts) {
    const ordered2 = cuts.map((cut) => ({
      start: Math.max(baseIn, Math.min(cut.srcStart, cut.srcEnd)),
      end: Math.min(baseOut, Math.max(cut.srcStart, cut.srcEnd))
    })).filter((cut) => cut.end - cut.start > EPS).sort((a, b) => a.start - b.start);
    const spans = [];
    let cursor = baseIn;
    for (const cut of ordered2) {
      if (cut.start > cursor + EPS) spans.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
    }
    if (baseOut > cursor + EPS) spans.push({ start: cursor, end: baseOut });
    return spans;
  }
  function scopeFromClip(clip) {
    const speed = clipSpeed3(clip);
    return {
      id: crypto.randomUUID(),
      assetId: clip.assetId,
      trackId: clip.trackId,
      baseIn: clip.in,
      baseOut: clip.in + clip.duration * speed,
      baseStart: clip.start,
      template: { ...clip },
      pieces: [clip.id],
      cuts: []
    };
  }
  function detachPieces(doc2, ids) {
    if (ids.length === 0) return doc2;
    const set = new Set(ids);
    let changed = false;
    const tracks = doc2.tracks.map((track) => {
      const clips = track.clips.filter((clip) => !set.has(clip.id));
      if (clips.length === track.clips.length) return track;
      changed = true;
      return { ...track, clips };
    });
    return changed ? withTouch(doc2, { tracks }) : doc2;
  }
  function ensureScope(doc2, scope) {
    const scopes = cutScopes(doc2);
    if (scopes.some((item) => item.id === scope.id)) return doc2;
    return withTouch(doc2, { cutScopes: [...scopes, scope] });
  }
  function sortCuts(cuts) {
    return cuts.slice().sort((a, b) => a.srcStart - b.srcStart);
  }
  function projectScope(doc2, scope) {
    const spans = keptSpans(scope.baseIn, scope.baseOut, scope.cuts);
    const track = doc2.tracks.find((item) => item.id === scope.trackId);
    if (!track) return doc2;
    const template = track.clips.find((clip) => clip.id === scope.pieces[0]) ?? scope.template;
    const speedNow = clipSpeed3(template);
    const keptIds = scope.pieces.slice();
    let cursor = scope.baseStart;
    const pieces = spans.map((span, index) => {
      const duration = (span.end - span.start) / speedNow;
      const piece = {
        ...template,
        id: keptIds[index] ?? crypto.randomUUID(),
        trackId: scope.trackId,
        assetId: scope.assetId,
        start: cursor,
        duration,
        in: span.start
      };
      cursor += duration;
      return piece;
    });
    const pieceIds = new Set(scope.pieces);
    const clips = [];
    for (const clip of track.clips) {
      if (pieceIds.has(clip.id)) continue;
      clips.push(clip);
    }
    const nextTrack = { ...track, clips: sortClips([...clips, ...pieces]) };
    const tracks = doc2.tracks.map((item) => item.id === nextTrack.id ? nextTrack : item);
    const nextScope = {
      ...scope,
      template,
      pieces: pieces.map((piece) => piece.id)
    };
    const scopes = cutScopes(doc2).map((item) => item.id === scope.id ? nextScope : item);
    const known = scopes.some((item) => item.id === scope.id);
    return withTouch(doc2, {
      tracks,
      cutScopes: known ? scopes : [...scopes, nextScope]
    });
  }
  function rippleRemove(doc2, t0, t1, excluded) {
    const length = t1 - t0;
    if (length <= EPS) return doc2;
    let touched = false;
    const tracks = doc2.tracks.map((track) => {
      const clips = [];
      let changed = false;
      for (const clip of track.clips) {
        if (excluded.has(clip.id)) {
          clips.push(clip);
          continue;
        }
        const end = clip.start + clip.duration;
        if (isTextClip(clip)) {
          if (end <= t0 + EPS) {
            clips.push(clip);
          } else if (clip.start >= t1 - EPS) {
            clips.push({ ...clip, start: Math.max(0, clip.start - length) });
            changed = true;
          } else {
            const overlap = Math.min(end, t1) - Math.max(clip.start, t0);
            const duration = Math.max(1 / 25, clip.duration - Math.max(0, overlap));
            const start = clip.start >= t0 - EPS ? Math.max(0, t0) : clip.start;
            clips.push({ ...clip, start, duration });
            changed = true;
          }
          continue;
        }
        if (end <= t0 + EPS) {
          clips.push(clip);
        } else if (clip.start >= t1 - EPS) {
          clips.push({ ...clip, start: Math.max(0, clip.start - length) });
          changed = true;
        } else {
          changed = true;
          const speed = clipSpeed3(clip);
          const hasLeft = clip.start < t0 - EPS;
          const hasRight = end > t1 + EPS;
          if (hasLeft) {
            clips.push({ ...clip, duration: t0 - clip.start });
          }
          if (hasRight) {
            const consumed = (t1 - clip.start) * speed;
            clips.push({
              ...clip,
              id: hasLeft ? crypto.randomUUID() : clip.id,
              start: Math.max(0, t0),
              duration: end - t1,
              in: clip.in + consumed
            });
          }
        }
      }
      if (!changed) return track;
      touched = true;
      return { ...track, clips: sortClips(clips) };
    });
    return touched ? withTouch(doc2, { tracks }) : doc2;
  }
  function applyCuts(doc2, clipId, proposals, words = [], timed = true) {
    const found = findClip(doc2, clipId);
    if (!found) return doc2;
    const base = scopeOfClip(doc2, clipId) ?? scopeFromClip(found.clip);
    const fresh = [];
    for (const proposal of proposals) {
      const start = Math.max(base.baseIn, Math.min(proposal.srcStart, proposal.srcEnd));
      const end = Math.min(base.baseOut, Math.max(proposal.srcStart, proposal.srcEnd));
      if (end - start <= EPS) continue;
      const overlaps2 = [...base.cuts, ...fresh].some(
        (cut) => cut.srcStart < end - MERGE_GAP && start < cut.srcEnd - MERGE_GAP
      );
      if (overlaps2) continue;
      fresh.push(newCut(proposal.kind, start, end, proposal.text));
    }
    if (fresh.length === 0) return doc2;
    const scope = {
      ...base,
      cuts: sortCuts([...base.cuts, ...fresh]),
      ...words.length > 0 ? { words, timed } : {}
    };
    const ranges = fresh.map((cut) => ({
      t0: cutTimelineStart(base, cut),
      t1: cutTimelineStart(base, cut) + cutTimelineLength(base, cut)
    })).sort((a, b) => b.t0 - a.t0);
    let next = ensureScope(doc2, scope);
    next = detachPieces(next, scope.pieces);
    for (const range of ranges) {
      next = rippleRemove(next, range.t0, range.t1, /* @__PURE__ */ new Set());
    }
    return projectScope(next, scope);
  }

  // src/core/cutSubtitles.ts
  var MAX_CUE_CHARS = 24;
  var CUE_GAP = 0.6;
  function speedOf(clip) {
    return Math.min(4, Math.max(0.1, clip.speed ?? 1));
  }
  function appendText(current2, next) {
    if (!current2) return next;
    const last = current2[current2.length - 1];
    const first = next[0] ?? "";
    const latin = /[A-Za-z0-9]/;
    if (latin.test(last) && latin.test(first)) return `${current2} ${next}`;
    return current2 + next;
  }
  function buildCutCues(scope, words, clips, fps) {
    const pieces = clips.filter((clip) => scope.pieces.includes(clip.id)).sort((a, b) => a.start - b.start);
    if (pieces.length === 0 || words.length === 0) return [];
    const minDuration = 1 / Math.max(1, fps);
    const cut = (word) => {
      const middle = (word.start + word.end) / 2;
      return scope.cuts.some((item) => middle >= item.srcStart && middle < item.srcEnd);
    };
    const pieceAt = (time) => pieces.find((piece) => {
      const span = piece.duration * speedOf(piece);
      return time >= piece.in - 1e-6 && time <= piece.in + span + 1e-6;
    }) ?? null;
    const toTimeline = (piece, time) => piece.start + (time - piece.in) / speedOf(piece);
    const cues = [];
    let open = null;
    const flush = () => {
      if (!open) return;
      if (open.end - open.start >= minDuration && open.text.trim()) {
        cues.push({
          start: open.start,
          end: open.end,
          text: open.text.trim(),
          key: `${open.first}-${open.last}`
        });
      }
      open = null;
    };
    for (const [position, word] of words.entries()) {
      if (cut(word)) {
        flush();
        continue;
      }
      const piece = pieceAt((word.start + word.end) / 2) ?? pieceAt(word.start);
      if (!piece) {
        flush();
        continue;
      }
      const start = toTimeline(piece, word.start);
      const end = Math.max(start + minDuration, toTimeline(piece, word.end));
      if (open && (open.pieceId !== piece.id || start - open.end > CUE_GAP || open.text.length + word.text.length > MAX_CUE_CHARS)) {
        flush();
      }
      if (!open) {
        open = { pieceId: piece.id, start, end, text: word.text, first: position, last: position };
      } else {
        open.end = Math.max(open.end, end);
        open.text = appendText(open.text, word.text);
        open.last = position;
      }
    }
    flush();
    for (let index = 1; index < cues.length; index += 1) {
      const previous = cues[index - 1];
      if (cues[index].start < previous.end + minDuration) {
        const start = previous.end + minDuration;
        cues[index] = { ...cues[index], start, end: Math.max(start + minDuration, cues[index].end) };
      }
    }
    return cues;
  }
  function placeCueTrack(doc2, cues, name) {
    const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+\\d+)?$`);
    const previous = /* @__PURE__ */ new Map();
    for (const track2 of doc2.tracks) {
      if (!pattern.test(track2.name)) continue;
      for (const clip of track2.clips) {
        if (clip.cueRange) {
          previous.set(clip.cueRange, {
            text: clip.text ?? "",
            ...clip.textStyle ? { textStyle: clip.textStyle } : {}
          });
        }
      }
    }
    let next = doc2;
    for (const track2 of doc2.tracks) {
      if (pattern.test(track2.name)) next = removeTrack(next, track2.id);
    }
    if (cues.length === 0) return next;
    next = addTrackAt(next, 0, name);
    const track = next.tracks[0];
    for (const cue of cues) {
      const duration = Math.max(1 / next.fps, cue.end - cue.start);
      const kept = previous.get(cue.key);
      const clip = createClip({
        assetId: "",
        trackId: track.id,
        start: cue.start,
        duration,
        text: kept?.text ?? cue.text
      });
      clip.cueRange = cue.key;
      if (kept?.textStyle) clip.textStyle = kept.textStyle;
      next = addClip(next, track.id, clip);
    }
    return next;
  }

  // src/core/cutAnalysis.ts
  var DEFAULT_PAUSE = {
    minPause: 0.8,
    keep: 0.3,
    sentenceKeep: 0.4,
    maxGap: 4
  };
  var DEFAULT_FILLER = {
    lang: "both",
    includeSoft: true,
    custom: [],
    disabled: []
  };
  var HARD_FILLERS = {
    zh: ["\u55EF", "\u5443", "\u989D", "\u5514", "\u5509", "\u54CE"],
    en: ["um", "umm", "uh", "uhh", "er", "erm", "hmm", "mhm", "ah"]
  };
  var SOFT_FILLERS = {
    zh: ["\u90A3\u4E2A", "\u8FD9\u4E2A", "\u5C31\u662F", "\u7136\u540E", "\u5176\u5B9E", "\u53CD\u6B63", "\u5BF9\u5427", "\u4F60\u77E5\u9053\u5427", "\u600E\u4E48\u8BF4"],
    en: ["you know", "i mean", "kind of", "sort of", "like", "basically", "actually", "literally", "honestly"]
  };
  var ISOLATION_GAP = 0.12;
  function normalizeWord(text) {
    return text.replace(/[\p{P}\p{S}\s]/gu, "").toLowerCase();
  }
  function withWordIds(words) {
    return words.map((word, index) => ({
      id: `w${index}`,
      text: word.text,
      start: word.start,
      end: word.end
    }));
  }
  function sentenceEnd(text) {
    return /[。！？.!?…；;]\s*["'”’」』]?$/.test(text.trim());
  }
  function hasPunctuation(text) {
    return /[\p{P}]/u.test(text);
  }
  function detectPauses(words, options = {}) {
    const opts = { ...DEFAULT_PAUSE, ...options };
    const out = [];
    for (let index = 0; index + 1 < words.length; index += 1) {
      const word = words[index];
      const next = words[index + 1];
      const gap = next.start - word.end;
      if (gap < opts.minPause || gap > opts.maxGap) continue;
      const keep = sentenceEnd(word.text) ? opts.sentenceKeep : opts.keep;
      const srcStart = word.end + keep / 2;
      const srcEnd = next.start - keep / 2;
      if (srcEnd - srcStart < 0.15) continue;
      out.push({
        kind: "pause",
        srcStart,
        srcEnd,
        wordIds: [word.id, next.id],
        text: "",
        reason: `${gap.toFixed(1)}s \u2192 ${keep.toFixed(1)}s`
      });
    }
    return out;
  }
  function matchSoft(phrase, words, index) {
    const target = normalizeWord(phrase);
    if (!target) return null;
    if (phrase.includes(" ")) {
      const parts = phrase.split(" ").filter(Boolean).map(normalizeWord);
      if (index + parts.length > words.length) return null;
      const hit = parts.every((part, offset) => normalizeWord(words[index + offset].text) === part);
      return hit ? { length: parts.length, text: target } : null;
    }
    let text = "";
    let count = 0;
    while (index + count < words.length && text.length < target.length) {
      text += normalizeWord(words[index + count].text);
      count += 1;
    }
    return text === target ? { length: count, text } : null;
  }
  function isolatedSpan(words, startIndex, endIndex) {
    const first = words[startIndex];
    const last = words[endIndex];
    const previous = words[startIndex - 1];
    const next = words[endIndex + 1];
    const beforePause = previous ? first.start - previous.end >= ISOLATION_GAP : false;
    const afterPause = next ? next.start - last.end >= ISOLATION_GAP : false;
    if (beforePause || afterPause) return true;
    if (previous && hasPunctuation(previous.text)) return true;
    return hasPunctuation(last.text);
  }
  function detectFillers(words, options = {}) {
    const opts = { ...DEFAULT_FILLER, ...options };
    const langs = opts.lang === "both" ? ["zh", "en"] : [opts.lang];
    const disabled = new Set(
      (opts.disabled ?? []).map((word) => normalizeWord(word)).filter(Boolean)
    );
    const out = [];
    for (let index = 0; index < words.length; index += 1) {
      const normalized = normalizeWord(words[index].text);
      if (!normalized) continue;
      if (disabled.has(normalized)) continue;
      let matched = null;
      for (const lang of langs) {
        if ((HARD_FILLERS[lang] ?? []).includes(normalized)) {
          matched = { length: 1, text: normalized, soft: false };
          break;
        }
      }
      if (!matched && opts.custom && opts.custom.length > 0) {
        for (const phrase of opts.custom) {
          if (disabled.has(normalizeWord(phrase))) continue;
          const span2 = matchSoft(phrase, words, index);
          if (!span2) continue;
          matched = { length: span2.length, text: span2.text, soft: true };
          break;
        }
      }
      if (!matched && opts.includeSoft) {
        for (const lang of langs) {
          for (const item of SOFT_FILLERS[lang] ?? []) {
            if (disabled.has(normalizeWord(item))) continue;
            const span2 = matchSoft(item, words, index);
            if (!span2) continue;
            if (!isolatedSpan(words, index, index + span2.length - 1)) continue;
            matched = { length: span2.length, text: span2.text, soft: true };
            break;
          }
          if (matched) break;
        }
      }
      if (!matched) continue;
      const span = words.slice(index, index + matched.length);
      const srcStart = span[0].start;
      const srcEnd = span[span.length - 1].end;
      if (srcEnd - srcStart < 0.05) continue;
      out.push({
        kind: "filler",
        srcStart,
        srcEnd,
        wordIds: span.map((word) => word.id),
        text: span.map((word) => word.text).join(""),
        reason: matched.soft ? "\u53E3\u5934\u7985" : "\u8BED\u6C14\u8BCD"
      });
      index += matched.length - 1;
    }
    return out;
  }
  var DEFAULT_TRIM = { pad: 0.12, guard: 0.02 };
  function trimLimits(words, first, last, guard) {
    const prev = words[first - 1];
    const next = words[last + 1];
    return {
      floor: prev ? prev.end + guard : 0,
      ceil: next ? next.start - guard : Number.POSITIVE_INFINITY
    };
  }
  function padFillerCuts(cuts, words, options = {}) {
    const opts = { ...DEFAULT_TRIM, ...options };
    const pad = Math.max(0, opts.pad);
    const guard = Math.max(0, opts.guard);
    if (pad <= 0 || words.length === 0) return cuts;
    const indexes = new Map(words.map((word, index) => [word.id, index]));
    return cuts.map((cut) => {
      if (cut.kind !== "filler" || cut.wordIds.length === 0) return cut;
      const first = indexes.get(cut.wordIds[0]);
      const last = indexes.get(cut.wordIds[cut.wordIds.length - 1]);
      if (first === void 0 || last === void 0) return cut;
      const { floor, ceil } = trimLimits(words, first, last, guard);
      const srcStart = Math.min(cut.srcStart, Math.max(floor, cut.srcStart - pad));
      const srcEnd = Math.max(cut.srcEnd, Math.min(ceil, cut.srcEnd + pad));
      if (srcStart === cut.srcStart && srcEnd === cut.srcEnd) return cut;
      return { ...cut, srcStart, srcEnd };
    });
  }
  function overlaps(a, b) {
    return a.srcStart < b.srcEnd && b.srcStart < a.srcEnd;
  }
  var FILLER_MERGE_GAP = 0.03;
  function unionFillerCuts(cuts) {
    const ordered2 = cuts.slice().sort((a, b) => a.srcStart - b.srcStart || a.srcEnd - b.srcEnd);
    const out = [];
    for (const cut of ordered2) {
      const last = out[out.length - 1];
      if (last && cut.srcStart <= last.srcEnd + FILLER_MERGE_GAP) {
        last.srcEnd = Math.max(last.srcEnd, cut.srcEnd);
        for (const id of cut.wordIds) {
          if (!last.wordIds.includes(id)) last.wordIds.push(id);
        }
        last.text += cut.text;
        continue;
      }
      out.push({ ...cut, wordIds: [...cut.wordIds] });
    }
    return out;
  }
  function subtractCut(cut, holes) {
    let segments = [{ start: cut.srcStart, end: cut.srcEnd }];
    for (const hole of holes) {
      const next = [];
      for (const segment of segments) {
        if (hole.srcEnd <= segment.start + 1e-6 || hole.srcStart >= segment.end - 1e-6) {
          next.push(segment);
          continue;
        }
        if (hole.srcStart > segment.start + 1e-6) {
          next.push({ start: segment.start, end: hole.srcStart });
        }
        if (hole.srcEnd < segment.end - 1e-6) {
          next.push({ start: hole.srcEnd, end: segment.end });
        }
      }
      segments = next;
    }
    return segments.filter((segment) => segment.end - segment.start > 0.05).map((segment) => ({ ...cut, srcStart: segment.start, srcEnd: segment.end }));
  }
  function mergeProposals(groups, taken = []) {
    const fresh = groups.flat().filter((proposal) => !taken.some((range) => overlaps(proposal, range)));
    const fillers = unionFillerCuts(fresh.filter((proposal) => proposal.kind === "filler"));
    const holes = fillers.map((cut) => ({ srcStart: cut.srcStart, srcEnd: cut.srcEnd }));
    const out = [...fillers];
    for (const proposal of fresh) {
      if (proposal.kind === "filler") continue;
      for (const piece of subtractCut(proposal, holes)) {
        if (out.some((item) => overlaps(item, piece))) continue;
        out.push(piece);
      }
    }
    return out.sort((a, b) => a.srcStart - b.srcStart || a.srcEnd - b.srcEnd);
  }

  // src/domain/host.ts
  globalThis.crypto = {
    randomUUID: () => __aicut_uuid()
  };
  Date.now = () => __aicut_now();
  var doc = null;
  var revision = 0;
  var HISTORY_LIMIT = 50;
  var undoStack = [];
  var redoStack = [];
  function remember(before) {
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    if (!doc) throw new Error("project not loaded");
    const previous = undoStack.pop();
    if (!previous) {
      return JSON.stringify({ ok: true, revision, changed: false, error: "\u6CA1\u6709\u53EF\u64A4\u9500\u7684\u64CD\u4F5C" });
    }
    redoStack.push(doc);
    doc = previous;
    revision += 1;
    return JSON.stringify({ ok: true, revision, changed: true });
  }
  function redo() {
    if (!doc) throw new Error("project not loaded");
    const next = redoStack.pop();
    if (!next) {
      return JSON.stringify({ ok: true, revision, changed: false, error: "\u6CA1\u6709\u53EF\u91CD\u505A\u7684\u64CD\u4F5C" });
    }
    undoStack.push(doc);
    doc = next;
    revision += 1;
    return JSON.stringify({ ok: true, revision, changed: true });
  }
  function historyDepth() {
    return JSON.stringify({ undo: undoStack.length, redo: redoStack.length });
  }
  function fail(revisionNow, error) {
    const wire = { ok: false, revision: revisionNow, error };
    return JSON.stringify(wire);
  }
  function errorText(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function load(json) {
    doc = parseProject(json);
    revision = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    return JSON.stringify({ ok: true, revision });
  }
  function blank() {
    doc = newProject();
    revision = 0;
    undoStack.length = 0;
    redoStack.length = 0;
    return JSON.stringify({ ok: true, revision });
  }
  function snapshot() {
    if (!doc) throw new Error("project not loaded");
    return serializeProject(doc);
  }
  function currentRevision() {
    return revision;
  }
  function setLocale(locale) {
    if (locale !== "zh" && locale !== "en") throw new Error(`unsupported locale: ${locale}`);
    setTranslateLocale(locale);
    return locale;
  }
  function apply(commandJson) {
    if (!doc) return fail(revision, "project not loaded");
    let command;
    try {
      command = JSON.parse(commandJson);
    } catch (error) {
      return fail(revision, `invalid command json: ${errorText(error)}`);
    }
    if (command.baseRevision !== revision) {
      return fail(
        revision,
        `stale revision: expected ${revision}, got ${String(command.baseRevision)}`
      );
    }
    try {
      const result = applyCommandToDoc(doc, command);
      if (result.doc === doc) {
        const wire2 = {
          ok: true,
          revision,
          changed: false,
          affected: result.affected
        };
        return JSON.stringify(wire2);
      }
      remember(doc);
      doc = result.doc;
      revision += 1;
      const wire = {
        ok: true,
        revision,
        changed: true,
        affected: result.affected
      };
      return JSON.stringify(wire);
    } catch (error) {
      return fail(revision, errorText(error));
    }
  }
  function view(method, argsJson) {
    if (!doc) throw new Error("project not loaded");
    const args = argsJson && argsJson !== "null" ? JSON.parse(argsJson) : {};
    switch (method) {
      case "overview":
        return JSON.stringify(overview(doc, revision));
      case "clip":
        return JSON.stringify(clipDetail(doc, revision, String(args.clipId ?? "")));
      // 智能体的"渐进读取"：桌面 `tools.rs` 用同名视图，无头版直接复用同一份实现。
      case "track":
        return JSON.stringify(
          trackPage(
            doc,
            revision,
            args.trackId ?? args.track ?? args.ref,
            args.offset,
            args.limit
          )
        );
      case "find_clips":
        return JSON.stringify(findClips(doc, revision, args));
      case "assets":
        return JSON.stringify(assetsPage(doc, revision, args));
      case "markers":
        return JSON.stringify(markers(doc, revision, args));
      default:
        throw new Error(`unknown view: ${method}`);
    }
  }
  function opFail(revisionNow, error) {
    const wire = { ok: false, revision: revisionNow, changed: false, error };
    return JSON.stringify(wire);
  }
  function evenSize(value, fallback) {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    const rounded = Math.round(value);
    return rounded % 2 === 0 ? rounded : rounded + 1;
  }
  function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function stemLabel(name) {
    const key = `audio.stem.${name}`;
    const label = t(key);
    return label === key ? name : label;
  }
  function stringList(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }
  function requireClip(docIn, clipId) {
    const found = findClip(docIn, clipId);
    if (!found) throw new Error(`\u7247\u6BB5\u4E0D\u5B58\u5728\uFF1A${clipId}`);
    return found;
  }
  function op(kind, argsJson) {
    if (!doc) return opFail(revision, "project not loaded");
    let args;
    try {
      args = argsJson && argsJson !== "null" ? JSON.parse(argsJson) : {};
    } catch (error) {
      return opFail(revision, `invalid op json: ${errorText(error)}`);
    }
    const before = doc;
    try {
      let next = before;
      for (const asset of Array.isArray(args.assets) ? args.assets : []) {
        next = addAsset(next, asset);
      }
      let result = null;
      let dropHistory = false;
      switch (kind) {
        // 素材内字幕 → 时间线字幕：帧吸附与"超出片段窗口丢弃"都在这里，
        // 换语言/改工程帧率时两个形态的换算结果一致（只读，不改文档）。
        case "map_cues": {
          const cues = args.cues ?? [];
          const clipArg = args.clipId;
          const clip = typeof clipArg === "string" && clipArg ? findClip(next, clipArg)?.clip ?? null : null;
          const fps = numberOr(args.fps, next.fps);
          result = {
            cues: cues.map((cue) => mapCueToTimeline(cue, clip, fps)).filter((cue) => cue !== null)
          };
          break;
        }
        // 字幕 / 译文字幕：顶部新建字幕轨，一次事务写入全部 cue。
        case "subtitle_track": {
          const cues = args.cues ?? [];
          const known = new Set(next.tracks.map((track) => track.id));
          next = insertCueTrack(
            next,
            cues,
            String(args.baseName || t(String(args.defaultName || "ai.subtitleTrack")))
          );
          const created = next.tracks.filter((track) => !known.has(track.id));
          result = {
            track: created[0] ? { id: created[0].id, name: created[0].name, clipCount: created[0].clips.length } : null,
            inserted: cues.filter((cue) => cue.text.trim().length > 0).length
          };
          break;
        }
        // 降噪 / DSP：音频片段就地换素材，视频片段静音后另开一轨（桌面语义）。
        case "processed_audio": {
          const { clip } = requireClip(next, String(args.clipId ?? ""));
          const known = new Set(next.tracks.map((track) => track.id));
          next = applyProcessedAudio(
            next,
            clip,
            String(args.assetId ?? ""),
            numberOr(args.duration, 0),
            String(args.sourceKind ?? "audio"),
            String(args.trackName ?? "AI \u5904\u7406")
          );
          result = {
            clipId: clip.id,
            tracks: next.tracks.filter((track) => !known.has(track.id)).map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }))
          };
          break;
        }
        // 音源分离：在源轨道下方逐条新建分轨，源片段静音。
        case "stem_tracks": {
          const { clip } = requireClip(next, String(args.clipId ?? ""));
          const stems = (args.stems ?? []).map((stem) => ({
            label: stem.label ?? stemLabel(stem.name),
            assetId: stem.assetId,
            duration: stem.duration
          }));
          const known = new Set(next.tracks.map((track) => track.id));
          next = addStemTracks(
            next,
            clip,
            stems,
            String(args.baseName || t("audio.stemTrack")),
            args.muteSource !== false
          );
          result = {
            tracks: next.tracks.filter((track) => !known.has(track.id)).map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }))
          };
          break;
        }
        // 视频 AI（超分 / 补帧 / 裁剪）：用新素材替换片段引用，入点归零。
        case "replace_video": {
          const { clip } = requireClip(next, String(args.clipId ?? ""));
          next = replaceClipVideo(
            next,
            clip.id,
            String(args.assetId ?? ""),
            numberOr(args.duration, 0),
            clip.duration
          );
          result = { clipId: clip.id, assetId: String(args.assetId ?? "") };
          break;
        }
        // 朗读 / 译制配音：按文字片段起点落轨，重叠自动开新轨。
        case "voiceover": {
          const muteClipId = args.muteClipId;
          if (typeof muteClipId === "string" && muteClipId) {
            next = setClipMuted(next, muteClipId, true);
          }
          const items = args.items ?? [];
          const known = new Set(next.tracks.map((track) => track.id));
          next = placeVoiceover(
            next,
            items,
            String(args.baseName || t(String(args.defaultName || "ai.voiceoverTrack")))
          );
          result = {
            tracks: next.tracks.filter((track) => !known.has(track.id)).map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }))
          };
          break;
        }
        // 变声：原片段静音，结果按原起点落轨。
        case "converted_voice": {
          const items = args.items ?? [];
          const known = new Set(next.tracks.map((track) => track.id));
          next = placeConvertedVoice(next, items, String(args.baseName || t("ai.voiceChangeTrack")));
          result = {
            tracks: next.tracks.filter((track) => !known.has(track.id)).map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }))
          };
          break;
        }
        // 智能剪口播：检测 + 落地 + 重铺「口播字幕」轨，全在一个事务里。
        case "cut_filler": {
          const clipId = String(args.clipId ?? "");
          const { clip } = requireClip(next, clipId);
          const words = withWordIds(
            args.words ?? []
          );
          const options = args.options ?? {};
          const existing = scopeOfClip(next, clipId);
          const taken = (existing?.cuts ?? []).map((cut) => ({
            srcStart: cut.srcStart,
            srcEnd: cut.srcEnd
          }));
          const fillerCuts = padFillerCuts(
            detectFillers(words, {
              includeSoft: options.includeSoft !== false,
              custom: stringList(options.custom),
              disabled: stringList(options.disabled)
            }),
            words,
            { pad: numberOr(options.pad, DEFAULT_TRIM.pad) }
          );
          const proposals = mergeProposals(
            [
              fillerCuts,
              detectPauses(words, {
                minPause: numberOr(options.minPause, DEFAULT_PAUSE.minPause),
                keep: numberOr(options.pauseKeep, DEFAULT_PAUSE.keep),
                sentenceKeep: numberOr(options.sentenceKeep, DEFAULT_PAUSE.sentenceKeep)
              })
            ],
            taken
          );
          const removed = proposals.reduce(
            (sum, proposal) => sum + (proposal.srcEnd - proposal.srcStart),
            0
          );
          const timed = args.timed !== false;
          const summary = {
            clipId: clip.id,
            aligned: timed,
            wordCount: words.length,
            cutCount: proposals.length,
            removedSeconds: Math.round(removed * 100) / 100,
            proposals: proposals.map((proposal) => ({
              kind: proposal.kind,
              start: proposal.srcStart,
              end: proposal.srcEnd,
              text: proposal.text,
              reason: proposal.reason
            }))
          };
          if (args.dryRun === true || proposals.length === 0 || words.length === 0) {
            result = { ...summary, applied: false };
            break;
          }
          next = applyCuts(
            next,
            clipId,
            proposals.map((proposal) => ({
              kind: proposal.kind,
              srcStart: proposal.srcStart,
              srcEnd: proposal.srcEnd,
              text: proposal.text
            })),
            words.map((word) => ({ text: word.text, start: word.start, end: word.end })),
            timed
          );
          const scope = scopeOfClip(next, clipId);
          if (scope) {
            const cues = buildCutCues(
              scope,
              words,
              next.tracks.flatMap((track) => track.clips),
              next.fps
            );
            next = placeCueTrack(next, cues, String(args.cueTrackName || t("cutReview.cueTrack")));
          }
          result = { ...summary, applied: true };
          break;
        }
        // 文案查表：无头侧不重复维护一份词典，轨道名 / 标签直接用桌面那份 i18n。
        case "translate_keys": {
          const keys = stringList(args.keys);
          result = { labels: Object.fromEntries(keys.map((key) => [key, t(key)])) };
          break;
        }
        // 响度统一：由测量结果算非破坏性增益，看得上再写回片段。
        case "apply_loudness": {
          const clipId = String(args.clipId ?? "");
          requireClip(next, clipId);
          const report = args.report ?? {};
          const target = numberOr(args.targetLufs, -14);
          const gain = loudnessGain(report, target);
          const apply2 = args.apply === true && gain !== null;
          if (apply2) next = setClipGain(next, clipId, gain);
          result = {
            integratedLufs: report.integrated_lufs,
            truePeakDbtp: report.true_peak_dbtp,
            targetLufs: target,
            suggestedGainDb: gain,
            applied: apply2
          };
          break;
        }
        // 拆音轨：视频片段静音，声音另起一条音轨（复用同一素材与入点）。
        case "extract_audio": {
          const clipId = String(args.clipId ?? "");
          const { clip } = requireClip(next, clipId);
          const kind2 = next.assets.find((asset) => asset.id === clip.assetId)?.kind;
          if (kind2 !== "video") throw new Error(`\u7247\u6BB5 ${clipId} \u4E0D\u662F\u89C6\u9891\u7D20\u6750`);
          if (clip.audioOnly) throw new Error(`\u7247\u6BB5 ${clipId} \u5DF2\u7ECF\u662F\u7EAF\u97F3\u9891\u7247\u6BB5`);
          if (!(clip.duration > 0)) throw new Error(`\u7247\u6BB5 ${clipId} \u65F6\u957F\u65E0\u6548`);
          const known = new Set(next.tracks.map((track) => track.id));
          const extracted = extractClipAudio(
            next,
            clip,
            String(args.baseName || t("inspector.extractAudioTrack"))
          );
          next = extracted.doc;
          result = {
            clipId: extracted.clipId,
            trackId: extracted.trackId,
            tracks: next.tracks.filter((track) => !known.has(track.id)).map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }))
          };
          break;
        }
        // 导入字幕：SRT / VTT 文本 → 置顶文字轨（重叠自动拆轨）。
        case "place_subtitles": {
          const text = String(args.text ?? "");
          if (!text.trim()) throw new Error("\u5B57\u5E55\u6587\u4EF6\u662F\u7A7A\u7684");
          const entries = parseSubtitleText(text, String(args.path ?? ""));
          const baseName = String(args.baseName || t("ai.subtitleTrack"));
          const known = new Set(next.tracks.map((track) => track.id));
          next = placeSubtitleCues(next, entries, baseName, numberOr(args.offset, 0));
          result = {
            count: entries.length,
            tracks: next.tracks.filter((track) => !known.has(track.id)).map((track) => ({ id: track.id, name: track.name, clipCount: track.clips.length }))
          };
          break;
        }
        // 导出字幕：文字片段 → SRT / VTT 文本（写盘由调用方做）。
        case "serialize_subtitles": {
          const trackRef = args.trackId;
          const tracks = trackRef === void 0 || trackRef === null ? next.tracks : (() => {
            const track = resolveTrack2(next, trackRef);
            return track ? [track] : [];
          })();
          const entries = tracks.flatMap((track) => track.clips).map((clip) => ({
            start: clip.start,
            end: clip.start + clip.duration,
            text: (clip.text ?? "").trim(),
            subtitle: clip.assetId === ""
          })).filter((entry) => entry.subtitle && entry.text.length > 0).sort((left, right) => left.start - right.start || left.end - right.end);
          const format = args.format === "vtt" ? "vtt" : "srt";
          result = {
            format,
            count: entries.length,
            text: serializeSubtitles(entries, format)
          };
          break;
        }
        // 新建工程：与桌面 `project.new` 同一个 `makeProject` 默认值 + 可选出图规格。
        case "new_project": {
          const created = newProject(
            typeof args.name === "string" && args.name.trim() ? args.name.trim() : void 0
          );
          next = setProjectOutput(created, {
            ...typeof args.width === "number" ? { width: args.width } : {},
            ...typeof args.height === "number" ? { height: args.height } : {},
            ...typeof args.fps === "number" ? { fps: args.fps } : {}
          });
          dropHistory = true;
          result = { name: next.name, width: next.width, height: next.height, fps: next.fps };
          break;
        }
        // 编译导出计划：与桌面「导出按钮」走同一个 `buildExportPlan`，
        // ffmpeg 滤镜图只在这里生成一次，无头侧只负责执行。
        case "compile_export": {
          const outputPath = String(args.outputPath ?? "");
          if (!outputPath.trim()) throw new Error("compile_export \u9700\u8981 outputPath");
          const raw = args.options ?? {};
          const options = {
            format: raw.format === "prores" || raw.format === "gif" ? raw.format : "mp4",
            resolution: raw.resolution ?? "project",
            width: typeof raw.width === "number" ? raw.width : null,
            height: typeof raw.height === "number" ? raw.height : null,
            fps: typeof raw.fps === "number" ? raw.fps : null,
            quality: raw.quality ?? "high",
            fit: raw.fit === "cover" ? "cover" : "contain",
            fitAnchor: raw.fitAnchor ?? "center",
            gifColors: typeof raw.gifColors === "number" ? raw.gifColors : 256,
            gifDither: raw.gifDither ?? "sierra2_4a",
            gifLoop: typeof raw.gifLoop === "number" ? raw.gifLoop : 0,
            audio: raw.audio !== false
          };
          const window = args.window;
          const plan = buildExportPlan(
            next,
            options,
            /* @__PURE__ */ new Map(),
            outputPath,
            /* @__PURE__ */ new Map(),
            window && typeof window.start === "number" && typeof window.end === "number" ? { start: window.start, end: window.end } : void 0,
            /* @__PURE__ */ new Map()
          );
          let outputArgs = plan.outputArgs;
          const frameTime = typeof args.frameTime === "number" ? args.frameTime : null;
          if (frameTime !== null) {
            const mapIndex = outputArgs.indexOf("-map");
            const videoLabel = mapIndex >= 0 ? outputArgs[mapIndex + 1] : null;
            if (!videoLabel) throw new Error("\u5BFC\u51FA\u8BA1\u5212\u91CC\u6CA1\u6709\u89C6\u9891\u8F93\u51FA");
            if (!(frameTime >= 0 && frameTime <= plan.duration)) {
              throw new Error(t("export.frameTimeInvalid"));
            }
            const at = Math.min(frameTime, Math.max(0, plan.duration - 1 / plan.fps));
            outputArgs = [
              "-map",
              videoLabel,
              "-an",
              "-ss",
              String(at),
              "-frames:v",
              "1",
              "-update",
              "1",
              outputPath
            ];
          }
          result = { ...plan, outputArgs };
          break;
        }
        // film.json 导入：解析 + 生成命令 + 逐条应用（一个撤销步）。
        case "film_import": {
          const text = String(args.text ?? "");
          const path = String(args.path ?? "");
          if (!text.trim()) throw new Error("film_import \u9700\u8981 text");
          if (!path.trim()) throw new Error("film_import \u9700\u8981 path");
          let raw;
          try {
            raw = JSON.parse(text);
          } catch (error) {
            throw new Error(`film.json \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${errorText(error)}`);
          }
          const parsed = parseFilmManifest(raw, path);
          const plan = buildManifestCommands(next, parsed, {
            mode: args.mode === "merge" ? "merge" : "replace",
            trackName: String(args.trackName || "Scenes"),
            assets: Array.isArray(args.assets) ? args.assets : [],
            baseRevision: revision + 1,
            actor: "agent",
            ...typeof args.label === "string" ? { label: args.label } : {},
            ...args.conform === true ? { conform: true } : {}
          });
          let working = next;
          let applied = 0;
          for (const command of plan.commands) {
            const step = applyCommandToDoc(working, {
              ...command,
              baseRevision: revision + applied + 1
            });
            working = step.doc;
            applied += 1;
          }
          next = working;
          result = { ...plan.summary, applied, changed: next !== before };
          break;
        }
        // film.json 里的场次表（逐场渲染用）。
        case "manifest_scenes": {
          const path = String(args.path ?? "");
          if (!path.trim()) throw new Error("manifest_scenes \u9700\u8981 path");
          let raw;
          try {
            raw = JSON.parse(String(args.text ?? "{}"));
          } catch (error) {
            throw new Error(`film.json \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${errorText(error)}`);
          }
          const parsed = parseFilmManifest(raw, path);
          result = {
            fps: parsed.manifest.fps ?? null,
            scenes: parsed.manifest.scenes.map((scene) => ({
              id: scene.id,
              start: scene.t0,
              end: scene.t1
            }))
          };
          break;
        }
        // film.json 导出：把工程重建为 manifest（写盘由调用方做）。
        case "film_export": {
          const manifest = projectToManifest(next, {
            baseDir: String(args.baseDir || "."),
            previous: args.previous ?? null
          });
          result = { manifest };
          break;
        }
        // 接触表版面：格子尺寸 / 行数 / xstack layout 字符串（与导出共用一份算法）。
        case "contact_layout": {
          const count = Math.max(1, Math.round(numberOr(args.count, 1)));
          const cols = Math.min(
            6,
            Math.max(1, Math.round(numberOr(args.cols, Math.ceil(Math.sqrt(count)))))
          );
          const cellWidth = evenSize(numberOr(args.cellWidth, 480), 480);
          const cellHeight = evenSize(Math.round(cellWidth * 9 / 16), 270);
          const rows = Math.ceil(count / cols);
          const layout = buildContactLayout(count, cols, cellWidth, cellHeight);
          result = { cols, rows, cellWidth, cellHeight, layout: layout.layout, total: cols * rows };
          break;
        }
        // SSIM 统计解析 + 变化点（低于阈值）；同一份解析器，不另写一份。
        case "parse_ssim": {
          const text = String(args.text ?? "");
          const fps = numberOr(args.fps, 30);
          const start = numberOr(args.start, 0);
          const summary = parseSsimStats(text, fps, start);
          const threshold = numberOr(args.threshold, 0.98);
          result = {
            ssim: { mean: summary.mean, min: summary.min, samples: summary.samples },
            changed: changedSamples(summary, threshold),
            frames: summary.frames.slice(0, 200)
          };
          break;
        }
        // 只登记素材（导入素材 / 模型输出的通用路径）。
        case "add_assets": {
          result = { assets: next.assets.length - before.assets.length };
          break;
        }
        default:
          return opFail(revision, `unknown op: ${kind}`);
      }
      if (next !== before) {
        if (dropHistory) {
          undoStack.length = 0;
          redoStack.length = 0;
        } else {
          remember(before);
        }
        doc = next;
        revision += 1;
      }
      const wire = { ok: true, revision, changed: next !== before, result };
      return JSON.stringify(wire);
    } catch (error) {
      return opFail(revision, errorText(error));
    }
  }
  return __toCommonJS(host_exports);
})();

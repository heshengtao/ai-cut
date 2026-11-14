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
    currentRevision: () => currentRevision,
    load: () => load,
    setLocale: () => setLocale,
    snapshot: () => snapshot,
    view: () => view
  });

  // src/core/ops/internal.ts
  function withTouch(doc2, patch) {
    return { ...doc2, ...patch, updatedAt: Date.now() };
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
  var PROJECT_VERSION = 1;

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
    "audio.translateVoiceNote": "Dub uses an installed local TTS model",
    "audio.dubNoModel": "No TTS model installed; subtitles only",
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
    "settings.section.general.caption": "Language and project info",
    "settings.section.appearance": "Appearance",
    "settings.section.appearance.caption": "Theme",
    "settings.section.layout": "Layout",
    "settings.section.layout.caption": "Panels and timeline",
    "settings.section.about": "About",
    "settings.section.about.caption": "Version and licence",
    "settings.section.storage": "Storage",
    "settings.section.storage.caption": "Data folder and migration",
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
    "settings.storage.cleanupTitle": "Delete the old data folder?",
    "settings.storage.cleanupBody": "This will delete {path}, keeping only the bootstrap pointer and discovery files. It cannot be undone.",
    "settings.storage.cleanupGo": "Delete",
    "settings.language": "Language",
    "settings.language.label": "Interface language",
    "settings.language.hint": "Applies immediately",
    "settings.startup": "Startup",
    "settings.welcome.label": "Show the welcome screen on launch",
    "settings.welcome.hint": "Gives you a starting point every time; turn it off and replay it from the Help menu.",
    "settings.welcome.replay": "Guided tour",
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
    "agent.unconfiguredHint": "Set an OpenAI-compatible endpoint, API key and model in Settings \u2192 AI & MCP.",
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
    "sdcpp.groupHint": "The ggml runtime shared by video generation (Wan / Hunyuan / LTX / MiniMax-H3) and image generation (SD / FLUX / Qwen-Image / Z-Image); downloaded and removed separately from ONNX Runtime.",
    "sdcpp.officialOnly": "Downloaded from the official GitHub Release or the ModelScope community mirror; every archive is SHA-256 verified. No third-party proxies.",
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
    "runtime.hint": "CPU / DirectML / CoreML ship with the app; CUDA 12 / CUDA 13 are downloaded on demand (on Windows / Linux as a fully matched ORT + CUDA component set), applies after restart.",
    "runtime.partsTitle": "CUDA components",
    "runtime.empty": "No runtimes to download.",
    "runtime.autoDownloading": "CUDA runtime components are missing; downloading {count} item(s)\u2026",
    "runtime.bundled": "Bundled",
    "runtime.installed": "Installed",
    "runtime.notInstalled": "Not installed",
    "runtime.partsNote": "Missing components install automatically when switching to CUDA",
    "runtime.cuda12Parts": "CUDA 12 components",
    "runtime.cuda12PartsHint": "cudart 12 / cuBLAS 12 / cuFFT 11 / cuDNN 9 (CUDA 12): missing pieces are installed automatically when switching to CUDA 12, or download them here.",
    "runtime.cuda13Parts": "CUDA 13 components",
    "runtime.cuda13PartsHint": "cudart 13 / cuBLAS 13 / cuFFT 12 / cuDNN 9 (CUDA 13): missing pieces are installed automatically when switching to CUDA 13, or download them here.",
    "runtime.restartBody": "Newly installed runtimes / CUDA components load on the next start.",
    "runtime.restartNow": "Restart now",
    "runtime.restartLater": "Later",
    "runtime.cudart": "CUDA Runtime 12 (cudart)",
    "runtime.cudart.note": "CUDA 12 runtime; the ORT CUDA 12 build depends on it, and the version is pinned to match.",
    "runtime.cublas": "cuBLAS 12",
    "runtime.cublas.note": "CUDA 12 matrix library (incl. cublasLt); the ORT CUDA 12 build depends on it.",
    "runtime.cufft": "cuFFT 11 (CUDA 12)",
    "runtime.cufft.note": "CUDA 12 FFT library; the ORT CUDA 12 provider imports it directly.",
    "runtime.cudnn": "cuDNN 9 (CUDA 12)",
    "runtime.cudnn.note": "NVIDIA deep neural network library (9.27, CUDA 12); every sub-library in this folder is loaded by the ORT CUDA 12 build.",
    "runtime.cudart13": "CUDA Runtime 13 (cudart)",
    "runtime.cudart13.note": "CUDA 13 runtime; the ORT CUDA 13 build depends on it, and the version is pinned to match.",
    "runtime.cublas13": "cuBLAS 13",
    "runtime.cublas13.note": "CUDA 13 matrix library (incl. cublasLt); the ORT CUDA 13 build depends on it.",
    "runtime.cufft13": "cuFFT 12 (CUDA 13)",
    "runtime.cufft13.note": "CUDA 13 FFT library (`cufft64_12.dll`); the ORT CUDA 13 provider imports it directly.",
    "runtime.cudnn13": "cuDNN 9 (CUDA 13)",
    "runtime.cudnn13.note": "NVIDIA deep neural network library (9.27, CUDA 13); every sub-library in this folder is loaded by the ORT CUDA 13 build.",
    "runtime.cpu": "CPU",
    "runtime.cpu.note": "Plain CPU build (bundled, works everywhere).",
    "runtime.directml": "DirectML",
    "runtime.directml.note": "DirectX 12 hardware acceleration on Windows (bundled, with CPU fallback).",
    "runtime.coreml": "Apple CoreML",
    "runtime.coreml.note": "Apple Neural Engine / GPU (bundled).",
    "runtime.cuda": "ONNX Runtime (CUDA 12)",
    "runtime.cuda.note": "NVIDIA GPU acceleration; on Windows / Linux the fully matched CUDA 12 / cuFFT 11 / cuDNN 9 set is downloaded with it (missing components install automatically), so no system CUDA install is needed. Best compatibility for older cards / drivers < 580.",
    "runtime.cuda13": "ONNX Runtime (CUDA 13)",
    "runtime.cuda13.note": "NVIDIA GPU acceleration for newer cards; on Windows / Linux the fully matched CUDA 13 / cuFFT 12 / cuDNN 9 set (ORT 1.31 build) is downloaded with it (missing components install automatically). Faster on Turing+ with driver 580+.",
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
    "settings.section.ai": "AI/MCP",
    "settings.section.ai.caption": "Clip agent, MCP server and skills",
    "settings.section.tts": "Speech synthesis",
    "settings.section.tts.caption": "Cloud TTS services and custom endpoints",
    "settings.section.gen": "Image & video",
    "settings.section.gen.caption": "Cloud text-to-image, image-to-image and video APIs",
    "settings.section.network": "Network",
    "settings.section.network.caption": "Proxy, mirrors and model sources",
    "settings.section.cli": "Command line",
    "settings.section.cli.caption": "Use aicut from a terminal",
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
    "settings.ai.sdcppHint": "Wan / Hunyuan / LTX / MiniMax-H3 and SD / FLUX / Qwen-Image / Z-Image all run on sd.cpp (ggml), completely separate from ONNX Runtime above. Switching takes effect on the next run; no restart needed.",
    "settings.ai.sdcppMissing": "The sd.cpp engine is not installed",
    "settings.ai.sdcppOpen": "Open download manager",
    "settings.ai.sdcppApplied": "Video backend switched to {backend} (next run)",
    "settings.ai.sdcppNeedDownload": '"{backend}" needs the sd.cpp engine ({size}). Open the download manager now?',
    "settings.ai.sdcppDownloadGo": "Download",
    "settings.ai.backend": "Execution backend",
    "settings.ai.backendHint": "Which ONNX Runtime backend runs the local models. CPU is the default; CUDA 12 / CUDA 13 are two independent runtimes, and options are limited to what this device supports.",
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
    "setup.title.voice": "Set up \u201CAI voice change\u201D",
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
    "error.serialize.badTrack": "Invalid project file: track is not an object",
    "error.serialize.badClips": "Invalid project file: track clips is not an array",
    "error.serialize.badClip": "Invalid project file: clip is not an object",
    "error.serialize.badClipTime": "Invalid project file: invalid clip time",
    "error.serialize.badJson": "Project file is not valid JSON",
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
    "settings.store.hfTokenClear": "Clear"
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
    "audio.translateVoiceNote": "\u914D\u97F3\u4F7F\u7528\u5DF2\u5B89\u88C5\u7684\u672C\u5730\u6717\u8BFB\u6A21\u578B",
    "audio.dubNoModel": "\u672A\u5B89\u88C5\u6717\u8BFB\u6A21\u578B\uFF0C\u53EA\u80FD\u751F\u6210\u8BD1\u6587\u5B57\u5E55",
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
    "settings.section.general": "\u901A\u7528",
    "settings.section.general.caption": "\u8BED\u8A00\u4E0E\u5DE5\u7A0B\u4FE1\u606F",
    "settings.section.appearance": "\u5916\u89C2",
    "settings.section.appearance.caption": "\u4E3B\u9898",
    "settings.section.layout": "\u5E03\u5C40",
    "settings.section.layout.caption": "\u9762\u677F\u4E0E\u65F6\u95F4\u7EBF",
    "settings.section.about": "\u5173\u4E8E",
    "settings.section.about.caption": "\u7248\u672C\u4E0E\u8BB8\u53EF",
    "settings.section.storage": "\u5B58\u50A8",
    "settings.section.storage.caption": "\u6570\u636E\u76EE\u5F55\u4E0E\u8FC1\u79FB",
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
    "settings.storage.cleanupTitle": "\u5220\u9664\u65E7\u6570\u636E\u76EE\u5F55\uFF1F",
    "settings.storage.cleanupBody": "\u5C06\u5220\u9664 {path}\uFF0C\u53EA\u4FDD\u7559\u542F\u52A8\u7528\u7684\u6307\u9488\u4E0E\u53D1\u73B0\u6587\u4EF6\u3002\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
    "settings.storage.cleanupGo": "\u5220\u9664",
    "settings.language": "\u8BED\u8A00",
    "settings.language.label": "\u754C\u9762\u8BED\u8A00",
    "settings.language.hint": "\u5207\u6362\u540E\u7ACB\u5373\u751F\u6548",
    "settings.startup": "\u542F\u52A8",
    "settings.welcome.label": "\u542F\u52A8\u65F6\u663E\u793A\u6B22\u8FCE\u9875",
    "settings.welcome.hint": "\u6BCF\u6B21\u6253\u5F00\u90FD\u7ED9\u51FA\u8D77\u6B65\u5165\u53E3\uFF1B\u5173\u6389\u540E\u4ECD\u53EF\u4ECE\u5E2E\u52A9\u83DC\u5355\u91CD\u770B\u3002",
    "settings.welcome.replay": "\u65B0\u624B\u5F15\u5BFC",
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
    "agent.unconfiguredHint": "\u5728\u8BBE\u7F6E \u2192 AI \u4E0E MCP \u4E2D\u586B\u5199 OpenAI \u517C\u5BB9\u7AEF\u70B9\u3001API Key \u548C\u6A21\u578B\u3002",
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
    "sdcpp.cpuMac.note": "\u5F3A\u5236 CPU \u8FD0\u884C\uFF08\u590D\u7528\u5DF2\u4E0B\u8F7D\u7684 Metal \u5F15\u64CE\uFF0C\u4E0D\u989D\u5916\u4E0B\u8F7D\uFF1BMetal \u51FA\u95EE\u9898\u6216\u663E\u5B58\u4E0D\u591F\u65F6\u7528\uFF09\u3002",
    "sdcpp.vulkan": "Vulkan",
    "sdcpp.vulkan.note": "Vulkan \u663E\u5361\u52A0\u901F\uFF0CAMD / Intel / NVIDIA \u901A\u7528\u3002",
    "sdcpp.cuda12": "CUDA 12",
    "sdcpp.cuda12.note": "NVIDIA \u663E\u5361\u52A0\u901F\uFF0C\u5F15\u64CE\u5305\u81EA\u5E26 CUDA 12 \u8FD0\u884C\u5E93\u3002",
    "sdcpp.rocm": "ROCm",
    "sdcpp.rocm.note": "AMD \u663E\u5361\u52A0\u901F\uFF08Windows \u5305\u81EA\u5E26 HIP \u8FD0\u884C\u5E93\uFF0CLinux \u9700\u8981\u7CFB\u7EDF\u5DF2\u88C5 ROCm\uFF09\uFF1BNVIDIA / Intel \u663E\u5361\u8BF7\u9009 Vulkan\u3002",
    "sdcpp.metal": "Metal",
    "sdcpp.metal.note": "Apple Silicon GPU \u52A0\u901F\u3002",
    "sdcpp.installed": "\u5DF2\u5B89\u88C5",
    "sdcpp.downloadSize": "\u9700\u4E0B\u8F7D {size}",
    "sdcpp.current": "\u5F53\u524D",
    "sdcpp.group": "sd.cpp \u751F\u6210\u5F15\u64CE",
    "sdcpp.groupHint": "\u89C6\u9891\u751F\u6210\uFF08Wan / Hunyuan / LTX / MiniMax-H3\uFF09\u4E0E\u56FE\u50CF\u751F\u6210\uFF08SD / FLUX / Qwen-Image / Z-Image\uFF09\u5171\u7528\u7684 ggml \u8FD0\u884C\u65F6\uFF0C\u4E0E ONNX Runtime \u5206\u5F00\u4E0B\u8F7D / \u5220\u9664\u3002",
    "sdcpp.officialOnly": "\u4ECE GitHub \u5B98\u65B9 Release \u6216\u9B54\u642D\u793E\u533A\u955C\u50CF\u4E0B\u8F7D\uFF0C\u6BCF\u4EFD\u6587\u4EF6\u90FD\u4F1A\u6821\u9A8C sha256\uFF1B\u4E0D\u4F7F\u7528\u7B2C\u4E09\u65B9\u4EE3\u7406\u3002",
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
    "runtime.hint": "CPU / DirectML / CoreML \u968F\u5305\u5185\u7F6E\uFF1BCUDA 12 / CUDA 13 \u6309\u9700\u4E0B\u8F7D\uFF08Windows / Linux \u4E0A\u90FD\u662F\u6574\u5957\u5339\u914D\u7684 ORT + CUDA \u7EC4\u4EF6\uFF09\uFF0C\u88C5\u5B8C\u91CD\u542F\u751F\u6548\u3002",
    "runtime.partsTitle": "CUDA \u7EC4\u4EF6",
    "runtime.empty": "\u6CA1\u6709\u9700\u8981\u4E0B\u8F7D\u7684\u8FD0\u884C\u65F6\u3002",
    "runtime.autoDownloading": "\u7F3A\u5C11 CUDA \u8FD0\u884C\u7EC4\u4EF6\uFF0C\u6B63\u5728\u81EA\u52A8\u4E0B\u8F7D\uFF08{count} \u9879\uFF09\u2026",
    "runtime.bundled": "\u968F\u5305\u5185\u7F6E",
    "runtime.installed": "\u5DF2\u5B89\u88C5",
    "runtime.notInstalled": "\u672A\u5B89\u88C5",
    "runtime.partsNote": "\u5207\u6362 CUDA \u65F6\u81EA\u52A8\u5B89\u88C5\u7F3A\u5931\u7EC4\u4EF6",
    "runtime.cuda12Parts": "CUDA 12 \u7EC4\u4EF6",
    "runtime.cuda12PartsHint": "cudart 12 / cuBLAS 12 / cuFFT 11 / cuDNN 9\uFF08CUDA 12\uFF09\uFF1A\u5207\u6362 CUDA 12 \u65F6\u81EA\u52A8\u5B89\u88C5\u7F3A\u5931\u9879\uFF0C\u4E5F\u53EF\u4EE5\u5728\u8FD9\u91CC\u5355\u72EC\u4E0B\u8F7D\u3002",
    "runtime.cuda13Parts": "CUDA 13 \u7EC4\u4EF6",
    "runtime.cuda13PartsHint": "cudart 13 / cuBLAS 13 / cuFFT 12 / cuDNN 9\uFF08CUDA 13\uFF09\uFF1A\u5207\u6362 CUDA 13 \u65F6\u81EA\u52A8\u5B89\u88C5\u7F3A\u5931\u9879\uFF0C\u4E5F\u53EF\u4EE5\u5728\u8FD9\u91CC\u5355\u72EC\u4E0B\u8F7D\u3002",
    "runtime.restartBody": "\u65B0\u88C5\u7684\u8FD0\u884C\u5E93 / CUDA \u7EC4\u4EF6\u4F1A\u5728\u4E0B\u6B21\u542F\u52A8\u65F6\u52A0\u8F7D\u3002",
    "runtime.restartNow": "\u7ACB\u5373\u91CD\u542F",
    "runtime.restartLater": "\u7A0D\u540E",
    "runtime.cudart": "CUDA Runtime 12 (cudart)",
    "runtime.cudart.note": "CUDA 12 \u8FD0\u884C\u65F6\uFF1BORT \u7684 CUDA 12 \u7248\u4F9D\u8D56\u5B83\uFF0C\u7248\u672C\u4E0E\u672C\u4F53\u9489\u6B7B\u5339\u914D\u3002",
    "runtime.cublas": "cuBLAS 12",
    "runtime.cublas.note": "CUDA 12 \u7684\u77E9\u9635\u8FD0\u7B97\u5E93\uFF08\u542B cublasLt\uFF09\uFF1BORT \u7684 CUDA 12 \u7248\u4F9D\u8D56\u5B83\u3002",
    "runtime.cufft": "cuFFT 11\uFF08CUDA 12\uFF09",
    "runtime.cufft.note": "CUDA 12 \u7684 FFT \u5E93\uFF1BORT \u7684 CUDA 12 provider \u76F4\u63A5\u4F9D\u8D56\u5B83\u3002",
    "runtime.cudnn": "cuDNN 9\uFF08CUDA 12\uFF09",
    "runtime.cudnn.note": "NVIDIA \u6DF1\u5EA6\u795E\u7ECF\u7F51\u7EDC\u5E93\uFF089.27\uFF0CCUDA 12 \u7248\uFF09\uFF1BORT \u7684 CUDA 12 \u7248\u4F9D\u8D56\u5B83\uFF0C\u6574\u76EE\u5F55\u90FD\u662F\u8FD0\u884C\u65F6\u9700\u8981\u7684\u5B50\u5E93\u3002",
    "runtime.cudart13": "CUDA Runtime 13 (cudart)",
    "runtime.cudart13.note": "CUDA 13 \u8FD0\u884C\u65F6\uFF1BORT \u7684 CUDA 13 \u7248\u4F9D\u8D56\u5B83\uFF0C\u7248\u672C\u4E0E\u672C\u4F53\u9489\u6B7B\u5339\u914D\u3002",
    "runtime.cublas13": "cuBLAS 13",
    "runtime.cublas13.note": "CUDA 13 \u7684\u77E9\u9635\u8FD0\u7B97\u5E93\uFF08\u542B cublasLt\uFF09\uFF1BORT \u7684 CUDA 13 \u7248\u4F9D\u8D56\u5B83\u3002",
    "runtime.cufft13": "cuFFT 12\uFF08CUDA 13\uFF09",
    "runtime.cufft13.note": "CUDA 13 \u7684 FFT \u5E93\uFF08`cufft64_12.dll`\uFF09\uFF1BORT \u7684 CUDA 13 provider \u76F4\u63A5\u4F9D\u8D56\u5B83\u3002",
    "runtime.cudnn13": "cuDNN 9\uFF08CUDA 13\uFF09",
    "runtime.cudnn13.note": "NVIDIA \u6DF1\u5EA6\u795E\u7ECF\u7F51\u7EDC\u5E93\uFF089.27\uFF0CCUDA 13 \u7248\uFF09\uFF1BORT \u7684 CUDA 13 \u7248\u4F9D\u8D56\u5B83\uFF0C\u6574\u76EE\u5F55\u90FD\u662F\u8FD0\u884C\u65F6\u9700\u8981\u7684\u5B50\u5E93\u3002",
    "runtime.cpu": "CPU",
    "runtime.cpu.note": "\u7EAF CPU \u6784\u5EFA\uFF08\u968F\u5305\uFF0C\u5168\u5E73\u53F0\u53EF\u7528\uFF09\u3002",
    "runtime.directml": "DirectML",
    "runtime.directml.note": "Windows \u4E0A\u7684 DirectX 12 \u786C\u4EF6\u52A0\u901F\uFF08\u968F\u5305\uFF0C\u542B CPU \u56DE\u9000\uFF09\u3002",
    "runtime.coreml": "Apple CoreML",
    "runtime.coreml.note": "Apple \u795E\u7ECF\u5F15\u64CE / GPU\uFF08\u968F\u5305\uFF09\u3002",
    "runtime.cuda": "ONNX Runtime\uFF08CUDA 12\uFF09",
    "runtime.cuda.note": "NVIDIA \u663E\u5361\u52A0\u901F\uFF1BWindows / Linux \u4E0A\u6574\u5957\u5339\u914D\u7684 CUDA 12 / cuFFT 11 / cuDNN 9 \u968F\u4E0B\u8F7D\u81EA\u5E26\uFF0C\u7F3A\u7684\u7EC4\u4EF6\u4F1A\u81EA\u52A8\u8865\u9F50\uFF0C\u4E0D\u9700\u8981\u7CFB\u7EDF\u91CC\u88C5 CUDA\u3002\u8001\u5361 / \u9A71\u52A8 < 580 \u517C\u5BB9\u6027\u6700\u597D\u3002",
    "runtime.cuda13": "ONNX Runtime\uFF08CUDA 13\uFF09",
    "runtime.cuda13.note": "NVIDIA \u65B0\u5361\u52A0\u901F\uFF1BWindows / Linux \u4E0A\u6574\u5957\u5339\u914D\u7684 CUDA 13 / cuFFT 12 / cuDNN 9\uFF08ORT 1.31 \u6784\u5EFA\uFF09\u968F\u4E0B\u8F7D\u81EA\u5E26\uFF0C\u7F3A\u7684\u7EC4\u4EF6\u4F1A\u81EA\u52A8\u8865\u9F50\u3002Turing \u8D77\u4E14\u9A71\u52A8 580+ \u66F4\u5FEB\u3002",
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
    "settings.section.ai": "AI/MCP",
    "settings.section.ai.caption": "\u526A\u8F91\u667A\u80FD\u4F53\u3001MCP \u670D\u52A1\u5668\u4E0E\u6280\u80FD",
    "settings.section.tts": "\u8BED\u97F3\u5408\u6210",
    "settings.section.tts.caption": "\u4E91\u7AEF TTS \u670D\u52A1\u4E0E\u81EA\u5B9A\u4E49\u63A5\u53E3",
    "settings.section.gen": "\u56FE\u50CF\u4E0E\u89C6\u9891",
    "settings.section.gen.caption": "\u4E91\u7AEF\u6587\u751F\u56FE / \u56FE\u751F\u56FE / \u89C6\u9891\u751F\u6210 API",
    "settings.section.network": "\u7F51\u7EDC",
    "settings.section.network.caption": "\u4EE3\u7406\u3001\u955C\u50CF\u4E0E\u6A21\u578B\u4E0B\u8F7D\u6E90",
    "settings.section.cli": "\u547D\u4EE4\u884C",
    "settings.section.cli.caption": "\u5728\u7EC8\u7AEF\u4F7F\u7528 aicut",
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
    "settings.ai.sdcppHint": "Wan / Hunyuan / LTX / MiniMax-H3 \u4E0E SD / FLUX / Qwen-Image / Z-Image \u90FD\u8D70 sd.cpp\uFF08ggml\uFF09\uFF0C\u4E0E\u4E0A\u9762\u7684 ONNX Runtime \u5B8C\u5168\u5206\u5F00\uFF1B\u5207\u6362\u540E\u4E0B\u6B21\u751F\u6210\u751F\u6548\uFF0C\u4E0D\u9700\u8981\u91CD\u542F\u3002",
    "settings.ai.sdcppMissing": "sd.cpp \u5F15\u64CE\u8FD8\u6CA1\u4E0B\u8F7D",
    "settings.ai.sdcppOpen": "\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668",
    "settings.ai.sdcppApplied": "\u89C6\u9891\u540E\u7AEF\u5DF2\u5207\u6362\u5230 {backend}\uFF08\u4E0B\u6B21\u751F\u6210\u751F\u6548\uFF09",
    "settings.ai.sdcppNeedDownload": "\u300C{backend}\u300D\u9700\u8981\u5148\u4E0B\u8F7D sd.cpp \u5F15\u64CE\uFF08{size}\uFF09\u3002\u73B0\u5728\u6253\u5F00\u4E0B\u8F7D\u7BA1\u7406\u5668\u5417\uFF1F",
    "settings.ai.sdcppDownloadGo": "\u53BB\u4E0B\u8F7D",
    "settings.ai.backend": "\u6267\u884C\u540E\u7AEF",
    "settings.ai.backendHint": "\u672C\u5730\u6A21\u578B\u7528\u54EA\u4E2A ONNX Runtime \u540E\u7AEF\u3002\u9ED8\u8BA4 CPU\uFF1BCUDA 12 / CUDA 13 \u662F\u4E24\u5957\u72EC\u7ACB\u8FD0\u884C\u65F6\uFF0C\u9009\u9879\u53EA\u5217\u51FA\u672C\u673A\u652F\u6301\u7684\u90A3\u4E9B\u3002",
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
    "setup.title.voice": "\u51C6\u5907\u300CAI \u53D8\u58F0\u300D",
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
    "error.serialize.badTrack": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u8F68\u9053\u4E0D\u662F\u5BF9\u8C61",
    "error.serialize.badClips": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u8F68\u9053\u7684 clips \u4E0D\u662F\u6570\u7EC4",
    "error.serialize.badClip": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u7247\u6BB5\u4E0D\u662F\u5BF9\u8C61",
    "error.serialize.badClipTime": "\u5DE5\u7A0B\u6587\u4EF6\u683C\u5F0F\u9519\u8BEF\uFF1A\u7247\u6BB5\u7684\u65F6\u95F4\u5B57\u6BB5\u975E\u6CD5",
    "error.serialize.badJson": "\u5DE5\u7A0B\u6587\u4EF6\u4E0D\u662F\u5408\u6CD5 JSON",
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
    "settings.store.hfTokenClear": "\u6E05\u9664"
  };
  var zh_default = zh;

  // src/i18n/translate.ts
  var LOCALES = [
    { id: "zh", label: "\u7B80\u4F53\u4E2D\u6587" },
    { id: "en", label: "English" }
  ];
  var FALLBACK = LOCALES[0].id;
  var MESSAGES = { zh: zh_default, en: en_default };
  var current = FALLBACK;
  function setTranslateLocale(next) {
    current = next;
  }
  function t(key, vars) {
    const dict = MESSAGES[current] ?? MESSAGES[FALLBACK];
    let text = dict[key] ?? MESSAGES[FALLBACK][key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

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

  // src/core/ops/tracks.ts
  function addTrackAt(doc2, index, name) {
    const track = createTrack(name ?? nextTrackName(doc2));
    const at = Math.min(Math.max(0, index), doc2.tracks.length);
    const tracks = doc2.tracks.slice();
    tracks.splice(at, 0, track);
    return withTouch(doc2, { tracks });
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
      const overlaps = start < otherEnd && other.start < start + duration;
      if (!overlaps) continue;
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

  // src/core/ops/markers.ts
  var MARKER_KINDS = ["scene", "hit", "review", "chapter"];
  var SEVERITIES = ["blocker", "high", "medium", "low"];
  function sortMarkers(markers) {
    return markers.slice().sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
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
    const markers = doc2.markers.slice();
    markers[index] = next;
    return withTouch(doc2, { markers: sortMarkers(markers) });
  }
  function removeMarker(doc2, markerId) {
    const markers = doc2.markers.filter((marker) => marker.id !== markerId);
    if (markers.length === doc2.markers.length) return doc2;
    return withTouch(doc2, { markers });
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
    const ordered = entries.filter((entry) => entry.text.trim().length > 0).slice().sort((a, b) => a.start - b.start || a.end - b.end);
    for (const entry of ordered) {
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
    if (before === after) return EMPTY_AFFECTED;
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
      ...range ? { range } : {}
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

  // src/core/serialize.ts
  function serializeProject(project) {
    return JSON.stringify(project, null, 2);
  }
  function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }
  function isNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function assertProjectShape(value) {
    if (!isObject(value)) throw new Error(t("error.serialize.notObject"));
    if (value.version !== PROJECT_VERSION) {
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
    if (!Array.isArray(value.tracks)) throw new Error(t("error.serialize.badTracks"));
    for (const track of value.tracks) {
      if (!isObject(track)) throw new Error(t("error.serialize.badTrack"));
      if (!Array.isArray(track.clips)) throw new Error(t("error.serialize.badClips"));
      for (const clip of track.clips) {
        if (!isObject(clip)) throw new Error(t("error.serialize.badClip"));
        if (!isNumber(clip.start) || !isNumber(clip.duration) || !isNumber(clip.in)) {
          throw new Error(t("error.serialize.badClipTime"));
        }
      }
    }
  }
  function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function legacyKeyframeValue(frames, time, fallback) {
    if (!Array.isArray(frames)) return fallback;
    const points = frames.filter(
      (frame) => isObject(frame) && isNumber(frame.time) && isNumber(frame.value)
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
    if (!isObject(raw)) return void 0;
    const times = /* @__PURE__ */ new Set();
    for (const property of KEYFRAME_PROPERTIES) {
      const frames2 = raw[property];
      if (!Array.isArray(frames2)) continue;
      for (const frame of frames2) {
        if (isObject(frame) && isNumber(frame.time)) {
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
      if (!isObject(item)) continue;
      if (typeof item.id !== "string" || typeof item.assetId !== "string" || typeof item.trackId !== "string" || !isNumber(item.baseIn) || !isNumber(item.baseOut) || !isNumber(item.baseStart) || !isObject(item.template) || !Array.isArray(item.pieces) || !Array.isArray(item.cuts)) {
        continue;
      }
      const cuts = [];
      for (const cut of item.cuts) {
        if (!isObject(cut) || !isNumber(cut.srcStart) || !isNumber(cut.srcEnd)) continue;
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
        (word) => isObject(word) && typeof word.text === "string" && isNumber(word.start) && isNumber(word.end)
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
  function normalizeProject(project) {
    const tracks = project.tracks.map((track) => {
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
    const markers = Array.isArray(project.markers) ? project.markers.filter((marker) => isObject(marker) && isNumber(marker.time)).map((marker) => {
      const severity = marker.severity === "blocker" || marker.severity === "high" || marker.severity === "medium" || marker.severity === "low" ? marker.severity : void 0;
      const kind = marker.kind === "scene" || marker.kind === "hit" || marker.kind === "review" || marker.kind === "chapter" ? marker.kind : void 0;
      const bbox = isObject(marker.bbox) && isNumber(marker.bbox.x) && isNumber(marker.bbox.y) && isNumber(marker.bbox.width) && isNumber(marker.bbox.height) ? {
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
    const cutScopes = normalizeCutScopes(project);
    return {
      ...project,
      tracks,
      markers,
      ...cutScopes ? { cutScopes } : { cutScopes: void 0 }
    };
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
  var SUMMARY_TEXT = 200;
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

  // src/domain/host.ts
  globalThis.crypto = {
    randomUUID: () => __aicut_uuid()
  };
  Date.now = () => __aicut_now();
  var doc = null;
  var revision = 0;
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
    const args = argsJson ? JSON.parse(argsJson) : {};
    switch (method) {
      case "overview":
        return JSON.stringify(overview(doc, revision));
      case "clip":
        return JSON.stringify(clipDetail(doc, revision, String(args.clipId ?? "")));
      default:
        throw new Error(`unknown view: ${method}`);
    }
  }
  return __toCommonJS(host_exports);
})();

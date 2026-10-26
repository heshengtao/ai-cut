# ofx-host

A small OpenFX image-effect host. It loads one `.ofx` binary, describes the
plugin, and renders RGBA frames at the input size — there is no fixed 720×576
canvas.

The public surface has two layers:

- `ofx-host` CLI: `probe` and `render`.
- `ofx_host` Rust crate: `probe`, `Session` (`render`, `render_multi`,
  `source_time`, `set_source_time`, `set_duration`, `set_frame_rate`); used by
  the Tauri commands `ofx_probe` / `ofx_render_frame` / `ofx_render_preview` /
  `ofx_source_time` / `ofx_render_transition` / `ofx_bake_clip` /
  `ofx_bake_transition` / `ofx_bake_image`.

The C core (`src/host.c`) owns the OFX ABI. It is plain C because OFX's
parameter getters are C-variadic; everything above it is safe Rust.

## CLI

```sh
# List every plugin and its parameters.
ofx-host probe ~/Library/OFX/Plugins/Invert.ofx.bundle

# Machine-readable output.
ofx-host probe path/to/plugin.ofx.bundle --json

# Render a PPM at the image's own size. params.json is a JSON object.
ofx-host render path/to/plugin.ofx.bundle net.sf.openfx.invertPlugin \
  in.ppm params.json out.ppm

# Raw RGBA8 needs explicit dimensions.
ofx-host render path/to/plugin.ofx.bundle com.example.glow \
  in.rgba params.json out.rgba --width 1920 --height 1080
```

`probe` prints the plugin identifier, label, version, supported contexts,
pixel depths, clips and a parameter table with type, default, range and enum
values. Parameters are addressed by their OFX script name.

Dependencies: `clap`, `serde`, `serde_json`. Build:

```sh
cargo build --release
```

## Supported OFX subset

Implemented host suites:

- property (v1)
- image effect (v1)
- parameter (v1)
- memory (v1)
- multi-thread (v1; executes deterministically in one host thread)
- message (v1/v2)
- progress (v1/v2)
- timeline (v1)

Rendering uses `OfxBitDepthFloat` (preferred), 16-bit `OfxBitDepthShort` or
`OfxBitDepthByte`, RGBA components, a single input frame for all non-output
clips, and a host-allocated output image. OFX canonical coordinates are
bottom-left, so the host flips incoming and outgoing rows; callers always pass
and receive top-down RGBA.

All six image-effect contexts are accepted by the host:

- `Filter` / `General` / `Generator`: one `Source` input. A General-context
  plugin that names extra clips receives the same frame for them.
- `Transition`: two named inputs, `SourceFrom` and `SourceTo`; the host drives
  the mandated `Transition` parameter with the 0..1 progress passed to
  `ofx_host_session_render_multi`. Missing sides are fed transparent black.
- `Paint`: one `Source` input. Renders work, but the host does not implement
  the interactive overlay / brush suites, so only parameter-driven paint output
  is available.
- `Retimer`: one `Source` input plus host-driven `SourceTime`. Call
  `ofx_host_session_source_time` after `kOfxChangeTime` to learn which source
  time the plugin wants, then `ofx_host_session_set_source_time` before
  rendering that frame.

`Session::render_multi` is the multi-input entry point. `Session::render` stays
as the single-`Source` convenience wrapper. `set_duration` and `set_frame_rate`
expose the clip length and project frame rate used by time-aware plugins.

The app-side matrix is: filter / general / generator / paint / retimer attach to
a clip's effect chain; transition attaches to a clip edge and is baked as a
full-frame overlay. Paint remains parameter-only; retimer must be first in the
chain and uses per-frame source decoding (slower than a straight bake).

Parameter and clip handles stay valid for the lifetime of a session (their
backing arrays never move), parameter descriptions are seeded with the
documented defaults (hint, labels, secret/enabled/animates), and
`OfxActionSyncPrivateData` runs after instance creation and before every
render, so plugins that cache state outside the parameter table keep working.

Bundle discovery accepts `.ofx.bundle` and `.ofx` directories, and falls back
to any Mach-O/PE/ELF executable under the usual `Contents/*` folders when the
binary is not named `*.ofx`.

The host runs inside the app process, so the plugin's CPU architecture must
match the app's. On Apple Silicon, x86_64-only bundles (for example Natron
2.5.0) fail with a clear "架构不兼容" message instead of a generic load error;
use a universal/arm64 build, or an x86_64 build of the app under Rosetta.

Not implemented: interactive overlays / painting, OpenGL/OpenCL/CUDA/Metal,
half-float pixel depths, custom interact UI, and arbitrary temporal clip access
(`GetFramesNeeded`). The Retimer context uses the mandated `SourceTime`
mechanism instead.

## Headers

`include/openfx/` vendors the official OpenFX 1.5.1 headers from
[AcademySoftwareFoundation/openfx](https://github.com/AcademySoftwareFoundation/openfx),
tag `OFX_Release_1.5.1`, BSD-3-Clause. See `include/README.md`.

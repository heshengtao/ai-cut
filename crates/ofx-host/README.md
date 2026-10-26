# ofx-host

A small OpenFX image-effect host. It loads one `.ofx` binary, describes the
plugin, and renders RGBA frames at the input size — there is no fixed 720×576
canvas.

The public surface has two layers:

- `ofx-host` CLI: `probe` and `render`.
- `ofx_host` Rust crate: `probe`, `Session`, `render_frame`; used by the Tauri
  commands `ofx_probe` / `ofx_render_frame` / `ofx_render_preview` /
  `ofx_bake_clip`.

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

Supported image-effect contexts are `Filter`, `General` (single input; extra
clips receive the same frame) and `Generator`. `Transition` needs two distinct
`SourceFrom` / `SourceTo` frames, while `Paint` and `Retimer` need interactive
painting or a different time base; those three are not implemented. AI Cut's
effect picker hides them instead of mounting a plugin that would render the
wrong picture.

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

Not implemented: interactive overlays, OpenGL/OpenCL/CUDA/Metal, half-float
pixel depths, custom interact UI, multiple independent input clips and
temporal clip access.

## Headers

`include/openfx/` vendors the official OpenFX 1.5.1 headers from
[AcademySoftwareFoundation/openfx](https://github.com/AcademySoftwareFoundation/openfx),
tag `OFX_Release_1.5.1`, BSD-3-Clause. See `include/README.md`.

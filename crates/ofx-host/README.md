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

Rendering uses either `OfxBitDepthFloat` (preferred) or `OfxBitDepthByte`,
RGBA components, a single input frame for all non-output clips, and a
host-allocated output image. OFX canonical coordinates are bottom-left, so the
host flips incoming and outgoing rows; callers always pass and receive
top-down RGBA.

Not implemented: interactive overlays, OpenGL/OpenCL/CUDA/Metal, 16-bit and
half pixel depths, custom interact UI, and temporal clip access.

## Headers

`include/openfx/` vendors the official OpenFX 1.5.1 headers from
[AcademySoftwareFoundation/openfx](https://github.com/AcademySoftwareFoundation/openfx),
tag `OFX_Release_1.5.1`, BSD-3-Clause. See `include/README.md`.

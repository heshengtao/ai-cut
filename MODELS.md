# Models, weights and licenses

AI Cut ships **no model zoo**. The installers carry five small, permissively licensed
models so the basic tools work immediately; everything larger — speech recognition,
TTS, source separation, super resolution, frame interpolation and the video/image
generation models — is downloaded on demand from its publisher (Hugging Face, ModelScope
or GitHub Releases) into the user's data folder, and every downloaded file is checked
against a pinned `sha256` before it is installed.

That separation matters for licensing: **[LICENSE](LICENSE) (Apache-2.0) covers the
application code only.** Each set of weights stays under the license its publisher gave
it. The machine-readable source of truth is the model catalog in
[`src-tauri/src/models.rs`](src-tauri/src/models.rs) (the `license` field of every
entry), the app shows that same string in the **Models** pane, and the verbatim texts for
the bundled weights live in
[`src-tauri/resources/models/LICENSES/`](src-tauri/resources/models/LICENSES/).

## Three separate layers

| Layer | Whose terms apply | Where it is stated |
|---|---|---|
| Application code | Apache-2.0, this project | [LICENSE](LICENSE) |
| Model weights | the model's publisher | this file + the upstream model card |
| Video / audio / images you produce | you — subject to the model's terms and to the rights you hold in the input | "Outputs" below |

Do not describe the product as "Apache-2.0 including its models": the code is
Apache-2.0, the weights are not ours to relicense.

## Bundled weights (inside the installer)

Five models are small enough to ship, and all of them are permissively licensed. They are
redistributed unmodified; the license texts are collected in `LICENSES/`.

| Model | Used for | License | Upstream |
|---|---|---|---|
| Silero VAD v5 (`silero_vad_v5.onnx`) | speech detection for captions / silence trimming | MIT | Silero Team (`snakers4/silero-vad`), ONNX build via `k2-fsa/sherpa-onnx` |
| LocalVQE v1.2 (`localvqe-ns.onnx`) | vocal denoise / dereverb | Apache-2.0 | LocalAI-io (`localai-org/LocalVQE`); ONNX export mirrored on Hugging Face (`ailm32442/localvqe-ns-onnx`) |
| Real-ESRGAN general-x4v3 | video super resolution (fast tier) | BSD-3-Clause | Xintao Wang et al. (`xinntao/Real-ESRGAN`); mirrored in `ailm32442/ai-cut-models` |
| YOLOX-nano | subject tracking | Apache-2.0 | Megvii (`Megvii-BaseDetection/YOLOX`); mirrored in `ailm32442/ai-cut-models` |
| YuNet 2023mar | face detection for auto-reframe | MIT | OpenCV Zoo (`opencv/opencv_zoo`); mirrored in `ailm32442/ai-cut-models` |

Bundling is limited to permissive licenses by policy (a unit test enforces it): the
`bundle_eligible` size rule alone would let a small model with a restrictive license slip
into the installer.

## On-demand weights (downloaded by the user)

None of these are redistributed by this project. Sources are the publishers' official
repositories on Hugging Face / ModelScope (plus GitHub Releases for a few k2-fsa models),
with a ModelScope mirror preferred on networks where Hugging Face is slow. The MeanVC2
package has a project-operated, byte-identical ModelScope mirror
(`ailm32442/meanvc2-onnx`) so mainland downloads do not depend on Hugging Face; the mirror
keeps the upstream Apache-2.0 / CC BY-SA 3.0 terms and the CC BY-SA `NOTICE`.

### Speech and captions

| Model id | License | Upstream |
|---|---|---|
| `sense-voice-int8` | Apache-2.0 | FunAudioLLM SenseVoice (Alibaba); ONNX via `k2-fsa/sherpa-onnx` |
| `whisper-base-int8`, `whisper-small-int8` | MIT | OpenAI Whisper; ONNX via `k2-fsa/sherpa-onnx` |
| `paraformer-zh-small-int8`, `paraformer-trilingual-int8` | Apache-2.0 | FunASR Paraformer (Alibaba); ONNX via `k2-fsa/sherpa-onnx` |
| `qwen3-aligner-0.6b-q4` | Apache-2.0 | Qwen3 forced aligner (Alibaba); ONNX export (`valoomba/...`, mirrored) |

### Audio tools

| Model id | License | Upstream |
|---|---|---|
| `htdemucs-ort-v1`, `htdemucs-6s` | MIT | Meta Demucs v4 (HTDemucs); ORT/ONNX exports |
| `uvr-mdx-voc-ft`, `uvr-mdx-9482` | **upstream terms — see below** | UVR / MDX-Net weights (`TRvlvr/model_repo`), redistributed by `k2-fsa/sherpa-onnx` |
| `moss-tts-nano`, `moss-audio-tokenizer-nano` | Apache-2.0 | MOSS TTS Nano (OpenMOSS) |
| `zipvoice-distill-int8-zh-en` | Apache-2.0 | ZipVoice (k2-fsa) |
| `meanvc2-int8` (转换图 + 音色编码器) | **Apache-2.0 + CC BY-SA 3.0** | MeanVC2 (ASLP-lab); ONNX export by `kiarina/MeanVC2-ONNX`; cn mirror `ailm32442/meanvc2-onnx` |

### Video post-production

| Model id | License | Upstream |
|---|---|---|
| `rife-v4.7` | MIT | RIFE (hzwer) |
| `realesr-x4plus` | BSD-3-Clause | Real-ESRGAN x4plus (Xintao Wang et al.) |

### Video generation

| Model id | License | Upstream |
|---|---|---|
| `wan21-t2v-1.3b`, `wan22-ti2v-5b`, `wan22-t2v-a14b` | Apache-2.0 | Wan2.1 / Wan2.2 (Alibaba); GGUF builds |
| `ltx-2.3`, `ltx-2.5` | **LTX-2 Community License** | Lightricks LTX-2 open weights |
| `hunyuan-video-1.5` | **Tencent Hunyuan Community License** | Tencent HunyuanVideo 1.5 |
| `minimax-h3`, `minimax-h3-ref2va` | **MiniMax-H3 Community License** | MiniMax H3 |

### Image generation

| Model id | License | Upstream |
|---|---|---|
| `flux1-schnell` | Apache-2.0 | Black Forest Labs FLUX.1 schnell |
| `flux1-kontext` | **FLUX.1 [dev] Non-Commercial License** | Black Forest Labs FLUX.1 Kontext dev |
| `qwen-image`, `qwen-image-edit` | Apache-2.0 | Qwen-Image / Qwen-Image-Edit (Alibaba) |
| `z-image-turbo` | Apache-2.0 | Z-Image Turbo (Tongyi) |
| `sd15-inpaint` | **CreativeML Open RAIL-M** | RunwayML Stable Diffusion 1.5 inpainting |
| `sdxl-base` | **CreativeML Open RAIL++-M** | Stability AI SDXL Base 1.0 |

## License classes

**Permissive — Apache-2.0 / MIT / BSD-3-Clause.** Everything not listed below. These may
be used commercially; attribution / license texts are kept in
`src-tauri/resources/models/LICENSES/` for the bundled ones.

**Community licenses — LTX-2, Tencent Hunyuan, MiniMax-H3.** These are *not* OSI
licenses. They grant broad use, including commercial use in many cases, but each one adds
its own acceptable-use rules, attribution duties and **commercial thresholds** (company
size / revenue / territory vary by license), and some require a separate commercial
license above those thresholds. MiniMax-H3 commercial licensing runs through MiniMax's
official channel (currently an official reseller). **Read the upstream license before
shipping anything commercial** — the thresholds are not uniform and change over time.

**CreativeML Open RAIL-M / ++-M — SD 1.5 inpainting, SDXL.** Commercial use is allowed,
but the license carries **use-based restrictions** (no illegal, harmful, deceptive or
discriminatory uses, among others) that must be passed on to anyone you distribute the
model or a derivative to. Keep those restrictions intact if you re-host or fine-tune.

**CC BY-SA 3.0 — MeanVC2 speaker encoder.** Commercial use is allowed, but adaptations
must be shared under the same license with attribution. The weights are redistributed
unmodified; `NOTICE` ships next to them in the mirror and records the upstream authors
(`kiarina/MeanVC2-ONNX`, `ASLP-lab/MeanVC2`).

**FLUX.1 [dev] Non-Commercial License — FLUX.1 Kontext.** The weights are licensed for
**non-commercial use only**. Whether and how outputs may be used commercially is defined
by the upstream license, not by this project — check it before any commercial release.

**UVR / MDX-Net weights.** The upstream model repository ships **no explicit license
file**; the project's own
[`UVR-NOTICE.txt`](src-tauri/resources/models/LICENSES/UVR-NOTICE.txt) records that
commercial use must be cleared with the upstream authors, and that the ONNX files must
keep their embedded metadata to remain usable.

## Outputs

- Video, audio and images you produce are yours; this project claims no ownership over
  them. Model licenses govern the weights; they may also add conditions on use or
  distribution of outputs (see the class notes above).
- You must hold the necessary rights to whatever you feed in (footage, music, voices,
  images). No model license grants rights to third-party material.
- **Cloud features** (cloud image/video generation, cloud TTS, OpenAI-compatible agents)
  are third-party services. Their terms and privacy policies apply to what you send them;
  they are not model weights and are not covered by this file.

## What this file does not cover

- **Execution runtimes.** ONNX Runtime (MIT) and the CUDA / cuDNN sets are software, not
  model weights; the app downloads them on demand and they keep their own licenses.
- **OFX plugins.** Plugins from the built-in registry or from your own disk are governed
  by each plugin's own license. GPL/AGPL entries are downloaded from their upstream
  releases — this project does not host or bundle them.
- **Cloud providers.** Cloud image/video generation, cloud TTS and OpenAI-compatible
  agents are third-party services with their own terms (see "Outputs").

## How the project keeps this honest

- **Bundle = permissive only.** `bundled_weights_keep_a_permissive_license` fails if a
  model with a community / RAIL / non-commercial license is added to `bundle.resources`.
- **Restricted weights are download-only.** They are never bundled into this repo or the
  installers; where a project mirror exists (MeanVC2), it is a byte-identical copy that
  keeps the upstream license and attribution.
- **Every download is verified** against the catalog's `sha256` (per-source hash where a
  mirror differs).
- **Every download URL is pinned to a commit**, never to `master` / `main`. A mutable
  branch lets an upstream re-upload turn our own hash check into a download failure
  ("100% then sha256 mismatch"), and the fallback source moves with it. Guarded by
  `every_source_is_pinned_to_a_commit` and two tools:

  | Command | What it does |
  |---|---|
  | `node tools/pin-models.mjs` | reports URLs still on a floating branch (exits 1) |
  | `node tools/pin-models.mjs --write` | pins them to the branch head commit |
  | `node tools/pin-models.mjs --bump` | moves pinned URLs to head — a deliberate model upgrade |
  | `node tools/check-models.mjs --deep` | fetches every pinned URL and compares the live `sha256` |
  | `node tools/check-models.mjs --proxy socks5h://127.0.0.1:7892` | same, through a proxy — Node's `fetch` ignores the OS proxy, so this is how you verify against the real HF (`MODEL_PROXY=` works too) |

  `pin-models.mjs` fixes the *revision*; `check-models.mjs` proves the bytes behind that
  revision are the ones we validated. Run both after touching the catalog.
  `HF_MIRROR=https://…` overrides the mirror used to reach Hugging Face.
- **The app shows the license** of each model in the Models pane, next to its size and
  source, before you download it.
- **Bundled license texts** are verbatim copies in `LICENSES/`.

## Redistributing AI Cut or building commercially

- Keep the source repository, installers and container images to the code plus the five
  bundled permissive models. Do not add on-demand weights to them.
- For a commercial product that relies on LTX-2, HunyuanVideo or MiniMax-H3, check the
  upstream thresholds first and obtain a commercial license where required.
- Do not use the FLUX.1 [dev] weights commercially; for a commercial image-editing
  product use `flux1-schnell` (Apache-2.0), `qwen-image-edit` (Apache-2.0) or a licensed
  FLUX build.
- Keep the RAIL use-based restrictions with any redistribution of SD 1.5 / SDXL weights.
- Clear UVR/MDX commercial use with the upstream authors.

## Verifying this list

- Catalog: [`src-tauri/src/models.rs`](src-tauri/src/models.rs) — one `ModelEntry` per
  model, with `license`, `bundled`, pinned hashes and source URLs.
- App: **Models** pane — size · license · source, per model.
- Bundled texts: [`src-tauri/resources/models/LICENSES/`](src-tauri/resources/models/LICENSES/).
- If a license here and a publisher's model card disagree, the model card wins — please
  open an issue so we can correct this file.

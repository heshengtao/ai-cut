/**
 * 朗读 / 翻译配音入口的「准备」向导：缺运行时、缺 TTS 模型、缺 MOSS 编解码器
 * 必须进同一个弹窗计划；选中云端服务时不检查本地模型。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useTtsSetup } from "@/composables/useAiSetup";
import {
  CLOUD_TTS,
  LOCAL_TTS,
  TTS_SETTINGS_ACTION,
  useTtsChoice,
} from "@/composables/useTtsChoice";
import { useDeviceStore } from "@/stores/device";
import { useModelChoiceStore } from "@/stores/modelChoice";
import { useModelsStore } from "@/stores/models";
import { useRuntimesStore } from "@/stores/runtimes";
import { useTtsStore } from "@/stores/tts";
import type { BackendInfo, BackendOption, DeviceProfile } from "@/types/agent";
import type { CloudTtsProvider, ModelStatus } from "@/types/models";
import type { RuntimeStatus } from "@/types/runtime";

function backendOption(overrides: Partial<BackendOption> = {}): BackendOption {
  return {
    kind: "cuda12",
    label: "CUDA 12",
    note: "",
    available: true,
    runtime: "cuda",
    runtime_installed: false,
    download_bytes: 160,
    missing: [],
    ...overrides,
  };
}

function cpuOption(): BackendOption {
  return backendOption({
    kind: "cpu",
    label: "CPU",
    runtime: "cpu",
    runtime_installed: true,
    download_bytes: 0,
  });
}

function backendInfo(options: BackendOption[], preference: BackendInfo["preference"]): BackendInfo {
  const device: DeviceProfile = { vendor: "nvidia", name: "RTX 4060", driver: "580.0" };
  return {
    preference,
    current: preference,
    recommended: preference,
    platform: "windows/x86_64",
    device,
    loaded_runtime: null,
    restart_required: false,
    ep_ready: false,
    options,
  };
}

function runtime(id: string, bytes: number, installed = false): RuntimeStatus {
  return {
    id,
    label: `runtime.${id}`,
    note: `runtime.${id}.note`,
    group: id.startsWith("cud") ? "cuda12" : "ort",
    core: !id.startsWith("cud"),
    bytes,
    installed,
    bundled: false,
    license: "MIT",
    dir: "",
  };
}

function ttsModel(installed: boolean): ModelStatus {
  return {
    id: "moss-tts-nano",
    name: "MOSS TTS Nano",
    feature: "tts",
    tag: "audio",
    license: "Apache-2.0",
    family: "moss_tts_nano",
    approx_bytes: 1000,
    recommended: true,
    bundled: false,
    bundle_eligible: false,
    installed,
    path: installed ? "C:/models/moss-tts-nano" : null,
    total_files: 2,
    installed_files: installed ? 2 : 0,
    reusable_bytes: 0,
    shared_bytes: 0,
    regions: ["cn"],
    sources: [],
    files: [
      { filename: "tts.onnx", approx_bytes: 600, installed, reusable: false, bytes: installed ? 600 : null },
      { filename: "tts.data", approx_bytes: 400, installed, reusable: false, bytes: installed ? 400 : null },
    ],
  };
}

function codecModel(installed: boolean): ModelStatus {
  return {
    id: "moss-audio-tokenizer-nano",
    name: "MOSS Audio Tokenizer",
    feature: "tts-codec",
    tag: "audio",
    license: "Apache-2.0",
    family: "moss_audio_tokenizer_nano",
    approx_bytes: 500,
    recommended: false,
    bundled: false,
    bundle_eligible: false,
    installed,
    path: installed ? "C:/models/codec" : null,
    total_files: 1,
    installed_files: installed ? 1 : 0,
    reusable_bytes: 0,
    shared_bytes: 0,
    regions: ["cn"],
    sources: [],
    files: [
      { filename: "codec.onnx", approx_bytes: 500, installed, reusable: false, bytes: installed ? 500 : null },
    ],
  };
}

function source(model: ModelStatus | null, codec: ModelStatus | null, cloud = false) {
  return () => ({ cloud, model, codec });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useTtsSetup", () => {
  it("缺运行时与 TTS / 编解码器时合成一个弹窗计划", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    const runtimes = useRuntimesStore();
    device.info = backendInfo([backendOption()], "cuda12");
    models.catalog = [ttsModel(false), codecModel(false)];
    runtimes.items = [
      runtime("cuda", 160),
      runtime("cudart", 3),
      runtime("cublas", 400),
      runtime("cufft", 200),
      runtime("cudnn", 1200),
    ];

    const setup = useTtsSetup(source(ttsModel(false), codecModel(false)), {
      feature: "tts",
      titleKey: "setup.title.voiceover",
    });
    expect(await setup.ensure()).toBe(false);
    expect(setup.open.value).toBe(true);

    const plan = setup.plan.value;
    expect(plan).not.toBeNull();
    expect(plan!.deps.map((dep) => dep.id)).toEqual([
      "cuda",
      "moss-tts-nano",
      "moss-audio-tokenizer-nano",
    ]);
    expect(plan!.restartAfter).toBe(true);
    expect(plan!.totalBytes).toBe(160 + 3 + 400 + 200 + 1200 + 600 + 400 + 500);
  });

  it("只缺模型时不把后端 / 重启塞进弹窗", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    device.info = backendInfo([cpuOption()], "cpu");
    models.catalog = [ttsModel(false), codecModel(false)];

    const setup = useTtsSetup(source(ttsModel(false), codecModel(false)), {
      feature: "tts-dub",
      titleKey: "setup.title.dub",
    });
    expect(await setup.ensure()).toBe(false);

    const plan = setup.plan.value;
    expect(plan!.deps.map((dep) => dep.id)).toEqual([
      "moss-tts-nano",
      "moss-audio-tokenizer-nano",
    ]);
    expect(plan!.totalBytes).toBe(1000 + 500);
    expect(plan!.backend).toBeNull();
    expect(plan!.restartAfter).toBe(false);
  });

  it("模型与运行时都齐了就直接返回，不弹窗", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    device.info = backendInfo([cpuOption()], "cpu");
    models.catalog = [ttsModel(true), codecModel(true)];

    const setup = useTtsSetup(source(ttsModel(true), codecModel(true)), {
      feature: "tts",
      titleKey: "setup.title.voiceover",
    });
    expect(await setup.ensure()).toBe(true);
    expect(setup.open.value).toBe(false);
  });

  it("选中云端服务时跳过本地运行时与模型检查", async () => {
    const device = useDeviceStore();
    const models = useModelsStore();
    device.info = backendInfo([backendOption()], "cuda12");
    models.catalog = [ttsModel(false), codecModel(false)];

    const setup = useTtsSetup(source(ttsModel(false), codecModel(false), true), {
      feature: "tts-dub",
      titleKey: "setup.title.dub",
    });
    expect(await setup.ensure()).toBe(true);
    expect(setup.open.value).toBe(false);
  });
});

describe("useTtsChoice", () => {
  function cloudProvider(): CloudTtsProvider {
    return {
      id: "eleven",
      name: "ElevenLabs",
      kind: "elevenlabs",
      enabled: true,
      base_url: "",
      api_key: "",
      api_secret: "",
      app_id: "",
      group_id: "",
      region: "",
      model: "",
      voice: "Rachel",
      format: "mp3",
      speed: 1,
      volume: 1,
      pitch: 0,
      voices: "",
      method: "POST",
      headers: "",
      body: "",
      audio_path: "",
    };
  }

  it("默认选已装本地模型；翻译配音与朗读各记各的选择", () => {
    const models = useModelsStore();
    const tts = useTtsStore();
    const choice = useModelChoiceStore();
    models.catalog = [ttsModel(true), codecModel(true)];
    tts.providers = [cloudProvider()];

    const dub = useTtsChoice("tts-dub");
    const voice = useTtsChoice("tts");

    expect(dub.selectedId.value).toBe(`${LOCAL_TTS}moss-tts-nano`);
    expect(dub.options.value[0]?.id).toBe(TTS_SETTINGS_ACTION);
    expect(dub.options.value.map((option) => option.id)).toEqual([
      TTS_SETTINGS_ACTION,
      `${LOCAL_TTS}moss-tts-nano`,
      `${CLOUD_TTS}eleven`,
    ]);

    dub.selectedId.value = `${CLOUD_TTS}eleven`;
    expect(choice.get("tts-dub")).toBe(`${CLOUD_TTS}eleven`);
    expect(choice.get("tts")).toBeNull();
    expect(voice.selectedId.value).toBe(`${LOCAL_TTS}moss-tts-nano`);
    expect(dub.provider.value?.name).toBe("ElevenLabs");
    expect(dub.ready.value).toBe(true);
  });
});

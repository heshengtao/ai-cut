<script setup lang="ts">
/**
 * **Hugging Face 授权框**：模型是 gated 仓库，匿名下载被 `403 GatedRepo` 挡住。
 *
 * 三步走，正好对应 HF 那边的流程：
 *   1. 「去同意许可」→ 打开仓库页（用户点 Agree and access repository）；
 *   2. 「创建 read token」→ 打开 HF 的 token 页（`tokenType=read`）；
 *   3. 把 token 粘进来 → 保存并重试刚才那次下载。
 *
 * 为什么必须让用户手动粘：HF 只对 OAuth 应用回传 token，桌面端应用没有 client_id；
 * 网页上点「同意」也不会把凭据交给第三方。token 存进本机配置，只发给 `huggingface.co`。
 */
import { computed, ref, watch } from "vue";
import ModalShell from "@/components/common/ModalShell.vue";
import { useModelsStore } from "@/stores/models";
import { invoke } from "@/platform/tauri";

const models = useModelsStore();
const token = ref("");
const saving = ref(false);
const failure = ref<string | null>(null);

const open = computed(() => models.pendingAuth !== null);
const auth = computed(() => models.pendingAuth?.auth ?? null);

/** 打开就清空上一次的输入 / 报错，避免「上次粘错的 token」留在框里。 */
watch(open, (value) => {
  if (value) {
    token.value = "";
    failure.value = null;
    saving.value = false;
  }
});

function close(): void {
  models.dismissAuth();
}

/** 用系统浏览器打开外链（后端只放行 http(s)）。 */
function openUrl(url: string | undefined): void {
  if (!url) return;
  void invoke("open_external_url", { url }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

function openPage(): void {
  openUrl(auth.value?.page_url);
}

function openTokenPage(): void {
  openUrl(auth.value?.token_url);
}

async function submit(): Promise<void> {
  const value = token.value.trim();
  if (!value || saving.value) return;
  saving.value = true;
  failure.value = null;
  try {
    await models.authorizeAndRetry(value);
  } catch (err) {
    // 重试仍失败（token 没该仓库权限 / 还没点同意）时留在框里，别把用户踢出去。
    failure.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.isComposing) void submit();
}
</script>

<template>
  <ModalShell :open="open" title="需要 Hugging Face 授权" width="480px" @update:open="close">
    <p class="message">
      <strong>{{ auth?.repo }}</strong> 是需要同意许可才能下载的仓库。先去网页上同意，再把
      read token 粘进来，就会接着下载。
    </p>

    <ol class="steps">
      <li>
        <button type="button" class="link" @click="openPage">{{ auth?.page_url }}</button>
        <span class="note">点「Agree and access repository」</span>
      </li>
      <li>
        <button type="button" class="link" @click="openTokenPage">创建 read token</button>
        <span class="note">新建一个 read 权限的 token 并复制</span>
      </li>
    </ol>

    <label class="field">
      <span class="label">Hugging Face read token</span>
      <input
        v-model="token"
        class="input"
        type="password"
        autocomplete="off"
        spellcheck="false"
        placeholder="hf_…"
        @keydown="onKey"
      />
    </label>

    <p v-if="failure" class="failure">{{ failure }}</p>
    <p class="hint">token 只保存在本机设置里，只发给 huggingface.co；随时可在 HF 上撤销。</p>

    <template #foot>
      <button type="button" class="btn-text" @click="close">取消</button>
      <button
        type="button"
        class="btn-filled"
        :disabled="!token.trim() || saving"
        @click="submit"
      >
        {{ saving ? "重试中…" : "保存并重试" }}
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.message {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: rgb(var(--md-on-surface-variant));
}
.steps {
  margin: 0 0 14px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant));
}
.link {
  border: 0;
  padding: 0;
  background: transparent;
  color: rgb(var(--md-primary));
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
  word-break: break-all;
}
.note {
  display: block;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.label {
  font-size: 12px;
  color: rgb(var(--md-on-surface-variant));
}
.input {
  height: 38px;
  padding: 0 12px;
  border: 1px solid rgb(var(--md-outline) / 0.5);
  border-radius: 10px;
  background-color: rgb(var(--md-surface-container-lowest, var(--app-card)));
  color: rgb(var(--md-on-surface));
  font-size: 13px;
  font-family: inherit;
}
.input:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 1px;
}
.failure {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--md-error));
}
.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--md-on-surface-variant) / 0.8);
}
.btn-text {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgb(var(--md-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.btn-filled {
  height: 36px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background-color: rgb(var(--md-primary));
  color: rgb(var(--md-on-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.btn-filled:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>

/**
 * 浏览器端的「文件框」：`<input type=file>` + 上传到 daemon。
 *
 * 桌面端仍走 Tauri 的原生对话框（`core/media.ts` 里分支）；这里只在 web 运行时使用。
 */
import { apiBase, withToken } from "./env";

/** 打开本地文件选择框；取消返回空数组。 */
export function pickLocalFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = "fixed";
    input.style.left = "-9999px";

    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(files);
    };
    // 文件框关闭后窗口会重新获得焦点；先给 change 一点时间。
    const onFocus = () => {
      window.setTimeout(() => finish(input.files ? Array.from(input.files) : []), 400);
    };

    input.addEventListener("change", () => {
      finish(input.files ? Array.from(input.files) : []);
    });
    window.addEventListener("focus", onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export interface UploadResult {
  path: string;
  bytes: number;
}

/** 把一个本地文件流式上传到 daemon 的 `<data>/imports/`，返回服务端路径。 */
export async function uploadLocalFile(file: File): Promise<string> {
  const response = await fetch(
    withToken(`${apiBase()}upload?name=${encodeURIComponent(file.name)}`),
    {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : `上传失败（${response.status}）`;
    throw new Error(message);
  }
  return String((data as UploadResult).path);
}

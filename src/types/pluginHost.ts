export interface PluginStatus {
  id: string;
  version: string;
  /** `linked`（本地目录）或 `store`（托管安装）。 */
  kind: "linked" | "store";
  enabled: boolean;
  /** 插件目录绝对路径。 */
  dir: string;
  /** 客户端半入口绝对路径；无客户端半时为 null。 */
  client: string | null;
  /** 宿主半入口绝对路径；无宿主半时为 null。 */
  hostFile: string | null;
  /** 版本 + 入口 mtime；变化即需要热替换。 */
  rev: string;
  compatible: boolean;
  lastError: string | null;
}

export interface PluginHostProgress {
  id: string;
  phase:
    | "resolving"
    | "downloading"
    | "verifying"
    | "extracting"
    | "installing"
    | "loading"
    | "done"
    | "error";
  message: string | null;
}

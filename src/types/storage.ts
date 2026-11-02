/** 应用数据目录（模型 / ONNX Runtime / OFX 插件 / 工程历史）的位置与迁移进度。 */

/** 目录来源：命令行 > 环境变量 > 设置页 > 安装器 > 系统默认。 */
export type DataDirSource = "cli" | "env" | "settings" | "installer" | "default";

export interface DataDirInfo {
  /** 本进程实际生效的数据目录。 */
  current: string;
  /** 系统默认数据目录（`%APPDATA%\com.aicut.editor`）。 */
  default: string;
  /** 当前缓存目录（可重建，迁移时会被跳过）。 */
  cache: string;
  source: DataDirSource;
  /** 数据目录已占用字节数（后台统计）。 */
  size_bytes: number;
  /** 由命令行 / 环境变量指定：设置页改不了。 */
  portable: boolean;
  /** 上一次迁移留下的旧目录（重启后可清理）。 */
  previous: string[];
  /** 指针里的新目录；与 `current` 不同 = 已迁移、等重启。 */
  next: string | null;
  /** 是否需要重启才能切到 `next`。 */
  restart_required: boolean;
  /** 数据目录是否在系统盘上（Windows）。 */
  on_system_drive: boolean;
}

export interface DataDirProgress {
  phase: "scan" | "copy" | "write" | "done";
  done: number;
  total: number;
  files: number;
  message: string | null;
}

export const EVENT_DATA_DIR = "data-dir-progress";

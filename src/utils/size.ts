/** 人类可读的体积格式。 */
export function humanSize(bytes: number): string {
  if (!(bytes > 0)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** 尚未下载的字节数（已安装文件不计入）。 */
export function missingBytes(model: {
  files: { approx_bytes: number; installed: boolean }[];
}): number {
  return model.files
    .filter((file) => !file.installed)
    .reduce((sum, file) => sum + file.approx_bytes, 0);
}

/**
 * 模型权重的**许可分级**：管理器用它决定卡片上那枚徽标，以及下载前要不要多问一句。
 *
 * 只按清单里后端下发的 `license` 字符串分档（与 `MODELS.md` 同一口径），不做法律判断：
 * - `permissive`   —— Apache-2.0 / MIT / BSD 等宽松许可，商用、随包都不需要额外提示；
 * - `community`    —— LTX-2 / 混元 / MiniMax-H3 这类「社区许可」：可商用但有门槛与
 *                     附加条件（署名、可接受使用、公司规模/营收等），需逐条核对上游；
 * - `rail`         —— CreativeML Open RAIL 系列：可商用，但使用限制必须随再分发传递；
 * - `sharealike`   —— CC BY-SA 这类相同方式共享：可商用，但演绎作品要按同许可分发并署名；
 * - `noncommercial`—— FLUX.1 [dev] 这类**仅限非商业**的权重；
 * - `upstream`     —— 上游没有明确许可（UVR / MDX），商用需自行与作者确认。
 */
export type LicenseTier =
  | "permissive"
  | "community"
  | "rail"
  | "sharealike"
  | "noncommercial"
  | "upstream";

/** 许可字符串 → 分级。认不出来的按「上游条款」处理（宁可多提示一句）。 */
export function licenseTier(license: string): LicenseTier {
  const value = license.trim().toLowerCase();
  if (value === "apache-2.0" || value === "mit" || value.startsWith("bsd-")) {
    return "permissive";
  }
  // 先判「非商业」：`FLUX.1 [dev] Non-Commercial License` 也含 "License"，但没有任何宽松信号。
  if (
    value.includes("non-commercial") ||
    value.includes("noncommercial") ||
    value.includes("by-nc")
  ) {
    return "noncommercial";
  }
  if (value.includes("rail")) return "rail";
  if (value.includes("cc-by-sa") || value.includes("by-sa")) return "sharealike";
  if (value.includes("community")) return "community";
  return "upstream";
}

/** 是否需要在界面上特别提示（宽松许可之外都算）。 */
export function isRestrictedLicense(license: string): boolean {
  return licenseTier(license) !== "permissive";
}

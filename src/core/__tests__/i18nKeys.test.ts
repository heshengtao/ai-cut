import { describe, expect, it } from "vitest";
import zh from "@/i18n/zh";
import en from "@/i18n/en";

const KEYS = [
  "panel.extensions",
  "panel.extensionsHint",
  "extensions.title",
  "extensions.subtitle",
  "extensions.empty",
  "extensions.install",
  "extensions.loading",
  "extensions.enable",
  "extensions.disable",
  "extensions.incompatible",
  "extensions.confirmRemove",
];

describe("extensions i18n keys", () => {
  for (const key of KEYS) {
    it(`has ${key} in both locales`, () => {
      expect(zh[key as keyof typeof zh]).toBeTruthy();
      expect(en[key as keyof typeof en]).toBeTruthy();
    });
  }
});

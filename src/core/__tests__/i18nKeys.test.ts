import { describe, expect, it } from "vitest";
import zh from "@/i18n/zh";
import en from "@/i18n/en";

const KEYS = [
  "panel.extensions",
  "panel.extensionsHint",
  "extensions.title",
  "extensions.subtitle",
  "extensions.subInstalled",
  "extensions.subDiscover",
  "extensions.empty",
  "extensions.install",
  "extensions.loading",
  "extensions.enable",
  "extensions.reload",
  "extensions.disable",
  "extensions.incompatible",
  "extensions.confirmRemove",
  "extensions.tabInstalled",
  "extensions.tabDiscover",
  "extensions.search",
  "extensions.refresh",
  "extensions.installFromMarket",
  "extensions.updateTo",
  "extensions.marketEmpty",
  "extensions.marketSource",
  "extensions.marketSourceSettings",
  "extensions.marketOnline",
  "extensions.marketCached",
  "extensions.marketStale",
  "extensions.marketUnknown",
  "extensions.marketUpdate",
  "extensions.marketInstalled",
  "extensions.enabled",
  "extensions.disabled",
  "extensions.kindStore",
  "extensions.kindLinked",
  "settings.market.group",
  "settings.market.url",
  "settings.market.urlHint",
  "settings.market.urlPlaceholder",
  "settings.market.saveHint",
  "settings.market.reset",
  "settings.market.save",
  "settings.market.saving",
  "settings.market.saved",
];

describe("extensions i18n keys", () => {
  for (const key of KEYS) {
    it(`has ${key} in both locales`, () => {
      expect(zh[key as keyof typeof zh]).toBeTruthy();
      expect(en[key as keyof typeof en]).toBeTruthy();
    });
  }
});

import { describe, expect, it } from "vitest";
import {
  parseSrt,
  parseSubtitleText,
  parseVtt,
  serializeSrt,
  serializeVtt,
  subtitleFormatFromPath,
} from "@/core/subtitleFile";

describe("subtitle parsing", () => {
  it("parses SRT with BOM, CRLF, tags and entities", () => {
    const srt = [
      "\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i> &amp; welcome\r\n",
      "2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond<br>line\r\n",
    ].join("\r\n");

    const entries = parseSrt(srt);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      start: 1,
      end: 2.5,
      text: "Hello & welcome",
    });
    expect(entries[1].text).toBe("Second\nline");
  });

  it("parses VTT with header, notes, settings and short timestamps", () => {
    const vtt = [
      "WEBVTT",
      "",
      "NOTE this is ignored",
      "",
      "00:01.000 --> 00:02.000 align:start position:0%",
      "Hi",
      "",
      "00:00:03.500 --> 00:00:04.000",
      "Bye",
    ].join("\n");

    const entries = parseVtt(vtt);
    expect(entries.map((entry) => entry.text)).toEqual(["Hi", "Bye"]);
    expect(entries[0]).toMatchObject({ start: 1, end: 2 });
  });

  it("skips malformed or empty cues", () => {
    const entries = parseSrt(
      ["1", "00:00:05,000 --> 00:00:04,000", "bad", "", "2", "nope", "x"].join("\n"),
    );
    expect(entries).toEqual([]);
  });

  it("detects format from path or content", () => {
    expect(subtitleFormatFromPath("/tmp/a.vtt")).toBe("vtt");
    expect(subtitleFormatFromPath("/tmp/a.srt")).toBe("srt");
    expect(parseSubtitleText("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx")).toHaveLength(1);
  });
});

describe("subtitle serialization", () => {
  const entries = [
    { start: 1.25, end: 2.5, text: "第一句" },
    { start: 3, end: 4, text: "第二句" },
  ];

  it("serializes SRT and round-trips", () => {
    const text = serializeSrt(entries);
    expect(text).toContain("00:00:01,250 --> 00:00:02,500");
    expect(parseSrt(text)).toEqual(entries);
  });

  it("serializes VTT and round-trips", () => {
    const text = serializeVtt(entries);
    expect(text.startsWith("WEBVTT")).toBe(true);
    expect(text).toContain("00:00:01.250 --> 00:00:02.500");
    expect(parseVtt(text)).toEqual(entries);
  });

  it("drops empty cues and fixes inverted ranges", () => {
    const text = serializeSrt([
      { start: 2, end: 1, text: "x" },
      { start: 3, end: 4, text: "   " },
    ]);
    const entries = parseSrt(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].end).toBeGreaterThan(entries[0].start);
  });
});

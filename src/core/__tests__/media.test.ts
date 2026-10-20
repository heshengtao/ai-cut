import { describe, expect, it } from "vitest";
import { baseName, kindFromPath } from "@/core/media";

describe("kindFromPath", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(kindFromPath("/a/b/clip.MP4")).toBe("video");
    expect(kindFromPath("/a/b/song.wav")).toBe("audio");
    expect(kindFromPath("/a/b/cover.PNG")).toBe("image");
    expect(kindFromPath("/a/b/motion.mov")).toBe("video");
    expect(kindFromPath("/a/b/loop.gif")).toBe("image");
  });

  it("returns null for unsupported extensions", () => {
    expect(kindFromPath("/a/b/notes.txt")).toBeNull();
    expect(kindFromPath("/a/b/noext")).toBeNull();
  });
});

describe("baseName", () => {
  it("handles posix and windows separators", () => {
    expect(baseName("/a/b/c.mp4")).toBe("c.mp4");
    expect(baseName("C:\\videos\\c.mp4")).toBe("c.mp4");
    expect(baseName("c.mp4")).toBe("c.mp4");
  });
});

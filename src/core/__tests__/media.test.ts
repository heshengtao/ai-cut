import { describe, expect, it } from "vitest";
import {
  baseName,
  extOf,
  kindFromPath,
  needsAudioProxy,
  needsVideoProxy,
} from "@/core/media";

describe("kindFromPath", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(kindFromPath("/a/b/clip.MP4")).toBe("video");
    expect(kindFromPath("/a/b/song.wav")).toBe("audio");
    expect(kindFromPath("/a/b/cover.PNG")).toBe("image");
    expect(kindFromPath("/a/b/motion.mov")).toBe("video");
    expect(kindFromPath("/a/b/loop.gif")).toBe("image");
  });

  it("covers mainstream containers", () => {
    expect(kindFromPath("/a/b/movie.mkv")).toBe("video");
    expect(kindFromPath("/a/b/camera.m2ts")).toBe("video");
    expect(kindFromPath("/a/b/old.avi")).toBe("video");
    expect(kindFromPath("/a/b/song.wma")).toBe("audio");
    expect(kindFromPath("/a/b/song.ape")).toBe("audio");
    expect(kindFromPath("/a/b/logo.svg")).toBe("image");
    expect(kindFromPath("/a/b/photo.tif")).toBe("image");
  });

  it("returns null for unsupported extensions", () => {
    expect(kindFromPath("/a/b/notes.txt")).toBeNull();
    expect(kindFromPath("/a/b/noext")).toBeNull();
  });
});

describe("preview policy", () => {
  it("only lets the webview play the common containers directly", () => {
    expect(needsVideoProxy("/a/b/clip.mp4")).toBe(false);
    expect(needsVideoProxy("/a/b/clip.mov")).toBe(false);
    expect(needsVideoProxy("/a/b/clip.mkv")).toBe(true);
    expect(needsVideoProxy("/a/b/clip.avi")).toBe(true);
  });

  it("extracts audio from every video and from exotic audio formats", () => {
    expect(needsAudioProxy("video", "/a/b/clip.mp4")).toBe(true);
    expect(needsAudioProxy("video", "/a/b/clip.mov")).toBe(true);
    expect(needsAudioProxy("audio", "/a/b/song.mp3")).toBe(false);
    expect(needsAudioProxy("audio", "/a/b/song.wav")).toBe(false);
    expect(needsAudioProxy("audio", "/a/b/song.wma")).toBe(true);
    expect(needsAudioProxy("image", "/a/b/cover.png")).toBe(false);
  });
});

describe("baseName", () => {
  it("handles posix and windows separators", () => {
    expect(baseName("/a/b/c.mp4")).toBe("c.mp4");
    expect(baseName("C:\\videos\\c.mp4")).toBe("c.mp4");
    expect(baseName("c.mp4")).toBe("c.mp4");
  });
});

describe("extOf", () => {
  it("returns a lowercase extension or an empty string", () => {
    expect(extOf("/a/b/Clip.MOV")).toBe("mov");
    expect(extOf("/a/b/noext")).toBe("");
    expect(extOf("/a/b/.hidden")).toBe("");
    expect(extOf("/a/b/trailing.")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { checkPackagePath } from "../src/paths";

describe("checkPackagePath", () => {
  it.each([
    "manifest.json",
    "media/introduction.mp4",
    "assets/captions-en.vtt",
    "folder with spaces/clip.mp4",
    "ünï/clip.mp4",
    "%2e%2e/literal-percent.mp4", // never percent-decoded, so just a file name
    "...hidden/clip.mp4", // leading dots are fine; only a trailing dot is rejected
  ])("accepts %j", (path) => {
    expect(checkPackagePath(path).ok).toBe(true);
  });

  it.each([
    ["../outside.mp4", "traversal"],
    ["media/../../outside.mp4", "traversal"],
    ["media/./clip.mp4", "dot segment"],
    ["..", "bare parent"],
    [".", "bare dot"],
    ["/etc/passwd", "absolute"],
    ["C:/Windows/system.ini", "drive letter"],
    ["c:relative.mp4", "drive letter, no slash"],
    ["C:\\Windows\\system.ini", "drive letter, backslash"],
    ["\\\\server\\share\\clip.mp4", "UNC"],
    ["//server/share/clip.mp4", "UNC with forward slashes"],
    ["media\\clip.mp4", "backslash"],
    ["media//clip.mp4", "empty segment"],
    ["media/", "trailing slash"],
    ["", "empty"],
    ["media/clip\u0000.mp4", "NUL byte"],
    ["media/clip\n.mp4", "newline"],
    ["media/clip.mp4:stream", "NTFS alternate data stream"],
    ["media/clip.", "trailing dot"],
    ["media/clip ", "trailing space"],
  ])("rejects %j (%s) as unsafe", (path) => {
    const result = checkPackagePath(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IVF_UNSAFE_PATH");
  });

  it.each([
    "https://example.com/clip.mp4",
    "http://127.0.0.1/clip.mp4",
    "file:///etc/passwd",
    "data:video/mp4;base64,AAAA",
    "javascript:alert(1)",
  ])("reports remote or URL-like %j as an unsupported feature", (path) => {
    const result = checkPackagePath(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IVF_UNSUPPORTED_FEATURE");
  });

  it.each([5, null, undefined, {}, ["a"]])("rejects non-string %j", (value) => {
    expect(checkPackagePath(value).ok).toBe(false);
  });

  it("rejects over-long paths with the limit code", () => {
    const result = checkPackagePath("a/".repeat(600) + "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("IVF_LIMIT_EXCEEDED");
  });

  it("returns the NFC form so decomposed and composed names are the same path", () => {
    const decomposed = checkPackagePath("media/e\u0301.mp4");
    const composed = checkPackagePath("media/\u00e9.mp4");
    expect(decomposed.ok && composed.ok).toBe(true);
    if (decomposed.ok && composed.ok) {
      expect(decomposed.path).toBe(composed.path);
      expect(decomposed.key).toBe(composed.key);
    }
  });

  it("gives case-variants the same duplicate key", () => {
    const a = checkPackagePath("Media/Clip.MP4");
    const b = checkPackagePath("media/clip.mp4");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.key).toBe(b.key);
      expect(a.path).not.toBe(b.path); // lookups stay case-sensitive
    }
  });
});

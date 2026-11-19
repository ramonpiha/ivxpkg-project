import { describe, expect, it } from "vitest";
import { validateArchiveEntries, type ArchiveEntry } from "../src/entries";
import { LIMITS } from "../src/limits";

const file = (path: string): ArchiveEntry => ({ path, kind: "file" });
const dir = (path: string): ArchiveEntry => ({ path, kind: "directory" });

function codesOf(entries: ArchiveEntry[]): string[] {
  const result = validateArchiveEntries(entries);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

describe("validateArchiveEntries", () => {
  it("accepts a normal package layout and returns normalized file paths", () => {
    const result = validateArchiveEntries([
      file("manifest.json"),
      dir("media/"),
      file("media/introduction.mp4"),
      dir("assets/"),
      file("assets/poster.png"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.value.files].sort()).toEqual([
        "assets/poster.png",
        "manifest.json",
        "media/introduction.mp4",
      ]);
    }
  });

  it("rejects an archive without manifest.json", () => {
    expect(codesOf([file("media/a.mp4")])).toContain("IVF_MANIFEST_MISSING");
  });

  it("does not accept a manifest that is not at the root", () => {
    expect(codesOf([file("sub/manifest.json")])).toContain("IVF_MANIFEST_MISSING");
  });

  it("does not treat a differently-cased manifest name as the manifest", () => {
    expect(codesOf([file("Manifest.json")])).toContain("IVF_MANIFEST_MISSING");
  });

  it.each(["../evil.mp4", "media/../../evil.mp4"])("rejects traversal entry %j", (path) => {
    expect(codesOf([file("manifest.json"), file(path)])).toContain("IVF_UNSAFE_PATH");
  });

  it.each(["/abs.mp4", "C:/abs.mp4", "\\\\server\\share\\x.mp4"])("rejects absolute-style entry %j", (path) => {
    expect(codesOf([file("manifest.json"), file(path)])).toContain("IVF_UNSAFE_PATH");
  });

  it("rejects duplicate paths", () => {
    expect(codesOf([file("manifest.json"), file("a.mp4"), file("a.mp4")])).toContain("IVF_UNSAFE_PATH");
  });

  it("rejects paths that differ only by case", () => {
    expect(codesOf([file("manifest.json"), file("A.mp4"), file("a.mp4")])).toContain("IVF_UNSAFE_PATH");
  });

  it("rejects paths that differ only by Unicode normalization", () => {
    expect(codesOf([file("manifest.json"), file("e\u0301.mp4"), file("\u00e9.mp4")])).toContain(
      "IVF_UNSAFE_PATH",
    );
  });

  it("rejects a file and a directory with the same name", () => {
    expect(codesOf([file("manifest.json"), file("media"), dir("media/")])).toContain("IVF_UNSAFE_PATH");
  });

  it("rejects a file nested under another file", () => {
    expect(codesOf([file("manifest.json"), file("media"), file("media/a.mp4")])).toContain("IVF_UNSAFE_PATH");
  });

  it("rejects symbolic links and special entries", () => {
    expect(codesOf([file("manifest.json"), { path: "link", kind: "symlink" }])).toContain(
      "IVF_INVALID_ARCHIVE",
    );
    expect(codesOf([file("manifest.json"), { path: "dev", kind: "other" }])).toContain("IVF_INVALID_ARCHIVE");
  });

  it("rejects a trailing-slash path that is not a directory entry", () => {
    expect(codesOf([file("manifest.json"), file("media/")])).toContain("IVF_UNSAFE_PATH");
  });

  it("rejects too many entries without inspecting them", () => {
    const entries = [file("manifest.json")];
    for (let i = 0; i < LIMITS.maxArchiveEntries; i++) entries.push(file(`f${i}.bin`));
    expect(entries.length).toBe(LIMITS.maxArchiveEntries + 1);
    expect(codesOf(entries)).toEqual(["IVF_LIMIT_EXCEEDED"]);
  });

  it("accepts exactly the maximum number of entries", () => {
    const entries = [file("manifest.json")];
    for (let i = 1; i < LIMITS.maxArchiveEntries; i++) entries.push(file(`f${i}.bin`));
    expect(validateArchiveEntries(entries).ok).toBe(true);
  });

  it("caps the number of reported issues", () => {
    const entries = [file("manifest.json")];
    for (let i = 0; i < 400; i++) entries.push(file(`../bad${i}`));
    const result = validateArchiveEntries(entries);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBe(LIMITS.maxReportedIssues);
  });
});

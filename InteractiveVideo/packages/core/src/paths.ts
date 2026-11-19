import type { IvfErrorCode } from "./errors";
import { LIMITS } from "./limits";

export type PathCheck =
  | {
      ok: true;
      /** NFC-normalized path. Use THIS form for every archive lookup. */
      path: string;
      /** Case-folded form, used only to detect duplicates on case-insensitive systems. */
      key: string;
    }
  | { ok: false; code: Extract<IvfErrorCode, "IVF_UNSAFE_PATH" | "IVF_LIMIT_EXCEEDED" | "IVF_UNSUPPORTED_FEATURE">; reason: string };

const bad = (reason: string): PathCheck => ({ ok: false, code: "IVF_UNSAFE_PATH", reason });

const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");
const DRIVE_LETTER = /^[A-Za-z]:/;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Checks a package-internal path (spec 5.2). Pure string logic, no filesystem access.
 *
 * Rejects: absolute, drive-letter, UNC, backslash, traversal ("." / ".." / empty
 * segments), control characters, colons (NTFS alternate streams), segments that
 * end in "." or space (Windows strips them), and over-long paths.
 * URL-like values ("https://...") are reported as an unsupported feature, since
 * remote resources are out of scope for 0.1.
 *
 * Paths are never percent-decoded: "%2e%2e" is just a literal file name.
 */
export function checkPackagePath(raw: unknown): PathCheck {
  if (typeof raw !== "string") return bad("path is not a string");
  if (raw.length === 0) return bad("path is empty");
  if (raw.length > LIMITS.maxPathLength) {
    return { ok: false, code: "IVF_LIMIT_EXCEEDED", reason: "path is too long" };
  }
  if (CONTROL_CHARS.test(raw)) return bad("path contains control characters");
  if (raw.includes("\\")) return bad("path contains a backslash");
  if (raw.startsWith("//")) return bad("UNC or protocol-relative path");
  if (raw.startsWith("/")) return bad("absolute path");
  if (DRIVE_LETTER.test(raw)) return bad("drive-letter path");
  if (URL_SCHEME.test(raw)) {
    return { ok: false, code: "IVF_UNSUPPORTED_FEATURE", reason: "remote resources are not supported" };
  }
  if (raw.includes(":")) return bad("path contains a colon");

  const path = raw.normalize("NFC");
  for (const segment of path.split("/")) {
    if (segment === "") return bad("empty path segment");
    if (segment === "." || segment === "..") return bad("traversal segment");
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return bad("segment ends with a dot or space");
    }
  }
  return { ok: true, path, key: path.toLowerCase() };
}

import { IssueCollector, type ValidationResult } from "./errors";
import { LIMITS } from "./limits";
import { checkPackagePath } from "./paths";

export type ArchiveEntryKind = "file" | "directory" | "symlink" | "other";

/** What the archive reader reports about each entry, before any data is read. */
export interface ArchiveEntry {
  /** Path exactly as stored in the archive. Directory entries may end in "/". */
  path: string;
  kind: ArchiveEntryKind;
}

export interface ValidatedEntries {
  /** NFC-normalized paths of all file entries. */
  files: ReadonlySet<string>;
}

export const MANIFEST_PATH = "manifest.json";

/**
 * Validates the archive's entry list (spec 5.2 and 9.2): count limit, entry types,
 * path safety, duplicate paths, file/directory collisions, and manifest.json at the root.
 * Operates on metadata only; reading and size-checking file data is the archive reader's job.
 */
export function validateArchiveEntries(
  entries: readonly ArchiveEntry[],
): ValidationResult<ValidatedEntries> {
  const found = new IssueCollector();

  // Fail closed before iterating over a hostile number of entries.
  if (entries.length > LIMITS.maxArchiveEntries) {
    found.add("IVF_LIMIT_EXCEEDED", "Archive has too many entries.");
    return { ok: false, issues: found.issues };
  }

  const seen = new Set<string>();
  const files = new Set<string>();
  const fileKeys = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === "symlink" || entry.kind === "other") {
      found.add("IVF_INVALID_ARCHIVE", "Symbolic links and special entries are not supported.", entry.path);
      continue;
    }

    let rawPath = entry.path;
    if (entry.kind === "directory") {
      if (rawPath.endsWith("/")) rawPath = rawPath.slice(0, -1);
    }
    const checked = checkPackagePath(rawPath);
    if (!checked.ok) {
      found.add(checked.code, `Unsafe archive entry: ${checked.reason}.`, entry.path);
      continue;
    }

    if (seen.has(checked.key)) {
      found.add("IVF_UNSAFE_PATH", "Duplicate archive path.", entry.path);
      continue;
    }
    seen.add(checked.key);

    if (entry.kind === "file") {
      fileKeys.add(checked.key);
      files.add(checked.path);
    }
  }

  // A file cannot also act as a directory: "a" and "a/b".
  for (const key of fileKeys) {
    let slash = key.indexOf("/");
    while (slash !== -1) {
      if (fileKeys.has(key.slice(0, slash))) {
        found.add("IVF_UNSAFE_PATH", "A file path collides with a directory path.", key);
        break;
      }
      slash = key.indexOf("/", slash + 1);
    }
  }

  if (!files.has(MANIFEST_PATH)) {
    found.add("IVF_MANIFEST_MISSING", "manifest.json was not found at the archive root.");
  }

  if (found.hasIssues) return { ok: false, issues: found.issues };
  return { ok: true, value: { files }, warnings: [] };
}

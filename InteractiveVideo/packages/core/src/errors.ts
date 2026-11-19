import { LIMITS } from "./limits";

/** Error categories from spec section 11. */
export const IVF_ERROR_CODES = [
  "IVF_INVALID_ARCHIVE",
  "IVF_LIMIT_EXCEEDED",
  "IVF_MANIFEST_MISSING",
  "IVF_MANIFEST_INVALID",
  "IVF_UNSUPPORTED_VERSION",
  "IVF_UNSAFE_PATH",
  "IVF_ASSET_MISSING",
  "IVF_INVALID_SCENE",
  "IVF_UNSUPPORTED_FEATURE",
  "IVF_MEDIA_ERROR",
] as const;

export type IvfErrorCode = (typeof IVF_ERROR_CODES)[number];

export interface ValidationIssue {
  code: IvfErrorCode;
  /** Safe, generic text. Never echoes large package-controlled strings. */
  message: string;
  /** JSON pointer into the manifest, or an archive entry path. Truncated. */
  location?: string;
}

export interface ValidationWarning {
  code: "IVF_WARN_UNREACHABLE_SCENE";
  message: string;
  location?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: ValidationWarning[] }
  | { ok: false; issues: ValidationIssue[] };

const MAX_LOCATION_LENGTH = 200;

export function issue(code: IvfErrorCode, message: string, location?: string): ValidationIssue {
  return location === undefined
    ? { code, message }
    : { code, message, location: location.slice(0, MAX_LOCATION_LENGTH) };
}

export function failure(
  code: IvfErrorCode,
  message: string,
  location?: string,
): { ok: false; issues: ValidationIssue[] } {
  return { ok: false, issues: [issue(code, message, location)] };
}

/** Collects issues but stops growing at LIMITS.maxReportedIssues (bounded memory). */
export class IssueCollector {
  readonly issues: ValidationIssue[] = [];

  add(code: IvfErrorCode, message: string, location?: string): void {
    if (this.issues.length < LIMITS.maxReportedIssues) {
      this.issues.push(issue(code, message, location));
    }
  }

  get hasIssues(): boolean {
    return this.issues.length > 0;
  }

  get isFull(): boolean {
    return this.issues.length >= LIMITS.maxReportedIssues;
  }
}

import { Validator, type OutputUnit, type Schema } from "@cfworker/json-schema";
import {
  IssueCollector,
  failure,
  type ValidationIssue,
  type ValidationResult,
  type ValidationWarning,
} from "./errors";
import { LIMITS } from "./limits";
import { checkPackagePath } from "./paths";
import manifestSchema from "./schema/ivf-manifest-0.1.schema.json" with { type: "json" };

export const SUPPORTED_FORMAT_VERSION = "0.1";

export interface ChoiceOption {
  label: string;
  next_scene: string;
}

export interface ChoiceInteraction {
  id: string;
  at_seconds: number;
  type: "choice";
  prompt: string;
  options: ChoiceOption[];
}

export interface Scene {
  video: string;
  interactions: ChoiceInteraction[];
}

export interface IvfManifest {
  format: "IVF";
  format_version: "0.1";
  title: string;
  entry_scene: string;
  scenes: Record<string, Scene>;
}

export interface ValidateManifestOptions {
  /**
   * Normalized file paths present in the archive (from validateArchiveEntries).
   * When given, every referenced asset must exist in it.
   */
  archiveFiles?: ReadonlySet<string>;
}

// No code generation or eval: this validator interprets the schema directly,
// which keeps the player compatible with a strict Content Security Policy.
// shortCircuit=true stops at the first failure, so hostile input cannot
// produce an unbounded error list.
const schemaValidator = new Validator(manifestSchema as Schema, "2020-12", true);

/**
 * Returns the maximum container nesting depth of a JSON text, stopping early once
 * `limit` is exceeded. Runs BEFORE JSON.parse so deeply nested input never
 * reaches the parser. Understands strings and escapes.
 */
export function jsonNestingDepth(text: string, limit: number): number {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c) escaped = true; // backslash
      else if (c === 0x22) inString = false; // quote
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
      if (maxDepth > limit) return maxDepth;
    } else if (c === 0x7d || c === 0x5d) depth--;
  }
  return maxDepth;
}

function hasDuplicateJsonKeys(text: string): boolean {
  let offset = 0;
  const skipWhitespace = (): void => {
    while (text[offset] === " " || text[offset] === "\t" || text[offset] === "\n" || text[offset] === "\r") {
      offset++;
    }
  };

  const parseString = (): string | undefined => {
    if (text[offset] !== '"') return undefined;
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === "\\") {
        offset++;
      } else if (character === '"') {
        try {
          const value: unknown = JSON.parse(text.slice(start, offset));
          return typeof value === "string" ? value : undefined;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  };

  const parseValue = (): boolean => {
    skipWhitespace();
    if (text[offset] === "{") return parseObject();
    if (text[offset] === "[") {
      offset++;
      skipWhitespace();
      if (text[offset] === "]") {
        offset++;
        return false;
      }
      while (offset < text.length) {
        if (parseValue()) return true;
        skipWhitespace();
        if (text[offset] === "]") {
          offset++;
          return false;
        }
        if (text[offset] !== ",") return false;
        offset++;
      }
      return false;
    }
    if (text[offset] === '"') {
      parseString();
      return false;
    }
    while (offset < text.length && !/[\s,[\]{}]/.test(text[offset] ?? "")) offset++;
    return false;
  };

  const parseObject = (): boolean => {
    offset++;
    const keys = new Set<string>();
    skipWhitespace();
    if (text[offset] === "}") {
      offset++;
      return false;
    }
    while (offset < text.length) {
      skipWhitespace();
      const key = parseString();
      if (key === undefined) return false;
      if (keys.has(key)) return true;
      keys.add(key);
      skipWhitespace();
      if (text[offset] !== ":") return false;
      offset++;
      if (parseValue()) return true;
      skipWhitespace();
      if (text[offset] === "}") {
        offset++;
        return false;
      }
      if (text[offset] !== ",") return false;
      offset++;
    }
    return false;
  };

  return parseValue();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointer(instanceLocation: string): string {
  return instanceLocation.startsWith("#") ? instanceLocation.slice(1) : instanceLocation;
}

/** Maps the first (innermost) schema failure to a spec section 11 error code. */
function mapSchemaError(unit: OutputUnit): ValidationIssue {
  const location = pointer(unit.instanceLocation);
  const base = (code: ValidationIssue["code"], message: string): ValidationIssue => ({
    code,
    message,
    location: location.slice(0, 200),
  });

  switch (unit.keyword) {
    case "maxLength":
    case "maxItems":
    case "maxProperties":
      return base("IVF_LIMIT_EXCEEDED", "A manifest size limit was exceeded.");
    case "const":
      if (/\/interactions\/\d+\/type$/.test(location)) {
        return base("IVF_UNSUPPORTED_FEATURE", "Unsupported interaction type.");
      }
      return base("IVF_MANIFEST_INVALID", "Manifest field has an unsupported value.");
    case "false": // a property rejected by `additionalProperties: false`
    case "additionalProperties":
      return base("IVF_MANIFEST_INVALID", "Manifest contains an unknown field.");
    case "required":
      return base("IVF_MANIFEST_INVALID", "Manifest is missing a required field.");
    default:
      return base("IVF_MANIFEST_INVALID", "Manifest does not match the schema.");
  }
}

function hasScene(scenes: Record<string, Scene>, id: string): boolean {
  // Own-property check: ids like "constructor" must not resolve via the prototype chain.
  return Object.hasOwn(scenes, id);
}

/** Rules JSON Schema cannot express: references, uniqueness, paths, totals. */
function checkSemantics(
  manifest: IvfManifest,
  options: ValidateManifestOptions,
): { issues: ValidationIssue[]; warnings: ValidationWarning[] } {
  const found = new IssueCollector();
  const warnings: ValidationWarning[] = [];
  const { scenes } = manifest;

  let totalInteractions = 0;
  for (const scene of Object.values(scenes)) totalInteractions += scene.interactions.length;
  if (totalInteractions > LIMITS.maxTotalInteractions) {
    found.add("IVF_LIMIT_EXCEEDED", "Too many interactions in total.");
    return { issues: found.issues, warnings };
  }

  if (!hasScene(scenes, manifest.entry_scene)) {
    found.add("IVF_INVALID_SCENE", "entry_scene does not match any scene.", "/entry_scene");
  }

  for (const [sceneId, scene] of Object.entries(scenes)) {
    const sceneLoc = `/scenes/${sceneId}`;

    const video = checkPackagePath(scene.video);
    if (!video.ok) {
      found.add(video.code, `Invalid video path: ${video.reason}.`, `${sceneLoc}/video`);
    } else {
      scene.video = video.path; // from here on, only the normalized form is used
      if (options.archiveFiles && !options.archiveFiles.has(video.path)) {
        found.add("IVF_ASSET_MISSING", "Referenced video is not in the package.", `${sceneLoc}/video`);
      }
    }

    const ids = new Set<string>();
    const times = new Set<number>();
    scene.interactions.forEach((interaction, index) => {
      const loc = `${sceneLoc}/interactions/${index}`;
      if (ids.has(interaction.id)) {
        found.add("IVF_MANIFEST_INVALID", "Duplicate interaction id within a scene.", `${loc}/id`);
      }
      ids.add(interaction.id);

      if (times.has(interaction.at_seconds)) {
        found.add("IVF_MANIFEST_INVALID", "Two interactions share the same timestamp.", `${loc}/at_seconds`);
      }
      times.add(interaction.at_seconds);

      interaction.options.forEach((option, optionIndex) => {
        if (!hasScene(scenes, option.next_scene)) {
          found.add(
            "IVF_INVALID_SCENE",
            "Option points to a scene that does not exist.",
            `${loc}/options/${optionIndex}/next_scene`,
          );
        }
      });
    });
  }

  if (!found.hasIssues) {
    const reachable = new Set<string>([manifest.entry_scene]);
    const queue = [manifest.entry_scene];
    while (queue.length > 0) {
      const current = scenes[queue.pop() as string];
      for (const interaction of current?.interactions ?? []) {
        for (const option of interaction.options) {
          if (!reachable.has(option.next_scene)) {
            reachable.add(option.next_scene);
            queue.push(option.next_scene);
          }
        }
      }
    }
    for (const sceneId of Object.keys(scenes)) {
      if (!reachable.has(sceneId)) {
        warnings.push({
          code: "IVF_WARN_UNREACHABLE_SCENE",
          message: "Scene cannot be reached from entry_scene.",
          location: `/scenes/${sceneId}`.slice(0, 200),
        });
      }
    }
  }

  return { issues: found.issues, warnings };
}

/**
 * Validates manifest.json bytes end to end (spec 7.1 steps 4-6):
 * size limit, UTF-8, nesting depth, JSON parse, version check, schema, semantics.
 * Never throws for bad input; returns issues instead.
 *
 * On success, `value.scenes[*].video` holds the NFC-normalized path.
 */
export function validateManifest(
  input: Uint8Array | string,
  options: ValidateManifestOptions = {},
): ValidationResult<IvfManifest> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > LIMITS.maxManifestBytes) {
    return failure("IVF_LIMIT_EXCEEDED", "manifest.json is too large.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure("IVF_MANIFEST_INVALID", "manifest.json is not valid UTF-8.");
  }

  if (jsonNestingDepth(text, LIMITS.maxJsonNestingDepth) > LIMITS.maxJsonNestingDepth) {
    return failure("IVF_LIMIT_EXCEEDED", "manifest.json is nested too deeply.");
  }
  if (hasDuplicateJsonKeys(text)) {
    return failure("IVF_MANIFEST_INVALID", "manifest.json contains duplicate object keys.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return failure("IVF_MANIFEST_INVALID", "manifest.json is not valid JSON.");
  }
  if (!isPlainObject(parsed)) {
    return failure("IVF_MANIFEST_INVALID", "manifest.json must contain a JSON object.");
  }

  // Version gate: identify the version before interpreting anything else (spec 10).
  if (parsed["format"] !== "IVF") {
    return failure("IVF_MANIFEST_INVALID", "Not an IVF manifest.", "/format");
  }
  if (typeof parsed["format_version"] === "string" && parsed["format_version"] !== SUPPORTED_FORMAT_VERSION) {
    return failure("IVF_UNSUPPORTED_VERSION", "Unsupported IVF format version.", "/format_version");
  }

  const schemaResult = schemaValidator.validate(parsed);
  if (!schemaResult.valid) {
    // The validator lists errors outer-first; the last one is the rule that actually failed.
    const leaf = schemaResult.errors[schemaResult.errors.length - 1];
    return {
      ok: false,
      issues: [
        leaf
          ? mapSchemaError(leaf)
          : { code: "IVF_MANIFEST_INVALID", message: "Manifest does not match the schema." },
      ],
    };
  }

  const manifest = parsed as unknown as IvfManifest;
  const { issues, warnings } = checkSemantics(manifest, options);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: manifest, warnings };
}

# Instructions for AI assistants working on IVF

IVF (Interactive Video Format) is a package format for interactive video: a ZIP archive
with a `manifest.json` that describes scenes, timeline interactions and branching, plus
the media files. This repository holds the reader/player, the validation core and, later,
the authoring tool (Studio).

The specification is `docs/IVF_SPECIFICATION_0_1.md`. It is the source of truth. If code and
spec disagree, say so and ask which one should change. Do not silently pick one.

## Core security rule

Every package, and every field inside it, is **untrusted input**. The player is trusted code.
The package describes permitted behaviour; it never contains programs to execute.

Never:

- use `eval`, `new Function`, `setTimeout`/`setInterval` with a string, or any library that
  generates code at runtime (this is why the project uses `@cfworker/json-schema` and not Ajv)
- render package text with `innerHTML`, `dangerouslySetInnerHTML` or similar. Use text nodes / `textContent`
- load remote resources (URLs, scripts, fonts, frames, images) or add telemetry or network calls
- extract package files to the filesystem; read them from the archive in memory
- percent-decode, URL-decode or otherwise reinterpret package paths
- trust archive metadata for sizes. Count the bytes actually decompressed
- look up user- or package-controlled keys on plain objects without `Object.hasOwn`
  (ids like `constructor` or `__proto__` must not resolve through the prototype chain)
- echo large package-controlled strings into error messages

Fail closed: if validation is incomplete or something is unexpected, reject the package.
Errors must be clear but must not expose internals.

## Platform strategy

IVF is a desktop app built on Tauri. Windows is the first tested target, but code must stay
cross-platform (macOS and Linux later): no hard-coded Windows paths or separators, no shelling out,
no OS-specific APIs outside the Tauri native layer. There is no browser deployment target.
Keep the Rust/native layer thin (file access and window handling); parsing and validation of untrusted
package data stays in `packages/core`, and the native layer exposes only narrow, validated commands.
Tauri uses each OS's own webview, so video codec support differs per OS; flag anything that assumes
a specific codec or platform.

## Repository layout

```
packages/core   Format core: limits, error codes, JSON Schema, validators.
                No DOM, React, Node-only or OS-specific APIs in src/ (it runs inside the Tauri webview).
apps/           Desktop player and Studio go here (Tauri + React + Vite). Not created yet.
docs/           Specification.
```

`packages/core` is consumed from source (`exports` point at `src/index.ts`), so there is no build step.
The player and Studio must reuse its validators. Never re-implement validation in an app.

## Commands

```
pnpm install      install (pnpm 12, Node 24+)
pnpm test         run all tests (Vitest)
pnpm typecheck    tsc --noEmit in every package
pnpm check        typecheck + test; run this before every commit
```

Use pnpm only; do not create `package-lock.json` or `yarn.lock`.

## Code conventions

- TypeScript, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any` in `src/`
  (tests may use it for building malformed input).
- Keep methods focused on one responsibility. Apply SOLID principles across the project where they
  improve cohesion, testability and maintainability; avoid abstractions that add complexity without
  a clear benefit.
- Use dependency inversion and dependency injection when they help isolate changeable or external
  details (for example, I/O or platform services). Prefer simple function parameters or constructors;
  do not introduce a DI container or extra layers by default, especially in the pure, dependency-light
  core.
- ES modules. Imports inside `packages/core/src` are extensionless relative imports.
- Validators are pure functions: input in, `ValidationResult` out. They must never throw on bad input,
  and must never perform I/O.
- Error codes are the fixed set in `src/errors.ts` (spec section 11). Do not invent new codes without
  updating the spec. Use `IVF_LIMIT_EXCEEDED` for size/count limits, `IVF_UNSUPPORTED_FEATURE` for
  unsupported interaction types and remote resources, `IVF_UNSAFE_PATH` for path problems.
- All numeric limits live in `src/limits.ts`. The JSON Schema repeats some of them
  (`src/schema/ivf-manifest-0.1.schema.json`); change both together and add a test.
- Keep `packages/core` dependencies to a minimum. Adding a dependency to it needs a reason,
  because it parses untrusted input.
- New pnpm settings go in `pnpm-workspace.yaml` (not `.npmrc`; this is pnpm 11+).
  Dependency build scripts are blocked unless listed under `allowBuilds`.
- Dependencies are never installed from versions younger than 1 day (`minimumReleaseAge`). Do not disable it.

## Testing rules

- Write the failing test first. Every validation rule needs a test that proves the bad input is rejected,
  and the exact error code is asserted.
- Every security bug found gets a regression test.
- Test boundaries: exactly at the limit passes, one over fails.
- Fixtures: valid manifests live in `packages/core/fixtures/valid/`. Real valid and malicious `.ivxpkg`
  archives live in `packages/core/fixtures/ivxpkg/`; regenerate them with
  `pnpm --filter @ivf/core fixtures:build`.
- When changing a safety check, temporarily break it and confirm a test fails (mutation check).

## Format rules to keep in mind (version 0.1)

- Manifest fields: `format` (`"IVF"`), `format_version` (`"0.1"`), `title`, `entry_scene`, `scenes`.
  A scene has `video` and `interactions`. The only interaction type is `choice`.
- Unknown fields are rejected (strict). There is no extension mechanism yet.
- Package paths: `/` separator, relative to the package root, normalized to NFC, case-sensitive for lookups,
  case-insensitive for duplicate detection. No absolute, drive-letter, UNC, backslash, `..`, `.`, empty
  segments, colons, control characters.
- Two interactions in one scene may not share a timestamp. `at_seconds` is measured from the start of the scene.
- Circular scene transitions are valid in the manifest; the player enforces runtime limits.

## Open decisions (do not decide silently)

Raise these with the maintainer before implementing behaviour that depends on them:

- Runtime cap for circular transitions (spec 9.1)
- Seeking past unresolved interactions: trigger them or block seeking (spec 7.2)
- Whether to reserve an `extensions` object in the manifest
- Final values for the "proposed" limits in `src/limits.ts`
- Video codec support per OS webview, especially Linux (WebKitGTK may need extra media packages)
- Tauri is the proposed shell (Electron is the fallback); confirm before adding native commands
- Digital signatures, encryption/DRM, official file extension and media type

## Known gaps

- No fuzzing yet.

## Roadmap order

Follow the spec roadmap (section 13). Do not add playback features until the reader rejects every
invalid and malicious fixture reliably. Phases 2 (reader) and 3 (test packages) are complete; the next
phase is the basic player, then hardening, then Studio.

## Working style

- Make small, focused changes. Run `pnpm check` before proposing a commit.
- When a spec point is ambiguous or a limit is not defined, mark it as a decision for the maintainer.
  Do not invent a value and bury it in code.
- Update `README.md` and this file when the layout, commands or decisions change.

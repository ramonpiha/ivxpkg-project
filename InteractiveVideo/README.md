# IVF (Interactive Video Format)

Reader, player and studio for `.ivxpkg` Interactive Video Format packages.
The format is defined in [docs/IVF_SPECIFICATION_0_1.md](docs/IVF_SPECIFICATION_0_1.md).

## Requirements

- Node.js 24 or newer (`.node-version` pins 26)
- pnpm 12 (`pnpm --version`)
- Later, when the desktop app is started: Rust (MSVC toolchain) and the Microsoft C++ Build Tools

## Platform strategy

IVF is a desktop application built on [Tauri](https://tauri.app/). Windows is the first and only
tested target for now, but nothing in the code should be Windows-specific, so macOS and Linux can follow.

- `packages/core` stays platform-neutral and has no Node-only or Windows-only code. It runs in the Tauri webview.
- Tauri uses each OS's own webview (WebView2 on Windows, WebKit on macOS and Linux), so video codec support
  differs per OS. Test H.264/AAC playback on Linux early, before building the player around it.
- Before any cross-platform claim: CI runs `pnpm check` on Windows, macOS and Linux, and playback is
  tested by hand on each OS.
- There is no browser deployment target.

## Commands

```
pnpm install      # install dependencies
pnpm test         # run all tests
pnpm typecheck    # type-check all packages
pnpm check        # both
```

## Layout

```
packages/core     Format core: limits, error codes, JSON Schema, validators.
                  No Node-only, DOM or UI dependencies; uses Web Streams for ZIP reading.
apps/             (empty) Tauri desktop player and Studio will live here
docs/             specification
```

## Status: spec roadmap phase 3 (test package), complete

Done in `packages/core`:

- Limits (`src/limits.ts`) and error codes (`src/errors.ts`)
- Manifest JSON Schema (`src/schema/ivf-manifest-0.1.schema.json`)
- Path safety checks (`src/paths.ts`)
- Archive entry validation: entry count, types, duplicates, manifest at root (`src/entries.ts`)
- ZIP inspection: single-disk classic ZIP, stored/deflate entries, streamed size/ratio checks,
  CRC verification, and in-memory reads (`src/archive.ts`)
- Manifest validation: size, UTF-8, nesting depth, duplicate keys, version gate, schema,
  references, uniqueness, assets (`src/manifest.ts`)
- Real valid and malicious `.ivxpkg` fixtures, including minimal and branching packages with synthetic
  H.264/AAC samples; run `pnpm --filter @ivf/core fixtures:build` to recreate the archives.

Not done yet:

- Fuzzing

## Known gaps

- **Circular transitions.** Cycles are valid in the manifest. The runtime limit the spec
  asks for (9.1) is undecided and belongs in the player.
- **Seeking behaviour.** Spec 7.2 leaves "trigger or disallow" open. Pick one before Phase 4.
- ZIP64, multi-disk and encrypted ZIP archives are rejected; only stored and deflate compression
  are supported by the current reader.

## Decisions made in code that are not in the spec

See "proposed" values in `src/limits.ts`: option counts per choice (2 to 10),
`at_seconds` range (0 to 86400), id format (`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`),
uncompressed total (2 GiB) and compression ratio (100:1). Record the final values in
spec section 14.

The ZIP reader runs in TypeScript using the webview's streaming `DecompressionStream` API for
deflate entries. A player whose webview lacks raw-deflate support rejects those packages clearly.
Move ZIP processing to Rust only if testing large packages (up to 500 MB) proves it too heavy.

JSON Schema validation uses `@cfworker/json-schema`, which interprets the schema
without `eval` or `new Function`, so the player can run under a strict Content
Security Policy as spec 9.4 requires.

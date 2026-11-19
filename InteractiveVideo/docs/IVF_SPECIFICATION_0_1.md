# IVF (Interactive Video Format)

## Architecture, Format and Security Specification --- Draft 0.1

**Status:** Working draft\
**Version:** 0.1\
**Date:** 2026-11-17\
**Project name:** IVF (provisional)\
**File extension:** `.ivxpkg`

> This document defines an initial prototype direction. It is not a
> finalized industry standard, security certification, patent opinion,
> or guarantee of interoperability. The name, extension, container
> choice, limits and schema may change after implementation and
> prior-art review.

------------------------------------------------------------------------

# 1. Purpose and goals

IVF is a proposed package format for interactive audiovisual
experiences. An IVF package combines media assets with a declarative
description of scenes, timeline events, user interactions and branching
behaviour.

The goal is to let a compatible player interpret an IVF package without
requiring a custom application to be programmed for each individual
experience.

The first prototype will demonstrate this sequence:

1.  Open an IVF package.
2.  Play an included video.
3.  Pause at a specified point.
4.  Present a choice to the viewer.
5.  Select the next scene based on the choice.
6.  Continue playback.

## 1.1 Design goals

-   **Declarative:** Files describe content and permitted behaviour;
    they do not contain arbitrary executable programs.
-   **Portable:** A package should work on any compatible player.
-   **Self-contained by default:** Media and required assets are
    included in the package.
-   **Extensible:** Future versions can add interaction types without
    silently changing existing behaviour.
-   **Validatable:** A player can reject malformed or unsupported
    packages before playback.
-   **Accessible:** Interactions should support keyboard navigation,
    assistive technology and captions where applicable.
-   **Secure by design:** Treat every package and every field within it
    as untrusted input.

## 1.2 Non-goals for version 0.1

The first prototype will not:

-   Define a new video or audio codec.
-   Execute JavaScript, shell commands, scripts, plugins or native code
    from a package.
-   Load remote media, scripts, fonts or other resources.
-   Provide unrestricted filesystem, device or operating-system access.
-   Require a server, account or database.
-   Define DRM, encryption, digital signatures or content licensing.
-   Guarantee real-time streaming or adaptive bitrate playback.

------------------------------------------------------------------------

# 2. Terminology

  -----------------------------------------------------------------------
  Term                                Meaning
  ----------------------------------- -----------------------------------
  Package                             The complete `.ivxpkg` file.

  Manifest                            The structured document describing
                                      the package.

  Scene                               A playable audiovisual segment and
                                      its associated events.

  Interaction                         A prompt presented to the viewer to
                                      collect input.

  Event                               A defined occurrence on a scene
                                      timeline.

  Transition                          A permitted move from one scene to
                                      another.

  Player                              Software that validates and plays
                                      an IVF package.

  Creator / Studio                    Software used to author and export
                                      IVF packages.

  Capability                          A specific operation a player
                                      permits a package to request.

  Untrusted input                     Any data originating from a
                                      package, media asset or user
                                      action.
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 3. System architecture

IVF has three primary products:

1.  **IVF Reader / Player:** Opens, validates and executes a package.
2.  **IVF Test Package:** A known-good example used for development and
    compatibility testing.
3.  **IVF Studio:** An authoring application that creates, validates,
    previews and exports packages.

The reader and Studio must use the same format specification and
validation rules. The player must not assume that a package was created
by the official Studio.

## 3.1 Logical architecture

``` text
+-------------------+       exports        +----------------------+
|     IVF Studio    | --------------------> |      IVF Package     |
|                   |                        |                      |
| - Media import    |                        | - manifest.json      |
| - Timeline editor |                        | - media/             |
| - Interaction UI  |                        | - assets/             |
| - Validation      |                        +----------+-----------+
+-------------------+                                   |
                                                        | opens
                                                        v
                                             +----------------------+
                                             |     IVF Player       |
                                             |                      |
                                             | 1. Archive inspector |
                                             | 2. Manifest parser   |
                                             | 3. Schema validator  |
                                             | 4. Policy validator  |
                                             | 5. Instruction engine|
                                             | 6. Media playback    |
                                             | 7. Interaction UI    |
                                             +----------------------+
```

## 3.2 Trust boundaries

The package is untrusted. The player is trusted code. The player must
validate package structure and content before interpreting it.

The player must not grant a package additional privileges because it was
created by the official Studio, has a familiar filename, or contains
metadata claiming to be trusted.

------------------------------------------------------------------------

# 4. Proposed technology stack

The following stack is recommended for the first desktop prototype
(Windows first, built on Tauri so it can later ship on macOS and Linux).
These are implementation choices, not requirements of the format
itself.

  -----------------------------------------------------------------------
  Area                    Initial choice          Reason
  ----------------------- ----------------------- -----------------------
  Language                TypeScript              Typed application logic
                                                  and tooling

  UI                      React                   Component-based player
                                                  and later Studio UI

  Runtime                 Tauri desktop app       Cross-platform shell
                          (system webview)        using each OS's native
                                                  webview; no bundled
                                                  browser

  Native layer            Rust (Tauri core)       Thin privileged shell:
                                                  file access and window
                                                  handling only

  Video playback          HTML5 `<video>`         Uses codecs supported
                          in the webview          by the OS webview

  Package container       ZIP archive             Easy to inspect and
                                                  prototype

  Manifest                JSON                    Widely supported
                                                  structured data

  Schema validation       JSON Schema validator   Consistent structural
                                                  validation

  Testing                 Vitest                  Unit and integration
                                                  tests

  Source control          Git                     Change history and
                                                  collaboration

  Optional backend later  Node.js                 Studio collaboration or
                                                  hosted services, if
                                                  needed
  -----------------------------------------------------------------------

The first version should run locally as a desktop application and should
not require a backend or network access.

## 4.1 Codec and container distinction

IVF does not define a new codec in version 0.1.

-   The **container** packages the manifest and media assets.
-   The **codec** encodes and decodes video or audio.
-   The **player** interprets IVF instructions and coordinates media
    playback.

For the first prototype, MP4 files containing H.264 video and AAC audio
are reasonable compatibility targets. Actual codec support depends on
the OS webview (WebView2 on Windows, WebKit on macOS and Linux), the
operating system and the device. Linux may require additional system
media packages.

------------------------------------------------------------------------

# 5. IVF package structure

## 5.1 Version 0.1 container

An `.ivxpkg` file is a ZIP archive with a required
`manifest.json` at its root.

Example:

``` text
example.ivxpkg
├── manifest.json
├── media/
│   ├── introduction.mp4
│   ├── outcome-a.mp4
│   └── outcome-b.mp4
└── assets/
    ├── poster.png
    └── captions-en.vtt
```

The archive must not contain executable application code.

## 5.2 Package rules

-   `manifest.json` is required and must be at the archive root.
-   All package-internal paths use `/` as the separator.
-   Paths are relative to the package root.
-   Absolute paths, drive-letter paths, UNC paths and traversal segments
    are invalid.
-   Duplicate normalized paths are invalid.
-   Symbolic links and special filesystem entries are not supported in
    version 0.1.
-   Unreferenced files may be ignored by the player, but the Studio
    should warn about them.
-   The player should read assets from the archive without extracting
    them to arbitrary filesystem locations.
-   The player must enforce package resource limits before processing
    large assets.
-   The prototype reader supports single-disk classic ZIP archives and
    the stored and deflate compression methods. It rejects ZIP64,
    multi-disk and encrypted archives. Deflate support requires the
    player's runtime to provide streaming raw-deflate decompression.

The `.ivxpkg` suffix identifies an IVF experience package rather than
an existing `.ivf` raw-video container. The MIME type is provisionally
`application/vnd.ivxpkg` and is not yet IANA-registered.

------------------------------------------------------------------------

# 6. Manifest specification

The manifest is JSON data. It describes the experience and contains no
executable code.

## 6.1 Required top-level fields

  --------------------------------------------------------------------------
  Field              Type                          Required Meaning
  ------------------ ---------------- --------------------- ----------------
  `format`           string                             Yes Must be `IVF`.

  `format_version`   string                             Yes Specification
                                                            version,
                                                            initially `0.1`.

  `title`            string                             Yes Human-readable
                                                            package title.

  `entry_scene`      string                             Yes ID of the first
                                                            scene.

  `scenes`           object                             Yes Map of scene IDs
                                                            to scene
                                                            definitions.
  --------------------------------------------------------------------------

Unknown fields should be rejected in strict version 0.1 validation
unless the specification explicitly marks an extension point. A future
version may define a formal extension mechanism.

## 6.2 Scene fields

  Field            Type       Required Meaning
  ---------------- -------- ---------- -------------------------------------------
  `video`          string          Yes Relative path to an included video asset.
  `interactions`   array           Yes Timeline interactions; may be empty.

Scene IDs must be unique, non-empty identifiers. Every scene referenced
by a transition must exist.

## 6.3 Interaction fields

The initial supported interaction type is `choice`.

  ------------------------------------------------------------------------
  Field            Type                          Required Meaning
  ---------------- ---------------- --------------------- ----------------
  `id`             string                             Yes Unique
                                                          interaction ID
                                                          within its
                                                          scene.

  `at_seconds`     number                             Yes Time at which
                                                          the interaction
                                                          is triggered.

  `type`           string                             Yes `choice` in
                                                          version 0.1.

  `prompt`         string                             Yes Plain-text
                                                          question or
                                                          instruction.

  `options`        array                              Yes Available
                                                          choices.
  ------------------------------------------------------------------------

Each choice option contains:

  ------------------------------------------------------------------------
  Field            Type                          Required Meaning
  ---------------- ---------------- --------------------- ----------------
  `label`          string                             Yes Plain-text label
                                                          displayed to the
                                                          viewer.

  `next_scene`     string                             Yes ID of the scene
                                                          to play after
                                                          selection.
  ------------------------------------------------------------------------

## 6.4 Example manifest

``` json
{
  "format": "IVF",
  "format_version": "0.1",
  "title": "First branching video",
  "entry_scene": "intro",
  "scenes": {
    "intro": {
      "video": "media/introduction.mp4",
      "interactions": [
        {
          "id": "choose-a-path",
          "at_seconds": 10,
          "type": "choice",
          "prompt": "What should the character do?",
          "options": [
            {
              "label": "Open the door",
              "next_scene": "door"
            },
            {
              "label": "Walk away",
              "next_scene": "away"
            }
          ]
        }
      ]
    },
    "door": {
      "video": "media/outcome-a.mp4",
      "interactions": []
    },
    "away": {
      "video": "media/outcome-b.mp4",
      "interactions": []
    }
  }
}
```

This example is illustrative. A formal JSON Schema must be maintained
alongside the implementation and should encode all required fields,
types, ranges, string lengths, array limits and unknown-field policy.

------------------------------------------------------------------------

# 7. Playback and execution model

## 7.1 Basic playback sequence

1.  The user selects an `.ivxpkg` file.
2.  The player inspects the archive.
3.  The player checks package limits and archive entry types.
4.  The player reads and parses `manifest.json`.
5.  The player validates the manifest against the versioned schema.
6.  The player validates all referenced paths, scenes and transitions.
7.  The player applies its security policy.
8.  The player loads the entry scene.
9.  The media engine starts playback.
10. The timeline engine monitors interaction timestamps.
11. At an interaction point, playback pauses.
12. The interaction renderer displays the prompt and choices.
13. The player validates the selected option.
14. The transition engine loads the referenced scene.
15. The process repeats until playback ends.

## 7.2 Timing rules

-   `at_seconds` is measured from the beginning of the current scene.
-   Interactions are evaluated in ascending timestamp order.
-   When an interaction becomes due, the player pauses playback before
    presenting it.
-   A given interaction may fire only once per scene visit in version
    0.1.
-   Seeking across an interaction point must not silently skip its
    required decision. The player should either trigger the interaction
    or disallow seeking past unresolved interactions.
-   If multiple interactions have the same timestamp, the package is
    invalid in version 0.1.
-   If the media ends before an interaction can be triggered, the player
    should report a validation or playback error rather than silently
    ignoring the interaction.

The exact behaviour for replay, back navigation, seeking and resuming
must be covered by player tests.

------------------------------------------------------------------------

# 8. Instruction and capability model

## 8.1 No arbitrary executable code

A core security rule is:

**An IVF package describes permitted behaviour; it does not contain
programs for the player to execute.**

Version 0.1 supports only predefined declarative structures. It does not
support:

-   JavaScript or WebAssembly supplied by a package.
-   Shell commands or operating-system commands.
-   Dynamic imports or plugins.
-   SQL or database commands.
-   Arbitrary HTML rendering.
-   Native code or executable binaries.
-   Reflection or access to player internals.

A package may select from operations implemented by the player, but it
cannot define new operations.

## 8.2 Initial operation set

The first version can implement these internal operations:

  Operation       Meaning
  --------------- -----------------------------------------
  `PLAY_SCENE`    Start a known scene.
  `PAUSE`         Pause the current media.
  `SHOW_CHOICE`   Display a validated choice interaction.
  `GOTO_SCENE`    Transition to a known scene ID.

These are conceptual operation names. The manifest example uses
declarative scene and interaction fields rather than a free-form command
list.

## 8.3 Future conditional logic

Later versions may add a restricted expression language, for example:

``` text
IF answer == "yes"
THEN GOTO_SCENE "scene_yes"
ELSE GOTO_SCENE "scene_no"
```

Such a language must have a formal grammar, defined data types, bounded
evaluation cost and no access to operating-system APIs, network APIs,
filesystem APIs or arbitrary code execution.

Do not use `eval`, `Function`, a general-purpose scripting engine or
equivalent mechanisms to implement this feature.

------------------------------------------------------------------------

# 9. Security specification

All package data, media files, metadata, strings and user input must be
treated as untrusted.

The security objectives are:

1.  Prevent package content from executing arbitrary code.
2.  Prevent unauthorized filesystem or operating-system access.
3.  Prevent unintended network access.
4.  Prevent resource exhaustion.
5.  Reduce exposure to malicious media and parser vulnerabilities.
6.  Ensure malformed packages fail safely and predictably.
7.  Keep the player secure even when the package was created by a
    trusted Studio.

## 9.1 Threat model

  -----------------------------------------------------------------------
  Threat                  Example                 Required mitigation
  ----------------------- ----------------------- -----------------------
  Command injection       Package attempts to run No command execution
                          a shell command         capability.

  Script injection / XSS  Prompt contains script  Render untrusted text
                          markup                  as text; never inject
                                                  it as HTML.

  Path traversal / ZIP    Archive entry contains  Normalize and reject
  Slip                    `../../`                unsafe paths; do not
                                                  blindly extract.

  ZIP bomb                Small archive expands   Enforce compressed and
                          to huge data            uncompressed size
                                                  limits and
                                                  compression-ratio
                                                  limits.

  Malicious media         Crafted video exploits  Use maintained platform
                          a decoder               decoders; keep
                                                  dependencies updated;
                                                  test malformed media.

  SSRF / network abuse    Package references      No remote resources in
                          internal network URLs   version 0.1.

  Denial of service       Huge scene graph or     Enforce limits on
                          excessive events        archive entries,
                                                  manifest size, scene
                                                  count and interactions.

  Logic abuse             Circular transitions    Define runtime limits
                          create endless loops    and safe navigation
                                                  behaviour.

  Dependency compromise   Vulnerable or malicious Pin and audit
                          library                 dependencies; use
                                                  automated vulnerability
                                                  scanning.

  Data leakage            Player sends viewing    No telemetry or network
                          data without consent    calls in version 0.1.
  -----------------------------------------------------------------------

## 9.2 Archive validation

Before reading media:

-   Reject malformed archives.
-   Reject absolute paths and traversal components.
-   Reject duplicate normalized paths.
-   Reject symbolic links and special files.
-   Reject unsupported compression methods.
-   Limit archive entry count.
-   Limit total declared uncompressed size.
-   Limit individual asset size.
-   Limit compression ratios.
-   Check actual decompressed byte counts while reading; do not trust
    archive metadata alone.
-   Avoid extracting files to user-controlled or system paths.
-   Fail closed when archive validation is incomplete.

The implementation must account for path normalization differences
across operating systems.

## 9.3 Manifest and input validation

-   Parse JSON using a maintained parser.
-   Validate against a version-specific schema.
-   Reject unknown instructions and unsupported interaction types.
-   Enforce limits on strings, arrays, objects and nesting depth.
-   Verify that every referenced asset exists.
-   Verify that every scene reference resolves.
-   Reject invalid timestamps, duplicate IDs and invalid transitions.
-   Render all package-provided text as text, not HTML.
-   Validate user input before using it in any application logic.
-   Never construct executable code or queries from user input.

## 9.4 Webview security

The player's user interface runs in the system webview and should have
no unnecessary privileges.

-   Do not use `eval()` or `new Function()`.
-   Do not inject package content through `innerHTML`.
-   Use safe DOM APIs such as `textContent`.
-   Do not load package-specified scripts, stylesheets or frames.
-   Do not allow arbitrary remote URLs.
-   Apply a restrictive Content Security Policy where the hosting
    environment permits it.
-   Keep the player origin separate from unrelated applications where
    practical.
-   Revoke object URLs when no longer needed.
-   Avoid persistent storage of user responses unless explicitly
    required and disclosed.

The webview provides useful isolation, but it is not a substitute for
validation or safe implementation.

## 9.5 Desktop security

The desktop player must follow these rules:

-   Use least-privilege operating-system permissions.
-   Keep untrusted package processing separate from privileged
    application code.
-   Do not expose native filesystem or process APIs to package content.
-   Use a sandbox for untrusted rendering or media components where
    supported.
-   Require explicit user consent for any future capability that
    accesses files, devices or networks.
-   Keep privileged IPC interfaces narrow and validate every message.
-   Do not assume that hiding a UI control is a security boundary.

Tauri is the proposed desktop shell (see section 14): define a minimal
capability policy and avoid granting broad filesystem or shell
permissions. If Electron is selected instead, enable context isolation
and sandboxing, disable Node integration for untrusted content, and
apply a restrictive Content Security Policy.

## 9.6 Initial resource limits

The following are provisional prototype limits. They should be adjusted
using testing and documented as player policy, not treated as universal
format constants.

  Resource                       Initial limit
  ------------------------- ------------------
  Package compressed size               500 MB
  Archive entries                          500
  Manifest size                           2 MB
  Scenes                                   100
  Interactions per scene                   100
  Total interactions                     1,000
  Nesting depth                             10
  Individual text field       4,096 characters
  Individual media asset                500 MB

The player should also enforce an overall uncompressed package-size
limit and reasonable playback limits. Limits must be checked during
processing, not only from declared archive metadata.

------------------------------------------------------------------------

# 10. Compatibility and versioning

The manifest includes `format_version`.

Versioning rules:

-   A player must identify the version before interpreting the package.
-   A player must not silently interpret an unknown major version.
-   Unsupported features must produce a clear error.
-   A player may reject a package using a newer minor version if it
    cannot safely ignore or interpret its features.
-   Behaviour changes that affect playback semantics require explicit
    versioning.
-   The specification and JSON Schema must be versioned together.
-   Test packages must identify the version they target.

A compatibility policy must be finalized before version 1.0.

------------------------------------------------------------------------

# 11. Error handling

Errors should be clear to users but must not expose sensitive internal
details.

Suggested error categories:

  -----------------------------------------------------------------------
  Code                                Meaning
  ----------------------------------- -----------------------------------
  `IVF_INVALID_ARCHIVE`               Package is not a valid supported
                                      archive.

  `IVF_LIMIT_EXCEEDED`                A package or resource limit was
                                      exceeded.

  `IVF_MANIFEST_MISSING`              Required manifest is missing.

  `IVF_MANIFEST_INVALID`              Manifest cannot be parsed or fails
                                      schema validation.

  `IVF_UNSUPPORTED_VERSION`           Package version is not supported.

  `IVF_UNSAFE_PATH`                   Archive contains an unsafe path.

  `IVF_ASSET_MISSING`                 A referenced asset does not exist.

  `IVF_INVALID_SCENE`                 Scene reference is invalid.

  `IVF_UNSUPPORTED_FEATURE`           Package requests an unsupported
                                      feature.

  `IVF_MEDIA_ERROR`                   Media could not be loaded or
                                      played.
  -----------------------------------------------------------------------

The player must fail safely. It must not attempt to recover by executing
unsupported content or bypassing validation.

------------------------------------------------------------------------

# 12. Test strategy

Testing is a required part of the format and player development.

## 12.1 Functional test packages

  -----------------------------------------------------------------------
  Test                                Expected result
  ----------------------------------- -----------------------------------
  One video, no interactions          Plays to completion.

  One interaction, two choices        Pauses and displays both choices.

  Choice to scene A                   Loads scene A.

  Choice to scene B                   Loads scene B.

  Multiple sequential interactions    Each interaction triggers in order.

  Missing referenced media            Package rejected or clear playback
                                      error.

  Unsupported interaction type        Package rejected.

  Unknown scene target                Package rejected.

  Unsupported format version          Clear compatibility error.
  -----------------------------------------------------------------------

## 12.2 Security test packages

  -----------------------------------------------------------------------
  Test                                Expected result
  ----------------------------------- -----------------------------------
  Invalid JSON                        Rejected without crash.

  Script markup in prompt             Never executed.

  Unknown operation or field          Rejected under strict version 0.1
                                      rules.

  Path traversal entry                Rejected.

  Absolute path entry                 Rejected.

  Duplicate normalized paths          Rejected.

  Symbolic link entry                 Rejected.

  ZIP bomb / excessive expansion      Rejected within bounded resource
                                      use.

  Oversized manifest                  Rejected.

  Excessive scene or interaction      Rejected.
  count                               

  Circular scene transitions          Handled within defined runtime
                                      limits.

  Malformed media                     Playback fails safely; player
                                      remains usable.

  Remote URL reference                Rejected in version 0.1.
  -----------------------------------------------------------------------

## 12.3 Engineering tests

-   Unit tests for path normalization and validation.
-   Unit tests for manifest schema and scene references.
-   Integration tests for playback and transitions.
-   Fuzz testing of archive and manifest parsers.
-   Dependency vulnerability scanning.
-   Regression tests for every security issue found.
-   Automated tests (type check and unit tests) run in CI on Windows,
    macOS and Linux.
-   Manual tests on each supported operating system, including video
    codec playback in that OS's webview. Windows first; macOS and Linux
    before any cross-platform claim is made.

------------------------------------------------------------------------

# 13. Development roadmap

## Phase 1 --- Architecture and specification

Deliverables:

-   This architecture and security document.
-   Versioned manifest schema.
-   Defined package layout.
-   Defined initial limits and error codes.
-   Documented supported and unsupported features.

## Phase 2 --- Reader foundation

Deliverables:

-   Archive inspector.
-   Safe path validator.
-   Manifest parser.
-   Schema validator.
-   Scene and asset reference validator.
-   Clear error handling.

No playback features should be added until the reader can reject invalid
packages reliably.

## Phase 3 --- Test package

Deliverables:

-   A minimal valid `.ivxpkg` package.
-   Included sample video assets.
-   A branching example.
-   Invalid and malicious test fixtures.

## Phase 4 --- Basic player

Deliverables:

-   Package selection.
-   Package validation.
-   Video playback.
-   Timeline monitoring.
-   Pause at interaction point.
-   Choice rendering.
-   Scene transitions.

## Phase 5 --- Security hardening

Deliverables:

-   Resource limits.
-   Security regression suite.
-   Parser fuzzing.
-   Dependency review.
-   Webview and desktop security policy.
-   Documented threat-model review.

Security work is continuous; this phase does not replace security
controls in earlier phases.

## Phase 6 --- IVF Studio

Deliverables:

-   Media import.
-   Scene management.
-   Timeline editor.
-   Interaction editor.
-   Branching graph.
-   Package validation.
-   Preview using the same player engine.
-   Export to `.ivxpkg`.

## Phase 7 --- Version 1.0 preparation

Deliverables:

-   Stable format specification.
-   Formal JSON Schema.
-   Compatibility test suite.
-   Reference player.
-   Reference creator.
-   Developer documentation.
-   Security review.
-   Prior-art and intellectual-property review.

------------------------------------------------------------------------

# 14. Open design decisions

These decisions should remain explicit rather than being made
accidentally during implementation.

  -----------------------------------------------------------------------
  Question                Initial recommendation  Status
  ----------------------- ----------------------- -----------------------
  ZIP or custom binary    ZIP for prototype       Provisional
  container?                                      

  JSON or another         JSON                    Provisional
  manifest format?                                

  New video codec?        No; reuse existing      Decided for 0.1
                          codecs                  

  Arbitrary scripts in    Never in core format    Proposed invariant
  packages?                                       

  External network        Disabled in 0.1         Proposed
  resources?                                      

  Browser or desktop      Desktop (Tauri),        Proposed (changed
  player first?           Windows first           2026-11-18; was
                                                  browser)

  Tauri or Electron?      Tauri                   Proposed

  Where does ZIP reading  TypeScript first;       Open
  run: TypeScript or      Rust if large packages
  Rust?                   prove too heavy

  Creator and player      Yes                     Proposed
  share validation?                               

  Conditional expression  Defer until later       Proposed
  language?               version                 

  Digital signatures?     Investigate for later   Open
                          version                 

  Encryption / DRM?       Out of scope for 0.1    Open

  Official file extension `.ivxpkg`; provisional    Decided for 0.1
                          MIME `application/vnd.ivxpkg`
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 15. Definition of done for prototype 0.1

The first prototype is complete when all of the following are true:

-   A valid `.ivxpkg` archive can be opened by the reader.
-   The manifest is parsed and validated.
-   The entry scene plays.
-   Playback pauses at a defined interaction timestamp.
-   The player displays the defined choices.
-   Each choice loads the correct next scene.
-   Invalid and malicious test packages are rejected safely.
-   No package-provided code is executed.
-   No package-provided remote resources are loaded.
-   The player remains usable after a package fails to open.
-   The example package and test results are documented.

------------------------------------------------------------------------

# 16. Reference material

These resources are useful implementation and security references. They
do not establish that the proposed IVF design is novel or patentable.

-   [OWASP File Upload Cheat
    Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
-   [OWASP Path
    Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
-   [OWASP Cross Site Scripting Prevention Cheat
    Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
-   [JSON Schema](https://json-schema.org/)
-   [Electron
    Security](https://www.electronjs.org/docs/latest/tutorial/security)
-   [Tauri Security](https://v2.tauri.app/security/)
-   [MDN --- HTML
    Media](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video)
-   [Google Patents](https://patents.google.com/)
-   [European Patent Office ---
    Espacenet](https://worldwide.espacenet.com/)

------------------------------------------------------------------------

## Document history

  -----------------------------------------------------------------------
  Version                 Date                    Changes
  ----------------------- ----------------------- -----------------------
  0.1                     2026-11-17              Initial architecture,
                                                  package, manifest,
                                                  security and
                                                  development draft.

  0.1 (rev.)              2026-11-18              Target changed from
                                                  browser to desktop
                                                  (Tauri, Windows first);
                                                  sections 4, 9.4, 9.5,
                                                  12.3 and 14 updated.

  -----------------------------------------------------------------------

**End of draft.**

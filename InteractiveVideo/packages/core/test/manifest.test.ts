import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/limits";
import { jsonNestingDepth, validateManifest } from "../src/manifest";
import type { IvfErrorCode } from "../src/errors";

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/valid/${name}`, import.meta.url), "utf8");

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Clones the branching fixture, lets a test break it, and returns JSON text. */
function mutated(change: (manifest: any) => void): string {
  const manifest = JSON.parse(fixture("branching.manifest.json"));
  change(manifest);
  return JSON.stringify(manifest);
}

function choice(index: number, next = "intro"): any {
  return {
    id: `i${index}`,
    at_seconds: index,
    type: "choice",
    prompt: "?",
    options: [
      { label: "a", next_scene: next },
      { label: "b", next_scene: next },
    ],
  };
}

function expectCode(input: string | Uint8Array, code: IvfErrorCode, options = {}): void {
  const result = validateManifest(input, options);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues[0]?.code).toBe(code);
}

describe("valid manifests (spec 12.1)", () => {
  it("accepts one video with no interactions", () => {
    const result = validateManifest(fixture("minimal.manifest.json"));
    expect(result.ok).toBe(true);
  });

  it("accepts the spec 6.4 branching example", () => {
    const result = validateManifest(fixture("branching.manifest.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value.scenes)).toEqual(["intro", "door", "away"]);
      expect(result.warnings).toEqual([]);
    }
  });

  it("accepts bytes as well as strings", () => {
    const bytes = new TextEncoder().encode(fixture("branching.manifest.json"));
    expect(validateManifest(bytes).ok).toBe(true);
  });

  it("accepts several sequential interactions in one scene", () => {
    const text = mutated((m) => {
      m.scenes.intro.interactions = [choice(1, "door"), choice(5, "away"), choice(9, "door")];
    });
    expect(validateManifest(text).ok).toBe(true);
  });

  it("accepts circular transitions; runtime limits are the player's job", () => {
    const text = mutated((m) => {
      m.scenes.door.interactions = [choice(1, "intro")];
    });
    const result = validateManifest(text);
    expect(result.ok).toBe(true);
  });

  it("warns about scenes that cannot be reached", () => {
    const text = mutated((m) => {
      m.scenes.orphan = { video: "media/orphan.mp4", interactions: [] };
    });
    const result = validateManifest(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.map((w) => w.location)).toEqual(["/scenes/orphan"]);
    }
  });

  it("keeps script markup in text fields as inert text", () => {
    const evil = `<script>alert(1)</script><img src=x onerror=alert(1)>`;
    const text = mutated((m) => {
      m.title = evil;
      m.scenes.intro.interactions[0].prompt = evil;
      m.scenes.intro.interactions[0].options[0].label = evil;
    });
    const result = validateManifest(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.scenes["intro"]?.interactions[0]?.prompt).toBe(evil);
    }
  });

  it("returns video paths in NFC form", () => {
    const text = mutated((m) => {
      m.scenes.intro.video = "media/e\u0301.mp4";
    });
    const result = validateManifest(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scenes["intro"]?.video).toBe("media/\u00e9.mp4");
  });
});

describe("malformed input", () => {
  it("rejects invalid JSON without throwing", () => {
    expectCode("{not json", "IVF_MANIFEST_INVALID");
    expectCode("", "IVF_MANIFEST_INVALID");
  });

  it("rejects duplicate object keys, including escaped-equivalent keys", () => {
    const text =
      '{"format":"IVF","format_version":"0.1","title":"x","entry_scene":"s","scenes":' +
      '{"s":{"video":"media/a.mp4","interactions":[]},"\\u0073":{"video":"media/b.mp4","interactions":[]}}}';
    expectCode(text, "IVF_MANIFEST_INVALID");
  });

  it("rejects invalid UTF-8", () => {
    expectCode(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), "IVF_MANIFEST_INVALID");
  });

  it.each(["[]", "null", "42", '"text"'])("rejects non-object JSON %s", (text) => {
    expectCode(text, "IVF_MANIFEST_INVALID");
  });

  it("rejects an oversized manifest", () => {
    expectCode(new Uint8Array(LIMITS.maxManifestBytes + 1).fill(0x20), "IVF_LIMIT_EXCEEDED");
  });

  it("rejects extreme nesting before it reaches JSON.parse", () => {
    expectCode("[".repeat(200_000), "IVF_LIMIT_EXCEEDED");
    expectCode('{"a":'.repeat(11) + "1" + "}".repeat(11), "IVF_LIMIT_EXCEEDED");
  });

  it("measures nesting depth correctly", () => {
    expect(jsonNestingDepth("[[[[]]]]", 10)).toBe(4);
    expect(jsonNestingDepth('{"a":"[[[[[[[[[[[[[[["}', 10)).toBe(1); // brackets inside strings
    expect(jsonNestingDepth('{"a":"\\"[[[[[[[[[[[[["}', 10)).toBe(1); // escaped quote inside string
    expect(jsonNestingDepth("[".repeat(50), 10)).toBe(11); // stops early
  });

  it("never throws on junk input", () => {
    const junk = ["{", "}", "{}", "{\"scenes\":", "\u0000", "{\"format\":\"IVF\"}", "[[[[", "\"\\u"];
    for (const text of junk) expect(() => validateManifest(text)).not.toThrow();
  });
});

describe("format and version", () => {
  it("rejects a manifest that is not IVF", () => {
    expectCode(mutated((m) => (m.format = "ivf")), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => delete m.format), "IVF_MANIFEST_INVALID");
  });

  it.each(["0.2", "1.0", "2.0", "0.1.1", "99"])("reports unsupported version %s", (version) => {
    expectCode(mutated((m) => (m.format_version = version)), "IVF_UNSUPPORTED_VERSION");
  });

  it("rejects a missing or non-string version as an invalid manifest", () => {
    expectCode(mutated((m) => delete m.format_version), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.format_version = 0.1)), "IVF_MANIFEST_INVALID");
  });
});

describe("schema rules (strict 0.1)", () => {
  it("rejects unknown fields at every level", () => {
    expectCode(mutated((m) => (m.script = "alert(1)")), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.scenes.intro.onload = "run()")), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.scenes.intro.interactions[0].action = "GOTO")), "IVF_MANIFEST_INVALID");
    expectCode(
      mutated((m) => (m.scenes.intro.interactions[0].options[0].url = "https://x")),
      "IVF_MANIFEST_INVALID",
    );
  });

  it("rejects unsupported interaction types", () => {
    expectCode(
      mutated((m) => (m.scenes.intro.interactions[0].type = "text-input")),
      "IVF_UNSUPPORTED_FEATURE",
    );
  });

  it.each(["id", "at_seconds", "type", "prompt", "options"])("requires interaction field %s", (field) => {
    expectCode(mutated((m) => delete m.scenes.intro.interactions[0][field]), "IVF_MANIFEST_INVALID");
  });

  it.each(["title", "entry_scene", "scenes"])("requires top-level field %s", (field) => {
    expectCode(mutated((m) => delete m[field]), "IVF_MANIFEST_INVALID");
  });

  it("requires scene fields", () => {
    expectCode(mutated((m) => delete m.scenes.door.video), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => delete m.scenes.door.interactions), "IVF_MANIFEST_INVALID");
  });

  it("rejects wrong types", () => {
    expectCode(mutated((m) => (m.title = 5)), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.scenes = [])), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.scenes.intro.interactions = {})), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.scenes.intro.interactions[0].at_seconds = "10")), "IVF_MANIFEST_INVALID");
  });

  it("rejects out-of-range timestamps", () => {
    expectCode(mutated((m) => (m.scenes.intro.interactions[0].at_seconds = -1)), "IVF_MANIFEST_INVALID");
    expectCode(
      mutated((m) => (m.scenes.intro.interactions[0].at_seconds = LIMITS.maxAtSeconds + 1)),
      "IVF_MANIFEST_INVALID",
    );
  });

  it("requires at least two options and at most the maximum", () => {
    expectCode(mutated((m) => m.scenes.intro.interactions[0].options.pop()), "IVF_MANIFEST_INVALID");
    expectCode(
      mutated((m) => {
        m.scenes.intro.interactions[0].options = Array.from({ length: LIMITS.maxOptionsPerChoice + 1 }, () => ({
          label: "x",
          next_scene: "door",
        }));
      }),
      "IVF_LIMIT_EXCEEDED",
    );
  });

  it("rejects empty text fields", () => {
    expectCode(mutated((m) => (m.title = "")), "IVF_MANIFEST_INVALID");
    expectCode(mutated((m) => (m.scenes.intro.interactions[0].prompt = "")), "IVF_MANIFEST_INVALID");
  });

  it("enforces the text length limit on code points", () => {
    const longest = "x".repeat(LIMITS.maxTextLength);
    expect(validateManifest(mutated((m) => (m.title = longest))).ok).toBe(true);
    expectCode(mutated((m) => (m.title = longest + "x")), "IVF_LIMIT_EXCEEDED");
    expectCode(mutated((m) => (m.scenes.intro.interactions[0].prompt = longest + "x")), "IVF_LIMIT_EXCEEDED");
  });

  it.each(["has space", "../x", "-leading-dash", "a/b", "", "x".repeat(LIMITS.maxIdLength + 1), "<b>"])(
    "rejects scene id %j",
    (id) => {
      expectCode(
        mutated((m) => {
          m.scenes[id] = { video: "media/x.mp4", interactions: [] };
        }),
        "IVF_MANIFEST_INVALID",
      );
    },
  );

  it("rejects a __proto__ scene key", () => {
    const text = fixture("minimal.manifest.json").replace('"only": {', '"__proto__": {"polluted": true}, "only": {');
    expectCode(text, "IVF_MANIFEST_INVALID");
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe("limits", () => {
  it("rejects too many scenes", () => {
    const text = mutated((m) => {
      m.scenes = {};
      for (let i = 0; i <= LIMITS.maxScenes; i++) m.scenes[`s${i}`] = { video: "media/x.mp4", interactions: [] };
      m.entry_scene = "s0";
    });
    expectCode(text, "IVF_LIMIT_EXCEEDED");
  });

  it("accepts exactly the maximum number of scenes", () => {
    const text = mutated((m) => {
      m.scenes = {};
      for (let i = 0; i < LIMITS.maxScenes; i++) m.scenes[`s${i}`] = { video: "media/x.mp4", interactions: [] };
      m.entry_scene = "s0";
    });
    expect(validateManifest(text).ok).toBe(true);
  });

  it("rejects too many interactions in one scene", () => {
    const text = mutated((m) => {
      m.scenes.intro.interactions = Array.from({ length: LIMITS.maxInteractionsPerScene + 1 }, (_, i) =>
        choice(i, "door"),
      );
    });
    expectCode(text, "IVF_LIMIT_EXCEEDED");
  });

  it("rejects too many interactions in total", () => {
    const text = mutated((m) => {
      m.scenes = {};
      for (let s = 0; s < 11; s++) {
        m.scenes[`s${s}`] = {
          video: "media/x.mp4",
          interactions: Array.from({ length: LIMITS.maxInteractionsPerScene }, (_, i) => choice(i, "s0")),
        };
      }
      m.entry_scene = "s0";
    });
    expectCode(text, "IVF_LIMIT_EXCEEDED");
  });
});

describe("references and uniqueness", () => {
  it("rejects an unknown entry scene", () => {
    expectCode(mutated((m) => (m.entry_scene = "nowhere")), "IVF_INVALID_SCENE");
  });

  it("rejects an unknown transition target", () => {
    expectCode(mutated((m) => (m.scenes.intro.interactions[0].options[0].next_scene = "nowhere")), "IVF_INVALID_SCENE");
  });

  it.each(["constructor", "toString", "hasOwnProperty", "valueOf"])(
    "does not resolve %s through the prototype chain",
    (name) => {
      expectCode(mutated((m) => (m.entry_scene = name)), "IVF_INVALID_SCENE");
      expectCode(mutated((m) => (m.scenes.intro.interactions[0].options[0].next_scene = name)), "IVF_INVALID_SCENE");
    },
  );

  it("rejects duplicate interaction ids within a scene", () => {
    const text = mutated((m) => {
      m.scenes.intro.interactions = [choice(1, "door"), { ...choice(2, "away"), id: "i1" }];
    });
    expectCode(text, "IVF_MANIFEST_INVALID");
  });

  it("allows the same interaction id in different scenes", () => {
    const text = mutated((m) => {
      m.scenes.intro.interactions = [choice(1, "door")];
      m.scenes.door.interactions = [choice(1, "away")];
    });
    expect(validateManifest(text).ok).toBe(true);
  });

  it("rejects two interactions at the same timestamp", () => {
    const text = mutated((m) => {
      m.scenes.intro.interactions = [choice(1, "door"), { ...choice(2, "away"), at_seconds: 1 }];
    });
    expectCode(text, "IVF_MANIFEST_INVALID");
  });
});

describe("video paths and assets", () => {
  it("rejects remote URLs", () => {
    expectCode(mutated((m) => (m.scenes.intro.video = "https://example.com/a.mp4")), "IVF_UNSUPPORTED_FEATURE");
    expectCode(mutated((m) => (m.scenes.intro.video = "//example.com/a.mp4")), "IVF_UNSAFE_PATH");
  });

  it.each(["../a.mp4", "/a.mp4", "C:/a.mp4", "media\\a.mp4", "media/../a.mp4"])("rejects unsafe video path %j", (path) => {
    expectCode(mutated((m) => (m.scenes.intro.video = path)), "IVF_UNSAFE_PATH");
  });

  const allVideos = new Set(["media/introduction.mp4", "media/outcome-a.mp4", "media/outcome-b.mp4"]);

  it("accepts a manifest whose assets all exist", () => {
    expect(validateManifest(fixture("branching.manifest.json"), { archiveFiles: allVideos }).ok).toBe(true);
  });

  it("rejects a manifest that references a missing asset", () => {
    const present = new Set(allVideos);
    present.delete("media/outcome-b.mp4");
    expectCode(fixture("branching.manifest.json"), "IVF_ASSET_MISSING", { archiveFiles: present });
  });

  it("matches assets case-sensitively", () => {
    const wrongCase = new Set(["Media/introduction.mp4", "media/outcome-a.mp4", "media/outcome-b.mp4"]);
    expectCode(fixture("branching.manifest.json"), "IVF_ASSET_MISSING", { archiveFiles: wrongCase });
  });

  it("caps the number of reported issues", () => {
    const text = mutated((m) => {
      m.scenes = {};
      for (let i = 0; i < LIMITS.maxScenes; i++) m.scenes[`s${i}`] = { video: "media/x.mp4", interactions: [] };
      m.entry_scene = "s0";
    });
    const result = validateManifest(text, { archiveFiles: new Set() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBe(LIMITS.maxReportedIssues);
  });
});

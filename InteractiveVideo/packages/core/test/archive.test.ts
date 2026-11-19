import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectIvfPackage } from "../src/archive";
import type { IvfManifest } from "../src/manifest";

interface TestFile {
  name: string;
  data: Uint8Array;
  method?: number;
  externalAttributes?: number;
  descriptor?: boolean;
}

const encoder = new TextEncoder();
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/ivxpkg/${name}`, import.meta.url)));
const manifest = {
  format: "IVF",
  format_version: "0.1",
  title: "Test package",
  entry_scene: "only",
  scenes: {
    only: {
      video: "media/video.mp4",
      interactions: [],
    },
  },
} satisfies IvfManifest;

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: readonly TestFile[]): Uint8Array {
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const method = file.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(file.data) : file.data;
    const crc = crc32(file.data);
    const flags = 0x0800 | (file.descriptor ? 0x0008 : 0);

    const local = new Uint8Array(30 + name.length + compressed.length + (file.descriptor ? 16 : 0));
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    if (!file.descriptor) {
      localView.setUint32(14, crc, true);
      localView.setUint32(18, compressed.length, true);
      localView.setUint32(22, file.data.length, true);
    }
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    if (file.descriptor) {
      const descriptorOffset = 30 + name.length + compressed.length;
      localView.setUint32(descriptorOffset, 0x08074b50, true);
      localView.setUint32(descriptorOffset + 4, crc, true);
      localView.setUint32(descriptorOffset + 8, compressed.length, true);
      localView.setUint32(descriptorOffset + 12, file.data.length, true);
    }
    localRecords.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 0x0314, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, file.externalAttributes ?? 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralRecords.push(central);

    localOffset += local.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, localOffset, true);

  const result = new Uint8Array(localOffset + centralSize + eocd.length);
  let offset = 0;
  for (const record of [...localRecords, ...centralRecords, eocd]) {
    result.set(record, offset);
    offset += record.length;
  }
  return result;
}

const validFiles = (media = encoder.encode("video bytes")) => [
  { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) },
  { name: "media/video.mp4", data: media },
];

describe("inspectIvfPackage", () => {
  it.each(["valid/minimal.ivxpkg", "valid/branching.ivxpkg"])("opens the real fixture package %s", async (name) => {
    const result = await inspectIvfPackage(fixture(name));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const videoPath = result.value.manifest.scenes[result.value.manifest.entry_scene]?.video;
      expect(videoPath).toBeDefined();
      if (videoPath) {
        const video = await result.value.readFile(videoPath);
        expect(video.ok).toBe(true);
        if (video.ok) expect(new TextDecoder().decode(video.value.subarray(4, 8))).toBe("ftyp");
      }
    }
  });

  it.each([
    ["invalid/missing-manifest.ivxpkg", "IVF_MANIFEST_MISSING"],
    ["invalid/missing-asset.ivxpkg", "IVF_ASSET_MISSING"],
    ["invalid/invalid-manifest.ivxpkg", "IVF_MANIFEST_INVALID"],
    ["invalid/bad-checksum.ivxpkg", "IVF_INVALID_ARCHIVE"],
    ["invalid/truncated.ivxpkg", "IVF_INVALID_ARCHIVE"],
    ["malicious/path-traversal.ivxpkg", "IVF_UNSAFE_PATH"],
    ["malicious/high-ratio.ivxpkg", "IVF_LIMIT_EXCEEDED"],
    ["malicious/symlink.ivxpkg", "IVF_INVALID_ARCHIVE"],
    ["malicious/unsupported-compression.ivxpkg", "IVF_UNSUPPORTED_FEATURE"],
  ] as const)("rejects fixture package %s with %s", async (name, code) => {
    const result = await inspectIvfPackage(fixture(name));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe(code);
  });

  it("validates a ZIP package and reads an asset without extracting it", async () => {
    const media = encoder.encode("video bytes");
    const result = await inspectIvfPackage(makeZip(validFiles(media)));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest).toEqual(manifest);
      expect(result.value.files.has("media/video.mp4")).toBe(true);
      const read = await result.value.readFile("media/video.mp4");
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value).toEqual(media);
    }
  });

  it("accepts ZIP data descriptors", async () => {
    const files: TestFile[] = validFiles();
    files[1]!.descriptor = true;
    const result = await inspectIvfPackage(makeZip(files));
    expect(result.ok).toBe(true);
  });

  it("rejects malformed ZIP data", async () => {
    const result = await inspectIvfPackage(encoder.encode("not a ZIP"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_INVALID_ARCHIVE");
  });

  it("rejects an entry with a bad checksum", async () => {
    const zip = makeZip(validFiles());
    zip[zip.length - 23] = (zip[zip.length - 23] ?? 0) ^ 1;
    const result = await inspectIvfPackage(zip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_INVALID_ARCHIVE");
  });

  it("rejects unsupported compression methods", async () => {
    const result = await inspectIvfPackage(
      makeZip([{ name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)), method: 99 }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_UNSUPPORTED_FEATURE");
  });

  it("rejects path traversal entries", async () => {
    const result = await inspectIvfPackage(
      makeZip([...validFiles(), { name: "../outside.mp4", data: encoder.encode("x") }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_UNSAFE_PATH");
  });

  it("enforces the actual decompressed-to-compressed ratio", async () => {
    const result = await inspectIvfPackage(makeZip(validFiles(encoder.encode("x".repeat(8192)))));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_LIMIT_EXCEEDED");
  });

  it("rejects Unix symbolic-link entries", async () => {
    const symlinkMode = (0xa000 | 0o777) << 16;
    const result = await inspectIvfPackage(
      makeZip([
        { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) },
        { name: "link", data: encoder.encode("target"), externalAttributes: symlinkMode },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_INVALID_ARCHIVE");
  });

  it("rejects a package with a missing referenced asset", async () => {
    const result = await inspectIvfPackage(
      makeZip([{ name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("IVF_ASSET_MISSING");
  });
});

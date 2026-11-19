import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const fixturesDirectory = fileURLToPath(new URL("../fixtures", import.meta.url));
const encoder = new TextEncoder();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data;
    const method = file.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = file.crcOverride ?? crc32(data);

    const local = new Uint8Array(30 + name.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);
    localRecords.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 0x0314, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, file.externalAttributes ?? 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralRecords.push(central);

    localOffset += local.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);

  return Buffer.concat([...localRecords, ...centralRecords, endRecord]);
}

function jsonFile(value) {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function singleSceneManifest(video = "media/video.mp4") {
  return {
    format: "IVF",
    format_version: "0.1",
    title: "IVF minimal test package",
    entry_scene: "only",
    scenes: {
      only: {
        video,
        interactions: [],
      },
    },
  };
}

async function mediaFile(name) {
  return new Uint8Array(await readFile(join(fixturesDirectory, "media", name)));
}

async function writeArchive(category, name, files) {
  const output = join(fixturesDirectory, "ivxpkg", category, name);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, makeZip(files));
}

const introduction = await mediaFile("introduction.mp4");
const outcomeA = await mediaFile("outcome-a.mp4");
const outcomeB = await mediaFile("outcome-b.mp4");
const minimalManifest = jsonFile(singleSceneManifest());
const minimalFiles = [
  { name: "manifest.json", data: minimalManifest },
  { name: "media/video.mp4", data: introduction },
];

await writeArchive("valid", "minimal.ivxpkg", minimalFiles);

const branchingManifest = jsonFile({
  format: "IVF",
  format_version: "0.1",
  title: "IVF branching test package",
  entry_scene: "intro",
  scenes: {
    intro: {
      video: "media/introduction.mp4",
      interactions: [
        {
          id: "choose-a-path",
          at_seconds: 1,
          type: "choice",
          prompt: "Which path should the character take?",
          options: [
            { label: "Take the green path", next_scene: "outcome-a" },
            { label: "Take the blue path", next_scene: "outcome-b" },
          ],
        },
      ],
    },
    "outcome-a": { video: "media/outcome-a.mp4", interactions: [] },
    "outcome-b": { video: "media/outcome-b.mp4", interactions: [] },
  },
});

await writeArchive("valid", "branching.ivxpkg", [
  { name: "manifest.json", data: branchingManifest },
  { name: "media/introduction.mp4", data: introduction },
  { name: "media/outcome-a.mp4", data: outcomeA },
  { name: "media/outcome-b.mp4", data: outcomeB },
]);

await writeArchive("invalid", "missing-manifest.ivxpkg", [
  { name: "media/video.mp4", data: introduction },
]);

await writeArchive("invalid", "missing-asset.ivxpkg", [
  { name: "manifest.json", data: minimalManifest },
]);

await writeArchive("invalid", "invalid-manifest.ivxpkg", [
  { name: "manifest.json", data: encoder.encode("{ invalid JSON") },
]);

await writeArchive("invalid", "bad-checksum.ivxpkg", [
  { name: "manifest.json", data: minimalManifest },
  { name: "media/video.mp4", data: introduction, crcOverride: 0 },
]);

await writeArchive("malicious", "path-traversal.ivxpkg", [
  ...minimalFiles,
  { name: "../outside.txt", data: encoder.encode("outside package") },
]);

await writeArchive("malicious", "high-ratio.ivxpkg", [
  { name: "manifest.json", data: minimalManifest },
  { name: "media/video.mp4", data: encoder.encode("x".repeat(16_384)) },
]);

await writeArchive("malicious", "symlink.ivxpkg", [
  ...minimalFiles,
  { name: "media/link", data: encoder.encode("video.mp4"), externalAttributes: (0xa000 | 0o777) << 16 },
]);

await writeArchive("malicious", "unsupported-compression.ivxpkg", [
  { name: "manifest.json", data: minimalManifest },
  { name: "media/video.mp4", data: introduction, method: 99 },
]);

const truncated = makeZip(minimalFiles).slice(0, -5);
const truncatedPath = join(fixturesDirectory, "ivxpkg", "invalid", "truncated.ivxpkg");
await mkdir(dirname(truncatedPath), { recursive: true });
await writeFile(truncatedPath, truncated);

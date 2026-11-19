import { failure, type ValidationResult } from "./errors";
import { validateArchiveEntries, type ArchiveEntry, type ArchiveEntryKind } from "./entries";
import { LIMITS } from "./limits";
import { checkPackagePath } from "./paths";
import { validateManifest, type IvfManifest } from "./manifest";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const STREAM_CHUNK_BYTES = 64 * 1024;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ALLOWED_FLAGS = UTF8_FLAG | DATA_DESCRIPTOR_FLAG | 0x0006;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

interface ZipRecord {
  path: string;
  kind: ArchiveEntryKind;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

interface ParsedZip {
  records: ZipRecord[];
  entries: ArchiveEntry[];
}

export interface InspectedIvfPackage {
  manifest: IvfManifest;
  /** NFC-normalized paths of all file entries. */
  files: ReadonlySet<string>;
  /** Reads a validated package file in memory without extracting it to disk. */
  readFile(path: string): Promise<ValidationResult<Uint8Array>>;
}

class ArchiveIssue extends Error {
  constructor(
    readonly code: "IVF_INVALID_ARCHIVE" | "IVF_LIMIT_EXCEEDED" | "IVF_UNSUPPORTED_FEATURE" | "IVF_UNSAFE_PATH",
    message: string,
    readonly location?: string,
  ) {
    super(message);
  }
}

function isRangeValid(start: number, length: number, end: number): boolean {
  return Number.isSafeInteger(start) && Number.isSafeInteger(length) && start >= 0 && length >= 0 && start <= end && length <= end - start;
}

function zipFailure(message = "Package is not a valid supported ZIP archive."): ArchiveIssue {
  return new ArchiveIssue("IVF_INVALID_ARCHIVE", message);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function readName(bytes: Uint8Array, flags: number): string {
  if ((flags & UTF8_FLAG) === 0 && bytes.some((byte) => byte > 0x7f)) {
    throw zipFailure("Archive filenames must use UTF-8.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw zipFailure("Archive contains an invalid filename.");
  }
}

function validateExtraFields(bytes: Uint8Array): void {
  const view = viewOf(bytes);
  let offset = 0;
  while (offset < bytes.length) {
    if (!isRangeValid(offset, 4, bytes.length)) throw zipFailure();
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    offset += 4;
    if (!isRangeValid(offset, size, bytes.length)) throw zipFailure();
    if (id === 0x0001) throw zipFailure("ZIP64 archives are not supported.");
    offset += size;
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  if (bytes.length < 22) throw zipFailure();
  const view = viewOf(bytes);
  const firstPossibleOffset = Math.max(0, bytes.length - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = bytes.length - 22; offset >= firstPossibleOffset; offset--) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw zipFailure();
}

function classifyEntry(name: string, madeBy: number, externalAttributes: number): ArchiveEntryKind {
  const unixMode = externalAttributes >>> 16;
  const unixType = unixMode & 0xf000;
  if ((madeBy >>> 8) === 3 && unixType !== 0) {
    if (unixType === 0xa000) return "symlink";
    if (unixType !== 0x8000 && unixType !== 0x4000) return "other";
    if (unixType === 0x4000) return "directory";
  }
  if (name.endsWith("/") || (externalAttributes & 0x10) !== 0) return "directory";
  return "file";
}

function parseZip(bytes: Uint8Array): ParsedZip {
  const view = viewOf(bytes);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw zipFailure("Multi-disk and ZIP64 archives are not supported.");
  }
  if (entryCount > LIMITS.maxArchiveEntries) {
    throw new ArchiveIssue("IVF_LIMIT_EXCEEDED", "Archive has too many entries.");
  }
  if (!isRangeValid(centralOffset, centralSize, eocdOffset) || centralOffset + centralSize !== eocdOffset) {
    throw zipFailure();
  }

  const records: ZipRecord[] = [];
  const entries: ArchiveEntry[] = [];
  const localRanges: Array<{ start: number; end: number }> = [];
  let centralCursor = centralOffset;

  for (let index = 0; index < entryCount; index++) {
    if (!isRangeValid(centralCursor, 46, centralOffset + centralSize)) throw zipFailure();
    if (view.getUint32(centralCursor, true) !== CENTRAL_DIRECTORY_FILE_HEADER) throw zipFailure();

    const madeBy = view.getUint16(centralCursor + 4, true);
    const flags = view.getUint16(centralCursor + 8, true);
    const method = view.getUint16(centralCursor + 10, true);
    const crc32 = view.getUint32(centralCursor + 16, true);
    const compressedSize = view.getUint32(centralCursor + 20, true);
    const uncompressedSize = view.getUint32(centralCursor + 24, true);
    const nameLength = view.getUint16(centralCursor + 28, true);
    const extraLength = view.getUint16(centralCursor + 30, true);
    const commentLength = view.getUint16(centralCursor + 32, true);
    const startDisk = view.getUint16(centralCursor + 34, true);
    const externalAttributes = view.getUint32(centralCursor + 38, true);
    const localOffset = view.getUint32(centralCursor + 42, true);
    const variableLength = nameLength + extraLength + commentLength;
    if (nameLength === 0 || !isRangeValid(centralCursor + 46, variableLength, centralOffset + centralSize)) {
      throw zipFailure();
    }
    if (startDisk !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw zipFailure("Multi-disk and ZIP64 archives are not supported.");
    }
    if ((flags & (0x0001 | 0x0040 | 0x2000)) !== 0) {
      throw new ArchiveIssue("IVF_UNSUPPORTED_FEATURE", "Encrypted ZIP entries are not supported.");
    }
    if ((flags & ~ALLOWED_FLAGS) !== 0 || ((flags & 0x0006) !== 0 && method !== 8)) throw zipFailure();
    if (method !== 0 && method !== 8) {
      throw new ArchiveIssue("IVF_UNSUPPORTED_FEATURE", "Archive uses an unsupported compression method.");
    }
    if (method === 0 && compressedSize !== uncompressedSize) throw zipFailure();

    const nameStart = centralCursor + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const name = readName(nameBytes, flags);
    validateExtraFields(bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength));
    const kind = classifyEntry(name, madeBy, externalAttributes);

    if (!isRangeValid(localOffset, 30, centralOffset)) throw zipFailure();
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) throw zipFailure();
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localVariableLength = localNameLength + localExtraLength;
    if (!isRangeValid(localOffset + 30, localVariableLength, centralOffset)) throw zipFailure();
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength) throw zipFailure();
    const localNameStart = localOffset + 30;
    if (!equalBytes(bytes.subarray(localNameStart, localNameStart + localNameLength), nameBytes)) throw zipFailure();
    validateExtraFields(bytes.subarray(localNameStart + localNameLength, localNameStart + localVariableLength));

    const dataOffset = localOffset + 30 + localVariableLength;
    if (!isRangeValid(dataOffset, compressedSize, centralOffset)) throw zipFailure();
    const dataEnd = dataOffset + compressedSize;
    if ((flags & DATA_DESCRIPTOR_FLAG) === 0) {
      if (localCrc !== crc32 || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize) {
        throw zipFailure();
      }
    } else if (
      (localCrc !== 0 && localCrc !== crc32) ||
      (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
      (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)
    ) {
      throw zipFailure();
    }

    let recordEnd = dataEnd;
    if ((flags & DATA_DESCRIPTOR_FLAG) !== 0) {
      const descriptorOffset = dataEnd;
      const hasSignature = isRangeValid(descriptorOffset, 16, centralOffset) &&
        view.getUint32(descriptorOffset, true) === DATA_DESCRIPTOR &&
        view.getUint32(descriptorOffset + 4, true) === crc32 &&
        view.getUint32(descriptorOffset + 8, true) === compressedSize &&
        view.getUint32(descriptorOffset + 12, true) === uncompressedSize;
      const withoutSignature = isRangeValid(descriptorOffset, 12, centralOffset) &&
        view.getUint32(descriptorOffset, true) === crc32 &&
        view.getUint32(descriptorOffset + 4, true) === compressedSize &&
        view.getUint32(descriptorOffset + 8, true) === uncompressedSize;
      if (!hasSignature && !withoutSignature) throw zipFailure();
      recordEnd += hasSignature ? 16 : 12;
    }

    if (kind === "directory" && (compressedSize !== 0 || uncompressedSize !== 0)) throw zipFailure();
    records.push({ path: name, kind, method, crc32, compressedSize, uncompressedSize, dataOffset });
    entries.push({ path: name, kind });
    localRanges.push({ start: localOffset, end: recordEnd });
    centralCursor += 46 + variableLength;
  }

  if (centralCursor !== centralOffset + centralSize) throw zipFailure();
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index++) {
    const previous = localRanges[index - 1];
    const current = localRanges[index];
    if (previous && current && current.start < previous.end) throw zipFailure();
  }

  return { records, entries };
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let current = crc;
  for (const byte of bytes) {
    current = (current >>> 8) ^ CRC32_TABLE[(current ^ byte) & 0xff]!;
  }
  return current >>> 0;
}

interface DecompressedFile {
  byteLength: number;
  crc32: number;
  chunks: Uint8Array[];
}

async function decompressRecord(
  archive: Uint8Array,
  record: ZipRecord,
  packageTotal?: { value: number },
): Promise<ValidationResult<DecompressedFile>> {
  const maxBytes = record.path === "manifest.json" ? LIMITS.maxManifestBytes : LIMITS.maxAssetBytes;
  if (record.uncompressedSize > maxBytes) {
    return failure("IVF_LIMIT_EXCEEDED", "An archive entry exceeds its size limit.", record.path);
  }

  let byteLength = 0;
  let crc32 = 0xffffffff;
  const chunks: Uint8Array[] = [];
  const consume = (chunk: Uint8Array): void => {
    byteLength += chunk.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
      throw new ArchiveIssue("IVF_LIMIT_EXCEEDED", "An archive entry exceeds its size limit.", record.path);
    }
    if (byteLength > record.compressedSize * LIMITS.maxCompressionRatio) {
      throw new ArchiveIssue("IVF_LIMIT_EXCEEDED", "An archive entry exceeds the compression-ratio limit.", record.path);
    }
    if (packageTotal) {
      packageTotal.value += chunk.byteLength;
      if (!Number.isSafeInteger(packageTotal.value) || packageTotal.value > LIMITS.maxUncompressedPackageBytes) {
        throw new ArchiveIssue("IVF_LIMIT_EXCEEDED", "Package exceeds the uncompressed size limit.", record.path);
      }
    }
    crc32 = updateCrc32(crc32, chunk);
    if (record.path === "manifest.json" || packageTotal === undefined) chunks.push(chunk);
  };

  try {
    if (record.method === 0) {
      const end = record.dataOffset + record.compressedSize;
      for (let offset = record.dataOffset; offset < end; offset += STREAM_CHUNK_BYTES) {
        consume(archive.subarray(offset, Math.min(end, offset + STREAM_CHUNK_BYTES)));
      }
    } else {
      let offset = record.dataOffset;
      const end = record.dataOffset + record.compressedSize;
      const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
          if (offset >= end) {
            controller.close();
            return;
          }
          const next = Math.min(end, offset + STREAM_CHUNK_BYTES);
          controller.enqueue(Uint8Array.from(archive.subarray(offset, next)));
          offset = next;
        },
      });
      const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) consume(value);
      }
    }
  } catch (error) {
    if (error instanceof ArchiveIssue) {
      return failure(error.code, error.message, error.location);
    }
    if (error instanceof TypeError || error instanceof DOMException) {
      return failure("IVF_INVALID_ARCHIVE", "An archive entry could not be decompressed.", record.path);
    }
    throw error;
  }

  crc32 = (crc32 ^ 0xffffffff) >>> 0;
  if (byteLength !== record.uncompressedSize || crc32 !== record.crc32) {
    return failure("IVF_INVALID_ARCHIVE", "An archive entry failed its size or checksum check.", record.path);
  }
  return { ok: true, value: { byteLength, crc32, chunks }, warnings: [] };
}

function joinChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function supportsDeflateRaw(): boolean {
  if (typeof DecompressionStream === "undefined") return false;
  try {
    new DecompressionStream("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspects an IVF ZIP archive without extracting files. ZIP metadata is checked
 * structurally, while actual decompressed byte counts and CRCs are verified.
 */
export async function inspectIvfPackage(input: Uint8Array): Promise<ValidationResult<InspectedIvfPackage>> {
  if (input.byteLength > LIMITS.maxPackageBytes) {
    return failure("IVF_LIMIT_EXCEEDED", "Package exceeds the compressed size limit.");
  }

  let parsed: ParsedZip;
  try {
    parsed = parseZip(input);
  } catch (error) {
    if (error instanceof ArchiveIssue) return failure(error.code, error.message, error.location);
    throw error;
  }

  const validatedEntries = validateArchiveEntries(parsed.entries);
  if (!validatedEntries.ok) return validatedEntries;
  if (parsed.records.some((record) => record.method === 8) && !supportsDeflateRaw()) {
    return failure("IVF_UNSUPPORTED_FEATURE", "Deflate decompression is unavailable in this player.");
  }

  const packageTotal = { value: 0 };
  let manifestBytes: Uint8Array | undefined;
  for (const record of parsed.records) {
    if (record.kind === "directory") continue;
    const decompressed = await decompressRecord(input, record, packageTotal);
    if (!decompressed.ok) return decompressed;
    if (record.path === "manifest.json") {
      manifestBytes = joinChunks(decompressed.value.chunks, decompressed.value.byteLength);
    }
  }

  if (!manifestBytes) return failure("IVF_MANIFEST_MISSING", "manifest.json was not found at the archive root.");
  const manifestResult = validateManifest(manifestBytes, { archiveFiles: validatedEntries.value.files });
  if (!manifestResult.ok) return manifestResult;

  const recordsByPath = new Map<string, ZipRecord>();
  for (const record of parsed.records) {
    if (record.kind === "file") recordsByPath.set(record.path, record);
  }

  return {
    ok: true,
    value: {
      manifest: manifestResult.value,
      files: validatedEntries.value.files,
      async readFile(path) {
        const checked = checkPackagePath(path);
        if (!checked.ok) return failure(checked.code, "Invalid package path.", path);
        const record = recordsByPath.get(checked.path);
        if (!record) return failure("IVF_ASSET_MISSING", "Package file was not found.", checked.path);
        const result = await decompressRecord(input, record);
        if (!result.ok) return result;
        return { ok: true, value: joinChunks(result.value.chunks, result.value.byteLength), warnings: [] };
      },
    },
    warnings: manifestResult.warnings,
  };
}

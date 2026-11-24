/**
 * Browser-compatible Figma .fig file decoder.
 *
 * .fig files are ZIP archives containing:
 * - canvas.fig — fig-kiwi binary archive (schema + kiwi-encoded message)
 * - meta.json — file metadata
 * - images/<hash> — image files keyed by content hash
 *
 * No Node.js APIs — works in browser environments.
 */
import { decodeBinarySchema, compileSchema } from 'kiwi-schema';
import pako from 'pako';
import { decompress } from 'fzstd';

const FIG_KIWI_PRELUDE = 'fig-kiwi';

interface KiwiMessageDecoder {
  decodeMessage(data: Uint8Array): unknown;
}

// ---- fig-kiwi archive parser ----

function parseArchive(buffer: Uint8Array): { version: number; files: Uint8Array[] } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  const prelude = new TextDecoder().decode(buffer.subarray(0, FIG_KIWI_PRELUDE.length));

  if (prelude !== FIG_KIWI_PRELUDE) {
    throw new Error('Invalid fig-kiwi prelude: ' + prelude);
  }
  offset = FIG_KIWI_PRELUDE.length;

  const version = view.getUint32(offset, true);

  offset += 4;

  const files: Uint8Array[] = [];

  while (offset + 4 <= buffer.length) {
    const size = view.getUint32(offset, true);

    offset += 4;
    files.push(buffer.slice(offset, offset + size));
    offset += size;
  }

  return { version, files };
}

/**
 * Decompress a buffer that may be raw deflate or Zstandard compressed.
 * .fig files (version >= 100) use zstd for the message data.
 */
function decompressArchiveFile(data: Uint8Array): Uint8Array {
  if (data.length >= 4 && data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) {
    return decompress(data);
  }

  return pako.inflateRaw(data);
}

function decodeArchiveMessage(archiveBytes: Uint8Array): Record<string, unknown> {
  const { files } = parseArchive(archiveBytes);

  if (files.length < 2) {
    throw new Error('fig-kiwi archive must contain at least 2 files (schema + data)');
  }

  const schemaRaw = decompressArchiveFile(files[0]);
  const schema = decodeBinarySchema(schemaRaw);
  const compiled = compileSchema(schema) as KiwiMessageDecoder;

  const dataRaw = decompressArchiveFile(files[1]);

  const decoded = compiled.decodeMessage(dataRaw);

  if (decoded === null || typeof decoded !== 'object') {
    throw new Error('Decoded fig-kiwi message is not an object');
  }

  return decoded as Record<string, unknown>;
}

// ---- Minimal ZIP reader (browser-compatible) ----

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function decodeZipEntryName(bytes: Uint8Array): string {
  // ZIP entry names are UTF-8 for Figma .fig files; TextDecoder avoids
  // spread/concat transpilation quirks seen with String.fromCharCode(...bytes).
  return new TextDecoder().decode(bytes);
}

function readZipEntries(buffer: Uint8Array): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Find End of Central Directory record (scan backward for signature 0x06054b50)
  let eocdOffset = -1;

  for (let i = buffer.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;

      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP: End of Central Directory not found');
  }

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);

  // Parse Central Directory entries
  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (pos < cdEnd) {
    if (view.getUint32(pos, true) !== 0x02014b50) {
      break;
    }

    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const nameBytes = buffer.subarray(pos + 46, pos + 46 + nameLen);
    const name = decodeZipEntryName(nameBytes);

    // Jump to local file header to locate data
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;

    if (method === 0) {
      data = compressed; // stored
    } else if (method === 8) {
      data = pako.inflateRaw(compressed); // deflate
    } else {
      pos += 46 + nameLen + extraLen + commentLen;
      continue; // skip unsupported methods
    }

    entries.push({ name, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ---- Public API ----

export interface DecodedFigFile {
  meta: Record<string, unknown>;
  message: Record<string, unknown>;
  images: Map<string, Uint8Array>;
}

/**
 * Decode a Figma .fig file (ZIP archive) -> message + images.
 *
 * Pipeline: ZIP -> extract canvas.fig -> parseArchive -> kiwi decode -> message
 *           ZIP -> extract images/* -> Map<hash, bytes>
 *           ZIP -> extract meta.json -> meta
 */
export function decodeFigFile(data: Uint8Array): DecodedFigFile {
  const entries = readZipEntries(data);

  // Find canvas.fig (fig-kiwi archive)
  const canvasEntry = entries.find(e => e.name === 'canvas.fig');

  if (!canvasEntry) {
    throw new Error('.fig file does not contain canvas.fig');
  }
  const message = decodeArchiveMessage(canvasEntry.data);

  // Parse meta.json
  let meta: Record<string, unknown> = {};
  const metaEntry = entries.find(e => e.name === 'meta.json');

  if (metaEntry) {
    const text = new TextDecoder().decode(metaEntry.data);

    meta = JSON.parse(text) as Record<string, unknown>;
  }

  // Collect images (images/<hash> -> bytes)
  const images = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (entry.name.startsWith('images/') && entry.name !== 'images/' && entry.data.length > 0) {
      const hash = entry.name.slice('images/'.length);

      images.set(hash, entry.data);
    }
  }

  // Inject ZIP images into message blobs so the message is self-contained.
  // .fig files store images in the ZIP images/ directory, not in the kiwi
  // message blobs. Without this step, serializing the message to JSON and
  // loading it back (without imagesByHash) would lose all image data.
  if (images.size > 0) {
    injectImagesIntoBlobs(message, images);
  }

  return { meta, message, images };
}

// ---- Image injection helpers ----

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Inject ZIP images into the message's blobs array and patch fillPaints
 * IMAGE entries so their dataBlob indices reference the new blobs.
 */
function injectImagesIntoBlobs(message: Record<string, unknown>, images: Map<string, Uint8Array>): void {
  const blobs: unknown[] = Array.isArray(message.blobs) ? message.blobs : [];
  const nodeChanges = Array.isArray(message.nodeChanges) ? message.nodeChanges : [];

  // hash (hex string) → new blob index
  const hashToBlobIdx = new Map<string, number>();

  for (const [hash, bytes] of images) {
    hashToBlobIdx.set(hash, blobs.length);
    // Wrap as { bytes } to match kiwi blob format, ensuring correct
    // parsing after JSON round-trip (numeric-keyed object → parseBlobBytes).
    blobs.push({ bytes });
  }

  // Patch dataBlob in IMAGE fills to reference the injected blobs
  for (const raw of nodeChanges) {
    if (raw === null || typeof raw !== 'object') {
      continue;
    }
    const nc = raw as Record<string, unknown>;
    const fills = nc.fillPaints;

    if (!Array.isArray(fills)) {
      continue;
    }

    for (const fill of fills) {
      if (fill === null || typeof fill !== 'object') {
        continue;
      }
      const paint = fill as Record<string, unknown>;

      // IMAGE paint type: integer 5 or string "IMAGE"
      if (paint.type !== 5 && paint.type !== 'IMAGE') {
        continue;
      }

      const img = paint.image as Record<string, unknown> | undefined;
      const hash = img?.hash;

      if (img === undefined || hash === undefined) {
        continue;
      }

      const hashHex = hash instanceof Uint8Array ? uint8ArrayToHex(hash) : typeof hash === 'string' ? hash : undefined;

      if (hashHex === undefined || hashHex.length === 0) {
        continue;
      }

      const idx = hashToBlobIdx.get(hashHex);

      if (idx !== undefined) {
        img.dataBlob = idx;
      }
    }
  }

  message.blobs = blobs;
}

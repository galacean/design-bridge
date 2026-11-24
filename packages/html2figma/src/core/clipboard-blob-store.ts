import type { FigmaBlob } from '../types';

/** Category of binary data counted in a clipboard or file export. */
export type ClipboardBlobKind = 'glyph' | 'image' | 'vector';

/** Blob reference and deduplication statistics for an export or data category. */
export interface ClipboardBlobKindStats {
  /** Number of blob references before deduplication. */
  references: number;
  /** Number of unique blobs retained. */
  unique: number;
  /** Referenced byte count before deduplication. */
  bytes: number;
  /** Byte count saved by reusing existing blobs. */
  deduplicatedBytes: number;
}

/** Aggregate blob statistics with a breakdown by glyph, image, and vector data. */
export interface ClipboardBlobStats extends ClipboardBlobKindStats {
  /** Per-category reference and deduplication statistics. */
  byKind: Record<ClipboardBlobKind, ClipboardBlobKindStats>;
}

function createKindStats(): ClipboardBlobKindStats {
  return { references: 0, unique: 0, bytes: 0, deduplicatedBytes: 0 };
}

export class ClipboardBlobStore {
  readonly blobs: FigmaBlob[];

  private readonly indexesByDigest = new Map<string, number[]>();
  private readonly statsByKind: Record<ClipboardBlobKind, ClipboardBlobKindStats> = {
    glyph: createKindStats(),
    image: createKindStats(),
    vector: createKindStats(),
  };

  constructor(blobs: FigmaBlob[] = []) {
    this.blobs = blobs;

    for (let index = 0; index < blobs.length; index++) {
      this.registerIndex(index, Uint8Array.from(blobs[index].bytes));
    }
  }

  add(kind: ClipboardBlobKind, bytes: Uint8Array): number {
    const kindStats = this.statsByKind[kind];

    kindStats.references += 1;
    kindStats.bytes += bytes.byteLength;

    const digest = createDigest(bytes);
    const candidates = this.indexesByDigest.get(digest) ?? [];

    for (const index of candidates) {
      if (bytesEqual(this.blobs[index].bytes, bytes)) {
        kindStats.deduplicatedBytes += bytes.byteLength;

        return index;
      }
    }

    const index = this.blobs.length;

    this.blobs.push({ bytes: Array.from(bytes) });
    this.registerIndex(index, bytes);
    kindStats.unique += 1;

    return index;
  }

  getStats(): ClipboardBlobStats {
    const byKind = {
      glyph: { ...this.statsByKind.glyph },
      image: { ...this.statsByKind.image },
      vector: { ...this.statsByKind.vector },
    };

    return {
      references: byKind.glyph.references + byKind.image.references + byKind.vector.references,
      unique: this.blobs.length,
      bytes: byKind.glyph.bytes + byKind.image.bytes + byKind.vector.bytes,
      deduplicatedBytes:
        byKind.glyph.deduplicatedBytes + byKind.image.deduplicatedBytes + byKind.vector.deduplicatedBytes,
      byKind,
    };
  }

  private registerIndex(index: number, bytes: Uint8Array): void {
    const digest = createDigest(bytes);
    const indexes = this.indexesByDigest.get(digest) ?? [];

    indexes.push(index);
    this.indexesByDigest.set(digest, indexes);
  }
}

export function toClipboardBlobStore(value: ClipboardBlobStore | FigmaBlob[]): ClipboardBlobStore {
  return value instanceof ClipboardBlobStore ? value : new ClipboardBlobStore(value);
}

function createDigest(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `${bytes.byteLength}:${hash >>> 0}`;
}

function bytesEqual(existing: number[], candidate: Uint8Array): boolean {
  if (existing.length !== candidate.length) {
    return false;
  }

  for (let index = 0; index < existing.length; index++) {
    if (existing[index] !== candidate[index]) {
      return false;
    }
  }

  return true;
}

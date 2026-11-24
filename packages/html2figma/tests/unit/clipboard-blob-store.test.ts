import { describe, expect, it } from 'vitest';
import { ClipboardBlobStore } from '../../src/core/clipboard-blob-store';

describe('ClipboardBlobStore', () => {
  it('reuses byte-identical blobs across resource kinds', () => {
    const store = new ClipboardBlobStore();
    const bytes = Uint8Array.from([1, 2, 3, 4]);

    const imageIndex = store.add('image', bytes);
    const duplicateImageIndex = store.add('image', Uint8Array.from(bytes));
    const vectorIndex = store.add('vector', Uint8Array.from(bytes));

    expect(imageIndex).toBe(0);
    expect(duplicateImageIndex).toBe(0);
    expect(vectorIndex).toBe(0);
    expect(store.blobs).toEqual([{ bytes: [1, 2, 3, 4] }]);
    expect(store.getStats()).toMatchObject({
      references: 3,
      unique: 1,
      bytes: 12,
      deduplicatedBytes: 8,
      byKind: {
        image: { references: 2, unique: 1, bytes: 8, deduplicatedBytes: 4 },
        vector: { references: 1, unique: 0, bytes: 4, deduplicatedBytes: 4 },
      },
    });
  });

  it('keeps distinct byte sequences as separate blobs', () => {
    const store = new ClipboardBlobStore();

    expect(store.add('glyph', Uint8Array.from([1, 2, 3]))).toBe(0);
    expect(store.add('glyph', Uint8Array.from([1, 2, 4]))).toBe(1);
    expect(store.blobs).toHaveLength(2);
  });
});

import JSZip from 'jszip';
import { decompress } from '@bokuweb/zstd-wasm';
import { describe, expect, it } from 'vitest';
import type { FigmaClipboardResult } from '../../src/core/figma-clipboard';
import { createFigmaFileFromClipboardResult } from '../../src/core/figma-file';
import { parseArchive, pako, writeArchive } from '../../src/core/kiwi-archive';

const MESSAGE_BYTES = Uint8Array.from([7, 8, 9]);

function makeClipboardResult(): FigmaClipboardResult {
  return {
    html: '<span></span>',
    archiveData: writeArchive([
      pako.deflateRaw(Uint8Array.from([1, 2, 3])),
      pako.deflateRaw(MESSAGE_BYTES),
    ]),
    currentClipboardArchiveData: writeArchive([
      pako.deflateRaw(Uint8Array.from([1, 2, 3])),
      pako.deflateRaw(MESSAGE_BYTES),
    ]),
    imageEntries: [{ name: 'images/010203', data: Uint8Array.from([4, 5, 6]) }],
    blobStats: {
      references: 1,
      unique: 1,
      bytes: 3,
      deduplicatedBytes: 0,
      byKind: {
        glyph: { references: 0, unique: 0, bytes: 0, deduplicatedBytes: 0 },
        image: { references: 1, unique: 1, bytes: 3, deduplicatedBytes: 0 },
        vector: { references: 0, unique: 0, bytes: 0, deduplicatedBytes: 0 },
      },
    },
  };
}

describe('Figma file generation', () => {
  it('writes the canonical .fig ZIP entries and metadata', async () => {
    const result = await createFigmaFileFromClipboardResult(makeClipboardResult(), {
      createdAt: '2026-09-28T00:00:00.000Z',
      documentName: 'Example',
      renderBounds: { x: -10, y: -20, width: 320, height: 240 },
    }, false);
    const zip = await JSZip.loadAsync(result.bytes);

    const canvas = await zip.file('canvas.fig')!.async('uint8array');
    const parsedCanvas = parseArchive(canvas);

    expect(parsedCanvas.header.version).toBe(106);
    expect(decompress(parsedCanvas.files[1])).toEqual(MESSAGE_BYTES);
    expect(await zip.file('images/010203')?.async('uint8array')).toEqual(Uint8Array.from([4, 5, 6]));
    expect(await zip.file('thumbnail.png')?.async('uint8array')).toEqual(expect.any(Uint8Array));
    expect(JSON.parse(await zip.file('meta.json')!.async('text'))).toEqual({
      client_meta: {
        background_color: { r: 0, g: 0, b: 0, a: 0 },
        thumbnail_size: { width: 1, height: 1 },
        render_coordinates: { x: -10, y: -20, width: 320, height: 240 },
      },
      file_name: 'Example',
      developer_related_links: [],
      exported_at: '2026-09-28T00:00:00.000Z',
    });
    expect(result.imageCount).toBe(1);
    expect(result.validation.warnings).toContain('Validation skipped by the low-level caller.');
    expect(result.blobStats).toEqual(makeClipboardResult().blobStats);
  });
});

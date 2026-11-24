import type { Font } from 'fontkit';
import { expect, it } from 'vitest';
import { ClipboardBlobStore } from '../../src/core/clipboard-blob-store';
import { shapeFontLigatures } from '../../src/core/shape-font-ligatures';

it.each(['rtl', 'offset', 'reordered', 'missing'])('retains the old path for %s runs', mode => {
  const face = {
    unitsPerEm: 1000,
    layout: () => ({
      direction: mode === 'rtl' ? 'rtl' : 'ltr',
      glyphs: [{ id: mode === 'missing' ? 0 : 1, codePoints: mode === 'reordered' ? [105, 102] : [102, 105] }],
      positions: [{ xOffset: mode === 'offset' ? 10 : 0, yOffset: 0, yAdvance: 0 }],
    }),
  } as unknown as Font;
  const store = new ClipboardBlobStore();

  expect(shapeFontLigatures(face, 'fi', store)).toEqual([]);
  expect(store.blobs).toEqual([]);
});

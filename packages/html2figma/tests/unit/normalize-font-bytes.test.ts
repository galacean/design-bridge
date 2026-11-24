import fs from 'node:fs/promises';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { normalizeFontBytes } from '../../src/core/normalize-font-bytes';
import { createFigmaFile } from '@galacean/html2figma';
import { makeSceneNode } from '../helpers/scene-factories';

describe('variable WOFF2 normalization', () => {
  it('prepares variable font sources through the public asynchronous Node file API', async () => {
    const fontSource = new URL('../fixtures/html/assets/noto-sans-sc-variable-subset.woff2', import.meta.url).pathname;
    const root = makeSceneNode({ children: [400, 700].map(fontWeight => makeSceneNode({
      type: 'text', text: '三', fontSource,
      styles: { fontFamily: 'Noto Sans SC', fontWeight: String(fontWeight), fontSize: '20px' },
      ir: {
        figmaType: 'TEXT', opacity: 1, isAbsolute: false, fills: [], effects: [], clipsContent: false, flexGrow: 0,
        textProps: {
          fontFamily: 'Noto Sans SC', fontSize: 20, fontWeight, lineHeightPx: 24, letterSpacing: 0,
          color: { r: 0, g: 0, b: 0, a: 1 }, textAlign: 'LEFT',
        },
      },
    })) });
    const result = await createFigmaFile([{ name: 'Variable weights', sceneData: root }]);

    expect(result.validation.valid).toBe(true);
    expect(result.blobStats.byKind.glyph.unique).toBe(2);
  });

  it('retains weight variations and cmap in a real subset font', async () => {
    // Google Fonts Noto Sans SC, SIL OFL; see the adjacent NOTO-SANS-SC-LICENSE.txt.
    const source = await fs.readFile(new URL('../fixtures/html/assets/noto-sans-sc-variable-subset.woff2', import.meta.url));
    const normalized = await normalizeFontBytes(source);
    const face = fontkit.create(normalized as unknown as Parameters<typeof fontkit.create>[0]);

    if ('fonts' in face) {
      throw new Error('Expected a single font face.');
    }
    const codePoint = face.characterSet.find(value => value > 32);

    expect(codePoint).toBeDefined();
    const regular = face.getVariation({ wght: 400 }).glyphForCodePoint(codePoint!);
    const bold = face.getVariation({ wght: 700 }).glyphForCodePoint(codePoint!);

    expect(regular.id).toBeGreaterThan(0);
    expect(bold.id).toBe(regular.id);
    expect(bold.path.commands).not.toEqual(regular.path.commands);
  });

  it('leaves static WOFF2 and non-WOFF2 input unchanged', async () => {
    const staticFont = await fs.readFile(new URL('../fixtures/html/assets/inter-latin-400-normal.woff2', import.meta.url));
    const other = Uint8Array.from([0, 1, 0, 0]);

    expect(await normalizeFontBytes(staticFont)).toBe(staticFont);
    expect(await normalizeFontBytes(other)).toBe(other);
  });

  it('rejects oversized WOFF2 before decoding its tables', async () => {
    const bytes = new Uint8Array(48);
    const view = new DataView(bytes.buffer);

    view.setUint32(0, 0x774f4632);
    view.setUint32(16, 31 * 1024 * 1024);

    await expect(normalizeFontBytes(bytes)).rejects.toThrow('30 MB');
  });
});

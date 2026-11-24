import fs from 'node:fs/promises';
import * as fontkit from 'fontkit';
import { expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument, extractSceneDocument } from '@galacean/html2figma';
import { createFigmaFileFromSceneDocuments } from '@galacean/html2figma/browser/file';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { isRecord, loadHTMLFixture } from '../helpers/html-fixture';

it('preserves real font ligatures while respecting disabled ligatures and tracking on both ends', async () => {
  const fixture = await loadHTMLFixture('regressions/ligature-text');
  const document = await extractSceneDocument(fixture.html, true, {
    viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
  });
  const bytes = await fs.readFile(new URL('../fixtures/html/assets/roboto-latin-400-normal.woff2', import.meta.url));
  const face = fontkit.create(bytes);

  if ('fonts' in face) {
    throw new Error('Expected a single font.');
  }
  const text = 'office affinity ffi fi fl';
  const expectedCount = face.layout(text).glyphs.length;
  const node = await createFigmaFile([{ name: 'Ligatures', sceneData: document.root }], { requireTextGlyphs: true });
  const browser = await createFigmaFileFromSceneDocuments(createHTMLSceneDocument(document.root, {
    viewport: fixture.viewport, runtime: { kind: 'browser', engine: 'chromium' },
  }), {
    compressedSchema: await fs.readFile(new URL('../../data/figma-file-schema.bin', import.meta.url)),
    localFontAccess: 'disabled', fonts: [{ family: 'Roboto', bytes }],
  });

  expect(expectedCount).toBeLessThan(text.length);
  for (const result of [node, browser]) {
    const nodes = await decodeFigmaFileNodes(result.bytes);
    const texts = nodes.filter(value => value.type === 'TEXT');
    const counts = texts.map(value => {
      const data = value.derivedTextData;

      return isRecord(data) && Array.isArray(data.glyphs) ? data.glyphs.length : 0;
    });

    expect(counts).toEqual([expectedCount, text.length, text.length]);
    expect(texts.every(value => isRecord(value.textData) && value.textData.characters === text)).toBe(true);
  }
});

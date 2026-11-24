import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument, extractSceneDocument } from '@galacean/html2figma';
import { createFigmaFileFromSceneDocuments } from '@galacean/html2figma/browser/file';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene, isRecord, loadHTMLFixture } from '../helpers/html-fixture';

it('uses browser-measured tab stops and multiline positions without drawing tab/newline glyphs', async () => {
  const fixture = await loadHTMLFixture('regressions/tab-layout');
  const sceneDocument = await extractSceneDocument(fixture.html, true, {
    viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
  });
  const texts = flattenScene(sceneDocument.root).filter(node => node.type === 'text');

  expect(texts).toHaveLength(3);
  expect(texts.every(node => node.textMetrics?.characterPositions !== undefined)).toBe(true);
  const browser = await chromium.launch({ channel: 'chromium' });
  let expected: Array<Array<{ index: number; x: number; y: number }>>;

  try {
    const page = await browser.newPage({ viewport: fixture.viewport });

    await page.setContent(fixture.html);
    await page.evaluate(() => document.fonts.ready);
    expected = await page.evaluate(() => ['four', 'eight', 'wrapped'].map(id => {
      const element = document.getElementById(id)!;
      const text = element.firstChild!;
      const range = document.createRange();

      range.selectNodeContents(text);
      const bounds = range.getBoundingClientRect();
      const context = document.createElement('canvas').getContext('2d')!;
      const style = getComputedStyle(element);

      context.font = style.font;
      const ascent = context.measureText('A').fontBoundingBoxAscent;

      return Array.from(text.textContent ?? '').flatMap((character, index) => {
        if (/\s/.test(character)) {
          return [];
        }
        range.setStart(text, index);
        range.setEnd(text, index + 1);
        const rect = range.getBoundingClientRect();

        return [{ index, x: rect.x - bounds.x, y: rect.y - bounds.y + ascent }];
      });
    }));
  } finally {
    await browser.close();
  }
  const node = await createFigmaFile([{ name: 'Tabs', sceneData: sceneDocument.root }], { requireTextGlyphs: true });
  const inBrowser = await createFigmaFileFromSceneDocuments(createHTMLSceneDocument(sceneDocument.root, {
    viewport: fixture.viewport, runtime: { kind: 'browser', engine: 'chromium' },
  }), {
    compressedSchema: await fs.readFile(new URL('../../data/figma-file-schema.bin', import.meta.url)),
    localFontAccess: 'disabled', fonts: [{
      family: 'Roboto',
      bytes: await fs.readFile(new URL('../fixtures/html/assets/roboto-latin-400-normal.woff2', import.meta.url)),
    }],
  });

  for (const result of [node, inBrowser]) {
    const nodes = (await decodeFigmaFileNodes(result.bytes)).filter(value => value.type === 'TEXT');

    for (let index = 0; index < nodes.length; index++) {
      const textData = nodes[index].textData;

      expect(isRecord(textData) ? textData.characters : null).toBe(texts[index].text);
      const data = nodes[index].derivedTextData;

      expect(isRecord(data) && Array.isArray(data.glyphs)).toBe(true);
      if (!isRecord(data) || !Array.isArray(data.glyphs)) {
        throw new Error('Missing baked glyphs.');
      }
      const glyphs = data.glyphs.filter(isRecord);

      for (const position of expected[index]) {
        const glyph = glyphs.find(value => value.firstCharacter === position.index);

        expect(isRecord(glyph?.position) ? glyph.position.x : undefined).toBeCloseTo(position.x, 2);
        expect(isRecord(glyph?.position) ? glyph.position.y : undefined).toBeCloseTo(position.y, 2);
      }
      expect(glyphs.every(glyph => typeof glyph.firstCharacter === 'number' &&
        !['\t', '\n'].includes(texts[index].text![glyph.firstCharacter]))).toBe(true);
    }
  }
});

import fs from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument, extractSceneDocument } from '@galacean/html2figma';
import { createFigmaFileFromSceneDocuments } from '@galacean/html2figma/browser/file';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene, isRecord, loadHTMLFixture } from '../helpers/html-fixture';

it('owns transparent shared edges once and resolves hidden and conflicting borders in both files', async () => {
  const fixture = await loadHTMLFixture('regressions/table-conflicts');
  const document = await extractSceneDocument(fixture.html, true, {
    viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
  });
  const all = flattenScene(document.root);
  const transparent = all.find(node => node.name === 'transparent')!;
  const hidden = all.find(node => node.name === 'hidden')!;
  const alphaPaints = flattenScene(transparent).filter(node => node.svgContent !== undefined);
  const hiddenPaints = flattenScene(hidden).filter(node => node.svgContent !== undefined);

  expect(alphaPaints).toHaveLength(1);
  expect(alphaPaints[0].ir.fills).toEqual([{ type: 'SOLID', color: {
    r: 22 / 255, g: 100 / 255, b: 180 / 255, a: 0.4,
  } }]);
  expect(alphaPaints[0].svgContent?.match(/M/g)).toHaveLength(12);
  expect(hiddenPaints[0].svgContent?.match(/M/g)).toHaveLength(6);
  expect(all.filter(node => node.tagName === 'TD' && node.type !== 'text')
    .every(node => node.ir.border === undefined)).toBe(true);
  const node = await createFigmaFile([{ name: 'Conflict borders', sceneData: document.root }]);
  const browser = await createFigmaFileFromSceneDocuments(createHTMLSceneDocument(document.root, {
    viewport: fixture.viewport, runtime: { kind: 'browser', engine: 'chromium' },
  }), {
    compressedSchema: await fs.readFile(new URL('../../data/figma-file-schema.bin', import.meta.url)),
    localFontAccess: 'disabled', fonts: [{
      family: 'Roboto',
      bytes: await fs.readFile(new URL('../fixtures/html/assets/roboto-latin-400-normal.woff2', import.meta.url)),
    }],
  });

  for (const result of [node, browser]) {
    const nodes = await decodeFigmaFileNodes(result.bytes);
    const paints = nodes.filter(value => value.type === 'VECTOR' && value.name === 'Collapsed border paint');
    const alphas = paints.filter(value => Array.isArray(value.fillPaints) && value.fillPaints.some(paint =>
      isRecord(paint) && typeof paint.opacity === 'number' && Math.abs(paint.opacity - 0.4) < 0.000001,
    ));

    expect(result.validation.valid).toBe(true);
    expect(alphas).toHaveLength(1);
    expect(result.imageCount).toBe(0);
  }
});

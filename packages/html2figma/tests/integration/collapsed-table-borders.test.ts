import fs from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument, extractSceneDocument } from '@galacean/html2figma';
import { createFigmaFileFromSceneDocuments } from '@galacean/html2figma/browser/file';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene } from '../helpers/html-fixture';

it('assembles shared borders once while preserving separate cells and normal boxes', async () => {
  const document = await extractSceneDocument('<style>' +
    'td,.cell,.box{border:1px solid #445566;width:40px;height:24px}' +
    '.table{display:table;border-collapse:collapse}.cell{display:table-cell}' +
    '</style><table style="border-collapse:collapse"><tr><td id="collapsed"></td></tr>' +
    '<tr><td colspan="2" id="merged"></td></tr></table>' +
    '<table style="border-collapse:separate"><tr><td id="separate" style="border-collapse:collapse"></td></tr></table>' +
    '<div class="table"><div class="cell" id="css-cell"></div></div>' +
    '<table style="border-collapse:collapse"><tr>' +
    '<td id="transparent" style="border-color:rgba(68,85,102,.5)"></td></tr></table>' +
    '<table style="border-collapse:collapse"><tr><td><table style="border-collapse:separate">' +
    '<tr><td id="nested-separate"></td></tr></table></td></tr></table>' +
    '<div class="box" id="box" style="border-collapse:collapse"></div>', true, {
    networkPolicy: 'offline', scriptPolicy: 'disabled',
  });
  const scene = flattenScene(document.root);

  for (const name of ['collapsed', 'merged', 'css-cell']) {
    expect(scene.find(node => node.name === name)?.ir.border).toBeUndefined();
  }
  expect(scene.filter(node => node.name === 'Collapsed table borders')).toHaveLength(4);
  const transparent = scene.find(node => node.name === 'Collapsed border paint' &&
    node.ir.fills.some(fill => fill.type === 'SOLID' && fill.color.a === 0.5));

  expect(transparent?.svgContent?.match(/M/g)).toHaveLength(4);
  expect(scene.find(node => node.name === 'transparent')?.ir.border).toBeUndefined();
  const node = await createFigmaFile([{ name: 'Table borders', sceneData: document.root }]);
  const browser = await createFigmaFileFromSceneDocuments(createHTMLSceneDocument(document.root, {
    viewport: { width: 800, height: 600 }, runtime: { kind: 'browser', engine: 'chromium' },
  }), {
    compressedSchema: await fs.readFile(new URL('../../data/figma-file-schema.bin', import.meta.url)),
    localFontAccess: 'disabled', fonts: [],
  });

  for (const result of [node, browser]) {
    const nodes = await decodeFigmaFileNodes(result.bytes);

    for (const name of ['collapsed', 'merged', 'css-cell']) {
      expect(nodes.find(value => value.name === name)?.strokePaints ?? []).toHaveLength(0);
    }
    for (const name of ['separate', 'nested-separate', 'box']) {
      expect(nodes.find(value => value.name === name)).toMatchObject({ strokeAlign: 'INSIDE', strokeWeight: 1 });
    }
  }
});

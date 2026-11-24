import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createFigmaFile, createHTMLSceneDocument, extractSceneDocument } from '@galacean/html2figma';
import { createFigmaFileFromSceneDocuments } from '@galacean/html2figma/browser/file';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene, isRecord, loadHTMLFixture } from '../helpers/html-fixture';

describe('CSS whitespace preservation', () => {
  it.each(['pre', 'pre-wrap', 'break-spaces'])('retains leaf text for white-space:%s', async mode => {
    const text = '  A   B\u00a0 ';
    const document = await extractSceneDocument(`<span style="white-space:${mode}">${text}</span>`, true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled',
    });

    expect(flattenScene(document.root).filter(node => node.type === 'text').map(node => node.text)).toContain(text);
  });

  it('retains spaces and blank lines in Node and Browser FIG text while keeping normal collapse', async () => {
    const fixture = await loadHTMLFixture('regressions/preserved-whitespace');
    const document = await extractSceneDocument(fixture.html, true, {
      viewport: fixture.viewport, networkPolicy: 'offline', scriptPolicy: 'disabled',
    });
    const expected = [
      '  first line\n\n    indented line\n  final line  ',
      '  two   spaces\n    next line  ', '  kept   spaces  ', 'ordinary spaces',
    ];

    expect(flattenScene(document.root).filter(node => node.type === 'text').map(node => node.text)).toEqual(expected);
    const node = await createFigmaFile([{ name: 'Whitespace', sceneData: document.root }], { requireTextGlyphs: true });
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
      const texts = nodes.filter(value => value.type === 'TEXT').map(value =>
        isRecord(value.textData) ? value.textData.characters : null,
      );

      expect(texts).toEqual(expected);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createFigmaFile, extractSceneDocument } from '@galacean/html2figma';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene } from '../helpers/html-fixture';

describe('CSS layer blur', () => {
  it('preserves a standalone filter blur as an editable native effect', async () => {
    const document = await extractSceneDocument('<!doctype html><body style="margin:0">' +
      '<div id="blurred" style="width:80px;height:60px;background:red;filter:blur(8px)">' +
      '<div style="width:20px;height:20px;background:blue"></div></div>' +
      '<div id="combined" style="width:80px;height:60px;filter:blur(8px) brightness(.5)"></div></body>', true, {
      networkPolicy: 'offline', scriptPolicy: 'disabled',
    });
    const nodes = flattenScene(document.root);

    expect(nodes.find(node => node.name === 'blurred')?.ir.effects)
      .toContainEqual({ type: 'FOREGROUND_BLUR', radius: 16 });
    expect(nodes.find(node => node.name === 'combined')?.ir.effects).toEqual([]);
    const result = await createFigmaFile([{ name: 'Blurred shape', sceneData: document.root }]);
    const changes = await decodeFigmaFileNodes(result.bytes);

    expect(changes.find(node => node.name === 'blurred')?.effects)
      .toContainEqual(expect.objectContaining({ type: 'FOREGROUND_BLUR', radius: 16, visible: true }));
    expect(result.validation.valid).toBe(true);
  });
});

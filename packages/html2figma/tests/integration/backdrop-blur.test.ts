import { describe, expect, it } from 'vitest';
import { createFigmaFile, extractSceneDocument } from '@galacean/html2figma';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';
import { flattenScene } from '../helpers/html-fixture';

describe('CSS backdrop blur', () => {
  it('keeps a fixed translucent overlay and its background blur in the exported file', async () => {
    const document = await extractSceneDocument('<!doctype html><body style="margin:0">' +
      '<div style="height:400px;background:repeating-linear-gradient(black 0 5px,white 5px 10px)"></div>' +
      '<nav id="overlay" style="position:fixed;bottom:0;width:200px;height:60px;' +
      'background:rgba(255,255,255,.7);backdrop-filter:blur(12px)"></nav></body>', true, {
      viewport: { width: 200, height: 200 }, networkPolicy: 'offline', scriptPolicy: 'disabled',
    });
    const overlay = flattenScene(document.root).find(node => node.name === 'overlay');

    expect(overlay?.y).toBe(140);
    expect(overlay?.ir.effects).toContainEqual({ type: 'BACKGROUND_BLUR', radius: 24 });
    const result = await createFigmaFile([{ name: 'Backdrop', sceneData: document.root }]);
    const nodes = await decodeFigmaFileNodes(result.bytes);

    expect(nodes.find(node => node.name === 'overlay')?.transform).toMatchObject({ m12: 140 });
    expect(nodes.find(node => node.name === 'overlay')?.effects)
      .toContainEqual(expect.objectContaining({ type: 'BACKGROUND_BLUR', radius: 24, visible: true }));
  });
});

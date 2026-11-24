import { describe, expect, it } from 'vitest';
import { createFigmaFile, extractSceneDocument } from '@galacean/html2figma';
import { decodeFigmaFileNodes } from '../helpers/decode-figma-file';

describe('exported gradient geometry', () => {
  it('passes measured rectangle dimensions into diagonal paint mapping', async () => {
    const document = await extractSceneDocument('<!doctype html><body style="margin:0">' +
      '<div id="diagonal" style="width:200px;height:100px;background:linear-gradient(135deg,#f00,#00f)"></div>' +
      '<div id="horizontal" style="width:200px;height:100px;background:linear-gradient(90deg,#f00,#00f)"></div>' +
      '<div id="corner" style="width:200px;height:100px;background:linear-gradient(to bottom right,#f00,#00f)"></div>' +
      '</body>', true, { networkPolicy: 'offline', scriptPolicy: 'disabled' });
    const result = await createFigmaFile([{ name: 'Gradient geometry', sceneData: document.root }]);
    const nodes = await decodeFigmaFileNodes(result.bytes);

    expect(nodes.find(node => node.name === 'diagonal')?.fillPaints).toEqual([
      expect.objectContaining({
        type: 'GRADIENT_LINEAR',
        transform: expect.objectContaining({
          m00: expect.closeTo(-0.75), m10: expect.closeTo(-1.5),
          m02: expect.closeTo(0.875), m12: expect.closeTo(1.25),
        }),
      }),
    ]);
    expect(nodes.find(node => node.name === 'horizontal')?.fillPaints).toEqual([
      expect.objectContaining({
        type: 'GRADIENT_LINEAR',
        transform: expect.objectContaining({ m00: -1, m02: 1, m12: expect.closeTo(0.5) }),
      }),
    ]);
    expect(nodes.find(node => node.name === 'corner')?.fillPaints).toEqual([
      expect.objectContaining({
        transform: expect.objectContaining({
          m00: expect.closeTo(-0.4), m10: expect.closeTo(-1.6),
          m02: expect.closeTo(0.7), m12: expect.closeTo(1.3),
        }),
      }),
    ]);
  });
});

import type { IRImageLayer, IRLayer, IRLayerBase, IRTextLayer } from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import { buildLayerConversionSession } from '../../../../src/adapter/svg2layers/converter/layers/conversion-session';

export function buildLayerBase(id: string): IRLayerBase {
  return { id, time: { inFrame: 0, outFrame: 150 }, visible: true };
}

export function buildImageLayer(id = 'image'): IRImageLayer {
  return {
    ...buildLayerBase(id), type: 'image', content: { assetId: 'image-asset' },
    localBounds: { x: 0, y: 0, width: 20, height: 10 },
  };
}

export function buildTextLayer(id = 'text'): IRTextLayer {
  return {
    ...buildLayerBase(id), type: 'text', localBounds: { x: 0, y: 0, width: 20, height: 10 },
    content: { text: 'Hi', color: [0, 0, 0, 1], fontAssetId: 'font', fontSize: 10,
      letterSpacing: 0, lineHeight: 10, textAlign: 'left' },
  };
}

export function buildSession(layers: IRLayer[]) {
  const scene = createIRScene({
    id: 'composition', width: 200, height: 100, frameRate: 30, inPoint: 0, outPoint: 150,
    endBehavior: 'freeze', layers,
  }, [
    { id: 'image-asset', type: 'image', source: { kind: 'url', url: 'https://example.com/image.png' } },
    { id: 'font', type: 'font', family: 'Arial', weight: 400, style: 'normal', source: { kind: 'system' } },
  ]);

  return buildLayerConversionSession(scene, {
    measureText: (_font, text) => ({
      width: text.length * 5, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2,
    }),
  }, []);
}

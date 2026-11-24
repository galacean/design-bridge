import type { IRImageLayer } from '@galacean/animation-ir';
import { throwInvalidLayerData, throwUnsupportedLayerFeature } from '../diagnostics/collect-warnings';
import { mapPointsToBBox, roundPixel, transformBoxCorners } from '../../matrix';
import type { StaticLayerState } from '../transform/build-transform';
import type { SVGImageLayer } from '../../types';
import type { LayerConversionSession } from '../layers/conversion-session';

export function convertIRImageLayer(
  layer: IRImageLayer,
  state: StaticLayerState,
  session: LayerConversionSession,
  id: string,
): SVGImageLayer {
  const matrix = state.matrix;
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);

  if (scaleX === 0 || scaleY === 0) { throwInvalidLayerData('Degenerate image transform.'); }
  const a = matrix.a / scaleX;
  const b = matrix.b / scaleX;
  const c = matrix.c / scaleY;
  const d = matrix.d / scaleY;

  if (a * d - b * c <= 0 || Math.abs(a * c + b * d) > 1e-6) {
    throwUnsupportedLayerFeature('Image skew or reflection cannot be expressed by size + rotation.');
  }
  const asset = session.assets.get(layer.content.assetId);

  if (asset?.type !== 'image') { throwInvalidLayerData('Missing image resource.'); }
  const source = asset.source;
  const url = source.kind === 'url' ? source.url : `data:${source.mimeType};base64,${source.data}`;
  const { x, y, width, height } = layer.localBounds;

  if (width <= 0 || height <= 0) { throwInvalidLayerData('Invalid image display size.'); }
  const bbox = mapPointsToBBox(transformBoxCorners(matrix, [x, y, x + width, y + height]));

  return {
    id, type: 'image', role: 'content', bbox, url,
    size: [roundPixel(width * scaleX), roundPixel(height * scaleY)],
    rotation: [0, 0, roundPixel(Math.atan2(b, a) * 180 / Math.PI)],
    width: roundPixel(bbox[2] - bbox[0]), height: roundPixel(bbox[3] - bbox[1]),
  };
}

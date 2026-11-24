import type { IRLayer } from '@galacean/animation-ir';
import { convertIRImageLayer } from '../image/convert-image-layer';
import { convertIRTextLayer } from '../text/convert-text-layer';
import type { StaticLayerState } from '../transform/build-transform';
import type { SVGStaticLayer } from '../../types';
import type { LayerConversionSession } from './conversion-session';

export interface LayerConverter {
  readonly layerType: SVGStaticLayer['type'];
  readonly convert: (layer: IRLayer, state: StaticLayerState, id: string) => SVGStaticLayer | undefined;
}

export function createLayerConverterRegistry(
  session: LayerConversionSession,
): ReadonlyMap<IRLayer['type'], LayerConverter> {
  return new Map<IRLayer['type'], LayerConverter>([
    ['image', { layerType: 'image', convert: (layer, state, id) =>
      layer.type === 'image' ? convertIRImageLayer(layer, state, session, id) : undefined }],
    ['text', { layerType: 'text', convert: (layer, state, id) =>
      layer.type === 'text' ? convertIRTextLayer(layer, state, session, id) : undefined }],
  ]);
}

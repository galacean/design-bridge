import { LayerConversionError, collectLayerWarning, collectUnsupportedIRLayer } from '../diagnostics/collect-warnings';
import type { SVGStaticLayer } from '../../types';
import type { LayerConversionSession } from './conversion-session';
import { createLayerConverterRegistry } from './registry';
import { resolveIRVisualState } from './resolve-visual-state';

export function buildIRStaticLayers(session: LayerConversionSession, sourceIds?: Map<SVGStaticLayer, string>): SVGStaticLayer[] {
  const { composition, maskSourceIds, options, warnings } = session;
  const registry = createLayerConverterRegistry(session);
  const result: SVGStaticLayer[] = [];
  const layerCounts = new Map<SVGStaticLayer['type'], number>();

  for (const layer of composition.layers) {
    if (layer.type === 'null' || maskSourceIds.has(layer.id)) { continue; }
    try {
      const state = resolveIRVisualState(layer, session);

      if (state == null) { continue; }
      const converter = registry.get(layer.type);

      if (converter == null) {
        collectUnsupportedIRLayer(layer, layer.id, warnings, options);
        continue;
      }
      const index = (layerCounts.get(converter.layerType) ?? 0) + 1;
      const converted = converter.convert(layer, state, `${converter.layerType}_${String(index).padStart(4, '0')}`);

      if (converted != null) {
        result.push(converted);
        sourceIds?.set(converted, layer.id);
        layerCounts.set(converter.layerType, index);
      }
    } catch (error) {
      if (!(error instanceof LayerConversionError)) { throw error; }
      collectLayerWarning(warnings, options, error.code, error.message, layer.id);
    }
  }

  return result;
}

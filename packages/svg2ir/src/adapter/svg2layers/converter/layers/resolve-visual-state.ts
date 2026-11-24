import { SVG2IR_WARNING_CODES } from '../../../../common/types';
import { IRBlendMode, type IRLayer } from '@galacean/animation-ir';
import { maskCoversImage } from '../image/inspect-mask';
import { collectLayerWarning, throwUnsupportedLayerFeature } from '../diagnostics/collect-warnings';
import type { StaticLayerState } from '../transform/build-transform';
import type { LayerConversionSession } from './conversion-session';

export function resolveIRVisualState(layer: IRLayer, session: LayerConversionSession): StaticLayerState | undefined {
  if (!layer.visible) { return undefined; }
  const state = session.resolveLayerState(layer);

  if (!state.visible || state.opacity <= 0) { return undefined; }
  const unsupportedMask = (layer.masks ?? []).some(mask =>
    layer.type !== 'image' || !maskCoversImage(mask, layer.localBounds),
  );

  if (unsupportedMask || layer.matte != null) {
    throwUnsupportedLayerFeature('Mask or clipping is not supported by the flat layer protocol.');
  }
  if (Math.abs(state.opacity - 1) > 1e-6) {
    throwUnsupportedLayerFeature('Layer opacity cannot be expressed by the target protocol.');
  }
  if (layer.blendMode != null && layer.blendMode !== IRBlendMode.Normal) {
    collectLayerWarning(session.warnings, session.options, SVG2IR_WARNING_CODES.LAYERS_BLEND_MODE_DOWNGRADED,
      `Blend mode "${String(layer.blendMode)}" was downgraded to "normal"; the layer is retained.`, layer.id);
  }

  return state;
}

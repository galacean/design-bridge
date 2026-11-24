import type { IRLayer } from '@galacean/animation-ir';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import { createId } from '../../common/id';
import type { GeneratedComponentData, LayerGenerationContext } from '../types';

export function resolveComponentId(layer: IRLayer, ctx: LayerGenerationContext): string {
  const sourceComponentId = ctx.layerDataById[layer.id]?.sourceComponentId;

  if (
    sourceComponentId != null &&
    !ctx.collector.components.some(component => component.id === sourceComponentId)
  ) {
    return sourceComponentId;
  }

  return createId();
}

/** Copy a preserved GE mask whose target references are remapped after generation. */
export function copyPreservedMaskToComponent(
  layer: IRLayer,
  component: GeneratedComponentData,
  ctx: LayerGenerationContext,
): void {
  const preservedMask = ctx.layerDataById[layer.id]?.mask;

  if (preservedMask != null && component['mask'] == null) {
    component['mask'] = { ...preservedMask };
  }
}

export function restoreComponentRenderData(
  layer: IRLayer,
  component: GeneratedComponentData,
  ctx: LayerGenerationContext,
): void {
  const data = ctx.layerDataById[layer.id];

  if (data?.renderer != null && isRecord(component['renderer'])) {
    component['renderer'] = { ...component['renderer'], ...normalizeJSONValue(data.renderer) };
  }
  if (data?.geometry != null) {
    component['geometry'] = normalizeJSONValue(data.geometry);
  }
}

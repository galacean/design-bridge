import type { IRComposition, IRLayer } from '@galacean/animation-ir';
import { normalizeJSONValue } from '../common/json-normalization';
import type { GESceneContext } from './types';

/** Assemble parsed GE data into the final normalized IR composition. */
export function assembleIRComposition(layers: IRLayer[], ctx: GESceneContext): IRComposition {
  return normalizeJSONValue({
    id: ctx.irCompositionId,
    ...(ctx.compositionName != null && { name: ctx.compositionName }),
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    inPoint: ctx.inPoint,
    outPoint: ctx.outPoint,
    backgroundColor: ctx.backgroundColor,
    endBehavior: ctx.endBehavior,
    layers,
  });
}

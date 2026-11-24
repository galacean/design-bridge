import type { IRLayer } from '@galacean/animation-ir';
import { roundNumber } from '../../common/math';

/**
 * Convert a Layer activation range from parent-Composition frames to GE seconds.
 * Precomp sourceStartFrame/stretch affect source sampling, not activation.
 */
export function computeLayerTiming(
  layer: IRLayer,
  frameRate: number,
  compositionInPoint = 0,
): { delay: number; layerDuration: number } {
  const time = layer.time;
  const delay = roundNumber((time.inFrame - compositionInPoint) / frameRate, 4);
  const rawDuration = (time.outFrame - time.inFrame) / frameRate;
  const layerDuration = rawDuration > 0 ? roundNumber(rawDuration, 4) : 0.0001;

  return { delay, layerDuration };
}

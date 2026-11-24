import { IREndBehavior, type IRComposition } from '@galacean/animation-ir';
import { createId, hexToIRColor, isValidHexColor, secondsToFrames } from '../common/utils';
import type { Composition } from '../dsl/schema';

export function assembleIRComposition(composition: Composition, layers: IRComposition['layers']): IRComposition {
  const frameRate = composition.meta.fps;
  const durationFrames = secondsToFrames(composition.meta.duration, frameRate);
  const background = composition.meta.background_color;

  return {
    id: createId(),
    ...(typeof composition.meta.name === 'string' && { name: composition.meta.name }),
    width: composition.meta.width,
    height: composition.meta.height,
    frameRate,
    inPoint: 0,
    outPoint: durationFrames,
    ...(isValidHexColor(background) && {
      backgroundColor: hexToIRColor(background),
    }),
    endBehavior: composition.meta.loop ? IREndBehavior.Loop : IREndBehavior.Destroy,
    layers,
  };
}

// Value-level mappings used by the GE-to-IR conversion pipeline.
import { IRBlendMode, IREndBehavior, type IRLayerTime } from '@galacean/animation-ir';
import { BlendingMode, EndBehavior } from '@galacean/effects-specification';

const IR_BLEND_MODE_BY_GE: Record<number, IRBlendMode> = {
  [BlendingMode.ADD]: IRBlendMode.Add,
  [BlendingMode.MULTIPLY]: IRBlendMode.Multiply,
  [BlendingMode.BRIGHTNESS]: IRBlendMode.Lighten,
  [BlendingMode.SUBTRACTION]: IRBlendMode.Difference,
  [BlendingMode.STRONG_LIGHT]: IRBlendMode.HardLight,
  [BlendingMode.WEAK_LIGHT]: IRBlendMode.SoftLight,
  [BlendingMode.SUPERPOSITION]: IRBlendMode.Overlay,
};

export function mapBlendModeToIR(GECode: number | undefined): IRBlendMode | undefined {
  if (GECode == null) {
    return undefined;
  }

  return IR_BLEND_MODE_BY_GE[GECode];
}

export function mapEndBehaviorToIR(GEBehavior: EndBehavior | undefined): IREndBehavior | undefined {
  if (GEBehavior == null) {
    return undefined;
  }

  switch (GEBehavior) {
    case EndBehavior.destroy:
      return IREndBehavior.Destroy;
    case EndBehavior.forward:
      return IREndBehavior.Continue;
    case EndBehavior.freeze:
      return IREndBehavior.Freeze;
    case EndBehavior.restart:
      return IREndBehavior.Loop;
    default:
      return undefined;
  }
}

export function mapLayerTimingToIR(
  delay: number,
  duration: number,
  frameRate: number,
  compositionInPoint = 0,
): IRLayerTime {
  const inFrame = Math.round((compositionInPoint + delay * frameRate) * 1000) / 1000;
  const outFrame = Math.round((compositionInPoint + (delay + duration) * frameRate) * 1000) / 1000;

  return { inFrame, outFrame };
}

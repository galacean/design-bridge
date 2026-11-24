/**
 * SVG paint animation 的时间采样逻辑。
 *
 * 该模块只根据 IR animated property 计算指定帧的值，不直接修改 Effects scene。
 */
import type { IRAnimatedProperty, IRBezierHandle, IRColor, IRVec3 } from '@galacean/animation-ir';

function cubicBezierCoordinate (t: number, p1: number, p2: number): number {
  const mt = 1 - t;

  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

function cubicBezierDerivative (t: number, p1: number, p2: number): number {
  const mt = 1 - t;

  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** 按指定线性进度计算 CSS/SMIL cubic-bezier 缓动值。 */
function bezierProgress (
  progress: number,
  outTangent: IRBezierHandle | undefined,
  inTangent: IRBezierHandle | undefined,
): number {
  if (outTangent == null || inTangent == null) { return progress; }
  const x = Math.max(0, Math.min(1, progress));
  let parameter = x;

  for (let iteration = 0; iteration < 6; iteration++) {
    const error = cubicBezierCoordinate(parameter, outTangent.x, inTangent.x) - x;
    const derivative = cubicBezierDerivative(parameter, outTangent.x, inTangent.x);

    if (Math.abs(error) < 1e-7 || Math.abs(derivative) < 1e-7) { break; }
    parameter = Math.max(0, Math.min(1, parameter - error / derivative));
  }

  return cubicBezierCoordinate(parameter, outTangent.y, inTangent.y);
}

export function sampleScalarProperty (
  property: IRAnimatedProperty<number>,
  frame: number,
): number {
  if (property.type !== 'keyframed') { return property.value; }
  const keyframes = property.keyframes;
  const first = keyframes[0];

  if (first == null) { return 1; }
  if (frame <= first.frame) { return first.value; }
  for (let index = 0; index < keyframes.length - 1; index++) {
    const start = keyframes[index];
    const end = keyframes[index + 1];

    if (frame > end.frame) { continue; }
    if (start.hold === true || end.frame <= start.frame) { return start.value; }
    const linear = (frame - start.frame) / (end.frame - start.frame);
    const progress = bezierProgress(linear, start.outTangent, end.inTangent);
    const endValue = start.endValue ?? end.value;

    return start.value + (endValue - start.value) * progress;
  }

  return keyframes[keyframes.length - 1]?.value ?? 1;
}

export function sampleVectorProperty (
  property: Extract<IRAnimatedProperty<IRVec3>, { type: 'keyframed' }>,
  frame: number,
): IRVec3 {
  const keyframes = property.keyframes;
  const first = keyframes[0];

  if (first == null || frame <= first.frame) { return first?.value ?? [1, 1, 1]; }
  for (let index = 0; index < keyframes.length - 1; index++) {
    const start = keyframes[index];
    const end = keyframes[index + 1];

    if (frame > end.frame) { continue; }
    if (start.hold === true || end.frame <= start.frame) { return start.value; }
    const linear = (frame - start.frame) / (end.frame - start.frame);
    const progress = bezierProgress(linear, start.outTangent, end.inTangent);
    const endValue = start.endValue ?? end.value;

    const result: IRVec3 = [0, 0, 0];

    for (let channel = 0; channel < result.length; channel++) {
      result[channel] = start.value[channel] + (endValue[channel] - start.value[channel]) * progress;
    }

    return result;
  }

  return keyframes[keyframes.length - 1]?.value ?? [1, 1, 1];
}

export function sampleColorProperty (
  property: Extract<IRAnimatedProperty<IRColor>, { type: 'keyframed' }>,
  frame: number,
): IRColor {
  const keyframes = property.keyframes;
  const first = keyframes[0];

  if (first == null || frame <= first.frame) { return first?.value ?? [1, 1, 1, 1]; }
  for (let index = 0; index < keyframes.length - 1; index++) {
    const start = keyframes[index];
    const end = keyframes[index + 1];

    if (frame > end.frame) { continue; }
    if (start.hold === true || end.frame <= start.frame) { return start.value; }
    const linear = (frame - start.frame) / (end.frame - start.frame);
    const progress = bezierProgress(linear, start.outTangent, end.inTangent);
    const endValue = start.endValue ?? end.value;

    const result: IRColor = [0, 0, 0, 0];

    for (let channel = 0; channel < result.length; channel++) {
      result[channel] = start.value[channel] + (endValue[channel] - start.value[channel]) * progress;
    }

    return result;
  }

  return keyframes[keyframes.length - 1]?.value ?? [1, 1, 1, 1];
}

import type { IRAnimatedProperty, IRKeyframe, IRPrecompLayer } from '@galacean/animation-ir';
import type { IRComposition } from '@galacean/animation-ir';

const DEFAULT_OPACITY: IRAnimatedProperty<number> = { type: 'static', value: 1 };

/** Multiply two opacity channels in one Composition time domain. */
export function multiplyOpacityProperties(
  left: IRAnimatedProperty<number> | undefined,
  right: IRAnimatedProperty<number> | undefined,
  inFrame: number,
  outFrame: number,
): IRAnimatedProperty<number> | undefined {
  if (left == null) {
    return cloneOpacityProperty(right);
  }
  if (right == null) {
    return cloneOpacityProperty(left);
  }
  if (left.type === 'static' && right.type === 'static') {
    return { type: 'static', value: left.value * right.value };
  }
  if (left.type === 'static') {
    return scaleOpacityProperty(right, left.value);
  }
  if (right.type === 'static') {
    return scaleOpacityProperty(left, right.value);
  }

  const frames = new Set<number>([inFrame, outFrame]);

  for (const keyframe of left.keyframes) {
    frames.add(keyframe.frame);
  }
  for (const keyframe of right.keyframes) {
    frames.add(keyframe.frame);
  }

  const keyframes = [...frames]
    .filter(frame => frame >= inFrame && frame <= outFrame)
    .sort((a, b) => a - b)
    .map(frame => ({
      frame,
      value: evaluateOpacityAtFrame(left.keyframes, frame) * evaluateOpacityAtFrame(right.keyframes, frame),
    }));

  return keyframes.length === 1
    ? { type: 'static', value: keyframes[0].value }
    : { type: 'keyframed', keyframes };
}

/** Map an instance opacity channel from its parent timeline into referenced Composition frames. */
export function mapOpacityToReferencedComposition(
  opacity: IRAnimatedProperty<number> | undefined,
  layer: IRPrecompLayer,
  parent: IRComposition,
  referenced: IRComposition,
): IRAnimatedProperty<number> | undefined {
  if (opacity == null || opacity.type === 'static') {
    return cloneOpacityProperty(opacity);
  }

  const parentFrameRate = parent.frameRate;
  const referencedFrameRate = referenced.frameRate;
  const sourceStartFrame = layer.time.sourceStartFrame ?? referenced.inPoint;
  const stretch = layer.time.stretch ?? 1;
  const mapFrame = (frame: number): number =>
    sourceStartFrame + ((frame - layer.time.inFrame) * referencedFrameRate) / (parentFrameRate * stretch);

  return {
    type: 'keyframed',
    keyframes: opacity.keyframes.map(keyframe => ({ ...keyframe, frame: mapFrame(keyframe.frame) })),
  };
}

export function isDefaultOpacity(opacity: IRAnimatedProperty<number> | undefined): boolean {
  if (opacity == null) {
    return true;
  }
  if (opacity.type === 'static') {
    return opacity.value === 1;
  }

  return opacity.keyframes.every(keyframe => keyframe.value === 1 && (keyframe.endValue ?? 1) === 1);
}

export function hasAnimatedOpacity(opacity: IRAnimatedProperty<number> | undefined): boolean {
  return opacity?.type === 'keyframed' && opacity.keyframes.length > 1;
}

function cloneOpacityProperty(
  opacity: IRAnimatedProperty<number> | undefined,
): IRAnimatedProperty<number> | undefined {
  if (opacity == null) {
    return undefined;
  }
  if (opacity.type === 'static') {
    return { ...opacity };
  }

  return { type: 'keyframed', keyframes: opacity.keyframes.map(keyframe => ({ ...keyframe })) };
}

function scaleOpacityProperty(
  opacity: IRAnimatedProperty<number> | undefined,
  factor: number,
): IRAnimatedProperty<number> {
  const resolved = opacity ?? DEFAULT_OPACITY;

  if (resolved.type === 'static') {
    return { type: 'static', value: resolved.value * factor };
  }

  return {
    type: 'keyframed',
    keyframes: resolved.keyframes.map(keyframe => ({
      ...keyframe,
      value: keyframe.value * factor,
      ...(keyframe.endValue != null && { endValue: keyframe.endValue * factor }),
    })),
  };
}

function evaluateOpacityAtFrame(keyframes: IRKeyframe<number>[], frame: number): number {
  if (keyframes.length === 0) {
    return 1;
  }
  if (frame <= keyframes[0].frame) {
    return keyframes[0].value;
  }

  const last = keyframes[keyframes.length - 1];

  if (frame >= last.frame) {
    return last.value;
  }

  for (let index = 0; index < keyframes.length - 1; index++) {
    const current = keyframes[index];
    const next = keyframes[index + 1];

    if (frame < current.frame || frame > next.frame) {
      continue;
    }
    if (current.hold === true || next.frame === current.frame) {
      return current.value;
    }

    const progress = (frame - current.frame) / (next.frame - current.frame);
    const endValue = current.endValue ?? next.value;

    return current.value + (endValue - current.value) * progress;
  }

  return last.value;
}

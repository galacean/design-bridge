import type { IRKeyframe, IRTransform, IRVec3 } from '@galacean/animation-ir';
import {
  decomposeMatrix, IDENTITY, multiply, transformPoint, type SVGMatrix,
} from '../../matrix';
import {
  matrixForTransformValue, sampleAnimationValue,
} from './build-keyframes';
import { motionMatrixAtTime } from './parse-motion';
import { valuesEqual } from './parse-timeline';
import { sampleCompositionFrames } from './sample-composition-frames';
import {
  EPSILON, LINEAR_IN_TANGENT, LINEAR_OUT_TANGENT,
  type MotionAnimation, type SMILAnimation, type TransformContext, type TransformStage,
} from './types';

/** 位置误差容忍度（用户坐标单位）。 */
const POSITION_TOLERANCE = 0.5;
/** 缩放误差容忍度（相对值）。 */
const SCALE_TOLERANCE = 0.005;
/** 旋转误差容忍度（度）。 */
const ROTATION_TOLERANCE = 0.5;

/** 细分时衡量误差的观测量。 */
interface TransformProbe {
  position: [number, number];
  scale: [number, number];
  rotation: number;
}

function composeLocalTransform (
  animations: SMILAnimation[],
  motions: MotionAnimation[],
  selfMatrix: SVGMatrix,
  time: number,
): SVGMatrix {
  let current = selfMatrix;

  for (const animation of animations) {
    const value = sampleAnimationValue(animation, time);

    if (value == null) { continue; }
    const animated = matrixForTransformValue(animation.type, value);

    current = animation.additive === 'sum' ? multiply(current, animated) : animated;
  }

  let motionMatrix = IDENTITY;

  for (const motion of motions) {
    const animated = motionMatrixAtTime(motion, time);

    if (animated == null) { continue; }
    motionMatrix = motion.additive === 'sum' ? multiply(motionMatrix, animated) : animated;
  }

  // SVG motion transform is applied after the element's authored and animated
  // transform, so its translation is not scaled or rotated by that transform.
  return multiply(motionMatrix, current);
}

function probeTransform (matrix: SVGMatrix, localCenter: [number, number]): TransformProbe {
  const center = transformPoint(matrix, localCenter[0], localCenter[1]);
  const decomposed = decomposeMatrix(matrix);

  return {
    position: [center.x, center.y],
    scale: [decomposed.sx, decomposed.sy],
    rotation: decomposed.rotation,
  };
}

/** 把 rotation 对齐到左邻分支，消除 atan2 的 ±180° 环绕。 */
function alignProbe (value: TransformProbe, left: TransformProbe): TransformProbe {
  if (!Number.isFinite(value.rotation) || !Number.isFinite(left.rotation)) { return value; }

  return {
    ...value,
    rotation: value.rotation + Math.round((left.rotation - value.rotation) / 360) * 360,
  };
}

/** 归一化偏差：观测值相对线性插值的偏离量，1 表示刚好达到容忍度。 */
function relativeDeviation (value: number, left: number, right: number, t: number, tolerance: number): number {
  const expected = left + (right - left) * t;

  return Math.abs(value - expected) / tolerance;
}

function probeError (
  value: TransformProbe,
  left: TransformProbe,
  right: TransformProbe,
  t: number,
): number {
  const position = Math.max(
    relativeDeviation(value.position[0], left.position[0], right.position[0], t, POSITION_TOLERANCE),
    relativeDeviation(value.position[1], left.position[1], right.position[1], t, POSITION_TOLERANCE),
  );
  const scale = Math.max(
    relativeDeviation(value.scale[0], left.scale[0], right.scale[0], t, SCALE_TOLERANCE),
    relativeDeviation(value.scale[1], left.scale[1], right.scale[1], t, SCALE_TOLERANCE),
  );
  const rotation = relativeDeviation(value.rotation, left.rotation, right.rotation, t, ROTATION_TOLERANCE);

  return Math.max(position, scale, rotation);
}

export function applySampledTransformComposition (
  stages: TransformStage[],
  baseMatrix: SVGMatrix,
  transform: IRTransform,
  frameRate: number,
  context: TransformContext,
): void {
  const geometries = stages.flatMap(stage => stage.geometry == null ? [] : [stage.geometry]);
  const animations = stages.flatMap(stage => stage.animations).concat(geometries.flatMap(geometry => geometry.animations));
  const motions = stages.flatMap(stage => stage.motions);
  const end = Math.max(
    ...animations.map(animation => animation.end),
    ...motions.map(animation => animation.end),
  );
  const endFrame = end * frameRate;
  const anchorFrames = new Set<number>([0, endFrame]);
  const jumpFrames: number[] = [];

  for (const animation of animations) {
    for (let i = 0; i < animation.samples.length; i++) {
      const sampleFrame = animation.samples[i].time * frameRate;

      if (animation.calcMode === 'discrete' && i > 0 && sampleFrame > EPSILON) {
        // 采样矩阵组合（祖先 group / geometry / motion）不能携带每个源通道的 IR hold metadata。
        // 插入与 makeKeyframes 相同的 sub-frame bridge，使 Effects 保持旧矩阵直到离散边界再立即跳变。
        anchorFrames.add(Math.max(0, sampleFrame - 0.001));
      }
      anchorFrames.add(sampleFrame);
      const previous = animation.samples[i - 1];

      if (previous != null && Math.abs(previous.time - animation.samples[i].time) < EPSILON && !valuesEqual(previous.value, animation.samples[i].value)) {
        anchorFrames.add(Math.max(0, sampleFrame - 0.001));
        jumpFrames.push(sampleFrame);
      }
    }
    if (animation.fill === 'remove' && !animation.indefinite && animation.end > 0) {
      anchorFrames.add(Math.max(0, animation.end * frameRate - 0.001));
      anchorFrames.add(animation.end * frameRate);
    }
  }
  for (const motion of motions) {
    anchorFrames.add(Math.max(0, motion.begin * frameRate));
    anchorFrames.add(motion.end * frameRate);
    const cycleCount = Math.max(1, Math.ceil(motion.activeDuration / motion.simpleDuration - EPSILON));

    for (let cycle = 0; cycle < cycleCount; cycle++) {
      const cycleStart = motion.begin + cycle * motion.simpleDuration;

      for (const keyTime of motion.keyTimes) {
        const boundary = (cycleStart + keyTime * motion.simpleDuration) * frameRate;

        if (boundary < 0 || boundary > endFrame + EPSILON) { continue; }
        if (motion.calcMode === 'discrete' && boundary > EPSILON) {
          anchorFrames.add(Math.max(0, boundary - 0.001));
        }
        anchorFrames.add(boundary);
      }
    }
  }

  const matrixCache = new Map<number, SVGMatrix>();
  const matrixAtFrame = (frame: number): SVGMatrix => {
    let matrix = matrixCache.get(frame);

    if (matrix == null) {
      matrix = baseMatrix;
      for (const stage of stages) {
        matrix = multiply(matrix, composeLocalTransform(
          stage.animations,
          stage.motions,
          stage.staticMatrix,
          frame / frameRate,
        ));
        if (stage.geometry != null) {
          matrix = multiply(matrix, stage.geometry.matrixAtTime(frame / frameRate));
        }
      }
      matrixCache.set(frame, matrix);
    }

    return matrix;
  };

  const sampled = sampleCompositionFrames<TransformProbe>({
    endFrame,
    anchorFrames: [...anchorFrames].filter(frame => frame >= 0 && frame <= endFrame + EPSILON),
    jumpFrames,
    evaluate: frame => probeTransform(matrixAtFrame(frame), context.localCenter),
    unwrapForMeasure: alignProbe,
    normalizeError: probeError,
  });
  const orderedFrames = sampled.map(sample => sample.frame);
  const positionKeyframes: IRKeyframe<IRVec3>[] = [];
  const scaleKeyframes: IRKeyframe<IRVec3>[] = [];
  const rotationKeyframes: IRKeyframe<number>[] = [];

  for (let i = 0; i < sampled.length; i++) {
    const probe = sampled[i].value;
    const position: IRVec3 = [probe.position[0], probe.position[1], 0];
    const scale: IRVec3 = [probe.scale[0], probe.scale[1], 1];
    // decomposeMatrix 经 atan2 得到 (-180,180] 的等价角，逐点解缠才能保留多圈旋转。
    const previousRotation = rotationKeyframes.at(-1)?.value;
    const rotation = previousRotation == null
      ? probe.rotation
      : probe.rotation + Math.round((previousRotation - probe.rotation) / 360) * 360;

    positionKeyframes.push({
      frame: orderedFrames[i],
      value: position,
      ...(i > 0 && { inTangent: LINEAR_IN_TANGENT }),
      ...(i < sampled.length - 1 && { outTangent: LINEAR_OUT_TANGENT }),
    });
    scaleKeyframes.push({
      frame: orderedFrames[i],
      value: scale,
      ...(i > 0 && { inTangent: LINEAR_IN_TANGENT }),
      ...(i < sampled.length - 1 && { outTangent: LINEAR_OUT_TANGENT }),
    });
    rotationKeyframes.push({
      frame: orderedFrames[i],
      value: rotation,
      ...(i > 0 && { inTangent: LINEAR_IN_TANGENT }),
      ...(i < sampled.length - 1 && { outTangent: LINEAR_OUT_TANGENT }),
    });
  }

  transform.position = { type: 'keyframed', keyframes: positionKeyframes };
  transform.scale = { type: 'keyframed', keyframes: scaleKeyframes };
  const geometry = geometries.at(-1);

  if (geometry != null && context.geometryScaleSink != null) {
    context.geometryScaleSink.value = {
      type: 'keyframed',
      keyframes: orderedFrames.map(frame => {
        const scale = geometry.scaleAtTime(frame / frameRate);

        return { frame, value: [scale.x, scale.y, 1] as IRVec3 };
      }),
    };
  }
  if (transform.rotation == null) { transform.rotation = {}; }
  transform.rotation.z = { type: 'keyframed', keyframes: rotationKeyframes };
}

import type { IRTransform, IRVec3 } from '@galacean/animation-ir';
import {
  decomposeMatrix, IDENTITY, invertSVGMatrix, multiply, parseTransform, transformPoint, type SVGMatrix,
} from '../../matrix';
import {
  applyRotateSpatialTangents, makeKeyframes, matrixForTransformValue,
  staticValue, subdivideFullTurn, unwrapRotationValues,
} from './build-keyframes';
import { parseMotionAnimation } from './parse-motion';
import { applySampledTransformComposition } from './apply-transform-composition';
import {
  applySampledOpacityComposition, collectOpacityAnimations, readStaticOpacity, readStaticVisibility,
} from './apply-opacity-composition';
import { collectGeometryAnimation } from './collect-geometry-animation';
import { parseSMILTag } from './parse-timeline';
import { getBeginTimeCache } from './timeline-schedule';
import { collectSMILAnimationElements } from './resolve-animation-target';
import {
  EPSILON,
  type BeginTimeCache, type MotionAnimation, type SMILAnimation, type TransformContext, type TransformStage,
} from './types';

function readDirectTransformStage (
  node: globalThis.Element,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  staticMatrix: SVGMatrix,
  comparisonDuration?: number,
): TransformStage {
  const animations = collectSMILAnimationElements(node, root, new Set(['animatetransform']))
    .map(tag => parseSMILTag(tag, root, beginCache, comparisonDuration))
    .filter((animation): animation is SMILAnimation => animation != null && ['translate', 'scale', 'rotate'].includes(animation.type));
  const motions = collectSMILAnimationElements(node, root, new Set(['animatemotion']))
    .map(tag => parseMotionAnimation(tag, root, beginCache, comparisonDuration))
    .filter((animation): animation is MotionAnimation => animation != null);

  return { node, staticMatrix, animations, motions };
}

function collectTransformStages (
  node: globalThis.Element,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  context: TransformContext,
): { baseMatrix: SVGMatrix; stages: TransformStage[] } {
  const ancestorGroups: globalThis.Element[] = [];
  let parent = node.parentNode as globalThis.Element | null;

  while (parent != null && parent !== context.ancestorStopNode) {
    const tagName = parent.tagName?.toLowerCase();

    if (tagName === 'g' || tagName === 'a' || tagName === 'switch' || tagName === 'symbol') {
      ancestorGroups.push(parent);
    }
    if (tagName === 'svg') { break; }
    parent = parent.parentNode as globalThis.Element | null;
  }
  ancestorGroups.reverse();

  let groupStaticProduct = IDENTITY;
  const stages = ancestorGroups.map(group => {
    const staticMatrix = parseTransform(group.getAttribute('transform') ?? '');

    groupStaticProduct = multiply(groupStaticProduct, staticMatrix);

    return readDirectTransformStage(group, root, beginCache, staticMatrix, context.comparisonDuration);
  });

  stages.push(readDirectTransformStage(node, root, beginCache, context.selfMatrix, context.comparisonDuration));

  const baseMatrix = context.preserveAncestorTransforms === true
    ? context.ancestorMatrix
    : multiply(context.ancestorMatrix, invertSVGMatrix(groupStaticProduct));

  return { baseMatrix, stages };
}

function applyCollectedSMILTransform (
  stages: TransformStage[],
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  baseMatrix: SVGMatrix,
  transform: IRTransform,
  outDuration: { value: number },
  frameRate: number,
  context: TransformContext,
  forceSampledComposition = false,
): void {
  const ancestorStages = stages.slice(0, -1);
  const ownStage = stages.at(-1);

  if (ownStage == null) { return; }
  const transformAnimations = ownStage.animations;
  const motionAnimations = ownStage.motions;
  const geometries = stages.flatMap(stage => stage.geometry == null ? [] : [stage.geometry]);
  const ancestorHasTransformAnimation = ancestorStages.some(stage => stage.animations.length > 0 || stage.motions.length > 0);
  const allTransformAnimations = stages.flatMap(stage => stage.animations);
  const allMotionAnimations = stages.flatMap(stage => stage.motions);
  const opacityAnimationsByStage = stages.map(stage => stage.ignoreOpacity === true
    ? []
    : collectOpacityAnimations(stage, root, beginCache, context.comparisonDuration));
  const allOpacityAnimations = opacityAnimationsByStage.flat();
  const ownOpacityAnimations = opacityAnimationsByStage.at(-1) ?? [];
  const ancestorHasOpacityAnimation = opacityAnimationsByStage.slice(0, -1).some(animations => animations.length > 0);
  const hasTransformWork = allTransformAnimations.length > 0
    || allMotionAnimations.length > 0
    || geometries.some(geometry => geometry.animations.length > 0);
  const hasAnimatedGeometry = geometries.some(geometry => geometry.animations.length > 0);

  if (hasTransformWork && (forceSampledComposition || ancestorHasTransformAnimation || motionAnimations.length > 0 || hasAnimatedGeometry)) {
    applySampledTransformComposition(stages, baseMatrix, transform, frameRate, context);
    outDuration.value = Math.max(
      outDuration.value,
      ...allTransformAnimations.map(animation => animation.end),
      ...allMotionAnimations.map(animation => animation.end),
      ...geometries.flatMap(geometry => geometry.animations.map(animation => animation.end)),
    );
  } else if (transformAnimations.length > 1) {
    applySampledTransformComposition([ownStage], context.ancestorMatrix, transform, frameRate, context);
    outDuration.value = Math.max(outDuration.value, ...transformAnimations.map(animation => animation.end));
  } else if (transformAnimations.length === 1) {
    const animation = subdivideFullTurn(transformAnimations[0]);
    const animatedLocalBase = animation.additive === 'sum' ? context.selfMatrix : IDENTITY;
    const animatedBaseMatrix = multiply(context.ancestorMatrix, animatedLocalBase);
    const staticBaseMatrix = multiply(context.ancestorMatrix, context.selfMatrix);
    const matrices = animation.samples.map(sample => multiply(animatedBaseMatrix, matrixForTransformValue(animation.type, sample.value)));
    const staticCenter = transformPoint(staticBaseMatrix, context.localCenter[0], context.localCenter[1]);
    const staticDecomposed = decomposeMatrix(staticBaseMatrix);
    const positionKeyframes = makeKeyframes(animation, frameRate, (_, index) => {
      const matrix = matrices[index];
      const center = transformPoint(matrix, context.localCenter[0], context.localCenter[1]);

      return [center.x, center.y, 0] as IRVec3;
    }, [staticCenter.x, staticCenter.y, 0]);
    const scaleKeyframes = makeKeyframes(animation, frameRate, (_, index) => {
      const decomposed = decomposeMatrix(matrices[index]);

      return [decomposed.sx, decomposed.sy, 1] as IRVec3;
    }, [staticDecomposed.sx, staticDecomposed.sy, 1]);
    const rotationValues = unwrapRotationValues(animation, matrices);
    const rotationKeyframes = makeKeyframes(animation, frameRate, (_, index) => rotationValues[index], staticDecomposed.rotation);

    if (animation.type === 'rotate' && !animation.samples.some((sample, index) => index > 0 && Math.abs(sample.time - animation.samples[index - 1].time) < EPSILON)) {
      applyRotateSpatialTangents(animation, positionKeyframes, animatedBaseMatrix, context.localCenter);
    }

    transform.position = { type: 'keyframed', keyframes: positionKeyframes };
    transform.scale = { type: 'keyframed', keyframes: scaleKeyframes };
    if (transform.rotation == null) { transform.rotation = {}; }
    transform.rotation.z = { type: 'keyframed', keyframes: rotationKeyframes };
    outDuration.value = Math.max(outDuration.value, animation.end);
  }

  if ((ancestorHasOpacityAnimation || ownOpacityAnimations.length > 1) && allOpacityAnimations.length > 0) {
    applySampledOpacityComposition(stages, opacityAnimationsByStage, transform, frameRate);
    outDuration.value = Math.max(outDuration.value, ...allOpacityAnimations.map(animation => animation.end));
  } else {
    const ancestorOpacity = ancestorStages.reduce(
      (opacity, stage) => opacity * readStaticOpacity(stage.node),
      1,
    );
    const ownStaticOpacity = readStaticOpacity(ownStage.node);

    for (const animation of ownOpacityAnimations) {
      const baseOpacity = ['display', 'visibility'].includes(animation.attributeName)
        ? staticValue(transform.opacity, 1) * readStaticVisibility(ownStage.node)
        : staticValue(transform.opacity, 1);

      transform.opacity = {
        type: 'keyframed',
        keyframes: makeKeyframes(animation, frameRate, value => {
          const animatedOpacity = animation.additive === 'sum'
            ? ownStaticOpacity + (value[0] ?? 0)
            : value[0] ?? 0;

          return Math.max(0, Math.min(1, animatedOpacity * ancestorOpacity));
        }, baseOpacity),
      };
      outDuration.value = Math.max(outDuration.value, animation.end);
    }
  }
}

export function applySMILToTransform (
  el: { node?: globalThis.Element | null },
  transform: IRTransform,
  outDuration: { value: number },
  frameRate: number,
  context: TransformContext,
): void {
  const node = el.node;

  if (node == null) { return; }
  const root = ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;
  const beginCache = getBeginTimeCache(root, context.comparisonDuration);
  const collected = collectTransformStages(node, root, beginCache, context);
  const geometry = collectGeometryAnimation(collected.stages.at(-1)!, root, beginCache, context);

  if (geometry != null) {
    collected.stages.at(-1)!.geometry = geometry;
  }
  applyCollectedSMILTransform(collected.stages, root, beginCache, collected.baseMatrix, transform, outDuration, frameRate, context);
}

export function applySMILToTransformWithOuter (
  innerEl: { node?: globalThis.Element | null },
  outerEl: { node?: globalThis.Element | null },
  transform: IRTransform,
  outDuration: { value: number },
  frameRate: number,
  innerContext: TransformContext,
  outerContext: TransformContext,
): void {
  const innerNode = innerEl.node;
  const outerNode = outerEl.node;

  if (innerNode == null || outerNode == null) { return; }
  const root = ((outerNode as globalThis.SVGElement).ownerSVGElement ?? outerNode) as globalThis.Element;
  const comparisonDuration = innerContext.comparisonDuration ?? outerContext.comparisonDuration;
  const beginCache = getBeginTimeCache(root, comparisonDuration);
  const outerCollected = collectTransformStages(outerNode, root, beginCache, outerContext);
  const innerCollected = collectTransformStages(innerNode, root, beginCache, innerContext);
  const outerGeometry = collectGeometryAnimation(outerCollected.stages.at(-1)!, root, beginCache, outerContext);
  const innerGeometry = collectGeometryAnimation(innerCollected.stages.at(-1)!, root, beginCache, innerContext);

  if (outerGeometry != null) {
    outerCollected.stages.at(-1)!.geometry = outerGeometry;
  }
  if (innerGeometry != null) {
    innerCollected.stages.at(-1)!.geometry = innerGeometry;
  }
  const bridgeStage: TransformStage = {
    node: innerNode,
    staticMatrix: innerCollected.baseMatrix,
    animations: [],
    motions: [],
    ignoreOpacity: true,
  };
  const stages = [...outerCollected.stages, bridgeStage, ...innerCollected.stages];

  applyCollectedSMILTransform(stages, root, beginCache, outerCollected.baseMatrix, transform, outDuration, frameRate, innerContext, true);
}

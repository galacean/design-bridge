import type { IRKeyframe, IRTransform } from '@galacean/animation-ir';
import { readPresentationAttribute } from '../../../parse-svg/read-presentation-attribute';
import { sampleAnimationValue } from './build-keyframes';
import { parseSMILTag, valuesEqual } from './parse-timeline';
import { collectSMILAnimationElements } from './resolve-animation-target';
import { sampleCompositionFrames } from './sample-composition-frames';
import {
  EPSILON, LINEAR_IN_TANGENT, LINEAR_OUT_TANGENT,
  type BeginTimeCache, type SMILAnimation, type TransformStage,
} from './types';

/** 透明度误差容忍度（0-1 相对值）。 */
const OPACITY_TOLERANCE = 0.004;

export function readStaticOpacity (node: globalThis.Element): number {
  const raw = readPresentationAttribute(node, 'opacity');
  const value = raw == null || raw.trim() === '' ? 1 : Number(raw);

  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export function readStaticVisibility (node: globalThis.Element): number {
  const display = readPresentationAttribute(node, 'display')?.trim().toLowerCase();

  if (display === 'none') { return 0; }
  const visibility = readPresentationAttribute(node, 'visibility')?.trim().toLowerCase();

  return visibility === 'hidden' || visibility === 'collapse' ? 0 : 1;
}

function parseVisibilityValue (value: string, type: string): number[] {
  const normalized = value.trim().toLowerCase();
  const hidden = type === 'display'
    ? normalized === 'none'
    : normalized === 'hidden' || normalized === 'collapse';

  return [hidden ? 0 : 1];
}

function parseOpacityAnimation (
  tag: globalThis.Element,
  stage: TransformStage,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  comparisonDuration?: number,
): SMILAnimation | null {
  const attributeName = tag.getAttribute('attributeName')?.trim().toLowerCase();
  const valueParser = attributeName === 'display' || attributeName === 'visibility'
    ? parseVisibilityValue
    : undefined;
  const underlyingValue = attributeName === 'opacity'
    ? [readStaticOpacity(stage.node)]
    : attributeName === 'display' || attributeName === 'visibility'
      ? [readStaticVisibility(stage.node)]
      : undefined;

  return parseSMILTag(tag, root, beginCache, comparisonDuration, valueParser, underlyingValue);
}

function isOpacityAnimation (animation: SMILAnimation | null): animation is SMILAnimation {
  return animation != null && ['opacity', 'display', 'visibility'].includes(animation.attributeName);
}

export function collectOpacityAnimations (
  stage: TransformStage,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  comparisonDuration?: number,
): SMILAnimation[] {
  const animationTags = collectSMILAnimationElements(stage.node, root, new Set(['animate', 'set']));
  const animations = animationTags.map(tag => parseOpacityAnimation(tag, stage, root, beginCache, comparisonDuration));

  return animations.filter(isOpacityAnimation);
}
function opacityAtTime (staticOpacity: number, staticVisibility: number, animations: SMILAnimation[], time: number): number {
  let opacity = staticOpacity;
  let visible = staticVisibility > 0.5;

  for (const animation of animations) {
    const sampled = sampleAnimationValue(animation, time);

    if (sampled == null) { continue; }
    const value = sampled[0] ?? 0;

    if (animation.attributeName === 'display' || animation.attributeName === 'visibility') {
      visible = value > 0.5;
    } else {
      opacity = animation.additive === 'sum' ? opacity + value : value;
    }
  }

  return visible ? Math.max(0, Math.min(1, opacity)) : 0;
}

export function applySampledOpacityComposition (
  stages: TransformStage[],
  animationsByStage: SMILAnimation[][],
  transform: IRTransform,
  frameRate: number,
): void {
  const animations = animationsByStage.flat();
  const end = Math.max(...animations.map(animation => animation.end));
  const endFrame = end * frameRate;
  const anchorFrames = new Set<number>([0, endFrame]);
  const jumpFrames: number[] = [];

  for (const animation of animations) {
    for (const interval of animation.intervals) {
      const beginFrame = interval.begin * frameRate;

      if (beginFrame > EPSILON) {
        anchorFrames.add(beginFrame - 0.001);
      }
    }
    for (let index = 0; index < animation.samples.length; index++) {
      const sample = animation.samples[index];
      const sampleFrame = sample.time * frameRate;

      anchorFrames.add(sampleFrame);
      const previous = animation.samples[index - 1];

      if (previous != null && Math.abs(previous.time - sample.time) < EPSILON && !valuesEqual(previous.value, sample.value)) {
        anchorFrames.add(Math.max(0, sampleFrame - 0.001));
        jumpFrames.push(sampleFrame);
      }
      if (animation.calcMode === 'discrete' && index > 0 && sampleFrame > EPSILON) {
        anchorFrames.add(Math.max(0, sampleFrame - 0.001));
      }
    }
    if (animation.fill === 'remove' && !animation.indefinite && animation.end > 0) {
      anchorFrames.add(Math.max(0, animation.end * frameRate - 0.001));
      anchorFrames.add(animation.end * frameRate);
    }
  }

  const opacityAtFrame = (frame: number): number => {
    let opacity = 1;

    for (let index = 0; index < stages.length; index++) {
      opacity *= opacityAtTime(
        readStaticOpacity(stages[index].node),
        readStaticVisibility(stages[index].node),
        animationsByStage[index],
        frame / frameRate,
      );
    }

    return Math.max(0, Math.min(1, opacity));
  };

  const sampled = sampleCompositionFrames<number>({
    endFrame,
    anchorFrames: [...anchorFrames].filter(frame => frame >= 0 && frame <= endFrame + EPSILON),
    jumpFrames,
    evaluate: opacityAtFrame,
    normalizeError: (value, left, right, t) => (
      Math.abs(value - (left + (right - left) * t)) / OPACITY_TOLERANCE
    ),
  });
  const keyframes: IRKeyframe<number>[] = sampled.map((sample, index) => ({
    frame: sample.frame,
    value: sample.value,
    ...(index > 0 && { inTangent: LINEAR_IN_TANGENT }),
    ...(index < sampled.length - 1 && { outTangent: LINEAR_OUT_TANGENT }),
  }));

  transform.opacity = { type: 'keyframed', keyframes };
}

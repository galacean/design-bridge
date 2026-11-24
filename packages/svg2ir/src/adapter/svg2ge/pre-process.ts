import type {
  IRAnimatedProperty, IRScene, IRKeyframe, IRPropertyValue, IRTransform,
} from '@galacean/animation-ir';
import type { SVGPreservedPaintAnimation, SVGPreservedShapeAnimation } from '../../svg-preserved-data';
import { normalizeShapeAnimationForGE } from './normalize-shape-animation';

function keyframeValuesDiffer (a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length !== b.length || a.some((value, index) => Math.abs(Number(value) - Number(b[index])) > 1e-9);
  }

  return Math.abs(Number(a) - Number(b)) > 1e-9;
}

/** 在 IR 副本/内部 paint 动画上展开 hold→跳变过渡点,避免依赖共享 ge-ir 曲线编码。 */
function expandAnimatedHold<T extends IRPropertyValue> (property: IRAnimatedProperty<T> | undefined): void {
  if (property == null || property.type !== 'keyframed' || property.keyframes == null || property.keyframes.length < 2) { return; }
  const expanded: IRKeyframe<T>[] = [];

  for (let index = 0; index < property.keyframes.length; index++) {
    const current = property.keyframes[index];
    const next = property.keyframes[index + 1];

    expanded.push(current);
    if (current.hold !== true || next == null) { continue; }
    const gap = next.frame - current.frame;

    if (gap <= 1e-9 || !keyframeValuesDiffer(current.value, next.value)) { continue; }
    expanded.push({
      frame: next.frame - Math.min(0.001, gap / 2),
      value: current.value,
    });
  }

  property.keyframes = expanded;
}

function expandTransformHoldTransitions (transform: IRTransform): void {
  expandAnimatedHold(transform.position);
  expandAnimatedHold(transform.scale);
  expandAnimatedHold(transform.opacity);

  if (transform.rotation == null) { return; }
  expandAnimatedHold(transform.rotation.x);
  expandAnimatedHold(transform.rotation.y);
  expandAnimatedHold(transform.rotation.z);
}

export function applyShapeAnimationBasePaths (
  ir: IRScene,
  animationsByLayerId: ReadonlyMap<string, SVGPreservedShapeAnimation> | undefined,
): void {
  const composition = ir.compositions[0];

  if (composition == null || animationsByLayerId == null) { return; }

  for (const layer of composition.layers) {
    if (layer.type !== 'shape') { continue; }
    const animation = animationsByLayerId.get(layer.id);
    const normalizedAnimation = animation == null ? undefined : normalizeShapeAnimationForGE(animation);

    if (normalizedAnimation == null) { continue; }
    const firstPaths = normalizedAnimation.keyframes[0]?.paths;

    if (firstPaths == null || firstPaths.length === 0) { continue; }
    const shape = layer.content.shapes[0];

    if (shape == null || shape.primitiveType !== 'custom') { continue; }
    shape.customPaths = firstPaths;
  }
}

/** convertIRToGE 用 IR 副本展开 hold 过渡点,result.ir 仍保留解析原始关键帧。 */
export function expandIRHoldTransitions (ir: IRScene): IRScene {
  const expanded = structuredClone(ir);

  for (const layer of expanded.compositions[0].layers ?? []) {
    if (layer.transform != null) {
      expandTransformHoldTransitions(layer.transform);
    }
  }

  return expanded;
}

/** applyShapePaintAnimation 消费的 paint 动画属性同样展开 hold 过渡点(内部 sink,不外露)。 */
export function expandPaintAnimationHoldKeyframes (map: Map<string, SVGPreservedPaintAnimation[]>): void {
  for (const entries of map.values()) {
    for (const entry of entries) {
      switch (entry.kind) {
        case 'opacity':
          expandAnimatedHold(entry.opacity);

          break;
        case 'solid-color':
        case 'gradient-stop-color':
          expandAnimatedHold(entry.color);

          break;
        case 'stroke-width':
          expandAnimatedHold(entry.width);

          break;
        case 'context':
          expandAnimatedHold(entry.geometryScale);

          break;
      }
    }
  }
}

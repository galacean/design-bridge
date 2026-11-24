import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRAnimatedProperty, IRShape, IRTransform, IRVec3 } from '@galacean/animation-ir';
import { IRShapePrimitiveType } from '@galacean/animation-ir';
import {
  accumulateAncestors, decomposeMatrix, IDENTITY, invertSVGMatrix, multiply,
  parseTransform, transformPoint,
} from '../../matrix';
import { applySMILToTransform } from '../smil/apply-transform-animation';
import { collectSMILAnimationElements } from '../smil/resolve-animation-target';
import { readSVGElementOpacity } from '../../read-attributes';
import type { GeometryContext } from '../smil/types';

export function readRawNumberAttribute (el: Element, name: string, fallback = 0): number {
  const raw = (el as unknown as { node?: { getAttribute?: (attr: string) => string | null } }).node?.getAttribute?.(name);
  const value = raw == null || raw === '' ? fallback : Number.parseFloat(raw);

  return Number.isFinite(value) ? value : fallback;
}

function animatedLengthReference (el: Element, attributeName: string, baseValue: number): number {
  const node = (el as unknown as { node?: globalThis.Element | null }).node;

  if (node == null) { return baseValue; }
  // 非零原始尺寸作为几何基准；原始尺寸为零时取动画值的最大值。
  if (baseValue > 1e-9) { return baseValue; }
  const candidates = [baseValue];

  const root = ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;

  for (const child of collectSMILAnimationElements(node, root, new Set(['animate', 'set']))) {
    if (child.getAttribute('attributeName')?.toLowerCase() !== attributeName) { continue; }
    const values = child.getAttribute('values');

    if (values != null) {
      for (const value of values.split(';')) {
        const parsed = Number.parseFloat(value);

        if (Number.isFinite(parsed)) { candidates.push(parsed); }
      }
    }
    for (const attr of ['from', 'to']) {
      const parsed = Number.parseFloat(child.getAttribute(attr) ?? '');

      if (Number.isFinite(parsed)) { candidates.push(parsed); }
    }
    const by = Number.parseFloat(child.getAttribute('by') ?? '');

    if (Number.isFinite(by)) { candidates.push(baseValue + by); }
  }

  return Math.max(0, ...candidates.filter(Number.isFinite));
}

export function prepareSMILShapeGeometry (el: Element, shape: IRShape): void {
  const tag = (el as unknown as { node?: { tagName?: string } }).node?.tagName?.toLowerCase();

  if (shape.primitiveType === IRShapePrimitiveType.Rectangle && (tag === 'rect' || tag === 'image')) {
    shape.width = animatedLengthReference(el, 'width', shape.width);
    shape.height = animatedLengthReference(el, 'height', shape.height);
  } else if (shape.primitiveType === IRShapePrimitiveType.Ellipse && tag === 'circle') {
    const radius = animatedLengthReference(el, 'r', shape.xRadius);

    shape.xRadius = radius;
    shape.yRadius = radius;
  } else if (shape.primitiveType === IRShapePrimitiveType.Ellipse && tag === 'ellipse') {
    shape.xRadius = animatedLengthReference(el, 'rx', shape.xRadius);
    shape.yRadius = animatedLengthReference(el, 'ry', shape.yRadius);
  }
}

export function buildTransformGeometry (el: Element, shape: IRShape): GeometryContext | undefined {
  const tag = (el as unknown as { node?: { tagName?: string } }).node?.tagName?.toLowerCase();

  if (tag === 'use') {
    return {
      kind: 'use',
      base: {
        x: readRawNumberAttribute(el, 'x'),
        y: readRawNumberAttribute(el, 'y'),
      },
      referenceWidth: 1,
      referenceHeight: 1,
    };
  }
  if (tag === 'line' && shape.primitiveType === IRShapePrimitiveType.Custom) {
    return {
      kind: 'line',
      base: {
        x1: readRawNumberAttribute(el, 'x1'),
        y1: readRawNumberAttribute(el, 'y1'),
        x2: readRawNumberAttribute(el, 'x2'),
        y2: readRawNumberAttribute(el, 'y2'),
      },
      referenceWidth: 1,
      referenceHeight: 1,
    };
  }
  if (shape.primitiveType === IRShapePrimitiveType.Rectangle && (tag === 'rect' || tag === 'image')) {
    return {
      kind: 'rect',
      base: {
        x: readRawNumberAttribute(el, 'x'),
        y: readRawNumberAttribute(el, 'y'),
        width: readRawNumberAttribute(el, 'width'),
        height: readRawNumberAttribute(el, 'height'),
      },
      referenceWidth: shape.width,
      referenceHeight: shape.height,
    };
  }
  if (shape.primitiveType === IRShapePrimitiveType.Ellipse && tag === 'circle') {
    return {
      kind: 'circle',
      base: {
        cx: readRawNumberAttribute(el, 'cx'),
        cy: readRawNumberAttribute(el, 'cy'),
        r: readRawNumberAttribute(el, 'r'),
      },
      referenceWidth: shape.xRadius * 2,
      referenceHeight: shape.yRadius * 2,
    };
  }
  if (shape.primitiveType === IRShapePrimitiveType.Ellipse && tag === 'ellipse') {
    return {
      kind: 'ellipse',
      base: {
        cx: readRawNumberAttribute(el, 'cx'),
        cy: readRawNumberAttribute(el, 'cy'),
        rx: readRawNumberAttribute(el, 'rx'),
        ry: readRawNumberAttribute(el, 'ry'),
      },
      referenceWidth: shape.xRadius * 2,
      referenceHeight: shape.yRadius * 2,
    };
  }

  return undefined;
}

export function buildTransform (
  es: EditableSVG,
  el: Element,
  shape: IRShape,
  smilDurationSink: { value: number },
  frameRate: number,
  geometryScaleSink?: { value?: IRAnimatedProperty<IRVec3> },
): IRTransform {
  const localCenter = shape.position;
  // 使用祖先和元素自身的矩阵计算世界空间变换。
  const mAnc = accumulateAncestors(el);
  const selfAttr = (el as unknown as { node?: { getAttribute?: (n: string) => string | null } }).node?.getAttribute?.('transform') ?? '';
  const mSelf = selfAttr !== '' ? parseTransform(selfAttr) : IDENTITY;
  const m = multiply(mAnc, mSelf);
  const worldCenter = transformPoint(m, localCenter[0], localCenter[1]);
  const opacity = readSVGElementOpacity(el);
  const { sx, sy, rotation } = decomposeMatrix(m);

  const transform: IRTransform = {
    position: { type: 'static', value: [worldCenter.x, worldCenter.y, 0] as IRVec3 },
    scale: { type: 'static', value: [sx, sy, 1] },
    rotation: { z: { type: 'static', value: rotation } },
    // 以局部几何中心为 anchor，避免变换后重复偏移。
    anchor: { type: 'static', value: [localCenter[0], localCenter[1], 0] as IRVec3 },
    opacity: { type: 'static', value: opacity },
  };
  const geometry = buildTransformGeometry(el, shape);

  // 收集 transform、opacity、geometry 和 motion 动画。
  applySMILToTransform(el, transform, smilDurationSink, frameRate, {
    ancestorMatrix: mAnc,
    selfMatrix: mSelf,
    localCenter,
    geometry,
    geometryScaleSink,
    comparisonDuration: smilDurationSink.value,
  });

  return transform;
}

export function applySMILToParsedTransform (
  el: Element,
  transform: IRTransform | undefined,
  smilDurationSink: { value: number },
  frameRate: number,
  composeOpacityAcrossStages = false,
): void {
  if (transform == null) { return; }
  const position = transform.position;

  if (position == null || position.type === 'keyframed') { return; }
  const mAnc = accumulateAncestors(el);
  const selfAttr = (el as unknown as { node?: { getAttribute?: (name: string) => string | null } }).node?.getAttribute?.('transform') ?? '';
  const mSelf = selfAttr !== '' ? parseTransform(selfAttr) : IDENTITY;
  const fullMatrix = multiply(mAnc, mSelf);
  const localCenter = transformPoint(invertSVGMatrix(fullMatrix), position.value[0], position.value[1]);

  applySMILToTransform(el, transform, smilDurationSink, frameRate, {
    ancestorMatrix: mAnc,
    selfMatrix: mSelf,
    localCenter: [localCenter.x, localCenter.y],
    comparisonDuration: smilDurationSink.value,
    composeOpacityAcrossStages,
  });
}

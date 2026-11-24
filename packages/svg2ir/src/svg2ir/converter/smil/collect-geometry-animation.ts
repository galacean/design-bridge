import { sampleAnimationValue } from './build-keyframes';
import { parseSMILTag } from './parse-timeline';
import { collectSMILAnimationElements } from './resolve-animation-target';
import { getBeginTimeCache } from './timeline-schedule';
import {
  EPSILON,
  type BeginTimeCache, type GeometryAnimation, type GeometryContext, type GeometrySample,
  type SMILAnimation, type TransformContext, type TransformStage,
} from './types';

function activeIntervalBegin (animation: SMILAnimation, time: number): number | null {
  let frozenBegin: number | null = null;

  for (const interval of animation.intervals) {
    if (time < interval.begin - EPSILON) { break; }
    if (time < interval.end - EPSILON) { return interval.begin; }
    frozenBegin = animation.fill === 'freeze' ? interval.begin : null;
  }

  return frozenBegin;
}

function sampleNumericAttribute (
  attributeName: string,
  baseValue: number,
  animations: SMILAnimation[],
  time: number,
): number {
  const sampledAnimations: Array<{ animation: SMILAnimation; value: number[]; begin: number; order: number }> = [];

  animations.forEach((animation, order) => {
    if (animation.attributeName !== attributeName) { return; }
    const value = sampleAnimationValue(animation, time);
    const begin = activeIntervalBegin(animation, time);

    if (value != null && begin != null) {
      sampledAnimations.push({ animation, value, begin, order });
    }
  });
  sampledAnimations.sort((left, right) => left.begin - right.begin || left.order - right.order);

  let value = baseValue;

  for (const sampled of sampledAnimations) {
    value = sampled.animation.additive === 'sum' || sampled.animation.byOnly
      ? value + (sampled.value[0] ?? 0)
      : (sampled.value[0] ?? 0);
  }

  return value;
}

function readViewportDimension (root: globalThis.Element, axis: 'x' | 'y'): number | undefined {
  const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const viewBoxValue = axis === 'x' ? viewBox[2] : viewBox[3];

  if (Number.isFinite(viewBoxValue) && viewBoxValue > 0) { return viewBoxValue; }
  const raw = root.getAttribute(axis === 'x' ? 'width' : 'height') ?? '';
  const match = raw.trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);
  const value = match == null ? NaN : Number(match[1]);

  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseGeometryLength (
  raw: string,
  attributeName: string,
  root: globalThis.Element,
): number[] | null {
  const value = raw.trim();
  const axis = ['x', 'x1', 'x2', 'cx', 'width', 'rx'].includes(attributeName)
    ? 'x'
    : ['y', 'y1', 'y2', 'cy', 'height', 'ry'].includes(attributeName)
      ? 'y'
      : undefined;
  const reference = axis == null ? undefined : readViewportDimension(root, axis);
  const parseTerm = (term: string): number | null => {
    const match = term.trim().replace(/^([+-])\s+/, '$1').match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(%|px)?$/i);

    if (match == null) { return null; }
    const number = Number(match[1]);

    if (!Number.isFinite(number)) { return null; }
    if (match[2] === '%') { return reference == null ? null : number * reference / 100; }

    return number;
  };

  if (/^calc\(/i.test(value) && value.endsWith(')')) {
    const expression = value.slice(value.indexOf('(') + 1, -1);
    const terms = expression.match(/[+-]?\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:%|px)?/gi) ?? [];

    if (terms.length === 0 || terms.join('').replace(/\s+/g, '') !== expression.replace(/\s+/g, '')) { return null; }
    let total = 0;

    for (const term of terms) {
      const parsed = parseTerm(term);

      if (parsed == null) { return null; }
      total += parsed;
    }

    return [total];
  }

  const parsed = parseTerm(value);

  return parsed == null ? null : [parsed];
}

function supportedGeometryAttributes (kind: GeometryContext['kind']): ReadonlySet<string> {
  if (kind === 'use') { return new Set(['x', 'y']); }
  if (kind === 'rect') { return new Set(['x', 'y', 'width', 'height']); }
  if (kind === 'circle') { return new Set(['cx', 'cy', 'r']); }
  if (kind === 'line') { return new Set(['x1', 'y1', 'x2', 'y2']); }

  return new Set(['cx', 'cy', 'rx', 'ry']);
}

const LINE_ATTRIBUTES = ['x1', 'y1', 'x2', 'y2'] as const;

type LineAttribute = typeof LINE_ATTRIBUTES[number];

export function isLineGeometryAttribute (attributeName: string): attributeName is LineAttribute {
  return LINE_ATTRIBUTES.includes(attributeName as LineAttribute);
}

// 只有端点整体平移时才能复用静态 IR 路径；改变长度或方向需要重新生成路径。
function collectLineTranslationAnimation (
  geometry: GeometryContext,
  animations: SMILAnimation[],
): SMILAnimation | null {
  if (geometry.kind !== 'line') { return null; }

  const baseValues = LINE_ATTRIBUTES.map(attribute => geometry.base[attribute] ?? 0);
  const animationsByAttribute = new Map<LineAttribute, SMILAnimation>();

  for (const attribute of LINE_ATTRIBUTES) {
    const matches = animations.filter(animation => animation.attributeName === attribute);

    if (matches.length > 1) { return null; }
    if (matches[0] != null) { animationsByAttribute.set(attribute, matches[0]); }
  }

  const master = LINE_ATTRIBUTES.map(attribute => animationsByAttribute.get(attribute)).find(animation => animation != null);

  if (master == null) { return null; }

  const samples = master.samples.map(sample => {
    const values = LINE_ATTRIBUTES.map((attribute, index) => {
      const animation = animationsByAttribute.get(attribute);
      const baseValue = baseValues[index] ?? 0;

      if (animation == null) { return baseValue; }
      const matchingSample = animation.samples.find(candidate => (
        candidate.sourceIndex === sample.sourceIndex && Math.abs(candidate.time - sample.time) < 1e-6
      )) ?? animation.samples.find(candidate => Math.abs(candidate.time - sample.time) < 1e-6);

      if (matchingSample == null) { return NaN; }
      const value = matchingSample.value[0];

      return animation.additive === 'sum' || animation.byOnly ? baseValue + (value ?? 0) : value ?? NaN;
    });
    const offsetX = values[0] - (baseValues[0] ?? 0);
    const offsetY = values[1] - (baseValues[1] ?? 0);
    const isTranslation = Number.isFinite(offsetX) && Number.isFinite(offsetY)
      && Math.abs(values[2] - (baseValues[2] ?? 0) - offsetX) < 1e-6
      && Math.abs(values[3] - (baseValues[3] ?? 0) - offsetY) < 1e-6;

    return isTranslation ? { ...sample, value: [offsetX, offsetY] } : null;
  });

  if (samples.some(sample => sample == null)) { return null; }

  return {
    ...master,
    attributeName: 'transform',
    type: 'translate',
    additive: 'sum',
    byOnly: false,
    samples: samples as SMILAnimation['samples'],
  };
}

function parseGeometryAnimations (
  target: globalThis.Element,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  geometry: GeometryContext,
  comparisonDuration?: number,
): SMILAnimation[] {
  const supported = supportedGeometryAttributes(geometry.kind);

  return collectSMILAnimationElements(target, root, new Set(['animate', 'set']))
    .map(tag => {
      const attributeName = tag.getAttribute('attributeName')?.trim().toLowerCase() ?? '';
      const underlyingValue = Object.prototype.hasOwnProperty.call(geometry.base, attributeName)
        ? [geometry.base[attributeName]]
        : undefined;
      const valueParser = supported.has(attributeName)
        ? (value: string): number[] | null => parseGeometryLength(value, attributeName, root)
        : undefined;

      return parseSMILTag(tag, root, beginCache, comparisonDuration, valueParser, underlyingValue);
    })
    .filter((animation): animation is SMILAnimation => animation != null && supported.has(animation.attributeName));
}

function readLineBaseValue (target: globalThis.Element, attributeName: LineAttribute): number {
  const value = Number.parseFloat(target.getAttribute(attributeName) ?? '');

  return Number.isFinite(value) ? value : 0;
}

export function canConvertLineGeometryAnimations (
  target: globalThis.Element,
  root: globalThis.Element,
): boolean {
  if (target.tagName.toLowerCase() !== 'line') { return false; }
  const geometry: GeometryContext = {
    kind: 'line',
    base: Object.fromEntries(LINE_ATTRIBUTES.map(attribute => [attribute, readLineBaseValue(target, attribute)])),
    referenceWidth: 1,
    referenceHeight: 1,
  };
  const animations = parseGeometryAnimations(target, root, getBeginTimeCache(root), geometry);

  return collectLineTranslationAnimation(geometry, animations) != null;
}

function sampleGeometry (
  geometry: GeometryContext,
  animations: SMILAnimation[],
  time: number,
): GeometrySample {
  let centerX: number;
  let centerY: number;
  let width: number;
  let height: number;

  if (geometry.kind === 'use') {
    centerX = sampleNumericAttribute('x', geometry.base['x'], animations, time);
    centerY = sampleNumericAttribute('y', geometry.base['y'], animations, time);
    width = 1;
    height = 1;
  } else if (geometry.kind === 'rect') {
    const x = sampleNumericAttribute('x', geometry.base['x'], animations, time);
    const y = sampleNumericAttribute('y', geometry.base['y'], animations, time);

    width = Math.max(0, sampleNumericAttribute('width', geometry.base['width'], animations, time));
    height = Math.max(0, sampleNumericAttribute('height', geometry.base['height'], animations, time));
    centerX = x + width / 2;
    centerY = y + height / 2;
  } else if (geometry.kind === 'circle') {
    const radius = Math.max(0, sampleNumericAttribute('r', geometry.base['r'], animations, time));

    width = radius * 2;
    height = radius * 2;
    centerX = sampleNumericAttribute('cx', geometry.base['cx'], animations, time);
    centerY = sampleNumericAttribute('cy', geometry.base['cy'], animations, time);
  } else {
    const rx = Math.max(0, sampleNumericAttribute('rx', geometry.base['rx'], animations, time));
    const ry = Math.max(0, sampleNumericAttribute('ry', geometry.base['ry'], animations, time));

    width = rx * 2;
    height = ry * 2;
    centerX = sampleNumericAttribute('cx', geometry.base['cx'], animations, time);
    centerY = sampleNumericAttribute('cy', geometry.base['cy'], animations, time);
  }

  return {
    centerX,
    centerY,
    scaleX: geometry.referenceWidth > EPSILON ? width / geometry.referenceWidth : 1,
    scaleY: geometry.referenceHeight > EPSILON ? height / geometry.referenceHeight : 1,
  };
}

export function collectGeometryAnimation (
  stage: TransformStage,
  root: globalThis.Element,
  beginCache: BeginTimeCache,
  context: TransformContext,
): GeometryAnimation | null {
  const geometry = context.geometry;

  if (geometry == null) { return null; }
  const animations = parseGeometryAnimations(stage.node, root, beginCache, geometry, context.comparisonDuration);

  if (animations.length === 0 && (geometry.kind !== 'use' || (geometry.base['x'] === 0 && geometry.base['y'] === 0))) {
    return null;
  }

  if (geometry.kind === 'line') {
    const translation = collectLineTranslationAnimation(geometry, animations);

    if (translation == null) { return null; }

    return {
      animations: [translation],
      matrixAtTime: time => {
        const value = sampleAnimationValue(translation, time);

        return { a: 1, b: 0, c: 0, d: 1, e: value?.[0] ?? 0, f: value?.[1] ?? 0 };
      },
      scaleAtTime: () => ({ x: 1, y: 1 }),
    };
  }

  return {
    animations,
    matrixAtTime: time => {
      const sample = sampleGeometry(geometry, animations, time);

      if (geometry.kind === 'use') {
        return { a: 1, b: 0, c: 0, d: 1, e: sample.centerX, f: sample.centerY };
      }

      return {
        a: sample.scaleX,
        b: 0,
        c: 0,
        d: sample.scaleY,
        e: sample.centerX - sample.scaleX * context.localCenter[0],
        f: sample.centerY - sample.scaleY * context.localCenter[1],
      };
    },
    scaleAtTime: time => {
      const sample = sampleGeometry(geometry, animations, time);

      return { x: sample.scaleX, y: sample.scaleY };
    },
  };
}

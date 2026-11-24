import type { IRColor } from '@galacean/animation-ir';
import { mapSVGColorToIRColor } from '../../map-color';
import type { SVGPreservedPaintAnimation } from '../../../svg-preserved-data';
import { makeKeyframes } from './build-keyframes';
import { findAnimationById, parseColorValue, parseSMILTag } from './parse-timeline';
import { getBeginTimeCache } from './timeline-schedule';
import { collectSMILAnimationElements } from './resolve-animation-target';

function paintServerId (raw: string | undefined): string | null {
  const match = raw?.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

  return match?.[1] ?? null;
}

function clampOpacity (raw: string | null, fallback = 1): number {
  const value = raw == null || raw.trim() === '' ? fallback : Number(raw);

  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

export function parseSMILPaintAnimations (
  el: { node?: globalThis.Element | null },
  frameRate: number,
  comparisonDuration: number,
  baseOpacity: { fill: number; stroke: number },
  alphaBase: { fill: number; stroke: number },
  paintSources: { fill?: string; stroke?: string },
  baseStrokeWidth = 1,
): SVGPreservedPaintAnimation[] {
  const node = el.node;

  if (node == null) { return []; }
  const root = ((node as globalThis.SVGElement).ownerSVGElement ?? node) as globalThis.Element;
  const beginCache = getBeginTimeCache(root, comparisonDuration);
  const result: SVGPreservedPaintAnimation[] = [];

  for (const child of collectSMILAnimationElements(node, root, new Set(['animate', 'set']))) {
    const attributeName = child.getAttribute('attributeName')?.toLowerCase();

    if (attributeName !== 'fill' && attributeName !== 'stroke') { continue; }
    const paintSource = paintSources[attributeName];

// solid material 只有一个 _Color 槽位；渐变动画由 stop-color 路径处理。
    if (paintSource == null || paintSource.trim().toLowerCase() === 'none' || paintServerId(paintSource) != null) { continue; }
    const baseColor = mapSVGColorToIRColor(paintSource, 1);
    const animation = baseColor == null
      ? null
      : parseSMILTag(child, root, beginCache, comparisonDuration, parseColorValue, baseColor);

    if (animation == null || baseColor == null) { continue; }
    result.push({
      kind: 'solid-color',
      target: attributeName,
      color: {
        type: 'keyframed',
        keyframes: makeKeyframes(animation, frameRate, value => [
          value[0] ?? 0,
          value[1] ?? 0,
          value[2] ?? 0,
          value[3] ?? 1,
        ] as IRColor, baseColor),
      },
    });
  }

  for (const child of collectSMILAnimationElements(node, root, new Set(['animate', 'set']))) {
    const rawAttributeName = child.getAttribute('attributeName')?.toLowerCase();
    const target = rawAttributeName === 'fill-opacity'
      ? 'fill'
      : rawAttributeName === 'stroke-opacity'
        ? 'stroke'
        : null;
    const underlyingValue = rawAttributeName === 'stroke-width'
      ? [baseStrokeWidth]
      : target == null
        ? undefined
        : [baseOpacity[target]];
    const animation = parseSMILTag(child, root, beginCache, comparisonDuration, undefined, underlyingValue);
    const attributeName = animation?.attributeName;

    if (animation != null && attributeName === 'stroke-width') {
      result.push({
        kind: 'stroke-width',
        width: {
          type: 'keyframed',
          keyframes: makeKeyframes(animation, frameRate, value => value[0] ?? baseStrokeWidth, baseStrokeWidth),
        },
      });
      continue;
    }
    if (animation == null || target == null) { continue; }
    result.push({
      kind: 'opacity',
      target,
      opacity: {
        type: 'keyframed',
        keyframes: makeKeyframes(animation, frameRate, value => value[0] ?? 0, baseOpacity[target]),
      },
      alphaBase: alphaBase[target],
    });
  }

  for (const target of ['fill', 'stroke'] as const) {
    const gradientId = paintServerId(paintSources[target]);

    if (gradientId == null) { continue; }
    const gradient = findAnimationById(root, gradientId);
    const gradientTag = gradient?.tagName.toLowerCase();

    if (gradient == null || (gradientTag !== 'lineargradient' && gradientTag !== 'radialgradient')) { continue; }
    const stops = Array.from(gradient.children).filter(child => child.tagName.toLowerCase() === 'stop');

    for (let stopIndex = 0; stopIndex < stops.length; stopIndex++) {
      const stop = stops[stopIndex];
      const stopOpacity = clampOpacity(stop.getAttribute('stop-opacity'));
      const alphaMultiplier = stopOpacity * baseOpacity[target] * alphaBase[target];
      const staticColor = mapSVGColorToIRColor(stop.getAttribute('stop-color') ?? 'black', 1) ?? [0, 0, 0, 1];

      for (const child of collectSMILAnimationElements(stop, root, new Set(['animate', 'set']))) {
        if (child.getAttribute('attributeName')?.toLowerCase() !== 'stop-color') {
          continue;
        }
        const baseColor: IRColor = [
          staticColor[0],
          staticColor[1],
          staticColor[2],
          staticColor[3] * alphaMultiplier,
        ];
        const animation = parseSMILTag(child, root, beginCache, comparisonDuration, parseColorValue, baseColor);

        if (animation == null) { continue; }
        result.push({
          kind: 'gradient-stop-color',
          target,
          paintIndex: 0,
          stopIndex,
          color: {
            type: 'keyframed',
            keyframes: makeKeyframes(animation, frameRate, value => [
              value[0] ?? 0,
              value[1] ?? 0,
              value[2] ?? 0,
              (value[3] ?? 1) * alphaMultiplier,
            ] as IRColor, baseColor),
          },
        });
      }
    }
  }

  return result;
}

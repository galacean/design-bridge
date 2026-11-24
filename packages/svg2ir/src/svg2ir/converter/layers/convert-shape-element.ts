import type { Element } from '@svgdotjs/svg.js';
import type { IRAnimatedProperty, IRLayer, IRVec3 } from '@galacean/animation-ir';
import { IRLayerType, IRShapePrimitiveType } from '@galacean/animation-ir';
import { mapSVGColorToIRColor } from '../../map-color';
import { accumulateOpacity } from '../../matrix';
import { isSVGElementVisible } from '../../read-attributes';
import { canSynthesizeDash } from '../shape/parse-dash';
import { parseSMILPaintAnimations } from '../smil/parse-paint-animation';
import { parseShapeGeometryAnimation } from '../smil/parse-shape-animation';
import { buildTransform, prepareSMILShapeGeometry, readRawNumberAttribute } from '../transform/build-transform';
import {
  warnUnsupportedAttributes,
} from '../diagnostics/warn-unsupported';
import { gradientStopColorAlpha } from '../paint/resolve-gradient';
import { hasAnimatedAncestorOpacity, hasAnimatedVisibility, hasDirectOpacityAnimation } from '../smil/inspect-animation';
import { parseShapeElement } from '../shape/parse-shape-element';
import type { ShapeConversionContext } from './conversion-session';

export function convertShapeElement (element: Element, context: ShapeConversionContext): void {
  const tag = element.node?.tagName?.toLowerCase() ?? '';
  const shape = parseShapeElement(context.es, element, tag);

  if (shape == null) { return; }

  const dashSynthesized = shape.primitiveType === IRShapePrimitiveType.Custom
    && canSynthesizeDash(
      context.es,
      element,
      shape.fills ?? [],
      shape.strokes ?? [],
      shape.strokes[0]?.width,
      shape.customPaths,
    );

  warnUnsupportedAttributes(context.es, element, tag, context.emit, context.strict, context.idEls, false, dashSynthesized);

  prepareSMILShapeGeometry(element, shape);
  const geometryScaleSink: { value?: IRAnimatedProperty<IRVec3> } = {};
  const transform = buildTransform(
    context.es,
    element,
    shape,
    context.smilDurationSink ?? { value: 0 },
    context.frameRate,
    geometryScaleSink,
  );
  const layerIndex = context.allocateLayerIndex();

  if (context.shapeAnimationsByLayerId != null) {
    const shapeAnimation = parseShapeGeometryAnimation(
      element,
      shape,
      context.smilDurationSink?.value ?? context.durationSeconds,
    );

    if (shapeAnimation != null) {
      context.shapeAnimationsByLayerId.set(`${layerIndex}`, shapeAnimation);
    }
  }

  if (context.paintAnimationsByLayerId != null) {
    const node = element.node;
    const ownOpacity = readRawNumberAttribute(element, 'opacity', 1);
    const elementOpacity = Math.max(0, Math.min(1, ownOpacity * accumulateOpacity(element)));
    const fillOpacity = Number(context.es.getAttr(element, 'fill-opacity') ?? 1);
    const strokeOpacity = Number(context.es.getAttr(element, 'stroke-opacity') ?? 1);
    const normalizedPaintOpacity = {
      fill: Number.isFinite(fillOpacity) ? Math.max(0, Math.min(1, fillOpacity)) : 1,
      stroke: Number.isFinite(strokeOpacity) ? Math.max(0, Math.min(1, strokeOpacity)) : 1,
    };
    const fillRaw = String(context.es.getAttr(element, 'fill') ?? '');
    const strokeRaw = String(context.es.getAttr(element, 'stroke') ?? '');
    const fillColor = /^url\(/i.test(fillRaw)
      ? null
      : mapSVGColorToIRColor(fillRaw === '' ? 'black' : fillRaw, 1);
    const strokeColor = /^url\(/i.test(strokeRaw) ? null : mapSVGColorToIRColor(strokeRaw, 1);
    const paintAnimations = parseSMILPaintAnimations(
      element,
      context.frameRate,
      context.smilDurationSink?.value ?? context.durationSeconds,
      normalizedPaintOpacity,
      {
        fill: elementOpacity * (fillColor?.[3] ?? 1),
        stroke: elementOpacity * (strokeColor?.[3] ?? 1),
      },
      {
        fill: fillRaw,
        stroke: strokeRaw,
      },
      shape.strokes[0]?.width ?? 1,
    );
    const ancestorOpacityAnimated = hasAnimatedAncestorOpacity(element);
    const opacityAnimated = ancestorOpacityAnimated || hasDirectOpacityAnimation(node);

    if (paintAnimations.length > 0 || opacityAnimated || geometryScaleSink.value != null) {
      context.paintAnimationsByLayerId.set(`${layerIndex}`, [{
        kind: 'context',
        staticElementOpacity: elementOpacity,
        layerOpacityMultiplier: ancestorOpacityAnimated ? 1 : accumulateOpacity(element),
        paintOpacity: normalizedPaintOpacity,
        solidColorAlpha: {
          fill: fillColor?.[3] ?? 1,
          stroke: strokeColor?.[3] ?? 1,
        },
        gradientStopColorAlpha: {
          fill: gradientStopColorAlpha(element, fillRaw),
          stroke: gradientStopColorAlpha(element, strokeRaw),
        },
        geometryScale: geometryScaleSink.value,
      }, ...paintAnimations]);
    }
  }

  const layer: IRLayer = {
    type: IRLayerType.Shape,
    id: `${layerIndex}`,
    name: String(context.es.getAttr(element, 'id') ?? tag ?? 'shape'),
    time: { inFrame: 0, outFrame: context.outFrame },
    visible: isSVGElementVisible(context.es, element) || hasAnimatedVisibility(element),
    content: { shapes: [shape] },
    transform,
  };

  context.appendLayer(layer, element);
}

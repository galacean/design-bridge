import type { Element } from '@svgdotjs/svg.js';
import type { IRLayer } from '@galacean/animation-ir';
import { SVG2IR_WARNING_CODES } from '../../../common/types';
import { collectWarning, describeElement } from '../diagnostics/collect-warnings';
import { parseImageLayer } from '../image/parse-image';
import { buildTransform, prepareSMILShapeGeometry } from '../transform/build-transform';
import { warnUnsupportedAttributes } from '../diagnostics/warn-unsupported';
import { hasAnimatedVisibility } from '../smil/inspect-animation';
import { parseRect } from '../shape/parse-shape-primitives';
import type { ImageConversionContext } from './conversion-session';

export function convertImageElement (element: Element, context: ImageConversionContext): void {
  const parsed = parseImageLayer(context.es, element, context.imageNaturalSizes, context.resourceBaseUrl);

  if (parsed == null) {
    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.ELEMENT_DROPPED,
      '元素 <image> 缺失 href 或有效尺寸,已跳过。',
      describeElement(element),
      context.strict,
    );

    return;
  }
  const { layer: imageLayer, asset: imageAsset } = parsed;

  imageLayer.visible = imageLayer.visible || hasAnimatedVisibility(element);
  context.appendAsset(imageAsset);
  const imageShape = parseRect(context.es, element);

  prepareSMILShapeGeometry(element, imageShape);
  const transform = buildTransform(
    context.es,
    element,
    imageShape,
    context.smilDurationSink ?? { value: 0 },
    context.frameRate,
  );

  transform.anchor = imageLayer.transform?.anchor;

  const layerIndex = context.allocateLayerIndex();
  const layer: IRLayer = {
    ...imageLayer,
    id: `${layerIndex}`,
    name: String(context.es.getAttr(element, 'id') ?? 'image'),
    time: { inFrame: 0, outFrame: context.outFrame },
    transform,
  };

  context.appendLayer(layer, element);
  warnUnsupportedAttributes(
    context.es,
    element,
    'image',
    context.emit,
    context.strict,
    context.idEls,
  );
}

import type { Element } from '@svgdotjs/svg.js';
import type { IRLayer, IRTextLayer } from '@galacean/animation-ir';
import { IRLayerType } from '@galacean/animation-ir';
import { describeElement } from '../diagnostics/collect-warnings';
import { applySMILToParsedTransform } from '../transform/build-transform';
import {
  warnTextPaintDropped, warnUnsupportedAttributes,
} from '../diagnostics/warn-unsupported';
import { hasAnimatedVisibility } from '../smil/inspect-animation';
import { parseTextLayers } from '../text/parse';
import type { TextConversionContext } from './conversion-session';

export function convertTextElement (element: Element, context: TextConversionContext): void {
  const parsed = parseTextLayers(context.es, element, context.measureText);

  if (parsed == null) { return; }
  const { layers: textLayers, infos } = parsed;
  const animatedVisibility = hasAnimatedVisibility(element);

  for (const textLayer of textLayers) {
    textLayer.visible = textLayer.visible || animatedVisibility;
    applySMILToParsedTransform(
      element,
      textLayer.transform,
      context.smilDurationSink ?? { value: 0 },
      context.frameRate,
      true,
    );
  }

  warnUnsupportedAttributes(
    context.es,
    element,
    'text',
    context.emit,
    context.strict,
    context.idEls,
    true,
  );
  warnTextPaintDropped(context.es, element, describeElement(element), context.emit, context.strict);

  const baseName = String(context.es.getAttr(element, 'id') ?? `text_${context.peekLayerIndex()}`);

  for (let index = 0; index < textLayers.length; index++) {
    const textLayer = textLayers[index];
    const info = infos[index];
    const textName = textLayers.length > 1 ? `${baseName}__seg${index}` : baseName;
    const layerIndex = context.allocateLayerIndex();

    if (info != null) {
      context.registerTextFontAsset(textLayer.content, info);
    }

    const textLayerId = `${layerIndex}`;
    const layer: IRLayer = {
      ...(textLayer as object),
      type: IRLayerType.Text,
      id: textLayerId,
      name: textName,
      time: { inFrame: 0, outFrame: context.outFrame },
      content: textLayer.content,
      transform: textLayer.transform,
    } as IRTextLayer;

    if (context.textDataByLayerId != null && info != null) {
      context.textDataByLayerId.set(textLayerId, info);
    }
    context.appendLayer(layer, element);
  }
}

import type { Element } from '@svgdotjs/svg.js';
import { convertGroupElement } from './convert-group-element';
import { convertImageElement } from './convert-image-element';
import { convertShapeElement } from './convert-shape-element';
import { convertTextElement } from './convert-text-element';
import { convertUseElement } from './convert-use-element';
import {
  createLayerOutput,
  createSVGConversionEnvironment,
  createSVGElementLookup,
  type GroupConversionContext,
  type ImageConversionContext,
  type ShapeConversionContext,
  type SVGConversionSession,
  type TextConversionContext,
  type UseConversionContext,
} from './conversion-session';

export type SVGElementConverter = (element: Element) => void;

export function createSVGElementConverterRegistry (session: SVGConversionSession): ReadonlyMap<string, SVGElementConverter> {
  const environment = createSVGConversionEnvironment(session);
  const lookup = createSVGElementLookup(session);
  const output = createLayerOutput(session);
  const shapeContext: ShapeConversionContext = {
    ...environment,
    idEls: lookup.idEls,
    allocateLayerIndex: output.allocateLayerIndex,
    appendLayer: output.appendLayer,
    paintAnimationsByLayerId: session.paintAnimationsByLayerId,
    shapeAnimationsByLayerId: session.shapeAnimationsByLayerId,
  };
  const textContext: TextConversionContext = {
    ...environment,
    idEls: lookup.idEls,
    measureText: session.measureText,
    textDataByLayerId: session.textDataByLayerId,
    allocateLayerIndex: output.allocateLayerIndex,
    peekLayerIndex: output.peekLayerIndex,
    appendLayer: output.appendLayer,
    registerTextFontAsset: output.registerTextFontAsset,
  };
  const imageContext: ImageConversionContext = {
    ...environment,
    idEls: lookup.idEls,
    imageNaturalSizes: session.imageNaturalSizes,
    resourceBaseUrl: session.resourceBaseUrl,
    allocateLayerIndex: output.allocateLayerIndex,
    appendLayer: output.appendLayer,
    appendAsset: output.appendAsset,
  };
  const useContext: UseConversionContext = {
    ...environment,
    ...lookup,
    measureText: session.measureText,
    allocateLayerIndex: output.allocateLayerIndex,
    peekLayerIndex: output.peekLayerIndex,
    appendLayer: output.appendLayer,
    registerTextFontAsset: output.registerTextFontAsset,
    imageNaturalSizes: session.imageNaturalSizes,
    resourceBaseUrl: session.resourceBaseUrl,
    appendAsset: output.appendAsset,
    textDataByLayerId: session.textDataByLayerId,
  };
  const groupContext: GroupConversionContext = {
    ...environment,
    idEls: lookup.idEls,
    groupMaskGNodeToIndex: session.groupMaskGNodeToIndex,
    allocateLayerIndex: output.allocateLayerIndex,
    appendLayer: output.appendLayer,
  };
  const registry = new Map<string, SVGElementConverter>();

  for (const tag of ['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line']) {
    registry.set(tag, element => convertShapeElement(element, shapeContext));
  }
  registry.set('image', element => convertImageElement(element, imageContext));
  registry.set('text', element => convertTextElement(element, textContext));
  registry.set('use', element => convertUseElement(element, useContext));
  registry.set('g', element => convertGroupElement(element, groupContext));
  registry.set('symbol', () => undefined);

  return registry;
}

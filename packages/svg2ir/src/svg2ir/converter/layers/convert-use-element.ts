import type { Element } from '@svgdotjs/svg.js';
import { IRLayerType, type IRImageLayer, type IRShape, type IRShapeLayer, type IRTextLayer, type IRTransform, type IRVec3 } from '@galacean/animation-ir';
import { SVG2IR_WARNING_CODES } from '../../../common/types';
import { readPresentationAttribute } from '../../../parse-svg/read-presentation-attribute';
import { accumulateAncestors, buildViewBoxMatrix, IDENTITY, multiply, parseTransform, type SVGMatrix } from '../../matrix';
import { isSVGElementVisible, readSVGElementOpacity, readSVGNumberAttribute, readSVGOwnOpacity } from '../../read-attributes';
import { applySMILToTransformWithOuter } from '../smil/apply-transform-animation';
import { applySMILToParsedTransform, buildTransformGeometry, prepareSMILShapeGeometry } from '../transform/build-transform';
import { collectWarning, describeElement } from '../diagnostics/collect-warnings';
import { applyUseStyleOverrides, buildUseMatrix, buildUseTransform, readUseTarget, readUseTranslate } from '../use/expand-use';
import { collectGroupUseInstances, type GroupUseInstance } from '../use/collect-group-use-instances';
import { warnUnsupportedAttributes } from '../diagnostics/warn-unsupported';
import { hasAnimatedVisibility } from '../smil/inspect-animation';
import { parseTextLayers } from '../text/parse';
import { parseImageLayer } from '../image/parse-image';
import { parseRect } from '../shape/parse-shape-primitives';
import type { TransformContext } from '../smil/types';
import type { UseConversionContext } from './conversion-session';

const SMIL_ANIMATION_TAGS = new Set(['animate', 'animatetransform', 'animatemotion', 'set']);

function readElementTransform (element: Element): SVGMatrix {
  const raw = element.node?.getAttribute('transform') ?? '';

  return raw === '' ? IDENTITY : parseTransform(raw);
}

function hasDirectSMILAnimation (element: Element): boolean {
  return Array.from(element.node?.children ?? []).some(child => SMIL_ANIMATION_TAGS.has(child.tagName.toLowerCase()));
}

function hasSMILAnimationInChain (element: Element, stopNode: globalThis.Element | null): boolean {
  let current: globalThis.Element | null = element.node;

  while (current != null && current !== stopNode) {
    if (Array.from(current.children).some(child => SMIL_ANIMATION_TAGS.has(child.tagName.toLowerCase()))) { return true; }
    current = current.parentNode as globalThis.Element | null;
  }

  return false;
}

function isVisibleOrAnimated (element: Element, es: UseConversionContext['es']): boolean {
  return isSVGElementVisible(es, element) || hasAnimatedVisibility(element);
}

function buildUseLayerVisibility (
  context: UseConversionContext,
  useElement: Element,
  targetElement: Element | undefined,
): boolean {
  return isVisibleOrAnimated(useElement, context.es)
    && (targetElement == null || isVisibleOrAnimated(targetElement, context.es));
}

function applyReferencedAnimationToTransform (
  targetElement: Element,
  useElement: Element,
  shape: IRShape,
  context: UseConversionContext,
  transform: IRTransform,
  targetStopNode: globalThis.Element | null,
  preserveTargetAncestors: boolean,
  targetAncestorMatrix = IDENTITY,
): void {
  const durationSink = context.smilDurationSink ?? { value: 0 };
  const comparisonDuration = durationSink.value > 0 ? durationSink.value : context.durationSeconds;
  const outerContext: TransformContext = {
    ancestorMatrix: accumulateAncestors(useElement),
    selfMatrix: readElementTransform(useElement),
    localCenter: shape.position,
    geometry: buildTransformGeometry(useElement, shape),
    comparisonDuration,
  };
  const targetContext: TransformContext = {
    ancestorMatrix: targetAncestorMatrix,
    selfMatrix: readElementTransform(targetElement),
    localCenter: shape.position,
    ancestorStopNode: targetStopNode,
    preserveAncestorTransforms: preserveTargetAncestors,
    geometry: buildTransformGeometry(targetElement, shape),
    comparisonDuration,
  };

  applySMILToTransformWithOuter(
    targetElement,
    useElement,
    transform,
    durationSink,
    context.frameRate,
    targetContext,
    outerContext,
  );
}

type UseLayerBody =
  | Omit<IRShapeLayer, 'id' | 'name' | 'time' | 'visible'>
  | Omit<IRTextLayer, 'id' | 'name' | 'time' | 'visible'>
  | Omit<IRImageLayer, 'id' | 'name' | 'time' | 'visible'>;

type ParsedTextLayers = NonNullable<ReturnType<typeof parseTextLayers>>;
type ParsedImageLayer = NonNullable<ReturnType<typeof parseImageLayer>>;

interface UseTransformOptions {
  targetElement?: Element;
  useX: number;
  useY: number;
  targetMatrix: SVGMatrix;
  targetOpacity: number;
  shouldApplyAnimation: boolean;
  targetStopNode: globalThis.Element | null;
  preserveTargetAncestors: boolean;
  targetAncestorMatrix?: SVGMatrix;
}

interface UseLayerMetadata {
  name: string;
  visible: boolean;
}

interface UseShapeLayerOptions extends UseTransformOptions, UseLayerMetadata {
  sourceElement?: Element;
  shape: IRShape;
}

interface UseImageLayerOptions extends UseTransformOptions, UseLayerMetadata {
  targetElement: Element;
}

interface BuildUseInstanceTransformOptions extends UseTransformOptions {
  useElement: Element;
  context: UseConversionContext;
  shape: IRShape;
}

function applyUseInstanceStyles (
  context: UseConversionContext,
  useElement: Element,
  targetElement: Element | undefined,
  shape: IRShape,
  sourceElement?: Element,
): IRShape {
  const sourceShape = sourceElement == null
    ? shape
    : applyUseStyleOverrides(context.es, sourceElement, targetElement, shape);

  return applyUseStyleOverrides(context.es, useElement, targetElement, sourceShape);
}

function buildUseInstanceTransform (options: BuildUseInstanceTransformOptions): IRTransform {
  if (options.shouldApplyAnimation && options.targetElement != null) {
    prepareSMILShapeGeometry(options.targetElement, options.shape);
  }
  const transform = buildUseTransform(
    options.useElement,
    options.shape,
    options.useX,
    options.useY,
    options.targetMatrix,
    options.targetOpacity,
  );

  if (!options.shouldApplyAnimation || options.targetElement == null) { return transform; }
  applyReferencedAnimationToTransform(
    options.targetElement,
    options.useElement,
    options.shape,
    options.context,
    transform,
    options.targetStopNode,
    options.preserveTargetAncestors,
    options.targetAncestorMatrix,
  );

  return transform;
}

function appendUseLayer (
  context: UseConversionContext,
  element: Element,
  layer: UseLayerBody,
  name: string,
  visible: boolean,
): string {
  const layerId = `${context.allocateLayerIndex()}`;

  context.appendLayer({
    ...layer,
    id: layerId,
    name,
    time: { inFrame: 0, outFrame: context.outFrame },
    visible,
  }, element);

  return layerId;
}

function appendUseShapeLayer (element: Element, context: UseConversionContext, options: UseShapeLayerOptions): void {
  const instanceShape = applyUseInstanceStyles(
    context,
    element,
    options.targetElement,
    options.shape,
    options.sourceElement,
  );
  const transform = buildUseInstanceTransform({
    ...options,
    useElement: element,
    context,
    shape: instanceShape,
  });

  appendUseLayer(context, element, {
    type: IRLayerType.Shape,
    content: { shapes: [instanceShape] },
    transform,
  }, options.name, options.visible);
}

function appendUseTextLayers (
  element: Element,
  context: UseConversionContext,
  targetElement: Element,
  parsed: ParsedTextLayers,
  useMatrix: SVGMatrix,
  useOpacity: number,
  visible: boolean,
  getName: (index: number, split: boolean) => string,
): void {
  const pureTranslation = isPureTranslation(useMatrix);

  for (let index = 0; index < parsed.layers.length; index++) {
    const textLayer = parsed.layers[index];
    const info = parsed.infos[index];

    if (textLayer == null) { continue; }
    applySMILToParsedTransform(
      targetElement,
      textLayer.transform,
      context.smilDurationSink ?? { value: 0 },
      context.frameRate,
      true,
    );
    if (pureTranslation) {
      applyUseTranslationToText(textLayer.transform, useMatrix, useOpacity);
    }
    if (info != null) { context.registerTextFontAsset(textLayer.content, info); }
    const layerId = appendUseLayer(context, element, {
      type: IRLayerType.Text,
      content: textLayer.content,
      transform: textLayer.transform,
    }, getName(index, parsed.layers.length > 1), visible);

    if (context.textDataByLayerId != null && info != null) {
      context.textDataByLayerId.set(layerId, info);
    }
  }
}

function appendUseImageLayer (
  element: Element,
  context: UseConversionContext,
  parsed: ParsedImageLayer,
  options: UseImageLayerOptions,
): void {
  const imageShape = parseRect(context.es, options.targetElement);
  const transform = buildUseInstanceTransform({
    ...options,
    useElement: element,
    context,
    shape: imageShape,
  });

  transform.anchor = parsed.layer.transform?.anchor;
  context.appendAsset(parsed.asset);
  appendUseLayer(context, element, { ...parsed.layer, transform }, options.name, options.visible);
}

export function convertUseElement (element: Element, context: UseConversionContext): void {
  const targetId = readUseTarget(context.es, element);
  const selector = describeElement(element);

  if (targetId == null) {
    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.ELEMENT_DROPPED,
      '元素 <use> 无有效 href 引用,已跳过。',
      selector,
      context.strict,
    );

    return;
  }
  const groupDef = context.idGroups.get(targetId);

  if (groupDef != null) {
    const instances = collectGroupUseInstances(context.es, groupDef, context.idShapes, context.idEls);

    if (instances.length > 0) {
      convertGroupUse(element, context, instances, targetId);

      return;
    }
  }
  const shape = context.idShapes.get(targetId);

  if (shape == null) {
    if (tryConvertSymbolUse(element, context, targetId)) { return; }
    if (tryConvertTextUse(element, context, targetId)) { return; }
    if (tryConvertImageUse(element, context, targetId)) { return; }

    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.ELEMENT_DROPPED,
      `<use href="#${targetId}"> 目标非可展开形状,已跳过。`,
      selector,
      context.strict,
    );

    return;
  }

  convertShapeUse(element, context, targetId, shape);
}

function convertShapeUse (
  element: Element,
  context: UseConversionContext,
  targetId: string,
  shape: IRShape,
): void {
  const { x: useX, y: useY } = readUseTranslate(context.es, element);
  const targetElement = context.idEls.get(targetId);
  const shouldApplyAnimation = hasDirectSMILAnimation(element)
    || (targetElement != null && hasDirectSMILAnimation(targetElement));

  warnUnsupportedAttributes(context.es, element, 'use', context.emit, context.strict, context.idEls);
  appendUseShapeLayer(element, context, {
    targetElement,
    shape,
    useX,
    useY,
    targetMatrix: targetElement == null ? IDENTITY : readElementTransform(targetElement),
    targetOpacity: targetElement == null ? 1 : readSVGOwnOpacity(targetElement),
    shouldApplyAnimation,
    targetStopNode: targetElement == null ? null : targetElement.node?.parentNode as globalThis.Element | null,
    preserveTargetAncestors: false,
    name: String(context.es.getAttr(element, 'id') ?? `use_${targetId}`),
    visible: buildUseLayerVisibility(context, element, targetElement),
  });
}

function convertGroupUse (
  element: Element,
  context: UseConversionContext,
  instances: GroupUseInstance[],
  targetId: string,
): void {
  const { x: useX, y: useY } = readUseTranslate(context.es, element);
  const instanceName = String(context.es.getAttr(element, 'id') ?? `use_${targetId}`);
  const useHasAnimation = hasDirectSMILAnimation(element);

  warnUnsupportedAttributes(context.es, element, 'use', context.emit, context.strict, context.idEls);
  for (const instance of instances) {
    if (instance.kind === 'shape') {
      convertGroupShapeInstance(element, context, instance, instanceName, useX, useY, useHasAnimation);
    } else if (instance.kind === 'text') {
      convertGroupTextInstance(element, context, instance, instanceName, targetId, useX, useY);
    } else {
      convertGroupImageInstance(element, context, instance, instanceName, useX, useY, useHasAnimation);
    }
  }
}

function convertGroupShapeInstance (
  element: Element,
  context: UseConversionContext,
  instance: GroupUseInstance,
  instanceName: string,
  useX: number,
  useY: number,
  useHasAnimation: boolean,
): void {
  if (instance.shape == null) { return; }
  const targetIsDirectShape = instance.source.node === instance.target.node;
  const targetHasAnimation = targetIsDirectShape
    && hasSMILAnimationInChain(instance.target, instance.ancestorStopNode);

  appendUseShapeLayer(element, context, {
    sourceElement: instance.source,
    targetElement: instance.target,
    shape: instance.shape,
    useX,
    useY,
    targetMatrix: instance.matrix,
    targetOpacity: instance.opacity,
    shouldApplyAnimation: targetIsDirectShape && (useHasAnimation || targetHasAnimation),
    targetStopNode: instance.ancestorStopNode,
    preserveTargetAncestors: true,
    name: `${instanceName}_${instance.name}`,
    visible: isVisibleOrAnimated(element, context.es)
      && (instance.visible || hasAnimatedVisibility(instance.target)),
  });
}

function isPureTranslation (matrix: SVGMatrix): boolean {
  return Math.abs(matrix.a - 1) < 1e-9
    && Math.abs(matrix.d - 1) < 1e-9
    && Math.abs(matrix.b) < 1e-9
    && Math.abs(matrix.c) < 1e-9;
}

function applyUseTranslationToText (
  transform: IRTransform | undefined,
  useMatrix: SVGMatrix,
  useOpacity: number,
): void {
  if (transform == null || transform.position == null) { return; }
  if (transform.position.type === 'keyframed') {
    transform.position = {
      type: 'keyframed',
      keyframes: transform.position.keyframes.map(keyframe => ({
        ...keyframe,
        value: [keyframe.value[0] + useMatrix.e, keyframe.value[1] + useMatrix.f, keyframe.value[2]] as IRVec3,
      })),
    };
  } else {
    const position = transform.position.value;

    transform.position = { type: 'static', value: [position[0] + useMatrix.e, position[1] + useMatrix.f, 0] as IRVec3 };
  }
  if (useOpacity !== 1 && transform.opacity != null) {
    if (transform.opacity.type === 'keyframed') {
      transform.opacity = {
        type: 'keyframed',
        keyframes: transform.opacity.keyframes.map(keyframe => ({
          ...keyframe,
          value: keyframe.value * useOpacity,
        })),
      };
    } else {
      transform.opacity = { type: 'static', value: transform.opacity.value * useOpacity };
    }
  }
}

function convertGroupTextInstance (
  element: Element,
  context: UseConversionContext,
  instance: GroupUseInstance,
  instanceName: string,
  targetId: string,
  useX: number,
  useY: number,
): void {
  const parsed = parseTextLayers(context.es, instance.target, context.measureText);

  if (parsed == null) { return; }
  const useMatrix = buildUseMatrix(element, useX, useY);

  if (!isPureTranslation(useMatrix)) {
    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.ELEMENT_DROPPED,
      `<use href="#${targetId}"> 引用 text 带非平移变换,仅展开文字,位置可能偏差。`,
      describeElement(element),
      context.strict,
    );
  }
  appendUseTextLayers(
    element,
    context,
    instance.target,
    parsed,
    useMatrix,
    readSVGElementOpacity(element),
    isVisibleOrAnimated(element, context.es)
    && (instance.visible || hasAnimatedVisibility(instance.target)),
    (index, split) => split
      ? `${instanceName}_${instance.name}__seg${index}`
      : `${instanceName}_${instance.name}`,
  );
}

function convertGroupImageInstance (
  element: Element,
  context: UseConversionContext,
  instance: GroupUseInstance,
  instanceName: string,
  useX: number,
  useY: number,
  useHasAnimation: boolean,
): void {
  const parsed = parseImageLayer(context.es, instance.target, context.imageNaturalSizes, context.resourceBaseUrl);

  if (parsed == null) { return; }
  const targetHasAnimation = hasSMILAnimationInChain(instance.target, instance.ancestorStopNode);

  appendUseImageLayer(element, context, parsed, {
    targetElement: instance.target,
    useX,
    useY,
    targetMatrix: instance.matrix,
    targetOpacity: instance.opacity,
    shouldApplyAnimation: useHasAnimation || targetHasAnimation,
    targetStopNode: instance.ancestorStopNode,
    preserveTargetAncestors: true,
    name: `${instanceName}_${instance.name}`,
    visible: isVisibleOrAnimated(element, context.es)
      && (instance.visible || hasAnimatedVisibility(instance.target)),
  });
}

function tryConvertSymbolUse (element: Element, context: UseConversionContext, targetId: string): boolean {
  const symbolDef = context.idSymbols.get(targetId);
  const symbolShapes = symbolDef == null ? [] : context.symbolShapesById.get(targetId) ?? [];

  if (symbolDef == null || symbolShapes.length === 0) { return false; }
  const { x: useX, y: useY } = readUseTranslate(context.es, element);
  const symbolMatrix = buildSymbolViewportMatrix(context.es, element, symbolDef);
  const instanceName = String(context.es.getAttr(element, 'id') ?? `use_${targetId}`);
  const symbolStopNode = symbolDef.node.parentNode as globalThis.Element | null;
  const useHasAnimation = hasDirectSMILAnimation(element);

  warnUnsupportedAttributes(context.es, element, 'use', context.emit, context.strict, context.idEls);
  for (let symbolIndex = 0; symbolIndex < symbolShapes.length; symbolIndex++) {
    const { element: symbolShapeEl, shape: symbolShape } = symbolShapes[symbolIndex];
    const targetHasAnimation = hasSMILAnimationInChain(symbolShapeEl, symbolStopNode);
    const childName = String(context.es.getAttr(symbolShapeEl, 'id') ?? symbolShapeEl.node.tagName.toLowerCase());

    appendUseShapeLayer(element, context, {
      targetElement: symbolShapeEl,
      shape: symbolShape,
      useX,
      useY,
      targetMatrix: multiply(symbolMatrix, accumulateSymbolChildTransform(symbolShapeEl, symbolDef)),
      targetOpacity: readSymbolChildOpacity(symbolShapeEl, symbolDef),
      shouldApplyAnimation: useHasAnimation || targetHasAnimation,
      targetStopNode: symbolStopNode,
      preserveTargetAncestors: true,
      targetAncestorMatrix: symbolMatrix,
      name: `${instanceName}_${childName}_${symbolIndex}`,
      visible: isVisibleOrAnimated(element, context.es) && isVisibleOrAnimated(symbolShapeEl, context.es),
    });
  }

  return true;
}

function tryConvertTextUse (element: Element, context: UseConversionContext, targetId: string): boolean {
  const textDef = context.idTextEls.get(targetId);

  if (textDef == null) { return false; }
  const useFilterAttr = element.node?.getAttribute('filter') ?? '';
  const hasFilter = useFilterAttr !== '' && useFilterAttr !== 'none';

  if (hasFilter) {
    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.FILTER_DROPPED,
      `元素 <use href="#${targetId}"> 带 filter,GE 无元素级 filter,已丢弃 filter。`,
      describeElement(element),
      context.strict,
    );
    if (context.idTextPureUse.has(targetId)) { return true; }
  }
  const parsed = parseTextLayers(context.es, textDef, context.measureText);

  if (parsed == null) { return true; }
  const { x: useX, y: useY } = readUseTranslate(context.es, element);
  const useMatrix = buildUseMatrix(element, useX, useY);

  if (!isPureTranslation(useMatrix)) {
    collectWarning(
      context.emit,
      SVG2IR_WARNING_CODES.ELEMENT_DROPPED,
      `<use href="#${targetId}"> 引用 text 带非平移变换,仅展开文字,位置可能偏差。`,
      describeElement(element),
      context.strict,
    );
  }
  const baseName = String(context.es.getAttr(element, 'id') ?? `use_${targetId}_text_${context.peekLayerIndex()}`);

  appendUseTextLayers(
    element,
    context,
    textDef,
    parsed,
    useMatrix,
    readSVGElementOpacity(element),
    isVisibleOrAnimated(element, context.es) && isVisibleOrAnimated(textDef, context.es),
    (index, split) => split ? `${baseName}__seg${index}` : baseName,
  );

  return true;
}

function tryConvertImageUse (element: Element, context: UseConversionContext, targetId: string): boolean {
  const imageDef = context.idImages.get(targetId);

  if (imageDef == null) { return false; }
  const parsed = parseImageLayer(context.es, imageDef, context.imageNaturalSizes, context.resourceBaseUrl);

  if (parsed == null) { return true; }
  const { x: useX, y: useY } = readUseTranslate(context.es, element);
  const shouldApplyAnimation = hasDirectSMILAnimation(element) || hasDirectSMILAnimation(imageDef);

  appendUseImageLayer(element, context, parsed, {
    targetElement: imageDef,
    useX,
    useY,
    targetMatrix: readElementTransform(imageDef),
    targetOpacity: readSVGOwnOpacity(imageDef),
    shouldApplyAnimation,
    targetStopNode: imageDef.node?.parentNode as globalThis.Element | null,
    preserveTargetAncestors: false,
    name: String(context.es.getAttr(element, 'id') ?? `use_${targetId}`),
    visible: buildUseLayerVisibility(context, element, imageDef),
  });

  return true;
}

function buildSymbolViewportMatrix (es: UseConversionContext['es'], useEl: Element, symbolEl: Element): SVGMatrix {
  const viewBox = (symbolEl.node.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);

  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    return IDENTITY;
  }
  const width = readSVGNumberAttribute(es, useEl, 'width') ?? viewBox[2];
  const height = readSVGNumberAttribute(es, useEl, 'height') ?? viewBox[3];

  return buildViewBoxMatrix(symbolEl.node, { width, height }) ?? IDENTITY;
}

function accumulateSymbolChildTransform (childEl: Element, symbolEl: Element): SVGMatrix {
  let matrix = IDENTITY;
  let node: globalThis.Element | null = childEl.node;
  const symbolNode = symbolEl.node;

  while (node != null && node !== symbolNode) {
    const transform = readPresentationAttribute(node, 'transform');

    if (transform != null && transform !== '') { matrix = multiply(parseTransform(transform), matrix); }
    node = node.parentNode as globalThis.Element | null;
  }

  return matrix;
}

function readSymbolChildOpacity (childEl: Element, symbolEl: Element): number {
  let opacity = 1;
  let node: globalThis.Element | null = childEl.node;
  const symbolNode = symbolEl.node;

  while (node != null) {
    const raw = readPresentationAttribute(node, 'opacity');

    if (raw != null && raw !== '') {
      const value = Number(raw);

      if (Number.isFinite(value)) { opacity *= Math.max(0, Math.min(1, value)); }
    }
    if (node === symbolNode) { break; }
    node = node.parentNode as globalThis.Element | null;
  }

  return Math.max(0, Math.min(1, opacity));
}

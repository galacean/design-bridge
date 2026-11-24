import { buildElementTreePath } from '../../../parse-svg/build-element-tree-path';
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRAsset, IRFontAsset, IRLayer, IRMask, IRShape, IRTextContent } from '@galacean/animation-ir';
import type { SVG2IRWarning } from '../../../common/types';
import type { SVGPreservedPaintAnimation, SVGPreservedShapeAnimation, SVGPreservedTextData } from '../../../svg-preserved-data';
import { buildClipMask } from '../clip/build-clip-mask';
import { applyClipMask } from '../clip/apply-mask';
import { warnUnsupportedClipMaskFeatures } from '../clip/warn-unsupported';
import { readUseTarget } from '../use/expand-use';
import { parseShapeElement } from '../shape/parse-shape-element';
import { SVG_DECLARATION_CONTEXT_TAGS } from './element-categories';

/** 构造 layer 转换会话所需的输入。 */
export interface SVGLayerBuildOptions {
  layerSourceCollector?: Map<string, string>;
  warningSourceCollector?: Map<SVG2IRWarning, string>;
  frameRate: number;
  durationSeconds: number;
  emit: (warning: SVG2IRWarning) => void;
  strict: boolean;
  width: number;
  height: number;
  textDataByLayerId?: Map<string, SVGPreservedTextData>;
  measureText?: (fontDesc: string, text: string) => { width: number };
  imageNaturalSizes?: Map<string, { width: number; height: number }>;
  resourceBaseUrl?: string;
  smilDurationSink?: { value: number };
  paintAnimationsByLayerId?: Map<string, SVGPreservedPaintAnimation[]>;
  shapeAnimationsByLayerId?: Map<string, SVGPreservedShapeAnimation>;
}

/** 各元素转换器共享的只读环境。 */
export interface SVGConversionEnvironment {
  readonly es: EditableSVG;
  readonly rootEl: Element;
  readonly frameRate: number;
  readonly durationSeconds: number;
  readonly outFrame: number;
  readonly emit: (warning: SVG2IRWarning) => void;
  readonly strict: boolean;
  readonly width: number;
  readonly height: number;
  readonly compCenterX: number;
  readonly compCenterY: number;
  readonly smilDurationSink?: { value: number };
}

/** SVG 文档索引。 */
export interface SVGElementLookup {
  readonly idEls: ReadonlyMap<string, Element>;
  readonly idShapes: ReadonlyMap<string, IRShape>;
  readonly idGroups: ReadonlyMap<string, Element>;
  readonly idSymbols: ReadonlyMap<string, Element>;
  readonly idImages: ReadonlyMap<string, Element>;
  readonly symbolShapesById: ReadonlyMap<string, Array<{ element: Element; shape: IRShape }>>;
  readonly idTextEls: ReadonlyMap<string, Element>;
  readonly idTextPureUse: ReadonlySet<string>;
}

/** 图层转换器可写入的输出接口。 */
export interface LayerOutput {
  allocateLayerIndex: () => number;
  peekLayerIndex: () => number;
  appendLayer: (layer: IRLayer, element: Element, applyElementClip?: boolean) => void;
  appendAsset: (asset: IRAsset) => void;
  registerTextFontAsset: (content: IRTextContent, info: SVGPreservedTextData) => void;
}

/** 单次 SVG 转换的完整状态。 */
export interface SVGConversionSession extends SVGConversionEnvironment, SVGElementLookup, LayerOutput {
  readonly all: Element[];
  readonly clipMasks: ReadonlyMap<string, IRMask>;
  readonly groupMaskGNodeToIndex: Map<globalThis.Element, number>;
  readonly layers: IRLayer[];
  readonly assets: IRAsset[];
  readonly textDataByLayerId?: Map<string, SVGPreservedTextData>;
  readonly measureText?: (fontDesc: string, text: string) => { width: number };
  readonly imageNaturalSizes?: Map<string, { width: number; height: number }>;
  readonly resourceBaseUrl?: string;
  readonly paintAnimationsByLayerId?: Map<string, SVGPreservedPaintAnimation[]>;
  readonly shapeAnimationsByLayerId?: Map<string, SVGPreservedShapeAnimation>;
  readonly isDeclarationContext: (element: Element) => boolean;
  readonly nearestMaskedGroupAncestor: (element: Element) => number | undefined;
  readonly withGroupParent: <T extends IRLayer>(layer: T, element: Element) => T;
  readonly warnReferencedClipMaskFeatures: (element: Element) => void;
}

/** Shape 元素转换所需的上下文。 */
export interface ShapeConversionContext extends SVGConversionEnvironment {
  readonly idEls: ReadonlyMap<string, Element>;
  readonly allocateLayerIndex: () => number;
  readonly appendLayer: (layer: IRLayer, element: Element, applyElementClip?: boolean) => void;
  readonly paintAnimationsByLayerId?: Map<string, SVGPreservedPaintAnimation[]>;
  readonly shapeAnimationsByLayerId?: Map<string, SVGPreservedShapeAnimation>;
}

/** Text 元素转换所需的上下文。 */
export interface TextConversionContext extends SVGConversionEnvironment {
  readonly idEls: ReadonlyMap<string, Element>;
  readonly measureText?: (fontDesc: string, text: string) => { width: number };
  readonly textDataByLayerId?: Map<string, SVGPreservedTextData>;
  readonly allocateLayerIndex: () => number;
  readonly peekLayerIndex: () => number;
  readonly appendLayer: (layer: IRLayer, element: Element, applyElementClip?: boolean) => void;
  readonly registerTextFontAsset: (content: IRTextContent, info: SVGPreservedTextData) => void;
}

/** Image 元素转换所需的上下文。 */
export interface ImageConversionContext extends SVGConversionEnvironment {
  readonly idEls: ReadonlyMap<string, Element>;
  readonly imageNaturalSizes?: ReadonlyMap<string, { width: number; height: number }>;
  readonly resourceBaseUrl?: string;
  readonly allocateLayerIndex: () => number;
  readonly appendLayer: (layer: IRLayer, element: Element, applyElementClip?: boolean) => void;
  readonly appendAsset: (asset: IRAsset) => void;
}

/** Use / symbol 元素转换所需的上下文。 */
export interface UseConversionContext extends SVGConversionEnvironment {
  readonly idEls: ReadonlyMap<string, Element>;
  readonly idShapes: ReadonlyMap<string, IRShape>;
  readonly idGroups: ReadonlyMap<string, Element>;
  readonly idSymbols: ReadonlyMap<string, Element>;
  readonly idImages: ReadonlyMap<string, Element>;
  readonly symbolShapesById: ReadonlyMap<string, Array<{ element: Element; shape: IRShape }>>;
  readonly idTextEls: ReadonlyMap<string, Element>;
  readonly idTextPureUse: ReadonlySet<string>;
  readonly allocateLayerIndex: () => number;
  readonly peekLayerIndex: () => number;
  readonly appendLayer: (layer: IRLayer, element: Element, applyElementClip?: boolean) => void;
  readonly registerTextFontAsset: (content: IRTextContent, info: SVGPreservedTextData) => void;
  readonly textDataByLayerId?: Map<string, SVGPreservedTextData>;
  readonly measureText?: (fontDesc: string, text: string) => { width: number };
  readonly imageNaturalSizes?: ReadonlyMap<string, { width: number; height: number }>;
  readonly resourceBaseUrl?: string;
  readonly appendAsset: (asset: IRAsset) => void;
}

/** Group 元素转换所需的上下文。 */
export interface GroupConversionContext extends SVGConversionEnvironment {
  readonly idEls: ReadonlyMap<string, Element>;
  readonly groupMaskGNodeToIndex: Map<globalThis.Element, number>;
  readonly allocateLayerIndex: () => number;
  readonly appendLayer: (layer: IRLayer, element: Element, applyElementClip?: boolean) => void;
}

function ancestorTagNames (el: Element): string[] {
  const names: string[] = [];
  let node: unknown = (el as unknown as { node?: { parentNode?: unknown } }).node?.parentNode;

  while (node != null) {
    const tag = (node as { tagName?: string }).tagName?.toLowerCase();

    if (tag == null || tag === 'svg') { break; }
    names.push(tag);
    node = (node as { parentNode?: unknown }).parentNode;
  }

  return names;
}

function collectSymbolShapes (
  es: EditableSVG,
  symbolEl: Element,
): Array<{ element: Element; shape: IRShape }> {
  const result: Array<{ element: Element; shape: IRShape }> = [];

  for (const element of symbolEl.find('*')) {
    if (!isRenderableSymbolDescendant(element, symbolEl)) { continue; }
    const tag = element.node?.tagName?.toLowerCase() ?? '';
    const shape = parseShapeElement(es, element, tag);

    if (shape != null) {
      result.push({ element, shape });
    }
  }

  return result;
}

function isRenderableSymbolDescendant (element: Element, symbolEl: Element): boolean {
  let node = element.node.parentNode as globalThis.Element | null;

  while (node != null && node !== symbolEl.node) {
    if (SVG_DECLARATION_CONTEXT_TAGS.has(node.tagName.toLowerCase())) { return false; }
    node = node.parentNode as globalThis.Element | null;
  }

  return node === symbolEl.node;
}

export function createSVGConversionSession (
  es: EditableSVG,
  options: SVGLayerBuildOptions,
): SVGConversionSession {
  const all = es.svg.find('*');
  const rootEl = es.svg;
  const clipMasks = new Map<string, IRMask>();
  const groupMaskGNodeToIndex = new Map<globalThis.Element, number>();
  const idShapes = new Map<string, IRShape>();
  const idGroups = new Map<string, Element>();
  const idSymbols = new Map<string, Element>();
  const idImages = new Map<string, Element>();
  const symbolShapesById = new Map<string, Array<{ element: Element; shape: IRShape }>>();
  const idTextEls = new Map<string, Element>();
  const idTextPureUse = new Set<string>();
  const idEls = new Map<string, Element>();
  const warnedClipMaskDefinitions = new Set<string>();
  const layers: IRLayer[] = [];
  const assets: IRAsset[] = [];
  const registeredAssetIds = new Set<string>();
  const fontAssetIdByDescriptor = new Map<string, string>();
  let nextLayerIndex = 0;

  for (const element of all) {
    const tag = element.node?.tagName?.toLowerCase() ?? '';

    if (tag !== 'clippath' && tag !== 'mask') { continue; }
    const id = String(es.getAttr(element, 'id') ?? '');

    if (id === '') { continue; }
    const mask = buildClipMask(es, element, rootEl, tag === 'mask');

    if (mask != null) { clipMasks.set(id, mask); }
  }

  for (const element of all) {
    const tag = element.node?.tagName?.toLowerCase() ?? '';
    const id = String(es.getAttr(element, 'id') ?? '');

    if (tag === 'use') {
      const href = readUseTarget(es, element);
      const useFilter = element.node?.getAttribute('filter') ?? '';

      if (href != null && (useFilter === '' || useFilter === 'none')) { idTextPureUse.add(href); }
    }

    if (id === '') { continue; }
    idEls.set(id, element);
    const shape = parseShapeElement(es, element, tag);

    if (shape != null) { idShapes.set(id, shape); }
    if (tag === 'g') { idGroups.set(id, element); }
    if (tag === 'symbol') { idSymbols.set(id, element); }
    if (tag === 'image') { idImages.set(id, element); }
    if (tag === 'text') { idTextEls.set(id, element); }
  }

  for (const [id, symbol] of idSymbols) {
    symbolShapesById.set(id, collectSymbolShapes(es, symbol));
  }

  const nearestMaskedGroupAncestor = (element: Element): number | undefined => {
    let node: unknown = element.node?.parentNode;

    while (node != null) {
      const index = groupMaskGNodeToIndex.get(node as globalThis.Element);

      if (index != null) { return index; }
      const tag = (node as { tagName?: string }).tagName?.toLowerCase();

      if (tag == null || tag === 'svg') { break; }
      node = (node as { parentNode?: unknown }).parentNode;
    }

    return undefined;
  };
  const withGroupParent = <T extends IRLayer>(layer: T, element: Element): T => {
    const parentIndex = nearestMaskedGroupAncestor(element);

    if (parentIndex == null) { return layer; }

    return { ...layer, parentId: `${parentIndex}` };
  };
  const appendLayer = (layer: IRLayer, element: Element, applyElementClip = true): void => {
    const clippedLayer = applyElementClip ? applyClipMask(es, element, layer, clipMasks) : layer;

    layers.push(withGroupParent(clippedLayer, element));
    options.layerSourceCollector?.set(layer.id, buildElementTreePath(element.node));
  };
  const appendAsset = (asset: IRAsset): void => {
    if (registeredAssetIds.has(asset.id)) { return; }

    assets.push(asset);
    registeredAssetIds.add(asset.id);
  };
  const registerTextFontAsset = (content: IRTextContent, info: SVGPreservedTextData): void => {
    const descriptor = `${info.fontFamily}\u0000${info.fontWeight}\u0000${info.fontStyle}`;
    let assetId = fontAssetIdByDescriptor.get(descriptor);

    if (assetId == null) {
      assetId = `font:${fontAssetIdByDescriptor.size}`;
      fontAssetIdByDescriptor.set(descriptor, assetId);
      const asset: IRFontAsset = {
        id: assetId,
        type: 'font',
        family: info.fontFamily,
        style: info.fontStyle,
        weight: info.fontWeight,
        source: { kind: 'system' },
      };

      appendAsset(asset);
    }
    content.fontAssetId = assetId;
  };
  const warnReferencedClipMaskFeatures = (element: Element): void => {
    const node = element.node;

    for (const attribute of ['clip-path', 'mask'] as const) {
      const value = node?.getAttribute(attribute)?.trim() ?? '';
      const match = value.match(/^url\(\s*["']?#([^)'"\s]+)\s*["']?\)$/i);

      if (match == null) { continue; }
      const definition = idEls.get(match[1]);
      const definitionTag = definition?.node?.tagName?.toLowerCase();

      if (definition == null || (definitionTag !== 'clippath' && definitionTag !== 'mask')) { continue; }

      const key = `${definitionTag}:${match[1]}`;

      if (warnedClipMaskDefinitions.has(key)) { continue; }
      warnedClipMaskDefinitions.add(key);
      warnUnsupportedClipMaskFeatures(definition, definitionTag, options.emit, options.strict);
    }
  };

  return {
    es,
    all,
    rootEl,
    frameRate: options.frameRate,
    durationSeconds: options.durationSeconds,
    outFrame: options.durationSeconds * options.frameRate,
    emit: options.emit,
    strict: options.strict,
    width: options.width,
    height: options.height,
    compCenterX: options.width / 2,
    compCenterY: options.height / 2,
    textDataByLayerId: options.textDataByLayerId,
    measureText: options.measureText,
    imageNaturalSizes: options.imageNaturalSizes,
    resourceBaseUrl: options.resourceBaseUrl,
    smilDurationSink: options.smilDurationSink,
    paintAnimationsByLayerId: options.paintAnimationsByLayerId,
    shapeAnimationsByLayerId: options.shapeAnimationsByLayerId,
    clipMasks,
    groupMaskGNodeToIndex,
    idShapes,
    idGroups,
    idSymbols,
    idImages,
    symbolShapesById,
    idTextEls,
    idTextPureUse,
    idEls,
    layers,
    assets,
    allocateLayerIndex: () => nextLayerIndex++,
    peekLayerIndex: () => nextLayerIndex,
    appendLayer,
    appendAsset,
    registerTextFontAsset,
    isDeclarationContext: element => ancestorTagNames(element).some(tag => SVG_DECLARATION_CONTEXT_TAGS.has(tag)),
    nearestMaskedGroupAncestor,
    withGroupParent,
    warnReferencedClipMaskFeatures,
  };
}

export function createSVGConversionEnvironment (session: SVGConversionSession): SVGConversionEnvironment {
  return {
    es: session.es,
    rootEl: session.rootEl,
    frameRate: session.frameRate,
    durationSeconds: session.durationSeconds,
    outFrame: session.outFrame,
    emit: session.emit,
    strict: session.strict,
    width: session.width,
    height: session.height,
    compCenterX: session.compCenterX,
    compCenterY: session.compCenterY,
    smilDurationSink: session.smilDurationSink,
  };
}

export function createSVGElementLookup (session: SVGConversionSession): SVGElementLookup {
  return {
    idEls: session.idEls,
    idShapes: session.idShapes,
    idGroups: session.idGroups,
    idSymbols: session.idSymbols,
    idImages: session.idImages,
    symbolShapesById: session.symbolShapesById,
    idTextEls: session.idTextEls,
    idTextPureUse: session.idTextPureUse,
  };
}

export function createLayerOutput (session: SVGConversionSession): LayerOutput {
  return {
    allocateLayerIndex: session.allocateLayerIndex,
    peekLayerIndex: session.peekLayerIndex,
    appendLayer: session.appendLayer,
    appendAsset: session.appendAsset,
    registerTextFontAsset: session.registerTextFontAsset,
  };
}

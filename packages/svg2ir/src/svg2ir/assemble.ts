import type EditableSVG from '../parse-svg/svg-parser';
import {
  ANIMATION_IR_SCHEMA_VERSION, type IRAsset, type IRComposition, type IRLayer, type IRScene,
} from '@galacean/animation-ir';
import { SVGConverterError, SVG_CONVERTER_ERROR_CODES, normalizeToConverterError } from '../common/errors';
import type { ConvertOptions, SVG2IRWarning } from '../common/types';
import type { SVGPreservedPaintAnimation, SVGPreservedShapeAnimation, SVGPreservedTextData } from '../svg-preserved-data';
import { mapSVGColorToIRColor } from './map-color';
import { getSMILDuration } from './converter/smil/scan-duration';
import { buildSVGLayers, type SVGLayerBuildOptions } from './converter/layers/build-layers';
import { createEditableSVG } from '../parse-svg/bridge';

export interface ParseSVGToIROptions extends ConvertOptions {
  layerSourceCollector?: Map<string, string>;
  warningSourceCollector?: Map<SVG2IRWarning, string>;
  textDataCollector?: Map<string, SVGPreservedTextData>;
  paintAnimationsCollector?: Map<string, SVGPreservedPaintAnimation[]>;
  shapeAnimationCollector?: Map<string, SVGPreservedShapeAnimation>;
}

export function parseSVGToIRScene (svgString: string, options?: ParseSVGToIROptions): IRScene {
  const frameRate = options?.frameRate ?? 30;
  const staticDurationSeconds = options?.durationSeconds ?? 5;
  const strict = options?.strict ?? false;
  // 未提供 onWarning 时，warning 不向外转发。
  const emit: (w: SVG2IRWarning) => void = options?.onWarning ?? (() => {});

  if (svgString.trim() === '') {
    throw new SVGConverterError(SVG_CONVERTER_ERROR_CODES.INVALID_SVG, '输入是空 SVG 字符串。');
  }

  let es: EditableSVG;

  try {
    const { svg: maskedInput, animations: maskedTextAnimations } = maskTextSMILChildrenForEditableSVG(svgString);

    es = createEditableSVG(maskedInput, {});
    restoreTextSMILChildren(es, maskedTextAnimations);

    if (!hasSVGRootElement(svgString) || es.svg.node?.tagName?.toLowerCase() !== 'svg') {
      throw new SVGConverterError(SVG_CONVERTER_ERROR_CODES.INVALID_SVG, '输入不是 SVG 文档。');
    }
  } catch (error) {
    throw normalizeToConverterError(
      error,
      SVG_CONVERTER_ERROR_CODES.PARSE_FAIL,
      'SVG 解析底座初始化失败。',
      { stage: 'parse' },
    );
  }

  const viewport = readViewport(es);
  const textDataByLayerId = options?.textDataCollector;
  const paintAnimationsByLayerId = options?.paintAnimationsCollector;
  // 动态 SVG 的有效时长取 SMIL active interval 和显式时长中的较大值；无动画时使用静态时长。
  const scannedSmilDuration = getSMILDuration(es.svg);
  const effectiveDuration = scannedSmilDuration > 0
    ? Math.max(scannedSmilDuration, options?.durationSeconds ?? 0)
    : staticDurationSeconds;
  const smilDurationSink = { value: scannedSmilDuration };
  const layerBuildOptions: SVGLayerBuildOptions = {
    layerSourceCollector: options?.layerSourceCollector,
    warningSourceCollector: options?.warningSourceCollector,
    frameRate,
    durationSeconds: effectiveDuration,
    emit,
    strict,
    width: viewport.width,
    height: viewport.height,
    textDataByLayerId,
    measureText: options?.measureText,
    imageNaturalSizes: options?.imageNaturalSizes,
    resourceBaseUrl: options?.resourceBaseUrl,
    smilDurationSink,
    paintAnimationsByLayerId,
    shapeAnimationsByLayerId: options?.shapeAnimationCollector,
  };
  const { layers, assets } = buildSVGLayers(es, layerBuildOptions);
  const backgroundColor = options?.backgroundColor == null
    ? undefined
    : mapSVGColorToIRColor(options.backgroundColor);

  return buildIRScene({
    name: typeof es.svg.attr('id') === 'string' ? String(es.svg.attr('id')) : 'svg2ir',
    width: viewport.width,
    height: viewport.height,
    frameRate,
    durationSeconds: effectiveDuration,
    backgroundColor,
    layers,
    assets,
  });
}

/** 包装单 composition 为 IRScene(source-neutral 顶层格式)。 */
function buildIRScene (input: {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  backgroundColor?: ReturnType<typeof mapSVGColorToIRColor>;
  layers: IRLayer[];
  assets: IRAsset[];
}): IRScene {
  const composition = buildIRComposition(input);

  return {
    format: 'animation-ir',
    schemaVersion: ANIMATION_IR_SCHEMA_VERSION,
    entryCompositionId: composition.id,
    compositions: [composition],
    assets: input.assets,
  };
}

function hasSVGRootElement (svgString: string): boolean {
  const withoutProlog = svgString
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml\b[\s\S]*?\?>\s*/i, '')
    .replace(/^\s*<!DOCTYPE\b[\s\S]*?>\s*/i, '')
    .replace(/^\s*<!--(?:[\s\S]*?)-->\s*/i, '');

  return /^\s*<svg(?:\s|\/?>)/i.test(withoutProlog);
}

const TEXT_SMIL_PLACEHOLDER_TAG = 'metadata';
const TEXT_SMIL_PLACEHOLDER_ATTRIBUTE = 'data-svg2ir-text-smil-index';

/**
 * svg.js 文本节点不接受原生 SMIL 子节点。解析前用 metadata 占位符替换文本动画，
 * 构造 EditableSVG 后再恢复动画节点。
 */
function maskTextSMILChildrenForEditableSVG (svgString: string): { svg: string; animations: string[] } {
  const animations: string[] = [];
  const svg = svgString.replace(/<text\b[\s\S]*?<\/text\s*>/gi, textBlock => (
    textBlock.replace(
      /<(animateTransform|animateMotion|animate|set)\b[^>]*(?:\/>|>[\s\S]*?<\/\1\s*>)/gi,
      animationXml => {
        const index = animations.push(animationXml) - 1;

        return `<${TEXT_SMIL_PLACEHOLDER_TAG} ${TEXT_SMIL_PLACEHOLDER_ATTRIBUTE}="${index}"/>`;
      },
    )
  ));

  return { svg, animations };
}

function restoreTextSMILChildren (es: EditableSVG, animations: string[]): void {
  const root = (es.svg as unknown as { node?: globalThis.Element }).node;

  if (root == null) { return; }
  const placeholders = Array.from(root.querySelectorAll(`[${TEXT_SMIL_PLACEHOLDER_ATTRIBUTE}]`));

  for (const placeholder of placeholders) {
    const index = Number(placeholder.getAttribute(TEXT_SMIL_PLACEHOLDER_ATTRIBUTE));
    const animationXml = animations[index];

    if (!Number.isInteger(index) || animationXml == null) { continue; }
    const restored = parseSVGAnimationFragment(placeholder.ownerDocument, animationXml);

    if (restored != null) { placeholder.parentNode?.replaceChild(restored, placeholder); }
  }
}

function parseSVGAnimationFragment (document: globalThis.Document, animationXml: string): globalThis.Element | null {
  if (typeof globalThis.DOMParser === 'function') {
    const parsed = new globalThis.DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${animationXml}</svg>`,
      'image/svg+xml',
    );
    const parsedAnimation = parsed.documentElement.firstElementChild;

    if (parsedAnimation == null || parsedAnimation.tagName.toLowerCase() === 'parsererror') { return null; }

    return document.importNode(parsedAnimation, true);
  }

  // 没有 DOMParser 时，使用当前 document 创建 SVG 元素并保留 SMIL 属性名。
  const opening = animationXml.match(/^<([\w:.-]+)\b([^>]*)\/?\s*>/s);

  if (opening == null) { return null; }
  const restored = document.createElementNS('http://www.w3.org/2000/svg', opening[1]);
  const attributes = opening[2];
  const attributePattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(attributes)) != null) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? '';
    const namespace = name.startsWith('xlink:')
      ? 'http://www.w3.org/1999/xlink'
      : name.startsWith('xml:')
        ? 'http://www.w3.org/XML/1998/namespace'
        : null;

    restored.setAttributeNS(namespace, name, value);
  }

  return restored;
}

/** 读取 SVG 固有 viewport，百分比尺寸优先回退到 viewBox。 */
function readViewport (es: EditableSVG): { width: number; height: number } {
  // 百分比尺寸取决于宿主 viewport，并不是具体像素。独立转换时若有 viewBox，
  // 以它的宽高作为 SVG 固有比较/输出尺寸；否则使用默认画布。
  const parseConcreteLength = (value: unknown): number | undefined => {
    const match = String(value ?? '').trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)(?:px)?$/i);
    const parsed = match == null ? NaN : Number(match[1]);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const node = (es.svg as unknown as { node?: globalThis.Element }).node;
  const viewBox = String(node?.getAttribute('viewBox') ?? es.svg.attr('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxWidth = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : undefined;
  const viewBoxHeight = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : undefined;
  const w = parseConcreteLength(es.svg.attr('width')) ?? viewBoxWidth ?? 1080;
  const h = parseConcreteLength(es.svg.attr('height')) ?? viewBoxHeight ?? 1920;

  return { width: w, height: h };
}

/** 构造单个 IR composition。 */
function buildIRComposition (input: {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  backgroundColor?: ReturnType<typeof mapSVGColorToIRColor>;
  layers: IRLayer[];
}): IRComposition {
  return {
    id: input.name,
    name: input.name,
    width: input.width,
    height: input.height,
    frameRate: input.frameRate,
    inPoint: 0,
    outPoint: input.durationSeconds * input.frameRate,
    endBehavior: 'freeze',
    ...(input.backgroundColor != null && { backgroundColor: input.backgroundColor }),
    layers: input.layers,
  };
}

import {
  IRBlendMode, IREndBehavior, type IRColor, type IRLayer,
  type IRLayerMatte, type IRLayerTime, type IRLayerType, type IRLocalBounds,
  type IRMask, type IRPrecompTime,
} from '@galacean/animation-ir';
import type { Text } from '@lottie-animation-community/lottie-types';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type {
  LottieFont, LottieImageAsset, LottiePrecompAsset, LottieVisualLayer,
} from '../common/conversion-types';
import { createLottieDiagnostic } from '../common/conversion-diagnostic';
import { isFiniteNumber, toFiniteNumber } from '../parser/parse-lottie-property';
import { convertLottieMasks } from './convert-lottie-mask';
import { SHAPE_FEATURE_LABELS, convertLottieShapes } from './convert-lottie-shapes';
import { convertLottieTextGlyphs } from './convert-lottie-text-glyphs';
import { convertLottieText } from './convert-lottie-text';
import { convertLottieTransform, hasAnimatedAnchor } from './convert-lottie-transform';

interface CompositionFrameRange {
  inPoint: number;
  outPoint: number;
}

interface ConvertLottieLayerOptions {
  layer: LottieVisualLayer;
  asset?: LottieImageAsset | LottiePrecompAsset;
  id: string;
  parentLayerId?: string;
  matte?: IRLayerMatte;
  compositionRange: CompositionFrameRange;
  precompCompositionId?: string;
  fontAssetIdByName: ReadonlyMap<string, string>;
  fonts: LottieFont[];
  chars?: Text.CharacterData[];
}

interface ConvertLottieLayerResult {
  layer: IRLayer;
  diagnostics: ConversionDiagnostic[];
}

/**
 * Lowers one supported Lottie Layer after its parent, matte, and precomposition references have been resolved.
 *
 * Fidelity limitations are returned with the converted Layer for Scene-level diagnostic assembly.
 */
export function convertLottieLayer(options: ConvertLottieLayerOptions): ConvertLottieLayerResult {
  const { layer, asset, id } = options;
  const layerRecord = layer as unknown as Record<string, unknown>;
  const hasGlyphs = layer.ty === 5 && options.chars != null && options.chars.length > 0;
  const glyphShapes = hasGlyphs
    ? convertLottieTextGlyphs(layer, options.fonts, options.chars ?? [])
    : undefined;
  const type = glyphShapes != null ? 'shape' : mapLottieLayerTypeToIR(layer);
  const diagnostics: ConversionDiagnostic[] = [];

  if (hasGlyphs && glyphShapes == null) {
    diagnostics.push(createLottieDiagnostic({
      code: 'unsupported-text-glyphs',
      message: `Text layer '${layer.nm}' has missing or unsupported glyph outlines; using font-based text instead.`,
      layerInd: layer.ind,
    }));
  }
  const solidLayerColor = type === 'solid' ? convertSolidColor(layer) : undefined;

  const parentLayerId = options.parentLayerId;
  const shapeLayer = layer.ty === 4 ? layer : undefined;
  const shapeConversion = shapeLayer != null ? convertLottieShapes(shapeLayer.shapes) : undefined;
  const textConversion = convertLottieText(layer, options.fontAssetIdByName);
  const maskConversion = convertLayerMask(layer);
  const transform = convertLottieTransform(layer);
  const { time, clippedOut } = buildTimeContext(layer, options.compositionRange);

  if (hasAnimatedAnchor(layer)) {
    diagnostics.push(createLottieDiagnostic({
      code: 'animated-anchor-fallback',
      message:
        `Layer '${layer['nm']}' has an animated anchor, but Animation IR supports only static anchors; ` +
        'conversion continued with the first-frame value.',
      layerInd: layer['ind'],
    }));
  }
  if (maskConversion.unsupportedFeatures.length > 0) {
    diagnostics.push(createLottieDiagnostic({
      code: 'unsupported-mask',
      message:
        `Layer '${layer['nm']}' contains mask features unsupported by Animation IR: ` +
        `${maskConversion.unsupportedFeatures.join(', ')}. The authored mask was ignored and conversion continued.`,
      layerInd: layer['ind'],
      featureKinds: maskConversion.unsupportedFeatures,
    }));
  }
  if (shapeConversion != null && shapeConversion.approximatedFeatures.length > 0) {
    diagnostics.push(createLottieDiagnostic({
      code: 'animated-gradient-fallback',
      message: `Layer '${layer['nm']}' contains an animated gradient; only its first keyframe is preserved.`,
      layerInd: layer['ind'],
      featureKinds: shapeConversion.approximatedFeatures,
    }));
  }
  if (shapeConversion != null && shapeConversion.unsupportedFeatures.length > 0) {
    const featureNames = shapeConversion.unsupportedFeatures.map(type => SHAPE_FEATURE_LABELS[type] ?? type).sort();

    diagnostics.push(createLottieDiagnostic({
      code: 'unsupported-shape-feature',
      message:
        `Layer '${layer['nm']}' contains unsupported shape features: ${featureNames.join(', ')}. ` +
        'Conversion continued with supported geometry and styles.',
      layerInd: layer['ind'],
      featureKinds: shapeConversion.unsupportedFeatures,
    }));
  }
  if (
    shapeConversion != null && shapeLayer != null && shapeLayer.shapes.length > 0 &&
    !shapeConversion.hasRenderableGeometry
  ) {
    diagnostics.push(createLottieDiagnostic({
      code: 'unsupported-shape-type',
      message:
        `Layer '${layer['nm']}' has unsupported shape geometry; ` +
      'supported types are ellipse, rectangle, star, and polygon.',
      layerInd: layer['ind'],
    }));
  }

  // Invalid or disjoint parent bounds make the layer invisible.
  if (clippedOut && transform.opacity != null) {
    transform.opacity = { type: 'static', value: 0 };
  }

  const convertedLayer = {
    id,
    ...(layer.nm != null && { name: layer.nm }),
    type,
    time,
    ...(parentLayerId != null && { parentId: parentLayerId }),
    ...(options.matte != null && { matte: options.matte }),
    visible: layer.hd !== true,
    ...(type === 'image' && asset != null && { content: { assetId: asset.id } }),
    ...(type === 'solid' && solidLayerColor != null && { content: { color: solidLayerColor } }),
    ...(type === 'text' && textConversion != null && { content: textConversion.content }),
    ...(type === 'shape' && { content: { shapes: glyphShapes ?? shapeConversion?.shapes ?? [] } }),
    ...(type === 'precomp' && options.precompCompositionId != null && {
      content: {
        compositionId: options.precompCompositionId,
        clipToBounds: true,
        endBehavior: IREndBehavior.Destroy,
      },
    }),
    transform,
    blendMode: mapLottieBlendMode(layerRecord['bm']),
    ...(maskConversion.masks.length > 0 && { masks: maskConversion.masks }),
  } as IRLayer;

  const localBounds = computeLottieLocalBounds(convertedLayer, layer, asset, textConversion?.localBounds);

  if (localBounds != null) {
    convertedLayer.localBounds = localBounds;
  }

  return { layer: convertedLayer, diagnostics };
}

function computeLottieLocalBounds(
  node: IRLayer,
  sourceLayer: LottieVisualLayer,
  asset: LottieImageAsset | LottiePrecompAsset | undefined,
  textBounds: IRLocalBounds | undefined,
): IRLocalBounds | undefined {
  if (node.type === 'image' || node.type === 'precomp') {
    const sourceRecord = sourceLayer as unknown as Record<string, unknown>;
    const assetRecord = asset as unknown as Record<string, unknown> | undefined;
    const width = toFiniteNumber(sourceRecord['w'] ?? assetRecord?.['w'], 0);
    const height = toFiniteNumber(sourceRecord['h'] ?? assetRecord?.['h'], 0);

    if (width > 0 && height > 0) {
      return { x: 0, y: 0, width, height };
    }
  }

  if (node.type === 'solid') {
    const sourceRecord = sourceLayer as unknown as Record<string, unknown>;
    const width = toFiniteNumber(sourceRecord['sw'], 0);
    const height = toFiniteNumber(sourceRecord['sh'], 0);

    if (width > 0 && height > 0) {
      return { x: 0, y: 0, width, height };
    }
  }

  if (node.type === 'shape') {
    const sourceRecord = sourceLayer as unknown as Record<string, unknown>;
    const width = toFiniteNumber(sourceRecord['w'], 0);
    const height = toFiniteNumber(sourceRecord['h'], 0);

    return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : undefined;
  }

  if (node.type === 'text') {
    return textBounds;
  }

  return undefined;
}

/** Maps Lottie `bm` values; normal mode (`0`) is omitted. */
const LOTTIE_BLEND_MODE_BY_INDEX: Record<number, IRBlendMode> = {
  1: IRBlendMode.Multiply,
  2: IRBlendMode.Screen,
  3: IRBlendMode.Overlay,
  4: IRBlendMode.Darken,
  5: IRBlendMode.Lighten,
  6: IRBlendMode.ColorDodge,
  7: IRBlendMode.ColorBurn,
  8: IRBlendMode.HardLight,
  9: IRBlendMode.SoftLight,
  10: IRBlendMode.Difference,
  11: IRBlendMode.Exclusion,
  12: IRBlendMode.Hue,
  13: IRBlendMode.Saturation,
  14: IRBlendMode.Color,
  15: IRBlendMode.Luminosity,
  16: IRBlendMode.Add,
};

function mapLottieBlendMode(bm: unknown): IRBlendMode | undefined {
  if (!isFiniteNumber(bm)) {
    return undefined;
  }

  return LOTTIE_BLEND_MODE_BY_INDEX[bm];
}

function convertSolidColor(layer: LottieVisualLayer): IRColor | undefined {
  const sc = (layer as unknown as Record<string, unknown>)['sc'];

  if (typeof sc !== 'string' || sc === '') {
    return undefined;
  }

  const hex = sc.replace('#', '');

  if (hex.length < 6) {
    return undefined;
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  if (![r, g, b].every(isFiniteNumber)) {
    return undefined;
  }

  return [r, g, b, 1];
}

/** Analyzes authored masks; precomposition clipping remains in `content.clipToBounds`. */
function convertLayerMask(layer: LottieVisualLayer): { masks: IRMask[]; unsupportedFeatures: string[] } {
  const layerRecord = layer as unknown as Record<string, unknown>;

  if (layerRecord['hasMask'] === true && layerRecord['masksProperties'] != null) {
    return convertLottieMasks(layerRecord['masksProperties']);
  }

  return { masks: [], unsupportedFeatures: [] };
}

function mapLottieLayerTypeToIR(layer: LottieVisualLayer): IRLayerType {
  switch (layer.ty) {
    case 0:
      return 'precomp';
    case 1:
      return 'solid';
    case 2:
      return 'image';
    case 3:
      return 'null';
    case 4:
      return 'shape';
    case 5:
      return 'text';
    default:
      throw new Error('Unsupported Lottie layer type.');
  }
}

/** Clips Layer activation to its parent Composition and maps Precomp `st` and `sr` into source time. */
function buildTimeContext(
  layer: LottieVisualLayer,
  compositionRange: CompositionFrameRange,
): { time: IRLayerTime | IRPrecompTime; clippedOut: boolean } {
  const rawIp = toFiniteNumber(layer.ip, 0);
  const rawOp = toFiniteNumber(layer.op, 0);

  let inFrame = rawIp;
  let outFrame = rawOp;
  const rangeValid = isFiniteNumber(compositionRange.inPoint) && isFiniteNumber(compositionRange.outPoint);
  let clippedOut = !rangeValid;

  if (rangeValid) {
    const clippedStart = Math.max(rawIp, compositionRange.inPoint);
    const clippedEnd = Math.min(rawOp, compositionRange.outPoint);

    if (clippedEnd > clippedStart) {
      inFrame = clippedStart;
      outFrame = clippedEnd;
    } else {
      // Preserve the clipped boundary while marking the layer invisible.
      inFrame = clippedStart;
      outFrame = clippedStart;
      clippedOut = true;
    }
  }

  const sourceRecord = layer as unknown as Record<string, unknown>;
  const rawStretch = sourceRecord['sr'];
  const stretch = typeof rawStretch === 'number' && Number.isFinite(rawStretch) && rawStretch > 0 ? rawStretch : 1;
  const rawStartFrame = sourceRecord['st'];
  const startFrame = typeof rawStartFrame === 'number' && Number.isFinite(rawStartFrame) ? rawStartFrame : 0;
  const sourceStartFrame = (inFrame - startFrame) / stretch;

  return {
    time: {
      inFrame,
      outFrame,
      ...(layer.ty === 0 && { sourceStartFrame }),
      ...(layer.ty === 0 && stretch !== 1 && { stretch }),
    },
    clippedOut,
  };
}

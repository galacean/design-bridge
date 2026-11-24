import {
  type IRColor, type IRFontAsset, type IRLocalBounds, type IRTextContent,
} from '@galacean/animation-ir';
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';
import type { LottieFont, LottieLayer } from '../common/conversion-types';
import { createId } from '../common/id';
import { toFiniteNumber } from '../parser/parse-lottie-property';
import { parseLottieTextDocument } from '../parser/parse-lottie-text-document';

const textWeightType: Readonly<Record<string, number>> = {
  thin: 100,
  hairline: 100,
  ultralight: 200,
  extralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};
const textWeightEntries = Object.entries(textWeightType).sort(([left], [right]) => right.length - left.length);

const textAlignMap = ['left', 'right', 'center', 'left', 'left', 'left', 'left'] as const;

interface LottieTextConversion {
  content: IRTextContent;
  localBounds: IRLocalBounds;
}

interface LottieFontAssetRegistry {
  assets: IRFontAsset[];
  assetIdByFontName: ReadonlyMap<string, string>;
}

/** Builds Font Assets for the Text Layers that participate in conversion. */
export function buildLottieFontAssetRegistry(
  layers: LottieLayer[],
  fonts: LottieFont[],
  resolveResourceUrl: (url: string) => string = resolveIRResourceUrl,
): LottieFontAssetRegistry {
  const assets: IRFontAsset[] = [];
  const assetIdByFontName = new Map<string, string>();

  for (const layer of layers) {
    const textDocument = parseLottieTextDocument(layer);

    if (textDocument == null || typeof textDocument['t'] !== 'string') {
      continue;
    }
    const fontName = typeof textDocument['f'] === 'string' ? textDocument['f'] : '';

    if (assetIdByFontName.has(fontName)) {
      continue;
    }
    const fontInfo = fonts.find(font => font.fName === fontName);
    const family = typeof fontInfo?.fFamily === 'string'
      ? fontInfo.fFamily
      : fontName !== '' ? fontName : 'sans-serif';
    const style = normalizeFontAssetStyle(fontInfo?.fStyle);
    const weight = normalizeFontAssetWeight(fontInfo);
    const rawPath = fontInfo?.fPath;
    const source = typeof rawPath === 'string' && rawPath !== ''
      ? createIRResourceSource(resolveResourceUrl(rawPath))
      : { kind: 'system' as const };
    const assetId = createId();

    assetIdByFontName.set(fontName, assetId);
    assets.push({ id: assetId, type: 'font', family, style, weight, source });
  }

  return { assets, assetIdByFontName };
}

/**
 * Converts the first Lottie Text Document keyframe and returns its IR content and local display bounds.
 *
 * The referenced font is resolved from the Scene-level registry. Non-text Layers and Layers without usable Text
 * Document data return `undefined`.
 */
export function convertLottieText(
  layer: LottieLayer,
  fontAssetIdByName: ReadonlyMap<string, string>,
): LottieTextConversion | undefined {
  const tInfo = parseLottieTextDocument(layer);

  if (tInfo == null || typeof tInfo['t'] !== 'string') {
    return undefined;
  }

  const fontName = tInfo['f'] as string | undefined;
  const fontAssetId = fontAssetIdByName.get(fontName ?? '');

  if (fontAssetId == null) {
    return undefined;
  }

  const rawFontSize = tInfo['s'];
  const fontSize = typeof rawFontSize === 'number' && Number.isFinite(rawFontSize) && rawFontSize > 0
    ? rawFontSize
    : 16;
  const textContent = tInfo['t'].replace(/\r/g, '\n');
  const fc = tInfo['fc'] as number[] | undefined;
  const color: IRColor = fc != null ? [fc[0] ?? 0, fc[1] ?? 0, fc[2] ?? 0, 1] : [0, 0, 0, 1];
  const justify = typeof tInfo['j'] === 'number' ? tInfo['j'] : 0;
  const sz = Array.isArray(tInfo['sz']) ? tInfo['sz'] : undefined;
  const boxPosition = Array.isArray(tInfo['ps']) ? tInfo['ps'] : undefined;

  // Lottie `tr` is measured in 1/1000 em.
  const rawTracking = tInfo['tr'];
  const tracking = typeof rawTracking === 'number' && Number.isFinite(rawTracking) ? rawTracking : 0;
  const letterSpacing = (tracking / 1000) * fontSize;

  // Point text uses a 1.15 em estimate for bold and CJK glyphs.
  const explicitWidth = readPositiveNumber(sz?.[0]);
  const explicitHeight = readPositiveNumber(sz?.[1]);
  const estimatedWidth = explicitWidth != null
    ? explicitWidth
    : fontSize * 1.15 * textContent.length + letterSpacing * Math.max(textContent.length - 1, 0);
  const estimatedHeight = explicitHeight ?? fontSize;
  const hasTextBox = explicitWidth != null && explicitHeight != null;
  const boundsWidth = Math.max(estimatedWidth, 1);
  const boundsHeight = Math.max(estimatedHeight, 1);
  const rawLineHeight = tInfo['lh'];
  const lineHeight = typeof rawLineHeight === 'number' && Number.isFinite(rawLineHeight) && rawLineHeight > 0
    ? rawLineHeight
    : fontSize;

  return {
    content: {
      color,
      text: textContent,
      fontAssetId,
      fontSize,
      letterSpacing,
      lineHeight,
      textAlign: justify >= 0 && justify < 7 ? textAlignMap[justify] : 'left',
    },
    localBounds: {
      // Paragraph text uses its box; point text is baseline-relative.
      x: hasTextBox
        ? toFiniteNumber(boxPosition?.[0], 0)
        : getPointTextBoundsX(justify, boundsWidth),
      y: hasTextBox ? toFiniteNumber(boxPosition?.[1], 0) : -boundsHeight,
      width: boundsWidth,
      height: boundsHeight,
    },
  };
}

function getPointTextBoundsX(justify: number, width: number): number {
  if (justify === 1) {
    return -width;
  }
  if (justify === 2) {
    return -width / 2;
  }

  return 0;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeFontAssetStyle(value: unknown): IRFontAsset['style'] {
  if (typeof value !== 'string') {
    return 'normal';
  }
  const normalized = value.toLowerCase();

  if (normalized.includes('italic')) {
    return 'italic';
  }
  if (normalized.includes('oblique')) {
    return 'oblique';
  }

  return 'normal';
}

function normalizeFontAssetWeight(fontInfo: LottieFont | undefined): number {
  const declaredWeight: unknown = fontInfo?.fWeight;
  const numericWeight = typeof declaredWeight === 'number'
    ? declaredWeight
    : typeof declaredWeight === 'string' && /^\d+$/.test(declaredWeight.trim())
      ? Number(declaredWeight)
      : undefined;

  if (
    numericWeight != null && Number.isInteger(numericWeight) && numericWeight >= 1 && numericWeight <= 1000
  ) {
    return numericWeight;
  }
  const namedWeight = readNamedFontWeight(declaredWeight);

  if (namedWeight != null) {
    return namedWeight;
  }

  return readNamedFontWeight(fontInfo?.fStyle) ?? 400;
}

function readNamedFontWeight(value: unknown): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const compactValue = value.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const [name, weight] of textWeightEntries) {
    if (compactValue.includes(name)) {
      return weight;
    }
  }

  return undefined;
}

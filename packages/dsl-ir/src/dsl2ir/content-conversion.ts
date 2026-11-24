import type { IRAsset, IRFontAsset, IRResourceSource } from '@galacean/animation-ir';
import { createIRResourceSource } from '@galacean/animation-ir/adapter';
import { createId, isValidHexColor, resolveFiniteNumber } from '../common/utils';
import { encodeInlineSVGUrl, readSVGAssetUrl } from '../common/svg-asset-source';
import type { Asset, TextProperties } from '../dsl/schema';

const DEFAULT_FONT_FAMILY = 'sans-serif';

export function normalizeDSLFontFamily(family: string | undefined): string {
  const normalizedFamily = family?.trim();

  return normalizedFamily != null && normalizedFamily !== '' ? normalizedFamily : DEFAULT_FONT_FAMILY;
}

export function resolveTextStyle(text: TextProperties, baseline?: TextProperties): TextProperties {
  const align = text.align;
  const lineHeight = resolveFiniteNumber(text.line_height, 0);

  return {
    content: text.content,
    size: text.size,
    font: typeof text.font === 'string' ? normalizeDSLFontFamily(text.font) : baseline?.font,
    color: isValidHexColor(text.color) ? text.color : baseline?.color ?? '#000000',
    align: align === 'left' || align === 'center' || align === 'right' ? align : baseline?.align,
    line_height: lineHeight > 0 ? lineHeight
      : (text.line_height == null ? undefined : baseline?.line_height) ?? text.size * 1.2,
    letter_spacing: resolveFiniteNumber(text.letter_spacing, baseline?.letter_spacing ?? 0),
  };
}

export function ensureSystemFontAsset(
  assets: IRAsset[],
  family: string,
  style: IRFontAsset['style'],
  weight: number,
): string {
  const normalizedFamily = normalizeDSLFontFamily(family);
  const existingAsset = assets.find(
    (asset): asset is IRFontAsset => asset.type === 'font' && asset.family === normalizedFamily &&
      asset.style === style && asset.weight === weight && asset.source.kind === 'system',
  );

  if (existingAsset != null) {
    return existingAsset.id;
  }
  const assetId = createId();

  assets.push({
    id: assetId,
    type: 'font',
    family: normalizedFamily,
    style,
    weight,
    source: { kind: 'system' },
  });

  return assetId;
}

export function resolveAssetSource(asset: Asset): IRResourceSource {
  if (asset.source === 'user') {
    return createIRResourceSource(asset.url);
  }
  const urlSource = readSVGAssetUrl(asset.url);

  if (urlSource != null) {
    return urlSource;
  }
  const inlineUrl = encodeInlineSVGUrl(asset.svg);

  if (inlineUrl == null) {
    throw new TypeError('[dsl-ir] Generated SVG asset has no usable URL or inline SVG.');
  }

  return createIRResourceSource(inlineUrl);
}

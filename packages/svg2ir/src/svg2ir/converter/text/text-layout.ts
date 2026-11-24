import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRColor } from '@galacean/animation-ir';
import { readSVGElementOpacity, readSVGNumberAttribute, readSVGStringAttribute } from '../../read-attributes';
import { mapSVGColorToIRColor } from '../../map-color';
import { accumulateAncestors, decomposeMatrix, IDENTITY, multiply, parseTransform } from '../../matrix';
import { getGradientMidpointColor } from '../paint/resolve-gradient';
import type { SVGPreservedTextData, SVGPreservedTextSpan } from '../../../svg-preserved-data';

export const TEXT_ANCHOR_MAP: Record<string, 'left' | 'center' | 'right'> = {
  start: 'left',
  middle: 'center',
  end: 'right',
};

export const FONT_STYLE_MAP: Record<string, 'normal' | 'italic' | 'oblique'> = {
  normal: 'normal', italic: 'italic', oblique: 'oblique',
};

export type TextFontWeight = 'normal' | 'bold' | 'lighter';

/** 构造 SVG 文本的保留数据。 */
export function buildSVGPreservedTextData(
  spans: SVGPreservedTextSpan[],
  isPathText: boolean,
  fontFamily: string,
  fontWeight: TextFontWeight,
  fontStyle: SVGPreservedTextData['fontStyle'],
): SVGPreservedTextData {
  const numericWeight = fontWeight === 'bold' ? 700 : fontWeight === 'lighter' ? 300 : 400;

  return {
    spans,
    isPathText,
    fontFamily: fontFamily !== '' ? fontFamily : 'sans-serif',
    fontWeight: numericWeight,
    fontStyle,
  };
}

/** 根据 direction=rtl 调整 text-anchor 的水平对齐。 */
export function resolveEffectiveTextAlign (es: EditableSVG, el: Element, textAlign: 'left' | 'center' | 'right'): 'left' | 'center' | 'right' {
  const isRtl = (readSVGStringAttribute(es, el, 'direction') || '').toLowerCase() === 'rtl';

  if (!isRtl || textAlign === 'center') { return textAlign; }

  return textAlign === 'left' ? 'right' : 'left';
}

/** 合并文本元素及祖先变换，并分解出 IR 支持的缩放和旋转。 */
export function buildTextWorldMatrix (el: Element) {
  const mAnc = accumulateAncestors(el);
  const selfAttr = (el as { node?: { getAttribute?: (n: string) => string | null } }).node?.getAttribute?.('transform') ?? '';
  const mSelf = selfAttr !== '' ? parseTransform(selfAttr) : IDENTITY;
  const m = multiply(mAnc, mSelf);

  return { m, ...decomposeMatrix(m) };
}

/** 解析 text 级 fill 颜色；渐变使用中点色，缺省或 none 使用黑色。 */
export function resolveTextFillColor (es: EditableSVG, fillRaw: string | number | null | undefined, fillOpacity: number): IRColor {
  if (typeof fillRaw === 'string' && /^url\(/i.test(fillRaw)) { return getGradientMidpointColor(es, fillRaw, fillOpacity) ?? ([0, 0, 0, 1] as IRColor); }

  return mapSVGColorToIRColor(typeof fillRaw === 'string' ? fillRaw : fillRaw == null ? null : String(fillRaw), fillOpacity)
    ?? ([0, 0, 0, 1] as IRColor);
}

/** 读取 text 自身和祖先组的 opacity，以及 fill-opacity。 */
export function readTextOpacity (es: EditableSVG, el: Element) {
  const totalOpacity = readSVGElementOpacity(el);
  const fillOpacity = readSVGNumberAttribute(es, el, 'fill-opacity', 1) ?? 1;

  return { totalOpacity, fillOpacity };
}

/** 将 IR 颜色编码为十六进制字符串。 */
export function irColorToHex (c: IRColor): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');

  return `#${h(c[0])}${h(c[1])}${h(c[2])}${h(c[3])}`;
}

/** 读取 letter-spacing，并转换为像素值。 */
export function readLetterSpacing (es: EditableSVG, el: Element, fontSize: number): number {
  const raw = readSVGStringAttribute(es, el, 'letter-spacing').trim().toLowerCase();

  if (raw === '' || raw === 'normal') { return 0; }
  const value = Number.parseFloat(raw);

  if (!Number.isFinite(value)) { return 0; }
  if (raw.endsWith('em')) { return value * fontSize; }
  if (raw.endsWith('%')) { return value * fontSize / 100; }

  return value;
}

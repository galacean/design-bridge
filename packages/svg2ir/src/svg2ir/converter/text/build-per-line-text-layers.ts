/** 将各行具有独立水平锚点的多行文本拆分为多个 IR 文本图层。 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRColor, IRTextContent, IRTextLayer, IRVec3 } from '@galacean/animation-ir';
import { isSVGElementVisible, readSVGNumberAttribute, readSVGStringAttribute } from '../../read-attributes';
import { dominantBaselineDelta, estimateTextWidth, mapFontWeight, resolveFontMetrics, type TextMeasure } from './font-metrics';
import type { TextContentResult } from './inspect-content';
import { getGradientMidpointColor } from '../paint/resolve-gradient';
import { mapSVGColorToIRColor } from '../../map-color';
import type { SVGPreservedTextData, SVGPreservedTextSpan } from '../../../svg-preserved-data';
import { buildSVGPreservedTextData, buildTextWorldMatrix, FONT_STYLE_MAP, irColorToHex, readLetterSpacing, readTextOpacity, resolveEffectiveTextAlign, resolveTextFillColor, TEXT_ANCHOR_MAP } from './text-layout';

export function buildPerLineTextLayers (es: EditableSVG, el: Element, textContent: TextContentResult, measureText?: TextMeasure): {
  layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>>;
  infos: SVGPreservedTextData[];
} | null {
  const { lineTexts, lineXs, lineYs, firstTspanY, firstTspanX, lineHeight: tspanLineH, spans: allSpans, isPathText } = textContent;

  if (lineTexts.length < 2) { return null; }

  const xText = readSVGNumberAttribute(es, el, 'x') ?? null;
  const yText = readSVGNumberAttribute(es, el, 'y') ?? firstTspanY ?? 0;
  const fontSize = readSVGNumberAttribute(es, el, 'font-size', 16) ?? 16;
  const fontFamily = readSVGStringAttribute(es, el, 'font-family');
  const fontWeightRaw = readSVGStringAttribute(es, el, 'font-weight');
  const fontStyleRaw = readSVGStringAttribute(es, el, 'font-style');
  const textAnchor = readSVGStringAttribute(es, el, 'text-anchor');
  const dominantBaselineRaw = readSVGStringAttribute(es, el, 'dominant-baseline');
  // RTL 文本反转 start/end 锚点，middle 保持不变。
  const letterSpacing = readLetterSpacing(es, el, fontSize);
  const fillRaw = es.getAttr(el, 'fill');
  const { totalOpacity, fillOpacity } = readTextOpacity(es, el);
  const visible = isSVGElementVisible(es, el);
  const resolvedFontWeight = mapFontWeight(fontWeightRaw, fontFamily);
  const resolvedFontStyle = FONT_STYLE_MAP[fontStyleRaw] ?? 'normal';
  const textAlign = TEXT_ANCHOR_MAP[textAnchor] ?? 'left';
  const defaultColor: IRColor = resolveTextFillColor(es, fillRaw, fillOpacity);

  const { m, sx, sy, rotation } = buildTextWorldMatrix(el);
  // 行高优先使用相邻 tspan 的 y 差，缺失时回退到字号。
  const lineH = tspanLineH > 0 ? tspanLineH : fontSize;

  // 按换行标记将 span 分组。
  const spansByLine: SVGPreservedTextSpan[][] = [];

  {
    let cur: SVGPreservedTextSpan[] = [];

    for (const sp of allSpans) {
      if (sp.newLine && cur.length > 0) { spansByLine.push(cur); cur = []; }
      cur.push(sp);
    }
    if (cur.length > 0) { spansByLine.push(cur); }
  }

  const layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>> = [];
  const infos: SVGPreservedTextData[] = [];

  for (let i = 0; i < lineTexts.length; i++) {
    const text = lineTexts[i];

    if (text === '') { continue; }
    // 优先使用行内 tspan.x，否则使用 text.x。
    const lineX = lineXs[i] ?? xText ?? firstTspanX ?? 0;
    // 使用每行的基线，保留 SVG 原始行距。
    const lineY = lineYs[i] ?? (yText + i * lineH);
    // 优先使用当前行 tspan 的字号，否则回退到 text 级字号。
    const lineFsRaw = (spansByLine[i] ?? []).find(s => s.fontSize != null)?.fontSize;
    const lineFs = lineFsRaw != null ? (parseFloat(lineFsRaw) || fontSize) : fontSize;
    const w = estimateTextWidth(text, lineFs, letterSpacing, measureText, fontFamily, resolvedFontWeight, resolvedFontStyle);
    const estHeight = lineFs;
    const { asc, desc, xHeight, ...linePrecise } = resolveFontMetrics(measureText, fontFamily, resolvedFontWeight, resolvedFontStyle, lineFs);
    const baselineYGe = asc + (lineFs - asc - desc) / 2;
    // 计算行锚点并补偿末尾 letter-spacing。
    const effAlign = resolveEffectiveTextAlign(es, el, textAlign);
    const cxCenter = effAlign === 'center'
      ? lineX - letterSpacing / 2
      : effAlign === 'right'
        ? lineX - w / 2 - letterSpacing
        : lineX + w / 2;
    const cy = (lineY + dominantBaselineDelta(dominantBaselineRaw, asc, desc, xHeight, linePrecise)) + estHeight / 2 - baselineYGe;
    const wx = m.a * cxCenter + m.c * cy + m.e;
    const wy = m.b * cxCenter + m.d * cy + m.f;

    const lineSpans = spansByLine[i] ?? [];
    const firstSpanColor = lineSpans.find(s => s.color != null)?.color;
    const lineColor: IRColor = (typeof firstSpanColor === 'string' && /^url\(/i.test(firstSpanColor))
      ? (getGradientMidpointColor(es, firstSpanColor, fillOpacity) ?? defaultColor)
      : (typeof firstSpanColor === 'string'
        ? (mapSVGColorToIRColor(firstSpanColor, fillOpacity) ?? defaultColor)
        : defaultColor);

    const segSpan: SVGPreservedTextSpan = { text, newLine: false };

    segSpan.color = irColorToHex(lineColor);
    const lineFontSizeRaw = lineSpans.find(s => s.fontSize != null)?.fontSize;

    if (lineFontSizeRaw != null) { segSpan.fontSize = lineFontSizeRaw; }
    if (lineSpans.some(s => s.bold === true)) { segSpan.bold = true; }
    if (lineSpans.some(s => s.italic === true)) { segSpan.italic = true; }

    const textData: IRTextContent = {
      color: lineColor,
      text: text,
      fontAssetId: fontFamily,
      fontSize: lineFs,
      letterSpacing,
      textAlign: 'left',
      lineHeight: fontSize,
    };

    layers.push({
      type: 'text',
      content: textData,
      localBounds: { x: 0, y: 0, width: w, height: estHeight },
      visible,
      transform: {
        position: { type: 'static', value: [wx, wy, 0] as IRVec3 },
        anchor: { type: 'static', value: [w / 2, estHeight / 2, 0] as IRVec3 },
        scale: { type: 'static', value: [sx, sy, 1] },
        rotation: { z: { type: 'static', value: rotation } },
        opacity: { type: 'static', value: Math.max(0, Math.min(1, totalOpacity)) },
      },
    });
    infos.push(buildSVGPreservedTextData([segSpan], isPathText, fontFamily, resolvedFontWeight, resolvedFontStyle));
  }

  return { layers, infos };
}

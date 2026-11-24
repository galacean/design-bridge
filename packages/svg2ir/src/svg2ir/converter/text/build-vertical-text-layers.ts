/** 将竖排文本按字符拆分为独立 IR 文本图层。 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRColor, IRTextContent, IRTextLayer, IRVec3 } from '@galacean/animation-ir';
import { isSVGElementVisible, readSVGNumberAttribute, readSVGStringAttribute } from '../../read-attributes';
import { estimateTextWidth, mapFontWeight, type TextMeasure } from './font-metrics';
import type { SVGPreservedTextData, SVGPreservedTextSpan } from '../../../svg-preserved-data';
import { buildSVGPreservedTextData, buildTextWorldMatrix, FONT_STYLE_MAP, irColorToHex, readLetterSpacing, readTextOpacity, resolveTextFillColor, TEXT_ANCHOR_MAP } from './text-layout';

export function buildVerticalTextLayers (es: EditableSVG, el: Element, measureText?: TextMeasure): {
  layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>>;
  infos: SVGPreservedTextData[];
} | null {
  // 仅处理 text 的直接文本内容。
  const content = String((el as unknown as { node?: { textContent?: string } }).node?.textContent ?? '').replace(/\s+/g, '');

  if (content === '') { return null; }

  // 按 Unicode 码点拆分，保留 surrogate pair。
  const chars = Array.from(content);
  const n = chars.length;

  if (n === 0) { return null; }

  const x = readSVGNumberAttribute(es, el, 'x') ?? 0;     // 列水平位置(horizontal)
  const y = readSVGNumberAttribute(es, el, 'y') ?? 0;     // inline 起点(text-anchor 决定其是顶/中/底)
  const fontSize = readSVGNumberAttribute(es, el, 'font-size', 16) ?? 16;
  const fontFamily = readSVGStringAttribute(es, el, 'font-family');
  const fontWeightRaw = readSVGStringAttribute(es, el, 'font-weight');
  const fontStyleRaw = readSVGStringAttribute(es, el, 'font-style');
  const textAnchor = readSVGStringAttribute(es, el, 'text-anchor');
  const letterSpacing = readLetterSpacing(es, el, fontSize);
  const fillRaw = es.getAttr(el, 'fill');
  const { totalOpacity, fillOpacity } = readTextOpacity(es, el);
  const visible = isSVGElementVisible(es, el);
  const resolvedFontWeight = mapFontWeight(fontWeightRaw, fontFamily);
  const resolvedFontStyle = FONT_STYLE_MAP[fontStyleRaw] ?? 'normal';
  const textAlign = TEXT_ANCHOR_MAP[textAnchor] ?? 'left';
  // 默认 dominant-baseline 为 central。
  const dominantBaselineRaw = readSVGStringAttribute(es, el, 'dominant-baseline') || 'central';

  void dominantBaselineRaw;

  const defaultColor: IRColor = resolveTextFillColor(es, fillRaw, fillOpacity);

  // 计算每个字符的显示宽度。
  const charWidths = chars.map(ch => estimateTextWidth(ch, fontSize, 0, measureText, fontFamily, resolvedFontWeight, resolvedFontStyle));
  // 计算整列高度。
  const blockHeight = n * fontSize + n * letterSpacing;
  // 根据 text-anchor 计算字符中心位置。
  const charCentersY: number[] = [];

  for (let i = 0; i < n; i++) {
    if (textAlign === 'center') {
      const blockTop = y - blockHeight / 2;

      charCentersY.push(blockTop + i * (fontSize + letterSpacing) + fontSize / 2);
    } else if (textAlign === 'right') {
      charCentersY.push(y - (n - 1 - i) * (fontSize + letterSpacing) - fontSize / 2);
    } else {
      charCentersY.push(y + i * (fontSize + letterSpacing) + fontSize / 2);
    }
  }

  // 对每个字符应用文本元素的世界变换。
  const { m, sx, sy, rotation } = buildTextWorldMatrix(el);

  // 保持 CJK 字形直立。
  const layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>> = [];
  const infos: SVGPreservedTextData[] = [];

  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const w = charWidths[i];
    const estHeight = fontSize;
    const cxLocal = x;
    const cyLocal = charCentersY[i];
    const wx = m.a * cxLocal + m.c * cyLocal + m.e;
    const wy = m.b * cxLocal + m.d * cyLocal + m.f;
    const segColorHex = irColorToHex(defaultColor);
    // 使用字符中心作为 IR 文本图层的位置。
    const segSpan: SVGPreservedTextSpan = { text: ch, newLine: false };

    segSpan.color = segColorHex;

    const textData: IRTextContent = {
      color: defaultColor,
      text: ch,
      fontAssetId: fontFamily,
      fontSize,
      letterSpacing: 0, // 单字无 ls(段间 ls 已进 charCentersY 位置)
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
    infos.push(buildSVGPreservedTextData([segSpan], false, fontFamily, resolvedFontWeight, resolvedFontStyle));
  }

  return { layers, infos };
}

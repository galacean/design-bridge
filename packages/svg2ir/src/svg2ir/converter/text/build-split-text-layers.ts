/** 构造需要独立定位的单行文本图层。 */
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

export function buildSplitTextLayers (es: EditableSVG, el: Element, textContent: TextContentResult, measureText: TextMeasure): {
  layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>>;
  infos: SVGPreservedTextData[];
} | null {
  const { spans, firstTspanX, firstTspanY, isPathText } = textContent;

  if (spans.length === 0) { return null; }

  // 复用 <text> 级属性(同行段共享 fontSize/fontFamily/transform 等)。
  const x = readSVGNumberAttribute(es, el, 'x') ?? firstTspanX ?? 0;
  const y = readSVGNumberAttribute(es, el, 'y') ?? firstTspanY ?? 0;
  const textFontSize = readSVGNumberAttribute(es, el, 'font-size', 16) ?? 16;
  const fontFamily = readSVGStringAttribute(es, el, 'font-family');
  const fontWeightRaw = readSVGStringAttribute(es, el, 'font-weight');
  const fontStyleRaw = readSVGStringAttribute(es, el, 'font-style');
  const textAnchor = readSVGStringAttribute(es, el, 'text-anchor');
  const dominantBaselineRaw = readSVGStringAttribute(es, el, 'dominant-baseline');
  // 处理 RTL 对齐。
  const letterSpacing = readLetterSpacing(es, el, textFontSize);
  const fillRaw = es.getAttr(el, 'fill');
  const { totalOpacity, fillOpacity } = readTextOpacity(es, el);
  const visible = isSVGElementVisible(es, el);
  const resolvedFontStyle = FONT_STYLE_MAP[fontStyleRaw] ?? 'normal';
  const textAlign = TEXT_ANCHOR_MAP[textAnchor] ?? 'left';
  // <text> 级默认色(段未显式 fill 时用)。
  const defaultColor: IRColor = resolveTextFillColor(es, fillRaw, fillOpacity);

  // 逐段:解析该段 fontSize(异字号)、color、宽 w_i(需 measureText)。
  const segs = spans.map(span => {
    const segFontSize = span.fontSize != null ? parseFloat(span.fontSize) : textFontSize;
    const segWeight = mapFontWeight(span.bold === true ? 'bold' : fontWeightRaw, fontFamily);
    const segStyle = span.italic === true ? 'italic' : resolvedFontStyle;
    const segColor: IRColor = (typeof span.color === 'string' && /^url\(/i.test(span.color))
      ? (getGradientMidpointColor(es, span.color, fillOpacity) ?? defaultColor)
      : (typeof span.color === 'string'
        ? (mapSVGColorToIRColor(span.color, fillOpacity) ?? defaultColor)
        : defaultColor);
    const w = estimateTextWidth(span.text, segFontSize, letterSpacing, measureText, fontFamily, segWeight, segStyle);

    return { span, segFontSize, segWeight, segStyle, segColor, w };
  });

  // 按段宽、段间 letter-spacing 和 dx 计算整段文本的布局宽度。
  const totalW = segs.reduce((s, g) => s + g.w, 0);
  const sumDx = segs.reduce((s, g) => s + (g.span.dx ?? 0), 0);
  const segCount = segs.length;
  // effectiveBlockWidth = 段宽和 + 全段 ls(N·ls = 段间 N-1 + 末段 trailing 1)+ 段间 dx 和。
  //   N=1、Σdx=0 时 = w+ls,blockLeft=x-(w+ls)/2,段心=x-ls/2,与 buildSingleTextLayer middle cx 一致(推广到 N 段+dx)。
  const effectiveBlockWidth = totalW + segCount * letterSpacing + sumDx;
  // blockLeft 按 text-anchor:center→x-W/2,right→x-W(右缘=末段 trailing ls 末端=x),left→x(左缘=首字=x)。rtl 同主路径翻 start/end。
  const effAlignB = resolveEffectiveTextAlign(es, el, textAlign);
  const blockLeft = effAlignB === 'center' ? x - effectiveBlockWidth / 2 : effAlignB === 'right' ? x - effectiveBlockWidth : x;
  let leftEdge = blockLeft;
  // 各段 cx_i = leftEdge_i + w_i/2;leftEdge 累加时先加本段 dx(首段 dx 相对 blockLeft)。
  const cxs: number[] = [];

  for (let i = 0; i < segs.length; i++) {
    const dx = segs[i].span.dx ?? 0;

    leftEdge += dx;
    cxs.push(leftEdge + segs[i].w / 2);   // 段中心
    // 非末段补一个 letterSpacing，匹配 SVG 的段间推进。
    leftEdge += segs[i].w + (i < segs.length - 1 ? letterSpacing : 0);
  }

  // 矩阵仿射全段共享(<text> transform),各段独立套 cx_i。
  const { m, sx, sy, rotation } = buildTextWorldMatrix(el);

  // 基线对齐:首段算基准基线 world y,其余段(异字号)反解 cy_i 使首行基线 world y 对齐首段。
  //   同字号:cy 全段共享 y+lh/2-baselineYGe。异字号:cy_i = y + (首段estHeight/2-首段baselineYGe) - (本段estHeight/2-本段baselineYGe)
  //   化简:同字号时两项相等→cy=y+lh/2-baselineYGe(全段同),异字号时各段用自己 asc/desc 补偿。
  const firstSeg = segs[0];
  const firstMetrics = resolveFontMetrics(measureText, fontFamily, firstSeg.segWeight, firstSeg.segStyle, firstSeg.segFontSize);
  const firstLh = firstSeg.segFontSize; // 单行无 line-height → lh=fontSize
  const firstBaselineYGe = firstMetrics.asc + (firstLh - firstMetrics.asc - firstMetrics.desc) / 2;
  // 将首段的 dominant-baseline 偏移应用到整块文本。
  const baselineDelta = dominantBaselineDelta(dominantBaselineRaw, firstMetrics.asc, firstMetrics.desc, firstMetrics.xHeight, firstMetrics);
  const firstCyLocal = (y + baselineDelta) + firstLh / 2 - firstBaselineYGe; // 首段局部 cy(基线 world y 基准)

  const layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>> = [];
  const infos: SVGPreservedTextData[] = [];

  // accDy:SVG tspan dy 累加(每段 dy 相对前段基线再下移 dy),逐段累加进各段 cyLocal。首段 dy 也累加
  //   (整块相对 <text>.y 下移 dy0,与 text-anchor 水平居中无关,纯纵向平移)。
  let accDy = 0;

  for (let i = 0; i < segs.length; i++) {
    const g = segs[i];
    const lh = g.segFontSize; // 单行 lh=fontSize(Effects RichTextLayout 默认)
    const estHeight = lh;
    // cy_i:异字号时按本段 asc/desc 补偿使首行基线 world y 对齐首段;同字号时=firstCyLocal。
    let cyLocal: number;

    if (i === 0) {
      cyLocal = firstCyLocal;
    } else {
      const mt = resolveFontMetrics(measureText, fontFamily, g.segWeight, g.segStyle, g.segFontSize);
      const baselineYGeI = mt.asc + (lh - mt.asc - mt.desc) / 2;

      // 令本段首行基线 world y = 首段:cy_i - estHeight_i/2 + baselineYGe_i = firstCyLocal - firstLh/2 + firstBaselineYGe
      //   → cy_i = firstCyLocal - firstLh/2 + firstBaselineYGe + estHeight_i/2 - baselineYGe_i
      cyLocal = firstCyLocal - firstLh / 2 + firstBaselineYGe + estHeight / 2 - baselineYGeI;
    }
    accDy += g.span.dy ?? 0;
    cyLocal += accDy;   // SVG tspan dy 累加进本段基线(像素级,font 无关)
    const cx = cxs[i];
    const wx = m.a * cx + m.c * cyLocal + m.e;
    const wy = m.b * cx + m.d * cyLocal + m.f;

    // 该段 color 塌 #hex(markup 用)。
    const segColorHex = irColorToHex(g.segColor);
    // 为该段保存对应的文本样式信息。
    const segSpan: SVGPreservedTextSpan = { text: g.span.text, newLine: false };

    if (g.span.fontSize != null) { segSpan.fontSize = g.span.fontSize; }
    segSpan.color = segColorHex;
    if (g.span.bold === true) { segSpan.bold = true; }
    if (g.span.italic === true) { segSpan.italic = true; }

    const textData: IRTextContent = {
      color: g.segColor,
      text: g.span.text,
      fontAssetId: fontFamily,
      fontSize: g.segFontSize,
      letterSpacing,
      textAlign: 'left', // 段在 quad 内左对齐，位置由 position 表示
      lineHeight: g.segFontSize,
    };

    layers.push({
      type: 'text',
      content: textData,
      localBounds: { x: 0, y: 0, width: g.w, height: estHeight },
      visible,
      transform: {
        position: { type: 'static', value: [wx, wy, 0] as IRVec3 },
        anchor: { type: 'static', value: [g.w / 2, estHeight / 2, 0] as IRVec3 },
        scale: { type: 'static', value: [sx, sy, 1] },
        rotation: { z: { type: 'static', value: rotation } },
        opacity: { type: 'static', value: Math.max(0, Math.min(1, totalOpacity)) },
      },
    });
    infos.push(buildSVGPreservedTextData([segSpan], isPathText, fontFamily, g.segWeight, g.segStyle));
  }

  return { layers, infos };
}

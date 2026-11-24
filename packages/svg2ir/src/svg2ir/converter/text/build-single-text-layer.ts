/** 构造普通文本图层。 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRColor, IRLocalBounds, IRTextContent, IRTextLayer, IRVec3 } from '@galacean/animation-ir';
import { isSVGElementVisible, readSVGNumberAttribute, readSVGStringAttribute } from '../../read-attributes';
import { buildCanvasFontDesc, buildSpaceCharTable, dominantBaselineDelta, estimateTextWidth, greedySpaceForDx, mapFontWeight, resolveFontMetrics, type TextMeasure } from './font-metrics';
import type { TextContentResult } from './inspect-content';
import { getGradientMidpointColor } from '../paint/resolve-gradient';
import type { SVGPreservedTextData, SVGPreservedTextSpan } from '../../../svg-preserved-data';
import { buildSVGPreservedTextData, buildTextWorldMatrix, FONT_STYLE_MAP, irColorToHex, readLetterSpacing, readTextOpacity, resolveEffectiveTextAlign, resolveTextFillColor, TEXT_ANCHOR_MAP } from './text-layout';

export function buildSingleTextLayer (es: EditableSVG, el: Element, textContent: TextContentResult, measureText?: TextMeasure): {
  layer: Omit<IRTextLayer, 'id' | 'name' | 'time'> | null;
  info: SVGPreservedTextData | null;
} {
  // content:<text> 直接子文本 + <tspan> 文本,按 tspan y 分行(\n 连接)。spans 平行收集 per-tspan 样式(markup 用)。
  const { content, lineHeight: tspanLineHeight, lineCount, lineTexts, firstTspanX, firstTspanY, spans, isPathText } = textContent;

  if (content === '') { return { layer: null, info: null }; }

  // x 优先级:<text> 的 x → 首个 tspan 的 x → 0。<text> 无 x 时(text-anchor=middle 常见)tspan.x
  // 是该行字形锚点,用它补 cx,否则居中文本靠左(见 readTextContent firstTspanX 注释)。
  const x = readSVGNumberAttribute(es, el, 'x') ?? firstTspanX ?? 0;
  // y 优先级为 <text> 的 y、首个 tspan 的 y、最后回退到 0。
  const y = readSVGNumberAttribute(es, el, 'y') ?? firstTspanY ?? 0;
  const fontSize = readSVGNumberAttribute(es, el, 'font-size', 16) ?? 16;
  const fontFamily = readSVGStringAttribute(es, el, 'font-family');
  const fontWeightRaw = readSVGStringAttribute(es, el, 'font-weight');
  const fontStyleRaw = readSVGStringAttribute(es, el, 'font-style');
  const textAnchor = readSVGStringAttribute(es, el, 'text-anchor');
  const dominantBaselineRaw = readSVGStringAttribute(es, el, 'dominant-baseline');
  const letterSpacing = readLetterSpacing(es, el, fontSize);
  const lineHeight = readSVGNumberAttribute(es, el, 'line-height');
  const fillRaw = es.getAttr(el, 'fill');
  const { totalOpacity, fillOpacity } = readTextOpacity(es, el);
  const visible = isSVGElementVisible(es, el);

  const color = resolveTextFillColor(es, fillRaw, fillOpacity); // fill=none/缺省→黑兜底(文本 color 必填)。

  // per-tspan 渐变 fill 塌中点色 → #hex(与 <text> 级一致;Effects markup <color> 只吃 #hex/命名色,渐变必塌色)。
  for (const span of spans) {
    if (typeof span.color === 'string' && /^url\(/i.test(span.color)) {
      span.color = irColorToHex(getGradientMidpointColor(es, span.color, fillOpacity) ?? ([0, 0, 0, 1] as IRColor));
    }
  }

  // 统一字体样式，保证测量结果与 IR 使用相同的字重和字形。
  const resolvedFontWeight = mapFontWeight(fontWeightRaw, fontFamily);
  const resolvedFontStyle = FONT_STYLE_MAP[fontStyleRaw] ?? 'normal';

  // 富文本无法表达段内 dx；使用字体空格近似段间距离。
  if (measureText != null && fontFamily !== '') {
    const fd = buildCanvasFontDesc(fontSize, fontFamily, resolvedFontWeight, resolvedFontStyle);
    const spaceChars = buildSpaceCharTable(measureText, fd);

    if (spaceChars.length > 0) {
      for (let i = spans.length - 1; i >= 0; i--) {
        const span = spans[i];

        if (span.dx != null && span.dx > 0) {
          // Effects 空格段目标 advance = dx + letterSpacing。
          // SVG tspan boundary 计入一个 letterSpace，而 Effects 段间不计入；因此将该间距并入空格段。
          const target = span.dx + letterSpacing;
          const spaceText = greedySpaceForDx(target, spaceChars);
          const spaceSpan: SVGPreservedTextSpan = { text: spaceText, newLine: false };

          // 复用被偏移段颜色:让空格段与邻段样式有 diff(hasStyleDiff=true),encodeMarkupFromSpans
          //   才会包独立 <color> 段 → Effects 段间 boundary 不加 letterSpace。
          if (typeof span.color === 'string') { spaceSpan.color = span.color; }
          spans.splice(i, 0, spaceSpan);
          delete span.dx;
        }
      }
    }
  }

  // textWidth:多行取最宽行(各 <tspan y> 行),单行即 content 宽。ge-ir 兜底也会估。
  // 调用方注入 measureText 时使用 Canvas 指标；否则使用稳定的启发式估算。
  // dx 产生的空格已经写入 span.text，测量宽度时需要基于更新后的 span 内容重建行文本。
  // 按 newLine 重建文本行，并保留烘焙后的空格。
  let bakedLineTexts: string[];

  {
    const rebuilt: string[] = [];
    let cur = '';

    for (const span of spans) {
      if (span.newLine && cur !== '') { rebuilt.push(cur); cur = ''; }
      cur += span.text;
    }
    rebuilt.push(cur);
    bakedLineTexts = rebuilt.filter(t => t !== '');
    if (bakedLineTexts.length === 0) { bakedLineTexts = lineTexts; }
  }
  const lineWidths = bakedLineTexts.map(t => estimateTextWidth(t, fontSize, letterSpacing, measureText, fontFamily, resolvedFontWeight, resolvedFontStyle));
  const estWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : 0;
  // lineHeight:对齐 Effects RichTextLayout(void 0 ? fontSize : lineHeight)。多行优先从 tspan y 差推(行距),
  //   次 SVG line-height 属性;单行无属性 → Effects 默认 fontSize(svg2ir 不传 lineHeight,Effects 自用 fontSize)。
  //   故内部 lh 用同一值,estHeight=lh×lineCount=Effects strategies autoWidth 的 canvasHeight(总高)。
  const lh = tspanLineHeight > 0
    ? tspanLineHeight
    : (lineHeight != null && lineHeight > 0 ? lineHeight : fontSize);
  // estHeight:多行高 = lh × 行数=Effects canvasHeight(top 对齐下 contentBottom=totalHeight,无垂直溢出扩展)。
  const estHeight = lh * Math.max(lineCount, 1);
  const localBounds: IRLocalBounds = { x: 0, y: 0, width: estWidth, height: estHeight };

  const textData: IRTextContent = {
    color,
    text: content,
    fontAssetId: fontFamily,
    fontSize,
    letterSpacing,
    lineHeight: (lineCount > 1 || lineHeight != null) ? lh : fontSize,
    textAlign: TEXT_ANCHOR_MAP[textAnchor] ?? 'left',
  };

  // position 使用 <text x y> 的基线锚点；text-anchor 决定横向基准。
  const textAlign = TEXT_ANCHOR_MAP[textAnchor] ?? 'left';
  // SVG 的 advance 包含末字 letter-spacing，而 Effects 的视觉字形不包含该 trailing spacing。
  // center/end 因此需要相应的 cx 补偿；字体 fallback 造成的度量差异不在几何补偿范围内。
  // LTR 使用 SVG text-anchor 的直接几何映射。
  // direction=rtl:SVG 浏览器把 start/end 视觉锚关于 x 镜像(start ltr 字铺 x 右→rtl 字铺 x 左;end 同理镜像),
  //   middle 不翻(rtl middle SVG centroid=ltr middle)。Effects Runtime canvas BiDi 对 latin 不翻、内部 offset 由
  //   textAlign 决定(不随 dir),故只需 svg2ir 把 rtl start/end 的 cx 关于 x 镜像。
  // rtl 时 start/end 视觉锚镜像:rtl start 的字铺 x 左(=ltr end 视觉),rtl end 铺 x 右(=ltr start)。
  //   故 rtl start 用 ltr-end cx 公式(x - estW/2 - ls)、rtl end 用 ltr-start 公式(x + estW/2),middle 不变。
  // RTL 需要交换 start/end 的几何含义，不能复用 LTR 的 anchor 方向。
  const effectiveTextAlign = resolveEffectiveTextAlign(es, el, textAlign);
  const cx = effectiveTextAlign === 'center'
    ? x - letterSpacing / 2
    : effectiveTextAlign === 'right'
      ? x - estWidth / 2 - letterSpacing
      : x + estWidth / 2;
  // y 基线 → IR position.cy:全富文本统一按 Effects RichText strategies top 对齐公式反解。
  //  Effects getVerticalOffsets(top):首行基线(canvas)= asc + margin, margin=(lh-asc-desc)/2。
  //  quad(renderer.anchor 中心锚定 cy)屏高=canvasHeight=estHeight,quadTop=cy-estHeight/2。
  //  首行基线屏幕 y = cy - estHeight/2 + asc + margin。令其=SVG 首行基线 y(局部),反解:
  //    cy = y + estHeight/2 - (asc + (lh-asc-desc)/2)
  //  asc/desc 来自富文本 measureText('x')@10px × fontSize/10(对齐 Effects RichWrapDisabledStrategy),
  // 没有测量回调时使用字体指标估算。
  const { asc, desc, xHeight, ...precise } = resolveFontMetrics(measureText, fontFamily, resolvedFontWeight, resolvedFontStyle, fontSize);
  const baselineYGe = asc + (lh - asc - desc) / 2;
  // dominant-baseline 非 alphabetic:把 SVG y 加 delta 让 Effects alphabetic 基线落在所选基线(纯 svg2ir 算式,
  //   复用 asc/desc/xHeight,见 dominantBaselineDelta)。alphabetic/未读 delta=0 不变(0 回退保证)。
  const cy = (y + dominantBaselineDelta(dominantBaselineRaw, asc, desc, xHeight, precise)) + estHeight / 2 - baselineYGe;
  // 叠加 transform:文字自带 transform + 所有祖先 <g> transform 累乘(用 DOM getAttribute 上溯,
  // 绕过解析底座 inherit 的不一致——它对自带 transform 的子元素不 inherit g,且多层 g 只合最内层)。
  // 不读则文字 position 停在 (x,y) 局部 → 全堆左上角。M_祖 × M_自身 应用到中心点。
  const { m, sx, sy, rotation } = buildTextWorldMatrix(el);
  const wx = m.a * cx + m.c * cy + m.e;
  const wy = m.b * cx + m.d * cy + m.f;

  const layer: Omit<IRTextLayer, 'id' | 'name' | 'time'> = {
    type: 'text',
    content: textData,
    localBounds,
    visible,
    transform: {
      position: { type: 'static', value: [wx, wy, 0] as IRVec3 },
      anchor: { type: 'static', value: [estWidth / 2, estHeight / 2, 0] as IRVec3 },
      scale: { type: 'static', value: [sx, sy, 1] },
      rotation: { z: { type: 'static', value: rotation } },
      opacity: { type: 'static', value: Math.max(0, Math.min(1, totalOpacity)) },
    },
  };

  return { layer, info: buildSVGPreservedTextData(spans, isPathText, fontFamily, resolvedFontWeight, resolvedFontStyle) };
}

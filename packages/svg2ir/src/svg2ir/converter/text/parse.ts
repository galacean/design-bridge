/** 选择文本布局并构造 IR 文本图层。 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRTextLayer } from '@galacean/animation-ir';
import type { SVGPreservedTextData } from '../../../svg-preserved-data';
import { readSVGNumberAttribute } from '../../read-attributes';
import { hasNestedTspan, hasNonFirstTspanExplicitX, hasTspanTransformOrRotate, hasWritingMode, isUnsupportedTextOffset, readTextContent } from './inspect-content';
import type { TextMeasure } from './font-metrics';
import { buildSingleTextLayer } from './build-single-text-layer';
import { buildSplitTextLayers } from './build-split-text-layers';
import { buildVerticalTextLayers } from './build-vertical-text-layers';
import { buildPerLineTextLayers } from './build-per-line-text-layers';

export function parseTextLayers (es: EditableSVG, el: Element, measureText?: TextMeasure): {
  layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>>;
  infos: SVGPreservedTextData[];
} | null {
  const textContent = readTextContent(el);
  const { spans, lineCount, isPathText, lineXs } = textContent;

  if (spans.length === 0 && lineCount === 0) { return null; }
  // 单行文本存在可表达的偏移或字号差异时拆分图层。
  const textFs = readSVGNumberAttribute(es, el, 'font-size', 16) ?? 16;
  const hasSplittableDx = spans.some(s => s.dx != null && s.dx !== 0 && !isUnsupportedTextOffset(s.dxRaw ?? ''));
  const hasSplittableDy = spans.some(s => s.dy != null && s.dy !== 0 && !isUnsupportedTextOffset(s.dyRaw ?? ''));
  const hasFontSizeDiff = new Set(spans.map(s => s.fontSize != null ? parseFloat(s.fontSize) : textFs)).size > 1;
  const canSplit = (hasSplittableDx || hasSplittableDy || hasFontSizeDiff) && lineCount <= 1 && measureText != null
    && !isPathText
    && !hasNonFirstTspanExplicitX(el)
    && !hasWritingMode(es, el)
    && !hasTspanTransformOrRotate(el)
    && !hasNestedTspan(el);

  // 多行文本的行首 x 不同时按行拆分。
  const hasPerLineXDiff = lineCount > 1 && lineXs.length >= 2
    && lineXs.slice(1).some(x => x != null && x !== lineXs[0]);
  const canSplitPerLine = hasPerLineXDiff && !isPathText && !hasWritingMode(es, el) && !hasTspanTransformOrRotate(el) && !hasNestedTspan(el);

  // 核心文本组件不支持竖排布局，按字符生成图层。
  if (hasWritingMode(es, el) && !hasTspanTransformOrRotate(el)) {
    const vertical = buildVerticalTextLayers(es, el, measureText);

    if (vertical != null) { return vertical; }
  }

  return canSplit
    ? buildSplitTextLayers(es, el, textContent, measureText)
    : canSplitPerLine
      ? buildPerLineTextLayers(es, el, textContent, measureText)
      : wrapSingle(buildSingleTextLayer(es, el, textContent, measureText));
}

function wrapSingle (r: { layer: Omit<IRTextLayer, 'id' | 'name' | 'time'> | null; info: SVGPreservedTextData | null }): { layers: Array<Omit<IRTextLayer, 'id' | 'name' | 'time'>>; infos: SVGPreservedTextData[] } | null {
  if (r.layer == null || r.info == null) { return null; }

  return { layers: [r.layer], infos: [r.info] };
}

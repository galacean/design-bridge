import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { SVG2IRWarning, SVG2IRWarningCode } from '../../../common/types';
import { SVG2IR_WARNING_CODES } from '../../../common/types';
import { collectWarning, describeElement } from './collect-warnings';

/** 检查图层属性并报告无法写入 IR 的 SVG 特性。 */
export function warnUnsupportedAttributes (es: EditableSVG, el: Element, tag: string, emit: (w: SVG2IRWarning) => void, strict: boolean, idEls: ReadonlyMap<string, Element>, flattenGradientToSolid = false, dashSynthesized = false): void {
  const selector = describeElement(el);

  // 直线开放路径的 dash 已展开；其他情况报告降级。
  if (!dashSynthesized) {
    warnAttr(es, el, tag, 'stroke-dasharray', 'none', SVG2IR_WARNING_CODES.STROKE_DASH_DROPPED, 'stroke-dasharray 虚线描边降级为实线(IR 没有 dash 字段)。', emit, strict, selector);
  }

  // filter 属性:Effects 无逐元素 filter pipeline(仅文本 shadow),丢。
  warnAttr(es, el, tag, 'filter', 'none', SVG2IR_WARNING_CODES.FILTER_DROPPED, 'filter 属性已丢弃:IR 没有元素级 filter 字段(投影/模糊/内阴影,仅文本 shadow),该效果缺失产生预期视觉差异,属 IR 表达边界(标 ir-capability)。', emit, strict, selector);

  // fill/stroke 引用 url(#id):查引用目标是 pattern(平铺,Effects 无→warn丢)还是 gradient(查 fx/fy/spreadMethod/gradientTransform 不支持属性)。
  for (const paintAttr of ['fill', 'stroke']) {
    const url = String(es.getAttr(el, paintAttr) ?? '');
    const um = url.match(/^url\(\s*["']?#([^)"'\s]+)\s*["']?\)$/i);

    if (um == null) { continue; }
    const target = idEls.get(um[1]);

    if (target == null) { continue; }
    const ttag = (target.node != null && target.node.tagName) ? target.node.tagName.toLowerCase() : '';

    if (ttag === 'pattern') {
      collectWarning(emit, SVG2IR_WARNING_CODES.PATTERN_DROPPED, `元素 <${tag}> 的 pattern 平铺填充已丢弃(IR shape 没有 pattern 字段)。`, selector, strict);
    } else if (ttag === 'radialgradient' || ttag === 'lineargradient') {
      // 文本渐变按中点色处理；形状渐变只报告 IR 无法表达的属性。
      if (!flattenGradientToSolid) {
        warnGradAttr(es, target, ttag, 'spreadMethod', tag, emit, strict, selector);
        warnGradAttr(es, target, ttag, 'gradientTransform', tag, emit, strict, selector);
        // radial 焦点 fx/fy:Effects shader 恒以 startPoint 为焦点,无 focal → 非默认焦点钳中心降级。
        if (ttag === 'radialgradient') {
          warnGradAttr(es, target, ttag, 'fx', tag, emit, strict, selector);
          warnGradAttr(es, target, ttag, 'fy', tag, emit, strict, selector);
        }
      }
    }
  }

  // skewX/skewY transform:IR transform 没有 skew 通道,丢 skew 分量。
  const transform = String(es.getAttr(el, 'transform') ?? '');

  if (/skew[xy]\s*\(/i.test(transform)) {
    collectWarning(emit, SVG2IR_WARNING_CODES.SKEW_DROPPED, `元素 <${tag}> 的 skewX/skewY 变换已丢弃(IR transform 没有 skew 通道)。`, selector, strict);
  }

  // shape 在解析阶段补偿 non-scaling-stroke；其他元素没有对应的 IR 语义。
  if (!['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line'].includes(tag)) {
    warnAttr(es, el, tag, 'vector-effect', '', SVG2IR_WARNING_CODES.ELEMENT_DROPPED, 'vector-effect 已丢弃(IR 没有 non-scaling-stroke 字段)。', emit, strict, selector);
  }

  // marker-start/mid/end(箭头):IR 没有 marker 语义字段,丢。
  for (const m of ['marker-start', 'marker-mid', 'marker-end', 'marker']) {
    warnAttr(es, el, tag, m, 'none', SVG2IR_WARNING_CODES.ELEMENT_DROPPED, `${m} 标记已丢弃(IR 没有 marker 语义字段)。`, emit, strict, selector);
  }
}

export function warnGradAttr (es: EditableSVG, gradEl: Element, gradTag: string, attr: string, refTag: string, emit: (w: SVG2IRWarning) => void, strict: boolean, selector: string | undefined): void {
  const v = String(es.getAttr(gradEl, attr) ?? '');

  if (v === '') { return; }
  // fx/fy 默认 = cx/cy,若与默认一致不算不支持(查 cx/cy 比较)。
  if (attr === 'fx' || attr === 'fy') {
    const base = attr === 'fx' ? 'cx' : 'cy';
    const baseV = String(es.getAttr(gradEl, base) ?? '0.5');

    if (v === baseV) { return; } // 焦点=默认中心,不 warn
  }
  collectWarning(emit, SVG2IR_WARNING_CODES.ELEMENT_DROPPED, `元素 <${refTag}> 引用的 <${gradTag}> 的 ${attr} 已丢弃(IR 没有对应字段)。`, selector, strict);
}

export function warnAttr (es: EditableSVG, el: Element, tag: string, attr: string, noneDefault: string, code: SVG2IRWarningCode, msg: string, emit: (w: SVG2IRWarning) => void, strict: boolean, selector: string | undefined): void {
  const v = String(es.getAttr(el, attr) ?? '');

  if (v !== '' && v !== noneDefault && v !== 'none') {
    collectWarning(emit, code, `元素 <${tag}> 的 ${msg}`, selector, strict);
  }
}

export function warnTextPaintDropped (
  es: EditableSVG,
  el: Element,
  selector: string | undefined,
  emit: (w: SVG2IRWarning) => void,
  strict: boolean,
): void {
  const textNode = (el as unknown as { node?: globalThis.Element | null }).node;
  // 文本渐变按中点色处理，并报告能力降级。
  const hasGradientFill = /^url\(/i.test(String(es.getAttr(el, 'fill') ?? ''))
    || (textNode != null && Array.from(textNode.childNodes).some(c => {
      const tt = (c as globalThis.Element).tagName?.toLowerCase?.();

      return tt === 'tspan' && /^url\(/i.test((c as globalThis.Element).getAttribute?.('fill') ?? '');
    }));

  if (hasGradientFill) {
    collectWarning(emit, SVG2IR_WARNING_CODES.TEXT_GRADIENT_FILL_FLATTENED, `元素 <text> 的渐变填充(含 per-tspan)已降级成单色(GE 不支持渐变文字填充,取中点色)。`, selector, strict);
  }

  // RichText 不支持 text stroke 和 text-decoration。
  const hasTextPaintAttr = (attr: string): boolean => {
    const v = String(es.getAttr(el, attr) ?? '');

    if (v !== '' && v !== 'none') { return true; }
    if (textNode == null) { return false; }

    return Array.from(textNode.childNodes).some(c => {
      const tt = (c as globalThis.Element).tagName?.toLowerCase?.();

      if (tt !== 'tspan') { return false; }
      const cv = (c as globalThis.Element).getAttribute?.(attr) ?? '';

      return cv !== '' && cv !== 'none';
    });
  };

  if (hasTextPaintAttr('stroke')) {
    collectWarning(emit, SVG2IR_WARNING_CODES.TEXT_STROKE_DROPPED, `元素 <text> 的 stroke 描边(含 per-tspan)已丢弃(GE 策略富文本 RichTextComponent 无 text stroke/outline 入口,setOutlineWidth unsupported;若带 paint-order 描边/填充顺序亦无法复现)。该效果缺失产生预期视觉差异,属 GE 能力缺失(标 ge-capability)。`, selector, strict);
  }
  if (hasTextPaintAttr('text-decoration')) {
    collectWarning(emit, SVG2IR_WARNING_CODES.TEXT_DECORATION_DROPPED, `元素 <text> 的 text-decoration(underline/line-through/overline,含 per-tspan)已丢弃(GE isUnderline 字段"暂时无效" + 策略富文本 markup 仅 b/i/size/color 无装饰标签)。该效果缺失产生预期视觉差异,属 GE 能力缺失(标 ge-capability)。`, selector, strict);
  }
}

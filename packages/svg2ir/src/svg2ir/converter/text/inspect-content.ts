/**
 * SVG text/tspan 内容读取与偏移、拆段结构判定。
 *
 * 该模块只解释 SVG 文本 DOM，不负责创建 IR layer 或计算 Effects 文本布局。
 * 拆段结构判定结果供文本布局模块使用。
 */
import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { SVGPreservedTextSpan } from '../../../svg-preserved-data';

/** tspan font-weight 属性 → 是否粗体(≥600 或 bold/bolder)。全 svg2ir 唯一 tspan-bold 判定(parse 填 spans.bold 用)。
 *  与 mapFontWeight(<text> 级产 IRFontWeight,含 family 后缀推断)语义不同:这里只判 tspan 显式属性,不 fallback。 */
function isBoldSpanAttr (raw: string): boolean {
  if (raw === '') { return false; }
  const n = Number(raw);

  return Number.isFinite(n) ? n >= 600 : raw === 'bold' || raw === 'bolder';
}

/** SVG tspan dx 属性原串是否为 svg2ir 可处理形态。
 *  - 'unsupported':列表(含空格多值,逐字偏移)/百分比(含 %)/非 px 单位(em/ex/pt 等)。parseFloat 会静默
 *    只取首数或剥离单位当成 px(如 '50%'→50),与 SVG 语义不符 → 走 ge-capability 旁路,不拆不烘焙。
 *  - 'ok':单数值 px(含负值,拆段 leftEdge 累加负值表达段叠,多 comp z-order=文档序与 SVG 一致)。
 *  空串(无 dx)不算 unsupported,调用方先判空。 */
export function isUnsupportedTextOffset (dxRaw: string): boolean {
  const trimmed = dxRaw.trim();

  if (trimmed === '') { return false; }
  // 列表:含空格(多值逐字偏移)。
  if (/\s/.test(trimmed)) { return true; }
  // 百分比 / 非 px 单位(em/ex/pt/pc/in/cm/mm)。SVG dx 对 % 语义不明,parseFloat 会误读。
  if (/%|em|ex|pt|pc|in|cm|mm/i.test(trimmed)) { return true; }

  return false;
}

/** 是否存在非首段 tspan 显式 x(绝对锚点重置,与 leftEdge 累加矛盾→不拆)。首段 x 已由 blockLeft 处理。 */
export function hasNonFirstTspanExplicitX (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  if (node == null) { return false; }
  let i = 0;

  for (const child of Array.from(node.children)) {
    if (child.tagName?.toLowerCase() === 'tspan') {
      i++;
      if (i > 1 && (child.getAttribute('x') ?? '') !== '') { return true; }
    }
  }

  return false;
}

/** 是否竖排(writing-mode=vertical-rl/lr/tb-rl/tb-lr 等)。Effects 富文本无竖排原生布局,需逐字拆层;拆段路径不重复处理。
 *  用 es.getAttr 读取以保留解析底座的继承语义,不切换到 raw getAttribute(会丢继承值)。 */
export function hasWritingMode (es: EditableSVG, el: Element): boolean {
  const wm = String(es.getAttr(el, 'writing-mode') ?? '').toLowerCase();

  return wm.startsWith('vertical') || wm === 'tb-rl' || wm === 'tb-lr';
}

/** 是否有直接子 tspan 带 transform 或 rotate 属性(markup 无旋转/矩阵,拆段各 comp 用 <text> 矩阵会丢→不拆)。 */
export function hasTspanTransformOrRotate (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  if (node == null) { return false; }

  for (const child of Array.from(node.children)) {
    if (child.tagName?.toLowerCase() !== 'tspan') { continue; }
    if ((child.getAttribute('transform') ?? '') !== '') { return true; }
    if ((child.getAttribute('rotate') ?? '') !== '') { return true; }
  }

  return false;
}

/** 是否存在嵌套 tspan(tspan 含元素子节点)。readTextContent 不递归,嵌套文字会错并进父段→不拆。 */
export function hasNestedTspan (el: Element): boolean {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  if (node == null) { return false; }

  for (const child of Array.from(node.children)) {
    if (child.tagName?.toLowerCase() !== 'tspan') { continue; }
    for (const gc of Array.from(child.children)) {
      if (gc.tagName?.toLowerCase() === 'tspan') { return true; }
    }
  }

  return false;
}

/** 读 <text> 直接子文本 + 子 <tspan>。单 <text> 多 <tspan y=不同> 是 SVG 多行:
 *  按 tspan 的 y(绝对,相对 <text>)分行,\n 连接给 Effects TextComponent 多行渲染(lineCount/lineHeight)。
 *  无 y 的 tspan 连排(同行)。返回 {content(\n 连接),lineHeight(首两行 y 差,0=单行),lineCount,lineTexts}。
 *  per-span 样式需要富文本表达；无法表达的样式差异由 warning 报告。
 */
export interface TextContentResult { content: string; lineHeight: number; lineCount: number; lineTexts: string[]; firstTspanX: number | null; firstTspanY: number | null; spans: SVGPreservedTextSpan[]; isPathText: boolean; lineXs: Array<number | null>; lineYs: number[] }

export function readTextContent (el: Element): TextContentResult {
  const node = (el as unknown as { node?: globalThis.Element }).node;

  if (node == null) { return { content: '', lineHeight: 0, lineCount: 0, lineTexts: [], firstTspanX: null, firstTspanY: null, spans: [], isPathText: false, lineXs: [], lineYs: [] }; }
  let firstTspanX: number | null = null;
  let firstTspanY: number | null = null;
  // lines 带 x:每行首个 tspan.x(该行水平锚点,text-anchor=middle 时各行 x 不同→需按行拆多 comp)。
  //   null=该行无显式 x(继承 <text>.x 或 firstTspanX 兜底)。Effects RichText 单 comp multiline 共用 quad,
  //   各行 x 不同时无法单 comp 表达,buildSingleTextLayer 据行 x 差异拆行。
  const parentYRaw = node.getAttribute?.('y') ?? '';
  const parsedParentY = parentYRaw !== '' ? parseFloat(parentYRaw) : 0;
  const parentY = Number.isFinite(parsedParentY) ? parsedParentY : 0;
  let currentY = parentY;
  const lines: Array<{ y: number | null; positionY: number; text: string; x: number | null }> = [];
  const spans: SVGPreservedTextSpan[] = [];
  let isPathText = false;

  for (const child of Array.from(node.childNodes)) {
    const tag = (child as globalThis.Element).tagName?.toLowerCase?.();
    // tspan 文本:折叠空白,但保留尾空格(同行多段时空格是段间间隔的一部分);仅去前导。
    //   直接文本节点(textContent)仍两端 trim(标签间空白无意义)。缩进式 tspan(含换行)按两端 trim。
    const rawText = (child.textContent ?? '').replace(/\s+/g, ' ');
    const isTspanInline = tag === 'tspan' && !(child.textContent ?? '').includes('\n');
    const text = isTspanInline ? rawText.replace(/^\s+/, '') : rawText.trim();

    if (tag === 'textpath') {
      isPathText = true;
    } else if (tag === 'tspan') {
      const domEl = child as globalThis.Element;
      const yRaw = domEl.getAttribute?.('y') ?? '';
      const parsedY = yRaw !== '' ? parseFloat(yRaw) : NaN;
      const y = Number.isFinite(parsedY) ? parsedY : null; // y 绝对(相对 <text>);无 y=连排当前行
      // 首个有 x/y 的 tspan.x/y(tspan x 是该行绝对锚点;text-anchor=middle 时 <text> 常无 x,字形中心靠 tspan.x 补)。
      const xRaw = domEl.getAttribute?.('x') ?? '';
      const parsedX = xRaw !== '' ? parseFloat(xRaw) : NaN;
      // 同行相邻 tspan 的横向额外偏移(dx):Effects RichText markup 无 per-span 位置,拆段路径(dx!=0)
      // 直进 leftEdge 累加(像素级),单 comp 路径烘焙成前导空格。保留 dx 原串检测不支持形态。
      const dxRaw = domEl.getAttribute?.('dx') ?? '';
      const parsedDx = dxRaw !== '' ? parseFloat(dxRaw) : 0;
      const dx = Number.isFinite(parsedDx) ? parsedDx : 0;
      const supportedDx = dxRaw === '' || !isUnsupportedTextOffset(dxRaw);
      const lineX = Number.isFinite(parsedX) ? parsedX + (supportedDx ? dx : 0) : null;

      if (firstTspanX === null && lineX != null) { firstTspanX = lineX; }
      if (firstTspanY === null && y != null) { firstTspanY = y; }
      // 纵向偏移(dy):SVG 累加语义(每段 dy 相对前段基线再下移)。Effects markup 无 per-span 纵向位置,
      //   拆段路径(dy!=0 触发)把累加 dy 进各段 cy。dyRaw 原串同 dx 检测不支持形态(列表/百分比/非px)。
      const dyRaw = domEl.getAttribute?.('dy') ?? '';
      const parsedDy = dyRaw !== '' ? parseFloat(dyRaw) : 0;
      const dy = Number.isFinite(parsedDy) ? parsedDy : 0;
      const supportedDy = dyRaw === '' || !isUnsupportedTextOffset(dyRaw);

      if (y != null) { currentY = y; }
      if (supportedDy) { currentY += dy; }
      const last = lines.length > 0 ? lines[lines.length - 1] : null;
      let newLine = false;

      // 相同 y 的连续 tspan 属于同一行；仅 y 发生变化时创建新行。
      if (y != null && (last == null || last.y !== y)) {
        lines.push({ y, positionY: currentY, text, x: lineX });
        newLine = last != null;   // 非首行标记。
      } else if (last != null) {
        last.text += text;
        // 同行追加段:若该行尚无 x 而本 tspan 有 x,补记(同行首段无 x 次段有 x 的边角)。
        if (last.x == null && lineX != null) { last.x = lineX; }
      } else {
        lines.push({ y: 0, positionY: currentY, text, x: lineX });
      }

  // 合并文本行时保留 per-tspan 样式 metadata。
      if (text !== '') {
        const fontSizeRaw = domEl.getAttribute?.('font-size') ?? '';
        const fillRaw = domEl.getAttribute?.('fill');
        const fontWeightRaw = domEl.getAttribute?.('font-weight') ?? '';
        const fontStyleRaw = (domEl.getAttribute?.('font-style') ?? '').toLowerCase();

        spans.push({
          text,
          newLine,
          // dx!=0(含负)保留供拆段;leftEdge 累加用。dxRaw 原串供 classifyDx 检测不支持形态。
          ...(dx !== 0 ? { dx, dxRaw } : {}),
          // dy!=0(含负)保留供拆段;cy 累加用。dyRaw 原串同 dx 检测不支持形态。
          ...(dy !== 0 ? { dy, dyRaw } : {}),
          ...(fontSizeRaw !== '' ? { fontSize: fontSizeRaw } : {}),
          ...(fillRaw != null && fillRaw !== '' ? { color: fillRaw } : {}),
          ...(isBoldSpanAttr(fontWeightRaw) ? { bold: true } : {}),
          ...(fontStyleRaw === 'italic' || fontStyleRaw === 'oblique' ? { italic: true } : {}),
        });
      }
    } else if (child.nodeType === 3 && text !== '') {
      // text 直接子节点(tspan 前/间):无 y,连排到当前行
      if (lines.length > 0) { lines[lines.length - 1].text += text; } else { lines.push({ y: 0, positionY: currentY, text, x: null }); }
      spans.push({ text, newLine: false });
    }
  }

  if (lines.length === 0) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();

    if (text) { lines.push({ y: 0, positionY: currentY, text, x: null }); }
  }

  const lineTexts = lines.map(l => l.text).filter(t => t !== '');
  // lineXs 对齐 lineTexts:只留非空行的 x(与 lineTexts 同序),供 buildSingleTextLayer 判 per-line x 差异。
  const lineXs = lines.filter(l => l.text !== '').map(l => l.x);
  const lineYs = lines.filter(l => l.text !== '').map(l => l.positionY);
  const content = lineTexts.join('\n');
  const lineCount = lineTexts.length;
  // lineHeight:首两行 y 差(绝对行距)。y 为 null 的连排行已并到首行,不影响。
  let lineH = 0;

  if (lineYs.length >= 2) {
    lineH = lineYs[1] - lineYs[0];
  }

  return { content, lineHeight: lineH, lineCount, lineTexts, firstTspanX, firstTspanY, spans, isPathText, lineXs, lineYs };
}

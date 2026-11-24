/**
 * 只读 SVG 解析器。svg2ir 用它把 SVG 字符串解析成可查询/可读属性的 svg.js 文档树,
 * 再在其上做 SVG→IR 转换;不涉及任何 SVG 编辑/约束/布局能力。
 *
 * 提供的能力(对齐 svg2ir 实际消费的读切片):
 *   - 构造:SVG 字符串 → svg.js 文档树;对每个 <text> 规整 dx/dy→x/y、补 fill 兜底
 *   - getAttr:带 SVG 继承的属性读取(沿父 <g> 上溯,id/svg 根终止,font-size 数值化)
 *   - stringify:序列化回 SVG 字符串(清临时属性 + 去 svg.js 内部标记)
 *   - find/findOne/attr/node:透出 svg.js 原生查询与根节点
 *
 * 底层复用 @svgdotjs/svg.js。本模块只封装 svg2ir 依赖的读语义,不含处理容错的全部角落。
 */
import { SVG, type Svg as SVGDocument, type Element as SVGElementNode } from '@svgdotjs/svg.js';
import { readInlineStyleProperty } from './read-presentation-attribute';

export type { Svg as SVGDocument, Element as SVGElementNode } from '@svgdotjs/svg.js';

interface ParseableSVGOptions {
  /** SVG 解析器构造选项。 */
  [key: string]: unknown;
}

/**
 * 只读 SVG 解析器。读切片语义:
 *   - 构造时对每个 <text> 规整:text 级 dx/dy 烘焙进 x/y(清掉 dx/dy);无 fill 时沿父继承/从首个 tspan 提/兜底 #000。
 *   - getAttr 沿父链继承上溯(SVG CSS 式),id 与已到 svg 根终止,font-size 含 px 时数值化。
 *   - stringify 用 svg.js 序列化,清临时属性 + 去 svgjs:data。
 */
export default class ParseableSVG {
  readonly svg: SVGDocument;

  constructor (svgStr: string, _options: ParseableSVGOptions = {}) {
    // svg.js parses a fragment; remove only the prolog and let the DOM handle nested markup.
    const content = svgStr.replace(/^\uFEFF/, '')
      .replace(/^(?:\s|<\?xml\b[\s\S]*?\?>|<!DOCTYPE\b[^>]*>|<!--[\s\S]*?-->)+/i, '');

    // svg.js SVG(string) 的 d.ts 标为 Element,但对完整 <svg> 文档运行时返回根 SVG 文档实例。
    // svg.js 对非 SVG 字符串(如 'not svg')解析返 null。兜底空 svg:让 svg2ir 上层
    // hasSVGRootElement 检查(非 svg 抛 INVALID_SVG)生效,而非在构造期抛错。
    this.svg = (SVG(content) ?? SVG('<svg xmlns="http://www.w3.org/2000/svg"/>')) as unknown as SVGDocument;
    this.initTexts();
  }

  /**
   * 读属性,带 SVG 继承。元素自身无值时沿 parent() 上溯;id 与已到 svg 根终止返回 null;
   * font-size 含 px 时数值化为 number。propagation=false 时不上溯。
   */
  getAttr (element: SVGElementNode, attributeName: string, propagation = true): string | number | null {
    const node = (element as unknown as { node?: globalThis.Element | null }).node;
    const inlineAttr = readInlineStyleProperty(node?.getAttribute('style') ?? null, attributeName);
    const attr = inlineAttr ?? (element.attr() as Record<string, unknown>)[attributeName];

    if (typeof attr === 'string' && attr !== '') {
      const resolvedAttr = resolveCurrentColor(this, element, attributeName, attr);

      if (attributeName === 'font-size') {
        const num = parseFloat(resolvedAttr.replace('px', ''));

        if (!Number.isNaN(num)) {
          return num;
        }
      }

      return resolvedAttr;
    }

    if (typeof attr === 'number') {
      return attr;
    }
    if (attributeName === 'id') {
      return null;
    }
    if (element.type === 'svg') {
      return null;
    }

    if (!propagation) {
      return null;
    }
    const parent = element.parent();

    if (parent != null) {
      return this.getAttr(parent as SVGElementNode, attributeName);
    }

    return null;
  }

  /**
   * 构造时对每个 <text> 规整属性。
   *   - text 级 dx/dy 烘焙进 x/y，并移除 dx/dy
   *   - text 自身无 fill 时沿父继承/从首个 tspan 提/兜底 #000
   * svg2ir 解析依赖这段规整,故无条件执行。
   */
  private initTexts (): void {
    const normalizeTextAttrs = (text: SVGElementNode): void => {
      const x = this.getNumAttr(text, 'x') ?? 0;
      const dx = this.getNumAttr(text, 'dx') ?? 0;
      const y = this.getNumAttr(text, 'y') ?? 0;
      const dy = this.getNumAttr(text, 'dy') ?? 0;

      if (x !== 0 || dx !== 0) {
        text.attr({ x: x + dx, dx: null });
      }
      if (y !== 0 || dy !== 0) {
        text.attr({ y: y + dy, dy: null });
      }
      const fill = this.getAttr(text, 'fill');

      if (!(text.node as Element).hasAttribute('fill')) {
        if (fill != null && fill !== '' && fill !== 'none') {
          text.attr('fill', fill);
        } else {
          const tspanList = text.find('tspan') ?? [];

          if (tspanList.every(tspan => (tspan.node as Element).hasAttribute('fill'))) {
            const firstTspan = tspanList[0];

            if (firstTspan != null) {
              text.attr('fill', this.getAttr(firstTspan, 'fill'));
            }
          } else {
            text.attr('fill', '#000');
          }
        }
      }
    };

    try {
      const textList = this.svg.find('text') ?? [];

      for (const text of textList) {
        normalizeTextAttrs(text);
      }
    } catch {
      // 文本属性规整失败时保留原文档。
    }
  }

  /** 读数值属性(string 去 px 转 number,非数/空返 0)。 */
  private getNumAttr (element: SVGElementNode, attrName: string): number {
    const value = element.attr(attrName) as unknown;

    if (typeof value === 'string') {
      const num = Number(value.replace('px', ''));

      if (Number.isNaN(num)) {
        return 0;
      }

      return num;
    }

    return (value as number) || 0;
  }

  /** 序列化回 SVG 字符串:清 data-tmp- 临时属性 + 去 svg.js 内部 svgjs:data 标记。 */
  stringify (): string {
    this.svg.attr('xml:space', 'default');
    const svgStr = this.svg.svg((el: SVGElementNode) => {
      const attrs = el.attr() as Record<string, unknown>;

      for (const key in attrs) {
        if (key.startsWith('data-tmp-')) {
          el.attr(key, null);
        }
      }
    });

    return svgStr.replace(/svgjs:data=".*?"/g, '');
  }
}

/** SVG parser 的包内类型别名，运行时与类型均指向 ParseableSVG。 */
export { ParseableSVG as EditableSVG };

function resolveCurrentColor (
  parser: ParseableSVG,
  element: SVGElementNode,
  attributeName: string,
  value: string,
): string {
  if (value.trim().toLowerCase() !== 'currentcolor') { return value; }
  if (attributeName === 'color') { return 'black'; }
  const color = parser.getAttr(element, 'color');

  return typeof color === 'string' && color.trim() !== '' ? color : 'black';
}

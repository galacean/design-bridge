/**
 * 验证 SVG 解析底座在当前 Vitest Node 环境中可解析 SVG DOM,且 svg2ir 依赖的读切片语义被锁定。
 *
 * 该测试确保 Node 入口和基础元素查询能力可用;getAttr 继承与数值化、initTexts 的 text 级
 * dx/dy→x/y 烘焙是 svg2ir 实际依赖的语义,锁定它们防解析底座偏差。
 */
import { describe, expect, it } from 'vitest';
import EditableSVG from '../../src/parse-svg/node';

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect x="10" y="10" width="100" height="50" fill="#ff0000"/>
  <circle cx="150" cy="60" r="30" fill="#00ff00"/>
  <text x="20" y="100" font-size="14" fill="#000000">hi</text>
</svg>`;

describe('svg 解析底座(Node 环境)', () => {
  it('能构造 EditableSVG 实例(空 options)', () => {
    const es = new EditableSVG(SAMPLE_SVG, {});

    expect(es).toBeDefined();
    expect(es.svg).toBeDefined();
  });

  it('能按 SVG 标签查元素(find rect/circle/text)', () => {
    const es = new EditableSVG(SAMPLE_SVG, {});

    expect(es.svg.find('rect')).toHaveLength(1);
    expect(es.svg.find('circle')).toHaveLength(1);
    expect(es.svg.find('text')).toHaveLength(1);
  });

  it('getAttr 能读元素属性(fill/x/y,数值属性返 number)', () => {
    const es = new EditableSVG(SAMPLE_SVG, {});
    const rect = es.svg.find('rect')[0];

    expect(es.getAttr(rect, 'fill')).toBe('#ff0000');
    // svg.js 对数值属性做了数值化(getAttr 经 element.attr() 返 number)。
    expect(es.getAttr(rect, 'x')).toBe(10);
    expect(es.getAttr(rect, 'width')).toBe(100);
  });

  it('initTexts 把 <text> 的 dx/dy 烘焙进 x/y(清掉 dx/dy)', () => {
    const es = new EditableSVG(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="5" y="20" dx="10" dy="3">a</text></svg>',
      {},
    );
    const text = es.svg.find('text')[0];

    // dx=10 烘进 x=15、dy=3 烘进 y=23,且 dx/dy 被清(normalizeTextAttrs 同语义)。
    expect(es.getAttr(text, 'x')).toBe(15);
    expect(es.getAttr(text, 'y')).toBe(23);
    expect((text.node as Element).hasAttribute('dx')).toBe(false);
    expect((text.node as Element).hasAttribute('dy')).toBe(false);
  });
});
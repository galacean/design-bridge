import { describe, expect, it } from 'vitest';
import {
  buildCanvasFontDesc, buildSpaceCharTable, estimateTextWidth,
} from '../../../src/svg2ir/converter/text/font-metrics';

const measureText = (_font: string, text: string) => ({ width: text === ' ' ? 3 : 1 });

describe('SVG font metrics', () => {
  it.each([
    ['主标题最多12个字符', 70, 0, 637],
    ['副标题最多不超过14个字', 44, 0, 488.4],
    ['行动按钮', 42, 2.471, 175.413],
  ])('estimates Chinese and digit advances for %s', (text, size, spacing, width) => {
    expect(estimateTextWidth(text, size, spacing, undefined, 'Arial', 'normal', 'normal')).toBeCloseTo(width);
  });

  it('counts Unicode code points when applying character spacing', () => {
    expect(estimateTextWidth('😀A', 20, 2, () => ({ width: 30 }), 'Arial', 'normal', 'normal')).toBe(32);
  });

  it('retains deduplicated space widths in descending order', () => {
    expect(buildSpaceCharTable(measureText, '10px Arial')).toEqual([{ ch: ' ', w: 3 }, { ch: ' ', w: 1 }]);
  });

  it.each(['Some Font', "'Some Font'", '"Some Font"'])('uses the font family name in CSS descriptors (%s)', family => {
    expect(buildCanvasFontDesc(20, family, 'bold', 'italic')).toBe('italic bold 20px "Some Font"');
  });
});

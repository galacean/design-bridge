import { describe, expect, it } from 'vitest';
import { buildTextRunLayout } from '../../../../../src/adapter/svg2layers/converter/text/text-layout';
import type { TextRun } from '../../../../../src/adapter/svg2layers/converter/text/parse-text-runs';
import type { ConvertOptions, SVG2IRWarning } from '../../../../../src/common/types';
import { buildTextLayer } from '../build-layer-fixtures';

function buildRun(text: string, fontSize = 20): TextRun {
  return { text, fontSize, color: '#000000', alpha: 1, bold: false, italic: false };
}

const measureText: NonNullable<ConvertOptions['measureText']> = (font, text) => {
  const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);

  return {
    width: text.length * size / 2,
    fontBoundingBoxAscent: size * 0.9,
    fontBoundingBoxDescent: size * 0.3,
  };
};

describe('Static text fragment layout', () => {
  it('retains configured baseline spacing when font bounds exceed line height', () => {
    const result = buildTextRunLayout([buildRun('A\nB')], 'Arial', 0, { ...buildTextLayer().content, lineHeight: 20 }, [10, 40],
      { measureText }, [], 'text_0001', true);

    expect(result[1].box[1] - result[0].box[1]).toBe(20);
    expect(result.map(part => part.box)).toEqual([[-5, -22, 5, 2], [-5, -2, 5, 22]]);
  });

  it('uses a shared baseline grid across rows with different font sizes', () => {
    const result = buildTextRunLayout([buildRun('A'), buildRun('\nB', 10)], 'Arial', 0,
      { ...buildTextLayer().content, lineHeight: 20 }, [10, 40], { measureText }, [], 'text_0001', true);
    const firstBaseline = result[0].box[1] + 18;
    const secondBaseline = result[1].box[1] + 9;

    expect(secondBaseline - firstBaseline).toBe(20);
  });

  it.each([
    { whole: 16, expected: 20 },
    { whole: 21, expected: 20 },
  ])('按实际字号逐字测宽，不使用整段宽度或额外余量：$whole', ({ whole, expected }) => {
    const measured: Array<{ font: string; text: string }> = [];
    const result = buildTextRunLayout([buildRun('AV')], 'Arial', 0,
      { ...buildTextLayer().content, lineHeight: 20 }, [20, 20], {
        measureText: (font, text) => {
          measured.push({ font, text });
          const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);

          return {
            width: text === 'AV' ? whole : size / 2,
            fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.3,
          };
        },
      }, [], 'text_0001', true);

    expect(result[0].box[2] - result[0].box[0]).toBe(expected);
    expect(measured).toContainEqual({ font: '10px "Arial"', text: 'x' });
    expect(measured.some(call => call.text === 'AV')).toBe(false);
    for (const text of ['A', 'V']) {
      expect(measured).toContainEqual({ font: '20px "Arial"', text });
    }
  });

  it('按 Unicode 码点测量字符，并只在字符之间添加字距', () => {
    const measured: string[] = [];
    const result = buildTextRunLayout([buildRun('😀A')], 'Arial', 2,
      { ...buildTextLayer().content, lineHeight: 20 }, [32, 20], {
        measureText: (_font, text) => {
          measured.push(text);

          return {
            width: text === '😀A' ? 30 : text === '😀' ? 20 : 10,
            fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2,
          };
        },
      }, [], 'text_0001', true);

    expect(measured).toEqual(['x', '😀', 'A']);
    expect(result[0].box[2] - result[0].box[0]).toBe(32);
  });

  it('按变换后的字号测宽，再换回布局的局部坐标', () => {
    const fonts: string[] = [];
    const result = buildTextRunLayout([buildRun('AB')], 'Arial', 0,
      { ...buildTextLayer().content, lineHeight: 20 }, [20, 20], {
        measureText: (font, text) => {
          fonts.push(font);
          const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);

          return {
            width: text === 'AB' ? size === 40 ? 24.005 : 12 : size === 40 ? 12.002 : 6,
            fontBoundingBoxAscent: size * 0.9, fontBoundingBoxDescent: size * 0.3,
          };
        },
      }, [], 'text_0001', true, [2, 2]);

    expect(result[0].box[2] - result[0].box[0]).toBeCloseTo(24.004 / 2, 10);
    expect(fonts[0]).toBe('10px "Arial"');
    expect(fonts.slice(1).every(font => font === '40px "Arial"')).toBe(true);
  });

  it('浮点字距按目标排版的顺序与字宽交替累加', () => {
    const glyphWidth = 0.1;
    const spacing = 0.2;
    const renderScale = 1.1;
    const indices = Array.from({ length: 12 }, (_, index) => index);
    const expected = indices.reduce((total, _, index) =>
      total + (index === 0 ? 0 : spacing * renderScale) + glyphWidth, 0);
    const result = buildTextRunLayout([buildRun('A'.repeat(indices.length))], 'Arial', spacing,
      { ...buildTextLayer().content, lineHeight: 20 }, [0, 20], {
        measureText: () => ({ width: glyphWidth, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }),
      }, [], 'text_0001', true, [renderScale, renderScale]);

    const groupedWidth = indices.reduce(total => total + glyphWidth, 0) / renderScale
      + (indices.length - 1) * spacing;

    expect(expected / renderScale).not.toBe(groupedWidth);
    expect(result[0].box[2] - result[0].box[0]).toBe(expected / renderScale);
  });

  it('测宽使用输出支持的普通样式，基线继续使用来源字体指标', () => {
    const fonts: string[] = [];

    buildTextRunLayout([{ ...buildRun('AB'), bold: true, italic: true }], 'Arial', 0,
      { ...buildTextLayer().content, lineHeight: 20 }, [20, 20], {
        measureText: (font, text) => {
          fonts.push(font);

          return measureText(font, text);
        },
      }, [], 'text_0001', true);

    expect(fonts[0]).toBe('italic bold 10px "Arial"');
    expect(fonts.slice(1).every(font => font === '20px "Arial"')).toBe(true);
  });

  it('reports estimated bounds when reference font metrics are missing', () => {
    const warnings: SVG2IRWarning[] = [];
    const result = buildTextRunLayout([buildRun('Hi')], 'Arial', 0, { ...buildTextLayer().content, lineHeight: 20 }, [20, 20], {
      measureText: (_font, text) => ({ width: text.length * 5 }),
    }, warnings, 'text_0001', true);

    expect(result).toHaveLength(1);
    expect(warnings.map(warning => warning.code)).toEqual(['svg2ge_layers_text_bounds_estimated']);
  });

  it('uses full-width CJK estimates without a text measurement callback', () => {
    const result = buildTextRunLayout([buildRun('行动按钮', 42)], 'AlibabaPuHuiTi_2_65_Medium', 2.471,
      { ...buildTextLayer().content, lineHeight: 42 }, [175.413, 42], {}, [], 'text_0001', true);

    expect(result[0].box[2] - result[0].box[0]).toBeCloseTo(175.413);
  });

  it('uses the same fallback font metrics as SVG text parsing', () => {
    const result = buildTextRunLayout([buildRun('标', 70), buildRun('题', 20)], 'AlimamaShuHeiTi-Bold', 0,
      { ...buildTextLayer().content, lineHeight: 70 }, [90, 70], {}, [], 'text_0001', true);

    expect(result[1].box[1]).toBeCloseTo(9);
  });

  it('passes a usable font descriptor for quoted SVG font families', () => {
    const fonts: string[] = [];

    buildTextRunLayout([buildRun('AB')], "'Some Font'", 0,
      { ...buildTextLayer().content, lineHeight: 20 }, [20, 20], {
        measureText: (font, text) => {
          fonts.push(font);

          return { width: text.length * 5, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 };
        },
      }, [], 'text_0001', true);

    expect(fonts[0]).toBe('10px "Some Font"');
    expect(fonts.slice(1).every(font => font === '20px "Some Font"')).toBe(true);
  });
});

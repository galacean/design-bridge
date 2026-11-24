import { describe, expect, expectTypeOf, it } from 'vitest';
import type { JSONScene } from '@galacean/effects-specification';
import {
  convertSVGToLayers, convertSVGToGE, splitSVG, type SVGStaticLayer,
} from '@galacean/svg2ir';

const imageUrl = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>',
);
const measureText = (font: string, text: string) => {
  const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);

  return {
    width: Array.from(text).length * size / 2,
    fontBoundingBoxAscent: size * 0.8,
    fontBoundingBoxDescent: size * 0.2,
  };
};
const wrap = (content: string) => `<svg width="200" height="100">${content}</svg>`;
const image = `<image id="source-image" href="${imageUrl}" x="10" y="20" width="40" height="30" preserveAspectRatio="none"/>`;

describe('convertSVGToLayers layers output', async () => {
  it('returns GE synchronously and layers asynchronously', async () => {
    const ge = convertSVGToGE(wrap(image));
    const pendingLayers = convertSVGToLayers(wrap(image));
    const layers = await pendingLayers;

    expectTypeOf(ge.data).toEqualTypeOf<JSONScene>();
    expect(pendingLayers).toBeInstanceOf(Promise);
    expectTypeOf(layers.data).toEqualTypeOf<SVGStaticLayer[]>();
    expect(ge.data.type).toBe('ge');
    expect(Array.isArray(layers.data)).toBe(true);
    expect(Object.keys(layers).sort()).toEqual(['data', 'size', 'warnings']);
  });

  it('maps image references and pixel bounds without copying source names', async () => {
    const result = await convertSVGToLayers(wrap(image), {});

    expect(result.data).toEqual([{
      id: 'image_0001', type: 'image', role: 'content', url: imageUrl,
      bbox: [10, 20, 50, 50], size: [40, 30], rotation: [0, 0, 0], width: 40, height: 30,
    }]);
    expect(result.warnings).toEqual([]);
    expect((await convertSVGToLayers(wrap(image), {})).data).toEqual(result.data);
  });

  it.each([imageUrl, 'https://example.com/original.png'])(
    'retains the resource URL and display dimensions after nested scaling (%s)', async url => {
      const source = wrap(`<g transform="translate(10 5) scale(2)"><image href="${url}"`
        + ' x="10" y="20" width="40" height="30" preserveAspectRatio="none"/></g>');
      const result = await convertSVGToLayers(source, {
        loadImage: () => Promise.resolve({
          data: Uint8Array.from(atob(imageUrl.split(',')[1]), character => character.charCodeAt(0)),
          mimeType: 'image/svg+xml',
        }),
      });

      expect(result.data).toEqual([{
        id: 'image_0001', type: 'image', role: 'content', bbox: [30, 45, 110, 105],
        url: imageUrl, size: [80, 60], rotation: [0, 0, 0], width: 80, height: 60,
      }]);
      expect(result.warnings).toEqual([]);
    },
  );

  it('retains images enclosed by a covering rectangular mask', async () => {
    const source = wrap('<defs><rect id="mask-rect" width="40" height="30"/></defs>'
      + '<g transform="translate(15 5)"><mask id="mask" fill="white"><use href="#mask-rect"/></mask>'
      + `<image href="${imageUrl}" width="40" height="30" mask="url(#mask)"/></g>`);
    const result = await convertSVGToLayers(source, { strict: true });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ type: 'image', bbox: [15, 5, 55, 35], size: [40, 30] });
    expect(result.warnings).toEqual([]);
  });

  it.each(['fill-rule', 'clip-rule'])('diagnoses an explicitly configured %s on a mask', async attribute => {
    const source = wrap(`<defs><mask id="mask"><rect width="40" height="30" ${attribute}="evenodd"/></mask></defs>`
      + `<image href="${imageUrl}" width="40" height="30" mask="url(#mask)"/>`);

    await expect(convertSVGToLayers(source, { strict: true })).rejects.toThrow(/clip-rule\/fill-rule/);
  });

  it.each([
    'AlibabaPuHuiTi_2_105_Heavy', "'AlibabaPuHuiTi_2_105_Heavy'", '"AlibabaPuHuiTi_2_105_Heavy"',
  ])('exports a font family name without CSS quotes (%s)', async family => {
    const attribute = family.replace(/"/g, '&quot;');
    const result = await convertSVGToLayers(wrap(`<text x="10" y="80" font-family="${attribute}"`
      + ' font-size="62" letter-spacing="0">双11免定卡，享0元付定</text>'), {
      measureText,
    });

    expect(result.data[0]).toMatchObject({
      fragments: [{ font_family: 'AlibabaPuHuiTi_2_105_Heavy', font_size: 62, letter_spacing: 0 }],
    });
  });

  it('expands short hexadecimal text colors by channel', async () => {
    const result = await convertSVGToLayers(wrap('<text x="10" y="30" fill="#abc">Hello</text>'), {
      measureText,
    });

    expect(result.data[0]).toMatchObject({ fragments: [{ color: '#AABBCC' }] });
  });

  it('returns the SVG viewport independently of the content bounds', async () => {
    const result = await convertSVGToLayers('<svg width="1080px" height="570px" viewBox="0 0 1080 570">'
      + '<text x="20" y="40">Small content</text></svg>', { measureText });

    expect(result.size).toEqual([1080, 570]);
    expect(result.data[0].bbox[2]).toBeLessThan(1080);
    const empty = await convertSVGToLayers('<svg width="80" height="60"/>', {});

    expect(empty.size).toEqual([80, 60]);
    expect(empty.data).toEqual([]);
  });

  it.each([
    ['<svg viewBox="0 0 320 180"/>', [320, 180]],
    ['<svg width="640" height="360" viewBox="0 0 320 180"/>', [640, 360]],
  ])('uses the composition viewport rather than the viewBox scale (%s)', async (source, size) => {
    const result = await convertSVGToLayers(source, {});

    expect(result.size).toEqual(size);
  });

  it.each([0, 6, -30, 45, 90, 180])('retains image size and rotation at %s degrees', async angle => {
    const source = wrap(`<g transform="translate(10 5) rotate(${angle} 30 35) scale(2)">${image}</g>`);
    const result = await convertSVGToLayers(source, { strict: true });
    const layer = result.data[0];

    if (layer?.type !== 'image') { throw new Error('Missing rotated image'); }
    expect(result.warnings).toEqual([]);
    expect(layer.url).toBe(imageUrl);
    expect(layer.size).toEqual([80, 60]);
    expect(layer.rotation).toEqual([0, 0, angle]);
    const radians = angle * Math.PI / 180;

    expect((layer.bbox[0] + layer.bbox[2]) / 2)
      .toBeCloseTo(40 + 30 * Math.cos(radians) - 35 * Math.sin(radians), 1);
    expect((layer.bbox[1] + layer.bbox[3]) / 2)
      .toBeCloseTo(40 + 30 * Math.sin(radians) + 35 * Math.cos(radians), 1);

    expect(layer.bbox[2] - layer.bbox[0])
      .toBeCloseTo(80 * Math.abs(Math.cos(radians)) + 60 * Math.abs(Math.sin(radians)), 1);
    expect(layer.bbox[3] - layer.bbox[1])
      .toBeCloseTo(80 * Math.abs(Math.sin(radians)) + 60 * Math.abs(Math.cos(radians)), 1);
    expect(layer.width).toBeCloseTo(layer.bbox[2] - layer.bbox[0], 2);
    expect(layer.height).toBeCloseTo(layer.bbox[3] - layer.bbox[1], 2);
  });

  it('retains SVG rotation about an explicit center without changing the original image resource', async () => {
    const source = '<svg width="1080" height="570">'
      + `<image href="${imageUrl}" x="164" y="170" width="205" height="58" preserveAspectRatio="none"`
      + ' transform="translate(266.5 199) rotate(6) translate(-266.5 -199)"/></svg>';
    const result = await convertSVGToLayers(source, { strict: true });

    expect(result.size).toEqual([1080, 570]);
    expect(result.data[0]).toMatchObject({
      size: [205, 58], rotation: [0, 0, 6], url: imageUrl,
    });
    const expected = [161.53, 159.44, 371.47, 238.56];

    result.data[0].bbox.forEach((value, index) => expect(Math.abs(value - expected[index])).toBeLessThan(0.02));
  });

  it('retains the existing per-character lowering of vertical SVG text', async () => {
    const source = wrap('<text x="40" y="10" font-family="Arial" font-size="20"'
      + ' writing-mode="vertical-rl">中文</text>');
    const result = await convertSVGToLayers(source, { measureText });
    const layers = result.data.filter(layer => layer.type === 'text');

    expect(layers.map(layer => layer.content)).toEqual(['中', '文']);
    expect(layers[1].bbox[1]).toBeGreaterThan(layers[0].bbox[1]);
    expect(layers.flatMap(layer => layer.fragments).map(fragment => fragment.direction))
      .toEqual(['horizontal', 'horizontal']);
    expect(layers.every(layer => layer.state === 'active' && layer.erase_operations.length === 0)).toBe(true);
  });

  it('exports native text with relative fragments and no inferred erase operations', async () => {
    const result = await convertSVGToLayers(wrap('<text id="source-title" x="20" y="40" font-family="Arial" font-size="20" fill="#123456">Hello</text>'), {
      measureText,
    });
    const text = result.data[0];

    expect(text).toMatchObject({ id: 'text_0001', type: 'text', state: 'active', content: 'Hello', erase_operations: [] });
    if (text?.type !== 'text') { throw new Error('Missing text layer'); }
    expect(text.fragments).toHaveLength(1);
    expect(text.fragments[0]).toMatchObject({
      content: 'Hello',
      font_family: 'Arial', font_size: 20, color: '#123456', letter_spacing: 0,
      direction: 'horizontal', rotation: 0,
    });
    const fragment = text.fragments[0];

    fragment.bbox.forEach((value, index) => expect(value).toBeCloseTo([0, 0, 50, 20][index], 10));
    expect(fragment.polygon).toEqual([
      [fragment.bbox[0], fragment.bbox[1]], [fragment.bbox[2], fragment.bbox[1]],
      [fragment.bbox[2], fragment.bbox[3]], [fragment.bbox[0], fragment.bbox[3]],
    ]);
    expect(result.data.some(layer => layer.type === 'image')).toBe(false);
  });

  it.each(['start', 'middle', 'end'].flatMap(anchor => [false, true].map(translated => ({ anchor, translated }))))(
    '保留 $anchor 锚点和平移 $translated 下的实际字宽', async ({ anchor, translated }) => {
    const content = '双11免定卡，享0元付定';
    const width = 656.0219421386719;
    const x = 213.96839303912145;
    const result = await convertSVGToLayers(wrap(`<text ${translated ? `x="0" y="0" transform="translate(${x} 361.3076621529376)"`
      : `x="${x}" y="80"`} font-family="Test Font"`
      + ` font-size="62" text-anchor="${anchor}">${content}</text>`), {
      measureText: (font, text) => {
        const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);
        const measured = text === content && size === 62 ? width : Array.from(text).reduce((total, char) =>
          total + (/\d/.test(char) ? size === 10 ? 5.75 : 35.649993896484375
            : size === 10 ? 9.839996337890625 : 61.00799560546875), 0);

        return { width: measured, fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 };
      },
    });
    const layer = result.data[0];

    if (layer?.type !== 'text') { throw new Error('Missing text layer'); }
    const fragment = layer.fragments[0];
    const actualWidth = fragment.bbox[2] - fragment.bbox[0];
    const left = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width;

    expect(actualWidth).toBeGreaterThanOrEqual(656.0219421386719);
    expect(actualWidth).toBe(width);
    expect(layer.bbox[0] + fragment.bbox[0]).toBeCloseTo(left, 10);
  });

  it.each(['text', 'tspan'])('%s 的字号、缩放、旋转和字距保留完整精度', async tag => {
    const fontSize = 20.125;
    const spacing = 0.123456789;
    const scale = 1.2345;
    const angle = 17.123456789;
    const result = await convertSVGToLayers(wrap(`<text x="10.125" y="50.375" font-family="Arial"`
      + ` font-size="${fontSize}" letter-spacing="${spacing}"`
      + ` transform="translate(10.123456789 5.987654321) rotate(${angle}) scale(${scale})">`
      + (tag === 'tspan' ? `<tspan font-size="${fontSize}">AA</tspan>` : 'AA') + '</text>'), {
      measureText: (font, text) => {
        const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);

        return {
          width: size * (text === 'AA' ? 1.23456789 : 0.6),
          fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2,
        };
      },
    });
    const layer = result.data[0];

    if (layer?.type !== 'text') { throw new Error('Missing text layer'); }
    const fragment = layer.fragments[0];
    const polygon = fragment.polygon;

    if (polygon == null) { throw new Error('Missing text quadrilateral'); }
    expect(fragment.font_size).toBeCloseTo(fontSize * scale, 10);
    expect(fragment.letter_spacing).toBeCloseTo(spacing * scale, 10);
    expect(fragment.rotation).toBeCloseTo(angle, 10);
    expect(Math.hypot(polygon[1][0] - polygon[0][0], polygon[1][1] - polygon[0][1]))
      .toBeCloseTo((fontSize * 1.2 + spacing) * scale, 10);
  });

  it('does not classify image pixels as text or infer protocol roles from SVG names', async () => {
    const svg = wrap(image.replace('source-image', 'background_text_pixels'));
    const result = await convertSVGToLayers(svg, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'image_0001', type: 'image', role: 'content', url: imageUrl });
  });

  it('retains precise text dimensions independently of measured run width', async () => {
    const result = await convertSVGToLayers(wrap('<text x="10" y="30" font-family="Arial" font-size="16">Long text</text>'), {
      measureText: (_font, text) => ({
        width: text.length === 1 ? 8 : 221.4296875,
        fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 2,
      }),
    });

    expect(result.data).toHaveLength(1);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_unsupported_feature')).toBe(false);
    const layer = result.data[0];

    if (layer.type !== 'text') { throw new Error('Missing text layer'); }
    expect(layer.fragments[0].font_size).toBe(16);
  });

  it('retains rich text colors, escapes and fragment offsets', async () => {
    const svg = wrap('<text x="10" y="30" font-family="Arial" font-size="20"><tspan fill="#ff0000">A&lt;</tspan><tspan fill="#0000ff">B</tspan></text>');
    const split = splitSVG(svg, { measureText });
    const result = await convertSVGToLayers(svg, { measureText }, split.preservedData);
    const fragments = result.data.flatMap(layer => layer.type === 'text' ? layer.fragments : []);

    expect(fragments.map(fragment => fragment.content).join('')).toBe('A<B');
    expect(fragments.map(fragment => fragment.color)).toEqual(['#FF0000', '#0000FF']);
    expect(fragments[1].bbox[0]).toBeCloseTo(20, 10);
    expect(fragments[0].bbox[2]).toBeCloseTo(fragments[1].bbox[0], 10);
    const [left, top, right, bottom] = fragments[1].bbox;

    expect(left).toBeGreaterThan(0);
    expect(fragments[1].polygon).toEqual([[left, top], [right, top], [right, bottom], [left, bottom]]);
  });

  it('preserves painter order across image and text layers', async () => {
    const result = await convertSVGToLayers(wrap(`${image}<text x="20" y="30">First</text>${image}`), {
      measureText,
    });

    expect(result.data.map(layer => layer.type)).toEqual(['image', 'text', 'image']);
    expect(result.data.map(layer => layer.id)).toEqual(['image_0001', 'text_0001', 'image_0002']);
  });

  it('reports unsupported shapes, skips hidden content and emits warnings once', async () => {
    const reported: string[] = [];
    const result = await convertSVGToLayers(wrap(`${image}<rect width="10" height="10"/><g display="none">${image}</g>`), {
      onWarning: warning => reported.push(warning.code),
    });

    expect(result.data).toHaveLength(1);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_unsupported_type')).toBe(true);
    expect(reported).toEqual(result.warnings.map(warning => warning.code));
  });

  it.each([
    ['opacity', `<g opacity="0.5">${image}</g>`],
    ['mask', `<defs><clipPath id="clip"><circle cx="10" cy="10" r="5"/></clipPath></defs><image href="${imageUrl}" width="40" height="30" clip-path="url(#clip)"/>`],
  ])('diagnoses unsupported %s without outputting a misleading image', async (_name, source) => {
    const result = await convertSVGToLayers(wrap(source), {});

    expect(result.data).toEqual([]);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_unsupported_feature')).toBe(true);
  });

  it('strips animation so the static image layer is retained', async () => {
    const source = `<image href="${imageUrl}" width="40" height="30"><animate attributeName="x" values="0;20" dur="1s"/></image>`;
    const result = await convertSVGToLayers(wrap(source), {});

    expect(result.data).toEqual([expect.objectContaining({ type: 'image' })]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'svg2ge_layers_animation_stripped' })]);
  });

  it('fails unsupported conversion in strict mode and reports estimated text bounds', async () => {
    await expect(convertSVGToLayers(wrap('<rect width="10" height="10"/>'), {
      strict: true,
    })).rejects.toThrow(/layers/);
    const result = await convertSVGToLayers(wrap('<text x="10" y="30">Hello</text>'), {});

    expect(result.data).toHaveLength(1);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_text_bounds_estimated')).toBe(true);
  });
  it.each([0, 30, 45, 90, -30, 120])('preserves the transformed text quadrilateral at %s degrees', async angle => {
    const svg = wrap(`<g transform="translate(10 5) scale(2)"><text x="20" y="40" font-family="Arial"`
      + ` font-size="20" letter-spacing="2" transform="rotate(${angle} 20 40)">Hi</text></g>`);
    const result = await convertSVGToLayers(svg, { measureText });
    const layer = result.data[0];

    if (layer?.type !== 'text') { throw new Error('Missing rotated text layer'); }
    const fragment = layer.fragments[0];
    const polygon = fragment.polygon;

    if (polygon == null) { throw new Error('Missing text quadrilateral'); }
    expect(polygon).toHaveLength(4);
    expect(fragment.rotation).toBeCloseTo(angle);
    expect(fragment.font_size).toBe(40);
    expect(fragment.letter_spacing).toBe(4);
    expect(Math.hypot(polygon[1][0] - polygon[0][0], polygon[1][1] - polygon[0][1]))
      .toBeCloseTo(44, 1);
    expect(Math.hypot(polygon[3][0] - polygon[0][0], polygon[3][1] - polygon[0][1]))
      .toBeCloseTo(40, 1);
    expect(fragment.bbox).toEqual([
      Math.min(...polygon.map(point => point[0])), Math.min(...polygon.map(point => point[1])),
      Math.max(...polygon.map(point => point[0])), Math.max(...polygon.map(point => point[1])),
    ]);
    expect(layer.bbox[2] - layer.bbox[0]).toBeCloseTo(fragment.bbox[2], 1);
    expect(layer.bbox[3] - layer.bbox[1]).toBeCloseTo(fragment.bbox[3], 1);
    expect(layer.state).toBe('active');
    expect(layer.erase_operations).toEqual([]);
  });

  it('keeps native font fields and relative polygons for differently styled fragments', async () => {
    const source = wrap('<text x="20" y="40" font-family="Arial" font-size="20" letter-spacing="2">'
      + '<tspan fill="#123456">AB</tspan><tspan fill="#abcdef" font-size="10">CD</tspan></text>');
    const result = await convertSVGToLayers(source, { measureText });
    const layers = result.data.filter(layer => layer.type === 'text');
    const fragments = layers.flatMap(layer => layer.fragments);

    expect(layers.map(layer => layer.content).join('')).toBe('ABCD');
    expect(fragments.map(fragment => ({
      content: fragment.content, font: fragment.font_family, size: fragment.font_size,
      spacing: fragment.letter_spacing, color: fragment.color, direction: fragment.direction,
    }))).toEqual([
      { content: 'AB', font: 'Arial', size: 20, spacing: 2, color: '#123456', direction: 'horizontal' },
      { content: 'CD', font: 'Arial', size: 10, spacing: 2, color: '#ABCDEF', direction: 'horizontal' },
    ]);
    for (const fragment of fragments) {
      const [left, top, right, bottom] = fragment.bbox;

      expect(fragment.polygon).toEqual([[left, top], [right, top], [right, bottom], [left, bottom]]);
    }
  });

  it('retains parser diagnostics without calling onWarning twice in layers mode', async () => {
    const reported: string[] = [];
    const result = await convertSVGToLayers(wrap('<text font-family="Custom Font" filter="url(#missing)">Hi</text>'), {
      onWarning: warning => reported.push(warning.code),
    });

    expect(reported).toEqual(result.warnings.map(warning => warning.code));
  });

  it('reports style loss and rejects it in strict mode rather than inventing consumer fields', async () => {
    const svg = wrap('<text x="10" y="30" font-family="Arial" font-size="20" font-weight="bold">Bold</text>');
    const result = await convertSVGToLayers(svg, { measureText });

    expect(result.data).toHaveLength(1);
    expect(result.warnings.some(warning => warning.code === 'svg2ge_layers_text_style_dropped')).toBe(true);
    await expect(convertSVGToLayers(svg, { measureText, strict: true }))
      .rejects.toThrow(/weight\/style/);
  });

  it.each(['ge', 'layers'] as const)('keeps preserved text bound to layer IDs despite duplicate names (%s)', async format => {
    const source = wrap(
      '<text id="text_1" x="10" y="40" font-family="Arial" font-size="20"><tspan fill="red">A</tspan></text>'
      + '<text x="100" y="40" font-family="Arial" font-size="30"><tspan fill="blue">B</tspan></text>',
    );
    const split = splitSVG(source, { measureText });
    const result = format === 'ge'
      ? convertSVGToGE(source, { measureText }, split.preservedData)
      : await convertSVGToLayers(source, { measureText }, split.preservedData);

    expect(split.ir.compositions[0].layers.map(layer => layer.name)).toEqual(['text_1', 'text_1']);
    if (Array.isArray(result.data)) {
      const textLayers = result.data.filter(layer => layer.type === 'text');

      expect(textLayers.map(layer => layer.content)).toEqual(['A', 'B']);
      expect(textLayers.map(layer => layer.fragments[0].color)).toEqual(['#FF0000', '#0000FF']);
    } else {
      expect(result.data.items.filter(item => item.name === 'text_1')).toHaveLength(2);
      expect(result.data.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ options: expect.objectContaining({ text: '<color=red>A</color>', fontSize: 20 }) }),
        expect.objectContaining({ options: expect.objectContaining({ text: '<color=blue>B</color>', fontSize: 30 }) }),
      ]));
    }
  });

});

import { describe, expect, it } from 'vitest';
import { DataType } from '@galacean/effects-specification';
import {
  convertSVGToGE, convertSVGToIR, splitSVG, type SVGToGEOptions,
} from '@galacean/svg2ir';

function convertSVGToGEForTest (source: string, options?: SVGToGEOptions) {
  const { fonts: _fonts, ...parserOptions } = options ?? {};
  const result = splitSVG(source, parserOptions);
  const exportResult = convertSVGToGE(source, options, result.preservedData);

  return { data: exportResult.data, ir: result.ir, warnings: exportResult.warnings };
}

describe('splitSVG + convertSVGToGE', () => {
  it('keeps the three public result shapes separate', () => {
    const svg = '<svg width="20" height="20"><rect width="10" height="10"/></svg>';
    const irResult = convertSVGToIR(svg);
    const splitResult = splitSVG(svg);
    const geResult = convertSVGToGE(svg);

    expect(Object.keys(irResult).sort()).toEqual(['ir', 'warnings']);
    expect(Object.keys(splitResult).sort()).toEqual(['ir', 'preservedData', 'warnings']);
    expect(Object.keys(geResult).sort()).toEqual(['data', 'warnings']);
    expect(irResult.ir).toBeDefined();
    expect(splitResult.preservedData.textDataByLayerId).toBeInstanceOf(Map);
    expect(splitResult.preservedData.paintAnimationsByLayerId).toBeInstanceOf(Map);
    expect(splitResult.preservedData.shapeAnimationsByLayerId).toBeInstanceOf(Map);

    const textSvg = '<svg width="100" height="40"><text>Text</text></svg>';
    const plainGE = convertSVGToGE(textSvg);
    const textSplit = splitSVG(textSvg);
    const preservedGE = convertSVGToGE(textSvg, undefined, textSplit.preservedData);
    const hasRichText = (scene: typeof plainGE.data): boolean =>
      (scene.components as Array<{ dataType?: string }>).some(component => component.dataType === 'RichTextComponent');

    expect(hasRichText(plainGE.data)).toBe(false);
    expect(hasRichText(preservedGE.data)).toBe(true);
  });

  it('uses shared IR→GE lowering and restores SVG RichText adaptation', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <text x="20" y="40" font-size="24" fill="#f00">
          <tspan fill="#f00">Red</tspan><tspan fill="#00f">Blue</tspan>
        </text>
      </svg>
    `);
    const components = result.data.components as Array<{ dataType?: string }>;

    expect(result.ir.compositions[0].layers.some((layer: { type: string }) => layer.type === 'text')).toBe(true);
    expect(result.data.type).toBe('ge');
    expect(result.data.version).toBe('3.7');
    expect(components.some(component => component.dataType === 'RichTextComponent')).toBe(true);
  });

  it('writes custom path animation to GE shape point tracks', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <path id="morph" d="M10 10 L30 10 L30 30 Z" fill="red">
          <animate attributeName="d" values="M10 10 L30 10 L30 30 Z;M10 10 L50 10 L30 50 Z" dur="1s" fill="freeze"/>
        </path>
      </svg>
    `);
    const floatTracks = miscsOf(result).filter(misc => misc.dataType === DataType.FloatPropertyTrack);

    expect(floatTracks.some(track => String(track.path).includes('components.0.shape.points.'))).toBe(true);
    expect(floatTracks.some(track => String(track.path).endsWith('components.0.shapeDirty'))).toBe(true);
  });

  it('preserves SVG bottom-to-top painter order across IR and GE', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <rect id="background" width="200" height="200" fill="#f00"/>
        <rect id="foreground" x="50" y="50" width="100" height="100" fill="#00f"/>
      </svg>
    `);
    const composition = result.data.compositions[0];
    const itemNameById = new Map(result.data.items.map(item => [item.id, item.name]));

    expect(result.ir.compositions[0].layers.map(layer => layer.name)).toEqual(['background', 'foreground']);
    expect(composition.children?.map(item => itemNameById.get(item.id))).toEqual(['background', 'foreground']);
  });

  it('resolves relative image assets against resourceBaseUrl and deduplicates shared sources', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <image href="assets/shared.png" width="50" height="50"/>
        <image href="assets/shared.png" x="50" width="50" height="50"/>
      </svg>
    `, { resourceBaseUrl: 'https://example.com/designs/source.svg' });
    const imageAssets = result.ir.assets.filter(asset => asset.type === 'image');
    const imageLayers = result.ir.compositions[0].layers.filter(layer => layer.type === 'image');

    expect(imageAssets).toEqual([{
      id: 'assets/shared.png',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/designs/assets/shared.png' },
    }]);
    expect(imageLayers.map(layer => layer.content.assetId)).toEqual(['assets/shared.png', 'assets/shared.png']);
  });

  it('normalizes data URL images into embedded IR Assets', async () => {
    const imageUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=';
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
        <image href="${imageUrl}" width="20" height="20"/>
      </svg>
    `);
    const imageAsset = result.ir.assets.find(asset => asset.type === 'image');

    expect(imageAsset).toMatchObject({ type: 'image', source: { kind: 'embedded', mimeType: 'image/svg+xml' } });
    if (imageAsset?.type === 'image' && imageAsset.source.kind === 'embedded') {
      expect(imageAsset.source.data).not.toBe('');
    }
  });

  it('injects supplied fonts and suppresses the missing-font warning', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">
        <text font-family="Custom Sans" font-size="20">Text</text>
      </svg>
    `, {
      fonts: [{ fontFamily: 'Custom Sans', fontURL: 'https://example.com/fonts/custom-sans.woff2' }],
    });

    expect(result.warnings.some(warning => warning.code === 'svg2ir_text_font_not_supplied')).toBe(false);
    expect(result.data.fonts).toEqual([{
      fontFamily: 'Custom Sans',
      fontURL: 'https://example.com/fonts/custom-sans.woff2',
    }]);
  });

  it('lowers animated IR properties into GE timeline tracks', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20">
          <animate attributeName="opacity" from="1" to="0" dur="1s" fill="freeze"/>
        </rect>
      </svg>
    `, { frameRate: 30, durationSeconds: 1 });
    const layer = result.ir.compositions[0].layers[0];
    const hasTimelineTrack = result.data.miscs.some(misc => String(misc.dataType).endsWith('Track'));

    expect(layer.transform?.opacity?.type).toBe('keyframed');
    expect(hasTimelineTrack).toBe(true);
  });

  it('keeps the root IR result separate from the GE adapter output', async () => {
    const result = convertSVGToGEForTest('<svg width="20" height="20"><rect width="10" height="10"/></svg>');

    expect(result.data).toBeDefined();
    expect(result.warnings).toEqual([]);
  });

  it('reports missing supplied fonts by family instead of opaque Asset ID', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">
        <text font-family="Custom Sans" font-size="20">Text</text>
      </svg>
    `);

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'svg2ir_text_font_not_supplied',
      message: expect.stringContaining('Custom Sans'),
    }));
    expect(result.warnings.some(warning => warning.message.includes('font:0'))).toBe(false);
  });

  // paint-track 后处理的回归锁:applyShapePaintAnimation 为 SMIL paint 动画向 GE scene 追加
  // MaterialTrack/ColorPropertyTrack/FloatPropertyTrack。拆分该模块时必须保证三类轨道仍然产出,
  // 且 MaterialTrack 的 index、ColorPropertyTrack 的 path('colors._Color')、FloatPropertyTrack 的
  // path('strokeWidth') 与 SolidColor/baked-alpha 路径共用同一 MaterialTrack 构造器。
  const miscsOf = (result: ReturnType<typeof convertSVGToGEForTest>): Array<{ dataType?: string; index?: number; path?: string }> =>
    result.data.miscs;

  it('maps SMIL fill color animation onto a material color track', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="80" height="80" fill="#f00">
          <animate attributeName="fill" values="#f00;#00f" dur="0.2s"/>
        </rect>
      </svg>
    `);
    const miscs = miscsOf(result);
    const materialTracks = miscs.filter(entry => entry.dataType === 'MaterialTrack');
    const colorTracks = miscs.filter(entry => entry.dataType === 'ColorPropertyTrack');

    expect(materialTracks).toHaveLength(1);
    expect(colorTracks).toHaveLength(1);
    expect(colorTracks[0]?.path).toBe('colors._Color');
  });

  it('maps SMIL fill-opacity animation onto the baked solid-color material track', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="80" height="80" fill="#f00" fill-opacity="1">
          <animate attributeName="fill-opacity" values="1;0" dur="0.2s"/>
        </rect>
      </svg>
    `);
    const miscs = miscsOf(result);
    const materialTracks = miscs.filter(entry => entry.dataType === 'MaterialTrack');
    const colorTracks = miscs.filter(entry => entry.dataType === 'ColorPropertyTrack');

    expect(materialTracks).toHaveLength(1);
    expect(colorTracks).toHaveLength(1);
    expect(colorTracks[0]?.path).toBe('colors._Color');
  });

  it('maps SMIL stroke-width animation onto a stroke-width float track', async () => {
    const result = convertSVGToGEForTest(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="80" height="80" fill="none" stroke="#000" stroke-width="2">
          <animate attributeName="stroke-width" values="2;8" dur="0.2s"/>
        </rect>
      </svg>
    `);
    const miscs = miscsOf(result);
    const floatTracks = miscs.filter(entry => entry.dataType === 'FloatPropertyTrack');

    expect(floatTracks).toHaveLength(1);
    expect(floatTracks[0]?.path).toBe('strokeWidth');
  });
});

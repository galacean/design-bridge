import { describe, expect, it } from 'vitest';

import type { IRScene } from '@galacean/animation-ir';
import {
  createIRResourceSource, createIRScene, getIRResourceSourceUrl,
  resolveIRResourceUrl,
} from '@galacean/animation-ir/adapter';
import { validateIRScene, assertIRScene } from '@galacean/animation-ir/validator';
import { makeComposition, makeLayer, makeScene } from './test-scene';

describe('IRScene Asset Registry', () => {
  it('preserves ID whitespace and resolves only exact references', () => {
    const document = createIRScene(makeComposition({
      id: ' main ',
      layers: [
        makeLayer({ id: ' parent ' }),
        makeLayer({
          id: 'image', type: 'image', parentId: ' parent ',
          content: { assetId: ' image ' },
          localBounds: { x: 0, y: 0, width: 10, height: 10 },
        }),
      ],
    }), [{ id: ' image ', type: 'image', source: { kind: 'url', url: 'https://example.com/image.png' } }]);
    const original = structuredClone(document);

    expect(validateIRScene(document).valid).toBe(true);
    expect(document).toEqual(original);

    document.entryCompositionId = 'main';
    const layer = document.compositions[0].layers[1];

    if (layer.type !== 'image') {
      throw new Error('Expected image layer');
    }
    layer.parentId = 'parent';
    layer.content.assetId = 'image';
    expect(validateIRScene(document).errors.map(issue => issue.code)).toEqual([
      'IR_LAYER_IMAGE_ASSET_MISSING',
      'IR_LAYER_PARENT_OUT_OF_RANGE',
      'IR_SCENE_ENTRY_COMPOSITION_MISSING',
    ]);
  });

  it('keeps image, font and texture diagnostics grouped across compositions', () => {
    const document = createIRScene(makeComposition({
      layers: [
        makeLayer({
          id: 'shape', type: 'shape',
          content: { shapes: [{
            primitiveType: 'rectangle', width: { type: 'static', value: 10 }, height: { type: 'static', value: 10 },
            position: { type: 'static', value: [0, 0] },
            fills: [{ type: 'texture', assetId: 'missing-fill' }],
            strokes: [{
              paint: { type: 'texture', assetId: 'missing-stroke' },
              width: { type: 'static', value: 1 }, cap: 'butt', join: 'miter',
            }],
          }] },
        }),
        makeLayer({
          id: 'text', type: 'text',
          content: {
            text: 'A', fontAssetId: 'missing-font', color: [0, 0, 0, 1], fontSize: 12,
            letterSpacing: 0, lineHeight: 12, textAlign: 'left',
          },
        }),
      ],
    }));

    document.compositions.push(makeComposition({
      id: 'second',
      layers: [makeLayer({
        type: 'image', content: { assetId: 'missing-image' },
        localBounds: { x: 0, y: 0, width: 10, height: 10 },
      })],
    }));
    expect(validateIRScene(document).errors.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'IR_LAYER_IMAGE_ASSET_MISSING', path: 'compositions[1].layers[0].content.assetId' },
      { code: 'IR_TEXT_FONT_ASSET_MISSING', path: 'compositions[0].layers[1].content.fontAssetId' },
      { code: 'IR_SHAPE_TEXTURE_ASSET_MISSING', path: 'compositions[0].layers[0].content.shapes[0].fills[0].assetId' },
      {
        code: 'IR_SHAPE_TEXTURE_ASSET_MISSING',
        path: 'compositions[0].layers[0].content.shapes[0].strokes[0].paint.assetId',
      },
    ]);
    expect(() => assertIRScene(document)).toThrowError(/IR_LAYER_IMAGE_ASSET_MISSING/);
  });

  it('accepts URL and Embedded Image assets', () => {
    const document = makeScene([
      {
        id: 'image:absolute',
        type: 'image',
        source: { kind: 'url', url: 'https://example.com/hero.png' },
      },
      {
        id: 'image:embedded',
        type: 'image',
        source: { kind: 'embedded', mimeType: 'image/png', data: 'AQID' },
      },
    ]);

    expect(() => assertIRScene(document)).not.toThrow();
  });

  it('ignores additional Asset and resource source fields', () => {
    const document = makeScene([
      { id: 'image:hero', type: 'image', source: { kind: 'url', url: 'https://example.com/hero.png' } },
      {
        id: 'font:body',
        type: 'font',
        family: 'Inter',
        style: 'normal',
        weight: 400,
        source: { kind: 'embedded', mimeType: 'font/woff2', data: 'AQID' },
      },
    ]);
    const image = document.assets[0] as unknown as Record<string, unknown>;
    const font = document.assets[1] as unknown as Record<string, unknown>;

    image['specific'] = {};
    (image['source'] as Record<string, unknown>)['cacheKey'] = 'hero';
    font['fidelity'] = {};
    (font['source'] as Record<string, unknown>)['byteLength'] = 3;

    expect(validateIRScene(document)).toMatchObject({ valid: true, errors: [] });
  });

  it('normalizes URL, Base64, and percent-encoded data URL sources', () => {
    expect(() => createIRResourceSource('./hero.png')).toThrow(/must be absolute/);
    const resolvedUrl = resolveIRResourceUrl('./hero.png', 'https://example.com/animations/demo.json');

    expect(createIRResourceSource(resolvedUrl)).toEqual({
      kind: 'url',
      url: 'https://example.com/animations/hero.png',
    });
    expect(createIRResourceSource('data:image/png;base64,AQID')).toEqual({
      kind: 'embedded',
      mimeType: 'image/png',
      data: 'AQID',
    });
    expect(createIRResourceSource('data:application/octet-stream;base64,AB==')).toEqual({
      kind: 'embedded',
      mimeType: 'application/octet-stream',
      data: 'AA==',
    });
    expect(createIRResourceSource('data:application/octet-stream;base64,AAB=')).toEqual({
      kind: 'embedded',
      mimeType: 'application/octet-stream',
      data: 'AAA=',
    });
    expect(createIRResourceSource('DATA:application/octet-stream,%00%FF%80A')).toEqual({
      kind: 'embedded',
      mimeType: 'application/octet-stream',
      data: 'AP+AQQ==',
    });

    const svg = createIRResourceSource('data:image/svg+xml;charset=utf-8,%3Csvg%3E%E7%A6%8F%3C%2Fsvg%3E');

    expect(svg).toEqual({
      kind: 'embedded',
      mimeType: 'image/svg+xml',
      data: 'PHN2Zz7npo88L3N2Zz4=',
    });
    expect(getIRResourceSourceUrl(svg)).toBe('data:image/svg+xml;base64,PHN2Zz7npo88L3N2Zz4=');
    const document = makeScene([{ id: 'image:svg', type: 'image', source: svg }]);

    expect(validateIRScene(document)).toMatchObject({ valid: true, errors: [] });
    expect(resolveIRResourceUrl('DATA:image/png;base64,AQID')).toBe('DATA:image/png;base64,AQID');
    expect(() => createIRResourceSource('data:,')).toThrow(/must not be empty/);
    expect(() => createIRResourceSource('data:text/plain,%GG')).toThrow(/invalid percent encoding/);
  });

  it('resolves Image Layer content through the Scene Asset Registry', () => {
    const first = makeLayer({
      type: 'image',
      content: { assetId: 'image:hero' },
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const second = makeLayer({
      id: 'layer-1',
      type: 'image',
      content: { assetId: 'image:hero' },
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const document = createIRScene(makeComposition({ layers: [first, second] }), [
      { id: 'image:hero', type: 'image', source: { kind: 'url', url: 'https://example.com/hero.png' } },
    ]);

    expect(() => assertIRScene(document)).not.toThrow();
  });

  it('rejects dangling and non-Image Asset references from Image Layers', () => {
    const dangling = createIRScene(makeComposition({
      layers: [makeLayer({
        type: 'image',
        content: { assetId: 'image:missing' },
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      })],
    }));
    const fontTarget = createIRScene(makeComposition({
      layers: [makeLayer({
        type: 'image',
        content: { assetId: 'font:body' },
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      })],
    }), [{
      id: 'font:body',
      type: 'font',
      family: 'Inter',
      style: 'normal',
      weight: 400,
      source: { kind: 'system' },
    }]);

    const danglingCodes = validateIRScene(dangling).errors.map(issue => issue.code);

    expect(danglingCodes).toContain('IR_LAYER_IMAGE_ASSET_MISSING');
    expect(danglingCodes).not.toContain('IR_LAYER_IMAGE_CONTENT_INVALID');
    expect(validateIRScene(fontTarget).errors.map(issue => issue.code)).toContain(
      'IR_LAYER_IMAGE_ASSET_TYPE_INVALID',
    );
  });

  it('resolves Text Layer content through a Font Asset reference', () => {
    const document = createIRScene(makeComposition({
      layers: [makeLayer({
        type: 'text',
        content: {
          color: [0, 0, 0, 1],
          text: 'hello',
          fontAssetId: 'font:body',
          fontSize: 24,
          letterSpacing: 0,
          lineHeight: 28,
          textAlign: 'left',
        },
        localBounds: { x: 0, y: 0, width: 100, height: 28 },
      })],
    }), [{
      id: 'font:body',
      type: 'font',
      family: 'Inter',
      style: 'normal',
      weight: 400,
      source: { kind: 'url', url: 'https://example.com/Inter-Regular.woff2' },
    }]);

    expect(() => assertIRScene(document)).not.toThrow();
  });

  it('rejects dangling and non-Font Asset references from Text Layers', () => {
    const makeTextDocument = (assets: IRScene['assets']): IRScene => createIRScene(makeComposition({
      layers: [makeLayer({
        type: 'text',
        content: {
          color: [0, 0, 0, 1],
          text: 'hello',
          fontAssetId: 'font:body',
          fontSize: 24,
          letterSpacing: 0,
          lineHeight: 28,
          textAlign: 'left',
        },
        localBounds: { x: 0, y: 0, width: 100, height: 28 },
      })],
    }), assets);
    const dangling = makeTextDocument([]);
    const imageTarget = makeTextDocument([
      { id: 'font:body', type: 'image', source: { kind: 'url', url: 'https://example.com/hero.png' } },
    ]);

    expect(validateIRScene(dangling).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'IR_TEXT_FONT_ASSET_MISSING',
        path: 'compositions[0].layers[0].content.fontAssetId',
      }),
    ]));
    expect(validateIRScene(imageTarget).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'IR_TEXT_FONT_ASSET_TYPE_INVALID',
        path: 'compositions[0].layers[0].content.fontAssetId',
      }),
    ]));
  });

  it('accepts URL or Embedded Font assets without portability warnings', () => {
    const document = makeScene([
      {
        id: 'font:url',
        type: 'font',
        family: 'Inter',
        style: 'normal',
        weight: 400,
        source: { kind: 'url', url: 'https://example.com/Inter-Regular.woff2' },
      },
      {
        id: 'font:embedded',
        type: 'font',
        family: 'Inter',
        style: 'italic',
        weight: 700,
        source: { kind: 'embedded', mimeType: 'font/woff2', data: 'AQID' },
      },
    ]);

    expect(() => assertIRScene(document)).not.toThrow();
  });

  it('accepts a System Font source with a portability warning', () => {
    const document = makeScene([
      {
        id: 'font:system',
        type: 'font',
        family: 'PingFang SC',
        style: 'normal',
        weight: 400,
        source: { kind: 'system' },
      },
    ]);
    const result = validateIRScene(document);

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'IR_ASSET_FONT_SYSTEM_PORTABILITY',
        path: 'assets[0].source',
        message: 'System Font availability and metrics may differ between consumer environments',
      },
    ]);
  });

  it('requires assets on every IRScene', () => {
    const document = makeScene() as unknown as Record<string, unknown>;

    delete document['assets'];

    expect(validateIRScene(document).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IR_SCENE_ASSETS_INVALID', path: 'assets' }),
      ]),
    );
  });

  it('allows distinct Asset IDs to use the same URL without implicit merging', () => {
    const document = makeScene([
      { id: 'image:first', type: 'image', source: { kind: 'url', url: 'https://example.com/shared.png' } },
      { id: 'image:second', type: 'image', source: { kind: 'url', url: 'https://example.com/shared.png' } },
    ]);

    expect(() => assertIRScene(document)).not.toThrow();
    expect(document.assets).toHaveLength(2);
  });

  it('rejects duplicate Asset IDs', () => {
    const document = makeScene([
      { id: 'image:duplicate', type: 'image', source: { kind: 'url', url: 'https://example.com/first.png' } },
      {
        id: 'image:duplicate',
        type: 'font',
        family: 'Inter',
        style: 'normal',
        weight: 400,
        source: { kind: 'url', url: 'https://example.com/Inter-Regular.woff2' },
      },
    ]);

    expect(validateIRScene(document).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'IR_ASSET_ID_DUPLICATE', path: 'assets[1].id' }),
      ]),
    );
  });

  it.each([
    {
      name: 'non-object Asset',
      asset: null,
      code: 'IR_ASSET_INVALID',
      path: 'assets[0]',
    },
    {
      name: 'empty ID',
      asset: { id: '', type: 'image', source: { kind: 'url', url: 'https://example.com/image.png' } },
      code: 'IR_ASSET_ID_INVALID',
      path: 'assets[0].id',
    },
    {
      name: 'unsupported type',
      asset: { id: 'audio:track', type: 'audio', source: { kind: 'url', url: 'https://example.com/track.mp3' } },
      code: 'IR_ASSET_TYPE_INVALID',
      path: 'assets[0].type',
    },
    {
      name: 'System Font source on an Image',
      asset: { id: 'image:system', type: 'image', source: { kind: 'system' } },
      code: 'IR_ASSET_SOURCE_INVALID',
      path: 'assets[0].source.kind',
    },
    {
      name: 'missing source',
      asset: { id: 'image:missing', type: 'image' },
      code: 'IR_ASSET_SOURCE_INVALID',
      path: 'assets[0].source',
    },
    {
      name: 'data URL source',
      asset: { id: 'image:data-url', type: 'image', source: { kind: 'url', url: 'data:image/png;base64,AQID' } },
      code: 'IR_ASSET_SOURCE_INVALID',
      path: 'assets[0].source.url',
    },
    {
      name: 'relative URL source',
      asset: { id: 'image:relative', type: 'image', source: { kind: 'url', url: './image.png' } },
      code: 'IR_ASSET_SOURCE_INVALID',
      path: 'assets[0].source.url',
    },
    {
      name: 'missing Embedded MIME type',
      asset: {
        id: 'image:embedded-mime',
        type: 'image',
        source: { kind: 'embedded', data: 'AQID' },
      },
      code: 'IR_ASSET_MIME_TYPE_INVALID',
      path: 'assets[0].source.mimeType',
    },
    {
      name: 'invalid Base64',
      asset: {
        id: 'image:base64',
        type: 'image',
        source: { kind: 'embedded', mimeType: 'image/png', data: 'data:image/png;base64,AQID' },
      },
      code: 'IR_ASSET_DATA_INVALID',
      path: 'assets[0].source.data',
    },
    {
      name: 'Base64 containing whitespace',
      asset: {
        id: 'image:base64-whitespace',
        type: 'image',
        source: { kind: 'embedded', mimeType: 'image/png', data: 'AQ ID' },
      },
      code: 'IR_ASSET_DATA_INVALID',
      path: 'assets[0].source.data',
    },
    {
      name: 'Base64 with non-zero padding bits before double padding',
      asset: {
        id: 'image:base64-padding-bits',
        type: 'image',
        source: { kind: 'embedded', mimeType: 'image/png', data: 'AB==' },
      },
      code: 'IR_ASSET_DATA_INVALID',
      path: 'assets[0].source.data',
    },
    {
      name: 'Base64 with non-zero padding bits before single padding',
      asset: {
        id: 'image:base64-padding-bits',
        type: 'image',
        source: { kind: 'embedded', mimeType: 'image/png', data: 'AAB=' },
      },
      code: 'IR_ASSET_DATA_INVALID',
      path: 'assets[0].source.data',
    },
    {
      name: 'empty Font family',
      asset: {
        id: 'font:family',
        type: 'font',
        family: '  ',
        style: 'normal',
        weight: 400,
        source: { kind: 'system' },
      },
      code: 'IR_ASSET_FONT_FAMILY_INVALID',
      path: 'assets[0].family',
    },
    {
      name: 'invalid Font style',
      asset: {
        id: 'font:style',
        type: 'font',
        family: 'Inter',
        style: 'roman',
        weight: 400,
        source: { kind: 'system' },
      },
      code: 'IR_ASSET_FONT_STYLE_INVALID',
      path: 'assets[0].style',
    },
    ...[0, 1001, 400.5].map(weight => ({
      name: `invalid Font weight ${weight}`,
      asset: {
        id: `font:weight-${weight}`,
        type: 'font',
        family: 'Inter',
        style: 'normal',
        weight,
        source: { kind: 'system' },
      },
      code: 'IR_ASSET_FONT_WEIGHT_INVALID',
      path: 'assets[0].weight',
    })),
  ])('rejects $name', ({ asset, code, path }) => {
    const result = validateIRScene(makeScene([asset as never]));

    expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code, path })]));
  });
});

import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IRMatteMode } from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';
import { convertLottieToIR } from '@galacean/lottie2ir';
import type { LottieJSON } from '@galacean/lottie2ir';
import { convertLottieToGE } from '../helpers/convert-lottie-to-ge';

function createBasicLottie(imagePath: string): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    ip: 0,
    op: 24,
    w: 100,
    h: 100,
    nm: 'zip-file-test',
    layers: [
      {
        ty: 2,
        nm: 'img',
        ind: 1,
        ip: 0,
        op: 24,
        st: 0,
        ks: {
          a: { a: 0, k: [50, 50, 0] },
          p: { a: 0, k: [50, 50, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
        refId: 'img_0',
        w: 100,
        h: 100,
      },
    ],
    assets: [
      {
        id: 'img_0',
        w: 100,
        h: 100,
        u: 'https://example.com/images/',
        p: path.basename(imagePath),
        e: 0,
      },
    ],
  } as unknown as LottieJSON;
}

function createTextLottie(fontPath: string): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    ip: 0,
    op: 24,
    w: 200,
    h: 100,
    nm: 'zip-font-test',
    assets: [],
    fonts: {
      list: [{ fName: 'ZipFont', fFamily: 'Zip Font', fStyle: 'Regular', fPath: fontPath }],
    },
    layers: [{
      ty: 5,
      nm: 'text',
      ind: 1,
      ip: 0,
      op: 24,
      st: 0,
      ks: {
        a: { a: 0, k: [0, 0, 0] },
        p: { a: 0, k: [100, 50, 0] },
        s: { a: 0, k: [100, 100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
      t: {
        d: {
          k: [{ s: { t: 'Hello', f: 'ZipFont', s: 24, fc: [1, 1, 1], j: 0, sz: [160, 40] } }],
        },
      },
    }],
  } as unknown as LottieJSON;
}

function createPrecompLottie(stretchRatio: unknown): LottieJSON {
  const transform = {
    a: { a: 0, k: [0, 0, 0] },
    p: { a: 0, k: [50, 50, 0] },
    s: { a: 0, k: [100, 100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  };

  return {
    v: '5.7.0',
    fr: 24,
    ip: 0,
    op: 24,
    w: 100,
    h: 100,
    nm: 'invalid-precomp-stretch-test',
    layers: [
      {
        ty: 0,
        nm: 'precomp-invalid-sr',
        ind: 1,
        ip: 0,
        op: 24,
        st: 0,
        sr: stretchRatio,
        ks: transform,
        refId: 'precomp_0',
        w: 100,
        h: 100,
      },
    ],
    assets: [
      {
        id: 'precomp_0',
        layers: [
          {
            ty: 2,
            nm: 'precomp-child-image',
            ind: 2,
            ip: 0,
            op: 24,
            st: 0,
            ks: transform,
            refId: 'img_0',
            w: 100,
            h: 100,
          },
        ],
      },
      {
        id: 'img_0',
        w: 100,
        h: 100,
        u: '',
        p: 'data:image/png;base64,stretch',
        e: 1,
      },
    ],
  } as unknown as LottieJSON;
}

describe('lottie2ir and ge-ir composition behavior', () => {
  it('composes ordered authored masks with Precomp clipping through the public IR APIs', () => {
    const input = readFileSync(new URL('../fixtures/multi-mask-precomp.json', import.meta.url), 'utf8');
    const imported = convertLottieToIR(input);
    const layer = getIRSceneEntryComposition(imported.scene).layers[0];

    expect(imported.diagnostics).toEqual([]);
    expect(layer.masks?.map(mask => mask.mode)).toEqual(['add', 'subtract']);
    expect(layer).not.toHaveProperty('mask');
    const exported = convertIRToGE(imported.scene);
    const components = exported.scene.components as unknown as Array<Record<string, unknown>>;
    const target = components.find(component => component['dataType'] === 'SpriteComponent' && component['mask'] != null);
    const mask = target?.['mask'] as { references: Array<{ mask: { id: string }; inverted: boolean }> };

    expect(exported.diagnostics).toEqual([]);
    expect(mask).not.toHaveProperty('reference');
    expect(mask.references).toHaveLength(2);
    expect(mask.references.map(reference => reference.inverted)).toEqual(expect.arrayContaining([false, true]));
    for (const reference of mask.references) {
      expect(components.find(component => component['id'] === reference.mask.id)?.['mask']).toMatchObject({ isMask: true });
    }
  });

  it('supports passing options as second argument', async () => {
    const lottie = createBasicLottie('images/pic.png');

    const result = await convertLottieToGE(lottie, {});

    expect(result.scene.type).toBe('ge');
    expect(result.diagnostics).toEqual([]);
  });

  it('requires an explicit base URL for relative Lottie resources', async () => {
    const lottie = createBasicLottie('images/pic.png');
    const asset = lottie.assets?.[0] as unknown as Record<string, unknown> | undefined;

    if (asset == null) {
      throw new Error('expected image asset');
    }
    asset['u'] = 'images/';

    await expect(convertLottieToGE(lottie)).rejects.toThrow(/must be absolute/);
    const result = await convertLottieToGE(lottie, {
      resourceBaseUrl: 'https://cdn.example.com/animations/demo/data.json',
    });

    expect(result.scene.images[0]?.url).toBe('https://cdn.example.com/animations/demo/images/pic.png');
  });

  it('remaps an image URL using ZIP resources', async () => {
    const lottie = createBasicLottie('images/pic.png');
    const dataUrl = 'data:image/png;base64,ZmFrZQ==';
    const asset = lottie.assets?.[0] as unknown as Record<string, unknown> | undefined;

    if (asset == null) {
      throw new Error('expected image asset');
    }
    asset['u'] = 'images/';

    const result = await convertLottieToGE(lottie, {
      zipResources: {
        dirPath: 'anim',
        resources: { 'anim/images/pic.png': dataUrl },
      },
    });

    expect(result.scene.images).toHaveLength(1);
    expect(result.scene.images[0].url).toBe(dataUrl);
  });

  it('resolves a relative font path from ZIP resource data urls', async () => {
    const fontDataUrl = 'data:font/woff2;base64,ZmFrZQ==';
    const result = await convertLottieToGE(createTextLottie('fonts/zip-font.woff2'), {
      zipResources: {
        dirPath: 'anim',
        resources: { 'anim/fonts/zip-font.woff2': fontDataUrl },
      },
    });

    expect(result.scene.type).toBe('ge');
    expect(result.diagnostics).toEqual([]);
  });

  it('supports shadow parity option with st/sr/tm layer', async () => {
    const json = {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 48,
      w: 100,
      h: 100,
      nm: 'shadow-parity-time-context',
      layers: [
        {
          ty: 2,
          nm: 'img-time',
          ind: 7,
          ip: 0,
          op: 48,
          st: 3,
          sr: 0.75,
          tm: { a: 1, k: [{ t: 0, s: [0], e: [24] }] },
          ks: {
            a: { a: 0, k: [50, 50, 0] },
            p: { a: 0, k: [50, 50, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          refId: 'img_0',
          w: 100,
          h: 100,
        },
      ],
      assets: [{ id: 'img_0', w: 100, h: 100, p: 'data:image/png;base64,time', u: '', e: 1 }],
    };

    const result = await convertLottieToGE(json as unknown as LottieJSON);

    expect(result.scene.type).toBe('ge');
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    { label: 'zero', value: 0 },
    { label: 'negative', value: -1 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    { label: 'non-number', value: '2' },
  ])('falls back invalid precomp stretch ratio $label before lowering', async ({ value }) => {
    const result = await convertLottieToGE(createPrecompLottie(value));
    const diagnostic = result.diagnostics.find(item => item.code === 'LOTTIE_INVALID_STRETCH_RATIO');

    expect(result.scene.type).toBe('ge');
    expect(diagnostic).toMatchObject({
      code: 'LOTTIE_INVALID_STRETCH_RATIO',
      severity: 'warning',
      action: 'approximated',
      sourceId: '1',
      feature: 'invalid-stretch-ratio',
    });
    expect(diagnostic?.message).toContain('precomp-invalid-sr');
  });

  it('keeps a finite positive precomp stretch ratio without warnings', async () => {
    const result = await convertLottieToGE(createPrecompLottie(2));

    expect(result.scene.type).toBe('ge');
    expect(result.diagnostics.some(item => item.code === 'LOTTIE_INVALID_STRETCH_RATIO')).toBe(false);
  });

  it('returns a structured diagnostic for an unsupported layer type', async () => {
    const json = {
      v: '5.7.0',
      fr: 24,
      w: 100,
      h: 100,
      ip: 0,
      op: 24,
      nm: 'unsupported-case',
      assets: [],
      layers: [
        {
          ty: 99,
          nm: 'unsupported-layer',
          ind: 1,
          ip: 0,
          op: 24,
          st: 0,
          ks: {
            a: { a: 0, k: [0, 0, 0] },
            p: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        },
      ],
    };

    const result = await convertLottieToGE(json as unknown as LottieJSON);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'LOTTIE_UNSUPPORTED_LAYER_TYPE',
      severity: 'warning',
      action: 'unsupported',
      sourceId: '1',
      feature: 'unsupported-layer-type',
    });
    expect(result.diagnostics[0].message).toContain('unsupported-layer');
  });

  it('reports unsupported and empty explicit masks instead of silently dropping them', async () => {
    const lottie = createBasicLottie('images/pic.png');
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;

    layer['hasMask'] = true;
    layer['masksProperties'] = [
      {
        mode: 's',
        inv: true,
        pt: { a: 0, k: { c: true, v: [], i: [], o: [] } },
      },
    ];

    const result = await convertLottieToGE(lottie);
    const diagnostic = result.diagnostics.find(item => item.code === 'LOTTIE_UNSUPPORTED_MASK');

    expect(result.scene.type).toBe('ge');
    expect(diagnostic).toMatchObject({
      code: 'LOTTIE_UNSUPPORTED_MASK',
      severity: 'warning',
      action: 'dropped',
      sourceId: '1',
      feature: 'empty-mask-path',
    });
    expect(diagnostic?.message).toContain("Layer 'img'");
  });

  it('reimports a lowered Lottie Mask as a Shape Layer matte without preserved mask data', async () => {
    const lottie = createBasicLottie('images/pic.png');
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;

    layer['hasMask'] = true;
    layer['masksProperties'] = [{
      mode: 's',
      inv: false,
      pt: {
        a: 0,
        k: {
          c: true,
          v: [[10, 10], [90, 10], [90, 90], [10, 90]],
          i: [[0, 0], [0, 0], [0, 0], [0, 0]],
          o: [[0, 0], [0, 0], [0, 0], [0, 0]],
        },
      },
    }];

    const result = await convertLottieToGE(lottie);

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'LOTTIE_UNSUPPORTED_MASK' }));
    const imported = convertGEToIR(result.scene as unknown as Record<string, unknown>, { frameRate: 24 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const targetLayer = composition.layers.find(candidate => candidate.name === 'img');
    const sourceLayer = composition.layers.find(candidate => candidate.id === targetLayer?.matte?.sourceLayerId);
    const targetLayerData = targetLayer == null
      ? undefined
      : imported.preservedData.compositionBindings[composition.id]?.layerDataById[targetLayer.id];
    const sourceLayerData = sourceLayer == null
      ? undefined
      : imported.preservedData.compositionBindings[composition.id]?.layerDataById[sourceLayer.id];

    expect(composition.layers).toHaveLength(2);
    expect(sourceLayer?.type).toBe('shape');
    expect(targetLayer?.masks).toBeUndefined();
    expect(targetLayer?.matte).toEqual({
      sourceLayerId: sourceLayer?.id,
      mode: IRMatteMode.Geometry,
      inverted: true,
    });
    expect(targetLayerData?.mask).toBeUndefined();
    expect(sourceLayerData?.mask).toBeUndefined();
  });

  it('converts an inverted alpha track matte into a GE Sprite mask relationship', async () => {
    const lottie = createBasicLottie('images/pic.png');
    const consumer = lottie.layers[0] as unknown as Record<string, unknown>;
    const source = JSON.parse(JSON.stringify(consumer)) as Record<string, unknown>;

    consumer['nm'] = 'matte-consumer';
    consumer['ind'] = 1;
    consumer['tt'] = 2;
    consumer['tp'] = 2;
    source['nm'] = 'matte-source';
    source['ind'] = 2;
    source['td'] = 1;
    (lottie as unknown as Record<string, unknown>)['layers'] = [consumer, source];

    const result = await convertLottieToGE(lottie);
    const components = result.scene.components as unknown as Array<Record<string, unknown>>;
    const maskSource = components.find(component =>
      (component['mask'] as Record<string, unknown> | undefined)?.['isMask'] === true,
    );
    const maskTarget = components.find(component =>
      (component['mask'] as Record<string, unknown> | undefined)?.['isMask'] === false,
    );

    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'LOTTIE_UNSUPPORTED_TRACK_MATTE' }),
    );
    expect(maskSource?.['mask']).toEqual({ isMask: true, alphaMaskEnabled: true });
    expect(maskTarget?.['mask']).toEqual({
      isMask: false,
      references: [{ mask: { id: maskSource?.['id'] }, inverted: true }],
    });

    const imported = convertGEToIR(result.scene as unknown as Record<string, unknown>, { frameRate: 24 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const importedSource = composition.layers.find(layer => layer.name === 'matte-source');
    const importedTarget = composition.layers.find(layer => layer.name === 'matte-consumer');

    expect(importedTarget?.matte).toEqual({
      sourceLayerId: importedSource?.id,
      mode: IRMatteMode.Alpha,
      inverted: true,
    });
  });

  it('reports a luminance track matte that GE cannot lower', async () => {
    const lottie = createBasicLottie('images/pic.png');
    const consumer = lottie.layers[0] as unknown as Record<string, unknown>;
    const source = JSON.parse(JSON.stringify(consumer)) as Record<string, unknown>;

    consumer['nm'] = 'luma-consumer';
    consumer['ind'] = 1;
    consumer['tt'] = 4;
    consumer['tp'] = 2;
    source['nm'] = 'luma-source';
    source['ind'] = 2;
    source['td'] = 1;
    (lottie as unknown as Record<string, unknown>)['layers'] = [consumer, source];

    const result = await convertLottieToGE(lottie);

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_MATTE_MODE_UNSUPPORTED',
      feature: 'luminance-matte',
    }));
  });

  it('reports unsupported shape modifiers as structured diagnostics', async () => {
    const json = {
      v: '5.7.0',
      fr: 24,
      w: 100,
      h: 100,
      ip: 0,
      op: 24,
      nm: 'shape-ir-warning-case',
      assets: [],
      layers: [
        {
          ty: 4,
          nm: 'shape-with-modifier',
          ind: 9,
          ip: 0,
          op: 24,
          st: 0,
          ks: {
            a: { a: 0, k: [0, 0, 0] },
            p: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            {
              ty: 'gr',
              it: [
                { ty: 'tm', s: { k: 0 }, e: { k: 100 }, o: { k: 0 } },
                {
                  ty: 'rp',
                  c: { k: 3 },
                  o: { k: 0 },
                  tr: { p: { k: [0, 0] }, a: { k: [0, 0] }, s: { k: [100, 100] }, r: { k: 0 } },
                },
                { ty: 'mm', mm: 1 },
                { ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 80] }, r: { k: 8 } },
                { ty: 'fl', c: { k: [0, 0, 1, 1] }, o: { k: 100 }, r: 2 },
                { ty: 'st', c: { k: [1, 1, 1, 1] }, o: { k: 100 }, w: { k: 2 } },
                { ty: 'fl', c: { k: [1, 0, 0, 1] }, o: { k: 100 }, r: 1 },
                {
                  ty: 'tr',
                  p: { k: [0, 0] },
                  s: { k: [100, 100] },
                  r: { k: 0 },
                  o: { k: 100 },
                  a: { k: [0, 0] },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await convertLottieToGE(json as unknown as LottieJSON);
    const parserDiagnostic = result.diagnostics.find(
      diagnostic => diagnostic.code === 'LOTTIE_UNSUPPORTED_SHAPE_FEATURE',
    );

    expect(parserDiagnostic).toMatchObject({
      severity: 'warning',
      action: 'dropped',
      sourceId: expect.any(String),
      feature: 'fill-rule,mm,paint-order,rp,tm',
    });
  });

  it('reports trim-path and repeater as unsupported regardless of animation', async () => {
    const json = {
      v: '5.7.0',
      fr: 24,
      w: 100,
      h: 100,
      ip: 0,
      op: 24,
      nm: 'shape-animated-fallback-ir-warning-case',
      assets: [],
      layers: [
        {
          ty: 4,
          nm: 'shape-with-animated-modifier',
          ind: 10,
          ip: 0,
          op: 24,
          st: 0,
          ks: {
            a: { a: 0, k: [0, 0, 0] },
            p: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [
            {
              ty: 'gr',
              it: [
                {
                  ty: 'tm',
                  s: { a: 1, k: [{ t: 0, s: [0], e: [100] }] },
                  e: { k: 100 },
                  o: { k: 0 },
                },
                {
                  ty: 'rp',
                  c: { k: 3 },
                  o: { k: 0 },
                  tr: {
                    p: { k: [0, 0] },
                    a: { k: [0, 0] },
                    s: { a: 1, k: [{ t: 0, s: [100, 100], e: [80, 80] }] },
                    r: { k: 0 },
                  },
                },
                { ty: 'rc', p: { k: [0, 0] }, s: { k: [100, 80] }, r: { k: 8 } },
                { ty: 'fl', c: { k: [0, 0, 1, 1] }, o: { k: 100 } },
                {
                  ty: 'tr',
                  p: { k: [0, 0] },
                  s: { k: [100, 100] },
                  r: { k: 0 },
                  o: { k: 100 },
                  a: { k: [0, 0] },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await convertLottieToGE(json as unknown as LottieJSON);

    const parserDiagnostic = result.diagnostics.find(
      diagnostic => diagnostic.code === 'LOTTIE_UNSUPPORTED_SHAPE_FEATURE',
    );

    expect(parserDiagnostic).toMatchObject({
      severity: 'warning',
      action: 'dropped',
      sourceId: expect.any(String),
      feature: 'rp,tm',
    });
  });

});

import { describe, expect, it } from 'vitest';
import { ItemType } from '@galacean/effects-specification';
import { IREndBehavior, type IRComposition, type IRPrecompLayer } from '@galacean/animation-ir';
import { getIRSceneEntryComposition, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';
import { assertIRScene, validateIRScene } from '@galacean/animation-ir/validator';
import { convertLottieToIR } from '@galacean/lottie2ir';
import type { LottieJSON } from '@galacean/lottie2ir';
import { assembleLottieIRScene } from '../../src/assemble-ir-scene';
import { convertLottieToGE } from '../helpers/convert-lottie-to-ge';

function assembleTestLottie(
  json: Parameters<typeof assembleLottieIRScene>[0],
  options?: Parameters<typeof assembleLottieIRScene>[1],
): ReturnType<typeof assembleLottieIRScene> {
  return assembleLottieIRScene(json, {
    resolveResourceUrl: url => resolveIRResourceUrl(url, 'https://example.com/animations/data.json'),
    ...(options ?? {}),
  });
}

function getAssembledComposition(result: ReturnType<typeof assembleLottieIRScene>): IRComposition {
  return getIRSceneEntryComposition(result.scene);
}

function baseTransform() {
  return {
    a: { a: 0, k: [0, 0, 0] },
    p: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  };
}

function buildMinimalImageLottie(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    w: 100,
    h: 120,
    ip: 0,
    op: 48,
    nm: 'assemble-ir-case',
    assets: [
      {
        id: 'img_0',
        w: 100,
        h: 120,
        u: '',
        p: 'data:image/png;base64,iVBORw==',
        e: 1,
      },
    ],
    layers: [
      {
        ty: 2,
        nm: 'img-layer',
        ind: 1,
        ip: 0,
        op: 48,
        st: 0,
        refId: 'img_0',
        w: 80,
        h: 60,
        ks: {
          a: { a: 0, k: [50, 60, 0] },
          p: { a: 0, k: [50, 60, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      },
    ],
  } as unknown as LottieJSON;
}

function buildTimeContextLottie(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    w: 120,
    h: 120,
    ip: 0,
    op: 72,
    nm: 'layer-time-context-case',
    assets: [
      {
        id: 'img_0',
        w: 120,
        h: 120,
        u: '',
        p: 'data:image/png;base64,time',
        e: 1,
      },
    ],
    layers: [
      {
        ty: 2,
        nm: 'img-time-layer',
        ind: 9,
        ip: 10,
        op: 70,
        st: 5,
        sr: 0.5,
        tm: { a: 1, k: [{ t: 0, s: [0], e: [12] }] },
        refId: 'img_0',
        w: 120,
        h: 120,
        ks: {
          a: { a: 0, k: [60, 60, 0] },
          p: { a: 0, k: [60, 60, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      },
    ],
  } as unknown as LottieJSON;
}

function buildPrecompOpacityOffsetLottie(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 60,
    w: 1080,
    h: 260,
    ip: 0,
    op: 300,
    nm: 'precomp-opacity-offset-case',
    layers: [
      {
        ty: 0,
        nm: '图书',
        ind: 8,
        refId: 'asset-precomp',
        ip: 117,
        op: 300,
        st: 110,
        ks: {
          ...baseTransform(),
          o: {
            a: 1,
            k: [
              { t: 237, s: [100], e: [0] },
              { t: 246, s: [0] },
            ],
          },
        },
      },
    ],
    assets: [
      {
        id: 'asset-precomp',
        w: 1080,
        h: 260,
        layers: [
          {
            ty: 2,
            nm: '汽车.png',
            ind: 1,
            refId: 'asset-car',
            ip: 0,
            op: 300,
            st: 0,
            ks: baseTransform(),
          },
        ],
      },
      { id: 'asset-car', p: 'car.png', w: 120, h: 80 },
    ],
  } as unknown as LottieJSON;
}

function buildPrecompWithNegativeHelperInPoint(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    w: 100,
    h: 100,
    ip: 0,
    op: 48,
    nm: 'negative-precomp-child-in-point-case',
    layers: [{
      ty: 0,
      nm: 'precomp-instance',
      ind: 1,
      refId: 'asset-precomp',
      ip: 0,
      op: 48,
      st: 0,
      w: 100,
      h: 100,
      ks: baseTransform(),
    }],
    assets: [
      {
        id: 'asset-precomp',
        w: 100,
        h: 100,
        layers: [
          {
            ty: 3,
            nm: 'negative-helper',
            ind: 1,
            ip: -23,
            op: 48,
            st: -23,
            ks: baseTransform(),
          },
          {
            ty: 2,
            nm: 'visible-from-source-frame-zero',
            ind: 2,
            refId: 'asset-image',
            ip: 0,
            op: 48,
            st: 0,
            w: 40,
            h: 40,
            ks: baseTransform(),
          },
        ],
      },
      { id: 'asset-image', p: 'image.png', w: 40, h: 40 },
    ],
  } as unknown as LottieJSON;
}

function buildMinimalSolidLottie(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    w: 100,
    h: 100,
    ip: 0,
    op: 24,
    nm: 'solid-ir-case',
    assets: [],
    layers: [
      {
        ty: 1,
        nm: 'solid-layer',
        ind: 3,
        ip: 0,
        op: 24,
        st: 0,
        sw: 80,
        sh: 40,
        sc: '#336699',
        ks: {
          a: { a: 0, k: [40, 20, 0] },
          p: { a: 0, k: [50, 60, 0] },
          s: { a: 0, k: [100, 50, 100] },
          r: { a: 0, k: 15 },
          o: { a: 0, k: 75 },
        },
      },
    ],
  } as unknown as LottieJSON;
}

function buildMinimalTextLottie(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    w: 200,
    h: 100,
    ip: 0,
    op: 24,
    nm: 'text-ir-case',
    assets: [],
    layers: [{
      ty: 5,
      nm: 'text-layer',
      ind: 4,
      ip: 0,
      op: 24,
      st: 0,
      ks: baseTransform(),
      t: {
        d: {
          k: [{ s: { t: 'Hello', f: 'Arial', s: 24, fc: [1, 0, 0], j: 0, sz: [160, 40] } }],
        },
      },
    }],
  } as unknown as LottieJSON;
}

function buildOverlappingSolidLottie(): LottieJSON {
  const lottie = buildMinimalSolidLottie();
  const sourceLayer = lottie.layers[0] as unknown as { ks: Record<string, unknown> };
  const topRedLayer = {
    ...structuredClone(lottie.layers[0]),
    nm: 'top-red',
    ind: 1,
    sw: 100,
    sh: 100,
    sc: '#ff0000',
    ks: {
      ...structuredClone(sourceLayer.ks),
      a: { a: 0, k: [50, 50, 0] },
      p: { a: 0, k: [50, 50, 0] },
      s: { a: 0, k: [100, 100, 100] },
      r: { a: 0, k: 0 },
      o: { a: 0, k: 100 },
    },
  };
  const bottomBlueLayer = {
    ...structuredClone(topRedLayer),
    nm: 'bottom-blue',
    ind: 2,
    sc: '#0000ff',
  };

  lottie.layers = [topRedLayer, bottomBlueLayer] as LottieJSON['layers'];

  return lottie;
}

function buildMinimalShapeLottie(): LottieJSON {
  return {
    v: '5.7.0',
    fr: 24,
    w: 100,
    h: 100,
    ip: 0,
    op: 24,
    nm: 'shape-ir-case',
    assets: [],
    layers: [
      {
        ty: 4,
        nm: 'shape-layer',
        ind: 4,
        ip: 0,
        op: 24,
        st: 0,
        w: 80,
        h: 60,
        ks: {
          a: { a: 0, k: [0, 0, 0] },
          p: { a: 0, k: [50, 50, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
        shapes: [
          {
            ty: 'gr',
            it: [
              { ty: 'rc', p: { k: [0, 0] }, s: { k: [40, 20] }, r: { k: 0 } },
              { ty: 'fl', c: { k: [1, 0, 0, 1] }, o: { k: 100 } },
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
  } as unknown as LottieJSON;
}

function buildParentLinkAfterLayerWithoutIndLottie(): LottieJSON {
  const ks = {
    a: { a: 0, k: [0, 0, 0] },
    p: { a: 0, k: [50, 50, 0] },
    s: { a: 0, k: [100, 100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  };

  return {
    v: '5.7.0',
    fr: 24,
    w: 100,
    h: 100,
    ip: 0,
    op: 24,
    nm: 'parent-link-case',
    assets: [],
    layers: [
      {
        ty: 1,
        nm: 'layer-without-ind',
        ip: 0,
        op: 24,
        st: 0,
        sw: 10,
        sh: 10,
        sc: '#ffffff',
        ks,
      },
      {
        ty: 3,
        nm: 'parent-null',
        ind: 10,
        ip: 0,
        op: 24,
        st: 0,
        ks,
      },
      {
        ty: 1,
        nm: 'child-solid',
        ind: 20,
        parent: 10,
        ip: 0,
        op: 24,
        st: 0,
        sw: 10,
        sh: 10,
        sc: '#ff0000',
        ks,
      },
    ],
  } as unknown as LottieJSON;
}

describe('assembleLottieIRScene', () => {
  it('returns structured diagnostics and preserves omitted source names', async () => {
    const lottie = buildMinimalImageLottie();
    const sourceLayer = lottie.layers[0] as unknown as Record<string, unknown>;

    delete (lottie as unknown as Record<string, unknown>)['nm'];
    delete sourceLayer['nm'];

    const result = assembleTestLottie(lottie);
    const composition = getAssembledComposition(result);

    expect(result.diagnostics).toEqual([]);
    expect(Object.hasOwn(composition, 'name')).toBe(false);
    expect(Object.hasOwn(composition.layers[0], 'name')).toBe(false);
  });

  it('assigns fresh IR UUIDs while preserving source layer order semantics', async () => {
    const original = buildMinimalImageLottie();
    const firstLayer = original.layers[0];
    const secondLayer = {
      ...structuredClone(firstLayer),
      nm: 'second-image-layer',
      refId: 'img_1',
    };

    original.assets?.push({ id: 'img_1', w: 100, h: 120, p: 'second.png', u: '' });
    original.layers = [firstLayer, secondLayer] as LottieJSON['layers'];

    const repeated = assembleTestLottie(structuredClone(original));
    const reorderedInput = structuredClone(original);

    reorderedInput.layers.reverse();

    const reordered = assembleTestLottie(reorderedInput);
    const first = assembleTestLottie(structuredClone(original));

    expect(first.scene).toMatchObject({
      format: 'animation-ir',
      schemaVersion: '1.0.0',
    });
    expect(first.scene.entryCompositionId).toBe(getAssembledComposition(first).id);
    expect(first.scene.assets.map(asset => asset.id)).toEqual(['img_0', 'img_1']);
    expect(first.scene.compositions).toHaveLength(1);
    expect(getAssembledComposition(first).id).toMatch(/^[0-9a-f]{32}$/);
    expect(getAssembledComposition(repeated).id).not.toBe(getAssembledComposition(first).id);
    expect(getAssembledComposition(reordered).id).not.toBe(getAssembledComposition(first).id);
    expect(getAssembledComposition(first).layers.every(layer => /^[0-9a-f]{32}$/.test(layer.id))).toBe(true);
    expect(new Set(getAssembledComposition(first).layers.map(layer => layer.id)).size).toBe(2);
    expect(getAssembledComposition(first).layers.every(layer => !Object.hasOwn(layer, 'index'))).toBe(true);
    expect(getAssembledComposition(first).layers.map(layer => layer.name)).toEqual(['second-image-layer', 'img-layer']);
    expect(getAssembledComposition(reordered).layers.map(layer => layer.name)).toEqual(['img-layer', 'second-image-layer']);
  });

  it('keeps an opaque Lottie image source id consistent through the import registry', async () => {
    const lottie = buildMinimalImageLottie();
    const asset = lottie.assets?.[0];
    const layer = lottie.layers[0];

    if (asset == null || layer == null) {
      throw new Error('test fixture is incomplete');
    }
    asset.id = 'image/中文';
    (layer as unknown as Record<string, unknown>)['refId'] = asset.id;
    const result = assembleTestLottie(lottie);
    const imageAsset = result.scene.assets.find(candidate => candidate.type === 'image');
    const imageLayer = getAssembledComposition(result).layers.find(candidate => candidate.type === 'image');

    expect(imageAsset?.id).toBe(asset.id);
    expect(imageLayer?.type === 'image' ? imageLayer.content.assetId : undefined).toBe(imageAsset?.id);
    expect(() => assertIRScene(result.scene)).not.toThrow();
  });

  it('converts Lottie top-first layers to IR and GE back-to-front painter order', async () => {
    const lottie = buildOverlappingSolidLottie();
    const assemblyResult = assembleTestLottie(structuredClone(lottie));

    expect(getAssembledComposition(assemblyResult).layers.map(layer => layer.name)).toEqual(['bottom-blue', 'top-red']);
    expect(getAssembledComposition(assemblyResult).layers.map(layer => layer.type === 'solid' ? layer.content.color : undefined))
      .toEqual([
      [0, 0, 1, 1],
      [1, 0, 0, 1],
      ]);

    const converted = await convertLottieToGE(structuredClone(lottie));
    const scene = converted.scene as unknown as Record<string, unknown>;
    const components = scene['components'] as Array<Record<string, unknown>>;
    const items = scene['items'] as Array<Record<string, unknown>>;
    const itemIds = converted.scene.compositions[0].children!.map(item => item.id);
    const itemById = new Map(items.map(item => [item['id'], item]));
    const orderedItems = itemIds.map(itemId => itemById.get(itemId));
    const topItemId = itemIds.at(-1);
    const topSprite = components.find(
      component =>
        component['dataType'] === 'SpriteComponent' &&
        (component['item'] as { id?: string } | undefined)?.id === topItemId,
    );

    expect(orderedItems.map(item => item?.['name'])).toEqual(['bottom-blue', 'top-red']);
    expect((topSprite?.['options'] as Record<string, unknown>)['startColor']).toEqual([1, 0, 0, 1]);
  });

  it('reuses one child Composition for repeated instances of the same precomp asset', async () => {
    const precomp = buildPrecompOpacityOffsetLottie();
    const secondPrecomp = {
      ...structuredClone(precomp.layers[0]),
      nm: 'second-precomp',
      ind: 9,
    };

    precomp.layers.push(secondPrecomp);

    const result = assembleTestLottie(precomp);
    const precompLayers = getAssembledComposition(result).layers.filter(
      (layer): layer is IRPrecompLayer => layer.type === 'precomp',
    );
    const childComposition = result.scene.compositions.find(
      composition => composition.id === precompLayers[0]?.content.compositionId,
    );
    const childIds = childComposition?.layers.filter(layer => layer.name === '汽车.png').map(layer => layer.id) ?? [];

    expect(precompLayers).toHaveLength(2);
    expect(new Set(precompLayers.map(layer => layer.content.compositionId)).size).toBe(1);
    expect(precompLayers.map(layer => layer.content.endBehavior)).toEqual([
      IREndBehavior.Destroy,
      IREndBehavior.Destroy,
    ]);
    expect(childIds).toHaveLength(1);

    const scene = (await convertLottieToGE(precomp, {
      resourceBaseUrl: 'https://example.com/animations/data.json',
    })).scene;
    const generatedPrecompItems = scene.items.filter(item =>
      item.name === precomp.layers[0]?.nm || item.name === secondPrecomp.nm,
    );

    expect(generatedPrecompItems).toHaveLength(2);
    expect(generatedPrecompItems.map(item => item.endBehavior)).toEqual([0, 0]);
  });

  it('uses Precomp Layer dimensions when the referenced asset omits its canvas size', async () => {
    const precomp = buildPrecompOpacityOffsetLottie();
    const sourceLayer = precomp.layers[0] as unknown as Record<string, unknown>;
    const sourceAsset = precomp.assets?.[0] as unknown as Record<string, unknown>;

    sourceLayer['w'] = 269;
    sourceLayer['h'] = 304;
    delete sourceAsset['w'];
    delete sourceAsset['h'];

    const result = assembleTestLottie(precomp);
    const precompLayer = getAssembledComposition(result).layers.find(
      (layer): layer is IRPrecompLayer => layer.type === 'precomp',
    );
    const childComposition = result.scene.compositions.find(
      composition => composition.id === precompLayer?.content.compositionId,
    );

    expect(precompLayer?.localBounds).toEqual({ x: 0, y: 0, width: 269, height: 304 });
    expect(childComposition).toMatchObject({ width: 269, height: 304 });
  });

  it('assembles the IR composition', () => {
    const result = assembleTestLottie(buildMinimalImageLottie());
    const composition = getAssembledComposition(result);

    expect(composition.name).toBe('assemble-ir-case');
    expect(composition.frameRate).toBe(24);
    expect(composition.width).toBe(100);
    expect(composition.height).toBe(120);
    expect(composition.endBehavior).toBe(IREndBehavior.Loop);
    expect(composition.layers).toHaveLength(1);

    const irLayer = composition.layers[0];

    expect(irLayer.name).toBe('img-layer');
    expect(irLayer.type).toBe('image');
    expect(irLayer.type === 'image' ? irLayer.content.assetId : undefined).toBe('img_0');
    expect(irLayer.localBounds).toEqual({ x: 0, y: 0, width: 80, height: 60 });
    expect(result.scene.assets).toEqual([{
      id: 'img_0',
      type: 'image',
      source: { kind: 'embedded', mimeType: 'image/png', data: 'iVBORw==' },
    }]);
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it('preserves an NTSC-style numeric frame rate', () => {
    const lottie = buildMinimalImageLottie();

    lottie.fr = 30_000 / 1_001;

    const result = assembleTestLottie(lottie);

    expect(getAssembledComposition(result).frameRate).toBe(30_000 / 1_001);
  });

  it('converts raw Lottie layer data to IR fields', () => {
    const result = assembleTestLottie(buildMinimalSolidLottie());

    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type).toBe('solid');
    expect(irLayer.localBounds).toEqual({ x: 0, y: 0, width: 80, height: 40 });
    expect(irLayer.type === 'solid' ? irLayer.content.color : undefined).toEqual([0.2, 0.4, 0.6, 1]);
    expect(irLayer.transform?.position).toEqual({ type: 'static', value: [50, 60, 0] });
    expect(irLayer.transform?.scale).toEqual({ type: 'static', value: [1, 0.5, 1] });
    expect(irLayer.transform?.rotation).toEqual({ z: { type: 'static', value: 15 } });
    expect(irLayer.transform?.opacity).toEqual({ type: 'static', value: 0.75 });
    expect(irLayer.type).toBe('solid');
  });

  it('reports separated position axes that require sampled keyframe merging without mutating the input', () => {
    const lottie = buildMinimalImageLottie();
    const sourceLayer = lottie.layers[0] as unknown as { ks: Record<string, unknown> };
    const separatedPosition = {
      s: true,
      x: { a: 1, k: [{ t: 0, s: [10] }, { t: 12, s: [30] }] },
      y: { a: 1, k: [{ t: 0, s: [20] }, { t: 8, s: [40] }] },
    };

    sourceLayer.ks['p'] = separatedPosition;

    const result = assembleTestLottie(lottie);

    expect(sourceLayer.ks['p']).toBe(separatedPosition);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LOTTIE_SEPARATED_POSITION_FALLBACK', action: 'approximated' }),
    ]));
    expect(getAssembledComposition(result).layers[0]?.transform?.position).toMatchObject({
      type: 'keyframed',
      keyframes: [{ frame: 0 }, { frame: 8 }, { frame: 12 }],
    });
  });

  it('does not invent Solid bounds when Lottie sw/sh are missing', async () => {
    const lottie = buildMinimalSolidLottie();
    const sourceLayer = lottie.layers[0] as unknown as Record<string, unknown>;

    delete sourceLayer['sw'];
    delete sourceLayer['sh'];

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type).toBe('solid');
    expect(irLayer.localBounds).toBeUndefined();
    expect(() => assertIRScene(result.scene)).toThrow(/IR_LAYER_LOCAL_BOUNDS_INVALID/);
  });

  it('stores converted Lottie text in IR Layer content', () => {
    const result = assembleTestLottie(buildMinimalTextLottie());
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type).toBe('text');
    expect(irLayer.type === 'text' ? irLayer.content.text : undefined).toBe('Hello');
    expect(irLayer.type === 'text' ? irLayer.content.fontAssetId : undefined).toBe(result.scene.assets[0]?.id);
    expect(irLayer.type === 'text' ? irLayer.content : undefined).toEqual(expect.objectContaining({
      fontSize: 24,
      lineHeight: 24,
      letterSpacing: 0,
      textAlign: 'left',
    }));
    expect(irLayer.localBounds).toEqual({ x: 0, y: 0, width: 160, height: 40 });
    expect(result.scene.assets[0]).toMatchObject({
      type: 'font', family: 'Arial', style: 'normal', weight: 400, source: { kind: 'system' },
    });
    expect(validateIRScene(result.scene).warnings.map(warning => warning.code)).toEqual([
      'IR_ASSET_FONT_SYSTEM_PORTABILITY',
    ]);
  });

  it('deduplicates matching Lottie fonts independently from generated Asset IDs', async () => {
    const lottie = buildMinimalTextLottie();
    const firstLayer = lottie.layers[0];

    if (firstLayer == null) {
      throw new Error('test fixture is incomplete');
    }
    const secondLayer = structuredClone(firstLayer);

    secondLayer.ind = 2;
    secondLayer.nm = 'second-text';
    lottie.layers.push(secondLayer);
    const result = assembleTestLottie(lottie);
    const textLayers = getAssembledComposition(result).layers.filter(layer => layer.type === 'text');
    const fontAssets = result.scene.assets.filter(asset => asset.type === 'font');

    expect(textLayers).toHaveLength(2);
    expect(fontAssets).toHaveLength(1);
    expect(new Set(textLayers.map(layer => layer.content.fontAssetId))).toEqual(new Set([fontAssets[0]?.id]));
  });

  it('maps a Lottie font path to a referenced URL Font Asset', async () => {
    const lottie = buildMinimalTextLottie();

    (lottie as unknown as Record<string, unknown>)['fonts'] = {
      list: [{
        fName: 'Arial',
        fFamily: 'Arial',
        fStyle: 'ExtraBold Italic',
        fPath: './Arial-ExtraBoldItalic.woff2',
      }],
    };

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];
    const fontAssetId = irLayer.type === 'text' ? irLayer.content.fontAssetId : undefined;
    const fontAsset = result.scene.assets.find(asset => asset.id === fontAssetId);

    expect(fontAsset).toEqual({
      id: fontAssetId,
      type: 'font',
      family: 'Arial',
      style: 'italic',
      weight: 800,
      source: { kind: 'url', url: 'https://example.com/animations/Arial-ExtraBoldItalic.woff2' },
    });
    expect(() => assertIRScene(result.scene)).not.toThrow();
  });

  it('prefers a numeric-string Lottie fWeight over a conflicting style weight', async () => {
    const lottie = buildMinimalTextLottie();

    (lottie as unknown as Record<string, unknown>)['fonts'] = {
      list: [{ fName: 'Arial', fFamily: 'Arial', fStyle: 'Thin Italic', fWeight: '650' }],
    };

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];
    const fontAssetId = irLayer.type === 'text' ? irLayer.content.fontAssetId : undefined;
    const fontAsset = result.scene.assets.find(asset => asset.id === fontAssetId);

    expect(fontAsset).toMatchObject({ type: 'font', family: 'Arial', style: 'italic', weight: 650 });
  });

  it('keeps Lottie line height independent from the text box in Layer localBounds', async () => {
    const lottie = buildMinimalTextLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const text = layer['t'] as Record<string, unknown>;
    const documentData = text['d'] as Record<string, unknown>;
    const keyframes = documentData['k'] as Array<Record<string, unknown>>;
    const textData = keyframes[0]['s'] as Record<string, unknown>;

    textData['lh'] = 72;

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type === 'text' ? irLayer.content.lineHeight : undefined).toBe(72);
    expect(irLayer.localBounds).toEqual({ x: 0, y: 0, width: 160, height: 40 });
  });

  it('maps the Lottie wrap position and size to Layer localBounds', async () => {
    const lottie = buildMinimalTextLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const text = layer['t'] as Record<string, unknown>;
    const documentData = text['d'] as Record<string, unknown>;
    const keyframes = documentData['k'] as Array<Record<string, unknown>>;
    const textData = keyframes[0]['s'] as Record<string, unknown>;

    textData['ps'] = [-302.5, -40.5];
    textData['sz'] = [561, 81];
    textData['j'] = 2;

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.localBounds).toEqual({ x: -302.5, y: -40.5, width: 561, height: 81 });
  });

  it.each([
    { justify: 0, expectedX: 0 },
    { justify: 1, expectedX: -138 },
    { justify: 2, expectedX: -69 },
  ])('maps point text justification $justify around its baseline origin', async ({ justify, expectedX }) => {
    const lottie = buildMinimalTextLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const text = layer['t'] as Record<string, unknown>;
    const documentData = text['d'] as Record<string, unknown>;
    const keyframes = documentData['k'] as Array<Record<string, unknown>>;
    const textData = keyframes[0]['s'] as Record<string, unknown>;

    delete textData['sz'];
    textData['j'] = justify;

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.localBounds).toEqual({ x: expectedX, y: -24, width: 138, height: 24 });
  });

  it('keeps centered point text on the authored horizontal origin after GE lowering', async () => {
    const lottie = buildMinimalTextLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const transform = layer['ks'] as Record<string, unknown>;
    const text = layer['t'] as Record<string, unknown>;
    const documentData = text['d'] as Record<string, unknown>;
    const keyframes = documentData['k'] as Array<Record<string, unknown>>;
    const textData = keyframes[0]['s'] as Record<string, unknown>;

    delete textData['sz'];
    textData['j'] = 2;
    transform['a'] = { a: 0, k: [0, -8, 0] };
    transform['p'] = { a: 0, k: [100, 50, 0] };

    const scene = (await convertLottieToGE(lottie, {
      resourceBaseUrl: 'https://example.com/animations/data.json',
    })).scene;
    const textItem = scene.items.find(item => item.type === ItemType.text);

    expect(textItem?.transform?.position.x).toBeCloseTo(0, 12);
  });

  it('keeps an animated point-text pivot relative to the alignment origin after GE lowering', async () => {
    const lottie = buildMinimalTextLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const transform = layer['ks'] as Record<string, unknown>;
    const text = layer['t'] as Record<string, unknown>;
    const documentData = text['d'] as Record<string, unknown>;
    const keyframes = documentData['k'] as Array<Record<string, unknown>>;
    const textData = keyframes[0]['s'] as Record<string, unknown>;

    delete textData['sz'];
    textData['j'] = 2;
    transform['a'] = { a: 0, k: [2, 8, 0] };
    transform['p'] = { a: 0, k: [100, 50, 0] };
    transform['s'] = {
      a: 1,
      k: [
        { t: 0, s: [100, 100, 100], e: [125, 125, 100] },
        { t: 12, s: [125, 125, 100] },
      ],
    };

    const scene = (await convertLottieToGE(lottie, {
      resourceBaseUrl: 'https://example.com/animations/data.json',
    })).scene;
    const nullItem = scene.items.find(item => item.type === ItemType.null);
    const textItem = scene.items.find(item => item.type === ItemType.text);
    const ratio = (textItem?.transform?.size?.x ?? 0) * (textItem?.transform?.scale.x ?? 1) / 138;

    expect(textItem?.parentId).toBe(nullItem?.id);
    expect(nullItem?.transform?.position.x).toBeCloseTo(0, 12);
    expect(textItem?.transform?.position.x).toBeCloseTo(-2 * ratio, 5);
  });

  it('uses positive text metrics for empty text with invalid source sizes', async () => {
    const lottie = buildMinimalTextLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const text = layer['t'] as Record<string, unknown>;
    const documentData = text['d'] as Record<string, unknown>;
    const keyframes = documentData['k'] as Array<Record<string, unknown>>;
    const textData = keyframes[0]['s'] as Record<string, unknown>;

    textData['t'] = '';
    textData['s'] = Number.NaN;
    textData['sz'] = [0, -1];

    const result = assembleTestLottie(lottie);
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type === 'text' ? irLayer.content.fontSize : undefined).toBe(16);
    expect(irLayer.type === 'text' ? irLayer.content.lineHeight : undefined).toBe(16);
    expect(irLayer.localBounds).toEqual({ x: 0, y: -16, width: 1, height: 16 });
  });

  it('falls back animated anchors to the first frame and reports the loss', async () => {
    const lottie = buildMinimalImageLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const transform = layer['ks'] as Record<string, unknown>;

    transform['a'] = {
      a: 1,
      k: [
        { t: 0, s: [10, 20, 0], e: [30, 40, 0] },
        { t: 12, s: [30, 40, 0] },
      ],
    };

    const result = assembleTestLottie(lottie);

    expect(getAssembledComposition(result).layers[0].transform?.anchor).toEqual({
      type: 'static',
      value: [10, 20, 0],
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'LOTTIE_ANIMATED_ANCHOR_FALLBACK',
        action: 'approximated',
        message: expect.stringContaining('img-layer'),
      }),
    );
  });

  it('preserves the first animated gradient keyframe and reports the approximation', () => {
    const lottie = buildMinimalShapeLottie();
    const layer = lottie.layers[0] as unknown as Record<string, unknown>;
    const shapes = layer['shapes'] as Array<Record<string, unknown>>;
    const groupItems = shapes[0]['it'] as Array<Record<string, unknown>>;

    groupItems[1] = {
      ty: 'gf',
      t: 1,
      o: { a: 0, k: 100 },
      s: { a: 0, k: [0, 0] },
      e: { a: 0, k: [100, 0] },
      g: {
        p: 2,
        k: {
          a: 1,
          k: [
            { t: 0, s: [0, 1, 0, 0, 1, 0, 0, 1], e: [0, 0, 0, 1, 1, 1, 0, 0] },
            { t: 12, s: [0, 0, 0, 1, 1, 1, 0, 0] },
          ],
        },
      },
    };

    const result = convertLottieToIR(lottie);
    const irLayer = getIRSceneEntryComposition(result.scene).layers[0];
    const firstFill = irLayer.type === 'shape' ? irLayer.content.shapes[0]?.fills[0] : undefined;

    expect(firstFill).toMatchObject({
      type: 'linear-gradient',
      gradientStops: { type: 'static', value: [
        [0, 1, 0, 0, 1],
        [1, 0, 0, 1, 1],
      ] },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'LOTTIE_ANIMATED_GRADIENT_FALLBACK',
        action: 'approximated',
        sourceId: '4',
        feature: 'animated-gradient',
      }),
    );
  });

  it('produces IR layers from the public convertLottieToIR path', () => {
    const lottie = buildMinimalSolidLottie();
    const result = assembleTestLottie(lottie);

    expect(getAssembledComposition(result).layers).toHaveLength(1);

    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type).toBe('solid');
    expect(irLayer.transform?.position).toEqual({ type: 'static', value: [50, 60, 0] });

    const converted = convertLottieToIR(JSON.stringify(lottie));

    expect(converted.scene.compositions).toHaveLength(1);
  });

  it('stores converted shapes in IR Layer content', () => {
    const result = assembleTestLottie(buildMinimalShapeLottie());
    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.type).toBe('shape');
    expect(irLayer.localBounds).toEqual({ x: 0, y: 0, width: 80, height: 60 });
    expect(irLayer.type === 'shape' ? irLayer.content.shapes : undefined).toHaveLength(1);
  });

  it('keeps parent mapping aligned when earlier layers have no ind', async () => {
    const result = assembleTestLottie(buildParentLinkAfterLayerWithoutIndLottie());
    const parentLayer = getAssembledComposition(result).layers.find(layer => layer.name === 'parent-null');
    const childLayer = getAssembledComposition(result).layers.find(layer => layer.name === 'child-solid');

    expect(parentLayer).toBeDefined();
    expect(childLayer?.parentId).toBe(parentLayer?.id);
  });

  it('resolves frame range from ip/op', async () => {
    const result = assembleTestLottie(buildTimeContextLottie());

    const irLayer = getAssembledComposition(result).layers[0];

    expect(irLayer.time).toEqual({ inFrame: 10, outFrame: 70 });
  });

  it('keeps precomp content in an independent Composition when st differs from ip', async () => {
    const result = assembleTestLottie(buildPrecompOpacityOffsetLottie());
    const precompLayer = getAssembledComposition(result).layers.find(layer => layer.name === '图书');
    const childComposition = precompLayer?.type === 'precomp'
      ? result.scene.compositions.find(composition => composition.id === precompLayer.content.compositionId)
      : undefined;
    const carLayer = childComposition?.layers.find(layer => layer.name === '汽车.png');

    expect(childComposition).toBeDefined();
    expect(carLayer?.parentId).toBeUndefined();
    expect(carLayer?.time).toEqual({ inFrame: 0, outFrame: 300 });
    expect(precompLayer?.time).toEqual({ inFrame: 117, outFrame: 300, sourceStartFrame: 7 });
    expect(precompLayer?.transform?.opacity?.type).toBe('keyframed');
  });

  it('keeps a Precomp source timeline at frame zero when a helper Layer has a negative ip', async () => {
    const lottie = buildPrecompWithNegativeHelperInPoint();
    const result = assembleTestLottie(lottie);
    const precompLayer = getAssembledComposition(result).layers.find(
      (layer): layer is IRPrecompLayer => layer.type === 'precomp',
    );
    const childComposition = result.scene.compositions.find(
      composition => composition.id === precompLayer?.content.compositionId,
    );
    const visibleLayer = childComposition?.layers.find(layer => layer.name === 'visible-from-source-frame-zero');

    expect(childComposition).toMatchObject({ inPoint: 0, outPoint: 48 });
    expect(childComposition?.layers.find(layer => layer.name === 'negative-helper')?.time).toEqual({
      inFrame: 0,
      outFrame: 48,
    });
    expect(visibleLayer?.time).toEqual({ inFrame: 0, outFrame: 48 });

    const scene = (await convertLottieToGE(lottie, {
      resourceBaseUrl: 'https://example.com/animations/data.json',
    })).scene;
    const visibleItem = scene.items.find(item => item.name === 'visible-from-source-frame-zero');

    expect(visibleItem?.delay).toBe(0);
  });

  it('maps Lottie Precomp st and sr to instance sourceStartFrame and stretch', async () => {
    const lottie = buildPrecompOpacityOffsetLottie();
    const sourcePrecomp = lottie.layers[0] as unknown as Record<string, unknown>;

    sourcePrecomp['sr'] = 2;
    const result = assembleTestLottie(lottie);
    const precompLayer = getAssembledComposition(result).layers.find(layer => layer.type === 'precomp');

    expect(precompLayer?.time).toEqual({ inFrame: 117, outFrame: 300, sourceStartFrame: 3.5, stretch: 2 });
  });

  it('omits unsupported and unresolved source layers with diagnostics instead of inventing Null layers', async () => {
    const lottie = buildMinimalImageLottie();
    const layers = lottie.layers as unknown as Array<Record<string, unknown>>;

    layers.push({
      ty: 99, nm: 'camera-like', ind: 20, ip: 0, op: 24, st: 0, ks: baseTransform(),
    });
    layers.push({
      ty: 0, nm: 'missing-precomp', ind: 21, refId: 'missing', ip: 0, op: 24, st: 0, ks: baseTransform(),
    });

    const result = assembleTestLottie(lottie);

    expect(getAssembledComposition(result).layers.map(layer => layer.name)).toEqual(['img-layer']);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'LOTTIE_UNSUPPORTED_LAYER_TYPE',
        sourceId: '20',
        message: "Layer 'camera-like' has an unsupported type (99).",
      }),
      expect.objectContaining({
        code: 'LOTTIE_UNSUPPORTED_LAYER_TYPE', sourceId: '21', feature: 'missing-precomp-asset',
      }),
    ]));
  });
});

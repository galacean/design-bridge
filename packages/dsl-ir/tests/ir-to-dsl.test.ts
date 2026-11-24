import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IRComposition, IRLayer } from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { convertIRToGE as convertIRSceneToGE } from '@galacean/ge-ir';
import { convertIRToDSL as convertIRSceneToDSL } from '../src';
import { convertGEToDSL } from './helpers/ge-dsl-integration';
import { createTestIRScene, migrateTestLayerAsset, type TestIRLayerOverrides } from './fixtures/ir';

let idCounter = 0;

vi.mock('uuid', () => ({
  v4: () => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`,
}));

beforeEach(() => {
  idCounter = 0;
});

function layer(
  overrides: TestIRLayerOverrides & { orderIndex: number; name: string },
): IRLayer {
  const { orderIndex, imageUrl, imageAssetId, asset, ...layerOverrides } = overrides;
  const id = `layer-${orderIndex}`;

  return {
    id,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    transform: {
      position: { type: 'static', value: [100, 200, 0] },
      anchor: { type: 'static', value: [50, 50, 0] },
      scale: { type: 'static', value: [1, 1, 1] },
      rotation: { z: { type: 'static', value: 0 } },
      opacity: { type: 'static', value: 1 },
    },
    ...layerOverrides,
    ...migrateTestLayerAsset(id, overrides.type, imageUrl, imageAssetId, asset, overrides.localBounds),
  } as IRLayer;
}

function composition(layers: IRLayer[]): IRComposition {
  return {
    id: 'test-composition',
    name: 'demo',
    width: 400,
    height: 300,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: 'loop',
    layers,
  };
}

function convertIRToGE(ir: IRComposition): ReturnType<typeof convertIRSceneToGE>['scene'] {
  return convertIRSceneToGE(createTestIRScene(ir)).scene;
}

function convertIRToDSL(ir: IRComposition): ReturnType<typeof convertIRSceneToDSL> {
  return convertIRSceneToDSL(createTestIRScene(ir));
}

describe('convertIRToDSL', () => {
  it('uses stable IR IDs when optional names are omitted', () => {
    const unnamedLayer = layer({ orderIndex: 0, name: 'temporary', type: 'null' });
    const unnamedComposition = composition([unnamedLayer]);

    delete unnamedComposition.name;
    delete unnamedLayer.name;

    const result = convertIRToDSL(unnamedComposition);

    expect(result.dsl.meta.name).toBe(unnamedComposition.id);
    expect(result.dsl.layers[0].name).toBe(unnamedLayer.id);
    expect(result.dsl.layers[0].description.self).toBe(unnamedLayer.id);
  });

  it('maps explicit loop endBehavior consistently with IR-to-GE', () => {
    const ir = composition([]);

    const dslResult = convertIRToDSL(ir);
    const GEScene = convertIRToGE(ir);

    expect(dslResult.dsl.meta.loop).toBe(true);
    expect(GEScene.compositions[0]?.endBehavior).toBe(5);
  });

  it('converts GE scenes into pure DSL', () => {
    const ir = composition([
      layer({
        id: 'stable-logo',
        orderIndex: 0,
        name: 'logo',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/logo.png',
      }),
    ]);

    expect(convertIRToDSL(ir).dsl.layers[0].id).toBe('stable-logo');
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const { dsl, diagnostics } = convertGEToDSL(GEScene, { frameRate: 30 });

    expect(diagnostics).toEqual([]);
    expect(JSON.parse(JSON.stringify(dsl))).toStrictEqual(dsl);
    expect(dsl.meta.name).toBe('demo');
    expect(dsl.meta.duration).toBe(2);
    expect(dsl.meta.loop).toBe(true);
    expect(dsl.layers).toHaveLength(1);
    expect(dsl.layers[0].name).toBe('logo');
    expect(dsl.layers[0].type).toBe('layer');
    expect(dsl.layers[0].asset?.url).toBe('https://example.com/logo.png');
    expect(dsl.layers[0]).not.toHaveProperty('source');
    expect(dsl.layers[0]).not.toHaveProperty('editable');
    expect(dsl.layers[0]).not.toHaveProperty('metadata');
    expect(dsl as unknown as Record<string, unknown>).not.toHaveProperty('baselineScene');
    expect(dsl as unknown as Record<string, unknown>).not.toHaveProperty('layerMapping');
  });

  it('converts GE scenes into editable DSL plus IR and GE preserved data', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'logo',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/logo.png',
      }),
    ]);
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToDSL(GEScene, { frameRate: 30 });
    const baselineComposition = getIRSceneEntryComposition(result.preservedData.ir.baselineScene);

    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    expect(Object.keys(result.preservedData).sort()).toEqual(['ge', 'ir']);
    expect(result.preservedData.ir.baselineScene.format).toBe('animation-ir');
    expect(result.dsl.meta.name).toBe('demo');
    expect(result.dsl.meta.duration).toBe(2);
    expect(result.dsl.meta.loop).toBe(true);
    expect(result.dsl.layers).toHaveLength(1);
    expect(result.dsl.layers[0].name).toBe('logo');
    expect(result.dsl.layers[0].type).toBe('layer');
    expect(result.dsl.layers[0].asset?.url).toBe('https://example.com/logo.png');
    expect(result.preservedData.ir.layerMapping.layers[result.dsl.layers[0].id].irLayerId).toBe(
      baselineComposition.layers[0].id,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive or non-finite source frame rate: %s',
    frameRate => {
      const GEScene = convertIRToGE(composition([])) as unknown as Record<string, unknown>;

      expect(() => convertGEToDSL(GEScene, { frameRate })).toThrow('options.frameRate must be finite and greater than 0');
    },
  );

  it('keeps parent hierarchy in the editable DSL view', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'parent', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        localBounds: { x: 0, y: 0, width: 80, height: 80 },
        imageUrl: 'https://example.com/child.png',
      }),
    ]);
    const result = convertIRToDSL(ir);
    const parent = result.dsl.layers[0];

    expect(parent.name).toBe('parent');
    expect(parent.children).toHaveLength(1);
    expect((parent.children ?? [])[0].name).toBe('child');
    expect((parent.children ?? [])[0].parent).toBe(parent.id);
  });

  it('converts bottom-to-top IR painter order to top-to-bottom DSL sibling order', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'bottom', type: 'null' }),
      layer({ orderIndex: 1, name: 'top', type: 'null' }),
    ]);

    const result = convertIRToDSL(ir);

    expect(result.dsl.layers.map(dslLayer => dslLayer.name)).toEqual(['top', 'bottom']);
  });

  it('projects an assetless visual layer to null and reports a structured diagnostic', () => {
    const result = convertIRToDSL(
      composition([layer({ orderIndex: 0, name: 'shape', type: 'shape', content: { shapes: [] } })]),
    );

    expect(result.dsl.layers[0].type).toBe('null');
    expect(result.dsl.layers[0].asset).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'LAYER_ASSET_NOT_MATERIALIZED',
        sourceId: 'layer-0',
      }),
    );
  });

  it('derives DSL authoring defaults from source-neutral IR fields', () => {
    const result = convertIRToDSL(
      composition([
        layer({
          orderIndex: 0,
          name: 'generated-logo',
          type: 'image',
          localBounds: { x: 0, y: 0, width: 100, height: 100 },
          imageUrl: 'https://example.com/logo.png',
        }),
      ]),
    );
    const dslLayer = result.dsl.layers[0];

    expect(dslLayer.description).toEqual({
      self: 'generated-logo',
      composite: '',
    });
    expect(dslLayer.asset).toEqual({
      url: 'https://example.com/logo.png',
      source: 'user',
      prompt: '',
    });
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.preservedData.layerMapping.layers[dslLayer.id]).sort()).toEqual([
      'irCompositionId',
      'irLayerId',
    ]);
  });

  it('reports non-default IR fields retained only by preserved data', () => {
    const result = convertIRToDSL(
      composition([
        layer({
          orderIndex: 0,
          name: 'hidden-offset-image',
          type: 'image',
          visible: false,
          localBounds: { x: -10, y: 5, width: 100, height: 100 },
          imageUrl: 'https://example.com/image.png',
        }),
      ]),
    );

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LAYER_FIELDS_PRESERVED_IN_BASE_IR',
      feature: 'visible,localBounds.x,localBounds.y',
      path: '$.compositions[id="test-composition"].layers[0]',
    }));
  });

  it('converts transform keyframes into DSL animation segments', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'spinner',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/spinner.png',
        transform: {
          position: { type: 'static', value: [100, 200, 0] },
          anchor: { type: 'static', value: [50, 50, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: {
            z: {
              type: 'keyframed',
              keyframes: [
                { frame: 0, value: 0, outTangent: { x: 0.42, y: 0 } },
                { frame: 30, value: 180, inTangent: { x: 0.58, y: 1 } },
              ],
            },
          },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const result = convertIRToDSL(ir);
    const rotation = result.dsl.layers[0].rotation;

    expect(rotation?.a).toBe(true);
    if (rotation?.a !== true) {
      throw new Error('expected animated rotation');
    }
    expect(rotation.animation).toHaveLength(1);
    expect(rotation.animation[0].t).toEqual([0, 1]);
    expect(rotation.animation[0].start).toEqual([0, 0, 0]);
    expect(rotation.animation[0].end).toEqual([0, 0, 180]);
    expect(rotation.animation[0].easing).toEqual([0.42, 0, 0.58, 1]);
  });

  it('reports unsupported fields without persisting diagnostic metadata', () => {
    const result = convertIRToDSL(
      composition([
        layer({
          orderIndex: 0,
          name: 'shape-mask',
          type: 'shape',
          content: { shapes: [] },
        }),
      ]),
    );
    const dslLayer = result.dsl.layers[0];
    const layerInfo = result.preservedData.layerMapping.layers[dslLayer.id];

    expect(dslLayer).not.toHaveProperty('metadata');
    expect(Object.keys(layerInfo).sort()).toEqual(['irCompositionId', 'irLayerId']);
    expect(layerInfo).not.toHaveProperty('GEComponentId');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'LAYER_HAS_UNSUPPORTED_FEATURES',
      feature: 'shape',
      severity: 'warning',
    }));
  });

  it('reports normalized Solid content without persisting diagnostic metadata', () => {
    const result = convertIRToDSL(
      composition([
        layer({
          orderIndex: 0,
          name: 'background',
          type: 'solid',
          content: { color: [0.2, 0.4, 0.6, 1] },
          localBounds: { x: 0, y: 0, width: 400, height: 300 },
        }),
      ]),
    );
    const dslLayer = result.dsl.layers[0];
    const layerInfo = result.preservedData.layerMapping.layers[dslLayer.id];

    expect(Object.keys(layerInfo).sort()).toEqual(['irCompositionId', 'irLayerId']);
    expect(dslLayer.width).toBe(400);
    expect(dslLayer.height).toBe(300);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LAYER_HAS_UNSUPPORTED_FEATURES', feature: 'solid' }),
      expect.objectContaining({ code: 'LAYER_FIELDS_PRESERVED_IN_BASE_IR', feature: 'content.color' }),
    ]));
  });
});

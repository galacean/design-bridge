import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IRComposition, IRScene, IRLayer } from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { convertIRToGE as convertIRSceneToGE } from '@galacean/ge-ir';
import {
  convertDSLToIR, convertIRToDSL as convertIRSceneToDSL,
  type DSLToIROptions, type DSLToIRChange, type IRToDSLPreservedData,
} from '../src';
import {
  convertDSLToGE as convertDSLDocumentToGE, convertGEToDSL,
  type ConvertDSLToGEOptions, type GEDSLPreservedData,
} from './helpers/ge-dsl-integration';
import {
  createLegacyPrecompTextScene,
  createPrecompScene,
  createPrecompSceneWithMaskSource,
  createPrecompSceneWithSiblings,
  createPrecompTextScene,
} from './fixtures/precomp-scenes';
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

function asScene(ir: IRComposition | IRScene): IRScene {
  return 'format' in ir ? ir : createTestIRScene(ir);
}

function convertIRToGE(ir: IRComposition | IRScene): ReturnType<typeof convertIRSceneToGE>['scene'] {
  return convertIRSceneToGE(asScene(ir)).scene;
}

function convertIRToDSL(ir: IRComposition | IRScene): ReturnType<typeof convertIRSceneToDSL> {
  return convertIRSceneToDSL(asScene(ir));
}

function updateIRFromDSL(
  baselineScene: IRScene,
  editedDSL: Parameters<typeof convertDSLToIR>[0],
  layerMapping: IRToDSLPreservedData['layerMapping'],
  options: Omit<DSLToIROptions, 'preservedData'> = {},
): IRScene {
  return convertDSLToIR(editedDSL, {
    ...options,
    preservedData: { baselineScene, layerMapping },
  }).scene;
}

function convertDSLToGE(
  composition: Parameters<typeof convertDSLDocumentToGE>[0],
  preservedData: GEDSLPreservedData,
  options: Omit<ConvertDSLToGEOptions, 'preservedData'> = {},
): ReturnType<typeof convertDSLDocumentToGE>['scene'] {
  return convertDSLDocumentToGE(composition, { ...options, preservedData }).scene;
}

function getPreservedImageLayerData(preservedData: GEDSLPreservedData) {
  const composition = getIRSceneEntryComposition(preservedData.ir.baselineScene);
  const layer = composition.layers.find(candidate => candidate.type === 'image');

  return layer == null
    ? undefined
    : preservedData.ge.compositionBindings[composition.id]?.layerDataById[layer.id];
}

function sampleScene(): Record<string, unknown> {
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

  return convertIRToGE(ir) as unknown as Record<string, unknown>;
}

describe('composed GE and DSL conversion round trip', () => {
  it('returns the exact canonical top-level, meta, layer, and static-property shape', () => {
    const { dsl, preservedData } = convertGEToDSL(sampleScene(), { frameRate: 30 });
    const child = (dsl.layers[0].children ?? []).find(layer => layer.name === 'child');

    expect(Object.keys(dsl).sort()).toEqual(['layers', 'meta']);
    expect(Object.keys(dsl.meta).sort()).toEqual([
      'background_color',
      'duration',
      'fps',
      'height',
      'loop',
      'name',
      'width',
    ]);
    expect(dsl.meta.background_color).toBeNull();
    expect(child).toBeDefined();
    expect(Object.keys(child!).sort()).toEqual([
      'anchor',
      'asset',
      'children',
      'description',
      'height',
      'id',
      'name',
      'opacity',
      'parent',
      'position',
      'rotation',
      'scale',
      'time_range',
      'type',
      'width',
    ]);
    expect(Object.keys(child!.description).sort()).toEqual(['composite', 'self']);
    expect(Object.keys(child!.asset!).sort()).toEqual(['prompt', 'source', 'url']);
    expect(Object.keys(child!.position).sort()).toEqual(['a', 'value']);
    expect(child).not.toHaveProperty('timeRange');
    expect(child!.description).not.toHaveProperty('selfDesc');
    expect(Object.keys(preservedData).sort()).toEqual(['ge', 'ir']);
    expect(Object.keys(preservedData.ir).sort()).toEqual(['baselineScene', 'layerMapping']);
    expect(Object.keys(preservedData.ir.layerMapping)).toEqual(['layers']);
  });

  it('serializes animated properties with animation and in/out curve fields only', () => {
    const animatedLayer = layer({
      orderIndex: 0,
      name: 'animated',
      type: 'image',
      localBounds: { x: 0, y: 0, width: 80, height: 80 },
      imageAssetId: 'animated-asset',
      imageUrl: 'https://example.com/animated.png',
      transform: {
        position: {
          type: 'keyframed',
          keyframes: [
            {
              frame: 0,
              value: [0, 0, 0],
              endValue: [100, 50, 0],
              outTangent: { x: 0.42, y: 0 },
              spatialOut: [10, 5, 0],
            },
            {
              frame: 30,
              value: [100, 50, 0],
              inTangent: { x: 0.58, y: 1 },
              spatialIn: [-10, -5, 0],
            },
          ],
        },
        anchor: { type: 'static', value: [0, 0, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });
    const converted = convertIRToDSL(composition([animatedLayer]));
    const position = converted.dsl.layers.find(item => item.position.a)?.position;

    expect(position?.a).toBe(true);
    expect(Object.keys(position!).sort()).toEqual(['a', 'animation']);
    if (position == null || !position.a) {
      throw new Error('expected animated position');
    }
    expect(Object.keys(position.animation[0]).sort()).toEqual(['easing', 'end', 'in', 'out', 'start', 't']);
    expect(position.animation[0]).not.toHaveProperty('inTangent');
    expect(position.animation[0]).not.toHaveProperty('outTangent');
  });

  it('serializes text fields in the canonical nested text object', () => {
    const textLayer = layer({
      orderIndex: 0,
      name: 'title',
      type: 'text',
      localBounds: { x: 0, y: 0, width: 200, height: 40 },
      content: {
        text: 'Hello',
        fontAssetId: 'font:test-arial',
        fontSize: 24,
        color: [1, 0, 0, 1],
        letterSpacing: 2,
        lineHeight: 1.2,
        textAlign: 'center',
      },
    });
    const document = createTestIRScene(composition([textLayer]), [{
      id: 'font:test-arial',
      type: 'font',
      family: 'Arial',
      style: 'normal',
      weight: 400,
      source: { kind: 'system' },
    }]);
    const converted = convertIRToDSL(document);
    const output = converted.dsl.layers[0];

    expect(output).toMatchObject({
      type: 'text',
      text: {
        content: 'Hello',
        font: 'Arial',
        size: 24,
        color: '#ff0000',
        align: 'center',
        line_height: 1.2,
        letter_spacing: 2,
      },
    });
  });

  it('GE-to-DSL conversion produces a spec-shaped DSL document with no adapter extras', () => {
    const { dsl } = convertGEToDSL(sampleScene(), { frameRate: 30 });

    const checkPure = (layers: unknown[]): void => {
      for (const l of layers as Record<string, unknown>[]) {
        expect(l).not.toHaveProperty('source');
        expect(l).not.toHaveProperty('editable');
        expect(l).not.toHaveProperty('metadata');
        checkPure((l['children'] as unknown[]) ?? []);
      }
    };

    checkPure(dsl.layers);
    expect(dsl.meta).toMatchObject({ name: 'demo', duration: 2, fps: 30 });
    expect(dsl.layers.length).toBeGreaterThan(0);
  });

  it('no-op preserved-data round trip is lossless: the exported IR equals the baseline and GE pools match', () => {
    const scene = sampleScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });

    const updatedIR = updateIRFromDSL(preservedData.ir.baselineScene, dsl, preservedData.ir.layerMapping);

    expect(updatedIR).toEqual(preservedData.ir.baselineScene);

    const expected = convertIRToGE(preservedData.ir.baselineScene) as unknown as Record<string, unknown>;
    const recombined = convertDSLToGE(dsl, preservedData) as unknown as Record<string, unknown>;

    for (const collectionName of ['items', 'components', 'images', 'textures'] as const) {
      expect(((recombined[collectionName] as unknown[]) ?? []).length).toBe(
        ((expected[collectionName] as unknown[]) ?? []).length,
      );
    }
  });

  it('preserves atlas sprite regions through a no-op preserved-data round trip', () => {
    const scene = sampleScene();
    const sourceComponent = ((scene['components'] as Record<string, unknown>[]) ?? []).find(
      component => component['dataType'] === 'SpriteComponent',
    );
    const spriteSplits = [
      [0, 0.25, 0.5, 0.5, 0],
      [0.5, 0.75, 0.25, 0.125, 1],
    ];

    if (sourceComponent == null) {
      throw new Error('expected sample SpriteComponent');
    }
    sourceComponent['splits'] = spriteSplits;

    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const recombined = convertDSLToGE(dsl, preservedData) as unknown as Record<string, unknown>;
    const recombinedComponent = ((recombined['components'] as Record<string, unknown>[]) ?? []).find(
      component => component['dataType'] === 'SpriteComponent',
    );

    expect(getPreservedImageLayerData(preservedData)?.spriteSplits).toEqual(spriteSplits);
    expect(recombinedComponent?.['splits']).toEqual(spriteSplits);
  });

  it('preserves sprite texture sheet animation through a no-op preserved-data round trip', () => {
    const scene = sampleScene();
    const sourceComponent = ((scene['components'] as Record<string, unknown>[]) ?? []).find(
      component => component['dataType'] === 'SpriteComponent',
    );
    const textureSheetAnimation = {
      col: 6,
      row: 6,
      total: 36,
      animate: true,
      loop: true,
    };

    if (sourceComponent == null) {
      throw new Error('expected sample SpriteComponent');
    }
    sourceComponent['textureSheetAnimation'] = textureSheetAnimation;

    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const recombined = convertDSLToGE(dsl, preservedData) as unknown as Record<string, unknown>;
    const recombinedComponent = ((recombined['components'] as Record<string, unknown>[]) ?? []).find(
      component => component['dataType'] === 'SpriteComponent',
    );

    expect(getPreservedImageLayerData(preservedData)?.textureSheetAnimation).toEqual(textureSheetAnimation);
    expect(recombinedComponent?.['textureSheetAnimation']).toEqual(textureSheetAnimation);
  });

  it('no-op preserved-data round trip keeps GE precomp references and child composition resources', () => {
    const scene = createPrecompScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const recombined = convertDSLToGE(dsl, preservedData) as unknown as Record<string, unknown>;
    const rootComposition = (recombined['compositions'] as Record<string, unknown>[]).find(
      comp => comp['id'] === recombined['compositionId'],
    );
    const rootItemId = (rootComposition?.['children'] as Array<{ id: string }>)[0]?.id;
    const rootItem = (recombined['items'] as Record<string, unknown>[]).find(item => item['id'] === rootItemId);

    expect(dsl.layers.filter(layer => layer.parent == null)).toHaveLength(1);
    expect(dsl.layers[0].type).toBe('null');
    expect((recombined['compositions'] as Record<string, unknown>[]).some(comp => comp['id'] === 'child-comp')).toBe(
      true,
    );
    expect(rootItem?.['type']).toBe('7');
    expect(((rootItem?.['content'] as Record<string, unknown>)['options'] as Record<string, unknown>)['refId']).toBe(
      'child-comp',
    );
    expect(readObjectBindingChildTrackTypes(recombined, rootItemId)).toContain('SubCompositionTrack');
  });

  it('can expose precomp children as plain DSL children with assets', () => {
    const scene = createPrecompScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const precomp = dsl.layers[0];
    const child = (precomp.children ?? [])[0];
    const childMap = preservedData.ir.layerMapping.layers[child.id];

    expect(precomp.type).toBe('null');
    expect(precomp.children).toHaveLength(1);
    expect(child.name).toBe('ChildImage');
    expect(child.type).toBe('layer');
    expect(child.parent).toBe(precomp.id);
    expect(child.asset?.url).toBe('https://example.com/child.png');
    expect(childMap.expandedSource).toMatchObject({
      parentLayerId: precomp.id,
      irCompositionId: expect.any(String),
    });
    expect(childMap.irLayerId).toBe('child-item');
    expect(Object.keys(childMap).sort()).toEqual(['expandedSource', 'irCompositionId', 'irLayerId']);
  });

  it('reorders expanded precomp siblings with their bindings and timeline tracks', () => {
    const { dsl, preservedData } = convertGEToDSL(createPrecompSceneWithSiblings(), { frameRate: 30 });
    const edited = structuredClone(dsl);
    const precomp = edited.layers[0];
    const changes: DSLToIRChange[] = [];

    expect((precomp.children ?? []).map(layer => layer.name)).toEqual(['ChildImage', 'ChildImageB']);
    (precomp.children ?? []).reverse();
    const unchanged = convertGEToDSL(
      convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>, { frameRate: 30 },
    );

    expect((unchanged.dsl.layers[0].children ?? []).map(layer => layer.name)).toEqual(['ChildImage', 'ChildImageB']);
    (precomp.children ?? []).reverse();

    (precomp.children ?? []).forEach((layer, index) => {
      layer.position = { a: false, value: [0, 0, index] };
    });

    const recombined = convertDSLToGE(edited, preservedData, {
      onChange: change => changes.push(change),
    }) as unknown as Record<string, unknown>;
    const secondSplit = convertGEToDSL(recombined, { frameRate: 30 });

    expect((secondSplit.dsl.layers[0].children ?? []).map(layer => layer.name)).toEqual(['ChildImageB', 'ChildImage']);
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'layer',
        op: 'set',
        field: 'order',
        layerId: precomp.id,
      }),
    );
  });

  it('keeps source-neutral mask layers in expanded precomp children', () => {
    const scene = createPrecompSceneWithMaskSource();
    const { dsl, preservedData, diagnostics } = convertGEToDSL(scene, { frameRate: 30 });
    const precomp = dsl.layers[0];
    const childNames = (precomp.children ?? []).map(child => child.name);
    const child = (precomp.children ?? []).find(layer => layer.name === 'ChildImage');
    const recombined = convertDSLToGE(dsl, preservedData) as unknown as Record<string, unknown>;
    const maskComponent = findComponent(recombined, 'mask-component');
    const spriteComponent = findComponent(recombined, 'sprite-component');

    expect(childNames).toEqual(['ChildImage', 'mask']);
    expect(childNames).toContain('mask');
    expect(child).toBeDefined();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'LAYER_HAS_UNSUPPORTED_FEATURES',
      feature: 'mask',
    }));
    expect(Object.values(preservedData.ir.layerMapping.layers).some(info =>
      'GEComponentId' in (info.expandedSource ?? {}),
    )).toBe(false);
    expect(maskComponent?.['mask']).toMatchObject({ isMask: true, alphaMaskEnabled: false });
    expect(spriteComponent?.['mask']).toMatchObject({
      isMask: false,
      references: [{ mask: { id: 'mask-component' }, inverted: false }],
    });
  });

  it('serializes expanded precomp children once in the canonical tree', () => {
    const scene = createPrecompScene();
    const splitResult = convertGEToDSL(scene, { frameRate: 30 });
    const { dsl } = splitResult;
    const parent = dsl.layers.find(layer => layer.name === 'ChildPrecomp');
    const nestedChild = (parent?.children ?? [])[0];

    expect(JSON.parse(JSON.stringify(splitResult))).toStrictEqual(splitResult);
    expect(dsl.layers).toHaveLength(1);
    expect(nestedChild?.parent).toBe(parent?.id);
    expect(nestedChild?.asset).toEqual({
      url: 'https://example.com/child.png',
      source: 'user',
      prompt: '',
    });
  });

  it('applies asset edits made inside expanded precomp children', () => {
    const scene = createPrecompScene();
    const sourceComponent = findComponent(scene, 'sprite-component');

    if (sourceComponent == null) {
      throw new Error('expected precomp SpriteComponent');
    }
    sourceComponent['splits'] = [[0, 0, 0.5, 0.5, 0]];
    sourceComponent['textureSheetAnimation'] = {
      col: 2,
      row: 2,
      total: 4,
      animate: true,
      loop: true,
    };

    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];
    const newUrl = 'https://example.com/replaced.png';
    const changes: unknown[] = [];

    child.asset!.url = newUrl;
    const recombined = convertDSLToGE(edited, preservedData, {
      onChange: change => changes.push(change),
    }) as unknown as Record<string, unknown>;

    expect(findImageUrlForComponent(recombined, 'sprite-component')).toBe(newUrl);
    expect(findComponent(recombined, 'sprite-component')?.['splits']).toBeUndefined();
    expect(findComponent(recombined, 'sprite-component')?.['textureSheetAnimation']).toBeUndefined();
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'asset',
        op: 'set',
        field: 'asset.url',
        layerId: child.id,
        oldValue: 'https://example.com/child.png',
        newValue: newUrl,
      }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'passthrough',
        op: 'clear',
        field: 'spriteSplits',
        layerId: child.id,
      }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'passthrough',
        op: 'clear',
        field: 'textureSheetAnimation',
        layerId: child.id,
      }),
    );

    const rootItem = findRootFirstItem(recombined);

    expect(rootItem?.['type']).toBe('7');
  });

  it('materializes llm_svg edits inside expanded precomp children', () => {
    const scene = createPrecompScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5"/></svg>';

    child.asset = { source: 'llm_svg', format: 'svg', svg, prompt: 'a circle' };
    const recombined = convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>;
    const url = findImageUrlForComponent(recombined, 'sprite-component');

    expect(url).toBe(`data:image/svg+xml;base64,${btoa(svg)}`);
  });

  it('applies static transform edits made inside expanded precomp children', () => {
    const scene = createPrecompScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];
    const changes: unknown[] = [];

    child.position = { a: false, value: [260, 120, 0] };
    child.scale = { a: false, value: [2, 2, 1] };
    child.rotation = { a: false, value: [0, 0, 15] };

    updateIRFromDSL(preservedData.ir.baselineScene, edited, preservedData.ir.layerMapping, {
      onChange: change => changes.push(change),
    });
    const recombined = convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>;
    const roundTrippedChild = (convertGEToDSL(recombined, { frameRate: 30 }).dsl.layers[0].children ?? [])[0];

    expect(roundTrippedChild.scale).toEqual(child.scale);
    expect(roundTrippedChild.rotation).toEqual(child.rotation);
    expect(roundTrippedChild.position).toEqual(child.position);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'transform', field: 'position', layerId: child.id }),
        expect.objectContaining({ kind: 'transform', field: 'scale', layerId: child.id }),
        expect.objectContaining({ kind: 'transform', field: 'rotation', layerId: child.id }),
      ]),
    );

    const rootItem = findRootFirstItem(recombined);

    expect(rootItem?.['type']).toBe('7');
  });

  it('keeps the rendered origin stable when an expanded image is re-anchored around its center', () => {
    const scene = createPrecompScene();
    const sourceComponent = findComponent(scene, 'sprite-component');
    const sourceItem = findItem(scene, 'child-item');

    (sourceComponent?.['renderer'] as Record<string, unknown>)['anchor'] = [0, 0];
    const sourcePosition = structuredClone((sourceItem?.['transform'] as Record<string, unknown>)['position']);
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];
    const basePosition: [number, number, number] = child.position.a ? [0, 0, 0] : child.position.value;
    const baseAnchor = child.anchor?.a !== false ? [0, 0, 0] : (child.anchor.value as number[]);
    const center: [number, number, number] = [child.width / 2, child.height / 2, 0];

    expect(baseAnchor).toEqual([0, 0, 0]);
    child.anchor = { a: false, value: center };
    child.position = {
      a: false,
      value: [
        basePosition[0] + center[0] - baseAnchor[0],
        basePosition[1] + center[1] - baseAnchor[1],
        basePosition[2],
      ],
    };

    const recombined = convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>;
    const itemTransform = findItem(recombined, 'child-item')?.['transform'] as Record<string, unknown>;
    const roundTrippedChild = (convertGEToDSL(recombined, { frameRate: 30 }).dsl.layers[0].children ?? [])[0];

    expect((itemTransform['position'] as Record<string, number>)['x']).toBeCloseTo(
      (sourcePosition as Record<string, number>)['x'],
      12,
    );
    expect((itemTransform['position'] as Record<string, number>)['y']).toBeCloseTo(
      (sourcePosition as Record<string, number>)['y'],
      12,
    );
    expect(roundTrippedChild.anchor).toEqual(child.anchor);
    expect(roundTrippedChild.position).toEqual(child.position);
  });

  it('recovers text bounds and decodes the standard GE anchor before applying scale animation', () => {
    const scene = createLegacyPrecompTextScene();
    const sourceItem = findItem(scene, 'child-item');
    const sourcePosition = structuredClone((sourceItem?.['transform'] as Record<string, unknown>)['position']);
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];
    const basePosition: [number, number, number] = child.position.a ? [0, 0, 0] : child.position.value;
    const baseAnchor = child.anchor?.a !== false ? [0, 0, 0] : (child.anchor.value as number[]);
    const baseline = child.text!.size + (child.text!.line_height! - child.text!.size) / 3;
    const center: [number, number, number] = [0, child.height / 2 - baseline, 0];
    const easing: [number, number, number, number] = [0.42, 0, 0.58, 1];
    const baseScale = child.scale?.a === false ? child.scale.value : [1, 1, 1];
    const startScale: [number, number, number] = [baseScale[0], baseScale[1], baseScale[2]];
    const peakScale: [number, number, number] = [baseScale[0] * 1.3, baseScale[1] * 1.3, baseScale[2]];

    expect([child.width, child.height]).toEqual([274, 107]);
    expect(baseAnchor[0]).toBeCloseTo(0.274, 6);
    expect(baseAnchor[1]).toBeCloseTo(18.1066, 6);

    child.anchor = { a: false, value: center };
    child.position = {
      a: false,
      value: [
        basePosition[0] + (center[0] - baseAnchor[0]) * baseScale[0],
        basePosition[1] + (center[1] - baseAnchor[1]) * baseScale[1],
        basePosition[2],
      ],
    };
    child.scale = {
      a: true,
      animation: [
        { t: [0, 1], start: startScale, end: peakScale, easing },
        { t: [1, 2], start: peakScale, end: startScale, easing },
      ],
    };

    const recombined = convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>;
    const itemTransform = findItem(recombined, 'child-item')?.['transform'] as Record<string, unknown>;
    const renderer = findComponent(recombined, 'sprite-component')?.['renderer'] as Record<string, unknown>;
    const transformAsset = findTimelineAsset(recombined, 'child-comp', 'child-item', 'TransformTrack');

    expect((itemTransform['position'] as Record<string, number>)['x']).toBeCloseTo(
      (sourcePosition as Record<string, number>)['x'],
      12,
    );
    expect((itemTransform['position'] as Record<string, number>)['y']).toBeCloseTo(
      (sourcePosition as Record<string, number>)['y'],
      12,
    );
    expect((renderer['anchor'] as number[])[0]).toBeCloseTo(0.5, 12);
    expect((renderer['anchor'] as number[])[1]).toBeCloseTo(0.5, 12);
    expect((transformAsset?.['sizeOverLifetime'] as Record<string, unknown>)['x']).toEqual(expect.any(Array));
    expect((transformAsset?.['sizeOverLifetime'] as Record<string, unknown>)['y']).toEqual(expect.any(Array));
  });

  it('converts text anchors to baseline coordinates and preserves GE alignment on re-export', () => {
    const rendererAnchor: [number, number] = [0.25, 0.75];
    const expectedAnchorX = 68.5;
    const expectedAnchorY = 80.25;

    for (const textAlign of [0, 1, 2] as const) {
      const scene = createLegacyPrecompTextScene();
      const component = findComponent(scene, 'sprite-component');
      const item = findItem(scene, 'child-item');
      const options = component?.['options'] as Record<string, unknown>;
      const renderer = component?.['renderer'] as Record<string, unknown>;
      const sourcePosition = structuredClone((item?.['transform'] as Record<string, unknown>)['position']);

      options['textAlign'] = textAlign;
      renderer['anchor'] = rendererAnchor;

      const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
      const child = (dsl.layers[0].children ?? [])[0];
      const anchor = child.anchor?.a !== false ? [0, 0, 0] : (child.anchor.value as number[]);

      expect(anchor[0]).toBeCloseTo(expectedAnchorX - textAlign * child.width / 2, 12);
      expect(anchor[1]).toBeCloseTo(expectedAnchorY - 80.954, 12);

      const recombined = convertDSLToGE(dsl, preservedData) as unknown as Record<string, unknown>;
      const recombinedRenderer = findComponent(recombined, 'sprite-component')?.['renderer'] as Record<string, unknown>;
      const recombinedTransform = findItem(recombined, 'child-item')?.['transform'] as Record<string, unknown>;
      const recombinedPosition = recombinedTransform['position'] as Record<string, number>;
      const expectedPosition = sourcePosition as Record<string, number>;

      expect(recombinedRenderer['anchor']).toEqual(rendererAnchor);
      expect(recombinedPosition['x']).toBeCloseTo(expectedPosition['x'], 12);
      expect(recombinedPosition['y']).toBeCloseTo(expectedPosition['y'], 12);
      expect(recombinedPosition['z']).toBeCloseTo(expectedPosition['z'], 12);
    }
  });

  it('writes animated transform, opacity, and anchor edits into expanded precomp timelines', () => {
    const { dsl, preservedData } = convertGEToDSL(createPrecompScene(), { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];
    const basePosition: [number, number, number] = child.position.a ? [200, 150, 0] : child.position.value;
    const easing: [number, number, number, number] = [0.42, 0, 0.58, 1];

    child.position = {
      a: true,
      animation: [
        {
          t: [0, 2],
          start: basePosition,
          end: [basePosition[0] + 40, basePosition[1] + 20, 0],
          easing,
        },
      ],
    };
    child.scale = {
      a: true,
      animation: [{ t: [0, 2], start: [1, 1, 1], end: [1.3, 1.3, 1], easing }],
    };
    child.rotation = {
      a: true,
      animation: [{ t: [0, 2], start: [0, 0, 0], end: [0, 0, 30], easing }],
    };
    child.opacity = {
      a: true,
      animation: [{ t: [0, 2], start: [1], end: [0.35], easing }],
    };
    child.anchor = { a: false, value: [child.width / 4, child.height / 4, 0] };

    const recombined = convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>;
    const visualItem = ((recombined['items'] as Record<string, unknown>[]) ?? []).find(
      item => item['parentId'] === 'child-item',
    );
    const visualItemId = visualItem?.['id'];
    const transformAsset = findTimelineAsset(recombined, 'child-comp', 'child-item', 'TransformTrack');
    const colorAsset = typeof visualItemId === 'string'
      ? findTimelineAsset(recombined, 'child-comp', visualItemId, 'SpriteColorTrack')
      : undefined;
    const positionOverLifetime = transformAsset?.['positionOverLifetime'] as Record<string, unknown>;
    const sizeOverLifetime = transformAsset?.['sizeOverLifetime'] as Record<string, unknown>;
    const rotationOverLifetime = transformAsset?.['rotationOverLifetime'] as Record<string, unknown>;
    const colorOverLifetime = colorAsset?.['colorOverLifetime'] as Record<string, unknown>;
    const renderer = findComponent(recombined, 'sprite-component')?.['renderer'] as Record<string, unknown>;

    expect(positionOverLifetime['path']).toBeDefined();
    expect(sizeOverLifetime['x']).toEqual(expect.any(Array));
    expect(sizeOverLifetime['y']).toEqual(expect.any(Array));
    expect(rotationOverLifetime['z']).toEqual(expect.any(Array));
    expect(colorOverLifetime['opacity']).toEqual(expect.any(Array));
    expect(visualItem).toMatchObject({ parentId: 'child-item' });
    expect(renderer['anchor']).toBeUndefined();
  });

  it('replaces stale expanded timeline curves when an animation is changed back to static', () => {
    const firstSplit = convertGEToDSL(createPrecompScene(), { frameRate: 30 });
    const firstEdit = structuredClone(firstSplit.dsl);
    const firstChild = (firstEdit.layers[0].children ?? [])[0];
    const easing: [number, number, number, number] = [0.42, 0, 0.58, 1];
    const firstBasePosition: [number, number, number] = firstChild.position.a
      ? [200, 150, 0]
      : firstChild.position.value;

    firstChild.position = {
      a: true,
      animation: [
        {
          t: [0, 2],
          start: firstBasePosition,
          end: [firstBasePosition[0] + 40, firstBasePosition[1] + 20, firstBasePosition[2]],
          easing,
        },
      ],
    };
    firstChild.scale = {
      a: true,
      animation: [{ t: [0, 2], start: [1, 1, 1], end: [1.3, 1.3, 1], easing }],
    };
    firstChild.rotation = {
      a: true,
      animation: [{ t: [0, 2], start: [0, 0, 0], end: [0, 0, 30], easing }],
    };
    firstChild.opacity = {
      a: true,
      animation: [{ t: [0, 2], start: [1], end: [0.35], easing }],
    };

    const animatedScene = convertDSLToGE(firstEdit, firstSplit.preservedData) as unknown as Record<string, unknown>;
    const animatedTransformAsset = findTimelineAsset(animatedScene, 'child-comp', 'child-item', 'TransformTrack');

    expect((animatedTransformAsset?.['positionOverLifetime'] as Record<string, unknown>)['path']).toBeDefined();

    const secondSplit = convertGEToDSL(animatedScene, { frameRate: 30 });
    const secondEdit = structuredClone(secondSplit.dsl);
    const secondChild = (secondEdit.layers[0].children ?? [])[0];
    const staticPosition: [number, number, number] = secondChild.position.a
      ? [240, 160, 0]
      : [...secondChild.position.value];

    staticPosition[0] += 10;
    secondChild.position = { a: false, value: staticPosition };
    secondChild.scale = { a: false, value: [2, 2, 1] };
    secondChild.rotation = { a: false, value: [0, 0, 12] };
    secondChild.opacity = { a: false, value: 0.4 };

    const recombined = convertDSLToGE(secondEdit, secondSplit.preservedData) as unknown as Record<string, unknown>;
    const transformAsset = findTimelineAsset(recombined, 'child-comp', 'child-item', 'TransformTrack');
    const colorAsset = findTimelineAsset(recombined, 'child-comp', 'child-item', 'SpriteColorTrack');
    const size = transformAsset?.['sizeOverLifetime'] as Record<string, unknown>;
    const color = colorAsset?.['colorOverLifetime'] as Record<string, unknown>;
    const itemTransform = findItem(recombined, 'child-item')?.['transform'] as Record<string, unknown>;
    const euler = itemTransform['eulerHint'] as Record<string, unknown>;
    const roundTrippedChild = (convertGEToDSL(recombined, { frameRate: 30 }).dsl.layers[0].children ?? [])[0];

    expect(transformAsset?.['positionOverLifetime']).toEqual({});
    expect(size['x']).toEqual(expect.any(Array));
    expect((size['x'] as unknown[])[1]).toBe(2);
    expect(transformAsset?.['rotationOverLifetime']).toEqual(expect.any(Object));
    expect(euler['z']).toBe(0);
    expect((color['opacity'] as unknown[])[1]).toBe(0.4);
    expect(roundTrippedChild.position).toEqual(secondChild.position);
    expect(roundTrippedChild.scale).toEqual(secondChild.scale);
    expect(roundTrippedChild.rotation).toEqual(secondChild.rotation);
    expect(roundTrippedChild.opacity).toEqual(secondChild.opacity);
  });

  it.each([34, undefined])('writes text edits into expanded precomps with line height %s', lineHeight => {
    const scene = createPrecompTextScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];

    child.name = 'RenamedText';
    child.time_range = [0.25, 1.75];
    child.text = {
      content: 'Updated',
      font: 'Arial',
      size: 28,
      color: '#00ff00',
      align: 'right',
      line_height: lineHeight,
      letter_spacing: 2,
    };

    const recombined = convertDSLToGE(edited, preservedData) as unknown as Record<string, unknown>;
    const item = findItem(recombined, 'child-item');
    const component = findComponent(recombined, 'sprite-component');
    const options = component?.['options'] as Record<string, unknown>;

    expect(item).toMatchObject({ name: 'RenamedText', delay: 0.25, duration: 1.5 });
    expect(options).toMatchObject({
      text: 'Updated',
      fontFamily: 'Arial',
      fontSize: 28,
      textColor: [0, 1, 0, 1],
      textAlign: 2,
      lineHeight: lineHeight ?? 28 * 1.2,
      letterSpace: 2,
    });
  });

  it('deletes an expanded precomp child from its semantic Composition', () => {
    const { dsl, preservedData } = convertGEToDSL(createPrecompScene(), { frameRate: 30 });
    const edited = structuredClone(dsl);
    const childId = (edited.layers[0].children ?? [])[0].id;
    const warnings: Array<{ code: string; layerId?: string }> = [];
    const mapping = preservedData.ir.layerMapping.layers[childId];

    edited.layers[0].children = [];
    const updated = updateIRFromDSL(preservedData.ir.baselineScene, edited, preservedData.ir.layerMapping, {
      onWarning: warning => warnings.push(warning),
    });
    const childCompositionId = mapping.expandedSource?.irCompositionId;
    const childComposition = updated.compositions.find(
      composition => composition.id === childCompositionId,
    );

    expect(childComposition?.layers.some(layer => layer.id === mapping.irLayerId)).toBe(false);
    expect(warnings).not.toContainEqual(expect.objectContaining({ layerId: childId }));
  });

  it('reframes every Composition and Precomp source start when DSL fps changes', () => {
    const { dsl, preservedData } = convertGEToDSL(createPrecompScene(), { frameRate: 30 });
    const edited = structuredClone(dsl);
    const baselineDurations = new Map(
      preservedData.ir.baselineScene.compositions.map(composition => [
        composition.id,
        (composition.outPoint - composition.inPoint) / 30,
      ]),
    );
    const entry = preservedData.ir.baselineScene.compositions.find(
      composition => composition.id === preservedData.ir.baselineScene.entryCompositionId,
    );
    const precomp = entry?.layers.find(layer => layer.type === 'precomp');

    if (precomp?.type === 'precomp') {
      precomp.time.sourceStartFrame = 15;
    }
    edited.meta.fps = 60;
    const updated = updateIRFromDSL(preservedData.ir.baselineScene, edited, preservedData.ir.layerMapping);
    const updatedEntry = updated.compositions.find(composition => composition.id === updated.entryCompositionId);
    const updatedPrecomp = updatedEntry?.layers.find(layer => layer.type === 'precomp');

    for (const composition of updated.compositions) {
      expect(composition.frameRate).toBe(60);
      expect((composition.outPoint - composition.inPoint) / 60).toBe(baselineDurations.get(composition.id));
    }
    expect(updatedPrecomp?.type === 'precomp' ? updatedPrecomp.time.sourceStartFrame : undefined).toBe(30);
  });

  it('preservedData bundle survives a JSON round-trip (integrator may persist it)', () => {
    const scene = sampleScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });

    const preservedData2 = JSON.parse(JSON.stringify(preservedData));
    const dsl2 = JSON.parse(JSON.stringify(dsl));

    expect(dsl2).toStrictEqual(dsl);
    expect(preservedData2).toStrictEqual(preservedData);

    const directIR = updateIRFromDSL(preservedData.ir.baselineScene, dsl, preservedData.ir.layerMapping);
    const roundTripIR = updateIRFromDSL(preservedData2.ir.baselineScene, dsl2, preservedData2.ir.layerMapping);

    expect(roundTripIR).toEqual(directIR);
    const recombined = convertDSLToGE(dsl2, preservedData2);

    expect(JSON.parse(JSON.stringify(recombined))).toStrictEqual(recombined);
  });

  it('an edit made on the pure DSL lands in the round-tripped GE', () => {
    const scene = sampleScene();
    const { dsl, preservedData } = convertGEToDSL(scene, { frameRate: 30 });

    const edited = JSON.parse(JSON.stringify(dsl)) as typeof dsl;
    const child = (edited.layers[0].children ?? [])[0] ?? edited.layers[1];

    child.opacity = { a: false, value: 0.4 };

    const updatedIR = updateIRFromDSL(preservedData.ir.baselineScene, edited, preservedData.ir.layerMapping);
    const childIRLayerId = preservedData.ir.layerMapping.layers[child.id].irLayerId;
    const irChild = getIRSceneEntryComposition(updatedIR).layers.find(layer => layer.id === childIRLayerId);

    expect(irChild?.transform?.opacity).toEqual({ type: 'static', value: 0.4 });
    expect(() => convertDSLToGE(edited, preservedData)).not.toThrow();
  });
});

function readObjectBindingChildTrackTypes(scene: Record<string, unknown>, itemId: string | undefined): unknown[] {
  if (itemId == null) {
    return [];
  }

  const components = scene['components'] as Record<string, unknown>[];
  const rootComposition = (scene['compositions'] as Record<string, unknown>[]).find(
    comp => comp['id'] === scene['compositionId'],
  );
  const rootComponent = components.find(
    component => component['id'] === (rootComposition?.['components'] as Array<{ id: string }>)[0]?.id,
  );
  const binding = (
    rootComponent?.['sceneBindings'] as Array<{ key: { id: string }; value: { id: string } }> | undefined
  )?.find(entry => entry.value.id === itemId);
  const miscs = scene['miscs'] as Record<string, unknown>[];
  const miscById = new Map(miscs.map(misc => [misc['id'], misc]));
  const objectBindingTrack = binding != null ? miscById.get(binding.key.id) : undefined;

  return ((objectBindingTrack?.['children'] as Array<{ id: string }> | undefined) ?? []).map(
    ref => miscById.get(ref.id)?.['dataType'],
  );
}

function findImageUrl(scene: Record<string, unknown>, imageId: string): unknown {
  return ((scene['images'] as Record<string, unknown>[]) ?? []).find(image => image['id'] === imageId)?.['url'];
}

function findImageUrlForComponent(scene: Record<string, unknown>, componentId: string): unknown {
  const component = ((scene['components'] as Record<string, unknown>[]) ?? []).find(
    entry => entry['id'] === componentId,
  );
  const textureId = (
    (component?.['renderer'] as Record<string, unknown> | undefined)?.['texture'] as Record<string, unknown> | undefined
  )?.['id'];
  const texture = ((scene['textures'] as Record<string, unknown>[]) ?? []).find(entry => entry['id'] === textureId);
  const imageId = (texture?.['source'] as Record<string, unknown> | undefined)?.['id'];

  return typeof imageId === 'string' ? findImageUrl(scene, imageId) : undefined;
}

function findRootFirstItem(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  const rootComposition = (scene['compositions'] as Record<string, unknown>[]).find(
    comp => comp['id'] === scene['compositionId'],
  );
  const rootItemId = (rootComposition?.['children'] as Array<{ id: string }>)[0]?.id;

  return ((scene['items'] as Record<string, unknown>[]) ?? []).find(item => item['id'] === rootItemId);
}

function findItem(scene: Record<string, unknown>, itemId: string): Record<string, unknown> | undefined {
  return ((scene['items'] as Record<string, unknown>[]) ?? []).find(item => item['id'] === itemId);
}

function findComponent(scene: Record<string, unknown>, componentId: string): Record<string, unknown> | undefined {
  return ((scene['components'] as Record<string, unknown>[]) ?? []).find(
    component => component['id'] === componentId,
  );
}

function findTimelineAsset(
  scene: Record<string, unknown>,
  compositionId: string,
  itemId: string,
  trackType: string,
): Record<string, unknown> | undefined {
  const composition = (scene['compositions'] as Record<string, unknown>[]).find(
    entry => entry['id'] === compositionId,
  );
  const componentId = ((composition?.['components'] as Array<{ id: string }> | undefined) ?? [])[0]?.id;
  const component = findComponent(scene, componentId);
  const binding = (
    component?.['sceneBindings'] as Array<{ key: { id: string }; value: { id: string } }> | undefined
  )?.find(entry => entry.value.id === itemId);
  const miscs = (scene['miscs'] as Record<string, unknown>[]) ?? [];
  const miscById = new Map(miscs.map(misc => [misc['id'], misc]));
  const objectBindingTrack = binding != null ? miscById.get(binding.key.id) : undefined;
  const trackRef = (objectBindingTrack?.['children'] as Array<{ id: string }> | undefined)?.find(
    ref => miscById.get(ref.id)?.['dataType'] === trackType,
  );
  const track = trackRef != null ? miscById.get(trackRef.id) : undefined;
  const assetId = ((track?.['clips'] as Array<{ asset: { id: string } }> | undefined) ?? [])[0]?.asset.id;

  return assetId != null ? miscById.get(assetId) : undefined;
}

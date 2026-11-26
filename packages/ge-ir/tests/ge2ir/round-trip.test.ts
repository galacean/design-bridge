import { getCompositionItemIds } from '../../src/ge2ir/parser/build-scene-context';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IRComposition, IRLayer, IRMask, IRScene } from '@galacean/animation-ir';
import {
  IREndBehavior, IRPaintType, IRMaskMode, IRMatteMode, IRShapePrimitiveType,
  IRTextureScaleMode,
} from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import {
  BezierKeyframeType, DataType, EndBehavior, ItemType, TextSizeMode, TexturePaintScaleMode, ValueType,
} from '@galacean/effects-specification';
import {
  convertGEToIR as convertGEToIRScene, convertIRToGE as convertIRSceneToGE,
  type GEToIRResult, type GEToIRPreservedData,
} from '../../src';
import {
  GE_PRESERVED_DATA_VERSION, type EffectsLayerPreservedData, type EffectsSpriteSplit,
} from '../../src/preserved-data';
import { convert3dTo2dPoint } from '../../src/common/coordinate-mapping';
import { parseOpacityAnimation, parseTransformAnimation } from '../../src/ge2ir/parser/animation';
import type { GESceneContext } from '../../src/ge2ir/types';
import {
  createTestIRScene, migrateTestLayerAsset, rememberTestIRSceneAssets, type TestIRLayerOverrides,
} from '../test-ir';

let idCounter = 0;

vi.mock('uuid', () => ({
  v4: () => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`,
}));

beforeEach(() => {
  idCounter = 0;
});

const importedResultByComposition = new WeakMap<IRComposition, GEToIRResult>();

function createMinimalLayer(
  overrides: TestIRLayerOverrides & { orderIndex: number; name: string },
): IRLayer {
  const { orderIndex, imageUrl, imageAssetId, asset, ...layerOverrides } = overrides;
  const id = `layer-${orderIndex}`;

  return {
    id,
    time: { inFrame: 0, outFrame: 90 },
    visible: true,
    transform: {
      position: { type: 'static', value: [360, 640, 0] },
      anchor: { type: 'static', value: [0, 0, 0] },
      scale: { type: 'static', value: [1, 1, 1] },
      rotation: { z: { type: 'static', value: 0 } },
      opacity: { type: 'static', value: 1 },
    },
    ...layerOverrides,
    ...migrateTestLayerAsset(id, overrides.type, imageUrl, imageAssetId, asset),
  } as IRLayer;
}

function createIR(layers: IRLayer[], overrides?: Partial<IRComposition>): IRComposition {
  return {
    id: 'test-composition',
    name: 'test',
    width: 720,
    height: 1280,
    frameRate: 30,
    inPoint: 0,
    outPoint: 90,
    endBehavior: IREndBehavior.Loop,
    layers,
    ...overrides,
  };
}

function convertIRToGE(
  ir: IRComposition,
  duration?: number,
  layerDataById?: Record<string, EffectsLayerPreservedData>,
): ReturnType<typeof convertIRSceneToGE>['scene'] {
  const imported = importedResultByComposition.get(ir);

  if (imported != null) {
    return convertIRSceneToGE(imported.scene, { duration, preservedData: imported.preservedData }).scene;
  }

  const scene = createTestIRScene(ir);

  if (layerDataById == null) {
    return convertIRSceneToGE(scene, { duration }).scene;
  }

  return convertIRSceneToGE(scene, {
    duration,
    preservedData: createTestPreservedData(scene, ir.id, layerDataById),
  }).scene;
}

function convertGEToIR(
  scene: Record<string, unknown>,
  options: Parameters<typeof convertGEToIRScene>[1],
): IRComposition {
  const imported = convertGEToIRScene(scene, options);
  const document = imported.scene;

  rememberTestIRSceneAssets(document);

  for (const composition of document.compositions) {
    importedResultByComposition.set(composition, imported);
  }

  return getIRSceneEntryComposition(document);
}

function createTestPreservedData(
  scene: IRScene,
  compositionId: string,
  layerDataById: Record<string, EffectsLayerPreservedData>,
): GEToIRPreservedData {
  return {
    version: GE_PRESERVED_DATA_VERSION,
    particleSourceData: { particleEffectGroups: [], layers: [] },
    compositionBindings: Object.fromEntries(scene.compositions.map(composition => [
      composition.id,
      {
        sourceCompositionId: composition.id,
        sourceItemOrder: [],
        layerDataById: composition.id === compositionId ? layerDataById : {},
      },
    ])),
  };
}

function getLayerData(
  composition: IRComposition,
  layer: IRLayer = composition.layers[0],
): EffectsLayerPreservedData | undefined {
  return importedResultByComposition.get(composition)?.preservedData
    .compositionBindings[composition.id]?.layerDataById[layer.id];
}

function scalarCurve(startValue: number, endValue: number, startTime = 0, endTime = 1): unknown[] {
  const timeSpan = endTime - startTime;

  return [
    ValueType.BEZIER_CURVE,
    [
      [BezierKeyframeType.EASE_OUT, [startTime, startValue, startTime + timeSpan / 3, startValue]],
      [BezierKeyframeType.EASE_IN, [startTime + (timeSpan * 2) / 3, endValue, endTime, endValue]],
    ],
  ];
}

function findFirstTransformAsset(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  return findTransformAssets(scene)[0];
}

function findTransformAssets(scene: Record<string, unknown>): Array<Record<string, unknown>> {
  const miscs = scene['miscs'] as Array<Record<string, unknown>> | undefined;

  return miscs?.filter(misc => misc['dataType'] === 'TransformPlayableAsset') ?? [];
}

function findFirstSpriteComponent(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  const components = scene['components'] as Array<Record<string, unknown>> | undefined;

  return components?.find(component => component['dataType'] === DataType.SpriteComponent);
}

function findFirstTextComponent(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  const components = scene['components'] as Array<Record<string, unknown>> | undefined;

  return components?.find(component => component['dataType'] === DataType.TextComponent);
}

function compareItems(sourceGE: Record<string, unknown>, roundTripGE: Record<string, unknown>): void {
  const items1 = (sourceGE['items'] as Array<Record<string, unknown>>).map(normalizeItem);
  const items2 = (roundTripGE['items'] as Array<Record<string, unknown>>).map(normalizeItem);

  expect(items2.length).toBe(items1.length);

  for (let i = 0; i < items1.length; i++) {
    const item1 = items1[i];
    const item2 = items2.find(it => it['name'] === item1['name']);

    expect(item2).toBeDefined();
    expect(item2!['type']).toBe(item1['type']);
    expect(item2!['visible']).toBe(item1['visible']);

    const delay1 = item1['delay'] as number;
    const delay2 = item2!['delay'] as number;

    expect(delay2).toBeCloseTo(delay1, 2);

    const dur1 = item1['duration'] as number;
    const dur2 = item2!['duration'] as number;

    expect(dur2).toBeCloseTo(dur1, 2);
  }
}

function normalizeItem(item: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, components: _components, parentId: _parentId, ...rest } = item;

  return rest;
}

interface RoundTripResult {
  sourceGE: Record<string, unknown>;
  parsedIR: IRComposition;
  roundTripGE: Record<string, unknown>;
}

function roundTripTest(
  ir: IRComposition,
  layerDataById?: Record<string, EffectsLayerPreservedData>,
): RoundTripResult {
  // Forward: IR → GE₁
  idCounter = 0;
  const sourceGE = convertIRToGE(ir, undefined, layerDataById) as unknown as Record<string, unknown>;

  expect(JSON.parse(JSON.stringify(sourceGE))).toStrictEqual(sourceGE);

  // Reverse: GE₁ → IR'
  const irPrime = convertGEToIR(sourceGE, { frameRate: ir.frameRate });

  expect(JSON.parse(JSON.stringify(irPrime))).toStrictEqual(irPrime);

  // Forward again: IR' → GE₂
  idCounter = 0;
  const roundTripGE = convertIRToGE(irPrime) as unknown as Record<string, unknown>;

  expect(JSON.parse(JSON.stringify(roundTripGE))).toStrictEqual(roundTripGE);

  // Compare items structurally
  compareItems(sourceGE, roundTripGE);

  // Compare composition-level properties
  const comp1 = (sourceGE['compositions'] as Record<string, unknown>[])[0];
  const comp2 = (roundTripGE['compositions'] as Record<string, unknown>[])[0];

  expect(comp2['name']).toBe(comp1['name']);
  expect(comp2['duration']).toBeCloseTo(comp1['duration'] as number, 2);
  expect(comp2['endBehavior']).toBe(comp1['endBehavior']);
  expect(comp2['previewSize']).toEqual(comp1['previewSize']);

  return { sourceGE, parsedIR: irPrime, roundTripGE };
}

describe('ge2ir round-trip', () => {
  it('wraps the imported GE Composition in an IRScene entry', () => {
    const sourceGE = convertIRToGE(createIR([])) as unknown as Record<string, unknown>;
    const { scene } = convertGEToIRScene(sourceGE, { frameRate: 30 });

    expect(scene.format).toBe('animation-ir');
    expect(scene.schemaVersion).toBe('1.0.0');
    expect(scene.compositions).toHaveLength(1);
    expect(scene.entryCompositionId).toBe(scene.compositions[0].id);
  });

  it('preserves opaque non-empty GE composition ids', () => {
    const generated = convertIRToGE(createIR([])) as unknown as Record<string, unknown>;
    const sourceCompositionId = generated['compositionId'] as string;
    const preserved = convertGEToIR(generated, { frameRate: 30 });
    const opaqueCompositionId = 'composition/中文';
    const serialized = JSON.stringify(generated).replaceAll(sourceCompositionId, opaqueCompositionId);
    const opaqueSource = JSON.parse(serialized) as Record<string, unknown>;
    const normalized = convertGEToIR(opaqueSource, { frameRate: 30 });
    const repeated = convertGEToIR(opaqueSource, { frameRate: 30 });

    expect(preserved.id).toBe(sourceCompositionId);
    expect(normalized.id).toBe(opaqueCompositionId);
    expect(repeated.id).toBe(opaqueCompositionId);
  });

  it('preserves GE item identities when source painter order changes', () => {
    const sourceIR = createIR([
      createMinimalLayer({ id: 'first-ir', orderIndex: 0, name: 'first', type: 'null' }),
      createMinimalLayer({ id: 'second-ir', orderIndex: 1, name: 'second', type: 'null' }),
    ]);
    const sourceGE = convertIRToGE(sourceIR) as unknown as Record<string, unknown>;
    const first = convertGEToIR(sourceGE, { frameRate: 30 });
    const repeated = convertGEToIR(sourceGE, { frameRate: 30 });
    const reorderedGE = structuredClone(sourceGE);
    const composition = (reorderedGE['compositions'] as Array<Record<string, unknown>>)[0];
    const compositionComponentId = (composition['components'] as Array<{ id: string }>)[0].id;
    const compositionComponent = (reorderedGE['components'] as Array<Record<string, unknown>>).find(
      component => component['id'] === compositionComponentId,
    );
    const itemReferences = composition['children'] as Array<Record<string, unknown>>;

    expect(first.layers.every(layer => !Object.hasOwn(layer, 'index'))).toBe(true);

    itemReferences.reverse();
    const timelineId = (compositionComponent?.['timelineAsset'] as { id: string }).id;
    const timeline = (reorderedGE['miscs'] as Record<string, unknown>[]).find(value => value['id'] === timelineId)!;

    (timeline['tracks'] as unknown[]).reverse();

    const reordered = convertGEToIR(reorderedGE, { frameRate: 30 });
    const idByName = (ir: IRComposition) => Object.fromEntries(ir.layers.map(layer => [layer.name, layer.id]));
    const sourceItemIds = (sourceGE['items'] as Array<Record<string, unknown>>).map(item => item['id']);

    expect(idByName(repeated)).toEqual(idByName(first));
    expect(idByName(reordered)).toEqual(idByName(first));
    expect(new Set(first.layers.map(layer => layer.id))).toEqual(new Set(sourceItemIds));
    expect(first.layers.map(layer => layer.name)).toEqual(['first', 'second']);
    expect(reordered.layers.map(layer => layer.id)).toEqual([...first.layers.map(layer => layer.id)].reverse());
  });

  it('preserves opaque non-empty GE item ids', () => {
    const sourceIR = createIR([createMinimalLayer({ id: 'source', orderIndex: 0, name: 'item', type: 'null' })]);
    const generated = convertIRToGE(sourceIR) as unknown as Record<string, unknown>;
    const originalItemId = (generated['items'] as Array<Record<string, unknown>>)[0]['id'] as string;
    const opaqueItemId = 'item/中文';
    const serialized = JSON.stringify(generated).replaceAll(originalItemId, opaqueItemId);
    const sourceGE = JSON.parse(serialized) as Record<string, unknown>;

    const first = convertGEToIR(sourceGE, { frameRate: 30 });
    const repeated = convertGEToIR(sourceGE, { frameRate: 30 });

    expect(first.layers[0].id).toBe(opaqueItemId);
    expect(repeated.layers[0].id).toBe(opaqueItemId);
  });

  it('keeps an opaque GE image source id consistent through the import registry', () => {
    const sourceIR = createIR([
      createMinimalLayer({
        id: 'source-image',
        orderIndex: 0,
        name: 'image',
        type: 'image',
        imageUrl: 'https://example.com/image.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    const generated = convertIRToGE(sourceIR) as unknown as Record<string, unknown>;
    const originalImageId = (generated['images'] as Array<Record<string, unknown>>)[0]?.['id'];

    if (typeof originalImageId !== 'string') {
      throw new Error('generated GE fixture has no image id');
    }
    const opaqueImageId = 'image/中文';
    const opaqueSource = JSON.parse(
      JSON.stringify(generated).replaceAll(originalImageId, opaqueImageId),
    ) as Record<string, unknown>;
    const imported = convertGEToIRScene(opaqueSource, { frameRate: 30 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const imageLayer = composition.layers.find(layer => layer.type === 'image');
    const imageAsset = imported.scene.assets.find(asset => asset.type === 'image');

    expect(imageAsset?.id).toBe(opaqueImageId);
    expect(imageLayer?.type === 'image' ? imageLayer.content.assetId : undefined).toBe(imageAsset?.id);
    expect(() => assertIRScene(imported.scene)).not.toThrow();
  });

  it('preserves a GE composition duration that ends between frames', () => {
    const sourceGE = convertIRToGE(createIR([], { outPoint: 121.25 })) as unknown as Record<string, unknown>;
    const ir = convertGEToIR(sourceGE, { frameRate: 30 });
    const roundTripGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const composition = (roundTripGE['compositions'] as Record<string, unknown>[])[0];

    expect(ir.outPoint).toBeCloseTo(121.25, 12);
    expect(composition['duration']).toBeCloseTo(121.25 / 30, 12);
  });

  it('round-trips a centered image layer', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'bg',
        type: 'image',
        imageUrl: 'https://example.com/bg.png',
        localBounds: { x: 0, y: 0, width: 720, height: 1280 },
      }),
    ]);

    roundTripTest(ir);
  });

  it('requires GE Image display bounds instead of inferring them from image metadata', () => {
    const sourceGE = convertIRToGE(createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'image-without-display-size',
        type: 'image',
        imageUrl: 'https://example.com/image.png',
        localBounds: { x: 0, y: 0, width: 320, height: 180 },
      }),
    ])) as unknown as Record<string, unknown>;
    const spriteItem = (sourceGE['items'] as Array<Record<string, unknown>>).find(
      item => item['type'] === ItemType.sprite,
    );
    const transform = spriteItem?.['transform'] as Record<string, unknown> | undefined;
    const image = (sourceGE['images'] as Array<Record<string, unknown>> | undefined)?.[0];

    expect(transform?.['size']).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    if (transform != null) {
      delete transform['size'];
    }
    if (image != null) {
      image['width'] = 2048;
      image['height'] = 1024;
    }

    expect(() => convertGEToIRScene(sourceGE, { frameRate: 30 }))
      .toThrow(/IR_LAYER_LOCAL_BOUNDS_INVALID/);
  });

  it('preserves atlas sprite split parameters', () => {
    const spriteSplits: EffectsSpriteSplit[] = [
      [0, 0.25, 0.5, 0.5, 0],
      [0.5, 0.75, 0.25, 0.125, 1],
    ];
    const ir = createIR(
      [
        createMinimalLayer({
          orderIndex: 0,
          name: 'atlas-region',
          type: 'image',
          imageUrl: 'https://example.com/atlas.png',
          localBounds: { x: 0, y: 0, width: 512, height: 512 },
        }),
      ],
    );

    const { parsedIR, sourceGE, roundTripGE } = roundTripTest(ir, {
      'layer-0': { spriteSplits },
    });

    expect(findFirstSpriteComponent(sourceGE)?.['splits']).toEqual(spriteSplits);
    expect(getLayerData(parsedIR)?.spriteSplits).toEqual(spriteSplits);
    expect(findFirstSpriteComponent(roundTripGE)?.['splits']).toEqual(spriteSplits);
  });

  it('preserves sprite texture sheet animation parameters', () => {
    const textureSheetAnimation = {
      col: 6,
      row: 6,
      total: 36,
      animate: true,
      loop: true,
    };
    const ir = createIR(
      [
        createMinimalLayer({
          orderIndex: 0,
          name: 'frame-animation',
          type: 'image',
          imageUrl: 'https://example.com/frames.png',
          localBounds: { x: 0, y: 0, width: 200, height: 200 },
        }),
      ],
    );

    const { parsedIR, sourceGE, roundTripGE } = roundTripTest(ir, {
      'layer-0': { textureSheetAnimation },
    });

    expect(findFirstSpriteComponent(sourceGE)?.['textureSheetAnimation']).toEqual(textureSheetAnimation);
    expect(getLayerData(parsedIR)?.textureSheetAnimation).toEqual(textureSheetAnimation);
    expect(findFirstSpriteComponent(roundTripGE)?.['textureSheetAnimation']).toEqual(textureSheetAnimation);
  });

  it('preserves texture sheet animation parameters on text components', () => {
    const textureSheetAnimation = { row: 1, col: 1, animate: false };
    const ir = createIR(
      [
        createMinimalLayer({
          orderIndex: 0,
          name: 'text-frame',
          type: 'text',
          localBounds: { x: 0, y: 0, width: 200, height: 40 },
          content: {
            text: 'Hello',
            fontAssetId: 'font:test-arial',
            fontSize: 24,
            color: [1, 1, 1, 1],
            letterSpacing: 0,
            lineHeight: 24,
            textAlign: 'center',
          },
        }),
      ],
    );

    const { parsedIR, sourceGE, roundTripGE } = roundTripTest(ir, {
      'layer-0': { textureSheetAnimation },
    });

    expect(findFirstTextComponent(sourceGE)?.['textureSheetAnimation']).toEqual(textureSheetAnimation);
    expect(getLayerData(parsedIR)?.textureSheetAnimation).toEqual(textureSheetAnimation);
    expect(findFirstTextComponent(roundTripGE)?.['textureSheetAnimation']).toEqual(textureSheetAnimation);
  });

  it('round-trips a solid color layer', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'solid',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 200, height: 200 },
      }),
    ]);

    const { parsedIR } = roundTripTest(ir);
    const parsedSolid = parsedIR.layers[0];

    expect(parsedSolid?.type === 'solid' ? parsedSolid.content.color : undefined).toEqual([1, 0, 0, 1]);
  });

  it('does not inherit pivot Null bounds when a GE Solid child has no display size', () => {
    const sourceGE = convertIRToGE(createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'split-solid-without-display-size',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 200, height: 100 },
      }),
    ]), undefined, {
      'layer-0': { sourceHierarchy: 'null-sprite-pair' },
    }) as unknown as Record<string, unknown>;
    const items = sourceGE['items'] as Array<Record<string, unknown>>;
    const nullItem = items.find(item => item['type'] === ItemType.null);
    const solidItem = items.find(item => item['type'] === ItemType.sprite);
    const nullTransform = nullItem?.['transform'] as Record<string, unknown> | undefined;
    const solidTransform = solidItem?.['transform'] as Record<string, unknown> | undefined;

    expect(nullTransform).toBeDefined();
    expect(solidTransform?.['size']).toBeDefined();
    if (nullTransform != null) {
      nullTransform['size'] = { x: 4, y: 2 };
    }
    if (solidTransform != null) {
      delete solidTransform['size'];
    }

    expect(() => convertGEToIRScene(sourceGE, { frameRate: 30 }))
      .toThrow(/IR_LAYER_LOCAL_BOUNDS_INVALID/);
  });

  it('round-trips a null layer', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'ctrl',
        type: 'null',
      }),
    ]);

    roundTripTest(ir);
  });

  it('round-trips a text layer', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'center',
        },
      }),
    ]);

    const { parsedIR, sourceGE, roundTripGE } = roundTripTest(ir);

    expect(parsedIR.layers[0].transform?.scale).toBeUndefined();

    for (const scene of [sourceGE, roundTripGE]) {
      const transformAssets = findTransformAssets(scene);

      expect(transformAssets.length).toBeGreaterThan(0);
      expect(transformAssets.every(asset => asset['sizeOverLifetime'] == null)).toBe(true);
    }
  });

  it('maps external Font Assets through the GE font registry', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'web-font-title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:web-inter',
          fontSize: 24,
          color: [1, 1, 1, 1],
          letterSpacing: 0,
          lineHeight: 28,
          textAlign: 'left',
        },
      }),
    ]);
    const document = createTestIRScene(ir);

    document.assets = [{
      id: 'font:web-inter',
      type: 'font',
      family: 'Inter',
      style: 'italic',
      weight: 650,
      source: { kind: 'url', url: 'https://example.com/Inter-Regular.woff2' },
    }];

    const sourceGE = convertIRSceneToGE(document).scene;
    const result = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const parsedLayer = getIRSceneEntryComposition(result.scene).layers[0];
    const fontAssetId = parsedLayer.type === 'text' ? parsedLayer.content.fontAssetId : undefined;
    const fontAsset = result.scene.assets.find(asset => asset.id === fontAssetId);
    const textOptions = (findFirstTextComponent(sourceGE as unknown as Record<string, unknown>)?.['options'] ?? {}) as
      Record<string, unknown>;

    expect(sourceGE.fonts).toEqual([{
      fontFamily: 'Inter',
      fontURL: 'https://example.com/Inter-Regular.woff2',
    }]);
    expect(textOptions).toMatchObject({
      fontFamily: 'Inter',
      fontWeight: 650,
      fontStyle: 'italic',
      lineHeight: 28,
      textWidth: 200,
      textHeight: 40,
      autoResize: TextSizeMode.fixed,
    });
    expect(fontAsset).toEqual({
      id: fontAssetId,
      type: 'font',
      family: 'Inter',
      style: 'italic',
      weight: 650,
      source: { kind: 'url', url: 'https://example.com/Inter-Regular.woff2' },
    });
    expect(parsedLayer.localBounds?.width).toBeCloseTo(200, 2);
    expect(parsedLayer.localBounds?.height).toBeCloseTo(40, 2);
    expect(parsedLayer.type === 'text' ? parsedLayer.content : undefined).toEqual({
      text: 'Hello',
      fontAssetId,
      fontSize: 24,
      color: [1, 1, 1, 1],
      textAlign: 'left',
      letterSpacing: 0,
      lineHeight: 28,
    });
    expect(() => assertIRScene(result.scene)).not.toThrow();
  });

  it('moves GE text metrics into localBounds and normalizes invalid lineHeight', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'legacy-ge-text-metrics',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 1, 1, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'left',
        },
      }),
    ]);
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const textItem = (sourceGE['items'] as Array<Record<string, unknown>>).find(item => item['type'] === 'text');
    const itemTransform = textItem?.['transform'] as Record<string, unknown> | undefined;
    const textComponent = findFirstTextComponent(sourceGE);
    const options = textComponent?.['options'] as Record<string, unknown> | undefined;

    if (itemTransform == null || options == null) {
      throw new Error('expected generated GE text data');
    }
    delete itemTransform['size'];
    options['textWidth'] = 180;
    options['textHeight'] = 56;
    options['lineHeight'] = 0;
    options['autoWidth'] = false;
    options['fontWeight'] = 550;
    options['fontStyle'] = 'oblique';

    const result = convertGEToIRScene(sourceGE, { frameRate: 30 });
    const parsedLayer = getIRSceneEntryComposition(result.scene).layers[0];
    const fontAssetId = parsedLayer.type === 'text' ? parsedLayer.content.fontAssetId : undefined;
    const fontAsset = result.scene.assets.find(asset => asset.id === fontAssetId);

    expect(parsedLayer.localBounds).toEqual({ x: 0, y: 0, width: 180, height: 56 });
    expect(parsedLayer.type === 'text' ? parsedLayer.content.lineHeight : undefined).toBe(24);
    expect(parsedLayer.type === 'text' ? parsedLayer.content : undefined).not.toHaveProperty('autoWidth');
    expect(fontAsset).toMatchObject({ type: 'font', weight: 550, style: 'oblique' });
  });

  it('preserves explicit auto-width text inside a Precomp', () => {
    const sourceGE = createPrecompScene();
    const sourceTextComponent = (sourceGE['components'] as Record<string, unknown>[]).find(
      component => component['id'] === 'sprite-component',
    );
    const sourceTextItem = (sourceGE['items'] as Record<string, unknown>[]).find(
      item => item['id'] === 'child-item',
    );
    const sourceTransform = sourceTextItem?.['transform'] as Record<string, unknown> | undefined;

    if (sourceTextComponent == null || sourceTextItem == null || sourceTransform == null) {
      throw new Error('expected child GE visual data');
    }
    sourceTextComponent['dataType'] = 'TextComponent';
    sourceTextComponent['options'] = {
      text: '日进斗金',
      fontFamily: 'sans-serif',
      fontSize: 68,
      textColor: [0.9961, 0.2078, 0.00392, 1],
      fontWeight: 'bold',
      letterSpace: 0,
      textAlign: 1,
      fontStyle: 'normal',
      autoWidth: true,
      autoResize: TextSizeMode.autoWidth,
      textWidth: 274,
      textHeight: 107,
      lineHeight: 106.862,
      size: [2.3437, 0.9152],
    };
    sourceTextComponent['renderer'] = { renderMode: 1, anchor: [0.501, 0.9258] };
    sourceTextItem['type'] = 'text';
    sourceTransform['scale'] = { x: 2.3437, y: 0.9152, z: 1 };
    delete sourceTransform['size'];

    const imported = convertGEToIRScene(sourceGE, { frameRate: 30 });
    const importedComposition = imported.scene.compositions.find(composition => composition.id === 'child-comp');
    const importedLayer = importedComposition?.layers[0];

    if (importedComposition == null || importedLayer == null) {
      throw new Error('expected imported child text Layer');
    }

    expect(
      imported.preservedData.compositionBindings[importedComposition.id]?.layerDataById[importedLayer.id],
    ).toMatchObject({ textSizeMode: 'auto-width' });

    const roundTripGE = convertIRSceneToGE(imported.scene, {
      preservedData: imported.preservedData,
    }).scene as unknown as Record<string, unknown>;
    const roundTripOptions = findFirstTextComponent(roundTripGE)?.['options'] as Record<string, unknown>;
    const roundTripTextItem = (roundTripGE['items'] as Record<string, unknown>[]).find(item => item['type'] === 'text');
    const roundTripTransform = roundTripTextItem?.['transform'] as Record<string, unknown>;

    expect(roundTripOptions).toMatchObject({
      fontWeight: 'bold',
      autoResize: TextSizeMode.autoWidth,
    });
    expect(roundTripTransform).not.toHaveProperty('size');
  });

  it.each([
    { textAlign: 'left' as const },
    { textAlign: 'center' as const },
    { textAlign: 'right' as const },
  ])('round-trips $textAlign static text through standard Anchor/Position', ({ textAlign }) => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: `${textAlign}-static-text`,
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign,
        },
        transform: {
          position: { type: 'static', value: [300, 500, 0] },
          anchor: { type: 'static', value: [20, 10, 0] },
          scale: { type: 'static', value: [1.25, 0.75, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const { parsedIR } = roundTripTest(ir);
    const parsedLayer = parsedIR.layers[0];
    const parsedAnchor = parsedLayer.transform?.anchor;
    const parsedPosition = parsedLayer.transform?.position;

    expect(parsedAnchor?.type).toBe('static');
    if (parsedAnchor?.type === 'static') {
      expect(parsedAnchor.value[0]).toBeCloseTo(20, 2);
      expect(parsedAnchor.value[1]).toBeCloseTo(10, 2);
      expect(parsedAnchor.value[2]).toBe(0);
    }
    expect(parsedPosition?.type).toBe('static');
    if (parsedPosition?.type === 'static') {
      expect(parsedPosition?.value[0]).toBeCloseTo(300, 2);
      expect(parsedPosition?.value[1]).toBeCloseTo(500, 2);
    }
  });

  it.each(['left', 'center', 'right'] as const)(
    'preserves %s text item base and raw additive position path',
    textAlign => {
      const ir = createIR([
        createMinimalLayer({
          orderIndex: 0,
          name: `${textAlign}-animated-text`,
          type: 'text',
          localBounds: { x: 0, y: 0, width: 200, height: 40 },
          content: {
            text: 'Hello',
            fontAssetId: 'font:test-arial',
            fontSize: 24,
            color: [1, 0, 0, 1],
            letterSpacing: 0,
            lineHeight: 24,
            textAlign,
          },
          transform: {
            position: {
              type: 'keyframed',
              keyframes: [
                { frame: 0, value: [300, 500, 0], outTangent: { x: 0.33, y: 0.33 } },
                { frame: 90, value: [420, 620, 0], inTangent: { x: 0.67, y: 0.67 } },
              ],
            },
            anchor: { type: 'static', value: [20, 10, 0] },
            scale: { type: 'static', value: [1.25, 0.75, 1] },
            rotation: { z: { type: 'static', value: 0 } },
            opacity: { type: 'static', value: 1 },
          },
        }),
      ]);
      const { sourceGE, parsedIR, roundTripGE } = roundTripTest(ir);
      const sourceItem = (sourceGE['items'] as Array<Record<string, unknown>>)[0];
      const roundTripItem = (roundTripGE['items'] as Array<Record<string, unknown>>)[0];
      const sourcePositionPath = findFirstTransformAsset(sourceGE)?.['positionOverLifetime'];
      const roundTripPositionPath = findFirstTransformAsset(roundTripGE)?.['positionOverLifetime'];
      const sourcePosition = (sourceItem['transform'] as Record<string, unknown>)['position'] as
        Record<string, number>;
      const roundTripPosition = (roundTripItem['transform'] as Record<string, unknown>)['position'] as
        Record<string, number>;

      expect(parsedIR.layers[0].transform?.position?.type).toBe('static');
      expect(getLayerData(parsedIR)?.positionOverLifetime).toEqual(sourcePositionPath);
      expect(roundTripPosition['x']).toBeCloseTo(sourcePosition['x'], 12);
      expect(roundTripPosition['y']).toBeCloseTo(sourcePosition['y'], 12);
      expect(roundTripPosition['z']).toBeCloseTo(sourcePosition['z'], 12);
      expect(roundTripPositionPath).toEqual(sourcePositionPath);
    },
  );

  it.each([
    { label: 'zero', sourcePosition: { x: 0, y: 0, z: 0 } },
    { label: 'non-zero', sourcePosition: { x: 1.25, y: -2.5, z: 0 } },
  ])('preserves a $label GE item base beside its raw additive position path', ({ sourcePosition }) => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'animated-image',
        type: 'image',
        imageUrl: 'https://example.com/animated-image.png',
        localBounds: { x: 0, y: 0, width: 100, height: 80 },
        transform: {
          position: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: [240, 400, 0], outTangent: { x: 0.33, y: 0.33 } },
              { frame: 90, value: [480, 760, 0], inTangent: { x: 0.67, y: 0.67 } },
            ],
          },
          anchor: { type: 'static', value: [0, 0, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const sourceItem = (sourceGE['items'] as Array<Record<string, unknown>>).find(
      item => item['name'] === 'animated-image',
    );
    const sourceTransform = sourceItem?.['transform'] as Record<string, unknown> | undefined;
    const sourcePositionPath = findFirstTransformAsset(sourceGE)?.['positionOverLifetime'];

    if (sourceTransform == null || sourcePositionPath == null) {
      throw new Error('expected animated GE image data');
    }
    sourceTransform['position'] = sourcePosition;

    const parsedIR = convertGEToIR(sourceGE, { frameRate: 30 });
    const parsedLayer = parsedIR.layers[0];
    const roundTripGE = convertIRToGE(parsedIR) as unknown as Record<string, unknown>;
    const roundTripItem = (roundTripGE['items'] as Array<Record<string, unknown>>).find(
      item => item['name'] === 'animated-image',
    );
    const roundTripPosition = (roundTripItem?.['transform'] as Record<string, unknown> | undefined)?.['position'] as
      Record<string, unknown> | undefined;

    expect(parsedLayer.transform?.position?.type).toBe('static');
    expect(getLayerData(parsedIR, parsedLayer)?.positionOverLifetime).toEqual(sourcePositionPath);
    expect(roundTripPosition?.['x']).toBeCloseTo(sourcePosition.x, 4);
    expect(roundTripPosition?.['y']).toBeCloseTo(sourcePosition.y, 4);
    expect(roundTripPosition?.['z']).toBeCloseTo(sourcePosition.z, 4);
    expect(findFirstTransformAsset(roundTripGE)?.['positionOverLifetime']).toEqual(sourcePositionPath);
  });

  it('preserves a parented GE child base beside its raw additive position path', () => {
    const parentLayerId = 'parent-layer';
    const ir = createIR([
      createMinimalLayer({ id: parentLayerId, orderIndex: 0, name: 'parent', type: 'null' }),
      createMinimalLayer({
        id: 'child-layer',
        orderIndex: 1,
        name: 'animated-child',
        type: 'image',
        imageUrl: 'https://example.com/animated-child.png',
        localBounds: { x: 0, y: 0, width: 100, height: 80 },
        parentId: parentLayerId,
        transform: {
          position: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: [240, 400, 0], outTangent: { x: 0.33, y: 0.33 } },
              { frame: 90, value: [480, 760, 0], inTangent: { x: 0.67, y: 0.67 } },
            ],
          },
          anchor: { type: 'static', value: [0, 0, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const sourceItem = (sourceGE['items'] as Array<Record<string, unknown>>).find(
      item => item['name'] === 'animated-child',
    );
    const sourceTransform = sourceItem?.['transform'] as Record<string, unknown> | undefined;
    const sourceTransformAsset = findTransformAssets(sourceGE).find(asset => {
      const position = asset['positionOverLifetime'] as Record<string, unknown> | undefined;

      return position?.['path'] != null;
    });
    const sourcePosition = { x: 0.5, y: -0.75, z: 0 };

    if (sourceTransform == null || sourceTransformAsset == null) {
      throw new Error('expected parented animated GE image data');
    }
    sourceTransform['position'] = sourcePosition;

    const parsedIR = convertGEToIR(sourceGE, { frameRate: 30 });
    const parsedChild = parsedIR.layers.find(layer => layer.name === 'animated-child');
    const roundTripGE = convertIRToGE(parsedIR) as unknown as Record<string, unknown>;
    const roundTripItem = (roundTripGE['items'] as Array<Record<string, unknown>>).find(
      item => item['name'] === 'animated-child',
    );
    const roundTripPosition = (roundTripItem?.['transform'] as Record<string, unknown> | undefined)?.['position'] as
      Record<string, number> | undefined;
    const roundTripTransformAsset = findTransformAssets(roundTripGE).find(asset => {
      const position = asset['positionOverLifetime'] as Record<string, unknown> | undefined;

      return position?.['path'] != null;
    });

    expect(parsedChild?.parentId).toBeDefined();
    expect(parsedChild?.transform?.position?.type).toBe('static');
    expect(parsedChild == null ? undefined : getLayerData(parsedIR, parsedChild)?.positionOverLifetime).toEqual(
      sourceTransformAsset['positionOverLifetime'],
    );
    expect(roundTripItem?.['parentId']).toBeDefined();
    expect(roundTripPosition?.['x']).toBeCloseTo(sourcePosition.x, 4);
    expect(roundTripPosition?.['y']).toBeCloseTo(sourcePosition.y, 4);
    expect(roundTripPosition?.['z']).toBeCloseTo(sourcePosition.z, 4);
    expect(roundTripTransformAsset?.['positionOverLifetime']).toEqual(sourceTransformAsset['positionOverLifetime']);
  });

  it('canonicalizes non-zero text bounds without changing the Anchor/Position transform', () => {
    const sourceBounds = { x: 30, y: 15, width: 200, height: 40 };
    const sourceAnchor = [50, 25, 0] as [number, number, number];
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'offset-bounds-text',
        type: 'text',
        localBounds: sourceBounds,
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'center',
        },
        transform: {
          position: { type: 'static', value: [300, 500, 0] },
          anchor: { type: 'static', value: sourceAnchor },
          scale: { type: 'static', value: [1.25, 0.75, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const { parsedIR } = roundTripTest(ir);
    const parsedLayer = parsedIR.layers[0];
    const parsedAnchor = parsedLayer.transform?.anchor;
    const parsedPosition = parsedLayer.transform?.position;

    expect(parsedLayer.localBounds?.x).toBe(0);
    expect(parsedLayer.localBounds?.y).toBe(0);
    expect(parsedAnchor?.type).toBe('static');
    if (parsedAnchor?.type === 'static') {
      expect(parsedAnchor.value[0] - (parsedLayer.localBounds?.x ?? 0)).toBeCloseTo(
        sourceAnchor[0] - sourceBounds.x,
        2,
      );
      expect(parsedAnchor.value[1] - (parsedLayer.localBounds?.y ?? 0)).toBeCloseTo(
        sourceAnchor[1] - sourceBounds.y,
        2,
      );
    }
    expect(parsedPosition?.type).toBe('static');
    if (parsedPosition?.type === 'static') {
      expect(parsedPosition.value[0]).toBeCloseTo(300, 2);
      expect(parsedPosition.value[1]).toBeCloseTo(500, 2);
    }
  });

  it('uses a single scale keyframe for symmetric text position compensation', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'single-scale-keyframe-text',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'right',
        },
        transform: {
          position: { type: 'static', value: [300, 500, 0] },
          anchor: { type: 'static', value: [20, 10, 0] },
          scale: { type: 'keyframed', keyframes: [{ frame: 0, value: [1.25, 0.75, 1] }] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const { parsedIR } = roundTripTest(ir);
    const parsedPosition = parsedIR.layers[0].transform?.position;

    expect(parsedPosition?.type).toBe('static');
    if (parsedPosition?.type === 'static') {
      expect(parsedPosition.value[0]).toBeCloseTo(300, 2);
      expect(parsedPosition.value[1]).toBeCloseTo(500, 2);
    }
  });

  it('merges a pivoted Text pair while canonicalizing non-zero bounds and preserving its transform', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'pivoted-text',
        type: 'text',
        localBounds: { x: 30, y: 15, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'center',
        },
        transform: {
          position: { type: 'static', value: [300, 500, 0] },
          anchor: { type: 'static', value: [50, 25, 0] },
          scale: { type: 'static', value: [1.25, 0.75, 1] },
          rotation: { z: { type: 'static', value: 90 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);

    idCounter = 0;
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const parsedIR = convertGEToIR(sourceGE, { frameRate: 30 });

    idCounter = 0;
    const roundTripGE = convertIRToGE(parsedIR);
    const parsedLayer = parsedIR.layers[0];
    const parsedAnchor = parsedLayer.transform?.anchor;
    const parsedPosition = parsedLayer.transform?.position;
    const parsedRotation = parsedLayer.transform?.rotation?.z;

    expect(sourceGE['items']).toHaveLength(2);
    expect(roundTripGE.items).toHaveLength(2);
    expect(parsedIR.layers).toHaveLength(1);
    expect(parsedLayer.type).toBe('text');
    expect(getLayerData(parsedIR, parsedLayer)?.sourceHierarchy).toBe('null-sprite-pair');
    expect(parsedLayer.localBounds?.x).toBe(0);
    expect(parsedLayer.localBounds?.y).toBe(0);
    expect(parsedLayer.localBounds?.width).toBeCloseTo(200, 2);
    expect(parsedLayer.localBounds?.height).toBeCloseTo(40, 2);
    expect(parsedAnchor?.type).toBe('static');
    if (parsedAnchor?.type === 'static') {
      expect(parsedAnchor.value[0]).toBeCloseTo(20, 2);
      expect(parsedAnchor.value[1]).toBeCloseTo(10, 2);
      expect(parsedAnchor.value[2]).toBe(0);
    }
    expect(parsedPosition?.type).toBe('static');
    if (parsedPosition?.type === 'static') {
      expect(parsedPosition.value[0]).toBeCloseTo(300, 2);
      expect(parsedPosition.value[1]).toBeCloseTo(500, 2);
    }
    expect(parsedRotation).toEqual({ type: 'static', value: 90 });
  });

  it('round-trips with non-default position', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'offset',
        type: 'image',
        imageUrl: 'https://example.com/img.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [100, 200, 0] },
          anchor: { type: 'static', value: [0, 0, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);

    roundTripTest(ir);
  });

  it('records a GE single item for structural round-trip preservation', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'single',
        type: 'image',
        imageUrl: 'https://example.com/single.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [100, 200, 0] },
          anchor: { type: 'static', value: [10, 10, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 15 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToIR(GEScene, { frameRate: 30 });

    expect(GEScene['items']).toHaveLength(1);
    expect(getLayerData(result)?.sourceHierarchy).toBe('single-item');
  });

  it('round-trips a parented single item with an off-center anchor and static rotation', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'parent',
        type: 'null',
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'rotated-child',
        type: 'image',
        imageUrl: 'https://example.com/rotated-child.png',
        parentId: 'layer-0',
        localBounds: { x: 0, y: 0, width: 154, height: 143 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [88.8, 125.6, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 18 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const { sourceGE, roundTripGE } = roundTripTest(ir, {
      'layer-1': { sourceHierarchy: 'single-item' },
    });
    const sourceItem = (sourceGE['items'] as Array<Record<string, unknown>>).find(
      item => item['name'] === 'rotated-child',
    );
    const roundTripItem = (roundTripGE['items'] as Array<Record<string, unknown>>).find(
      item => item['name'] === 'rotated-child',
    );
    const sourcePosition = (sourceItem?.['transform'] as Record<string, unknown>)['position'] as {
      x: number; y: number; z: number;
    };
    const roundTripPosition = (roundTripItem?.['transform'] as Record<string, unknown>)['position'] as {
      x: number; y: number; z: number;
    };

    expect(roundTripPosition.x).toBeCloseTo(sourcePosition.x, 12);
    expect(roundTripPosition.y).toBeCloseTo(sourcePosition.y, 12);
    expect(roundTripPosition.z).toBeCloseTo(sourcePosition.z, 12);
  });

  it('round-trips with static opacity', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'semi',
        type: 'image',
        imageUrl: 'https://example.com/img.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [0, 0, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 0.5 },
        },
      }),
    ]);

    roundTripTest(ir);
  });

  it('round-trips with background color and endBehavior', () => {
    const ir = createIR(
      [
        createMinimalLayer({
          orderIndex: 0,
          name: 'layer',
          type: 'null',
        }),
      ],
      {
        backgroundColor: [0.1, 0.2, 0.3, 1],
        endBehavior: 'destroy',
      },
    );

    roundTripTest(ir);
  });

  it.each([
    ['destroy', 0],
    ['continue', 2],
    ['freeze', 4],
    ['loop', 5],
  ] as const)('maps the %s end behavior in both directions', (endBehavior, GEBehavior) => {
    const ir = createIR([], { endBehavior });
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const composition = (GEScene['compositions'] as Record<string, unknown>[])[0];

    expect(composition['endBehavior']).toBe(GEBehavior);
    expect(convertGEToIR(GEScene, { frameRate: ir.frameRate }).endBehavior).toBe(endBehavior);
  });

  it('normalizes a legacy GE composition without endBehavior to explicit loop', () => {
    const ir = createIR([]);
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const composition = (GEScene['compositions'] as Record<string, unknown>[])[0];

    delete composition['endBehavior'];

    expect(convertGEToIR(GEScene, { frameRate: ir.frameRate }).endBehavior).toBe('loop');
  });

  it('round-trips multiple layers', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'bg',
        type: 'image',
        imageUrl: 'https://example.com/bg.png',
        localBounds: { x: 0, y: 0, width: 720, height: 1280 },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'ctrl',
        type: 'null',
      }),
    ]);

    roundTripTest(ir);
  });
});

describe('ge2ir convertGEToIR', () => {
  it('returns an IR document with structured diagnostics and preserves omitted names', () => {
    const sourceComposition = createIR([
      createMinimalLayer({ orderIndex: 0, name: 'temporary', type: 'null' }),
    ]);
    const scene = convertIRToGE(sourceComposition) as unknown as Record<string, unknown>;
    const compositions = scene['compositions'] as Array<Record<string, unknown>>;
    const items = scene['items'] as Array<Record<string, unknown>>;

    delete compositions[0]['name'];
    delete items[0]['name'];

    const result = convertGEToIRScene(scene, { frameRate: 30 });
    const composition = getIRSceneEntryComposition(result.scene);

    expect(result.diagnostics).toEqual([]);
    expect(Object.hasOwn(composition, 'name')).toBe(false);
    expect(Object.hasOwn(composition.layers[0], 'name')).toBe(false);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('reads GE CompositionComponent items as back-to-front painter order', () => {
    const scene = {
      compositionId: 'root-composition',
      compositions: [
        {
          id: 'root-composition',
          name: 'painter-order',
          duration: 1,
          previewSize: [100, 100],
          components: [{ id: 'root-component' }],
        },
      ],
      components: [
        {
          id: 'root-component',
          dataType: DataType.CompositionComponent,
          item: { id: 'root-composition' },
          items: [{ id: 'bottom-blue' }, { id: 'top-red' }],
        },
      ],
      // The global resource pool is intentionally opposite to the composition's painter order.
      items: [
        {
          id: 'top-red',
          name: 'top-red',
          dataType: DataType.VFXItemData,
          type: ItemType.null,
          visible: true,
          delay: 0,
          duration: 1,
          components: [],
        },
        {
          id: 'bottom-blue',
          name: 'bottom-blue',
          dataType: DataType.VFXItemData,
          type: ItemType.null,
          visible: true,
          delay: 0,
          duration: 1,
          components: [],
        },
      ],
    };

    const ir = convertGEToIR(scene, { frameRate: 30 });

    expect(ir.layers.map(layer => layer.name)).toEqual(['bottom-blue', 'top-red']);
  });

  it('restores source painter order when a merged pivot pair spans another Item', () => {
    const sourceIR = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'paired-image',
        type: 'image',
        imageUrl: 'https://example.com/paired.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [50, 50, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 15 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
      createMinimalLayer({ orderIndex: 1, name: 'intervening-item', type: 'null' }),
    ]);
    const sourceGE = convertIRToGE(sourceIR, undefined, {
      'layer-0': { sourceHierarchy: 'null-sprite-pair' },
    }) as unknown as Record<string, unknown>;
    const sourceItems = sourceGE['items'] as Array<Record<string, unknown>>;
    const sourceComponents = sourceGE['components'] as Array<Record<string, unknown>>;
    const sourceMiscs = sourceGE['miscs'] as Array<Record<string, unknown>>;
    const pairedParent = sourceItems.find(item => item['name'] === 'paired-image' && item['type'] === ItemType.null);
    const pairedChild = sourceItems.find(item => item['parentId'] === pairedParent?.['id']);
    const interveningItem = sourceItems.find(item => item['name'] === 'intervening-item');
    const compositionComponent = sourceComponents.find(
      component => component['dataType'] === DataType.CompositionComponent,
    );

    if (
      typeof pairedParent?.['id'] !== 'string' ||
      typeof pairedChild?.['id'] !== 'string' ||
      typeof interveningItem?.['id'] !== 'string' ||
      compositionComponent == null
    ) {
      throw new Error('expected generated pivot pair and intervening Item');
    }

    const sourceItemOrder = [pairedChild['id'], interveningItem['id'], pairedParent['id']];
    const sceneBindings = compositionComponent['sceneBindings'] as Array<{
      key: { id: string };
      value: { id: string };
    }>;
    const bindingByItemId = new Map(sceneBindings.map(binding => [binding.value.id, binding]));
    const sourceBindingOrder = sourceItemOrder.map(itemId => {
      const binding = bindingByItemId.get(itemId);

      if (binding == null) {
        throw new Error('expected every source Item to have a Timeline binding');
      }

      return binding;
    });

    compositionComponent['sceneBindings'] = sourceBindingOrder;
    const timelineAssetId = (compositionComponent['timelineAsset'] as { id: string }).id;
    const timelineAsset = sourceMiscs.find(misc => misc['id'] === timelineAssetId);

    if (timelineAsset == null) {
      throw new Error('expected source TimelineAsset');
    }
    timelineAsset['tracks'] = sourceBindingOrder.map(binding => binding.key);

    const imported = convertGEToIR(sourceGE, { frameRate: 30 });
    const roundTrippedGE = convertIRToGE(imported) as unknown as Record<string, unknown>;
    const roundTrippedComponent = (roundTrippedGE['components'] as Array<Record<string, unknown>>).find(
      component => component['dataType'] === DataType.CompositionComponent,
    );

    if (roundTrippedComponent == null) {
      throw new Error('expected round-tripped CompositionComponent');
    }
    const roundTrippedBindings = roundTrippedComponent?.['sceneBindings'] as Array<{
      key: { id: string };
      value: { id: string };
    }>;
    const roundTrippedTimelineId = (roundTrippedComponent['timelineAsset'] as { id: string }).id;
    const roundTrippedTimeline = (roundTrippedGE['miscs'] as Array<Record<string, unknown>>).find(
      misc => misc['id'] === roundTrippedTimelineId,
    );

    expect(imported.layers).toHaveLength(2);
    expect(getCompositionItemIds(roundTrippedGE)).toEqual(sourceItemOrder);
    expect(roundTrippedBindings.map(binding => binding.value.id)).toEqual(sourceItemOrder);
    expect((roundTrippedTimeline?.['tracks'] as Array<{ id: string }>).map(track => track.id)).toEqual(
      roundTrippedBindings.map(binding => binding.key.id),
    );
  });

  it('parses specification scalar curves and rejects color arrays', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const rotationOverLifetime = { z: scalarCurve(0, 90) };
    const colorOverLifetime = { opacity: scalarCurve(1, 0.25) };
    const rotation = parseTransformAnimation({ rotationOverLifetime }, 0, 30, ctx).rotation?.z;
    const opacity = parseOpacityAnimation({ colorOverLifetime }, 0, 30);

    expect(rotation).toMatchObject({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0 },
        { frame: 30, value: 90 },
      ],
    });
    expect(opacity).toMatchObject({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 1 },
        { frame: 30, value: 0.25 },
      ],
    });
    expect(
      parseOpacityAnimation(
        {
          colorOverLifetime: { opacity: [ValueType.COLORS, [[255, 0, 0, 255]]] },
        },
        0,
        30,
      ),
    ).toBeUndefined();
    expect(
      parseOpacityAnimation(
        {
          colorOverLifetime: { opacity: [ValueType.BEZIER_CURVE, { invalid: true }] },
        },
        0,
        30,
      ),
    ).toBeUndefined();
    expect(
      parseOpacityAnimation(
        {
          colorOverLifetime: { opacity: [ValueType.CONSTANT, Number.NaN] },
        },
        0,
        30,
      ),
    ).toBeUndefined();
  });

  it('skips a canonical position bridge and reads controls from the first real segment', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const easingData = [
      [BezierKeyframeType.EASE_OUT, [0, 0, 0, 0]],
      [BezierKeyframeType.EASE, [0.25, 0.25, 0.25, 0.25, 0.3655, 0.32]],
      [BezierKeyframeType.EASE, [0.4845, 0.53, 0.6, 0.6, 0.732, 0.68]],
      [BezierKeyframeType.EASE_IN, [0.868, 0.92, 1, 1]],
    ];
    const pathPoints: [number, number, number][] = [
      [1, 2, 0],
      [1, 2, 0],
      [4, 5, 0],
      [8, 6, 0],
    ];
    const controlPoints: [number, number, number][] = [
      [1, 2, 0],
      [1, 2, 0],
      [2, 2.5, 0],
      [3.5, 4.5, 0],
      [5, 5.5, 0],
      [7, 5.8, 0],
    ];
    const position = parseTransformAnimation(
      {
        positionOverLifetime: {
          path: [ValueType.BEZIER_CURVE_PATH, [easingData, pathPoints, controlPoints]],
        },
      },
      0,
      120,
      ctx,
    ).position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('expected a keyframed position');
    }

    const firstStart = convert3dTo2dPoint(...pathPoints[1], ctx.width, ctx.height);
    const firstEnd = convert3dTo2dPoint(...pathPoints[2], ctx.width, ctx.height);
    const firstControl = convert3dTo2dPoint(...controlPoints[2], ctx.width, ctx.height);
    const secondControl = convert3dTo2dPoint(...controlPoints[3], ctx.width, ctx.height);

    expect(position.keyframes.map(keyframe => keyframe.frame)).toEqual([30, 72, 120]);
    expect(position.keyframes[0].spatialOut).toEqual([
      firstControl[0] - firstStart[0],
      firstControl[1] - firstStart[1],
    ]);
    expect(position.keyframes[1].spatialIn).toEqual([secondControl[0] - firstEnd[0], secondControl[1] - firstEnd[1]]);
  });

  it('drops a zero-duration position bridge without emitting duplicate IR frames', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const easingData = [
      [BezierKeyframeType.EASE_OUT, [0, 0, 0, 0]],
      [BezierKeyframeType.EASE, [0, 0, 0, 0, 0.2, 0.1]],
      [BezierKeyframeType.EASE, [0.4, 0.5, 0.5, 0.5, 0.7, 0.6]],
      [BezierKeyframeType.EASE_IN, [0.8, 0.9, 1, 1]],
    ];
    const position = parseTransformAnimation(
      {
        positionOverLifetime: {
          path: [
            ValueType.BEZIER_CURVE_PATH,
            [
              easingData,
              [
                [1, 2, 0],
                [1, 2, 0],
                [4, 5, 0],
                [8, 6, 0],
              ],
              [
                [1, 2, 0],
                [1, 2, 0],
                [2, 2.5, 0],
                [3.5, 4.5, 0],
                [5, 5.5, 0],
                [7, 5.8, 0],
              ],
            ],
          ],
        },
      },
      0,
      120,
      ctx,
    ).position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('expected a keyframed position');
    }

    expect(position.keyframes.map(keyframe => keyframe.frame)).toEqual([0, 60, 120]);
    expect(position.keyframes[0].spatialOut).not.toEqual([0, 0]);
  });

  it('does not mistake same-XY position movement on the z axis for a bridge', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const easingData = [
      [BezierKeyframeType.EASE_OUT, [0, 0, 0, 0]],
      [BezierKeyframeType.EASE, [0.25, 0.25, 0.25, 0.25, 0.3655, 0.32]],
      [BezierKeyframeType.EASE, [0.4845, 0.53, 0.6, 0.6, 0.732, 0.68]],
      [BezierKeyframeType.EASE_IN, [0.868, 0.92, 1, 1]],
    ];
    const position = parseTransformAnimation(
      {
        positionOverLifetime: {
          path: [
            ValueType.BEZIER_CURVE_PATH,
            [
              easingData,
              [
                [1, 2, 0],
                [1, 2, 1],
                [4, 5, 1],
                [8, 6, 1],
              ],
            ],
          ],
        },
      },
      0,
      120,
      ctx,
    ).position;

    expect(position?.type).toBe('keyframed');
    if (position?.type !== 'keyframed') {
      throw new Error('expected a keyframed position');
    }

    expect(position.keyframes.map(keyframe => keyframe.frame)).toEqual([0, 30, 72, 120]);
    expect(position.keyframes[0].value[2]).toBe(0);
    expect(position.keyframes[1].value[2]).toBe(1);
  });

  it('drops harmless zero-duration segments and leaves instantaneous jumps unparsed', () => {
    const zeroDurationHold = [
      [BezierKeyframeType.EASE_OUT, [0, 0, 0.2, 0.3]],
      [BezierKeyframeType.EASE, [0.3, 0.8, 0.5, 1, 0.5, 1]],
      [BezierKeyframeType.EASE, [0.5, 1, 0.5, 1, 0.7, 0.5]],
      [BezierKeyframeType.EASE_IN, [0.8, 0.25, 1, 0]],
    ];
    const zeroDurationJump = structuredClone(zeroDurationHold);
    const jumpData = zeroDurationJump[2]?.[1];

    if (!Array.isArray(jumpData)) {
      throw new Error('expected zero-duration keyframe data');
    }
    jumpData[3] = 0.75;

    expect(
      parseOpacityAnimation(
        {
          colorOverLifetime: { opacity: [ValueType.BEZIER_CURVE, zeroDurationHold] },
        },
        0,
        30,
      ),
    ).toMatchObject({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0 },
        { frame: 15, value: 1 },
        { frame: 30, value: 0 },
      ],
    });
    expect(
      parseOpacityAnimation(
        {
          colorOverLifetime: { opacity: [ValueType.BEZIER_CURVE, zeroDurationJump] },
        },
        0,
        30,
      ),
    ).toBeUndefined();
  });

  it('keeps an unrepresentable scale jump in raw GE passthrough', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const jumpCurve = [
      [BezierKeyframeType.EASE_OUT, [0, 1, 0.2, 1.4]],
      [BezierKeyframeType.EASE, [0.3, 1.8, 0.5, 2, 0.5, 2]],
      [BezierKeyframeType.EASE, [0.5, 1.5, 0.5, 1.5, 0.7, 1.2]],
      [BezierKeyframeType.EASE_IN, [0.8, 1.1, 1, 1]],
    ];
    const sizeOverLifetime = {
      x: [ValueType.BEZIER_CURVE, jumpCurve],
    };

    expect(parseTransformAnimation({ sizeOverLifetime }, 0, 90, ctx).scale).toBeUndefined();

    const sourceIR = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'raw-scale-jump',
        type: 'image',
        imageUrl: 'https://example.com/raw-scale-jump.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    const sourceGE = convertIRToGE(sourceIR) as unknown as Record<string, unknown>;
    const sourceTransformAsset = findFirstTransformAsset(sourceGE);

    expect(sourceTransformAsset).toBeDefined();
    sourceTransformAsset!['sizeOverLifetime'] = sizeOverLifetime;

    const parsedIR = convertGEToIR(sourceGE, { frameRate: sourceIR.frameRate });

    expect(getLayerData(parsedIR)?.sizeOverLifetime).toEqual(sizeOverLifetime);

    const roundTrippedGE = convertIRToGE(parsedIR) as unknown as Record<string, unknown>;
    const roundTrippedTransformAsset = findFirstTransformAsset(roundTrippedGE);

    expect(roundTrippedTransformAsset?.['sizeOverLifetime']).toEqual(sizeOverLifetime);
  });

  it('combines only scale axes that share a representable vector timeline', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const alignedScale = parseTransformAnimation(
      {
        sizeOverLifetime: {
          x: scalarCurve(1, 1),
          y: scalarCurve(1, 2),
          z: [ValueType.CONSTANT, 1],
        },
      },
      0,
      30,
      ctx,
    ).scale;
    const independentScale = parseTransformAnimation(
      {
        sizeOverLifetime: {
          x: scalarCurve(1, 2),
          y: scalarCurve(1, 2, 0.25, 1),
        },
      },
      0,
      30,
      ctx,
    ).scale;

    expect(alignedScale).toMatchObject({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [1, 1, 1] },
        { frame: 30, value: [1, 2, 1] },
      ],
    });
    expect(alignedScale?.type === 'keyframed' ? alignedScale.keyframes[0].hold : undefined).toBeUndefined();
    expect(independentScale).toBeUndefined();
  });

  it('reads back scalar animations generated by ir2ge', () => {
    const source = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'animated',
        type: 'image',
        imageUrl: 'https://example.com/animated.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [0, 0, 0] },
          scale: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: [1, 1, 1] },
              { frame: 90, value: [1.5, 1.5, 1] },
            ],
          },
          rotation: {
            z: {
              type: 'keyframed',
              keyframes: [
                { frame: 0, value: 0 },
                { frame: 90, value: 45 },
              ],
            },
          },
          opacity: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: 1 },
              { frame: 90, value: 0.25 },
            ],
          },
        },
      }),
    ]);
    const generated = convertIRToGE(source) as unknown as Record<string, unknown>;
    const parsed = convertGEToIR(generated, { frameRate: source.frameRate });
    const transform = parsed.layers[0].transform;

    expect(transform?.scale?.type).toBe('keyframed');
    expect(transform?.rotation?.z?.type).toBe('keyframed');
    expect(transform?.opacity?.type).toBe('keyframed');
  });

  it('reads x/y rotation only when GE marks the axes as separated', () => {
    const ctx = { width: 720, height: 1280 } as GESceneContext;
    const rotationOverLifetime = {
      x: [0, 10],
      y: [0, 20],
      z: [0, 30],
    };

    expect(parseTransformAnimation({ rotationOverLifetime }, 0, 30, ctx).rotation).toEqual({
      z: { type: 'static', value: 30 },
    });
    expect(
      parseTransformAnimation(
        {
          rotationOverLifetime: { ...rotationOverLifetime, separateAxes: true },
        },
        0,
        30,
        ctx,
      ).rotation,
    ).toEqual({
      x: { type: 'static', value: 10 },
      y: { type: 'static', value: 20 },
      z: { type: 'static', value: 30 },
    });
  });

  it('preserves GE precomp references and source composition pools', () => {
    const scene = createPrecompScene();
    const importResult = convertGEToIRScene(scene, { frameRate: 30 });
    const ir = getIRSceneEntryComposition(importResult.scene);
    const child = importResult.scene.compositions.find(composition => composition.id === 'child-comp');

    expect(importResult.scene.compositions.map(composition => composition.id)).toEqual(['root-comp', 'child-comp']);
    expect(ir.layers).toHaveLength(1);
    expect(ir.layers[0].type).toBe('precomp');
    expect(ir.layers[0]).toMatchObject({ type: 'precomp', content: { compositionId: 'child-comp' } });
    expect(child?.layers).toEqual([expect.objectContaining({ id: 'child-item', type: 'image' })]);
    expect('extensions' in ir).toBe(false);
    expect(importResult.preservedData.compositionBindings[ir.id]?.sourceCompositionId).toBe('root-comp');
    expect(importResult.preservedData.sourceScene).toBeDefined();
    const GEScene = convertIRSceneToGE(importResult.scene, {
      preservedData: importResult.preservedData,
    }).scene as unknown as Record<string, unknown>;
    const rootComposition = (GEScene['compositions'] as Record<string, unknown>[]).find(
      comp => comp['id'] === GEScene['compositionId'],
    );
    const rootItemId = (rootComposition?.['children'] as Array<{ id: string }>)[0]?.id;
    const rootItem = (GEScene['items'] as Record<string, unknown>[]).find(item => item['id'] === rootItemId);

    expect((GEScene['compositions'] as Record<string, unknown>[]).some(comp => comp['id'] === 'child-comp')).toBe(
      true,
    );
    expect(rootItem?.['type']).toBe('7');
    expect(rootItem?.['transform']).toMatchObject({
      position: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0 },
    });
    expect(((rootItem?.['content'] as Record<string, unknown>)['options'] as Record<string, unknown>)['refId']).toBe(
      'child-comp',
    );
    expect(readObjectBindingChildTrackTypes(GEScene, rootItemId)).toContain('SubCompositionTrack');
  });

  it('preserves GE-only items separately without inventing Null layers', () => {
    const scene = createPrecompScene();
    const rootComponent = (scene['components'] as Record<string, unknown>[]).find(
      component => component['id'] === 'root-composition-component',
    );
    const unknownItem = {
      id: 'unsupported-item', dataType: 'VFXItemData', name: 'unsupported', type: '999',
      duration: 1, delay: 0, visible: true, components: [], transform: {},
    };

    (scene['items'] as Record<string, unknown>[]).push(unknownItem);
    (rootComponent?.['items'] as Array<{ id: string }>).push({ id: 'unsupported-item' });

    const result = convertGEToIRScene(scene, { frameRate: 30 });

    expect(getIRSceneEntryComposition(result.scene).layers.map(layer => layer.id)).toEqual(['precomp-item']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_RUNTIME_ITEM_PRESERVED', sourceId: 'unsupported-item', action: 'unsupported',
    }));
  });

  it.each([
    {
      name: 'rectangle',
      expectedPrimitive: IRShapePrimitiveType.Rectangle,
      path: {
        points: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 80 }, { x: 10, y: 80 }],
        inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
        outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
        closed: true,
      },
    },
    {
      name: 'custom',
      expectedPrimitive: IRShapePrimitiveType.Custom,
      path: {
        points: [{ x: 10, y: 10 }, { x: 90, y: 20 }, { x: 40, y: 100 }],
        inTangents: [{ x: 0, y: 0 }, { x: -5, y: 2 }, { x: 3, y: -4 }],
        outTangents: [{ x: 4, y: -3 }, { x: 0, y: 0 }, { x: -2, y: 5 }],
        closed: true,
      },
    },
  ] satisfies Array<{
    name: string;
    expectedPrimitive: IRShapePrimitiveType;
    path: IRMask['path'];
  }>) (
    'normalizes one static GE $name mask source into a core Layer matte',
    ({ expectedPrimitive, path }) => {
      const sourceIR = createIR([createMinimalLayer({
        orderIndex: 0,
        name: 'masked-image',
        type: 'image',
        imageUrl: 'https://example.com/image.png',
        localBounds: { x: 0, y: 0, width: 120, height: 120 },
        masks: [{ mode: IRMaskMode.Intersect, path, inverted: true }],
      })]);
      const sourceGE = convertIRToGE(sourceIR);
      const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
      const result = getIRSceneEntryComposition(imported.scene);
      const targetLayer = result.layers.find(layer => layer.name === 'masked-image');
      const sourceLayer = result.layers.find(layer => layer.id === targetLayer?.matte?.sourceLayerId);
      const sourceShape = sourceLayer?.type === 'shape' ? sourceLayer.content.shapes[0] : undefined;

      expect(result.layers).toHaveLength(2);
      expect(targetLayer?.matte).toEqual({
        sourceLayerId: sourceLayer?.id,
        mode: IRMatteMode.Geometry,
        inverted: true,
      });
      expect(sourceShape?.primitiveType).toBe(expectedPrimitive);
      if (sourceShape?.primitiveType === IRShapePrimitiveType.Custom) {
        expect(sourceShape.customPaths.type).toBe('static');
        if (sourceShape.customPaths.type !== 'static') {
          throw new Error('Expected static mask geometry');
        }
        expect(sourceShape.customPaths.value[0].points).toHaveLength(path.points.length);
      }
      const targetLayerData = targetLayer == null
        ? undefined
        : imported.preservedData.compositionBindings[result.id]?.layerDataById[targetLayer.id];
      const sourceLayerData = sourceLayer == null
        ? undefined
        : imported.preservedData.compositionBindings[result.id]?.layerDataById[sourceLayer.id];

      expect(targetLayerData?.mask).toBeUndefined();
      expect(sourceLayerData?.mask).toBeUndefined();
      expect(imported.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GE_MASK_UNSUPPORTED' }));

      const regenerated = convertIRSceneToGE(imported.scene).scene;
      const targetComponent = (regenerated.components as unknown as Record<string, unknown>[]).find(component => {
        const mask = component['mask'];

        return typeof mask === 'object' && mask != null && (mask as Record<string, unknown>)['isMask'] === false;
      });
      const regeneratedMask = targetComponent?.['mask'] as Record<string, unknown> | undefined;
      const regeneratedReferences = regeneratedMask?.['references'] as Array<{
        mask?: { id?: string };
        inverted?: boolean;
      }> | undefined;
      const sourceComponentId = regeneratedReferences?.[0]?.mask?.id;
      const sourceComponent = (regenerated.components as unknown as Record<string, unknown>[]).find(
        component => component['id'] === sourceComponentId,
      );

      expect(regeneratedReferences?.[0]?.inverted).toBe(true);
      expect((sourceComponent?.['mask'] as Record<string, unknown> | undefined)?.['isMask']).toBe(true);
    },
  );

  it('restores a cross-Composition GE mask to its owning Precomp Layer', () => {
    const maskPath: IRMask['path'] = {
      points: [{ x: 100, y: 100 }, { x: 620, y: 120 }, { x: 360, y: 1100 }],
      inTangents: [{ x: 0, y: 0 }, { x: -10, y: 5 }, { x: 4, y: -12 }],
      outTangents: [{ x: 8, y: -6 }, { x: 0, y: 0 }, { x: -5, y: 10 }],
      closed: true,
    };
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'masked-precomp',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 720, height: 1280 },
      masks: [{ mode: IRMaskMode.Add, path: maskPath }],
    });
    const sourceDocument = createTestIRScene(createIR([precomp]));
    const childComposition = sourceDocument.compositions.find(composition =>
      precomp.type === 'precomp' && composition.id === precomp.content.compositionId,
    );

    if (childComposition == null) {
      throw new Error('expected referenced test Composition');
    }
    childComposition.layers = [createMinimalLayer({
      orderIndex: 1,
      name: 'child-solid',
      type: 'solid',
      content: { color: [0, 0.5, 1, 1] },
      localBounds: { x: 0, y: 0, width: 720, height: 1280 },
    })];

    const sourceGE = convertIRSceneToGE(sourceDocument).scene;
    const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const entryComposition = getIRSceneEntryComposition(imported.scene);
    const importedPrecomp = entryComposition.layers[0];
    const importedChild = imported.scene.compositions.find(composition =>
      importedPrecomp.type === 'precomp' && composition.id === importedPrecomp.content.compositionId,
    );
    const entryLayerData = imported.preservedData.compositionBindings[entryComposition.id]
      ?.layerDataById[importedPrecomp.id];

    expect(entryComposition.layers).toHaveLength(1);
    expect(importedPrecomp.type).toBe('precomp');
    expect(importedPrecomp.masks?.[0]?.path.closed).toBe(true);
    expect(importedPrecomp.masks?.[0]?.path.points).toHaveLength(maskPath.points.length);
    expect(importedPrecomp.masks).toHaveLength(1);
    expect(importedChild?.layers).toHaveLength(1);
    expect(importedChild?.layers[0]?.masks).toBeUndefined();
    expect(entryLayerData?.mask).toBeUndefined();
    expect(imported.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GE_MASK_UNSUPPORTED' }));
  });

  it.each([
    { mode: IRMatteMode.Geometry, alphaMaskEnabled: false },
    { mode: IRMatteMode.Alpha, alphaMaskEnabled: true },
  ])('round-trips a $mode Layer matte through a GE Sprite mask source', ({ mode, alphaMaskEnabled }) => {
    const source = createMinimalLayer({
      orderIndex: 0,
      name: 'matte-source',
      type: 'image',
      imageUrl: 'https://example.com/source.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const target = createMinimalLayer({
      orderIndex: 1,
      name: 'matte-target',
      type: 'image',
      imageUrl: 'https://example.com/target.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      matte: { sourceLayerId: source.id, mode, inverted: true },
    });
    const sourceDocument = createTestIRScene(createIR([source, target]));
    const sourceGE = convertIRSceneToGE(sourceDocument).scene;
    const sourceComponent = sourceGE.components.find(component =>
      sourceGE.items.find(item => item.id === component.item.id)?.name === source.name &&
      component.dataType === DataType.SpriteComponent,
    );
    const targetComponent = sourceGE.components.find(component =>
      sourceGE.items.find(item => item.id === component.item.id)?.name === target.name &&
      component.dataType === DataType.SpriteComponent,
    );

    expect((sourceComponent as unknown as Record<string, unknown> | undefined)?.['mask']).toEqual({
      isMask: true,
      alphaMaskEnabled,
    });
    expect((targetComponent as unknown as Record<string, unknown> | undefined)?.['mask']).toEqual({
      isMask: false,
      references: [{ mask: { id: sourceComponent?.id }, inverted: true }],
    });

    const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const importedSource = composition.layers.find(layer => layer.name === source.name);
    const importedTarget = composition.layers.find(layer => layer.name === target.name);

    expect(composition.layers).toHaveLength(2);
    expect(importedTarget?.matte).toEqual({
      sourceLayerId: importedSource?.id,
      mode,
      inverted: true,
    });
    const sourceLayerData = importedSource == null
      ? undefined
      : imported.preservedData.compositionBindings[composition.id]?.layerDataById[importedSource.id];
    const targetLayerData = importedTarget == null
      ? undefined
      : imported.preservedData.compositionBindings[composition.id]?.layerDataById[importedTarget.id];

    expect(sourceLayerData?.mask).toBeUndefined();
    expect(targetLayerData?.mask).toBeUndefined();
    expect(imported.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GE_MASK_UNSUPPORTED' }));
  });

  it('preserves matte source visibility independently from target inversion', () => {
    const source = createMinimalLayer({
      orderIndex: 0,
      name: 'hidden-matte-source',
      type: 'image',
      imageUrl: 'https://example.com/source.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      visible: false,
    });
    const target = createMinimalLayer({
      orderIndex: 1,
      name: 'inverted-matte-target',
      type: 'image',
      imageUrl: 'https://example.com/target.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      matte: { sourceLayerId: source.id, mode: IRMatteMode.Geometry, inverted: true },
    });
    const sourceGE = convertIRSceneToGE(createTestIRScene(createIR([source, target]))).scene;
    const sourceItem = sourceGE.items.find(item => item.name === source.name);
    const sourceComponentId = sourceItem?.components[0]?.id;
    const targetComponent = sourceGE.components.find(component =>
      sourceGE.items.find(item => item.id === component.item.id)?.name === target.name,
    );

    expect(sourceItem?.visible).toBe(false);
    expect((targetComponent as unknown as Record<string, unknown> | undefined)?.['mask']).toEqual({
      isMask: false,
      references: [{ mask: { id: sourceComponentId }, inverted: true }],
    });

    const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const importedSource = composition.layers.find(layer => layer.name === source.name);
    const importedTarget = composition.layers.find(layer => layer.name === target.name);

    expect(importedSource?.visible).toBe(false);
    expect(importedTarget?.matte).toEqual({
      sourceLayerId: importedSource?.id,
      mode: IRMatteMode.Geometry,
      inverted: true,
    });
  });

  it('preserves multiple GE mask references only in source-specific data and reports a diagnostic', () => {
    const scene = convertIRToGE(createIR([createMinimalLayer({
      orderIndex: 0,
      name: 'masked-image',
      type: 'image',
      imageUrl: 'https://example.com/image.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    })]));
    const component = (scene.components as unknown as Record<string, unknown>[]).find(
      candidate => candidate['dataType'] === 'SpriteComponent',
    );

    component!['mask'] = {
      references: [
        { mask: { id: 'mask-a' }, inverted: false },
        { mask: { id: 'mask-b' }, inverted: true },
      ],
    };
    const result = convertGEToIRScene(scene as unknown as Record<string, unknown>, { frameRate: 30 });
    const layer = getIRSceneEntryComposition(result.scene).layers[0];

    expect(layer.masks).toBeUndefined();
    expect(
      result.preservedData.compositionBindings[result.scene.entryCompositionId]?.layerDataById[layer.id]?.mask,
    ).toEqual({
      references: [
        { mask: { id: 'mask-a' }, inverted: false },
        { mask: { id: 'mask-b' }, inverted: true },
      ],
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_MULTIPLE_MASK_REFERENCES_UNSUPPORTED', sourceId: layer.id,
    }));
  });

  it('migrates unresolved legacy mask references and reports the missing source', () => {
    const scene = convertIRToGE(createIR([createMinimalLayer({
      orderIndex: 0,
      name: 'masked-image',
      type: 'image',
      imageUrl: 'https://example.com/image.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    })]));
    const component = (scene.components as unknown as Record<string, unknown>[]).find(
      candidate => candidate['dataType'] === 'SpriteComponent',
    );

    component!['mask'] = { reference: { id: 'missing-mask-source' }, inverted: true };
    const result = convertGEToIRScene(scene as unknown as Record<string, unknown>, { frameRate: 30 });
    const layer = getIRSceneEntryComposition(result.scene).layers[0];
    const layerData = result.preservedData.compositionBindings[result.scene.entryCompositionId]?.layerDataById[layer.id];

    expect(layer.masks).toBeUndefined();
    expect(layerData?.mask).toEqual({
      isMask: false, alphaMaskEnabled: false,
      references: [{ mask: { id: 'missing-mask-source' }, inverted: true }],
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_MASK_UNSUPPORTED', sourceId: layer.id, action: 'unsupported',
    }));
  });

  it('maps GE Composition startTime to child inPoint and Precomp sourceStartFrame', () => {
    const scene = createPrecompScene();
    const childSource = (scene['compositions'] as Record<string, unknown>[]).find(
      composition => composition['id'] === 'child-comp',
    );

    childSource!['startTime'] = 0.5;
    const result = convertGEToIRScene(scene, { frameRate: 30 });
    const entry = getIRSceneEntryComposition(result.scene);
    const child = result.scene.compositions.find(composition => composition.id === 'child-comp');
    const precomp = entry.layers.find(layer => layer.type === 'precomp');

    expect(child?.inPoint).toBe(15);
    expect(precomp?.time).toEqual({ inFrame: 0, outFrame: 60, sourceStartFrame: 15 });

    child!.frameRate = 24;
    child!.inPoint = 12;
    child!.outPoint = 60;
    if (precomp?.type === 'precomp') {
      precomp.time.sourceStartFrame = 12;
    }
    const exported = convertIRSceneToGE(result.scene);
    const exportedChild = exported.scene.compositions.find(composition => composition.id === 'child-comp');

    expect(exportedChild?.startTime).toBe(0.5);
    expect(exported.diagnostics).toEqual([]);
  });

  it('does not let sourceScene override regenerated root composition data', () => {
    const imported = convertGEToIRScene(createPrecompScene(), { frameRate: 30 });
    const ir = getIRSceneEntryComposition(imported.scene);

    ir.name = 'Edited Root';
    ir.outPoint = 30;
    ir.layers[0].name = 'Edited Precomp';

    const GEScene = convertIRSceneToGE(imported.scene, {
      preservedData: imported.preservedData,
    }).scene as unknown as Record<string, unknown>;
    const rootComposition = (GEScene['compositions'] as Record<string, unknown>[]).find(
      comp => comp['id'] === GEScene['compositionId'],
    );
    const rootItemId = (rootComposition?.['children'] as Array<{ id: string }>)[0]?.id;
    const rootItem = (GEScene['items'] as Record<string, unknown>[]).find(item => item['id'] === rootItemId);

    expect(rootComposition?.['name']).toBe('Edited Root');
    expect(rootComposition?.['duration']).toBe(1);
    expect(rootItem?.['name']).toBe('Edited Precomp');
  });

  it('keeps the referenced Composition when exporting without GE preserved data', () => {
    const ir = convertGEToIR(createPrecompScene(), { frameRate: 30 });

    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;

    expect((GEScene['compositions'] as Record<string, unknown>[]).some(comp => comp['id'] === 'child-comp')).toBe(
      true,
    );
  });

  it('extracts composition-level properties', () => {
    const ir = createIR([], {
      name: 'my-comp',
      width: 800,
      height: 600,
      backgroundColor: [0.5, 0.5, 0.5, 1],
      endBehavior: 'loop',
    });

    idCounter = 0;
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToIR(GEScene, { frameRate: 30 });

    expect(result.name).toBe('my-comp');
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.frameRate).toBe(30);
    expect(result.endBehavior).toBe('loop');
    expect(result.backgroundColor).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('finds the CompositionComponent even when it is not the first composition component reference', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'img',
        type: 'image',
        imageUrl: 'https://example.com/img.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);

    idCounter = 0;
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const components = GEScene['components'] as Array<Record<string, unknown>>;
    const composition = (GEScene['compositions'] as Array<Record<string, unknown>>)[0];
    const componentRefs = composition['components'] as Array<{ id: string }>;
    const compositionComponentRef = componentRefs[0];

    components.push({ id: 'dummy-component', dataType: 'SpriteComponent' });
    composition['components'] = [{ id: 'dummy-component' }, compositionComponentRef];

    const result = convertGEToIR(GEScene, { frameRate: 30 });

    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].name).toBe('img');
    expect(result.layers[0].type).toBe('image');
  });

  it('preserves image sprite startColor tint', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'tinted',
        type: 'image',
        imageUrl: 'https://example.com/tinted.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);

    idCounter = 0;
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const components1 = sourceGE['components'] as Array<Record<string, unknown>>;
    const imageComponent1 = components1.find(component => {
      const renderer = component['renderer'] as Record<string, unknown> | undefined;

      return component['dataType'] === 'SpriteComponent' && renderer?.['texture'] != null;
    });

    expect(imageComponent1).toBeDefined();
    imageComponent1!['options'] = {
      ...(imageComponent1!['options'] as Record<string, unknown>),
      startColor: [0.5, 0.25, 0.75, 0.8],
    };

    const irPrime = convertGEToIR(sourceGE, { frameRate: 30 });
    const layer = irPrime.layers.find(l => l.name === 'tinted');

    expect(layer == null ? undefined : getLayerData(irPrime, layer)?.spriteStartColor).toEqual([
      0.5, 0.25, 0.75, 0.8,
    ]);

    idCounter = 0;
    const roundTripGE = convertIRToGE(irPrime) as unknown as Record<string, unknown>;
    const imageComponent2 = (roundTripGE['components'] as Array<Record<string, unknown>>).find(component => {
      const renderer = component['renderer'] as Record<string, unknown> | undefined;

      return component['dataType'] === 'SpriteComponent' && renderer?.['texture'] != null;
    });
    const options2 = imageComponent2?.['options'] as Record<string, unknown> | undefined;

    expect(options2?.['startColor']).toEqual([0.5, 0.25, 0.75, 0.8]);
  });

  it('reconstructs layer types correctly', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'img',
        type: 'image',
        imageUrl: 'https://example.com/img.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'ctrl',
        type: 'null',
      }),
    ]);

    idCounter = 0;
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;

    // Debug: check what the GE scene looks like.
    const items = GEScene['items'] as Array<Record<string, unknown>>;

    // Both GE items are retained while IR reconstructs their semantic layer types.
    expect(items.length).toBeGreaterThanOrEqual(2);

    const result = convertGEToIR(GEScene, { frameRate: 30 });

    expect(result.layers.length).toBeGreaterThanOrEqual(2);

    const imgLayer = result.layers.find(l => l.name === 'img');
    const ctrlLayer = result.layers.find(l => l.name === 'ctrl');

    expect(imgLayer).toBeDefined();
    expect(imgLayer!.type).toBe('image');
    expect(ctrlLayer).toBeDefined();
    expect(ctrlLayer!.type).toBe('null');
  });

  it('reconstructs timing from delay/duration', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'delayed',
        type: 'null',
        time: { inFrame: 15, outFrame: 60 },
      }),
    ]);

    idCounter = 0;
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToIR(GEScene, { frameRate: 30 });

    expect(result.layers[0].time.inFrame).toBeCloseTo(15, 1);
    expect(result.layers[0].time.outFrame).toBeCloseTo(60, 1);
  });

  it('reconstructs texture shape paint from GE texture and image pools', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'textured-shape',
        type: 'shape',
        content: {
          shapes: [
            {
              primitiveType: IRShapePrimitiveType.Rectangle,
              width: { type: 'static', value: 100 },
              height: { type: 'static', value: 60 },
              fills: [
                {
                  type: IRPaintType.Texture,
                  assetId: 'image:shape-texture',
                  scaleMode: IRTextureScaleMode.Tile,
                  opacity: { type: 'static', value: 0.4 },
                },
              ],
              strokes: [],
              position: { type: 'static', value: [0, 0] },
            },
          ],
        },
      }),
    ]);

    const sourceDocument = createTestIRScene(ir, [{
      id: 'image:shape-texture',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/shape-texture.png' },
    }]);
    const sourceGE = convertIRSceneToGE(sourceDocument).scene;
    const sourceShape = (sourceGE.components as unknown as Array<Record<string, unknown>>).find(
      component => component['dataType'] === DataType.ShapeComponent,
    );
    const sourcePaint = (sourceShape?.['fills'] as Array<Record<string, unknown>> | undefined)?.[0];

    expect(sourcePaint?.['scaleMode']).toBe(TexturePaintScaleMode.Tile);
    expect(sourcePaint?.['opacity']).toBe(0.4);

    const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const result = getIRSceneEntryComposition(imported.scene);
    const shapeLayer = result.layers[0];
    const paint = shapeLayer.type === 'shape' ? shapeLayer.content.shapes[0]?.fills[0] : undefined;

    expect(paint).toEqual({
      type: IRPaintType.Texture,
      assetId: expect.any(String),
      scaleMode: IRTextureScaleMode.Tile,
      opacity: { type: 'static', value: 0.4 },
    });
    expect(imported.scene.assets).toContainEqual({
      id: paint?.type === IRPaintType.Texture ? paint.assetId : undefined,
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/shape-texture.png' },
    });
  });

  it('requires an explicit base URL for relative GE resources', () => {
    const sourceGE = convertIRToGE(createIR([createMinimalLayer({
      orderIndex: 0,
      name: 'relative-resource',
      type: 'image',
      imageUrl: 'https://example.com/image.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    })]));

    sourceGE.images[0].url = './images/image.png';
    expect(() => convertGEToIRScene(
      sourceGE as unknown as Record<string, unknown>,
      { frameRate: 30 },
    )).toThrow(/must be absolute/);

    const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, {
      frameRate: 30,
      resourceBaseUrl: 'https://cdn.example.com/scenes/demo.json',
    });

    expect(imported.scene.assets).toContainEqual(expect.objectContaining({
      type: 'image',
      source: { kind: 'url', url: 'https://cdn.example.com/scenes/images/image.png' },
    }));
  });

  it('drops a GE gradient missing a spatial endpoint and reports a diagnostic', () => {
    const ir = createIR([createMinimalLayer({
      orderIndex: 0,
      name: 'invalid-gradient-source',
      type: 'shape',
      content: {
        shapes: [{
          primitiveType: IRShapePrimitiveType.Rectangle,
          width: { type: 'static', value: 100 },
          height: { type: 'static', value: 60 },
          fills: [{
            type: IRPaintType.LinearGradient,
            gradientStops: { type: 'static', value: [[0, 1, 0, 0, 1], [1, 0, 0, 1, 1]] },
            gradientStart: { type: 'static', value: [0, 0] },
            gradientEnd: { type: 'static', value: [100, 0] },
          }],
          strokes: [],
          position: { type: 'static', value: [0, 0] },
        }],
      },
    })]);
    const sourceGE = convertIRToGE(ir);
    const sourceShape = (sourceGE.components as unknown as Array<Record<string, unknown>>).find(
      component => component['dataType'] === DataType.ShapeComponent,
    );
    const sourcePaint = (sourceShape?.['fills'] as Array<Record<string, unknown>> | undefined)?.[0];

    delete sourcePaint?.['endPoint'];
    const imported = convertGEToIRScene(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const composition = getIRSceneEntryComposition(imported.scene);
    const layer = composition.layers.find(candidate => candidate.name === 'invalid-gradient-source');
    const fills = layer?.type === 'shape' ? layer.content.shapes[0]?.fills : undefined;

    expect(fills).toEqual([]);
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_SHAPE_GRADIENT_ENDPOINT_MISSING',
      action: 'dropped',
      sourceId: sourceShape?.id,
      feature: 'gradient-endpoints',
    }));
  });

  it('round-trips Rectangle corner radius and per-stroke geometry', () => {
    const ir = createIR([createMinimalLayer({
      orderIndex: 0,
      name: 'rounded-strokes',
      type: 'shape',
      content: {
        shapes: [{
          primitiveType: IRShapePrimitiveType.Rectangle,
          width: { type: 'static', value: 100 },
          height: { type: 'static', value: 60 },
          cornerRadius: { type: 'static', value: 15 },
          fills: [],
          strokes: [
            {
              paint: { type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } },
              width: { type: 'static', value: 2 },
              cap: 'round',
              join: 'bevel',
            },
            {
              paint: { type: IRPaintType.Solid, color: { type: 'static', value: [0, 0, 1, 1] } },
              width: { type: 'static', value: 2 },
              cap: 'round',
              join: 'bevel',
            },
          ],
          position: { type: 'static', value: [0, 0] },
        }],
      },
    })]);
    const sourceGE = convertIRToGE(ir);
    const imported = convertGEToIR(sourceGE as unknown as Record<string, unknown>, { frameRate: 30 });
    const layer = imported.layers[0];
    const shape = layer.type === 'shape' ? layer.content.shapes[0] : undefined;

    expect(shape?.primitiveType).toBe(IRShapePrimitiveType.Rectangle);
    if (shape?.primitiveType !== IRShapePrimitiveType.Rectangle) {
      throw new Error('Expected Rectangle shape.');
    }
    expect(shape.cornerRadius).toEqual({ type: 'static', value: expect.closeTo(15, 3) });
    expect(shape.strokes).toHaveLength(2);
    expect(shape.strokes[0]).toMatchObject({ cap: 'round', join: 'bevel' });
    expect(shape.strokes[0].width).toEqual({ type: 'static', value: expect.closeTo(2, 2) });
    expect(shape.strokes[1]).toMatchObject({ cap: 'round', join: 'bevel' });
    expect(shape.strokes[1].width).toEqual({ type: 'static', value: expect.closeTo(2, 2) });
  });

  it('merges an ir2ge pivot-container pair back into one semantic layer', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'split',
        type: 'image',
        imageUrl: 'https://example.com/split.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [10, 10, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: {
            z: {
              type: 'keyframed',
              keyframes: [
                { frame: 0, value: 0, outTangent: { x: 0.33, y: 0 } },
                { frame: 90, value: 360, inTangent: { x: 0.67, y: 1 } },
              ],
            },
          },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);

    idCounter = 0;
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToIR(GEScene, { frameRate: 30 });

    expect(GEScene['items']).toHaveLength(2);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].name).toBe('split');
    expect(result.layers[0].type).toBe('image');
    expect(result.layers[0].endBehavior).toBe(IREndBehavior.Destroy);
    expect(getLayerData(result)?.sourceHierarchy).toBe('null-sprite-pair');
    const anchor = result.layers[0].transform?.anchor;

    expect(anchor?.type).toBe('static');
    if (anchor?.type !== 'static') {
      throw new Error('expected a static anchor');
    }
    expect(anchor.value[0]).toBeCloseTo(10, 2);
    expect(anchor.value[1]).toBeCloseTo(10, 2);
    expect(getLayerData(result)?.rotationOverLifetime).toBeDefined();
    expect(getLayerData(result)?.sourceComponentId).toBeDefined();
    expect(getLayerData(result)?.sourceItemIds).toEqual(
      (GEScene['items'] as Array<{ id: string }>).map(item => item.id).reverse(),
    );

    idCounter = 0;
    const roundTrippedGE = convertIRToGE(result) as unknown as Record<string, unknown>;
    const roundTrippedItems = roundTrippedGE['items'] as Array<Record<string, unknown>>;
    const roundTrippedNull = roundTrippedItems.find(item => item['type'] === ItemType.null);
    const roundTrippedVisual = roundTrippedItems.find(item => item['parentId'] === roundTrippedNull?.['id']);

    expect(roundTrippedGE['items']).toHaveLength(2);
    expect(roundTrippedNull?.['endBehavior']).toBe(EndBehavior.freeze);
    expect(roundTrippedVisual?.['endBehavior']).toBe(EndBehavior.destroy);
  });

  it('preserves distinct Item and Timeline end behaviors for a merged pivot pair', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'split-end-behavior',
        type: 'image',
        imageUrl: 'https://example.com/split.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [10, 10, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: {
            z: {
              type: 'keyframed',
              keyframes: [
                { frame: 0, value: 0 },
                { frame: 90, value: 360 },
              ],
            },
          },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const sourceItems = sourceGE['items'] as Array<Record<string, unknown>>;
    const sourceNull = sourceItems.find(item => item['type'] === ItemType.null);
    const sourceVisual = sourceItems.find(item => item['parentId'] === sourceNull?.['id']);

    expect(sourceVisual).toBeDefined();
    sourceVisual!['endBehavior'] = EndBehavior.freeze;

    const mergedIR = convertGEToIR(sourceGE, { frameRate: 30 });

    expect(mergedIR.layers).toHaveLength(1);
    expect(mergedIR.layers[0].endBehavior).toBe(IREndBehavior.Freeze);
    expect(getLayerData(mergedIR)?.timelineEndBehavior).toBe(EndBehavior.destroy);

    const roundTrippedGE = convertIRToGE(mergedIR) as unknown as Record<string, unknown>;
    const roundTrippedItems = roundTrippedGE['items'] as Array<Record<string, unknown>>;
    const roundTrippedNull = roundTrippedItems.find(item => item['type'] === ItemType.null);
    const roundTrippedVisual = roundTrippedItems.find(item => item['parentId'] === roundTrippedNull?.['id']);
    const visualItemId = roundTrippedVisual?.['id'];

    expect(roundTrippedVisual?.['endBehavior']).toBe(EndBehavior.freeze);
    expect(readActivationEndBehavior(roundTrippedGE, typeof visualItemId === 'string' ? visualItemId : undefined))
      .toBe(EndBehavior.destroy);
  });

  it.each([
    IREndBehavior.Freeze,
    IREndBehavior.Loop,
    IREndBehavior.Continue,
  ])('merges a generated pivot pair with %s end behavior', endBehavior => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'visual-parent',
        type: 'image',
        imageUrl: 'https://example.com/parent.png',
        endBehavior,
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [50, 50, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 15 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'child',
        type: 'null',
        parentId: 'layer-0',
      }),
    ]);
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToIR(sourceGE, { frameRate: 30 });
    const parent = result.layers.find(layer => layer.name === 'visual-parent');
    const child = result.layers.find(layer => layer.name === 'child');

    expect(result.layers).toHaveLength(2);
    expect(parent).toMatchObject({ type: 'image', endBehavior });
    expect(child?.parentId).toBe(parent?.id);
  });

  it('preserves text scale across a merged null-text pair round-trip', () => {
    const animatedRotation = {
      z: {
        type: 'keyframed' as const,
        keyframes: [
          { frame: 0, value: 0 },
          { frame: 90, value: 45 },
        ],
      },
    };
    const ir = createIR(
      [
        createMinimalLayer({
          orderIndex: 0,
          name: 'paired-text',
          type: 'text',
          localBounds: { x: 0, y: 0, width: 200, height: 40 },
          content: {
            color: [1, 1, 1, 1],
            text: 'paired',
            fontAssetId: 'font:test-sans',
            fontSize: 24,
            letterSpacing: 0,
            lineHeight: 24,
            textAlign: 'left',
          },
          transform: {
            position: { type: 'static', value: [360, 640, 0] },
            anchor: { type: 'static', value: [0, 0, 0] },
            scale: { type: 'static', value: [1, 1, 1] },
            rotation: animatedRotation,
            opacity: { type: 'static', value: 1 },
          },
        }),
      ],
    );

    idCounter = 0;
    const sourceGE = convertIRToGE(ir, undefined, {
      'layer-0': { sourceHierarchy: 'null-sprite-pair' },
    });
    const mergedIR = convertGEToIR(sourceGE as unknown as Record<string, unknown>, {
      frameRate: 30,
    });

    idCounter = 0;
    const roundTrippedGE = convertIRToGE(mergedIR);
    const sourceItems = sourceGE.items as Array<{
      type: string;
      transform: { scale: { x: number; y: number; z: number } };
    }>;
    const roundTrippedItems = roundTrippedGE.items as typeof sourceItems;
    const sourceText = sourceItems.find(item => item.type === 'text');
    const roundTrippedText = roundTrippedItems.find(item => item.type === 'text');

    expect(mergedIR.layers).toHaveLength(1);
    expect(getLayerData(mergedIR)?.sourceHierarchy).toBe('null-sprite-pair');
    expect(roundTrippedText?.transform.scale).toEqual(sourceText?.transform.scale);
  });

  it('restores a merged null-shape pair during round-trip', () => {
    const ir = createIR(
      [
        createMinimalLayer({
          orderIndex: 0,
          name: 'paired-shape',
          type: 'shape',
          localBounds: { x: 0, y: 0, width: 100, height: 100 },
          content: {
            shapes: [
              {
                primitiveType: IRShapePrimitiveType.Rectangle,
                width: { type: 'static', value: 100 },
                height: { type: 'static', value: 100 },
                fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } }],
                strokes: [],
                position: { type: 'static', value: [0, 0] },
              },
            ],
          },
          transform: {
            position: { type: 'static', value: [360, 640, 0] },
            anchor: { type: 'static', value: [0, 0, 0] },
            scale: { type: 'static', value: [1, 1, 1] },
            rotation: {
              z: {
                type: 'keyframed',
                keyframes: [
                  { frame: 0, value: 0 },
                  { frame: 90, value: 45 },
                ],
              },
            },
            opacity: { type: 'static', value: 1 },
          },
        }),
      ],
    );

    idCounter = 0;
    const sourceGE = convertIRToGE(ir, undefined, {
      'layer-0': { sourceHierarchy: 'null-sprite-pair' },
    });
    const mergedIR = convertGEToIR(sourceGE as unknown as Record<string, unknown>, {
      frameRate: 30,
    });

    idCounter = 0;
    const roundTrippedGE = convertIRToGE(mergedIR);
    const roundTrippedItems = roundTrippedGE.items as Array<{
      id: string;
      type: string;
      parentId?: string;
    }>;
    const nullItem = roundTrippedItems.find(item => item.type === '3');
    const shapeItem = roundTrippedItems.find(item => item.type === 'shape');

    expect(mergedIR.layers).toHaveLength(1);
    expect(getLayerData(mergedIR)?.sourceHierarchy).toBe('null-sprite-pair');
    expect(roundTrippedItems).toHaveLength(2);
    expect(shapeItem?.parentId).toBe(nullItem?.id);
  });

  it('does not merge an authored multi-child Null with a zero-size same-name Shape', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'authored-parent',
        type: 'shape',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        content: {
          shapes: [{
            primitiveType: IRShapePrimitiveType.Rectangle,
            width: { type: 'static', value: 100 },
            height: { type: 'static', value: 100 },
            fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } }],
            strokes: [],
            position: { type: 'static', value: [0, 0] },
          }],
        },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [50, 50, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 15 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'authored-child',
        type: 'null',
        parentId: 'layer-0',
      }),
    ]);
    const sourceGE = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const items = sourceGE['items'] as Array<Record<string, unknown>>;
    const shapeItem = items.find(item => item['type'] === ItemType.shape);
    const shapeTransform = shapeItem?.['transform'] as Record<string, unknown> | undefined;

    expect(shapeTransform).toBeDefined();
    if (shapeTransform != null) {
      shapeTransform['size'] = { x: 0, y: 0 };
    }

    const result = convertGEToIR(sourceGE, { frameRate: 30 });
    const parent = result.layers.find(layer => layer.type === 'null' && layer.name === 'authored-parent');
    const visual = result.layers.find(layer => layer.type === 'shape' && layer.name === 'authored-parent');
    const authoredChild = result.layers.find(layer => layer.name === 'authored-child');

    expect(result.layers).toHaveLength(3);
    expect(parent).toBeDefined();
    expect(visual?.parentId).toBe(parent?.id);
    expect(authoredChild?.parentId).toBe(parent?.id);
  });

  it('does not merge a same-name visual child that has its own transform animation', () => {
    const ir = createIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'same',
        type: 'null',
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [0, 0, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 15 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'same',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/same.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: [100, 200, 0], outTangent: { x: 0.33, y: 0 } },
              { frame: 90, value: [160, 260, 0], inTangent: { x: 0.67, y: 1 } },
            ],
          },
          anchor: { type: 'static', value: [50, 50, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);

    idCounter = 0;
    const GEScene = convertIRToGE(ir) as unknown as Record<string, unknown>;
    const result = convertGEToIR(GEScene, { frameRate: 30 });
    const parent = result.layers.find(layer => layer.type === 'null' && layer.name === 'same');
    const child = result.layers.find(layer => layer.type === 'image' && layer.name === 'same');

    expect(result.layers).toHaveLength(2);
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parentId).toBe(parent!.id);
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

function readActivationEndBehavior(scene: Record<string, unknown>, itemId: string | undefined): unknown {
  if (itemId == null) {
    return undefined;
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
  const childTracks = ((objectBindingTrack?.['children'] as Array<{ id: string }> | undefined) ?? [])
    .map(ref => miscById.get(ref.id));
  const activationTrack = childTracks.find(track => track?.['dataType'] === DataType.ActivationTrack);
  const clips = activationTrack?.['clips'] as Array<Record<string, unknown>> | undefined;

  return clips?.[0]?.['endBehavior'];
}

function createPrecompScene(): Record<string, unknown> {
  return {
    version: '3.6',
    playerVersion: { web: '2.8.9' },
    images: [{ id: 'image-1', url: 'https://example.com/child.png' }],
    fonts: [],
    plugins: [],
    type: 'ge',
    compositionId: 'root-comp',
    compositions: [
      {
        id: 'root-comp',
        name: 'Root',
        duration: 2,
        startTime: 0,
        endBehavior: 5,
        previewSize: [400, 300],
        components: [{ id: 'root-composition-component' }],
      },
      {
        id: 'child-comp',
        name: 'Child',
        duration: 2,
        startTime: 0,
        endBehavior: 5,
        previewSize: [400, 300],
        components: [{ id: 'child-composition-component' }],
      },
    ],
    components: [
      {
        id: 'root-composition-component',
        dataType: 'CompositionComponent',
        item: { id: 'root-comp' },
        items: [{ id: 'precomp-item' }],
      },
      {
        id: 'child-composition-component',
        dataType: 'CompositionComponent',
        item: { id: 'child-comp' },
        items: [{ id: 'child-item' }],
      },
      {
        id: 'sprite-component',
        dataType: 'SpriteComponent',
        item: { id: 'child-item' },
        renderer: { texture: { id: 'texture-1' }, anchor: [0.5, 0.5] },
      },
    ],
    geometries: [],
    materials: [],
    items: [
      {
        id: 'precomp-item',
        dataType: 'VFXItemData',
        name: 'ChildPrecomp',
        duration: 2,
        type: '7',
        visible: true,
        endBehavior: 4,
        delay: 0,
        renderLevel: 'B+',
        content: { options: { refId: 'child-comp' }, positionOverLifetime: {} },
        components: [],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        id: 'child-item',
        dataType: 'VFXItemData',
        name: 'ChildImage',
        duration: 2,
        type: '1',
        visible: true,
        endBehavior: 0,
        delay: 0,
        renderLevel: 'B+',
        components: [{ id: 'sprite-component' }],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          anchor: { x: 0, y: 0 },
          size: { x: 1.6, y: 1.2 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ],
    shaders: [],
    bins: [],
    textures: [{ id: 'texture-1', dataType: 'Texture', source: { id: 'image-1' }, flipY: true }],
    animations: [],
    miscs: [],
  };
}

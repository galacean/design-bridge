import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  IREndBehavior, IRPaintType, IRMaskMode, IRMatteMode, IRShapePrimitiveType, IRTextureScaleMode,
  type IRComposition, type IRLayer, type IRMask, type IRShape, type IRTransform,
} from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import {
  DataType, ItemType, LineCap, LineJoin, TextSizeMode, TexturePaintScaleMode, ValueType,
} from '@galacean/effects-specification';
import {
  convertIRToGE as convertIRSceneToGE, type GEToIRPreservedData,
} from '../../src';
import { GE_PRESERVED_DATA_VERSION, type EffectsLayerPreservedData } from '../../src/preserved-data';
import { getCompositionItemIds } from '../../src/ge2ir/parser/build-scene-context';
import { convert2dTo3dPoint, get2dTo3dRatio } from '../../src/common/coordinate-mapping';
import {
  createTestIRScene, migrateTestLayerAsset, type TestIRLayerOverrides,
} from '../test-ir';

let idCounter = 0;

vi.mock('uuid', () => ({
  v4: () => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`,
}));

beforeEach(() => {
  idCounter = 0;
});

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

function createMinimalIR(layers: IRLayer[]): IRComposition {
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
  };
}

function convertIRToGE(ir: IRComposition, duration?: number): ReturnType<typeof convertIRSceneToGE>['scene'] {
  return convertIRSceneToGE(createTestIRScene(ir), { duration }).scene;
}

function convertIRWithPreservedData(
  ir: IRComposition,
  layerDataById: Record<string, EffectsLayerPreservedData>,
  duration?: number,
  sourceItemOrder: string[] = [],
): ReturnType<typeof convertIRSceneToGE> {
  const scene = createTestIRScene(ir);
  const preservedData: GEToIRPreservedData = {
    version: GE_PRESERVED_DATA_VERSION,
    particleSourceData: { particleEffectGroups: [], layers: [] },
    compositionBindings: Object.fromEntries(scene.compositions.map(composition => [
      composition.id,
      {
        sourceCompositionId: composition.id,
        sourceItemOrder,
        layerDataById: composition.id === ir.id ? layerDataById : {},
      },
    ])),
  };

  return convertIRSceneToGE(scene, { duration, preservedData });
}

function getItemTimelineTracks(
  scene: ReturnType<typeof convertIRSceneToGE>['scene'],
  itemId: string,
): Record<string, unknown>[] {
  const components = scene.components as unknown as Record<string, unknown>[];
  const sceneBinding = components.flatMap(component =>
    (component['sceneBindings'] as Array<{ key: { id: string }; value: { id: string } }> | undefined) ?? [],
  ).find(binding => binding.value.id === itemId);

  if (sceneBinding == null) {
    throw new Error(`expected a Timeline binding for Item '${itemId}'`);
  }

  const miscById = new Map((scene.miscs as unknown as Record<string, unknown>[]).map(
    misc => [String(misc['id']), misc] as const,
  ));
  const objectBindingTrack = miscById.get(sceneBinding.key.id);
  const childReferences = objectBindingTrack?.['children'] as Array<{ id: string }> | undefined;

  if (childReferences == null) {
    throw new Error(`expected ObjectBindingTrack children for Item '${itemId}'`);
  }

  return childReferences.map(reference => {
    const track = miscById.get(reference.id);

    if (track == null) {
      throw new Error(`expected Timeline child Track '${reference.id}'`);
    }

    return track;
  });
}

function collectReachableItemIds(scene: ReturnType<typeof convertIRSceneToGE>['scene']): Set<string> {
  const itemById = new Map(scene.items.map(item => [item.id, item] as const));
  const compositionItemsById = new Map(scene.compositions.map(composition => [
    composition.id,
    getCompositionItemIds(scene as unknown as Record<string, unknown>, composition.id).map(id => ({ id })),
  ]));
  const reachableItemIds = new Set<string>();
  const pendingCompositionIds = [scene.compositionId];
  const visitedCompositionIds = new Set<string>();

  while (pendingCompositionIds.length > 0) {
    const compositionId = pendingCompositionIds.pop();

    if (compositionId == null || visitedCompositionIds.has(compositionId)) {
      continue;
    }
    visitedCompositionIds.add(compositionId);

    for (const reference of compositionItemsById.get(compositionId) ?? []) {
      reachableItemIds.add(reference.id);
      const item = itemById.get(reference.id);
      const refId = item?.type === ItemType.composition
        ? (item.content?.options as { refId?: string } | undefined)?.refId
        : undefined;

      if (refId != null) {
        pendingCompositionIds.push(refId);
      }
    }
  }

  return reachableItemIds;
}

function getMaskReferenceIds(component: Record<string, unknown> | undefined): string[] {
  const mask = component?.['mask'] as { references?: Array<{ mask?: { id?: string } }> } | undefined;

  return (mask?.references ?? []).map(reference => reference.mask?.id).filter((id): id is string => id != null);
}

describe('convertIRToGE', () => {
  it('preserves Precomp depth scale when a scale track uses a different canvas ratio', () => {
    const layer = createMinimalLayer({
      orderIndex: 0, name: 'scaled-precomp', type: 'precomp',
      transform: { scale: { type: 'static', value: [0.6, 0.6, 1] } },
    });
    const document = createTestIRScene(createMinimalIR([layer]));

    document.compositions[1].width = 400;
    document.compositions[1].height = 300;
    const output = convertIRSceneToGE(document).scene;
    const item = output.items.find(value => value.name === 'scaled-precomp')!;
    const asset = findFirstTransformAsset(output as unknown as Record<string, unknown>);
    const animation = asset?.['sizeOverLifetime'] as { z: [number, number] };

    // GE TransformPlayable uses the initial X scale as its Z baseline.
    expect(item.transform!.scale.x * animation.z[1]).toBeCloseTo(1, 10);
  });

  it('returns the generated scene with structured diagnostics', () => {
    const result = convertIRSceneToGE(createTestIRScene(createMinimalIR([])));

    expect(result.scene.type).toBe('ge');
    expect(result.diagnostics).toEqual([]);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('returns serializable item bindings scoped to each conversion', () => {
    const layer = createMinimalLayer({ orderIndex: 0, name: 'Bound layer', type: 'null' });
    const input = createTestIRScene(createMinimalIR([layer]));
    const snapshot = structuredClone(input);
    const result = convertIRSceneToGE(input);
    const item = result.scene.items.find(entry => entry.name === 'Bound layer');

    expect(item).toBeDefined();
    expect(result.itemLayerIds[item!.id]).toBe(layer.id);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    expect(convertIRSceneToGE(createTestIRScene(createMinimalIR([]))).itemLayerIds).toEqual({});
    expect(input).toEqual(snapshot);
  });

  it('uses stable IDs as GE names when optional IR names are omitted', () => {
    const layer = createMinimalLayer({ orderIndex: 0, name: 'temporary', type: 'null' });
    const composition = createMinimalIR([layer]);

    delete composition.name;
    delete layer.name;

    const scene = convertIRToGE(composition);

    expect(scene.compositions[0]?.name).toBe(composition.id);
    expect(scene.items[0]?.name).toBe(layer.id);
  });

  it('uses the canonical zero position when an IR Transform is omitted', () => {
    const layer = createMinimalLayer({ orderIndex: 0, name: 'default-transform', type: 'null' });

    layer.transform = undefined;
    const scene = convertIRToGE(createMinimalIR([layer]));
    const expectedPosition = convert2dTo3dPoint(0, 0, 0, 720, 1280);

    expect(scene.items[0]?.transform).toMatchObject({
      position: { x: expectedPosition[0], y: expectedPosition[1], z: expectedPosition[2] },
      eulerHint: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it('generates a valid empty scene', () => {
    const scene = convertIRToGE(createMinimalIR([]));

    expect(scene.type).toBe('ge');
    expect(scene.version).toBe('3.7');
    expect(scene.compositions).toHaveLength(1);
    expect(scene.items).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(scene))).toStrictEqual(scene);
    expect(scene).toMatchSnapshot();
  });

  it('exports only the selected entry graph, omitting unused layers and timelines', () => {
    const entry = { ...createMinimalIR([]), id: 'entry', name: 'entry' };
    const unreferenced = {
      ...createMinimalIR([createMinimalLayer({
        orderIndex: 0, name: 'unused-solid', type: 'solid', content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      })]),
      id: 'unreferenced', name: 'unreferenced',
    };
    const document = createIRScene(entry);

    document.compositions.unshift(unreferenced);

    const scene = convertIRSceneToGE(document).scene;

    expect(scene.compositions).toHaveLength(1);
    expect(scene.compositionId).toBe('entry');
    expect(scene.compositions.find(composition => composition.id === scene.compositionId)?.name).toBe('entry');
    expect(scene.items).toEqual([]);
    expect(scene.components).toHaveLength(1);
    expect(scene.miscs).toEqual([expect.objectContaining({ dataType: DataType.TimelineAsset, tracks: [] })]);
  });

  it('generates only reachable nested variants and retains diagnostics for their source layers', () => {
    const parent = createMinimalLayer({ orderIndex: 0, name: 'parent', type: 'precomp' });
    const nested = createMinimalLayer({
      orderIndex: 1, name: 'nested', type: 'precomp', time: { inFrame: 0, outFrame: 90, stretch: 2 },
    });

    if (parent.type !== 'precomp' || nested.type !== 'precomp') {
      throw new Error('expected Precomp layers');
    }
    parent.content.clipToBounds = true;
    nested.content.clipToBounds = true;
    const document = createTestIRScene(createMinimalIR([parent]));
    const child = document.compositions[1];

    child.layers = [nested];
    document.compositions.push({
      ...createMinimalIR([createMinimalLayer({
        orderIndex: 2, name: 'leaf', type: 'solid', content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      })]),
      id: nested.content.compositionId,
    });
    const { scene, diagnostics } = convertIRSceneToGE(document);

    expect(scene.compositions).toHaveLength(3);
    expect(scene.compositions.map(composition => composition.id)).not.toContain(child.id);
    expect(scene.compositions.map(composition => composition.id)).not.toContain(nested.content.compositionId);
    expect(scene.items.filter(item => item.name === 'leaf')).toHaveLength(1);
    expect(collectReachableItemIds(scene).size).toBe(scene.items.length);
    expect(scene.miscs.filter(misc => misc.dataType === DataType.TimelineAsset)).toHaveLength(3);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'GE_PRECOMP_STRETCH_UNSUPPORTED', sourceId: nested.id }),
    ]);
  });

  it('reuses shared compositions while keeping clipped instances isolated', () => {
    const shared = createMinimalLayer({ orderIndex: 0, name: 'shared', type: 'precomp' });

    if (shared.type !== 'precomp') {
      throw new Error('expected Precomp layer');
    }
    const repeated = { ...shared, id: 'repeated', name: 'repeated' };
    const clipped = {
      ...shared, id: 'clipped', name: 'clipped', content: { ...shared.content, clipToBounds: true },
    };
    const document = createTestIRScene(createMinimalIR([shared, repeated, clipped]));

    document.compositions[1].layers = [createMinimalLayer({
      orderIndex: 1, name: 'leaf', type: 'solid', content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    })];
    const { scene } = convertIRSceneToGE(document);
    const references = scene.items.filter(item => item.type === ItemType.composition)
      .map(item => (item.content.options as { refId: string }).refId);

    expect(scene.compositions).toHaveLength(3);
    expect(references.filter(id => id === shared.content.compositionId)).toHaveLength(2);
    expect(references.filter(id => id !== shared.content.compositionId)).toHaveLength(1);
    expect(scene.items.filter(item => item.name === 'leaf')).toHaveLength(2);
    expect(collectReachableItemIds(scene).size).toBe(scene.items.length);
  });

  it('writes overlapping IR layers to GE in back-to-front painter order', () => {
    const scene = convertIRToGE(
      createMinimalIR([
        createMinimalLayer({
          orderIndex: 0,
          name: 'bottom-blue',
          type: 'solid',
          localBounds: { x: 0, y: 0, width: 720, height: 1280 },
          content: { color: [0, 0, 1, 1] },
        }),
        createMinimalLayer({
          orderIndex: 1,
          name: 'top-red',
          type: 'solid',
          localBounds: { x: 0, y: 0, width: 720, height: 1280 },
          content: { color: [1, 0, 0, 1] },
        }),
      ]),
    );
    const components = scene.components as unknown as Array<Record<string, unknown>>;
    const items = scene.items as unknown as Array<Record<string, unknown>>;
    const itemIds = getCompositionItemIds(scene as unknown as Record<string, unknown>);
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

  it('preserves bottom-first painter order inside one Shape Layer', () => {
    const scene = convertIRToGE(createMinimalIR([createMinimalLayer({
      orderIndex: 0,
      name: 'shape-stack',
      type: 'shape',
      content: {
        shapes: [
          {
            primitiveType: IRShapePrimitiveType.Rectangle,
            width: { type: 'static', value: 130 },
            height: { type: 'static', value: 90 },
            fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [0, 0, 1, 1] } }],
            strokes: [],
            position: { type: 'static', value: [85, 100] },
          },
          {
            primitiveType: IRShapePrimitiveType.Ellipse,
            xRadius: { type: 'static', value: 55 },
            yRadius: { type: 'static', value: 55 },
            fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } }],
            strokes: [],
            position: { type: 'static', value: [115, 100] },
          },
        ],
      },
    })]));
    const components = scene.components as unknown as Array<Record<string, unknown>>;
    const itemIds = getCompositionItemIds(scene as unknown as Record<string, unknown>);
    const colors = itemIds.map(itemId => {
      const component = components.find(candidate =>
        candidate['dataType'] === DataType.ShapeComponent &&
        (candidate['item'] as { id?: string } | undefined)?.id === itemId,
      );

      return (component?.['fills'] as Array<Record<string, unknown>> | undefined)?.[0]?.['color'];
    });

    expect(colors).toEqual([
      { r: 0, g: 0, b: 1, a: 1 },
      { r: 1, g: 0, b: 0, a: 1 },
    ]);
  });

  it.each([false, true])('keeps split visuals in painter order (preserved=%s)', preserved => {
    const parent = createMinimalLayer({
      id: 'card-parent',
      orderIndex: 0,
      name: 'card-background',
      type: 'image',
      imageUrl: 'https://example.com/card-background.png',
      localBounds: { x: 0, y: 0, width: 200, height: 240 },
    });
    const intervening = createMinimalLayer({
      id: 'card-overlay',
      orderIndex: 1,
      name: 'card-overlay',
      type: 'image',
      imageUrl: 'https://example.com/card-overlay.png',
      localBounds: { x: 0, y: 0, width: 240, height: 280 },
    });
    const child = createMinimalLayer({
      id: 'card-foreground',
      orderIndex: 2,
      name: 'card-foreground',
      type: 'image',
      parentId: parent.id,
      imageUrl: 'https://example.com/card-foreground.png',
      localBounds: { x: 0, y: 0, width: 120, height: 130 },
    });
    const ir = createMinimalIR([parent, intervening, child]);
    const scene = preserved ? convertIRWithPreservedData(ir, {
      [parent.id]: { sourceItemIds: ['source-parent'] },
      [intervening.id]: { sourceItemIds: ['source-overlay'] },
      [child.id]: { sourceItemIds: ['source-child'] },
    }, undefined, ['source-parent', 'source-overlay', 'source-child']).scene : convertIRToGE(ir);
    const components = scene.components as unknown as Array<Record<string, unknown>>;
    const items = scene.items as unknown as Array<Record<string, unknown>>;
    const compositionComponent = components.find(component => component['dataType'] === 'CompositionComponent');
    const itemById = new Map(items.map(item => [item['id'], item]));
    const orderedVisualNames = getCompositionItemIds(scene as unknown as Record<string, unknown>)
      .map(id => itemById.get(id))
      .filter(item => item?.['type'] === '1')
      .map(item => item?.['name']);

    expect(orderedVisualNames).toEqual(['card-background', 'card-overlay', 'card-foreground']);
    const bindings = compositionComponent?.['sceneBindings'] as Array<{ key: { id: string }; value: { id: string } }>;
    const itemIdByTrackId = new Map(bindings.map(binding => [binding.key.id, binding.value.id]));
    const timelineId = (compositionComponent?.['timelineAsset'] as { id: string }).id;
    const timeline = scene.miscs.find(misc => misc.id === timelineId) as unknown as { tracks: { id: string }[] };
    const timelineVisualNames = timeline.tracks
      .map(track => itemById.get(itemIdByTrackId.get(track.id)))
      .filter(item => item?.['type'] === '1')
      .map(item => item?.['name']);

    expect(timelineVisualNames).toEqual(['card-background', 'card-overlay', 'card-foreground']);
  });

  it('rejects non-JSON values in preserved precomp content', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'precomp',
        type: 'precomp',
      }),
    ]);

    expect(() => convertIRWithPreservedData(ir, {
      'layer-0': { precompContent: { options: { refId: 'child-comp' }, invalidNumber: Number.NaN } },
    })).toThrowError(/Non-finite number/);
  });

  it('maps a non-zero composition inPoint to GE startTime while keeping layer delay relative', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'relative-time',
        type: 'null',
        time: { inFrame: 30, outFrame: 60 },
      }),
    ]);

    ir.inPoint = 30;
    ir.outPoint = 90;

    const scene = convertIRToGE(ir);
    const composition = scene.compositions[0] as unknown as Record<string, unknown>;
    const item = scene.items[0] as unknown as Record<string, unknown>;

    expect(composition['startTime']).toBe(1);
    expect(composition['duration']).toBe(2);
    expect(item['delay']).toBe(0);
    expect(item['duration']).toBe(1);
  });

  it('maps the half-open layer range to the activation clip without including outFrame', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'delayed-layer',
        type: 'null',
        time: { inFrame: 30, outFrame: 60 },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const item = scene.items[0] as unknown as Record<string, unknown>;
    const activationTrack = (scene.miscs as unknown as Record<string, unknown>[]).find(
      misc => misc['dataType'] === 'ActivationTrack',
    );
    const activationClip = (activationTrack?.['clips'] as Record<string, unknown>[] | undefined)?.[0];

    expect(item['delay']).toBe(1);
    expect(item['duration']).toBe(1);
    expect(activationClip?.['start']).toBe(1);
    expect(activationClip?.['duration']).toBe(1);
    expect((activationClip?.['start'] as number) + (activationClip?.['duration'] as number)).toBe(2);
  });

  it('treats an omitted layer stretch exactly like stretch 1', () => {
    const timings = [undefined, 1].map(stretch => {
      idCounter = 0;
      const ir = createMinimalIR([
        createMinimalLayer({
          orderIndex: 0,
          name: 'default-stretch',
          type: 'precomp',
          time: { inFrame: 30, outFrame: 60, ...(stretch != null && { stretch }) },
        }),
      ]);
      const scene = convertIRToGE(ir);
      const item = scene.items[0] as unknown as Record<string, unknown>;
      const activationTrack = (scene.miscs as unknown as Record<string, unknown>[]).find(
        misc => misc['dataType'] === 'ActivationTrack',
      );
      const activationClip = (activationTrack?.['clips'] as Record<string, unknown>[] | undefined)?.[0];

      return {
        itemDelay: item['delay'],
        itemDuration: item['duration'],
        clipStart: activationClip?.['start'],
        clipDuration: activationClip?.['duration'],
      };
    });

    expect(timings[1]).toEqual(timings[0]);
    expect(timings[0]).toEqual({ itemDelay: 1, itemDuration: 1, clipStart: 1, clipDuration: 1 });
  });

  it('rejects a non-positive layer stretch at the GE generation boundary', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'invalid-stretch',
        type: 'precomp',
        time: { inFrame: 0, outFrame: 60, stretch: 0 },
      }),
    ]);

    expect(() => convertIRToGE(ir)).toThrowError(/IR_LAYER_TIME_STRETCH_INVALID/);
  });

  it('uses a Precomp endBehavior override instead of the referenced Composition behavior', () => {
    const precomp = createMinimalLayer({
      orderIndex: 0, name: 'destroying-precomp', type: 'precomp',
    });

    if (precomp.type !== 'precomp') {
      throw new Error('expected precomp test layer');
    }
    precomp.content.endBehavior = IREndBehavior.Destroy;
    const document = createTestIRScene(createMinimalIR([precomp]));

    document.compositions[1].endBehavior = IREndBehavior.Loop;
    const scene = convertIRSceneToGE(document).scene;
    const item = scene.items.find(candidate => candidate.name === 'destroying-precomp');

    expect(item?.endBehavior).toBe(0);
  });

  it('applies Precomp sourceStartFrame and reports only an unsupported playback-rate change', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'retimed-precomp',
        type: 'precomp',
        time: { inFrame: 30, outFrame: 90, sourceStartFrame: 12, stretch: 2 },
      }),
    ]);
    const document = createTestIRScene(ir);
    const result = convertIRSceneToGE(document);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'GE_PRECOMP_STRETCH_UNSUPPORTED', sourceId: 'layer-0' }),
    ]);
    const item = result.scene.items.find(candidate => candidate.name === 'retimed-precomp');

    expect(item?.delay).toBe(1);
    expect(item?.duration).toBe(2);
    if (item == null) {
      throw new Error('expected retimed Precomp Item');
    }
    const tracks = getItemTimelineTracks(result.scene, item.id);
    const activationTracks = tracks.filter(track => track['dataType'] === DataType.ActivationTrack);
    const subCompositionTrack = tracks.find(track => track['dataType'] === DataType.SubCompositionTrack);
    const subCompositionClip = (subCompositionTrack?.['clips'] as Record<string, unknown>[] | undefined)?.[0];

    expect(tracks.map(track => track['dataType'])).toEqual([
      DataType.ActivationTrack,
      DataType.TransformTrack,
      DataType.SubCompositionTrack,
      DataType.ActivationTrack,
    ]);
    expect(activationTracks).toHaveLength(2);
    expect(activationTracks.map(track => (track['clips'] as Record<string, unknown>[])[0])).toEqual([
      expect.objectContaining({ start: 1, duration: 2 }),
      expect.objectContaining({ start: 1, duration: 2 }),
    ]);
    expect(subCompositionClip?.['start']).toBe(0.6);
    expect(subCompositionClip?.['duration']).toBe(2.4);
  });

  it('keeps an early Precomp source clock behind its layer activation window', () => {
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'delayed-precomp',
      type: 'precomp',
      time: { inFrame: 42, outFrame: 91, sourceStartFrame: 42 },
    });
    const ir = createMinimalIR([precomp]);

    ir.frameRate = 24;
    ir.outPoint = 96;
    const result = convertIRWithPreservedData(ir, {
      [precomp.id]: { sourceItemIds: ['source-precomp-item'] },
    });
    const item = result.scene.items.find(candidate => candidate.name === 'delayed-precomp');

    expect(result.diagnostics).toEqual([]);
    expect(item).toMatchObject({
      id: 'source-precomp-item',
      type: ItemType.composition,
      delay: 1.75,
      duration: 2.0417,
    });
    if (item == null) {
      throw new Error('expected delayed Precomp Item');
    }
    const tracks = getItemTimelineTracks(result.scene, item.id);
    const activationTracks = tracks.filter(track => track['dataType'] === DataType.ActivationTrack);
    const subCompositionTrack = tracks.find(track => track['dataType'] === DataType.SubCompositionTrack);
    const subCompositionClip = (subCompositionTrack?.['clips'] as Record<string, unknown>[] | undefined)?.[0];

    expect(tracks.map(track => track['dataType'])).toEqual([
      DataType.ActivationTrack,
      DataType.TransformTrack,
      DataType.SubCompositionTrack,
      DataType.ActivationTrack,
    ]);
    expect(activationTracks.map(track => (track['clips'] as Record<string, unknown>[])[0])).toEqual([
      expect.objectContaining({ start: 1.75, duration: 2.0417 }),
      expect.objectContaining({ start: 1.75, duration: 2.0417 }),
    ]);
    expect(subCompositionClip).toEqual(expect.objectContaining({ start: 0, duration: 3.7917 }));
  });

  it('clamps an unsupported Precomp source frame to the referenced inPoint', () => {
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'clamped-precomp',
      type: 'precomp',
      time: { inFrame: 30, outFrame: 90, sourceStartFrame: 6 },
    });
    const ir = createMinimalIR([precomp]);
    const document = createTestIRScene(ir);

    document.compositions[1].inPoint = 12;
    const result = convertIRSceneToGE(document);
    const item = result.scene.items.find(candidate => candidate.name === 'clamped-precomp');

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_PRECOMP_SOURCE_START_UNSUPPORTED', sourceId: precomp.id, action: 'approximated',
    }));
    if (item == null) {
      throw new Error('expected clamped Precomp Item');
    }
    const tracks = getItemTimelineTracks(result.scene, item.id);
    const subCompositionTrack = tracks.find(track => track['dataType'] === DataType.SubCompositionTrack);
    const subCompositionClip = (subCompositionTrack?.['clips'] as Record<string, unknown>[] | undefined)?.[0];

    expect(tracks.map(track => track['dataType'])).toEqual([
      DataType.ActivationTrack,
      DataType.TransformTrack,
      DataType.SubCompositionTrack,
    ]);
    expect(subCompositionClip).toEqual(expect.objectContaining({ start: 1, duration: 2 }));
  });

  it('preserves a Precomp canvas pivot across different parent and child pixel scales', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'offset-precomp',
        type: 'precomp',
        localBounds: { x: 0, y: 0, width: 180, height: 320 },
        transform: {
          position: { type: 'static', value: [200, 300, 0] },
          anchor: { type: 'static', value: [30, 40, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const document = createTestIRScene(ir);
    const childComposition = document.compositions[1];

    childComposition.width = 180;
    childComposition.height = 320;

    const scene = convertIRSceneToGE(document).scene;
    const item = scene.items.find(candidate => candidate.name === 'offset-precomp');
    const parentRatio = get2dTo3dRatio(ir.width, ir.height);
    const childRatio = get2dTo3dRatio(childComposition.width, childComposition.height);
    const position = convert2dTo3dPoint(200, 300, 0, ir.width, ir.height);
    const anchor = {
      x: childRatio * (30 - childComposition.width / 2),
      y: -childRatio * (40 - childComposition.height / 2),
    };

    expect(item?.transform).toBeDefined();
    expect(item!.transform!.anchor).toEqual(anchor);
    expect(item!.transform!.position).toEqual({
      x: position[0] - anchor.x,
      y: position[1] - anchor.y,
      z: 0,
    });
    expect(item!.transform!.scale).toEqual({ x: parentRatio / childRatio, y: parentRatio / childRatio, z: 1 });
  });

  it('keeps a Precomp transform parent pivot fixed during animated scale', () => {
    const parent = createMinimalLayer({
      orderIndex: 0,
      name: 'button-group',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 1080, height: 570 },
      transform: {
        position: { type: 'static', value: [538, 567, 0] },
        anchor: { type: 'static', value: [538, 567, 0] },
        scale: {
          type: 'keyframed',
          keyframes: [
            { frame: 0, value: [1, 1, 1], endValue: [0.82, 0.82, 1] },
            { frame: 8, value: [0.82, 0.82, 1], endValue: [1.25, 1.25, 1] },
            { frame: 14, value: [1.25, 1.25, 1] },
          ],
        },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });
    const child = createMinimalLayer({
      orderIndex: 1,
      name: 'button-glow',
      type: 'image',
      parentId: parent.id,
      imageUrl: 'https://example.com/button-glow.png',
      localBounds: { x: 0, y: 0, width: 298, height: 55 },
      transform: {
        position: { type: 'static', value: [539.451, 527.5, 0] },
        anchor: { type: 'static', value: [149, 27.5, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });

    if (parent.type !== 'precomp') {
      throw new Error('expected precomp test parent');
    }
    parent.content.clipToBounds = true;
    const ir = createMinimalIR([parent, child]);

    ir.width = 1080;
    ir.height = 570;

    const scene = convertIRToGE(ir);
    const parentItem = scene.items.find(item => item.name === 'button-group');
    const precompContentItem = scene.items.find(item => item.name === 'button-group content');
    const childItem = scene.items.find(item => item.name === 'button-glow');
    const maskItem = scene.items.find(item => item.name === 'button-group_mask');
    const childComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['id'] === childItem?.components?.[0]?.id,
    );
    const expectedParentPosition = convert2dTo3dPoint(538, 567, 0, ir.width, ir.height);
    const expectedContentAnchor = expectedParentPosition;
    const expectedChildPosition = convert2dTo3dPoint(539.451, 527.5, 0, ir.width, ir.height);
    const ratio = get2dTo3dRatio(ir.width, ir.height);

    expect(parentItem?.transform?.position).toEqual({
      x: expectedParentPosition[0], y: expectedParentPosition[1], z: 0,
    });
    expect(parentItem?.transform?.anchor).toEqual({ x: 0, y: 0 });
    expect(precompContentItem?.parentId).toBe(parentItem?.id);
    expect(precompContentItem?.transform?.position).toEqual({
      x: -expectedContentAnchor[0], y: -expectedContentAnchor[1], z: 0,
    });
    expect(precompContentItem?.transform?.anchor).toEqual({ x: 0, y: 0 });
    expect(childItem?.parentId).toBe(parentItem?.id);
    expect(childItem?.transform?.position).toEqual({
      x: expectedChildPosition[0] - ratio * (538 - ir.width / 2),
      y: expectedChildPosition[1] + ratio * (567 - ir.height / 2),
      z: 0,
    });

    const contentPivot = {
      x: precompContentItem!.transform!.position.x +
        precompContentItem!.transform!.scale.x * expectedContentAnchor[0],
      y: precompContentItem!.transform!.position.y +
        precompContentItem!.transform!.scale.y * expectedContentAnchor[1],
    };

    for (const scale of [0.82, 1.25]) {
      expect(parentItem!.transform!.position.x + scale * contentPivot.x).toBeCloseTo(expectedParentPosition[0], 12);
      expect(parentItem!.transform!.position.y + scale * contentPivot.y).toBeCloseTo(expectedParentPosition[1], 12);
    }
    expect(maskItem?.parentId).toBe(precompContentItem?.id);
    expect(maskItem?.transform?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(childComponent?.['mask']).toBeUndefined();
  });

  it('does not leak a Precomp canvas scale into an external transform child', () => {
    const parent = createMinimalLayer({
      orderIndex: 0,
      name: 'scaled-precomp-parent',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 300, height: 371 },
      transform: {
        position: { type: 'static', value: [56.856, 42.8, 0] },
        anchor: { type: 'static', value: [120, 140, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });
    const child = createMinimalLayer({
      orderIndex: 1,
      name: 'external-glow',
      type: 'image',
      parentId: parent.id,
      imageUrl: 'https://example.com/glow.png',
      localBounds: { x: 0, y: 0, width: 225, height: 259 },
      transform: {
        position: { type: 'static', value: [151.646, 180.373, 0] },
        anchor: { type: 'static', value: [112.5, 129.5, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });

    if (parent.type !== 'precomp') {
      throw new Error('expected precomp test parent');
    }
    const ir = createMinimalIR([parent, child]);
    const document = createTestIRScene(ir);
    const referencedComposition = document.compositions[1];

    referencedComposition.width = 300;
    referencedComposition.height = 371;
    const scene = convertIRSceneToGE(document).scene;
    const parentItem = scene.items.find(item => item.name === 'scaled-precomp-parent');
    const precompContentItem = scene.items.find(item => item.name === 'scaled-precomp-parent content');
    const childItem = scene.items.find(item => item.name === 'external-glow');
    const compositionRatio = get2dTo3dRatio(ir.width, ir.height);
    const referencedRatio = get2dTo3dRatio(300, 371);
    const intrinsicScale = compositionRatio / referencedRatio;
    const expectedParentPosition = convert2dTo3dPoint(56.856, 42.8, 0, ir.width, ir.height);
    const referencedAnchor = {
      x: referencedRatio * (120 - 150),
      y: -referencedRatio * (140 - 185.5),
    };
    const expectedChildPosition = convert2dTo3dPoint(151.646, 180.373, 0, ir.width, ir.height);

    expect(parentItem?.type).toBe(ItemType.null);
    expect(parentItem?.transform?.position).toEqual({
      x: expectedParentPosition[0], y: expectedParentPosition[1], z: 0,
    });
    expect(parentItem?.transform?.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(precompContentItem?.parentId).toBe(parentItem?.id);
    expect(precompContentItem?.transform?.scale).toEqual({
      x: intrinsicScale,
      y: intrinsicScale,
      z: 1,
    });
    expect(precompContentItem?.transform?.position).toEqual({
      x: -intrinsicScale * referencedAnchor.x,
      y: -intrinsicScale * referencedAnchor.y,
      z: 0,
    });
    expect(precompContentItem?.transform?.anchor).toEqual({ x: 0, y: 0 });
    expect(childItem?.parentId).toBe(parentItem?.id);
    expect(childItem?.transform?.position).toEqual({
      x: expectedChildPosition[0] - compositionRatio * (120 - ir.width / 2),
      y: expectedChildPosition[1] + compositionRatio * (140 - ir.height / 2),
      z: 0,
    });
  });

  it('applies a Precomp mask to renderers inside the referenced Composition', () => {
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'masked-precomp',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
    });
    const document = createTestIRScene(createMinimalIR([precomp]));
    const childComposition = document.compositions[1];

    childComposition.width = 200;
    childComposition.height = 100;
    childComposition.layers = [createMinimalLayer({
      orderIndex: 1,
      name: 'child-solid',
      type: 'solid',
      content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
    })];

    const scene = convertIRSceneToGE(document).scene;
    const maskComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => (component['mask'] as Record<string, unknown> | undefined)?.['isMask'] === true,
    );
    const childComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['dataType'] === 'SpriteComponent' && component['mask'] != null,
    );

    expect(getMaskReferenceIds(childComponent)).toEqual([maskComponent?.['id']]);
    expect(childComponent?.['mask']).not.toHaveProperty('reference');
  });

  it('positions an inline image mask from the visual bounds center when its anchor is off-center', () => {
    const layer = createMinimalLayer({
      orderIndex: 0,
      name: '红包浅色覆盖',
      type: 'image',
      imageUrl: 'https://example.com/red-packet-highlight.png',
      localBounds: { x: 0, y: 0, width: 968, height: 343 },
      transform: {
        position: { type: 'static', value: [807.5, 359.5, 0] },
        anchor: { type: 'static', value: [943, 211.5, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [
            { x: 847, y: 154.5 }, { x: 819.5, y: 273.5 },
            { x: 930, y: 273 }, { x: 961.5, y: 165 },
          ],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
    });
    const ir = createMinimalIR([layer]);

    ir.width = 1080;
    ir.height = 570;
    const scene = convertIRToGE(ir);
    const imageItem = scene.items.find(item => item.name === '红包浅色覆盖');
    const maskItem = scene.items.find(item => item.name === '红包浅色覆盖_mask');
    const ratio = get2dTo3dRatio(ir.width, ir.height);

    expect(imageItem?.type).toBe(ItemType.sprite);
    expect(maskItem?.parentId).toBe(imageItem?.id);
    expect(maskItem?.transform?.position?.x).toBeCloseTo((890.5 - 484) * ratio, 4);
    expect(maskItem?.transform?.position?.y).toBeCloseTo(-(214 - 171.5) * ratio, 4);
  });

  it('keeps a pivot-container mask relative to the authored anchor', () => {
    const layer = createMinimalLayer({
      orderIndex: 0,
      name: 'rotating-masked-image',
      type: 'image',
      imageUrl: 'https://example.com/rotating.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      transform: {
        position: { type: 'static', value: [360, 640, 0] },
        anchor: { type: 'static', value: [10, 10, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: {
          z: {
            type: 'keyframed',
            keyframes: [{ frame: 0, value: 0 }, { frame: 90, value: 360 }],
          },
        },
        opacity: { type: 'static', value: 1 },
      },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [{ x: 20, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 50 }, { x: 20, y: 50 }],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
    });
    const ir = createMinimalIR([layer]);
    const scene = convertIRToGE(ir);
    const nullItem = scene.items.find(item => item.name === layer.name && item.type === ItemType.null);
    const maskItem = scene.items.find(item => item.name === `${layer.name}_mask`);
    const ratio = get2dTo3dRatio(ir.width, ir.height);

    expect(maskItem?.parentId).toBe(nullItem?.id);
    expect(maskItem?.transform?.position?.x).toBeCloseTo((30 - 10) * ratio, 4);
    expect(maskItem?.transform?.position?.y).toBeCloseTo(-(40 - 10) * ratio, 4);
  });

  it('builds a Precomp clip mask in the referenced Composition coordinate scale', () => {
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'clipped-precomp',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
    });

    if (precomp.type !== 'precomp') {
      throw new Error('expected precomp test layer');
    }
    precomp.content.clipToBounds = true;
    const document = createTestIRScene(createMinimalIR([precomp]));
    const referencedComposition = document.compositions[1];

    referencedComposition.width = 200;
    referencedComposition.height = 100;
    referencedComposition.layers = [createMinimalLayer({
      orderIndex: 1,
      name: 'clipped-child',
      type: 'solid',
      content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
    })];

    const scene = convertIRSceneToGE(document).scene;
    const maskItem = scene.items.find(item => item.name === 'clipped-precomp_mask');
    const maskComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['id'] === maskItem?.components?.[0]?.id,
    );
    const referencedRatio = get2dTo3dRatio(referencedComposition.width, referencedComposition.height);

    const itemById = new Map(scene.items.map(item => [item.id, item] as const));
    const precompItem = scene.items.find(item => item.name === 'clipped-precomp');
    const outputCompositionId = (precompItem?.content?.options as { refId?: string } | undefined)?.refId;
    const outputComponent = scene.components.find(component =>
      component.dataType === DataType.CompositionComponent && component.item.id === outputCompositionId,
    ) as (typeof scene.components[number] & { items: Array<{ id: string }> }) | undefined;
    const orderedNames = getCompositionItemIds(scene as unknown as Record<string, unknown>, outputComponent?.item.id).map(id => ({ id })).map(reference => itemById.get(reference.id)?.name);
    const clippedChildItem = getCompositionItemIds(scene as unknown as Record<string, unknown>, outputComponent?.item.id).map(id => ({ id }))
      .map(reference => itemById.get(reference.id))
      .find(item => item?.name === 'clipped-child');
    const clippedChildComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['id'] === clippedChildItem?.components?.[0]?.id,
    );

    expect(maskComponent?.['width']).toBeCloseTo(referencedRatio * 200, 4);
    expect(maskComponent?.['height']).toBeCloseTo(referencedRatio * 100, 4);
    expect(maskItem?.transform?.position.x).toBe(0);
    expect(maskItem?.transform?.position.y).toBe(0);
    expect(maskItem?.parentId).toBe(precompItem?.id);
    expect(orderedNames).not.toContain('clipped-precomp_mask');
    expect(getMaskReferenceIds(clippedChildComponent)).toEqual([maskComponent?.['id']]);
  });

  it('propagates a smaller automatic Precomp window across a nested Composition boundary', () => {
    const outer = createMinimalLayer({
      orderIndex: 0,
      name: 'outer-clipped-precomp',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 620, height: 205 },
    });

    if (outer.type !== 'precomp') {
      throw new Error('expected outer precomp test layer');
    }
    outer.content.clipToBounds = true;
    const document = createTestIRScene(createMinimalIR([outer]));
    const childComposition = document.compositions[1];

    childComposition.width = 620;
    childComposition.height = 205;
    const nested = createMinimalLayer({
      orderIndex: 1,
      name: 'nested-clipped-precomp',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 175, height: 2000 },
    });

    if (nested.type !== 'precomp') {
      throw new Error('expected nested precomp test layer');
    }
    nested.content.clipToBounds = true;
    childComposition.layers = [nested];
    document.compositions.push({
      ...createMinimalIR([createMinimalLayer({
        orderIndex: 2,
        name: 'nested-child-solid',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 175, height: 2000 },
      })]),
      id: nested.content.compositionId,
      name: 'nested-child-composition',
      width: 175,
      height: 2000,
    });

    const scene = convertIRSceneToGE(document).scene;
    const reachableItemIds = collectReachableItemIds(scene);
    const outerMaskComponentId = scene.items
      .find(item => item.name === 'outer-clipped-precomp_mask')
      ?.components?.[0]?.id;
    const nestedChildComponentIds = new Set(scene.items
      .filter(item => item.name === 'nested-child-solid' && reachableItemIds.has(item.id))
      .flatMap(item => item.components ?? [])
      .map(component => component.id));
    const nestedChildMaskIds = (scene.components as unknown as Record<string, unknown>[])
      .filter(component => nestedChildComponentIds.has(String(component['id'])))
      .flatMap(component => getMaskReferenceIds(component));
    const nestedChildMaskItemNames = nestedChildMaskIds.map(maskComponentId => {
      const maskComponent = scene.components.find(component => component.id === maskComponentId);
      const maskItem = scene.items.find(item => item.id === maskComponent?.item.id);

      return maskItem?.name;
    });

    expect(outerMaskComponentId).toBeDefined();
    expect(nestedChildMaskIds.length).toBeGreaterThan(0);
    expect(nestedChildMaskIds).toContain(outerMaskComponentId);
    expect(nestedChildMaskItemNames).toContain('outer-clipped-precomp_mask');
    expect(nestedChildMaskItemNames).toContain('nested-clipped-precomp_mask');
  });

  it('keeps an authored boundary that is inside a full-canvas automatic clip', () => {
    const outer = createMinimalLayer({
      orderIndex: 0,
      name: 'outer-authored-mask',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [
            { x: 0, y: 0 }, { x: 0, y: 80 }, { x: 20, y: 90 }, { x: 100, y: 98 },
            { x: 180, y: 90 }, { x: 200, y: 80 }, { x: 200, y: 0 },
          ],
          inTangents: [
            { x: 0, y: 0 }, { x: -0.4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
            { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
          ],
          outTangents: [
            { x: -0.4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
            { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
          ],
          closed: true,
        },
      }],
    });
    const document = createTestIRScene(createMinimalIR([outer]));
    const childComposition = document.compositions[1];

    childComposition.width = 200;
    childComposition.height = 100;
    const nested = createMinimalLayer({
      orderIndex: 1,
      name: 'nested-local-clip',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      transform: {
        position: { type: 'static', value: [100, 50, 0] },
        anchor: { type: 'static', value: [100, 50, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });

    if (nested.type !== 'precomp') {
      throw new Error('expected nested precomp test layer');
    }
    nested.content.clipToBounds = true;
    childComposition.layers = [nested];
    document.compositions.push({
      ...createMinimalIR([createMinimalLayer({
        orderIndex: 2,
        name: 'nested-clipped-renderer',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 200, height: 100 },
      })]),
      id: nested.content.compositionId,
      name: 'nested-local-composition',
      width: 200,
      height: 100,
    });

    const scene = convertIRSceneToGE(document).scene;
    const reachableItemIds = collectReachableItemIds(scene);
    const outerMaskComponentId = scene.items
      .find(item => item.name === 'outer-authored-mask_mask' && reachableItemIds.has(item.id))
      ?.components?.[0]?.id;
    const nestedRendererComponentIds = new Set(scene.items
      .filter(item => item.name === 'nested-clipped-renderer' && reachableItemIds.has(item.id))
      .flatMap(item => item.components ?? [])
      .map(component => component.id));
    const nestedMaskComponentIds = (scene.components as unknown as Record<string, unknown>[])
      .filter(component => nestedRendererComponentIds.has(String(component['id'])))
      .flatMap(component => getMaskReferenceIds(component));
    const nestedMaskItemNames = nestedMaskComponentIds.map(maskComponentId => {
      const maskComponent = scene.components.find(component => component.id === maskComponentId);
      const maskItem = scene.items.find(item => item.id === maskComponent?.item.id);

      return maskItem?.name;
    });

    expect(outerMaskComponentId).toBeDefined();
    expect(nestedMaskComponentIds.length).toBeGreaterThan(0);
    expect(nestedMaskComponentIds.every(id => id === outerMaskComponentId)).toBe(true);
    expect(nestedMaskItemNames.every(name => name === 'outer-authored-mask_mask')).toBe(true);
  });

  it('keeps a nested automatic clip that is inside an outer authored boundary', () => {
    const outer = createMinimalLayer({
      orderIndex: 0,
      name: 'outer-authored-boundary',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
    });
    const document = createTestIRScene(createMinimalIR([outer]));
    const childComposition = document.compositions[1];

    childComposition.width = 200;
    childComposition.height = 100;
    const nested = createMinimalLayer({
      orderIndex: 1,
      name: 'nested-small-clip',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 100, height: 40 },
      transform: {
        position: { type: 'static', value: [100, 50, 0] },
        anchor: { type: 'static', value: [50, 20, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });

    if (nested.type !== 'precomp') {
      throw new Error('expected nested precomp test layer');
    }
    nested.content.clipToBounds = true;
    childComposition.layers = [nested];
    document.compositions.push({
      ...createMinimalIR([createMinimalLayer({
        orderIndex: 2,
        name: 'nested-small-renderer',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 100, height: 40 },
      })]),
      id: nested.content.compositionId,
      name: 'nested-small-composition',
      width: 100,
      height: 40,
    });

    const scene = convertIRSceneToGE(document).scene;
    const reachableItemIds = collectReachableItemIds(scene);
    const nestedMaskComponentId = scene.items
      .find(item => item.name === 'nested-small-clip_mask' && reachableItemIds.has(item.id))
      ?.components?.[0]?.id;
    const nestedRendererComponentIds = new Set(scene.items
      .filter(item => item.name === 'nested-small-renderer' && reachableItemIds.has(item.id))
      .flatMap(item => item.components ?? [])
      .map(component => component.id));
    const nestedRendererMaskIds = (scene.components as unknown as Record<string, unknown>[])
      .filter(component => nestedRendererComponentIds.has(String(component['id'])))
      .flatMap(component => getMaskReferenceIds(component));

    expect(nestedMaskComponentId).toBeDefined();
    expect(nestedRendererMaskIds.length).toBeGreaterThan(0);
    expect(nestedRendererMaskIds.every(id => id === nestedMaskComponentId)).toBe(true);
  });

  it('keeps a propagated mask attached to its source hierarchy across nested transforms', () => {
    const outer = createMinimalLayer({
      orderIndex: 0,
      name: 'outer-hierarchy-mask',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
    });
    const document = createTestIRScene(createMinimalIR([outer]));
    const rootComposition = document.compositions[0];
    const childComposition = document.compositions[1];
    const transformParent = createMinimalLayer({
      orderIndex: 1,
      name: 'nested-transform-parent',
      type: 'null',
      transform: {
        position: {
          type: 'keyframed',
          keyframes: [
            { frame: 0, value: [20, 10, 0], endValue: [40, 10, 0] },
            { frame: 12, value: [40, 10, 0] },
          ],
        },
        anchor: { type: 'static', value: [0, 0, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });
    const nested = createMinimalLayer({
      orderIndex: 2,
      name: 'nested-parented-precomp',
      type: 'precomp',
      parentId: transformParent.id,
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      transform: {
        position: { type: 'static', value: [60, 40, 0] },
        anchor: { type: 'static', value: [100, 50, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 0 } },
        opacity: { type: 'static', value: 1 },
      },
    });

    if (nested.type !== 'precomp') {
      throw new Error('expected nested precomp test layer');
    }
    rootComposition.width = 200;
    rootComposition.height = 100;
    childComposition.width = 200;
    childComposition.height = 100;
    childComposition.layers = [transformParent, nested];
    document.compositions.push({
      ...createMinimalIR([createMinimalLayer({
        orderIndex: 3,
        name: 'nested-parented-renderer',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 200, height: 100 },
      })]),
      id: nested.content.compositionId,
      name: 'nested-parented-composition',
      width: 200,
      height: 100,
    });

    const scene = convertIRSceneToGE(document).scene;
    const itemById = new Map(scene.items.map(item => [item.id, item] as const));
    const rootPrecompItem = scene.items.find(item => item.name === 'outer-hierarchy-mask');
    const childOutputId = (rootPrecompItem?.content?.options as { refId?: string } | undefined)?.refId;
    const childComponent = scene.components.find(component =>
      component.dataType === DataType.CompositionComponent && component.item.id === childOutputId,
    ) as (typeof scene.components[number] & { items: Array<{ id: string }> }) | undefined;
    const childItems = getCompositionItemIds(scene as unknown as Record<string, unknown>, childComponent?.item.id).map(id => ({ id })).map(reference => itemById.get(reference.id));
    const parentItem = childItems.find(item => item?.name === 'nested-transform-parent');
    const nestedItem = childItems.find(item => item?.name === 'nested-parented-precomp');
    const sourceMaskItem = scene.items.find(item => item.name === 'outer-hierarchy-mask_mask');
    const nestedOutputId = (nestedItem?.content?.options as { refId?: string } | undefined)?.refId;
    const nestedComponent = scene.components.find(component =>
      component.dataType === DataType.CompositionComponent && component.item.id === nestedOutputId,
    ) as (typeof scene.components[number] & { items: Array<{ id: string }> }) | undefined;
    const nestedItems = getCompositionItemIds(scene as unknown as Record<string, unknown>, nestedComponent?.item.id).map(id => ({ id }))
      .map(reference => itemById.get(reference.id))
      .filter((item): item is NonNullable<typeof item> => item != null);
    const nestedRendererItem = nestedItems.find(item => item.name === 'nested-parented-renderer');
    const nestedRendererComponent = scene.components.find(
      component => component.id === nestedRendererItem?.components?.[0]?.id,
    ) as Record<string, unknown> | undefined;
    const sourceMaskComponentId = sourceMaskItem?.components?.[0]?.id;

    expect(sourceMaskItem).toBeDefined();
    expect(parentItem).toBeDefined();
    expect(nestedItem).toBeDefined();
    expect(sourceMaskItem?.parentId).toBe(rootPrecompItem?.id);
    expect(childItems).not.toContain(sourceMaskItem);
    expect(nestedItems).not.toContain(sourceMaskItem);
    expect(getMaskReferenceIds(nestedRendererComponent)).toEqual([sourceMaskComponentId]);
  });

  it('keeps nested authored masks when cross-composition containment cannot be proven', () => {
    const outerMask: IRMask = {
      mode: IRMaskMode.Add,
      path: {
        points: [{ x: 10, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 90 }, { x: 10, y: 90 }],
        inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
        outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
        closed: true,
      },
    };
    const innerMask: IRMask = {
      mode: IRMaskMode.Add,
      path: {
        points: [{ x: 30, y: 20 }, { x: 170, y: 20 }, { x: 170, y: 80 }, { x: 30, y: 80 }],
        inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
        outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
        closed: true,
      },
    };
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'outer-masked-precomp',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [outerMask],
    });
    const document = createTestIRScene(createMinimalIR([precomp]));
    const childComposition = document.compositions[1];

    childComposition.width = 200;
    childComposition.height = 100;
    childComposition.layers = [createMinimalLayer({
      orderIndex: 0,
      name: 'inner-masked-solid',
      type: 'solid',
      content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [innerMask],
    })];

    const scene = convertIRSceneToGE(document).scene;
    const reachableItemIds = collectReachableItemIds(scene);
    const childComponentIds = new Set(
      scene.items
        .filter(item => item.name === 'inner-masked-solid' && reachableItemIds.has(item.id))
        .map(item => item.components?.[0]?.id)
        .filter(id => id != null),
    );
    const childComponents = (scene.components as unknown as Record<string, unknown>[]).filter(component =>
      childComponentIds.has(component['id'] as string),
    );
    const outerMaskComponentIds = new Set(scene.items
      .filter(item => item.name === 'outer-masked-precomp_mask' && reachableItemIds.has(item.id))
      .flatMap(item => item.components ?? [])
      .map(component => component.id));
    const innerMaskComponentIds = new Set(scene.items
      .filter(item => item.name === 'inner-masked-solid_mask' && reachableItemIds.has(item.id))
      .flatMap(item => item.components ?? [])
      .map(component => component.id));
    const masks = childComponents.map(component => component['mask'] as Record<string, unknown> | undefined);

    expect(innerMaskComponentIds.size).toBeGreaterThan(0);
    expect(masks.every(mask => {
      const referenceIds = getMaskReferenceIds({ mask });

      return referenceIds.some(id => innerMaskComponentIds.has(id)) &&
        referenceIds.some(id => outerMaskComponentIds.has(id));
    })).toBe(true);
  });

  it('combines an authored Precomp mask with clipToBounds', () => {
    const precomp = createMinimalLayer({
      orderIndex: 0,
      name: 'authored-and-clipped',
      type: 'precomp',
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [{ x: -10, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 90 }, { x: -10, y: 90 }],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
    });

    if (precomp.type !== 'precomp') {
      throw new Error('expected precomp test layer');
    }
    precomp.content.clipToBounds = true;
    const document = createTestIRScene(createMinimalIR([precomp]));
    const childComposition = document.compositions[1];

    childComposition.layers = [createMinimalLayer({
      orderIndex: 1,
      name: 'child-solid',
      type: 'solid',
      content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 200, height: 100 },
    })];
    const result = convertIRSceneToGE(document);
    const targetMasks = (result.scene.components as unknown as Record<string, unknown>[])
      .map(component => component['mask'] as Record<string, unknown> | undefined)
      .filter(mask => mask?.['isMask'] === false);

    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'GE_PRECOMP_CLIP_MASK_CONFLICT',
    }));
    expect(targetMasks.length).toBeGreaterThan(0);
    expect(targetMasks.every(mask => Array.isArray(mask?.['references']) && mask.references.length === 2)).toBe(true);
  });

  it('combines an authored path mask with a Layer matte reference', () => {
    const source = createMinimalLayer({
      orderIndex: 0,
      name: 'combined-matte-source',
      type: 'solid',
      content: { color: [1, 1, 1, 1] },
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const target = createMinimalLayer({
      orderIndex: 1,
      name: 'combined-mask-target',
      type: 'solid',
      content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      masks: [{
        mode: IRMaskMode.Add,
        path: {
          points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }],
          inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
          closed: true,
        },
      }],
      matte: { sourceLayerId: source.id, mode: IRMatteMode.Geometry, inverted: true },
    });
    const result = convertIRSceneToGE(createTestIRScene(createMinimalIR([source, target])));
    const itemById = new Map(result.scene.items.map(item => [item.id, item] as const));
    const findComponentByItemName = (name: string) => result.scene.components.find(component =>
      itemById.get(component.item.id)?.name === name,
    ) as unknown as Record<string, unknown> | undefined;
    const sourceComponent = findComponentByItemName(source.name ?? source.id);
    const targetComponent = findComponentByItemName(target.name ?? target.id);
    const pathMaskComponent = findComponentByItemName(`${target.name ?? target.id}_mask`);
    const targetMask = targetComponent?.['mask'] as Record<string, unknown> | undefined;

    expect(sourceComponent?.['mask']).toEqual({ isMask: true, alphaMaskEnabled: false });
    expect(targetMask?.['references']).toEqual([
      { mask: { id: pathMaskComponent?.['id'] }, inverted: false },
      { mask: { id: sourceComponent?.['id'] }, inverted: true },
    ]);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GE_MASK_MATTE_CONFLICT' }));
  });

  it('keeps a Precomp mask out of the parent Timeline binding order', () => {
    const layers = [
      createMinimalLayer({
        orderIndex: 0,
        name: 'bottom',
        type: 'solid',
        content: { color: [0, 0, 1, 1] },
        localBounds: { x: 0, y: 0, width: 720, height: 1280 },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'masked-precomp',
        type: 'precomp',
        localBounds: { x: 0, y: 0, width: 200, height: 100 },
        masks: [{
          mode: IRMaskMode.Add,
          path: {
            points: [{ x: 10, y: 10 }, { x: 190, y: 10 }, { x: 190, y: 90 }, { x: 10, y: 90 }],
            inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
            outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
            closed: true,
          },
        }],
      }),
      createMinimalLayer({
        orderIndex: 2,
        name: 'top',
        type: 'solid',
        content: { color: [1, 0, 0, 1] },
        localBounds: { x: 0, y: 0, width: 720, height: 1280 },
      }),
    ];
    const document = createTestIRScene(createMinimalIR(layers));
    const scene = convertIRSceneToGE(document).scene;
    const itemById = new Map(scene.items.map(item => [item.id, item] as const));
    const entryComponent = scene.components.find(component =>
      component.dataType === DataType.CompositionComponent && component.item.id === document.entryCompositionId,
    ) as (typeof scene.components[number] & {
      items: Array<{ id: string }>;
      sceneBindings: Array<{ value: { id: string } }>;
    }) | undefined;
    const orderedNames = getCompositionItemIds(scene as unknown as Record<string, unknown>, entryComponent?.item.id).map(id => ({ id })).map(reference => itemById.get(reference.id)?.name);
    const timelineNames = entryComponent?.sceneBindings.map(binding => itemById.get(binding.value.id)?.name);

    const precompItem = scene.items.find(item => item.name === 'masked-precomp');
    const outputCompositionId = (precompItem?.content?.options as { refId?: string } | undefined)?.refId;
    const outputComponent = scene.components.find(component =>
      component.dataType === DataType.CompositionComponent && component.item.id === outputCompositionId,
    ) as (typeof scene.components[number] & { items: Array<{ id: string }> }) | undefined;
    const outputNames = getCompositionItemIds(scene as unknown as Record<string, unknown>, outputComponent?.item.id).map(id => ({ id })).map(reference => itemById.get(reference.id)?.name);

    expect(orderedNames).toEqual(['bottom', 'masked-precomp', 'masked-precomp_mask', 'top']);
    expect(timelineNames).toEqual(['bottom', 'masked-precomp', 'top']);
    expect(outputNames).not.toContain('masked-precomp_mask');
  });

  it('lowers instance-local Precomp opacity through a generated Composition variant', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'transparent-precomp',
        type: 'precomp',
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          opacity: { type: 'static', value: 0.5 },
        },
      }),
    ]);
    const document = createTestIRScene(ir);
    const childComposition = document.compositions[1];

    childComposition.layers = [createMinimalLayer({
      orderIndex: 1,
      name: 'child-solid',
      type: 'solid',
      content: { color: [1, 0, 0, 1] },
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    })];

    const result = convertIRSceneToGE(document);
    const precompItem = result.scene.items.find(item => item.name === 'transparent-precomp');
    const outputCompositionId = (precompItem?.content?.options as Record<string, unknown>)['refId'];
    const opacityAsset = (result.scene.miscs as unknown as Array<Record<string, unknown>>).find(misc => {
      const color = misc['colorOverLifetime'] as Record<string, unknown> | undefined;

      return misc['dataType'] === DataType.SpriteColorPlayableAsset &&
        JSON.stringify(color?.['opacity']) === JSON.stringify([ValueType.CONSTANT, 0.5]);
    });

    expect(result.diagnostics).toEqual([]);
    expect(outputCompositionId).not.toBe(childComposition.id);
    expect(result.scene.compositions.some(composition => composition.id === outputCompositionId)).toBe(true);
    expect(opacityAsset).toBeDefined();
  });

  it('uses a fractional numeric frame rate when deriving GE duration', () => {
    const ir = createMinimalIR([]);

    ir.frameRate = 30_000 / 1_001;
    ir.outPoint = 30_000;

    const scene = convertIRToGE(ir);

    expect(scene.compositions[0]?.duration).toBe(1_001);
  });

  it('preserves a repeated position path with an instantaneous reset', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'jumping-position',
        type: 'null',
        transform: {
          position: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: [0, 0, 0], endValue: [10, 10, 0] },
              { frame: 45, value: [0, 0, 0], endValue: [10, 10, 0] },
              { frame: 90, value: [10, 10, 0] },
            ],
          },
        },
      }),
    ]);

    const scene = convertIRToGE(ir);
    const transformAsset = (scene.miscs as unknown as Record<string, unknown>[])
      .find(misc => misc['dataType'] === DataType.TransformPlayableAsset);
    const position = transformAsset?.['positionOverLifetime'] as { path: [number, [unknown[], number[][]]] };
    const [timing, points] = position.path[1];

    expect(timing).toHaveLength(4);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual(points[2]);
    expect(points[1]).toEqual(points[3]);
    expect(points[0]).not.toEqual(points[1]);
    expect(timing[1]).toMatchObject([1, [expect.any(Number), expect.any(Number), 0.5, 0.5, 0.5, 0.5]]);
    expect(timing[2]).toMatchObject([1, [0.5, 0.5, 0.5, 0.5, expect.any(Number), expect.any(Number)]]);
  });

  it('generates an image scene', () => {
    const scene = convertIRToGE(createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'bg',
        type: 'image',
        imageUrl: 'https://example.com/bg.png',
        localBounds: { x: 0, y: 0, width: 720, height: 1280 },
      }),
    ]));

    expect(scene.items).toHaveLength(1);
    expect(scene.images).toHaveLength(1);
    expect(scene.textures).toHaveLength(1);
    expect(scene).toMatchSnapshot();
  });

  it('resolves Image Layer content from the Scene Asset Registry', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'ref-image',
        type: 'image',
        imageAssetId: 'img-0',
        imageUrl: 'https://example.com/ref-only.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    const scene = convertIRToGE(ir);

    expect(scene.images).toEqual([expect.objectContaining({ url: 'https://example.com/ref-only.png' })]);
    expect(scene.textures).toHaveLength(1);
  });

  it('shares one GE Image and Texture for two layers referencing one Image Asset', () => {
    const sharedAssetId = 'image:shared';
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'first',
        type: 'image',
        imageAssetId: sharedAssetId,
        imageUrl: 'https://example.com/shared.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'second',
        type: 'image',
        imageAssetId: sharedAssetId,
        imageUrl: 'https://example.com/shared.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const textureIds = scene.components
      .filter(component => component.dataType === DataType.SpriteComponent)
      .map(component => (
        component as unknown as { renderer: { texture?: { id: string } } }
      ).renderer.texture?.id);

    expect(scene.images).toHaveLength(1);
    expect(scene.textures).toHaveLength(1);
    expect(textureIds).toEqual([scene.textures?.[0]?.id, scene.textures?.[0]?.id]);
  });

  it('serializes an Embedded Image Asset as a GE data URL', () => {
    const layer = createMinimalLayer({
      orderIndex: 0,
      name: 'embedded',
      type: 'image',
      content: { assetId: 'image:embedded' },
      localBounds: { x: 0, y: 0, width: 1, height: 1 },
    });
    const document = createIRScene(createMinimalIR([layer]), [{
      id: 'image:embedded',
      type: 'image',
      source: { kind: 'embedded', mimeType: 'image/png', data: 'AQID' },
    }]);
    const scene = convertIRSceneToGE(document).scene;

    expect(scene.images).toEqual([expect.objectContaining({ url: 'data:image/png;base64,AQID' })]);
  });

  it('resolves a textured shape through the Image Asset registry', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'textured-shape',
        type: 'shape',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        content: {
          shapes: [
            {
              primitiveType: IRShapePrimitiveType.Rectangle,
              width: { type: 'static', value: 100 },
              height: { type: 'static', value: 100 },
              fills: [
                {
                  type: IRPaintType.Texture,
                  assetId: 'image:shape-texture',
                  scaleMode: IRTextureScaleMode.Crop,
                },
              ],
              strokes: [],
              position: { type: 'static', value: [0, 0] },
            },
          ],
        },
      }),
    ]);
    const document = createIRScene(ir, [{
      id: 'image:shape-texture',
      type: 'image',
      source: { kind: 'url', url: 'https://example.com/shape-texture.png' },
    }]);
    const scene = convertIRSceneToGE(document).scene;
    const shapeComponent = (scene.components as unknown as Array<Record<string, unknown>>).find(
      component => component['dataType'] === DataType.ShapeComponent,
    );
    const fill = (shapeComponent?.['fills'] as Array<Record<string, unknown>> | undefined)?.[0];
    const textureId = (fill?.['texture'] as { id?: string } | undefined)?.id;
    const texture = (scene.textures as Array<{ id?: string; source?: { id?: string } }> | undefined)?.find(
      candidate => candidate.id === textureId,
    );

    expect(scene.images).toEqual([expect.objectContaining({ url: 'https://example.com/shape-texture.png' })]);
    expect(texture?.source?.id).toBe(scene.images[0]?.id);
    expect(fill?.['scaleMode']).toBe(TexturePaintScaleMode.Crop);
  });

  it('generates only GE schema fields for primitive size and gradient paint', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'gradient-rectangle',
        type: 'shape',
        content: {
          shapes: [
            {
              primitiveType: IRShapePrimitiveType.Rectangle,
              width: { type: 'static', value: 100 },
              height: { type: 'static', value: 60 },
              fills: [
                {
                  type: IRPaintType.LinearGradient,
                  gradientStops: { type: 'static', value: [
                    [0, 1, 0, 0, 1],
                    [1, 0, 0, 1, 1],
                  ] },
                  gradientStart: { type: 'static', value: [0, 0] },
                  gradientEnd: { type: 'static', value: [100, 0] },
                },
              ],
              strokes: [],
              position: { type: 'static', value: [0, 0] },
            },
          ],
        },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const component = (scene.components as unknown as Record<string, unknown>[]).find(
      candidate => candidate['dataType'] === 'ShapeComponent',
    );
    const fill = (component?.['fills'] as Record<string, unknown>[] | undefined)?.[0];
    const width = component?.['width'] as number;
    const height = component?.['height'] as number;

    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width / height).toBeCloseTo(100 / 60, 3);
    expect(component).not.toHaveProperty('xSize');
    expect(component).not.toHaveProperty('ySize');
    expect(fill).not.toHaveProperty('color');
  });

  it('maps Rectangle cornerRadius pixels to GE roundness percentage', () => {
    const ir = createMinimalIR([createMinimalLayer({
      orderIndex: 0,
      name: 'rounded-rectangle',
      type: 'shape',
      content: {
        shapes: [{
          primitiveType: IRShapePrimitiveType.Rectangle,
          width: { type: 'static', value: 100 },
          height: { type: 'static', value: 60 },
          cornerRadius: { type: 'static', value: 15 },
          fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } }],
          strokes: [],
          position: { type: 'static', value: [0, 0] },
        }],
      },
    })]);
    const scene = convertIRToGE(ir);
    const component = (scene.components as unknown as Record<string, unknown>[]).find(
      candidate => candidate['dataType'] === DataType.ShapeComponent,
    );

    expect(component?.['roundness']).toBe(50);
  });

  it('multiplies static paint opacity into solid and gradient alpha without mutating IR', () => {
    const shape: IRShape = {
      primitiveType: 'rectangle', width: { type: 'static', value: 100 }, height: { type: 'static', value: 60 },
      position: { type: 'static', value: [0, 0] }, strokes: [],
      fills: [
        { type: 'solid', color: { type: 'static', value: [1, 0, 0, 0.8] }, opacity: { type: 'static', value: 0.5 } },
        {
          type: 'linear-gradient', gradientStops: { type: 'static', value: [[0, 1, 0, 0, 0.6], [1, 0, 0, 1, 1]] },
          gradientStart: { type: 'static', value: [0, 0] }, gradientEnd: { type: 'static', value: [100, 0] },
          opacity: { type: 'static', value: 0.5 },
        },
      ],
    };
    const ir = createMinimalIR([createMinimalLayer({
      orderIndex: 0, name: 'paint-opacity', type: 'shape', content: { shapes: [shape] },
    })]);
    const before = structuredClone(ir);
    const scene = convertIRToGE(ir);
    const component = scene.components?.find(item => item.dataType === DataType.ShapeComponent);

    expect(component).toMatchObject({ fills: [
      { color: { r: 1, g: 0, b: 0, a: 0.4 } },
      { gradientStops: [ValueType.GRADIENT_COLOR, [[0, 1, 0, 0, 0.3], [1, 0, 0, 1, 0.5]]] },
    ] });
    expect(ir).toEqual(before);
  });

  it.each(['geometry', 'paint'] as const)('rejects unsupported shape %s animation explicitly', channel => {
    const shape: IRShape = {
      primitiveType: 'rectangle', width: { type: 'static', value: 100 }, height: { type: 'static', value: 60 },
      position: { type: 'static', value: [0, 0] }, strokes: [],
      fills: [{ type: 'solid', color: { type: 'static', value: [1, 0, 0, 1] } }],
    };

    if (channel === 'geometry') {
      shape.width = { type: 'keyframed', keyframes: [{ frame: 0, value: 100 }, { frame: 30, value: 200 }] };
    } else {
      shape.fills[0].opacity = { type: 'keyframed', keyframes: [{ frame: 0, value: 1 }, { frame: 30, value: 0.5 }] };
    }
    const ir = createMinimalIR([createMinimalLayer({
      orderIndex: 0, name: 'animated-shape', type: 'shape', content: { shapes: [shape] },
    })]);

    expect(() => convertIRToGE(ir)).toThrow('Animated shape geometry and paints are not supported yet');
  });

  it('splits divergent stroke geometry into independent GE Shape components', () => {
    const ir = createMinimalIR([createMinimalLayer({
      orderIndex: 0,
      name: 'multi-stroke',
      type: 'shape',
      content: {
        shapes: [{
          primitiveType: IRShapePrimitiveType.Rectangle,
          width: { type: 'static', value: 100 },
          height: { type: 'static', value: 60 },
          fills: [{ type: IRPaintType.Solid, color: { type: 'static', value: [1, 1, 1, 1] } }],
          strokes: [
            {
              paint: { type: IRPaintType.Solid, color: { type: 'static', value: [1, 0, 0, 1] } },
              width: { type: 'static', value: 2 },
              cap: 'butt',
              join: 'miter',
            },
            {
              paint: { type: IRPaintType.Solid, color: { type: 'static', value: [0, 0, 1, 1] } },
              width: { type: 'static', value: 6 },
              cap: 'square',
              join: 'bevel',
            },
          ],
          position: { type: 'static', value: [0, 0] },
        }],
      },
    })]);
    const scene = convertIRToGE(ir);
    const allComponents = scene.components as unknown as Record<string, unknown>[];
    const components = allComponents.filter(
      candidate => candidate['dataType'] === DataType.ShapeComponent,
    );
    const itemIds = getCompositionItemIds(scene as unknown as Record<string, unknown>);
    const orderedComponents = itemIds.flatMap(itemId => {
      const component = components.find(candidate =>
        (candidate['item'] as { id?: string } | undefined)?.id === itemId,
      );

      return component == null ? [] : [component];
    });
    const ratio = get2dTo3dRatio(ir.width, ir.height);

    expect(components).toHaveLength(2);
    expect(orderedComponents[0]?.['fills']).toHaveLength(1);
    expect(orderedComponents[0]).toMatchObject({ strokeCap: LineCap.Butt, strokeJoin: LineJoin.Miter });
    expect(orderedComponents[0]?.['strokeWidth']).toBeCloseTo(2 * ratio, 4);
    expect(orderedComponents[1]?.['fills']).toEqual([]);
    expect(orderedComponents[1]).toMatchObject({ strokeCap: LineCap.Square, strokeJoin: LineJoin.Bevel });
    expect(orderedComponents[1]?.['strokeWidth']).toBeCloseTo(6 * ratio, 4);
  });

  it('maps visibility.visible directly to the GE item', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'hidden',
        type: 'null',
        visible: false,
      }),
    ]);
    const scene = convertIRToGE(ir);

    expect(scene.items[0]?.visible).toBe(false);
  });

  it('generates a null layer', () => {
    const ir = createMinimalIR([createMinimalLayer({ orderIndex: 0, name: 'ctrl', type: 'null' })]);
    const scene = convertIRToGE(ir);

    expect(scene.items).toHaveLength(1);
    expect(scene.images).toHaveLength(0);
  });

  it('generates text component', () => {
    const ir = createMinimalIR([
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
    const scene = convertIRSceneToGE(createTestIRScene(ir, [{
      id: 'font:test-arial',
      type: 'font',
      family: 'Arial',
      style: 'italic',
      weight: 650,
      source: { kind: 'system' },
    }])).scene;

    expect(scene.items).toHaveLength(1);
    const textComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      c => c['dataType'] === 'TextComponent',
    );

    expect(textComponent).toBeDefined();
    expect(textComponent?.['options']).toMatchObject({
      text: 'Hello',
      fontFamily: 'Arial',
      fontWeight: 650,
      fontStyle: 'italic',
      lineHeight: 24,
      textWidth: 200,
      textHeight: 40,
      autoResize: TextSizeMode.fixed,
    });
  });

  it('keeps text bounds as item size while line height expands the GE text height', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'multiline-title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello\nWorld',
          fontAssetId: 'font:test-arial',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 56,
          textAlign: 'left',
        },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const textComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['dataType'] === DataType.TextComponent,
    );
    const textItem = scene.items.find(item => item.type === ItemType.text);

    expect(textComponent?.['options']).toMatchObject({
      lineHeight: 56,
      textWidth: 200,
      textHeight: 56,
    });
    expect((textComponent?.['options'] as Record<string, unknown>)['size']).toEqual([
      textItem?.transform?.size?.x,
      textItem?.transform?.size?.y,
    ]);
    expect((textItem?.transform?.size?.x ?? 0) / (textItem?.transform?.size?.y ?? 1)).toBeCloseTo(5, 3);
  });

  it.each([
    { textAlign: 'left' as const },
    { textAlign: 'center' as const },
    { textAlign: 'right' as const },
  ])('keeps the $textAlign layout inside the standard IR bounds transform', ({ textAlign }) => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: `${textAlign}-title`,
        type: 'text',
        localBounds: { x: -70, y: -15, width: 200, height: 40 },
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
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const textComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['dataType'] === DataType.TextComponent,
    );
    const textItem = scene.items.find(item => item.type === ItemType.text);
    const expectedPosition = convert2dTo3dPoint(310, 495, 0, 720, 1280);

    expect((textComponent?.['renderer'] as Record<string, unknown>)['anchor']).toEqual([0.45, 0.625]);
    expect(textItem?.transform?.position.x).toBeCloseTo(expectedPosition[0], 12);
    expect(textItem?.transform?.position.y).toBeCloseTo(expectedPosition[1], 12);
  });

  it('keeps animated text position paths additive to the anchor-compensated item position', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'animated-title',
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
        transform: {
          position: {
            type: 'keyframed',
            keyframes: [
              { frame: 0, value: [300, 500, 0] },
              { frame: 90, value: [420, 620, 0] },
            ],
          },
          anchor: { type: 'static', value: [20, 10, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 0 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const textItem = scene.items.find(item => item.type === ItemType.text);
    const transformAsset = findFirstTransformAsset(scene as unknown as Record<string, unknown>);
    const positionOverLifetime = transformAsset?.['positionOverLifetime'] as Record<string, unknown> | undefined;
    const path = positionOverLifetime?.['path'] as unknown[] | undefined;
    const payload = path?.[1] as unknown[] | undefined;
    const pathPoints = payload?.[1] as Array<[number, number, number]> | undefined;

    expect(textItem?.transform?.position).toMatchObject({
      x: convert2dTo3dPoint(440, 650, 0, 720, 1280)[0],
      y: convert2dTo3dPoint(440, 650, 0, 720, 1280)[1],
    });
    const expectedPathPoints = [
      convert2dTo3dPoint(300, 500, 0, 720, 1280),
      convert2dTo3dPoint(420, 620, 0, 720, 1280),
    ];

    expect(pathPoints).toHaveLength(expectedPathPoints.length);
    for (let index = 0; index < expectedPathPoints.length; index++) {
      expect(pathPoints?.[index]?.[0]).toBeCloseTo(expectedPathPoints[index][0], 4);
      expect(pathPoints?.[index]?.[1]).toBeCloseTo(expectedPathPoints[index][1], 4);
      expect(pathPoints?.[index]?.[2]).toBe(expectedPathPoints[index][2]);
    }
  });

  it.each([
    {
      caseName: 'static rotation',
      scale: { type: 'static', value: [1, 1, 1] },
      rotation: { z: { type: 'static', value: 90 } },
      expectedAnimationField: 'rotationOverLifetime',
    },
    {
      caseName: 'animated rotation',
      scale: { type: 'static', value: [1, 1, 1] },
      rotation: {
        z: {
          type: 'keyframed',
          keyframes: [
            { frame: 0, value: 0, outTangent: { x: 0.33, y: 0.33 } },
            { frame: 90, value: 90, inTangent: { x: 0.67, y: 0.67 } },
          ],
        },
      },
      expectedAnimationField: 'rotationOverLifetime',
    },
    {
      caseName: 'animated scale',
      scale: {
        type: 'keyframed',
        keyframes: [
          { frame: 0, value: [1, 1, 1], outTangent: { x: 0.33, y: 0.33 } },
          { frame: 90, value: [1.5, 0.75, 1], inTangent: { x: 0.67, y: 0.67 } },
        ],
      },
      rotation: { z: { type: 'static', value: 0 } },
      expectedAnimationField: 'sizeOverLifetime',
    },
  ] satisfies Array<{
    caseName: string;
    scale: NonNullable<IRTransform['scale']>;
    rotation: NonNullable<IRTransform['rotation']>;
    expectedAnimationField: 'rotationOverLifetime' | 'sizeOverLifetime';
  }>)('uses a Text pivot container for $caseName around a non-center Anchor', ({
    scale,
    rotation,
    expectedAnimationField,
  }) => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'pivoted-title',
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
          scale,
          rotation,
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const nullItem = scene.items.find(item => item.type === ItemType.null);
    const textItem = scene.items.find(item => item.type === ItemType.text);
    const ratio = get2dTo3dRatio(ir.width, ir.height);
    const transformAsset = findFirstTransformAsset(scene as unknown as Record<string, unknown>);

    expect(scene.items).toHaveLength(2);
    expect(nullItem).toBeDefined();
    expect(textItem?.parentId).toBe(nullItem?.id);
    expect(textItem?.transform?.position.x).toBeCloseTo(80 * ratio, 12);
    expect(textItem?.transform?.position.y).toBeCloseTo(-10 * ratio, 12);
    expect(transformAsset?.[expectedAnimationField]).toBeDefined();
  });

  it('extends Parent activation for Transform inheritance without mutating the input IR', () => {
    const parent = createMinimalLayer({
      orderIndex: 0,
      name: 'parent',
      type: 'null',
      time: { inFrame: 0, outFrame: 10 },
    });
    const child = createMinimalLayer({
      orderIndex: 1,
      name: 'child',
      type: 'image',
      parentId: 'layer-0',
      time: { inFrame: 0, outFrame: 90 },
      imageUrl: 'https://example.com/child.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const ir = createMinimalIR([parent, child]);

    const scene = convertIRToGE(ir);
    const parentItem = scene.items.find(item => item.name === 'parent');

    expect(ir.layers[0].time.outFrame).toBe(10);
    expect(parentItem?.delay).toBe(0);
    expect(parentItem?.duration).toBe(3);
  });

  it('uses GE-preserved animation data only through the explicit API', () => {
    const rawPosition = { path: ['raw-ge-path'] };
    const lottieScene = convertIRToGE(
      createMinimalIR([
        createMinimalLayer({
          orderIndex: 0,
          name: 'lottie-layer',
          type: 'image',
          imageUrl: 'https://example.com/img.png',
          localBounds: { x: 0, y: 0, width: 100, height: 100 },
        }),
      ]),
    );
    const effectsIR = createMinimalIR([
        createMinimalLayer({
          orderIndex: 0,
          name: 'ge-layer',
          type: 'image',
          imageUrl: 'https://example.com/img.png',
          localBounds: { x: 0, y: 0, width: 100, height: 100 },
        }),
      ]);
    const effectsScene = convertIRWithPreservedData(effectsIR, {
      'layer-0': { positionOverLifetime: rawPosition },
    }).scene;
    const lottieTransformAsset = findFirstTransformAsset(lottieScene as unknown as Record<string, unknown>);
    const effectsTransformAsset = findFirstTransformAsset(effectsScene as unknown as Record<string, unknown>);

    expect(lottieTransformAsset?.['positionOverLifetime']).toEqual({});
    expect(effectsTransformAsset?.['positionOverLifetime']).toEqual(rawPosition);
  });
});

function findFirstTransformAsset(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  const miscs = scene['miscs'] as Array<Record<string, unknown>> | undefined;

  return miscs?.find(misc => misc['dataType'] === 'TransformPlayableAsset');
}

describe('GE layer generation', () => {
  it('rejects shape layers without required content', () => {
    const ir = createMinimalIR([
      createMinimalLayer({ orderIndex: 0, name: 'empty-shape', type: 'shape' }),
    ]);

    expect(() => convertIRToGE(ir)).toThrowError(/IR_SHAPE_DATA_MISSING/);
  });

  it('keeps a boundless GE mask shape at its authored position', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'mask',
        type: 'shape',
        content: {
          shapes: [
            {
              primitiveType: IRShapePrimitiveType.Custom,
              customPaths: { type: 'static', value: [
                {
                  points: [{ x: 0, y: 0 }],
                  inTangents: [{ x: 0, y: 0 }],
                  outTangents: [{ x: 0, y: 0 }],
                  closed: true,
                },
              ] },
              fills: [],
              strokes: [],
              position: { type: 'static', value: [0, 0] },
            },
          ],
        },
      }),
    ]);
    const scene = convertIRWithPreservedData(ir, {
      'layer-0': { mask: { isMask: true, alphaMaskEnabled: false } },
    }).scene;
    const item = scene.items[0] as unknown as {
      transform: { position: { x: number; y: number; z: number } };
    };

    expect(item.transform.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('derives a static-anchor plan from normalized IR geometry', () => {
    const scene = convertIRToGE(createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'static-icon',
        type: 'image',
        imageUrl: 'https://example.com/static.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        transform: {
          position: { type: 'static', value: [360, 640, 0] },
          anchor: { type: 'static', value: [10, 10, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: { z: { type: 'static', value: 15 } },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]));
    const signature = (scene.items as Array<{ type: string; parentId?: string }>).map(item => ({
      type: item.type,
      parented: item.parentId != null,
    }));

    expect(signature).toEqual([{ type: '1', parented: false }]);
  });

  it('derives a pivot container from off-center geometry and animated rotation', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'icon',
        type: 'image',
        imageUrl: 'https://example.com/icon.png',
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
    const scene = convertIRToGE(ir);

    // GE generation produces a null pivot container plus a sprite child.
    expect(scene.items).toHaveLength(2);
    const items = scene.items as Array<{ type: string; parentId?: string; id: string }>;
    const nullItem = items.find(i => i.type === '3');
    const spriteItem = items.find(i => i.type !== '3');

    expect(nullItem).toBeDefined();
    expect(spriteItem).toBeDefined();
    expect(spriteItem!.parentId).toBe(nullItem!.id);
    expect(scene).toMatchSnapshot();
  });

  it('preserves a GE single-item hierarchy with off-center animated rotation', () => {
    const ir = createMinimalIR([
      createMinimalLayer({
        orderIndex: 0,
        name: 'authored-single',
        type: 'image',
        imageUrl: 'https://example.com/single.png',
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
    const scene = convertIRWithPreservedData(ir, {
      'layer-0': { sourceHierarchy: 'single-item' },
    }).scene;

    expect(scene.items).toHaveLength(1);
    expect(scene.items[0].parentId).toBeUndefined();
  });

  it('lowers a single keyframe exactly like the equivalent static transform', () => {
    const makeIR = (animated: boolean): IRComposition =>
      createMinimalIR([
        createMinimalLayer({
          orderIndex: 0,
          name: 'single-keyframe',
          type: 'image',
          imageUrl: 'https://example.com/single-keyframe.png',
          localBounds: { x: 0, y: 0, width: 100, height: 100 },
          transform: {
            position: animated
              ? { type: 'keyframed', keyframes: [{ frame: 0, value: [120, 240, 0] }] }
              : { type: 'static', value: [120, 240, 0] },
            anchor: { type: 'static', value: [50, 50, 0] },
            scale: animated
              ? { type: 'keyframed', keyframes: [{ frame: 0, value: [1.5, 0.75, 1] }] }
              : { type: 'static', value: [1.5, 0.75, 1] },
            rotation: {
              z: animated
                ? { type: 'keyframed', keyframes: [{ frame: 0, value: 45 }] }
                : { type: 'static', value: 45 },
            },
            opacity: animated
              ? { type: 'keyframed', keyframes: [{ frame: 0, value: 0.4 }] }
              : { type: 'static', value: 0.4 },
          },
        }),
      ]);

    idCounter = 0;
    const staticScene = convertIRToGE(makeIR(false));

    idCounter = 0;
    const singleKeyframeScene = convertIRToGE(makeIR(true));

    expect(singleKeyframeScene).toEqual(staticScene);
  });

  it('preserves text scale when restoring a GE null-text pair', () => {
    const ir = createMinimalIR([
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
      }),
    ]);
    const scene = convertIRWithPreservedData(ir, {
      'layer-0': { sourceHierarchy: 'null-sprite-pair' },
    }).scene;
    const items = scene.items as Array<{
      type: string;
      transform: { scale: { x: number; y: number; z: number }; size?: { x: number; y: number } };
    }>;
    const textItem = items.find(item => item.type === 'text');

    expect(scene.items).toHaveLength(2);
    expect(textItem).toBeDefined();
    const textScale = get2dTo3dRatio(ir.width, ir.height) / 0.0123;

    expect(textItem!.transform.scale.x).toBeCloseTo(textScale, 4);
    expect(textItem!.transform.scale.y).toBeCloseTo(textScale, 4);
    expect(textItem!.transform.scale.z).toBeCloseTo(textScale, 4);
  });

  it('restores a GE null-shape pair before generic multi-shape generation', () => {
    const ir = createMinimalIR([
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
      }),
    ]);
    const scene = convertIRWithPreservedData(ir, {
      'layer-0': { sourceHierarchy: 'null-sprite-pair' },
    }).scene;
    const items = scene.items as Array<{ id: string; type: string; parentId?: string }>;
    const nullItem = items.find(item => item.type === '3');
    const shapeItem = items.find(item => item.type === 'shape');

    expect(scene.items).toHaveLength(2);
    expect(shapeItem?.parentId).toBe(nullItem?.id);
  });
});

describe('parent-child relationship', () => {
  it('uses source-neutral Parent pivot semantics', () => {
    const parent = createMinimalLayer({ id: 'parent', orderIndex: 0, name: 'parent', type: 'null' });
    const child = createMinimalLayer({
      id: 'child',
      orderIndex: 1,
      name: 'child',
      type: 'image',
      parentId: 'parent',
      imageUrl: 'https://example.com/child.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      transform: {
        position: { type: 'static', value: [100, 200, 0] },
        anchor: { type: 'static', value: [10, 10, 0] },
        scale: { type: 'static', value: [1, 1, 1] },
        rotation: { z: { type: 'static', value: 15 } },
        opacity: { type: 'static', value: 1 },
      },
    });
    const scene = convertIRToGE(createMinimalIR([parent, child]));
    const childItem = scene.items.find(item => item.name === 'child');
    const radians = (15 * Math.PI) / 180;
    const rotatedOffsetX = 40 * Math.cos(radians) - 40 * Math.sin(radians);
    const rotatedOffsetY = 40 * Math.sin(radians) + 40 * Math.cos(radians);
    const expectedPosition = convert2dTo3dPoint(100 + rotatedOffsetX, 200 + rotatedOffsetY, 0, 720, 1280);
    const ratio = get2dTo3dRatio(720, 1280);

    expectedPosition[0] += ratio * 360;
    expectedPosition[1] -= ratio * 640;

    expect(childItem?.transform?.position.x).toBeCloseTo(expectedPosition[0], 12);
    expect(childItem?.transform?.position.y).toBeCloseTo(expectedPosition[1], 12);
  });

  it('keeps a Child active when its invisible Parent has a non-overlapping time range', () => {
    const child = createMinimalLayer({
      id: 'child',
      orderIndex: 0,
      name: 'child',
      type: 'image',
      parentId: 'parent',
      time: { inFrame: 0, outFrame: 30 },
      imageUrl: 'https://example.com/child.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });
    const parent = createMinimalLayer({
      id: 'parent',
      orderIndex: 1,
      name: 'parent',
      type: 'null',
      time: { inFrame: 60, outFrame: 90 },
      visible: false,
    });
    const scene = convertIRToGE(createMinimalIR([child, parent]));
    const childItem = scene.items.find(item => item.name === 'child');
    const parentItem = scene.items.find(item => item.name === 'parent');

    expect(childItem).toMatchObject({ delay: 0, duration: 1, visible: true, parentId: parentItem?.id });
    expect(parentItem).toMatchObject({ delay: 0, duration: 3, visible: false });
  });

  it('establishes parentId from normalized IR hierarchy', () => {
    const ir = createMinimalIR([
      createMinimalLayer({ orderIndex: 0, name: 'parent-layer', type: 'null' }),
      createMinimalLayer({
        orderIndex: 1,
        name: 'child-layer',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/child.png',
        localBounds: { x: 0, y: 0, width: 200, height: 200 },
      }),
    ]);
    const scene = convertIRToGE(ir);
    const items = scene.items as Array<{ id: string; name: string; parentId?: string }>;
    const parentItem = items.find(item => item.name === 'parent-layer');
    const childItem = items.find(item => item.name === 'child-layer');

    expect(scene.items).toHaveLength(2);
    expect(parentItem).toBeDefined();
    expect(childItem).toBeDefined();
    expect(childItem!.parentId).toBe(parentItem!.id);
  });

  it('resolves hierarchy by stable layer id after indexes and array positions change', () => {
    const child = createMinimalLayer({
      id: 'stable-child',
      orderIndex: 3,
      name: 'child-layer',
      type: 'image',
      parentId: 'stable-parent',
      imageUrl: 'https://example.com/child.png',
      localBounds: { x: 0, y: 0, width: 200, height: 200 },
    });
    const parent = createMinimalLayer({ id: 'stable-parent', orderIndex: 9, name: 'parent-layer', type: 'null' });
    const scene = convertIRToGE(createMinimalIR([child, parent]));
    const items = scene.items as Array<{ id: string; name: string; parentId?: string }>;
    const childItem = items.find(item => item.name === 'child-layer');
    const parentItem = items.find(item => item.name === 'parent-layer');

    expect(scene.items.map(item => item.name)).toEqual(['child-layer', 'parent-layer']);
    expect(childItem?.parentId).toBe(parentItem?.id);
  });
});

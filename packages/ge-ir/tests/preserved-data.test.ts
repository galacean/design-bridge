import { describe, expect, it } from 'vitest';
import { IREndBehavior, type IRScene } from '@galacean/animation-ir';
import { convertGEToIR, convertIRToGE } from '../src';

function createPrecompScene(): IRScene {
  return {
    format: 'animation-ir',
    schemaVersion: '1.0.0',
    entryCompositionId: 'root',
    compositions: [{
      id: 'root',
      width: 100,
      height: 100,
      frameRate: 30,
      inPoint: 0,
      outPoint: 30,
      endBehavior: IREndBehavior.Freeze,
      layers: [{
        id: 'child-instance',
        type: 'precomp',
        time: { inFrame: 0, outFrame: 30 },
        visible: true,
        content: { compositionId: 'child', clipToBounds: false },
      }],
    }, {
      id: 'child',
      width: 50,
      height: 50,
      frameRate: 30,
      inPoint: 0,
      outPoint: 30,
      endBehavior: IREndBehavior.Freeze,
      layers: [],
    }],
    assets: [],
  };
}

function createPrecompSceneWithImage(): IRScene {
  const scene = createPrecompScene();
  const childComposition = scene.compositions.find(composition => composition.id === 'child');

  if (childComposition == null) {
    throw new Error('expected child Composition');
  }

  childComposition.layers.push({
    id: 'child-image',
    type: 'image',
    time: { inFrame: 0, outFrame: 30 },
    visible: true,
    localBounds: { x: 0, y: 0, width: 50, height: 50 },
    content: { assetId: 'child-image-asset' },
  });
  scene.assets.push({
    id: 'child-image-asset',
    type: 'image',
    source: { kind: 'url', url: 'https://example.com/child.png' },
  });

  return scene;
}

describe('GE preserved data', () => {
  it('rejects the removed positional options form', () => {
    expect(() => convertIRToGE(createPrecompScene(), 2 as never)).toThrow(/options must be an object/);
  });

  it('keeps Composition source data outside IR and restores it only through the explicit API', () => {
    const sourceScene = convertIRToGE(createPrecompScene()).scene as unknown as Record<string, unknown>;
    const preservedGeometry = { id: 'ge-only-geometry', dataType: 'Geometry', custom: true };

    (sourceScene['geometries'] as unknown[]).push(preservedGeometry);
    const imported = convertGEToIR(sourceScene, { frameRate: 30 });

    expect(imported.scene.compositions.every(composition => !('extensions' in composition))).toBe(true);
    expect(
      imported.scene.compositions.flatMap(composition => composition.layers)
        .every(layer => !('extensions' in layer)),
    ).toBe(true);
    expect(imported.preservedData).toMatchObject({
      version: '1.0.0',
      compositionBindings: {
        root: { sourceCompositionId: 'root', sourceItemOrder: expect.any(Array), layerDataById: expect.any(Object) },
        child: { sourceCompositionId: 'child', sourceItemOrder: expect.any(Array), layerDataById: expect.any(Object) },
      },
    });
    expect(Object.keys(imported.preservedData).sort()).toEqual([
      'compositionBindings', 'particleSourceData', 'sourceScene', 'version',
    ]);
    expect(imported.preservedData.sourceScene).toBeDefined();

    const normalized = convertIRToGE(imported.scene).scene as unknown as Record<string, unknown>;
    const restored = convertIRToGE(imported.scene, {
      preservedData: imported.preservedData,
    }).scene as unknown as Record<string, unknown>;

    expect(normalized['geometries']).not.toContainEqual(preservedGeometry);
    expect(restored['geometries']).toContainEqual(preservedGeometry);
  });

  it('does not restore source graphs for Compositions regenerated from IR', () => {
    const sourceScene = convertIRToGE(createPrecompSceneWithImage()).scene as unknown as Record<string, unknown>;
    const sourceImageItem = asRecordArray(sourceScene['items']).find(item => item['name'] === 'child-image');
    const sourceImageItemId = sourceImageItem?.['id'];
    const sourceImageTransform = sourceImageItem?.['transform'];

    if (typeof sourceImageItemId !== 'string' || !isRecord(sourceImageTransform)) {
      throw new Error('expected child image transform');
    }
    sourceImageTransform['anchor'] = { x: 0.125, y: -0.25 };

    const imported = convertGEToIR(sourceScene, { frameRate: 30 });
    const restored = convertIRToGE(imported.scene, {
      preservedData: imported.preservedData,
    }).scene as unknown as Record<string, unknown>;
    const compositions = asRecordArray(restored['compositions']);
    const compositionComponents = asRecordArray(restored['components']).filter(
      component => component['dataType'] === 'CompositionComponent',
    );
    const miscs = asRecordArray(restored['miscs']);

    expect(compositionComponents).toHaveLength(compositions.length);
    expect(asRecordArray(restored['images'])).toHaveLength(1);
    expect(asRecordArray(restored['textures'])).toHaveLength(1);
    expect(collectReachableMiscIds(restored)).toEqual(new Set(miscs.map(misc => misc['id'])));
    expect(asRecordArray(restored['items']).find(item => item['id'] === sourceImageItemId)).toMatchObject({
      transform: { anchor: { x: 0.125, y: -0.25 } },
    });
  });

  it('rejects mismatched versions and Composition bindings', () => {
    const imported = convertGEToIR(
      convertIRToGE(createPrecompScene()).scene as unknown as Record<string, unknown>,
      { frameRate: 30 },
    );
    const rootLayerId = imported.scene.compositions.find(composition => composition.id === 'root')?.layers[0]?.id;

    if (rootLayerId == null) {
      throw new Error('expected imported root Layer');
    }

    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        version: '2.0' as typeof imported.preservedData.version,
      },
    })).toThrow(/Unsupported preserved data version/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        particleSourceData: undefined,
      } as unknown as typeof imported.preservedData,
    })).toThrow(/particleSourceData\.particleEffectGroups and layers must be arrays/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          ...imported.preservedData.compositionBindings,
          missing: { sourceCompositionId: 'missing', sourceItemOrder: [], layerDataById: {} },
        },
      },
    })).toThrow(/does not exist in the IR Scene/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          ...imported.preservedData.compositionBindings,
          root: { sourceCompositionId: 'root', layerDataById: {} },
        },
      } as unknown as typeof imported.preservedData,
    })).toThrow(/sourceItemOrder must be an array of strings/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          root: { sourceCompositionId: 'source', sourceItemOrder: [], layerDataById: {} },
          child: { sourceCompositionId: 'source', sourceItemOrder: [], layerDataById: {} },
        },
      },
    })).toThrow(/is bound more than once/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          ...imported.preservedData.compositionBindings,
          root: {
            ...imported.preservedData.compositionBindings['root'],
            layerDataById: { missing: { sourceHierarchy: 'single-item' } },
          },
        },
      },
    })).toThrow(/Layer data 'root\/missing' does not exist/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          ...imported.preservedData.compositionBindings,
          root: {
            ...imported.preservedData.compositionBindings['root'],
            layerDataById: {
              [rootLayerId]: { spriteSplits: [[0, 0, 1, 1, 2]] },
            },
          },
        },
      } as unknown as typeof imported.preservedData,
    })).toThrow(/spriteSplits/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          ...imported.preservedData.compositionBindings,
          root: {
            ...imported.preservedData.compositionBindings['root'],
            layerDataById: {
              [rootLayerId]: { timelineEndBehavior: 99 },
            },
          },
        },
      } as unknown as typeof imported.preservedData,
    })).toThrow(/timelineEndBehavior/);
    expect(() => convertIRToGE(imported.scene, {
      preservedData: {
        ...imported.preservedData,
        compositionBindings: {
          ...imported.preservedData.compositionBindings,
          root: {
            ...imported.preservedData.compositionBindings['root'],
            layerDataById: {
              [rootLayerId]: { textSizeMode: 'fluid' },
            },
          },
        },
      } as unknown as typeof imported.preservedData,
    })).toThrow(/textSizeMode/);
  });
});

function collectReachableMiscIds(scene: Record<string, unknown>): Set<unknown> {
  const componentById = new Map(asRecordArray(scene['components']).map(component => [component['id'], component]));
  const miscById = new Map(asRecordArray(scene['miscs']).map(misc => [misc['id'], misc]));
  const reachableIds = new Set<unknown>();

  const visit = (reference: unknown): void => {
    const id = readDataPathId(reference);

    if (id == null || reachableIds.has(id)) {
      return;
    }

    const misc = miscById.get(id);

    if (misc == null) {
      return;
    }

    reachableIds.add(id);
    for (const track of asArray(misc['tracks'])) {
      visit(track);
    }
    for (const child of asArray(misc['children'])) {
      visit(child);
    }
    for (const clip of asRecordArray(misc['clips'])) {
      visit(clip['asset']);
    }
  };

  for (const composition of asRecordArray(scene['compositions'])) {
    for (const componentReference of asArray(composition['components'])) {
      const component = componentById.get(readDataPathId(componentReference));

      if (component?.['dataType'] !== 'CompositionComponent') {
        continue;
      }

      visit(component['timelineAsset']);
      for (const binding of asRecordArray(component['sceneBindings'])) {
        visit(binding['key']);
      }
    }
  }

  return reachableIds;
}

function readDataPathId(value: unknown): string | undefined {
  return isRecord(value) && typeof value['id'] === 'string' ? value['id'] : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

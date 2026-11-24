import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  IRAnimatedProperty, IRColor, IRComposition, IRLayer, IRPropertyValue,
} from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import {
  convertIRToGE as convertIRSceneToGE, updateGEToIRPreservedData, type GEToIRPreservedData,
} from '@galacean/ge-ir';
import {
  convertDSLToIR, convertIRToDSL as convertIRSceneToDSL,
  type Composition, type DSLToIROptions, type DSLToIRChange,
  type DSLToIRWarning, type IRToDSLPreservedData,
} from '../src';
import {
  createTestIRScene, getTestImageAsset, migrateTestLayerAsset, rememberTestIRSceneAssets,
  type TestIRLayerOverrides,
} from './fixtures/ir';

type EffectsLayerPreservedData = GEToIRPreservedData['compositionBindings'][string]['layerDataById'][string];

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

function composition(layers: IRLayer[], overrides: Partial<IRComposition> = {}): IRComposition {
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
    ...overrides,
  };
}

function convertIRToGE(ir: IRComposition): ReturnType<typeof convertIRSceneToGE>['scene'] {
  return convertIRSceneToGE(createTestIRScene(ir)).scene;
}

function convertIRToDSL(
  ir: IRComposition,
  layerDataById?: Record<string, EffectsLayerPreservedData>,
): ReturnType<typeof convertIRSceneToDSL> & { geToIRPreservedData?: GEToIRPreservedData } {
  const geToIRPreservedData = layerDataById == null ? undefined : createPreservedData(ir, layerDataById);

  return { ...convertIRSceneToDSL(createTestIRScene(ir)), geToIRPreservedData };
}

function updateIRSceneFromDSL(
  baselineScene: Parameters<typeof convertIRSceneToDSL>[0],
  editedDocument: Composition,
  layerMapping: IRToDSLPreservedData['layerMapping'],
  options: Omit<DSLToIROptions, 'preservedData'> = {},
  geToIRPreservedData?: GEToIRPreservedData,
): ReturnType<typeof convertDSLToIR>['scene'] {
  const updatedScene = convertDSLToIR(editedDocument, {
    ...options,
    preservedData: { baselineScene, layerMapping },
  }).scene;

  if (geToIRPreservedData != null) {
    const updatedGEToIRPreservedData = updateGEToIRPreservedData(baselineScene, updatedScene, geToIRPreservedData, {
      onChange: change => options.onChange?.({
        kind: 'passthrough',
        op: 'clear',
        field: change.field,
        layerId: resolveDSLLayerId(layerMapping, change.compositionId, change.layerId),
      }),
    });

    Object.assign(geToIRPreservedData, updatedGEToIRPreservedData);
  }

  return updatedScene;
}

function updateIRFromDSL(
  ir: IRComposition,
  editedDocument: Composition,
  layerMapping: IRToDSLPreservedData['layerMapping'],
  options?: Omit<DSLToIROptions, 'preservedData'>,
  preservedData?: GEToIRPreservedData,
): IRComposition {
  const document = updateIRSceneFromDSL(createTestIRScene(ir), editedDocument, layerMapping, options, preservedData);

  rememberTestIRSceneAssets(document);

  return getIRSceneEntryComposition(document);
}

function resolveDSLLayerId(
  layerMapping: IRToDSLPreservedData['layerMapping'],
  compositionId: string,
  irLayerId: string,
): string | undefined {
  return Object.entries(layerMapping.layers).find(([, mapping]) =>
    mapping.irCompositionId === compositionId && mapping.irLayerId === irLayerId,
  )?.[0];
}

function createPreservedData(
  ir: IRComposition,
  layerDataById: Record<string, EffectsLayerPreservedData>,
): GEToIRPreservedData {
  return {
    version: '1.0.0',
    particleSourceData: { particleEffectGroups: [], layers: [] },
    compositionBindings: {
      [ir.id]: { sourceCompositionId: `source:${ir.id}`, sourceItemOrder: [], layerDataById },
    },
  };
}

function getEffectsLayerPreservedData(
  preservedData: GEToIRPreservedData | undefined,
  compositionId: string,
  layerId: string,
): EffectsLayerPreservedData | undefined {
  return preservedData?.compositionBindings[compositionId]?.layerDataById[layerId];
}

function getKeyframeFrames<T extends IRPropertyValue>(property: IRAnimatedProperty<T> | undefined): number[] {
  return property?.type === 'keyframed' ? property.keyframes.map(keyframe => keyframe.frame) : [];
}

describe('preserved-data writeback', () => {
  it('retains an ordered mask stack when editing an unrelated DSL field', () => {
    const path = {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
      inTangents: Array.from({ length: 3 }, () => ({ x: 0, y: 0 })),
      outTangents: Array.from({ length: 3 }, () => ({ x: 0, y: 0 })),
      closed: true,
    };
    const ir = composition([layer({
      orderIndex: 0, name: 'masked-image', type: 'image',
      imageUrl: 'https://example.com/masked.png',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
      masks: [{ mode: 'add', path }, { mode: 'subtract', path, inverted: true }],
    })]);
    const imported = convertIRToDSL(ir);

    imported.dsl.layers[0].name = 'renamed-image';
    const exported = convertDSLToIR(imported.dsl, { preservedData: imported.preservedData });
    const updated = getIRSceneEntryComposition(exported.scene).layers[0];

    expect(updated.name).toBe('renamed-image');
    expect(updated.masks).toEqual(ir.layers[0].masks);
    expect(updated).not.toHaveProperty('mask');
  });

  it('no-op update preserves the original IR and external GE data', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'spinner',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/spinner.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': { rotationOverLifetime: { asRotation: true, z: ['bezier', [[0, 0, 0, 1]]] } },
    });

    const updatedIR = updateIRFromDSL(ir, dsl, layerMapping, undefined, geToIRPreservedData);

    expect(updatedIR).toEqual(ir);
    expect(getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0')?.rotationOverLifetime).toBeDefined();
  });

  it('overrides rotation and clears the stale rotationOverLifetime passthrough', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'red_packet',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/rp.png',
        // Mirrors GE parsing, which retains normalized and raw rotation data.
        transform: {
          position: { type: 'static', value: [100, 200, 0] },
          anchor: { type: 'static', value: [50, 50, 0] },
          scale: { type: 'static', value: [1, 1, 1] },
          rotation: {
            z: {
              type: 'keyframed',
              keyframes: [
                { frame: 0, value: 0, outTangent: { x: 0.42, y: 0 } },
                { frame: 30, value: 360, inTangent: { x: 0.58, y: 1 } },
              ],
            },
          },
          opacity: { type: 'static', value: 1 },
        },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': {
        rotationOverLifetime: { asRotation: true, z: ['bezier', [[0, 0, 0, 1]]] },
        sourceHierarchy: 'null-sprite-pair',
      },
    });

    const edited = structuredClone(dsl);

    edited.layers[0].rotation = { a: false, value: [0, 0, 0] };
    edited.layers[0].scale = {
      a: true,
      animation: [
        { t: [0, 0.5], start: [1, 1, 1], end: [1.18, 1.18, 1], easing: [0.42, 0, 0.58, 1] },
        { t: [0.5, 1], start: [1.18, 1.18, 1], end: [1, 1, 1], easing: [0.42, 0, 0.58, 1] },
      ],
    };

    const changes: DSLToIRChange[] = [];
    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    }, geToIRPreservedData);
    const updatedLayer = updatedIR.layers[0];
    const updatedLayerData = getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0');

    expect(updatedLayerData?.rotationOverLifetime).toBeUndefined();
    expect(updatedLayerData?.sourceHierarchy).toBeUndefined();
    expect(updatedLayer.transform?.scale?.type).toBe('keyframed');
    expect(getKeyframeFrames(updatedLayer.transform?.scale).length).toBeGreaterThan(1);
    expect(changes.filter(change => change.kind === 'passthrough').map(change => change.field)).toEqual([
      'rotationOverLifetime',
      'sourceHierarchy',
    ]);

    expect(() => convertIRToGE(updatedIR)).not.toThrow();
  });

  it('clears sizeOverLifetime when scale is edited', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'box',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/box.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': { sizeOverLifetime: { separateAxes: true, x: ['bezier', [[0, 1, 1, 2]]] } },
    });
    const edited = structuredClone(dsl);

    edited.layers[0].scale = { a: false, value: [2, 2, 1] };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, undefined, geToIRPreservedData);

    expect(getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0')?.sizeOverLifetime).toBeUndefined();
    expect(updatedIR.layers[0].transform?.scale).toEqual({ type: 'static', value: [2, 2, 1] });
  });

  it('drops colorOverLifetime when opacity is edited', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'fader',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/f.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': { colorOverLifetime: { opacity: ['bezier', [[0, 1, 1, 0]]] } },
    });
    const edited = structuredClone(dsl);

    edited.layers[0].opacity = { a: false, value: 0.5 };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, undefined, geToIRPreservedData);

    expect(getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0')?.colorOverLifetime).toBeUndefined();
    expect(updatedIR.layers[0].transform?.opacity).toEqual({ type: 'static', value: 0.5 });
  });

  it('reports an opacity edit (and its dropped color animation) as a change, not a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'tinted',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageUrl: 'https://example.com/t.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': { colorOverLifetime: { color: ['bezier', []], opacity: ['bezier', []] } },
    });
    const edited = structuredClone(dsl);

    const changes: DSLToIRChange[] = [];

    edited.layers[0].opacity = { a: false, value: 0.2 };
    updateIRFromDSL(ir, edited, layerMapping, { onChange: c => changes.push(c) }, geToIRPreservedData);

    expect(warn).not.toHaveBeenCalled();
    expect(changes.some(c => c.kind === 'transform' && c.field === 'opacity' && c.note == null)).toBe(true);
    expect(changes.some(c => c.kind === 'passthrough' && c.field === 'colorOverLifetime')).toBe(true);
    warn.mockRestore();
  });

  it('edits text content while preserving unrelated GE mask metadata', () => {
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: '原文案',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [0, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'center',
        },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': { sourceComponentId: 'component-7', mask: { isMask: true } },
    });
    const edited = structuredClone(dsl);

    edited.layers[0].text!.content = '新文案';

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    }, geToIRPreservedData);
    const updatedLayerData = getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0');

    expect(updatedIR.layers[0].type === 'text' ? updatedIR.layers[0].content.text : undefined).toBe('新文案');
    expect(updatedIR.layers[0].type === 'text' ? updatedIR.layers[0].content.fontSize : undefined).toBe(24);
    expect(updatedLayerData?.mask).toEqual({ isMask: true });
    expect(updatedLayerData?.sourceComponentId).toBe('component-7');
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'text', field: 'text.content' }));
  });

  it.each([
    ['  Arial  ', 'Arial'],
    ['   ', 'sans-serif'],
  ])('normalizes %j and updates the Font Asset family to %j', (editedFamily, expectedFamily) => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [0, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'left',
        },
      }),
    ]);
    const document = createTestIRScene(ir, [{
      id: 'font:test-sans',
      type: 'font',
      family: 'Source Sans',
      style: 'italic',
      weight: 800,
      source: { kind: 'system' },
    }]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRSceneToDSL(document);
    const edited = structuredClone(dsl);
    const changes: DSLToIRChange[] = [];

    edited.layers[0].text!.font = editedFamily;

    const updatedDocument = updateIRSceneFromDSL(document, edited, layerMapping, {
      onChange: change => changes.push(change),
    });
    const updatedLayer = getIRSceneEntryComposition(updatedDocument).layers[0];
    const fontAssetId = updatedLayer.type === 'text' ? updatedLayer.content.fontAssetId : undefined;
    const fontAsset = updatedDocument.assets.find(asset => asset.id === fontAssetId);

    expect(fontAssetId).not.toBe('font:test-sans');
    expect(fontAsset).toMatchObject({
      type: 'font', family: expectedFamily, style: 'italic', weight: 800, source: { kind: 'system' },
    });
    expect(changes).toContainEqual(expect.objectContaining({
      kind: 'text', field: 'text.font', oldValue: 'Source Sans', newValue: expectedFamily,
    }));
    expect(() => assertIRScene(updatedDocument)).not.toThrow();
  });

  it('rejects a non-positive edited font size without reporting applied changes', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [0, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 30,
          textAlign: 'left',
        },
      }),
    ]);
    const document = createTestIRScene(ir);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRSceneToDSL(document);
    const edited = structuredClone(dsl);
    const changes: DSLToIRChange[] = [];

    edited.layers[0].text!.content = 'Updated';
    edited.layers[0].text!.size = 0;

    expect(() => updateIRSceneFromDSL(document, edited, layerMapping, {
      onChange: change => changes.push(change),
    })).toThrow(/A014/);
    expect(changes).toEqual([]);
    expect(document.compositions[0].layers[0]).toMatchObject({ content: { text: 'Hello', fontSize: 24 } });
  });

  it('keeps baseline text style and names when optional edits are invalid', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [0, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 30,
          textAlign: 'left',
        },
      }),
    ]);
    const {
      dsl,
      preservedData,
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const changes: DSLToIRChange[] = [];

    const [title] = edited.layers;

    Reflect.deleteProperty(title, 'description');
    Reflect.deleteProperty(title, 'name');
    Object.assign(title.text!, {
      content: 'Updated', line_height: -12, color: 'invalid', font: 7, align: 'justify', letter_spacing: 'invalid',
    });

    const result = convertDSLToIR(edited, {
      preservedData,
      onChange: change => changes.push(change),
    });

    expect(result.scene.compositions[0].layers[0]).toMatchObject({
      name: 'title',
      content: { text: 'Updated', lineHeight: 30, fontAssetId: 'font:test-sans',
        color: [0, 0, 0, 1], textAlign: 'left', letterSpacing: 0 },
    });
    expect(changes.map(change => change.field)).toEqual(['text.content']);
    expect(result.diagnostics.map(value => value.code)).toEqual(expect.arrayContaining([
      'L004', 'L012', 'A015', 'A018', 'A019', 'A020', 'A027',
    ]));
  });

  it('moves edited DSL text dimensions into Layer localBounds', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: -10, y: -5, width: 200, height: 40 },
        content: {
          text: 'Hello',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [0, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'left',
        },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const changes: DSLToIRChange[] = [];

    edited.layers[0].width = 260;
    edited.layers[0].height = 60;

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    });

    expect(updatedIR.layers[0].localBounds).toEqual({ x: -10, y: -5, width: 260, height: 60 });
    expect(changes).toContainEqual(expect.objectContaining({
      kind: 'layer', field: 'localBounds', newValue: { x: -10, y: -5, width: 260, height: 60 },
    }));
  });

  it('moves edited DSL image dimensions into Layer localBounds', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'image',
        type: 'image',
        localBounds: { x: -4, y: -2, width: 100, height: 80 },
        imageUrl: 'https://example.com/image.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].width = 160;
    edited.layers[0].height = 90;

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => {
        if (change.field === 'localBounds' && change.newValue != null) {
          (change.newValue as { width: number }).width = 999;
        }
      },
    });

    expect(updatedIR.layers[0].localBounds).toEqual({ x: -4, y: -2, width: 160, height: 90 });
  });

  it('reports every text property written while rebuilding text data', () => {
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'before',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [0, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'left',
        },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].text!.content = 'after';
    edited.layers[0].text!.size = 24 + 1e-7;

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    });

    expect(updatedIR.layers[0].type === 'text' ? updatedIR.layers[0].content.fontSize : undefined).toBe(24 + 1e-7);
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'text', field: 'text.content' }));
    expect(changes).toContainEqual(expect.objectContaining({ kind: 'text', field: 'text.size' }));
  });

  it('isolates change payloads from later mutations to the edited DSL', () => {
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'image',
        type: 'image',
        imageUrl: 'https://example.com/a.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].position = { a: false, value: [10, 20, 0] };
    updateIRFromDSL(ir, edited, layerMapping, { onChange: change => changes.push(change) });

    const positionChange = changes.find(change => change.kind === 'transform' && change.field === 'position');

    expect(positionChange?.newValue).not.toBe(edited.layers[0].position);
    (edited.layers[0].position as { a: false; value: number[] }).value[0] = 999;
    expect(positionChange?.newValue).toEqual({ a: false, value: [10, 20, 0] });
  });

  it('replaces an asset url', () => {
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'pic',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageAssetId: 'old',
        imageUrl: 'https://example.com/old.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
      geToIRPreservedData,
    } = convertIRToDSL(ir, {
      'layer-0': {
        spriteSplits: [[0, 0, 0.5, 0.5, 0]],
        textureSheetAnimation: { col: 2, row: 2, total: 4, animate: true, loop: true },
      },
    });
    const edited = structuredClone(dsl);

    edited.layers[0].asset!.url = 'https://example.com/new.png';

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    }, geToIRPreservedData);

    expect(getTestImageAsset(updatedIR.layers[0])?.source).toEqual({
      kind: 'url',
      url: 'https://example.com/new.png',
    });
    expect(updatedIR.layers[0].type === 'image' ? updatedIR.layers[0].content.assetId : undefined).toBe('old');
    expect(getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0')?.spriteSplits).toBeUndefined();
    expect(getEffectsLayerPreservedData(geToIRPreservedData, ir.id, 'layer-0')?.textureSheetAnimation).toBeUndefined();
    expect(changes.filter(change => change.kind === 'asset').map(change => change.field)).toEqual(['asset.url']);
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'passthrough',
        op: 'clear',
        field: 'spriteSplits',
      }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'passthrough',
        op: 'clear',
        field: 'textureSheetAnimation',
      }),
    );
  });

  it('materializes an llm_svg asset edit without adding invalid DSL-specific metadata to effects IR', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'pic',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageAssetId: 'old',
        imageUrl: 'https://example.com/old.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';

    edited.layers[0].asset = { source: 'llm_svg', format: 'svg', svg, prompt: 'a square' };
    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(getTestImageAsset(updatedIR.layers[0])?.source).toEqual(expect.objectContaining({
      kind: 'embedded',
      mimeType: 'image/svg+xml',
    }));
    expect(updatedIR.layers[0]).not.toHaveProperty('extensions');
    expect(() => convertIRToGE(updatedIR)).not.toThrow();
  });

  it('keeps the stable Asset ID when its source URL changes', () => {
    const oldUrl = 'https://example.com/old.png';
    const newUrl = 'https://example.com/new.png';
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'pic',
        type: 'image',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
        imageAssetId: oldUrl,
        imageUrl: oldUrl,
      }),
    ]);
    const oldAssetId = ir.layers[0].type === 'image' ? ir.layers[0].content.assetId : undefined;
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].asset!.url = newUrl;

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(getTestImageAsset(updatedIR.layers[0])?.source).toEqual({ kind: 'url', url: newUrl });
    expect(updatedIR.layers[0].type === 'image' ? updatedIR.layers[0].content.assetId : undefined).toBe(oldAssetId);
  });

  it('clones a shared Image Asset when only one referencing DSL layer changes', () => {
    const sharedAssetId = 'image:shared';
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'first',
        type: 'image',
        imageAssetId: sharedAssetId,
        imageUrl: 'https://example.com/shared.png',
      }),
      layer({
        orderIndex: 1,
        name: 'second',
        type: 'image',
        imageAssetId: sharedAssetId,
        imageUrl: 'https://example.com/shared.png',
      }),
    ]);
    const sourceDocument = createTestIRScene(ir);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRSceneToDSL(sourceDocument);
    const edited = structuredClone(dsl);
    const editedFirstLayer = edited.layers.find(editedLayer => editedLayer.name === 'first');

    if (editedFirstLayer?.asset == null) {
      throw new Error('Expected the first image layer in DSL.');
    }
    editedFirstLayer.asset.url = 'https://example.com/first.png';

    const updatedDocument = updateIRSceneFromDSL(sourceDocument, edited, layerMapping);
    const updatedLayers = getIRSceneEntryComposition(updatedDocument).layers;
    const updatedAssetId = updatedLayers[0].type === 'image' ? updatedLayers[0].content.assetId : undefined;
    const unchangedAssetId = updatedLayers[1].type === 'image' ? updatedLayers[1].content.assetId : undefined;
    const updatedAsset = updatedDocument.assets.find(asset => asset.id === updatedAssetId);
    const unchangedAsset = updatedDocument.assets.find(asset => asset.id === unchangedAssetId);

    expect(updatedAssetId).not.toBe(unchangedAssetId);
    expect(updatedAsset?.type === 'image' ? updatedAsset.source : undefined).toEqual({
      kind: 'url',
      url: 'https://example.com/first.png',
    });
    expect(unchangedAsset?.type === 'image' ? unchangedAsset.source : undefined).toEqual({
      kind: 'url',
      url: 'https://example.com/shared.png',
    });
  });

  it('applies timeRange edits as frame timing', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'clip', type: 'image', imageUrl: 'https://example.com/c.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].time_range = [0.5, 1.5];

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers[0].time.inFrame).toBe(15);
    expect(updatedIR.layers[0].time.outFrame).toBe(45);
  });

  it('applies composition-level edits (name, duration, loop)', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'x', type: 'image', imageUrl: 'https://example.com/x.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.meta.name = 'renamed';
    edited.meta.duration = 4;
    edited.meta.loop = false;

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.name).toBe('renamed');
    expect(updatedIR.outPoint).toBe(120);
    expect(updatedIR.endBehavior).toBe('destroy');
  });

  it('matches by the mapped IR layer ID even when an editor rewrites the DSL layer id', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'keep',
        type: 'image',
        imageUrl: 'https://example.com/k.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].id = 'totally-different-id';
    edited.layers[0].opacity = { a: false, value: 0.3 };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers[0].transform?.opacity).toEqual({ type: 'static', value: 0.3 });
  });

  it('falls back to tree-path + name when pure DSL has a mangled id (no source)', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'root', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/c.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const idMap = new Map(edited.layers.map(item => [item.id, `mangled_${item.id}`]));
    const strip = (l: (typeof edited.layers)[number]): void => {
      l.id = idMap.get(l.id) ?? l.id;
      if (l.parent != null) {
        l.parent = idMap.get(l.parent) ?? l.parent;
      }
      (l.children ?? []).forEach(strip);
    };

    edited.layers.forEach(strip);
    (edited.layers[0].children ?? [])[0].opacity = { a: false, value: 0.25 };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers[1].transform?.opacity).toEqual({ type: 'static', value: 0.25 });
  });

  it('applies an edit made through the canonical nested child', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'root', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/c.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? []).find(item => item.name === 'child');

    if (child == null) {
      throw new Error('expected child layer');
    }
    child.opacity = { a: false, value: 0.4 };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers[1].transform?.opacity).toEqual({ type: 'static', value: 0.4 });
  });

  it('deletes the original instead of mis-binding when the name also changed', () => {
    const onWarning = vi.fn();
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'original',
        type: 'image',
        imageUrl: 'https://example.com/o.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].id = 'mangled';
    edited.layers[0].name = 'renamed';
    edited.layers[0].opacity = { a: false, value: 0.1 };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, { onWarning });

    expect(updatedIR.layers).toHaveLength(0);
    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('matches no baseline scene layer'),
    }));
  });

  it('reports one rotation change when rotation is edited', () => {
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'spin',
        type: 'image',
        transform: {
          rotation: { z: { type: 'static', value: 0 } },
        },
        imageUrl: 'https://example.com/spin.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].rotation = { a: false, value: [0, 0, 30] };
    updateIRFromDSL(ir, edited, layerMapping, { onChange: change => changes.push(change) });

    expect(changes.filter(change => change.field === 'rotation')).toHaveLength(1);
  });

  it('deletes a layer that is missing from the edited DSL', () => {
    const warnings: DSLToIRWarning[] = [];
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({ orderIndex: 0, name: 'a', type: 'image', imageUrl: 'https://example.com/a.png' }),
      layer({ orderIndex: 1, name: 'b', type: 'image', imageUrl: 'https://example.com/b.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers = edited.layers.filter(dslLayer => dslLayer.name !== 'b');

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onWarning: w => warnings.push(w),
      onChange: c => changes.push(c),
    });

    expect(updatedIR.layers).toHaveLength(1);
    expect(updatedIR.layers.map(l => l.name)).toEqual(['a']);
    expect(warnings).toEqual([]);
    expect(changes.some(c => c.kind === 'layer' && c.op === 'delete')).toBe(true);
  });

  it('clears a matte reference when its source layer is deleted', () => {
    const changes: DSLToIRChange[] = [];
    const ir = composition([
      layer({ orderIndex: 0, name: 'matte-source', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'matte-target',
        type: 'image',
        imageUrl: 'https://example.com/target.png',
        matte: { sourceLayerId: 'layer-0', mode: 'alpha' },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers = edited.layers.filter(dslLayer => dslLayer.name !== 'matte-source');

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    });

    expect(updatedIR.layers).toHaveLength(1);
    expect(updatedIR.layers[0].matte).toBeUndefined();
    expect(changes).toContainEqual(expect.objectContaining({
      kind: 'layer', op: 'delete', field: 'matte', layerId: 'layer-1',
    }));
  });

  it('reports DSL-only description edits instead of silently discarding them', () => {
    const onWarning = vi.fn();
    const ir = composition([layer({ orderIndex: 0, name: 'root', type: 'null' })]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].description.self = 'edited authoring description';

    updateIRFromDSL(ir, edited, layerMapping, { onWarning });

    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
      code: 'LAYER_DESCRIPTION_CHANGE_IGNORED',
      path: '$.layers[0].description',
      layerId: edited.layers[0].id,
    }));
  });

  it('clears parent links that point at a deleted layer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ir = composition([
      layer({ orderIndex: 0, name: 'root', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/c.png',
        localBounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];

    child.parent = null;
    edited.layers = [child];

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers.map(layer => layer.id)).toEqual(['layer-1']);
    expect(updatedIR.layers[0].parentId).toBeUndefined();
    expect(() => convertIRToGE(updatedIR)).not.toThrow();
    warn.mockRestore();
  });

  it('deletes a child removed from the canonical tree', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'root', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/c.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].children = [];

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers.map(item => item.name)).toEqual(['root']);
  });

  it('rejects duplicate layer id via validation', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'a', type: 'image', imageUrl: 'https://example.com/a.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers.push(structuredClone(dsl.layers[0]));

    expect(() => updateIRFromDSL(ir, edited, layerMapping)).toThrow(/X001: .*not globally unique/);
  });

  it('rejects parent cycles instead of treating every layer as deleted', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'a', type: 'null' }),
      layer({ orderIndex: 1, name: 'b', type: 'null' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.layers[0].parent = edited.layers[1].id;
    edited.layers[1].parent = edited.layers[0].id;

    expect(() => updateIRFromDSL(ir, edited, layerMapping)).toThrow(/X006: .*parent-pointer cycle/);
    expect(ir.layers).toHaveLength(2);
  });

  it('warns instead of throwing when parent and physical nesting differ', () => {
    const onWarning = vi.fn();
    const ir = composition([
      layer({ orderIndex: 0, name: 'root', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/c.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const child = (edited.layers[0].children ?? [])[0];

    child.parent = null;

    updateIRFromDSL(ir, edited, layerMapping, { onWarning });

    expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('parent change'),
    }));
  });

  it.each(['no-op', 'opacity'])('preserves interleaved child-before-parent order during %s writeback', edit => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'child', type: 'null', parentId: 'layer-2' }),
      layer({ orderIndex: 1, name: 'sibling', type: 'null' }),
      layer({ orderIndex: 2, name: 'parent', type: 'null' }),
    ]);
    const { dsl, preservedData: { layerMapping } } = convertIRToDSL(ir);
    const expectedIR = structuredClone(ir);
    const changes: DSLToIRChange[] = [];

    if (edit === 'opacity') {
      const sibling = dsl.layers.find(layer => layer.id === 'layer-1');

      if (sibling == null) {
        throw new Error('Expected sibling layer.');
      }
      sibling.opacity = { a: false, value: 0.5 };
      expectedIR.layers[1].transform = {
        ...expectedIR.layers[1].transform,
        opacity: { type: 'static', value: 0.5 },
      };
    }
    const updatedIR = updateIRFromDSL(ir, dsl, layerMapping, { onChange: change => changes.push(change) });

    expect(updatedIR).toEqual(expectedIR);
    expect(changes.filter(change => change.field === 'order')).toEqual([]);
  });

  it('reorders child-before-parent subtrees when a sibling stacking rank changes', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'child', type: 'null', parentId: 'layer-2' }),
      layer({ orderIndex: 1, name: 'sibling', type: 'null' }),
      layer({ orderIndex: 2, name: 'parent', type: 'null' }),
    ]);
    const { dsl, preservedData: { layerMapping } } = convertIRToDSL(ir);
    const sibling = dsl.layers.find(layer => layer.id === 'layer-1');

    if (sibling == null) {
      throw new Error('Expected sibling layer.');
    }
    sibling.position = { a: false, value: [100, 200, 3] };

    const changes: DSLToIRChange[] = [];
    const updatedIR = updateIRFromDSL(ir, dsl, layerMapping, { onChange: change => changes.push(change) });

    expect(updatedIR.layers).toEqual([ir.layers[0], ir.layers[2], ir.layers[1]]);
    expect(changes).toContainEqual({
      kind: 'layer',
      op: 'set',
      field: 'order',
      oldValue: ['layer-2', 'layer-1'],
      newValue: ['layer-1', 'layer-2'],
    });
  });

  it('reorders sibling subtrees without changing their parent relationships', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'parent', type: 'null' }),
      layer({ orderIndex: 1, name: 'child-a', type: 'null', parentId: 'layer-0' }),
      layer({
        orderIndex: 2,
        name: 'grandchild',
        type: 'image',
        parentId: 'layer-1',
        imageUrl: 'https://example.com/grandchild.png',
      }),
      layer({
        orderIndex: 3,
        name: 'child-b',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/child-b.png',
      }),
      layer({
        orderIndex: 4,
        name: 'root',
        type: 'image',
        imageUrl: 'https://example.com/root.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);
    const parent = edited.layers.find(layer => layer.name === 'parent');

    if (parent == null) {
      throw new Error('Expected parent layer.');
    }

    (parent.children ?? []).forEach((layer, index) => {
      layer.position = { a: false, value: [0, 0, index] };
    });

    const changes: DSLToIRChange[] = [];
    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    });

    expect(updatedIR.layers.map(layer => layer.name)).toEqual(['parent', 'child-b', 'child-a', 'grandchild', 'root']);
    expect(updatedIR.layers.find(layer => layer.name === 'child-a')?.parentId).toBe('layer-0');
    expect(updatedIR.layers.find(layer => layer.name === 'child-b')?.parentId).toBe('layer-0');
    expect(updatedIR.layers.find(layer => layer.name === 'grandchild')?.parentId).toBe('layer-1');
    expect(changes).toContainEqual(
      expect.objectContaining({
        kind: 'layer',
        op: 'set',
        field: 'order',
        layerId: parent.id,
      }),
    );
  });

  it('rejects a dangling parent reference', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'root', type: 'null' }),
      layer({
        orderIndex: 1,
        name: 'child',
        type: 'image',
        parentId: 'layer-0',
        imageUrl: 'https://example.com/c.png',
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    (edited.layers[0].children ?? [])[0].parent = 'different-parent';

    expect(() => updateIRFromDSL(ir, edited, layerMapping)).toThrow(/X004: .*dangling reference/);
  });

  it('reframes existing IR when fps changes without changing seconds', () => {
    const ir = composition(
      [
        layer({
          orderIndex: 0,
          name: 'animated',
          type: 'image',
          time: { inFrame: 6, outFrame: 54 },
          imageUrl: 'https://example.com/animated.png',
          transform: {
            position: {
              type: 'keyframed',
              keyframes: [
                { frame: 6, value: [10, 20, 0] },
                { frame: 36, value: [30, 40, 0] },
              ],
            },
            anchor: { type: 'static', value: [0, 0, 0] },
            scale: {
              type: 'keyframed',
              keyframes: [
                { frame: 6, value: [1, 1, 1] },
                { frame: 36, value: [2, 2, 1] },
              ],
            },
            rotation: {
              x: {
                type: 'keyframed',
                keyframes: [
                  { frame: 6, value: 0 },
                  { frame: 36, value: 10 },
                ],
              },
              y: {
                type: 'keyframed',
                keyframes: [
                  { frame: 6, value: 0 },
                  { frame: 36, value: 20 },
                ],
              },
              z: {
                type: 'keyframed',
                keyframes: [
                  { frame: 6, value: 0 },
                  { frame: 36, value: 30 },
                ],
              },
            },
            opacity: {
              type: 'keyframed',
              keyframes: [
                { frame: 6, value: 0 },
                { frame: 36, value: 1 },
              ],
            },
          },
        }),
      ],
      { inPoint: 3, outPoint: 63 },
    );
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.meta.fps = 60;

    const changes: DSLToIRChange[] = [];
    const updatedIR = updateIRFromDSL(ir, edited, layerMapping, {
      onChange: change => changes.push(change),
    });
    const updatedLayer = updatedIR.layers[0];
    const updatedDSL = convertIRToDSL(updatedIR).dsl;

    expect(updatedIR.frameRate).toBe(60);
    expect([updatedIR.inPoint, updatedIR.outPoint]).toEqual([6, 126]);
    expect(updatedLayer.time).toEqual({
      inFrame: 12,
      outFrame: 108,
    });
    expect(getKeyframeFrames(updatedLayer.transform?.position)).toEqual([12, 72]);
    expect(getKeyframeFrames(updatedLayer.transform?.scale)).toEqual([12, 72]);
    expect(getKeyframeFrames(updatedLayer.transform?.rotation?.x)).toEqual([12, 72]);
    expect(getKeyframeFrames(updatedLayer.transform?.rotation?.y)).toEqual([12, 72]);
    expect(getKeyframeFrames(updatedLayer.transform?.rotation?.z)).toEqual([12, 72]);
    expect(getKeyframeFrames(updatedLayer.transform?.opacity)).toEqual([12, 72]);
    expect(updatedDSL.meta.duration).toBe(dsl.meta.duration);
    expect(updatedDSL.layers[0].time_range).toEqual(dsl.layers[0].time_range);
    expect(updatedDSL.layers[0].position).toEqual(dsl.layers[0].position);
    expect(updatedDSL.layers[0].scale).toEqual(dsl.layers[0].scale);
    expect(updatedDSL.layers[0].rotation).toEqual(dsl.layers[0].rotation);
    expect(updatedDSL.layers[0].opacity).toEqual(dsl.layers[0].opacity);
    expect(changes).toContainEqual({
      kind: 'composition',
      op: 'set',
      field: 'fps',
      oldValue: 30,
      newValue: 60,
    });
  });

  it('uses the target fps for simultaneous timing and animation edits', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'x', type: 'image', imageUrl: 'https://example.com/x.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const edited = structuredClone(dsl);

    edited.meta.fps = 60;
    edited.layers[0].time_range = [0.25, 1.5];
    edited.layers[0].opacity = {
      a: true,
      animation: [{ t: [0.25, 1.5], start: [0], end: [1], easing: [0, 0, 1, 1] }],
    };

    const updatedIR = updateIRFromDSL(ir, edited, layerMapping);

    expect(updatedIR.layers[0].time).toMatchObject({ inFrame: 15, outFrame: 90 });
    expect(getKeyframeFrames(updatedIR.layers[0].transform?.opacity)).toEqual([15, 90]);
  });
});

describe('preserved-data change detection', () => {
  it('does not treat equivalent opaque background colors as an edit', () => {
    const backgroundColor: IRColor = [0.4, 0.4, 0.4, 1];
    const ir = composition(
      [layer({ orderIndex: 0, name: 'x', type: 'image', imageUrl: 'https://example.com/x.png' })],
      { backgroundColor },
    );
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const editedDSL = structuredClone(dsl);

    editedDSL.meta.background_color = '#666666FF';

    const updatedIR = updateIRFromDSL(ir, editedDSL, layerMapping);

    expect(updatedIR.backgroundColor).toEqual(backgroundColor);
  });

  it('does not treat equivalent opaque text colors as an edit', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'hi',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'center',
        },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const editedDSL = structuredClone(dsl);
    const changes: DSLToIRChange[] = [];

    editedDSL.layers[0].text!.color = '#ff0000FF';

    const updatedIR = updateIRFromDSL(ir, editedDSL, layerMapping, {
      onChange: change => changes.push(change),
    });

    expect(updatedIR.layers[0]).toEqual(ir.layers[0]);
    expect(changes.some(change => change.kind === 'text')).toBe(false);
  });

  it('writes text colors when their semantic value changes', () => {
    const ir = composition([
      layer({
        orderIndex: 0,
        name: 'title',
        type: 'text',
        localBounds: { x: 0, y: 0, width: 200, height: 40 },
        content: {
          text: 'hi',
          fontAssetId: 'font:test-sans',
          fontSize: 24,
          color: [1, 0, 0, 1],
          letterSpacing: 0,
          lineHeight: 24,
          textAlign: 'center',
        },
      }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const editedDSL = structuredClone(dsl);

    editedDSL.layers[0].text!.color = '#00ff00';

    const updatedIR = updateIRFromDSL(ir, editedDSL, layerMapping);

    expect(updatedIR.layers[0].type === 'text' ? updatedIR.layers[0].content.color : undefined)
      .toEqual([0, 1, 0, 1]);
  });

  it('reports an fps update as a change without emitting a warning', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'x', type: 'image', imageUrl: 'https://example.com/x.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const editedDSL = structuredClone(dsl);

    editedDSL.meta.fps = 60;

    const warnings: DSLToIRWarning[] = [];
    const changes: DSLToIRChange[] = [];

    updateIRFromDSL(ir, editedDSL, layerMapping, {
      onWarning: warning => warnings.push(warning),
      onChange: change => changes.push(change),
    });

    expect(warnings).toEqual([]);
    expect(changes).toContainEqual({
      kind: 'composition',
      op: 'set',
      field: 'fps',
      oldValue: 30,
      newValue: 60,
    });
  });

  it('drops a missing layer without emitting a warning', () => {
    const ir = composition([
      layer({ orderIndex: 0, name: 'a', type: 'image', imageUrl: 'https://example.com/a.png' }),
      layer({ orderIndex: 1, name: 'b', type: 'image', imageUrl: 'https://example.com/b.png' }),
    ]);
    const {
      dsl,
      preservedData: { layerMapping },
    } = convertIRToDSL(ir);
    const editedDSL = structuredClone(dsl);

    editedDSL.layers = editedDSL.layers.filter(dslLayer => dslLayer.id !== 'layer-1');

    const warnings: DSLToIRWarning[] = [];
    const updatedIR = updateIRFromDSL(ir, editedDSL, layerMapping, {
      onWarning: warning => warnings.push(warning),
    });

    expect(updatedIR.layers).toHaveLength(1);
    expect(updatedIR.layers.every(currentLayer => currentLayer.id !== 'layer-1')).toBe(true);
    expect(warnings.some(warning => warning.code === 'LAYER_DELETED_FROM_EDIT')).toBe(false);
  });
});

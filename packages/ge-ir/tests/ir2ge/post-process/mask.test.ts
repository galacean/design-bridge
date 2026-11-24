import { describe, expect, it } from 'vitest';
import type { IRComposition, IRLayer, IRMask } from '@galacean/animation-ir';
import { IRMaskMode } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { DataType, EndBehavior, ItemType, RenderLevel } from '@galacean/effects-specification';

import {
  appendRuntimeMaskReference, applyMasks, createRuntimeMaskState, type MaskLayerLookup,
} from '../../../src/ir2ge/post-process/mask';
import type {
  ECSCollector,
  GeneratedComponentData,
  GeneratedItemBinding,
  GeneratedVFXItemData,
} from '../../../src/ir2ge/types';
import { migrateTestLayerAsset, type TestIRLayerOverrides } from '../../test-ir';

function makeRectPath(cx: number, cy: number, w: number, h: number): IRMask['path'] {
  const halfW = w / 2;
  const halfH = h / 2;
  const points = [
    { x: cx - halfW, y: cy - halfH },
    { x: cx + halfW, y: cy - halfH },
    { x: cx + halfW, y: cy + halfH },
    { x: cx - halfW, y: cy + halfH },
  ];
  // simple rect: all easing handles zero
  const zeroes = points.map(() => ({ x: 0, y: 0 }));

  return { points, inTangents: zeroes, outTangents: zeroes, closed: true };
}

function makePolyPath(points: Array<{ x: number; y: number }>): IRMask['path'] {
  const easings = points.map(() => ({ x: 5, y: 5 })); // non-zero so it's not detected as rect

  return { points, inTangents: easings, outTangents: easings, closed: true };
}

function makeLayer(
  overrides: Omit<TestIRLayerOverrides, 'type'> & { orderIndex?: number; type?: IRLayer['type'] },
): IRLayer {
  const { orderIndex = 0, imageUrl = 'a.png', imageAssetId, asset, ...layerOverrides } = overrides;
  const id = `layer-${orderIndex}`;
  const type = overrides.type ?? 'image';

  return {
    id,
    name: 'layer-0',
    type,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    ...layerOverrides,
    ...migrateTestLayerAsset(id, type, imageUrl, imageAssetId, asset),
  } as IRLayer;
}

function makeIR(layers: IRLayer[]): IRComposition {
  return {
    id: 'test-composition',
    name: 'test',
    width: 200,
    height: 200,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: 'loop',
    layers,
  };
}

function makeCollector(items: GeneratedVFXItemData[] = [], components: Record<string, unknown>[] = []): ECSCollector {
  return {
    images: [],
    fonts: [],
    components: components as GeneratedComponentData[],
    items,
    textures: [],
    miscs: [],
  };
}

function makeLookup(
  itemByLayerId: Record<string, string>,
  componentByLayerId: Record<string, string> = {},
  parentLayerIds = new Set<string>(),
): MaskLayerLookup {
  return {
    getItemId: layerId => itemByLayerId[layerId],
    getMaskParentItemId: layerId => itemByLayerId[layerId],
    getMaskCoordinateOrigin: () => undefined,
    getComponentId: layerId => componentByLayerId[layerId],
    isParentLayer: layerId => parentLayerIds.has(layerId),
  };
}

describe('applyMasks', () => {
  it('keeps geometrically nested masks when their coordinates belong to different item spaces', () => {
    const component = makeCollector([], [{ id: 'target', renderer: {} }]).components[0];
    const runtimeMaskState = createRuntimeMaskState();
    const largeGeometry = {
      points: [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }],
    };
    const smallGeometry = {
      points: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }],
    };

    if (component == null) {
      throw new Error('expected test target component');
    }

    expect(appendRuntimeMaskReference(component, 'outer-mask', {
      geometry: largeGeometry,
      geometrySpaceId: 'outer-precomp',
      inverted: false,
    }, runtimeMaskState)).toBe(true);
    expect(appendRuntimeMaskReference(component, 'local-mask', {
      geometry: smallGeometry,
      geometrySpaceId: 'local-image',
      inverted: false,
    }, runtimeMaskState)).toBe(true);
    expect((component['mask'] as { references?: unknown[] }).references).toHaveLength(2);
  });

  it('no-ops when no layer has a mask', () => {
    const ir = makeIR([makeLayer({})]);
    const collector = makeCollector();
    const itemBindings: GeneratedItemBinding[] = [];

    applyMasks(ir, collector, itemBindings, 0.01, 200, 200, 30, makeLookup({ 'layer-0': 'item-0' }));

    expect(collector.items).toHaveLength(0);
    expect(collector.components).toHaveLength(0);
    expect(itemBindings).toHaveLength(0);
  });

  it('generates a simple rect ShapeComponent (type 1) for an axis-aligned 4-point mask', () => {
    const layer = makeLayer({
      masks: [{ mode: IRMaskMode.Add, path: makeRectPath(50, 50, 40, 20) }],
    });
    const ir = makeIR([layer]);
    const layerItem: GeneratedVFXItemData = {
      id: 'item-0',
      dataType: DataType.VFXItemData,
      name: 'l',
      duration: 2,
      type: ItemType.sprite,
      visible: true,
      endBehavior: EndBehavior.destroy,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const layerComp = { id: 'comp-0', renderer: {} };
    const collector = makeCollector([layerItem], [layerComp]);
    const itemBindings: GeneratedItemBinding[] = [];

    applyMasks(
      ir,
      collector,
      itemBindings,
      1,
      200,
      200,
      30,
      makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }),
    );

    // Mask item + mask component should have been pushed
    expect(collector.items).toHaveLength(2);
    expect(collector.components).toHaveLength(2);
    const maskItem = collector.items[1];

    expect(maskItem.type).toBe('shape');
    expect(maskItem.parentId).toBe('item-0');
    const maskComponent = collector.components[1];

    expect(maskComponent['type']).toBe(1); // simple rect
    expect(maskComponent['width']).toBe(40);
    expect(maskComponent['height']).toBe(20);
    // The owning component picked up the mask reference
    const layerCompAfter = collector.components[0];

    expect(layerCompAfter['mask']).toBeDefined();
    expect((layerCompAfter['mask'] as Record<string, unknown>)['isMask']).toBe(false);
  });

  it('keeps a zero-tangent skewed quadrilateral as a Custom mask', () => {
    const points = [
      { x: -15.675, y: 4.4 }, { x: 241.977, y: 3.8 },
      { x: 226, y: 171 }, { x: 0, y: 171 },
    ];
    const zeroTangents = points.map(() => ({ x: 0, y: 0 }));
    const layer = makeLayer({
      masks: [{
        mode: IRMaskMode.Add,
        path: { points, inTangents: zeroTangents, outTangents: zeroTangents, closed: true },
      }],
    });
    const layerItem: GeneratedVFXItemData = {
      id: 'item-0', dataType: DataType.VFXItemData, name: 'layer', duration: 2, type: ItemType.sprite,
      visible: true, endBehavior: EndBehavior.destroy, delay: 0, renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 }, eulerHint: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    };
    const collector = makeCollector([layerItem], [{ id: 'comp-0', renderer: {} }]);

    applyMasks(
      makeIR([layer]),
      collector,
      [],
      1,
      200,
      200,
      30,
      makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }),
    );

    expect(collector.components[1]?.['type']).toBe(0);
    expect(collector.components[1]?.['points']).toHaveLength(4);
  });

  it('generates a polygon ShapeComponent (type 0) for a non-rect mask', () => {
    const layer = makeLayer({
      masks: [{
        mode: IRMaskMode.Add,
        path: makePolyPath([
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 25, y: 50 },
        ]),
      }],
    });
    const ir = makeIR([layer]);
    const layerItem: GeneratedVFXItemData = {
      id: 'item-0',
      dataType: DataType.VFXItemData,
      name: 'l',
      duration: 2,
      type: ItemType.sprite,
      visible: true,
      endBehavior: EndBehavior.destroy,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const collector = makeCollector([layerItem], [{ id: 'comp-0', renderer: {} }]);

    applyMasks(ir, collector, [], 1, 200, 200, 30, makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }));

    const maskComponent = collector.components[1];

    expect(maskComponent['type']).toBe(0);
    expect(Array.isArray(maskComponent['points'])).toBe(true);
    expect((maskComponent['points'] as unknown[]).length).toBe(3);
  });

  it.each([
    { mode: IRMaskMode.Add, expectedInverted: false },
    { mode: IRMaskMode.Add, inverted: true, expectedInverted: true },
    { mode: IRMaskMode.Subtract, expectedInverted: true },
    { mode: IRMaskMode.Subtract, inverted: true, expectedInverted: false },
    { mode: IRMaskMode.Intersect, expectedInverted: false },
    { mode: IRMaskMode.Intersect, inverted: true, expectedInverted: true },
  ])('maps $mode inverted=$inverted to GE inverted=$expectedInverted', ({ mode, inverted, expectedInverted }) => {
    const layer = makeLayer({ masks: [{ mode, inverted, path: makeRectPath(50, 50, 40, 20) }] });
    const item: GeneratedVFXItemData = {
      id: 'item-0', dataType: DataType.VFXItemData, name: 'layer', duration: 2, type: ItemType.sprite,
      visible: true, endBehavior: EndBehavior.destroy, delay: 0, renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 }, eulerHint: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    };
    const component: Record<string, unknown> = { id: 'comp-0', renderer: {} };
    const collector = makeCollector([item], [component]);

    applyMasks(
      makeIR([layer]), collector, [], 1, 200, 200, 30,
      makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }),
    );

    expect(component['mask']).toMatchObject({ references: [{ inverted: expectedInverted }] });
  });

  it('emits ordered Runtime references for an authored multi-mask stack', () => {
    const layer = makeLayer({
      masks: [
        { mode: IRMaskMode.Add, path: makeRectPath(50, 50, 80, 80) },
        { mode: IRMaskMode.Subtract, path: makeRectPath(50, 50, 20, 20) },
      ],
    });
    const item: GeneratedVFXItemData = {
      id: 'item-0', dataType: DataType.VFXItemData, name: 'layer', duration: 2, type: ItemType.sprite,
      visible: true, endBehavior: EndBehavior.destroy, delay: 0, renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 }, eulerHint: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    };
    const component: Record<string, unknown> = { id: 'comp-0', renderer: {} };
    const collector = makeCollector([item], [component]);

    applyMasks(
      makeIR([layer]), collector, [], 1, 200, 200, 30,
      makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }),
    );

    const mask = component['mask'] as Record<string, unknown>;
    const references = mask['references'] as Array<Record<string, unknown>>;

    expect(references).toHaveLength(2);
    expect(references.map(reference => reference['inverted'])).toEqual([false, true]);
    expect(mask).not.toHaveProperty('reference');
    expect(mask).not.toHaveProperty('inverted');
    expect(collector.items.filter(candidate => candidate.type === ItemType.shape)).toHaveLength(2);
  });

  it('keeps an inverted Add mask because it maps to a reverse Runtime reference', () => {
    const layer = makeLayer({
      masks: [
        { mode: IRMaskMode.Add, path: makeRectPath(50, 50, 80, 80) },
        { mode: IRMaskMode.Add, inverted: true, path: makeRectPath(50, 50, 20, 20) },
      ],
    });
    const item: GeneratedVFXItemData = {
      id: 'item-0', dataType: DataType.VFXItemData, name: 'layer', duration: 2, type: ItemType.sprite,
      visible: true, endBehavior: EndBehavior.destroy, delay: 0, renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 }, eulerHint: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    };
    const component: Record<string, unknown> = { id: 'comp-0', renderer: {} };
    const collector = makeCollector([item], [component]);
    const diagnostics: ConversionDiagnostic[] = [];

    applyMasks(
      makeIR([layer]), collector, [], 1, 200, 200, 30,
      makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }),
      undefined,
      undefined,
      diagnostics,
    );

    const references = (component['mask'] as Record<string, unknown>)['references'] as Array<Record<string, unknown>>;

    expect(references.map(reference => reference['inverted'])).toEqual([false, true]);
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GE_MASK_ADD_UNION_UNSUPPORTED' }));
  });

  it('drops an additional authored Add mask with a structured diagnostic', () => {
    const layer = makeLayer({
      masks: [
        { mode: IRMaskMode.Add, path: makeRectPath(50, 50, 80, 80) },
        { mode: IRMaskMode.Add, path: makeRectPath(50, 50, 20, 20) },
      ],
    });
    const item: GeneratedVFXItemData = {
      id: 'item-0', dataType: DataType.VFXItemData, name: 'layer', duration: 2, type: ItemType.sprite,
      visible: true, endBehavior: EndBehavior.destroy, delay: 0, renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-0' }],
      transform: {
        position: { x: 0, y: 0, z: 0 }, eulerHint: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      },
    };
    const component: Record<string, unknown> = { id: 'comp-0', renderer: {} };
    const collector = makeCollector([item], [component]);
    const diagnostics: ConversionDiagnostic[] = [];

    applyMasks(
      makeIR([layer]), collector, [], 1, 200, 200, 30,
      makeLookup({ 'layer-0': 'item-0' }, { 'layer-0': 'comp-0' }),
      undefined,
      undefined,
      diagnostics,
    );

    expect((component['mask'] as Record<string, unknown>)['references']).toHaveLength(1);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'GE_MASK_ADD_UNION_UNSUPPORTED', sourceId: layer.id, action: 'dropped',
    }));
  });

  it('materializes Precomp clipToBounds as a Runtime mask without adding an authored IR mask', () => {
    const layer = makeLayer({ type: 'precomp', localBounds: { x: 0, y: 0, width: 200, height: 200 } });

    if (layer.type !== 'precomp') {
      throw new Error('expected precomp test layer');
    }
    layer.content.clipToBounds = true;
    const ir = makeIR([layer]);
    const collector = makeCollector([], []);

    applyMasks(ir, collector, [], 1, 200, 200, 30, makeLookup({ 'layer-0': 'item-0' }));

    expect(layer.masks).toBeUndefined();
    expect(collector.items).toHaveLength(1);
    expect(collector.components).toHaveLength(1);
    expect(collector.components[0]?.['mask']).toMatchObject({ isMask: true });
  });

  it('propagates the mask to descendant renderers when the layer is a parent', () => {
    const parentLayer = makeLayer({
      orderIndex: 0,
      type: 'null',
      masks: [{ mode: IRMaskMode.Add, path: makeRectPath(50, 50, 40, 20) }],
    });
    const childLayer = makeLayer({ orderIndex: 1, type: 'image' });
    const ir = makeIR([parentLayer, childLayer]);

    const parentItem: GeneratedVFXItemData = {
      id: 'item-parent',
      dataType: DataType.VFXItemData,
      name: 'p',
      duration: 2,
      type: ItemType.null,
      visible: true,
      endBehavior: EndBehavior.freeze,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const childItem: GeneratedVFXItemData = {
      id: 'item-child',
      dataType: DataType.VFXItemData,
      name: 'c',
      duration: 2,
      type: ItemType.sprite,
      visible: true,
      endBehavior: EndBehavior.destroy,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-child' }],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      parentId: 'item-parent',
    };
    const childComp: Record<string, unknown> = { id: 'comp-child', renderer: {} };
    const collector = makeCollector([parentItem, childItem], [childComp]);

    applyMasks(
      ir,
      collector,
      [],
      1,
      200,
      200,
      30,
      makeLookup(
        { 'layer-0': 'item-parent', 'layer-1': 'item-child' },
        { 'layer-1': 'comp-child' },
        new Set(['layer-0']),
      ),
    );

    // Child renderer component should have the mask reference attached
    expect(childComp['mask']).toBeDefined();
  });

  it('does not generate an orphan mask when descendants are only mask-source items', () => {
    const parentLayer = makeLayer({
      orderIndex: 0,
      type: 'null',
      masks: [{ mode: IRMaskMode.Add, path: makeRectPath(50, 50, 40, 20) }],
    });
    const parentItem: GeneratedVFXItemData = {
      id: 'item-parent',
      dataType: DataType.VFXItemData,
      name: 'parent',
      duration: 2,
      type: ItemType.null,
      visible: true,
      endBehavior: EndBehavior.freeze,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const maskSourceItem: GeneratedVFXItemData = {
      id: 'item-existing-mask',
      dataType: DataType.VFXItemData,
      name: 'existing-shape',
      duration: 2,
      type: ItemType.shape,
      visible: true,
      endBehavior: EndBehavior.destroy,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-existing-mask' }],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      parentId: 'item-parent',
    };
    const collector = makeCollector(
      [parentItem, maskSourceItem],
      [{ id: 'comp-existing-mask', renderer: {}, mask: { isMask: true, alphaMaskEnabled: false } }],
    );

    applyMasks(
      makeIR([parentLayer]),
      collector,
      [],
      1,
      200,
      200,
      30,
      makeLookup({ 'layer-0': 'item-parent' }, {}, new Set(['layer-0'])),
    );

    expect(collector.items).toHaveLength(2);
    expect(collector.components).toHaveLength(1);
    expect(collector.items.some(item => item.name === 'layer-0_mask')).toBe(false);
  });

  it('propagates a parent mask to a regular shape whose name ends with _mask', () => {
    const parentLayer = makeLayer({
      orderIndex: 0,
      type: 'null',
      masks: [{ mode: IRMaskMode.Add, path: makeRectPath(50, 50, 40, 20) }],
    });
    const parentItem: GeneratedVFXItemData = {
      id: 'item-parent',
      dataType: DataType.VFXItemData,
      name: 'parent',
      duration: 2,
      type: ItemType.null,
      visible: true,
      endBehavior: EndBehavior.freeze,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const childItem: GeneratedVFXItemData = {
      id: 'item-child',
      dataType: DataType.VFXItemData,
      name: 'content_mask',
      duration: 2,
      type: ItemType.shape,
      visible: true,
      endBehavior: EndBehavior.destroy,
      delay: 0,
      renderLevel: RenderLevel.BPlus,
      components: [{ id: 'comp-child' }],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        eulerHint: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      parentId: 'item-parent',
    };
    const childComponent: Record<string, unknown> = { id: 'comp-child', renderer: {} };
    const collector = makeCollector([parentItem, childItem], [childComponent]);

    applyMasks(
      makeIR([parentLayer]),
      collector,
      [],
      1,
      200,
      200,
      30,
      makeLookup({ 'layer-0': 'item-parent' }, {}, new Set(['layer-0'])),
    );

    expect(childComponent['mask']).toMatchObject({ isMask: false });
    expect(collector.items.some(item => item.name === 'layer-0_mask')).toBe(true);
  });

  it('removes a redundant Precomp clip that contains an authored mask', () => {
    const clipParent = makeLayer({
      orderIndex: 0,
      type: 'precomp',
      name: 'clip',
      localBounds: { x: 0, y: 0, width: 100, height: 100 },
    });

    if (clipParent.type !== 'precomp') {
      throw new Error('expected precomp test layer');
    }
    clipParent.content.clipToBounds = true;
    const authoredMaskParent = makeLayer({
      orderIndex: 1,
      type: 'null',
      name: 'authored',
      masks: [{ mode: IRMaskMode.Add, path: makeRectPath(50, 50, 80, 80) }],
    });
    const sharedChild = makeLayer({ orderIndex: 2, type: 'image' });
    const ir = makeIR([sharedChild, authoredMaskParent, clipParent]);

    const items: GeneratedVFXItemData[] = [
      {
        id: 'item-clip',
        dataType: DataType.VFXItemData,
        name: 'clip',
        duration: 2,
        type: ItemType.null,
        visible: true,
        endBehavior: EndBehavior.freeze,
        delay: 0,
        renderLevel: RenderLevel.BPlus,
        components: [],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        id: 'item-authored',
        dataType: DataType.VFXItemData,
        name: 'authored',
        duration: 2,
        type: ItemType.null,
        visible: true,
        endBehavior: EndBehavior.freeze,
        delay: 0,
        renderLevel: RenderLevel.BPlus,
        components: [],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        parentId: 'item-clip',
      },
      {
        id: 'item-child',
        dataType: DataType.VFXItemData,
        name: 'c',
        duration: 2,
        type: ItemType.sprite,
        visible: true,
        endBehavior: EndBehavior.destroy,
        delay: 0,
        renderLevel: RenderLevel.BPlus,
        components: [{ id: 'comp-child' }],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          eulerHint: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        parentId: 'item-authored',
      },
    ];
    const childComp: Record<string, unknown> = { id: 'comp-child', renderer: {} };
    const collector = makeCollector(items, [childComp]);

    applyMasks(
      ir,
      collector,
      [],
      1,
      200,
      200,
      30,
      makeLookup(
        { 'layer-0': 'item-clip', 'layer-1': 'item-authored', 'layer-2': 'item-child' },
        { 'layer-2': 'comp-child' },
        new Set(['layer-0', 'layer-1']),
      ),
    );

    expect(childComp['mask']).toBeDefined();
    const maskRef = childComp['mask'] as Record<string, unknown>;
    const references = maskRef['references'] as Array<{ mask: { id: string } }>;

    const authoredMaskItem = collector.items.find(item => item.name === 'authored_mask');

    expect(authoredMaskItem).toBeDefined();
    expect(references).toHaveLength(1);
    expect(references[0]?.mask.id).toBe(authoredMaskItem!.components[0].id);
    expect(maskRef).not.toHaveProperty('reference');

    const clipMaskItem = collector.items.find(item => item.name === 'clip_mask');

    expect(clipMaskItem).toBeDefined();
  });
});

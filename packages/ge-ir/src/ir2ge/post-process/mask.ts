/**
 * Generate GE mask items for masked IR layers and attach references to direct
 * or descendant renderer components.
 */
import { IRMaskMode, type IRComposition, type IRLayer, type IRMask } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import {
  DataType,
  EndBehavior,
  FillType,
  ItemType,
  LineCap,
  LineJoin,
  RenderLevel,
  RenderMode,
  ShapePrimitiveType,
} from '@galacean/effects-specification';
import { toDataPath } from '../../common/data-path';
import { get2dTo3dRatio } from '../../common/coordinate-mapping';
import { createId } from '../../common/id';
import { isRecord } from '../../common/json-normalization';
import { roundNumber } from '../../common/math';
import { appendTimelineTracks } from '../generator/append-timeline-tracks';
import { computeLayerTiming } from '../converter/timing';
import { getStaticAnchor } from '../converter/transform';
import {
  buildRuntimeMaskGeometry, compareMaskContainment, type RuntimeMaskGeometry,
} from './mask-geometry';
import type {
  ECSCollector, GeneratedComponentData, GeneratedItemBinding, GeneratedMaskOptions, GeneratedMaskReference,
  GeneratedVFXItemData,
} from '../types';

/** Resolve stable IR Layer IDs to generated items and components. */
export interface MaskLayerLookup {
  getItemId(layerId: string): string | undefined;
  getMaskParentItemId(layerId: string): string | undefined;
  getMaskCoordinateOrigin(layerId: string): [number, number] | undefined;
  getComponentId(layerId: string): string | undefined;
  isParentLayer(layerId: string): boolean;
}

/** Internal metadata used to deduplicate and simplify generated Runtime references. */
export interface RuntimeMaskSourceMeta {
  geometry?: RuntimeMaskGeometry;
  /** Identity of the local coordinate space used by geometry. */
  geometrySpaceId?: string;
  inverted: boolean;
}

interface RuntimeMaskTargetReference {
  componentId: string;
  source: RuntimeMaskSourceMeta;
}

/** Shared multi-mask state across every generated Composition. */
export interface RuntimeMaskState {
  references: Map<string, RuntimeMaskTargetReference[]>;
  sources: Map<string, RuntimeMaskSourceMeta>;
}

export function createRuntimeMaskState(): RuntimeMaskState {
  return { references: new Map(), sources: new Map() };
}

interface MaskTarget {
  componentId: string;
  component: GeneratedComponentData;
}

export function applyMasks(
  ir: IRComposition,
  collector: ECSCollector,
  itemBindings: GeneratedItemBinding[],
  ratio: number,
  _width: number,
  _height: number,
  frameRate: number,
  lookup: MaskLayerLookup,
  compositionById: ReadonlyMap<string, IRComposition> = new Map([[ir.id, ir]]),
  runtimeMaskState: RuntimeMaskState = createRuntimeMaskState(),
  diagnostics: ConversionDiagnostic[] = [],
): void {
  const layers = ir.layers;

  const componentById = new Map<string, GeneratedComponentData>();

  for (const comp of collector.components) {
    componentById.set(comp.id, comp);
  }

  // Resolve masks in the same bottom-to-top order as the IR painter stack so
  // generated reference order remains deterministic.
  for (const layer of layers) {
    const resolvedMasks = resolveLayerMasks(layer, compositionById, ir.id, diagnostics);

    if (resolvedMasks.length === 0) {
      continue;
    }

    const layerItemId = lookup.getItemId(layer.id);

    if (layerItemId == null) {
      continue;
    }

    const layerComponentId = lookup.getComponentId(layer.id);
    const maskParentItemId = lookup.getMaskParentItemId(layer.id) ?? layerItemId;
    const maskRatio = resolveMaskCoordinateRatio(layer, compositionById, ratio);
    const maskCoordinateOrigin = lookup.getMaskCoordinateOrigin(layer.id) ??
      resolveMaskCoordinateOrigin(layer, compositionById);

    for (const mask of resolvedMasks) {
      buildMaskForLayer(
        layer,
        layerItemId,
        maskParentItemId,
        layerComponentId,
        collector,
        itemBindings,
        maskRatio,
        frameRate,
        ir.inPoint,
        lookup,
        runtimeMaskState,
        componentById,
        mask,
        maskCoordinateOrigin,
      );
    }
  }
}

function resolveMaskCoordinateOrigin(
  layer: IRLayer,
  compositionById: ReadonlyMap<string, IRComposition>,
): [number, number] {
  if (layer.type !== 'precomp') {
    return getStaticAnchor(layer);
  }
  const referenced = compositionById.get(layer.content.compositionId);
  const bounds = layer.localBounds ?? (referenced == null
    ? undefined
    : { x: 0, y: 0, width: referenced.width, height: referenced.height });

  if (bounds == null) {
    return [0, 0];
  }

  // Precomp children and masks use the referenced canvas' centered coordinate
  // space. The Precomp item's Transform.anchor already maps that canvas pivot
  // to the authored Layer anchor, so a mask must not subtract it again.
  return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2];
}

function resolveMaskCoordinateRatio(
  layer: IRLayer,
  compositionById: ReadonlyMap<string, IRComposition>,
  fallbackRatio: number,
): number {
  if (layer.type !== 'precomp') {
    return fallbackRatio;
  }
  const referenced = compositionById.get(layer.content.compositionId);

  if (referenced == null || referenced.width <= 0 || referenced.height <= 0) {
    return fallbackRatio;
  }

  // A Precomp mask is expressed in the referenced canvas' local pixels. The
  // mask item inherits the Precomp instance's intrinsic scale, so generating
  // it with the parent canvas ratio would apply that scale twice.
  return get2dTo3dRatio(referenced.width, referenced.height);
}

function resolveLayerMasks(
  layer: IRLayer,
  compositionById: ReadonlyMap<string, IRComposition>,
  compositionId: string,
  diagnostics: ConversionDiagnostic[],
): IRMask[] {
  const resolved = selectSupportedAuthoredMasks(layer, compositionId, diagnostics);

  if (layer.type === 'precomp' && layer.content.clipToBounds) {
    const referenced = compositionById.get(layer.content.compositionId);
    const width = layer.localBounds?.width ?? referenced?.width;
    const height = layer.localBounds?.height ?? referenced?.height;

    if (width != null && height != null && width > 0 && height > 0) {
      resolved.push(buildClipMask(width, height));
    }
  }

  return resolved;
}

/** GE forward references intersect, so only the first authored Add can preserve stack semantics. */
function selectSupportedAuthoredMasks(
  layer: IRLayer,
  compositionId: string,
  diagnostics: ConversionDiagnostic[],
): IRMask[] {
  const selected: IRMask[] = [];
  let hasAdd = false;

  for (const [index, mask] of (layer.masks ?? []).entries()) {
    const isForwardAdd = mask.mode === IRMaskMode.Add && mask.inverted !== true;

    if (isForwardAdd && hasAdd) {
      diagnostics.push({
        code: 'GE_MASK_ADD_UNION_UNSUPPORTED',
        severity: 'warning',
        action: 'dropped',
        path: `$.compositions[id=${JSON.stringify(compositionId)}].layers[id=${JSON.stringify(layer.id)}].masks[${index}]`,
        sourceId: layer.id,
        feature: 'multiple-add-masks',
        message: 'GE combines forward mask references by intersection, so this additional Add mask was omitted.',
      });
      continue;
    }
    if (isForwardAdd) {
      hasAdd = true;
    }
    selected.push(mask);
  }

  return selected;
}

function buildClipMask(width: number, height: number): IRMask {
  return {
    mode: IRMaskMode.Add,
    path: {
      points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
      inTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
      outTangents: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })),
      closed: true,
    },
  };
}

function buildMaskForLayer(
  layer: IRLayer,
  layerItemId: string,
  maskParentItemId: string,
  layerComponentId: string | undefined,
  collector: ECSCollector,
  itemBindings: GeneratedItemBinding[],
  ratio: number,
  frameRate: number,
  compositionInPoint: number,
  lookup: MaskLayerLookup,
  runtimeMaskState: RuntimeMaskState,
  componentById: Map<string, GeneratedComponentData>,
  mask: IRMask,
  coordinateOrigin: [number, number],
): void {
  const maskItemId = createId();
  const maskComponentId = createId();
  const maskBounds = getMaskBounds(mask);

  const maskPosX = roundNumber((maskBounds.cx - coordinateOrigin[0]) * ratio, 4);
  const maskPosY = roundNumber(-(maskBounds.cy - coordinateOrigin[1]) * ratio, 4);

  const timing = computeLayerTiming(layer, frameRate, compositionInPoint);
  const delay = timing.delay;
  const maskDuration = timing.layerDuration;

  const layerIsParent = lookup.isParentLayer(layer.id) || layer.type === 'null' || layer.type === 'precomp';

  const descendantTargets = layerIsParent && layer.type !== 'precomp'
    ? collectRendererDescendants(collector.items, componentById, layerItemId)
    : undefined;

  if (descendantTargets?.length === 0 && layer.type !== 'precomp') {
    return;
  }

  const maskItem: GeneratedVFXItemData = {
    id: maskItemId,
    dataType: DataType.VFXItemData,
    name: `${layer.name ?? layer.id}_mask`,
    duration: maskDuration,
    type: ItemType.shape,
    visible: true,
    endBehavior: EndBehavior.destroy,
    delay: roundNumber(delay, 4),
    renderLevel: RenderLevel.BPlus,
    components: [toDataPath(maskComponentId)],
    transform: {
      position: { x: maskPosX, y: maskPosY, z: 0 },
      eulerHint: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    parentId: maskParentItemId,
  };

  const maskComponent: GeneratedComponentData = isSimpleRectMask(mask)
    ? {
        id: maskComponentId,
        item: toDataPath(maskItemId),
        type: ShapePrimitiveType.Rectangle,
        dataType: DataType.ShapeComponent,
        width: roundNumber(maskBounds.width * ratio, 4),
        height: roundNumber(maskBounds.height * ratio, 4),
        roundness: 0,
        fills: [{ type: FillType.Solid, color: { r: 1, g: 1, b: 1, a: 0 } }],
        strokes: [],
        strokeWidth: 0,
        strokeCap: LineCap.Butt,
        strokeJoin: LineJoin.Round,
        renderer: { renderMode: RenderMode.MESH },
        mask: { isMask: true, alphaMaskEnabled: false },
      }
    : buildPolygonMaskComponent(maskComponentId, maskItemId, mask, maskBounds, ratio);

  collector.items.push(maskItem);
  collector.components.push(maskComponent);
  componentById.set(maskComponentId, maskComponent);
  const sourceMeta: RuntimeMaskSourceMeta = {
    geometry: buildRuntimeMaskGeometry(mask, ratio, coordinateOrigin),
    geometrySpaceId: maskParentItemId,
    inverted: resolveGEMaskInverted(mask),
  };

  runtimeMaskState.sources.set(maskComponentId, sourceMeta);
  let appliedReferenceCount = 0;

  if (descendantTargets != null) {
    for (const target of descendantTargets) {
      if (appendRuntimeMaskReference(target.component, maskComponentId, sourceMeta, runtimeMaskState)) {
        appliedReferenceCount++;
      }
    }
  } else if (layerComponentId != null) {
    const targetComponent = componentById.get(layerComponentId);

    if (
      targetComponent != null &&
      appendRuntimeMaskReference(targetComponent, maskComponentId, sourceMeta, runtimeMaskState)
    ) {
      appliedReferenceCount++;
    }
  }

  if (appliedReferenceCount === 0 && layer.type !== 'precomp') {
    collector.items.pop();
    collector.components.pop();
    componentById.delete(maskComponentId);
    runtimeMaskState.sources.delete(maskComponentId);

    return;
  }

  if (layer.type === 'precomp') {
    // GE Runtime stops its scene-order DFS at Composition items. Keep the mask
    // instantiated as a child, but do not bind it to the parent Timeline where
    // it would displace every following root-layer binding.
    itemBindings.push({ itemId: maskItemId, layerId: layer.id });
  } else {
    const maskTrackId = appendTimelineTracks(collector, delay, maskDuration, EndBehavior.destroy, {}, ItemType.shape);

    itemBindings.push({ itemId: maskItemId, objectBindingTrackId: maskTrackId, layerId: layer.id });
  }
}

/** Fold the source-neutral Mask operation and path polarity into one GE reference direction. */
export function resolveGEMaskInverted(mask: Pick<IRMask, 'mode' | 'inverted'>): boolean {
  return mask.mode === IRMaskMode.Subtract ? mask.inverted !== true : mask.inverted === true;
}

/** Append one target reference while removing provably redundant positive masks. */
export function appendRuntimeMaskReference(
  component: GeneratedComponentData,
  maskComponentId: string,
  sourceMeta: RuntimeMaskSourceMeta,
  runtimeMaskState: RuntimeMaskState,
): boolean {
  const existingMask = isRecord(component['mask']) ? component['mask'] : undefined;

  if (existingMask?.['isMask'] === true) {
    return false;
  }
  const references = readMaskReferences(existingMask);

  if (references.some(reference => reference.mask.id === maskComponentId)) {
    return false;
  }
  const targetReferences = runtimeMaskState.references.get(component.id) ?? [];

  if (!sourceMeta.inverted) {
    for (const existing of [...targetReferences]) {
      if (existing.source.inverted) {
        continue;
      }
      const sharesGeometrySpace = sourceMeta.geometrySpaceId != null &&
        existing.source.geometrySpaceId === sourceMeta.geometrySpaceId;
      const containment = sharesGeometrySpace
        ? compareMaskContainment(existing.source.geometry, sourceMeta.geometry)
        : 'none';

      if (containment === 'source-contains-existing' || containment === 'equal') {
        return false;
      }
      if (containment === 'existing-contains-source') {
        const referenceIndex = references.findIndex(reference => reference.mask.id === existing.componentId);

        if (referenceIndex >= 0) {
          references.splice(referenceIndex, 1);
        }
        const stateIndex = targetReferences.indexOf(existing);

        if (stateIndex >= 0) {
          targetReferences.splice(stateIndex, 1);
        }
      }
    }
  }

  references.push({ mask: toDataPath(maskComponentId), inverted: sourceMeta.inverted });
  targetReferences.push({ componentId: maskComponentId, source: sourceMeta });
  runtimeMaskState.references.set(component.id, targetReferences);
  component['mask'] = buildTargetMask(existingMask, references);

  return true;
}

function readMaskReferences(mask: Record<string, unknown> | undefined): GeneratedMaskReference[] {
  const references: GeneratedMaskReference[] = [];

  if (Array.isArray(mask?.['references'])) {
    for (const value of mask['references']) {
      if (!isRecord(value)) {
        continue;
      }
      const id = getDataPathId(value['mask']);

      if (id != null && !references.some(reference => reference.mask.id === id)) {
        references.push({ mask: toDataPath(id), inverted: value['inverted'] === true });
      }
    }
  }

  return references;
}

function buildTargetMask(
  existingMask: Record<string, unknown> | undefined,
  references: GeneratedMaskReference[],
): GeneratedMaskOptions {
  const normalizedExisting = { ...existingMask };

  delete normalizedExisting['reference'];
  delete normalizedExisting['inverted'];

  return {
    ...normalizedExisting,
    isMask: false,
    references,
  };
}

function getDataPathId(value: unknown): string | undefined {
  return isRecord(value) && typeof value['id'] === 'string' ? value['id'] : undefined;
}

function collectRendererDescendants(
  items: GeneratedVFXItemData[],
  componentById: Map<string, GeneratedComponentData>,
  parentItemId: string,
): MaskTarget[] {
  const targets: MaskTarget[] = [];

  function visit(targetParentId: string): void {
    for (const item of items) {
      if (item.parentId !== targetParentId) {
        continue;
      }

      const componentRefs = item.components;

      if (componentRefs != null && componentRefs.length > 0) {
        const componentReference = componentRefs[0];
        const component = componentById.get(componentReference.id);

        if (
          component != null &&
          !isMaskSourceComponent(component) &&
          component['renderer'] != null
        ) {
          targets.push({ componentId: componentReference.id, component });
        }
      }

      visit(item.id);
    }
  }

  visit(parentItemId);

  return targets;
}

function isMaskSourceComponent(component: GeneratedComponentData): boolean {
  const mask = component['mask'];

  return isRecord(mask) && mask['isMask'] === true;
}

function computePointBounds(points: Array<{ x: number; y: number }>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function getMaskBounds(mask: IRMask): {
  cx: number;
  cy: number;
  width: number;
  height: number;
} {
  const path = mask.path;

  if (path.points.length === 0) {
    return { cx: 0, cy: 0, width: 0, height: 0 };
  }

  const { minX, minY, maxX, maxY } = computePointBounds(path.points);

  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function isSimpleRectMask(mask: IRMask): boolean {
  const path = mask.path;

  if (
    path.points.length !== 4 ||
    !path.inTangents.every(isZeroTangent) ||
    !path.outTangents.every(isZeroTangent)
  ) {
    return false;
  }

  return path.points.every((point, index) => {
    const next = path.points[(index + 1) % path.points.length];
    const deltaX = Math.abs(next.x - point.x);
    const deltaY = Math.abs(next.y - point.y);

    return (deltaX < 0.01 && deltaY >= 0.01) || (deltaY < 0.01 && deltaX >= 0.01);
  });
}

function isZeroTangent(tangent: { x: number; y: number }): boolean {
  return Math.abs(tangent.x) < 0.01 && Math.abs(tangent.y) < 0.01;
}

function buildPolygonMaskComponent(
  maskComponentId: string,
  maskItemId: string,
  mask: IRMask,
  bounds: { cx: number; cy: number; width: number; height: number },
  ratio: number,
): GeneratedComponentData {
  const path = mask.path;
  const customPoints: Array<{ x: number; y: number }> = [];
  const customEasingIns: Array<{ x: number; y: number }> = [];
  const customEasingOuts: Array<{ x: number; y: number }> = [];
  const customIndexes: Array<{ point: number; easingIn: number; easingOut: number }> = [];

  for (let pointIndex = 0; pointIndex < path.points.length; pointIndex++) {
    const point = path.points[pointIndex];
    const easingIn = path.inTangents[pointIndex];
    const easingOut = path.outTangents[pointIndex];

    customPoints.push({
      x: roundNumber((point.x - bounds.cx) * ratio, 4),
      y: roundNumber(-(point.y - bounds.cy) * ratio, 4),
    });
    customEasingIns.push({
      x: roundNumber((easingIn?.x ?? 0) * ratio, 4),
      y: roundNumber(-(easingIn?.y ?? 0) * ratio, 4),
    });
    customEasingOuts.push({
      x: roundNumber((easingOut?.x ?? 0) * ratio, 4),
      y: roundNumber(-(easingOut?.y ?? 0) * ratio, 4),
    });
    customIndexes.push({ point: pointIndex, easingIn: pointIndex, easingOut: pointIndex });
  }

  return {
    id: maskComponentId,
    item: toDataPath(maskItemId),
    type: ShapePrimitiveType.Custom,
    dataType: DataType.ShapeComponent,
    points: customPoints,
    easingIns: customEasingIns,
    easingOuts: customEasingOuts,
    shapes: [{ close: path.closed, indexes: customIndexes }],
    fills: [{ type: FillType.Solid, color: { r: 1, g: 1, b: 1, a: 0 } }],
    strokes: [],
    strokeWidth: 0,
    strokeCap: LineCap.Butt,
    strokeJoin: LineJoin.Round,
    renderer: { renderMode: RenderMode.MESH },
    mask: { isMask: true, alphaMaskEnabled: false },
  };
}

import { IRMaskMode, IRMatteMode, type IRLayer, type IRMask } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { DataType, ShapePrimitiveType } from '@galacean/effects-specification';
import { resolveDataPathId } from '../../common/data-path';
import { isRecord } from '../../common/json-normalization';
import type { RawLayerDescriptor } from '../post-process';
import type { GESceneContext } from '../types';
import { parseTimeline } from '../parser/timeline';

interface MaskTarget {
  descriptor: RawLayerDescriptor;
  ctx: GESceneContext;
  targetItemId: string;
  inverted: boolean;
}

interface MaskOwner {
  descriptor: RawLayerDescriptor;
  ctx: GESceneContext;
}

interface ParsedMaskSource {
  sourceItemId: string;
  path: IRMask['path'];
}

interface ParsedGEMaskReference {
  componentId: string;
  inverted: boolean | undefined;
}

export interface GEMaskNormalizationComposition {
  sourceCompositionId: string;
  ctx: GESceneContext;
  descriptors: RawLayerDescriptor[];
}

/** Normalize GE component mask references into Layer mattes or a strict cross-Composition path fallback. */
export function normalizeGEMasks(
  compositions: GEMaskNormalizationComposition[],
  diagnostics: ConversionDiagnostic[],
): void {
  const ownerBySourceItemId = indexMaskOwnersBySourceItemId(compositions);
  const compositionByIRId = new Map(compositions.map(composition => [composition.ctx.irCompositionId, composition]));
  const targetsBySourceComponentId = new Map<string, MaskTarget[]>();

  for (const composition of compositions) {
    for (const descriptor of composition.descriptors) {
      const rawMask = descriptor.preservedData.mask;

      if (rawMask == null || rawMask['isMask'] === true) {
        continue;
      }
      const rawReferences = rawMask['references'];
      const references = readMaskReferences(rawMask);

      if ((Array.isArray(rawReferences) && rawReferences.length > 1) || references.length > 1) {
        diagnostics.push(createUnsupportedMaskDiagnostic(
          descriptor,
          'GE_MULTIPLE_MASK_REFERENCES_UNSUPPORTED',
          'multiple-mask-references',
          'Multiple GE mask references were retained in GE preserved data but not normalized into V1 IR.',
          'references',
        ));
        continue;
      }
      const sourceComponentId = references[0]?.componentId;
      const targetItemId = resolveTargetItemId(descriptor, composition.ctx);
      const inverted = references[0]?.inverted;

      if (
        sourceComponentId == null || targetItemId == null || inverted == null ||
        rawMask['alphaMaskEnabled'] === true
      ) {
        diagnostics.push(createUnsupportedMaskDiagnostic(
          descriptor,
          'GE_MASK_UNSUPPORTED',
          'single-mask-reference',
          'The GE mask was retained in GE preserved data because its reference options cannot enter V1 IR.',
        ));
        continue;
      }
      const targets = targetsBySourceComponentId.get(sourceComponentId) ?? [];

      targets.push({ descriptor, ctx: composition.ctx, targetItemId, inverted });
      targetsBySourceComponentId.set(sourceComponentId, targets);
    }
  }

  const normalizedSourceItemIds = new Set<string>();

  for (const [sourceComponentId, targets] of targetsBySourceComponentId) {
    const targetContext = targets[0]?.ctx;
    const sourceComponent = targetContext?.componentById.get(sourceComponentId);
    const sourceItemId = resolveDataPathId(sourceComponent?.['item']);
    const sourceItem = sourceItemId == null ? undefined : targetContext?.itemById.get(sourceItemId);
    const sourceLayerOwner = sourceItemId == null ? undefined : ownerBySourceItemId.get(sourceItemId);
    const parentItemId = typeof sourceItem?.['parentId'] === 'string' ? sourceItem['parentId'] : undefined;
    const owner = parentItemId == null ? undefined : ownerBySourceItemId.get(parentItemId);
    const inversion = targets[0]?.inverted;
    const hasConflictingInversion = targets.some(target => target.inverted !== inversion);
    const sourceTargetsBelongToOwner = owner != null && targets.every(target =>
      target.ctx.irCompositionId === owner.ctx.irCompositionId
        ? isItemAtOrBelowOwner(target.targetItemId, owner.descriptor, target.ctx)
        : owner.descriptor.layer.type === 'precomp' && isCompositionReachable(
            owner.descriptor.layer.content.compositionId,
            target.ctx.irCompositionId,
            compositionByIRId,
          ),
    );
    const referencedComposition = owner?.descriptor.layer.type === 'precomp'
      ? compositionByIRId.get(owner.descriptor.layer.content.compositionId)
      : undefined;
    const maskRatio = referencedComposition?.ctx.ratio ?? owner?.ctx.ratio;
    const parsedSource = sourceComponent == null || sourceItemId == null || owner == null
      ? undefined
      : parseMaskSource(
          sourceComponent,
          sourceItemId,
          owner.descriptor.layer,
          owner.ctx,
          maskRatio,
          referencedComposition?.ctx,
        );

    // A single GE mask reference is semantically a Layer matte whenever source and
    // target can be represented as Layers in the same Composition. Preserve
    // that identity before considering a path-only cross-Composition fallback.
    if (normalizeLayerMatteSource(sourceComponent, sourceLayerOwner, targets)) {
      continue;
    }
    if (
      parsedSource != null &&
      !hasConflictingInversion &&
      sourceTargetsBelongToOwner &&
      owner != null &&
      (owner.descriptor.layer.masks?.length ?? 0) === 0
    ) {
      const normalizedMask: IRMask = {
        path: parsedSource.path,
        mode: IRMaskMode.Add,
        ...(inversion === true && { inverted: true }),
      };

      owner.descriptor.layer.masks = [normalizedMask];
      normalizedSourceItemIds.add(parsedSource.sourceItemId);

      for (const target of targets) {
        delete target.descriptor.preservedData.mask;
      }
      continue;
    }
    for (const target of targets) {
      diagnostics.push(createUnsupportedMaskDiagnostic(
        target.descriptor,
        'GE_MASK_UNSUPPORTED',
        'mask-source-geometry',
        'The GE mask source was retained because it is neither one static path nor a supported Layer matte.',
      ));
    }
  }

  for (const composition of compositions) {
    composition.descriptors = composition.descriptors.filter(
      descriptor => !descriptorContainsAnyItem(descriptor, normalizedSourceItemIds),
    );
  }
}

function normalizeLayerMatteSource(
  sourceComponent: Record<string, unknown> | undefined,
  sourceLayerOwner: MaskOwner | undefined,
  targets: MaskTarget[],
): boolean {
  const sourceMask = sourceComponent?.['mask'];

  if (
    sourceComponent == null ||
    !isRecord(sourceMask) ||
    sourceMask['isMask'] !== true ||
    sourceLayerOwner == null ||
    (sourceMask['alphaMaskEnabled'] !== undefined && typeof sourceMask['alphaMaskEnabled'] !== 'boolean')
  ) {
    return false;
  }
  const sourceLayerId = sourceLayerOwner.descriptor.layer.id;

  if (targets.some(target =>
    target.ctx.irCompositionId !== sourceLayerOwner.ctx.irCompositionId ||
    target.descriptor.layer.id === sourceLayerId ||
    target.descriptor.layer.matte != null,
  )) {
    return false;
  }
  const mode = sourceMask['alphaMaskEnabled'] === true ? IRMatteMode.Alpha : IRMatteMode.Geometry;

  for (const target of targets) {
    target.descriptor.layer.matte = {
      sourceLayerId,
      mode,
      ...(target.inverted && { inverted: true }),
    };
    delete target.descriptor.preservedData.mask;
  }
  delete sourceLayerOwner.descriptor.preservedData.mask;

  return true;
}

function indexMaskOwnersBySourceItemId(compositions: GEMaskNormalizationComposition[]): Map<string, MaskOwner> {
  const ownerBySourceItemId = new Map<string, MaskOwner>();

  for (const composition of compositions) {
    for (const descriptor of composition.descriptors) {
      for (const sourceItemId of descriptor.preservedData.sourceItemIds ?? [descriptor.itemId]) {
        ownerBySourceItemId.set(sourceItemId, { descriptor, ctx: composition.ctx });
      }
    }
  }

  return ownerBySourceItemId;
}

function readMaskReferences(mask: Record<string, unknown>): ParsedGEMaskReference[] {
  const references: ParsedGEMaskReference[] = [];

  if (Array.isArray(mask['references'])) {
    for (const reference of mask['references']) {
      if (!isRecord(reference)) {
        continue;
      }
      const referenceId = resolveDataPathId(reference['mask']);

      if (referenceId != null && !references.some(item => item.componentId === referenceId)) {
        references.push({ componentId: referenceId, inverted: readBoolean(reference['inverted']) });
      }
    }
  }

  return references;
}

function readBoolean(value: unknown): boolean | undefined {
  return value === undefined || value === false ? false : value === true ? true : undefined;
}

function resolveTargetItemId(descriptor: RawLayerDescriptor, ctx: GESceneContext): string | undefined {
  const sourceComponentId = descriptor.preservedData.sourceComponentId;
  const sourceComponent = sourceComponentId == null ? undefined : ctx.componentById.get(sourceComponentId);

  return resolveDataPathId(sourceComponent?.['item']) ?? descriptor.itemId;
}

function isItemAtOrBelowOwner(itemId: string, owner: RawLayerDescriptor, ctx: GESceneContext): boolean {
  const ownerItemIds = new Set(owner.preservedData.sourceItemIds ?? [owner.itemId]);
  let currentItemId: string | undefined = itemId;
  const visited = new Set<string>();

  while (currentItemId != null && !visited.has(currentItemId)) {
    if (ownerItemIds.has(currentItemId)) {
      return true;
    }
    visited.add(currentItemId);
    const item = ctx.itemById.get(currentItemId);

    currentItemId = typeof item?.['parentId'] === 'string' ? item['parentId'] : undefined;
  }

  return false;
}

function isCompositionReachable(
  compositionId: string,
  targetCompositionId: string,
  compositionByIRId: ReadonlyMap<string, GEMaskNormalizationComposition>,
  visited = new Set<string>(),
): boolean {
  if (compositionId === targetCompositionId) {
    return true;
  }
  if (visited.has(compositionId)) {
    return false;
  }
  visited.add(compositionId);
  const composition = compositionByIRId.get(compositionId);

  return composition?.descriptors.some(descriptor =>
    descriptor.layer.type === 'precomp' && isCompositionReachable(
      descriptor.layer.content.compositionId,
      targetCompositionId,
      compositionByIRId,
      visited,
    ),
  ) === true;
}

function parseMaskSource(
  sourceComponent: Record<string, unknown>,
  sourceItemId: string,
  ownerLayer: IRLayer,
  ctx: GESceneContext,
  ratio: number | undefined,
  referencedCtx: GESceneContext | undefined,
): ParsedMaskSource | undefined {
  const sourceMask = sourceComponent['mask'];
  const sourceItem = ctx.itemById.get(sourceItemId);

  if (
    sourceComponent['dataType'] !== DataType.ShapeComponent ||
    !isRecord(sourceMask) ||
    sourceMask['isMask'] !== true ||
    sourceMask['alphaMaskEnabled'] === true ||
    sourceItem == null ||
    ratio == null ||
    typeof sourceItem['parentId'] !== 'string' ||
    !hasStaticIdentityMaskTransform(sourceItem) ||
    !hasMatchingMaskTiming(sourceItemId, sourceItem['parentId'], ctx)
  ) {
    return undefined;
  }
  const position = readVector2((sourceItem['transform'] as Record<string, unknown> | undefined)?.['position'], [0, 0]);

  if (position == null) {
    return undefined;
  }
  const coordinateOrigin = getMaskCoordinateOrigin(ownerLayer, referencedCtx);
  const centerX = coordinateOrigin[0] + position[0] / ratio;
  const centerY = coordinateOrigin[1] - position[1] / ratio;
  const path = parseMaskPath(sourceComponent, centerX, centerY, ratio);

  return path == null
    ? undefined
    : { sourceItemId, path };
}

function hasStaticIdentityMaskTransform(item: Record<string, unknown>): boolean {
  const transform = item['transform'];

  if (!isRecord(transform)) {
    return true;
  }

  return isMaskPlanePosition(transform['position']) &&
    isVector(transform['scale'], [1, 1, 1]) &&
    isVector(transform['eulerHint'], [0, 0, 0]) &&
    isVector(transform['anchor'], [0, 0]);
}

function isMaskPlanePosition(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const x = readFiniteNumber(value['x']);
  const y = readFiniteNumber(value['y']);
  const z = readFiniteNumber(value['z']) ?? 0;

  return x != null && y != null && nearlyEqual(z, 0);
}

function hasMatchingMaskTiming(sourceItemId: string, ownerItemId: string, ctx: GESceneContext): boolean {
  const sourceItem = ctx.itemById.get(sourceItemId);
  const ownerItem = ctx.itemById.get(ownerItemId);
  const sourceTimeline = parseTimeline(sourceItemId, ctx);
  const ownerTimeline = parseTimeline(ownerItemId, ctx);

  if (hasAnimationPayload(sourceTimeline?.transformAsset)) {
    return false;
  }
  const sourceDelay = sourceTimeline?.delay ?? readFiniteNumber(sourceItem?.['delay']) ?? 0;
  const ownerDelay = ownerTimeline?.delay ?? readFiniteNumber(ownerItem?.['delay']) ?? 0;
  const sourceDuration = sourceTimeline?.duration ?? readFiniteNumber(sourceItem?.['duration']) ?? 0;
  const ownerDuration = ownerTimeline?.duration ?? readFiniteNumber(ownerItem?.['duration']) ?? 0;

  return nearlyEqual(sourceDelay, ownerDelay) && nearlyEqual(sourceDuration, ownerDuration);
}

function hasAnimationPayload(value: Record<string, unknown> | undefined): boolean {
  return value != null && [
    value['positionOverLifetime'], value['rotationOverLifetime'], value['sizeOverLifetime'],
  ].some(entry => isRecord(entry) && Object.keys(entry).length > 0);
}

function getMaskCoordinateOrigin(layer: IRLayer, referencedCtx: GESceneContext | undefined): [number, number] {
  if (layer.type === 'precomp') {
    const bounds = layer.localBounds ?? (referencedCtx == null
      ? undefined
      : { x: 0, y: 0, width: referencedCtx.width, height: referencedCtx.height });

    if (bounds != null) {
      return [
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      ];
    }
  }
  const anchor = layer.transform?.anchor?.value;

  return Array.isArray(anchor) && anchor.length >= 2 ? [anchor[0], anchor[1]] : [0, 0];
}

function parseMaskPath(
  component: Record<string, unknown>,
  centerX: number,
  centerY: number,
  ratio: number,
): IRMask['path'] | undefined {
  if (component['type'] === ShapePrimitiveType.Rectangle) {
    return parseRectangleMaskPath(component, centerX, centerY, ratio);
  }
  if (component['type'] === ShapePrimitiveType.Custom) {
    return parseCustomMaskPath(component, centerX, centerY, ratio);
  }

  return undefined;
}

function parseRectangleMaskPath(
  component: Record<string, unknown>,
  centerX: number,
  centerY: number,
  ratio: number,
): IRMask['path'] | undefined {
  const width = readFiniteNumber(component['width']);
  const height = readFiniteNumber(component['height']);
  const roundness = component['roundness'];

  if (width == null || height == null || width < 0 || height < 0 || roundness !== undefined && roundness !== 0) {
    return undefined;
  }
  const halfWidth = width / ratio / 2;
  const halfHeight = height / ratio / 2;
  const points = [
    { x: centerX - halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY - halfHeight },
    { x: centerX + halfWidth, y: centerY + halfHeight },
    { x: centerX - halfWidth, y: centerY + halfHeight },
  ];
  const tangents = points.map(() => ({ x: 0, y: 0 }));

  return { points, inTangents: tangents, outTangents: tangents.map(tangent => ({ ...tangent })), closed: true };
}

function parseCustomMaskPath(
  component: Record<string, unknown>,
  centerX: number,
  centerY: number,
  ratio: number,
): IRMask['path'] | undefined {
  const points = component['points'];
  const easingIns = component['easingIns'];
  const easingOuts = component['easingOuts'];
  const shapes = component['shapes'];

  if (!Array.isArray(points) || !Array.isArray(easingIns) || !Array.isArray(easingOuts) || !Array.isArray(shapes)) {
    return undefined;
  }
  if (shapes.length !== 1 || !isRecord(shapes[0]) || shapes[0]['close'] !== true) {
    return undefined;
  }
  const indexes = shapes[0]['indexes'];

  if (!Array.isArray(indexes) || indexes.length === 0) {
    return undefined;
  }
  const IRPoints: IRMask['path']['points'] = [];
  const IRInTangents: IRMask['path']['inTangents'] = [];
  const IROutTangents: IRMask['path']['outTangents'] = [];

  for (const index of indexes) {
    if (!isRecord(index)) {
      return undefined;
    }
    const point = readIndexedVector(points, index['point']);
    const easingIn = readIndexedVector(easingIns, index['easingIn']);
    const easingOut = readIndexedVector(easingOuts, index['easingOut']);

    if (point == null || easingIn == null || easingOut == null) {
      return undefined;
    }
    IRPoints.push({ x: centerX + point[0] / ratio, y: centerY - point[1] / ratio });
    IRInTangents.push({ x: easingIn[0] / ratio, y: -easingIn[1] / ratio });
    IROutTangents.push({ x: easingOut[0] / ratio, y: -easingOut[1] / ratio });
  }

  return { points: IRPoints, inTangents: IRInTangents, outTangents: IROutTangents, closed: true };
}

function readIndexedVector(values: unknown[], index: unknown): [number, number] | undefined {
  return Number.isInteger(index) && typeof index === 'number' ? readVector2(values[index]) : undefined;
}

function readVector2(value: unknown, fallback?: [number, number]): [number, number] | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const x = readFiniteNumber(value['x']);
  const y = readFiniteNumber(value['y']);

  return x == null || y == null ? undefined : [x, y];
}

function isVector(value: unknown, expected: [number, number] | [number, number, number]): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const keys = ['x', 'y', 'z'] as const;

  return expected.every((expectedValue, index) => {
    const valueAtAxis = value[keys[index]];

    return typeof valueAtAxis === 'number' && nearlyEqual(valueAtAxis, expectedValue);
  });
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6;
}

function descriptorContainsAnyItem(descriptor: RawLayerDescriptor, itemIds: ReadonlySet<string>): boolean {
  return (descriptor.preservedData.sourceItemIds ?? [descriptor.itemId]).some(itemId => itemIds.has(itemId));
}

function createUnsupportedMaskDiagnostic(
  descriptor: RawLayerDescriptor,
  code: string,
  feature: string,
  message: string,
  field?: string,
): ConversionDiagnostic {
  const path = `$.components[item=${JSON.stringify(descriptor.itemId)}].mask`;

  return {
    code,
    severity: 'warning',
    action: 'unsupported',
    path: field == null ? path : `${path}.${field}`,
    sourceId: descriptor.layer.id,
    feature,
    message,
  };
}

import { IREndBehavior, type IRColor } from '@galacean/animation-ir';
import { resolveIRResourceUrl, type ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { DataType, type DataPath, type EndBehavior, type SceneBindingData } from '@galacean/effects-specification';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import { get2dTo3dRatio } from '../../common/coordinate-mapping';
import { buildSceneCollectionIndex, resolveDataPath, resolveDataPathId } from '../../common/data-path';
import { mapEndBehaviorToIR } from '../mapping';
import type { GEAssetRegistry, GEToIROptions, GESceneContext } from '../types';

export function buildSceneContext(
  scene: Record<string, unknown>,
  options: GEToIROptions,
  compositionId = scene['compositionId'] as string,
  compositionIdBySourceId: ReadonlyMap<string, string> = new Map(),
  compositionStartFrameBySourceId: ReadonlyMap<string, number> = new Map(),
  assetRegistry: GEAssetRegistry = createGEAssetRegistry(),
  diagnostics: ConversionDiagnostic[] = [],
): GESceneContext {
  const compositions = scene['compositions'] as Record<string, unknown>[];
  const composition = compositions?.find(candidate => candidate['id'] === compositionId);

  if (composition == null) {
    throw new Error(`[ge2ir] composition not found for id: ${compositionId}`);
  }

  const previewSize = composition['previewSize'] as [number, number] | undefined;
  const width = previewSize?.[0] ?? 512;
  const height = previewSize?.[1] ?? 512;
  const duration = (composition['duration'] as number) ?? 1;
  const compositionStartTime = (composition['startTime'] as number) ?? 0;
  const frameRate = options.frameRate;
  const ratio = get2dTo3dRatio(width, height);

  const inPoint = compositionStartTime * frameRate;
  // Preserve fractional frames because GE durations need not end on a frame boundary.
  const outPoint = (compositionStartTime + duration) * frameRate;

  const endBehavior =
    mapEndBehaviorToIR(composition['endBehavior'] as EndBehavior | undefined) ?? IREndBehavior.Loop;

  let backgroundColor: IRColor | undefined;
  const background = composition['background'] as Record<string, unknown> | undefined;

  if (background != null) {
    const color = background['color'] as number[] | undefined;

    if (color != null && color.length >= 4) {
      backgroundColor = [color[0], color[1], color[2], color[3]];
    }
  }

  const compositionName = typeof composition['name'] === 'string' ? composition['name'] : undefined;

  const items = scene['items'] as Record<string, unknown>[] | undefined;
  const components = scene['components'] as Record<string, unknown>[] | undefined;
  const miscs = scene['miscs'] as Record<string, unknown>[] | undefined;
  const images = scene['images'] as Record<string, unknown>[] | undefined;
  const textures = scene['textures'] as Record<string, unknown>[] | undefined;
  const fonts = scene['fonts'] as Record<string, unknown>[] | undefined;

  const itemById = buildSceneCollectionIndex(items);
  const componentById = buildSceneCollectionIndex(components);
  const miscById = buildSceneCollectionIndex(miscs);
  const imageById = buildSceneCollectionIndex(images);
  const textureById = buildSceneCollectionIndex(textures);
  const fontDefinitionByFamily = buildFontDefinitionIndex(fonts);

  const itemIdToTrackId = buildSceneBindings(componentById, miscById, composition);
  const [majorVersion, minorVersion] = String(scene['version'] ?? '3.6').split('.').map(Number);

  for (const [parentId, parent] of itemById) {
    const children = parent['children'];

    if (!Array.isArray(children)) {
      continue;
    }
    for (const reference of children) {
      const childId = resolveDataPathId(reference);
      const child = childId == null ? undefined : itemById.get(childId);

      if (childId != null && child != null) {
        itemById.set(childId, { ...child, parentId });
      }
    }
  }

  return {
    diagnostics,
    compositionId,
    irCompositionId: compositionIdBySourceId.get(compositionId) ?? compositionId,
    compositionIdBySourceId,
    compositionStartFrameBySourceId,
    compositionStartTime,
    resourceBaseUrl: options.resourceBaseUrl == null
      ? undefined
      : resolveIRResourceUrl(options.resourceBaseUrl),
    width,
    height,
    frameRate,
    ratio,
    textScaleIncludesSize: majorVersion < 3 || (majorVersion === 3 && minorVersion < 7),
    duration,
    inPoint,
    outPoint,
    compositionName,
    ...(isRecord(composition['camera']) && { camera: normalizeJSONValue(composition['camera']) }),
    endBehavior,
    backgroundColor,
    itemById,
    componentById,
    miscById,
    imageById,
    textureById,
    imageAssetById: assetRegistry.imageAssetById,
    imageAssetIdBySourceId: assetRegistry.imageAssetIdBySourceId,
    fontDefinitionByFamily,
    fontAssetById: assetRegistry.fontAssetById,
    fontAssetIdByIdentity: assetRegistry.fontAssetIdByIdentity,
    itemIdToTrackId,
  };
}

function createGEAssetRegistry(): GEAssetRegistry {
  return {
    imageAssetById: new Map(),
    imageAssetIdBySourceId: new Map(),
    fontAssetById: new Map(),
    fontAssetIdByIdentity: new Map(),
  };
}

function buildFontDefinitionIndex(fonts: Record<string, unknown>[] | undefined): Map<string, Record<string, unknown>> {
  const fontDefinitionByFamily = new Map<string, Record<string, unknown>>();

  for (const font of fonts ?? []) {
    const family = typeof font['fontFamily'] === 'string' ? font['fontFamily'] : font['family'];

    if (typeof family === 'string' && family !== '' && !fontDefinitionByFamily.has(family)) {
      fontDefinitionByFamily.set(family, font);
    }
  }

  return fontDefinitionByFamily;
}

function buildSceneBindings(
  componentById: Map<string, Record<string, unknown>>,
  miscById: Map<string, Record<string, unknown>>,
  composition: Record<string, unknown>,
): Map<string, string> {
  const trackIdByItemId = new Map<string, string>();
  const compositionComponent = findCompositionComponent(componentById, composition);

  if (compositionComponent == null) {
    return trackIdByItemId;
  }

  const bindings = compositionComponent['sceneBindings'] as SceneBindingData[] | undefined;

  if (bindings == null) {
    return trackIdByItemId;
  }

  for (const binding of bindings) {
    const trackId = resolveDataPathId(binding.key);
    const itemId = resolveDataPathId(binding.value);

    if (trackId != null && itemId != null) {
      trackIdByItemId.set(itemId, trackId);
    }
  }

  return trackIdByItemId;
}

function findCompositionComponent(
  componentById: Map<string, Record<string, unknown>>,
  composition: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const componentReferences = composition['components'] as DataPath[] | undefined;

  if (componentReferences == null || componentReferences.length === 0) {
    return undefined;
  }

  for (const componentReference of componentReferences) {
    const component = resolveDataPath(componentById, componentReference);

    if (component?.['dataType'] === DataType.CompositionComponent) {
      return component;
    }
  }

  return undefined;
}

export function getCompositionItemIds(
  scene: Record<string, unknown>,
  compositionId = scene['compositionId'] as string,
): string[] {
  const compositions = scene['compositions'] as Record<string, unknown>[];
  const composition = compositions?.find(candidate => candidate['id'] === compositionId);

  if (composition == null) {
    return [];
  }

  const componentById = buildSceneCollectionIndex(scene['components'] as Record<string, unknown>[] | undefined);
  const compositionComponent = findCompositionComponent(componentById, composition);

  if (Array.isArray(composition['children'])) {
    const itemById = buildSceneCollectionIndex(scene['items'] as Record<string, unknown>[] | undefined);
    const ids: string[] = [];
    const visited = new Set<string>();
    const pending: unknown[] = (composition['children'] as unknown[]).toReversed();

    while (pending.length > 0) {
      const id = resolveDataPathId(pending.pop());

      if (id == null || visited.has(id)) {
        continue;
      }
      visited.add(id);
      ids.push(id);
      const children = itemById.get(id)?.['children'];

      if (Array.isArray(children)) {
        pending.push(...(children as unknown[]).toReversed());
      }
    }

    const bindings = compositionComponent?.['sceneBindings'] as SceneBindingData[] | undefined;
    const itemIdByTrackId = new Map((bindings ?? []).map(binding => [binding.key.id, binding.value.id]));
    const miscs = buildSceneCollectionIndex(scene['miscs'] as Record<string, unknown>[] | undefined);
    const timeline = resolveDataPath(miscs, compositionComponent?.['timelineAsset']);
    const tracks = timeline?.['tracks'];
    const orderedIds = Array.isArray(tracks) ? tracks.flatMap(reference => {
      const trackId = resolveDataPathId(reference);
      const itemId = trackId == null ? undefined : itemIdByTrackId.get(trackId);

      return itemId != null && visited.has(itemId) ? [itemId] : [];
    }) : [];
    const trackedIds = new Set(orderedIds);
    let trackedIndex = 0;

    // Timeline-bound Items keep painter order even when parenting groups their tree nodes.
    return ids.map(id => trackedIds.has(id) ? orderedIds[trackedIndex++] : id);
  }

  if (compositionComponent == null) {
    return [];
  }

  const itemReferences = compositionComponent['items'] as DataPath[] | undefined;

  if (itemReferences == null) {
    return [];
  }

  return itemReferences.map(itemReference => itemReference.id).filter((id): id is string => typeof id === 'string');
}

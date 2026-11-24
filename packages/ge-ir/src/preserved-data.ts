import type { IRColor, IRScene } from '@galacean/animation-ir';
import { DataType, EndBehavior } from '@galacean/effects-specification';

export const GE_PRESERVED_DATA_VERSION = '1.0.0';

export type EffectsSpriteSplit = [sourceX: number, sourceY: number, width: number, height: number, flip: 0 | 1];

export interface EffectsTextureSheetAnimation {
  row: number;
  col: number;
  total?: number;
  animate: boolean;
  loop?: boolean;
}

export type EffectsTextSizeMode = 'auto-width' | 'auto-height' | 'fixed';

export type GEParticleAuthoringBounds = [x: number, y: number, width: number, height: number];
interface GEParticleEffectGroupSourceData {
  id: string;
  irCompositionId: string;
  sourcePreviewSize: [width: number, height: number];
  authoringBounds: GEParticleAuthoringBounds;
  authoringBoundsSource?: 'source_preview' | 'authored' | 'reviewed_multiframe_playback';
}

export interface GEParticleSourceLayerData {
  effectGroupId: string;
  irCompositionId: string;
  irLayerId: string;
  sourceOrder: number;
}

export interface GEParticleSourceData {
  particleEffectGroups: GEParticleEffectGroupSourceData[];
  layers: GEParticleSourceLayerData[];
}

/** GE Layer payloads that normalized Animation IR cannot represent losslessly. */
export interface EffectsLayerPreservedData {
  positionOverLifetime?: Record<string, unknown>;
  rotationOverLifetime?: Record<string, unknown>;
  sizeOverLifetime?: Record<string, unknown>;
  transformBaseScale?: [number, number, number];
  colorOverLifetime?: Record<string, unknown>;
  spriteStartColor?: IRColor;
  spriteTexture?: { image: Record<string, unknown>; texture: Record<string, unknown> };
  renderer?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
  componentTimeline?: { root: { id: string }; objects: Record<string, unknown>[] };
  spriteSplits?: EffectsSpriteSplit[];
  textureSheetAnimation?: EffectsTextureSheetAnimation;
  textSizeMode?: EffectsTextSizeMode;
  sourceItemIds?: string[];
  itemAnchorById?: Record<string, [x: number, y: number]>;
  itemEulerHintById?: Record<string, [x: number, y: number, z: number]>;
  sourceComponentId?: string;
  /** Additional runtime components owned by the source item, such as FFD or AnimationComponent. */
  additionalComponentIds?: string[];
  /** Parent outside the editable IR graph. */
  runtimeParentId?: string;
  mask?: Record<string, unknown>;
  precompContent?: Record<string, unknown>;
  /** GE ParticleSystem payload excluding identity and generic mask fields; normalized IR fields override it on export. */
  particleContent?: Record<string, unknown>;
  /** Activation clip behavior retained independently from the normalized GE Item behavior. */
  timelineEndBehavior?: EndBehavior;
  itemTiming?: { delay: number; duration: number };
  sourceHierarchy?: 'single-item' | 'null-sprite-pair';
}

export interface GECompositionSourceBinding {
  /** Original GE Composition ID. */
  sourceCompositionId: string;
  camera?: Record<string, unknown>;
  /** CompositionComponent Item IDs in source painter order. */
  sourceItemOrder: string[];
  /** GE-only items and composition components restored from sourceScene. */
  runtimeItemIds?: string[];
  runtimeComponentIds?: string[];
  /** IR Layer ID -> GE-owned Layer data. */
  layerDataById: Record<string, EffectsLayerPreservedData>;
}

/**
 * GE-owned data retained outside Animation IR; keep it paired with the Scene returned by convertGEToIR.
 * Use updateGEToIRPreservedData to reconcile IR edits instead of modifying this adapter-owned structure directly.
 */
export interface GEToIRPreservedData {
  version: typeof GE_PRESERVED_DATA_VERSION;
  /** One normalized copy used to restore GE objects outside regenerated graphs. */
  sourceScene?: Record<string, unknown>;
  /** Imported IR Composition ID -> source GE Composition. */
  compositionBindings: Record<string, GECompositionSourceBinding>;
  /** ParticleSystem bindings and source layout used by final host placement. */
  particleSourceData: GEParticleSourceData;
}

/** Reject preserved data whose version or Composition bindings do not match the supplied IR Scene. */
export function assertGEToIRPreservedDataMatchesScene(scene: IRScene, preservedData: GEToIRPreservedData): void {
  if (preservedData.version !== GE_PRESERVED_DATA_VERSION) {
    throw new TypeError(`[ge-ir:preserved-data] Unsupported preserved data version '${String(preservedData.version)}'.`);
  }
  if (!isRecord(preservedData.compositionBindings)) {
    throw new TypeError('[ge-ir:preserved-data] compositionBindings must be an object.');
  }
  if (preservedData.sourceScene !== undefined && !isRecord(preservedData.sourceScene)) {
    throw new TypeError('[ge-ir:preserved-data] sourceScene must be an object when present.');
  }
  assertGEParticleSourceData(preservedData.particleSourceData);
  const compositionIdSet = new Set(scene.compositions.map(composition => composition.id));
  const compositionById = new Map(scene.compositions.map(composition => [composition.id, composition] as const));
  const sourceCompositionIdSet = new Set<string>();

  for (const [compositionId, binding] of Object.entries(preservedData.compositionBindings)) {
    if (!compositionIdSet.has(compositionId)) {
      throw new TypeError(
        `[ge-ir:preserved-data] Composition binding '${compositionId}' does not exist in the IR Scene.`,
      );
    }
    if (
      !isRecord(binding) ||
      typeof binding['sourceCompositionId'] !== 'string' ||
      binding['sourceCompositionId'].length === 0
    ) {
      throw new TypeError(`[ge-ir:preserved-data] Composition binding '${compositionId}' is invalid.`);
    }
    if (binding['camera'] !== undefined && !isRecord(binding['camera'])) {
      throw new TypeError(`[ge-ir:preserved-data] Composition binding '${compositionId}' camera must be an object.`);
    }
    for (const field of ['runtimeItemIds', 'runtimeComponentIds']) {
      const ids = binding[field];

      if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') ||
        preservedData.sourceScene == null)) {
        throw new TypeError(`[ge-ir:preserved-data] ${field} requires string IDs and sourceScene.`);
      }
    }
    if (!isRecord(binding['layerDataById'])) {
      throw new TypeError(
        `[ge-ir:preserved-data] Composition binding '${compositionId}' layerDataById must be an object.`,
      );
    }
    if (
      !Array.isArray(binding['sourceItemOrder']) ||
      binding['sourceItemOrder'].some(itemId => typeof itemId !== 'string')
    ) {
      throw new TypeError(
        `[ge-ir:preserved-data] Composition binding '${compositionId}' sourceItemOrder must be an array of strings.`,
      );
    }
    if (sourceCompositionIdSet.has(binding['sourceCompositionId'])) {
      throw new TypeError(
        `[ge-ir:preserved-data] Source Composition '${binding['sourceCompositionId']}' is bound more than once.`,
      );
    }
    sourceCompositionIdSet.add(binding['sourceCompositionId']);

    const layerIdSet = new Set(compositionById.get(compositionId)?.layers.map(layer => layer.id) ?? []);

    for (const [layerId, layerData] of Object.entries(binding['layerDataById'])) {
      if (!layerIdSet.has(layerId)) {
        throw new TypeError(
          `[ge-ir:preserved-data] Layer data '${compositionId}/${layerId}' does not exist in the IR Scene.`,
        );
      }
      assertEffectsLayerPreservedData(layerData, compositionId, layerId);
    }
  }

  for (const layerBinding of preservedData.particleSourceData.layers) {
    const particleLayer = compositionById.get(layerBinding.irCompositionId)?.layers.find(
      layer => layer.id === layerBinding.irLayerId,
    );

    if (particleLayer?.type !== 'particle') {
      throw new TypeError(
        `[ge-ir:preserved-data] Particle source Layer '${layerBinding.irCompositionId}/` +
          `${layerBinding.irLayerId}' does not reference an IR Particle Layer.`,
      );
    }
  }
}

function assertGEParticleSourceData(value: unknown): asserts value is GEParticleSourceData {
  if (!isRecord(value) || !Array.isArray(value['particleEffectGroups']) || !Array.isArray(value['layers'])) {
    throw new TypeError(
      '[ge-ir:preserved-data] particleSourceData.particleEffectGroups and layers must be arrays.',
    );
  }

  const groupCompositionIdById = new Map<string, string>();

  for (const [index, group] of value.particleEffectGroups.entries()) {
    const path = `particleSourceData.particleEffectGroups[${index}]`;

    if (!isRecord(group)) {
      throw new TypeError(`[ge-ir:preserved-data] ${path} must be an object.`);
    }
    const id = group['id'];
    const irCompositionId = group['irCompositionId'];

    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.id must be a non-empty string.`);
    }
    if (typeof irCompositionId !== 'string' || irCompositionId.length === 0) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.irCompositionId must be a non-empty string.`);
    }
    if (!isPositiveSize(group['sourcePreviewSize'])) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.sourcePreviewSize must be a positive finite size.`);
    }
    if (!isAuthoringBounds(group['authoringBounds'], group['sourcePreviewSize'])) {
      throw new TypeError(
        `[ge-ir:preserved-data] ${path}.authoringBounds must be a positive rectangle inside sourcePreviewSize.`,
      );
    }
    if (group['authoringBoundsSource'] != null &&
      !['source_preview', 'authored', 'reviewed_multiframe_playback'].includes(String(group['authoringBoundsSource']))) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.authoringBoundsSource is invalid.`);
    }
    if (groupCompositionIdById.has(id)) {
      throw new TypeError(`[ge-ir:preserved-data] Particle effect group '${id}' is defined more than once.`);
    }
    groupCompositionIdById.set(id, irCompositionId);
  }

  const layerIdsByComposition = new Map<string, Set<string>>();
  const sourceOrdersByGroup = new Map<string, Set<number>>();
  const referencedGroupIds = new Set<string>();

  for (const [index, layer] of value.layers.entries()) {
    const path = `particleSourceData.layers[${index}]`;

    if (!isRecord(layer)) {
      throw new TypeError(`[ge-ir:preserved-data] ${path} must be an object.`);
    }
    const effectGroupId = layer['effectGroupId'];
    const irCompositionId = layer['irCompositionId'];
    const irLayerId = layer['irLayerId'];

    if (typeof effectGroupId !== 'string' || effectGroupId.length === 0) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.effectGroupId must be a non-empty string.`);
    }
    if (typeof irCompositionId !== 'string' || irCompositionId.length === 0) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.irCompositionId must be a non-empty string.`);
    }
    if (typeof irLayerId !== 'string' || irLayerId.length === 0) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.irLayerId must be a non-empty string.`);
    }
    if (!isNonNegativeSafeInteger(layer['sourceOrder'])) {
      throw new TypeError(`[ge-ir:preserved-data] ${path}.sourceOrder must be a non-negative safe integer.`);
    }

    const groupCompositionId = groupCompositionIdById.get(effectGroupId);

    if (groupCompositionId == null) {
      throw new TypeError(`[ge-ir:preserved-data] ${path} references unknown effect group '${effectGroupId}'.`);
    }
    if (groupCompositionId !== irCompositionId) {
      throw new TypeError(`[ge-ir:preserved-data] ${path} must use the same IR Composition as its effect group.`);
    }

    const compositionLayerIds = layerIdsByComposition.get(irCompositionId) ?? new Set<string>();
    const groupSourceOrders = sourceOrdersByGroup.get(effectGroupId) ?? new Set<number>();

    if (compositionLayerIds.has(irLayerId)) {
      throw new TypeError(
        `[ge-ir:preserved-data] Particle source Layer '${irCompositionId}/${irLayerId}' is bound more than once.`,
      );
    }
    if (groupSourceOrders.has(layer['sourceOrder'])) {
      throw new TypeError(
        `[ge-ir:preserved-data] Particle effect group '${effectGroupId}' uses sourceOrder ` +
          `${String(layer['sourceOrder'])} more than once.`,
      );
    }
    compositionLayerIds.add(irLayerId);
    groupSourceOrders.add(layer['sourceOrder']);
    layerIdsByComposition.set(irCompositionId, compositionLayerIds);
    sourceOrdersByGroup.set(effectGroupId, groupSourceOrders);
    referencedGroupIds.add(effectGroupId);
  }

  for (const groupId of groupCompositionIdById.keys()) {
    if (!referencedGroupIds.has(groupId)) {
      throw new TypeError(`[ge-ir:preserved-data] Particle effect group '${groupId}' has no ParticleSystem binding.`);
    }
  }
}

function assertEffectsLayerPreservedData(value: unknown, compositionId: string, layerId: string): void {
  const path = `${compositionId}/${layerId}`;

  if (!isRecord(value)) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}' must be an object.`);
  }

  for (const field of [
    'positionOverLifetime', 'rotationOverLifetime', 'sizeOverLifetime', 'colorOverLifetime', 'mask',
    'precompContent', 'particleContent', 'renderer', 'geometry', 'componentTimeline', 'spriteTexture', 'itemTiming',
  ]) {
    if (value[field] !== undefined && !isRecord(value[field])) {
      throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.${field}' must be an object.`);
    }
  }
  const baseScale = value['transformBaseScale'];

  if (baseScale !== undefined && (!Array.isArray(baseScale) || baseScale.length !== 3 ||
    baseScale.some(axis => typeof axis !== 'number' || !Number.isFinite(axis)))) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.transformBaseScale' must be a finite Vec3.`);
  }
  const itemTiming = value['itemTiming'];

  if (isRecord(itemTiming) && ['delay', 'duration'].some(field =>
    typeof itemTiming[field] !== 'number' || !Number.isFinite(itemTiming[field]),
  )) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.itemTiming' must contain finite timing values.`);
  }
  const timeline = value['componentTimeline'];

  if (isRecord(timeline) && (
    !isRecord(timeline['root']) || typeof timeline['root']['id'] !== 'string' ||
    !Array.isArray(timeline['objects']) || timeline['objects'].some(object =>
      !isRecord(object) || typeof object['id'] !== 'string' ||
      !Object.values(DataType).some(type => type === object['dataType']),
    )
  )) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.componentTimeline' must contain GE timeline objects.`);
  }
  const texture = value['spriteTexture'];

  if (isRecord(texture) && (!isRecord(texture['image']) || !isRecord(texture['texture']))) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.spriteTexture' must contain image and texture objects.`);
  }
  if (value['sourceComponentId'] !== undefined && typeof value['sourceComponentId'] !== 'string') {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.sourceComponentId' must be a string.`);
  }
  if (value['runtimeParentId'] !== undefined && typeof value['runtimeParentId'] !== 'string') {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.runtimeParentId' must be a string.`);
  }
  const additionalComponentIds = value['additionalComponentIds'];

  if (additionalComponentIds !== undefined && (!Array.isArray(additionalComponentIds) ||
    additionalComponentIds.some(id => typeof id !== 'string'))) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.additionalComponentIds' must contain string IDs.`);
  }
  if (value['timelineEndBehavior'] !== undefined && !isGEEndBehavior(value['timelineEndBehavior'])) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.timelineEndBehavior' is invalid.`);
  }
  if (value['spriteStartColor'] !== undefined && !isNormalizedColor(value['spriteStartColor'])) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.spriteStartColor' must be a normalized color.`);
  }
  if (
    value['spriteSplits'] !== undefined &&
    (!Array.isArray(value['spriteSplits']) || value['spriteSplits'].some(split => !isEffectsSpriteSplit(split)))
  ) {
    throw new TypeError(
      `[ge-ir:preserved-data] Layer data '${path}.spriteSplits' must contain valid split tuples.`,
    );
  }
  if (
    value['textureSheetAnimation'] !== undefined &&
    !isEffectsTextureSheetAnimation(value['textureSheetAnimation'])
  ) {
    throw new TypeError(
      `[ge-ir:preserved-data] Layer data '${path}.textureSheetAnimation' is invalid.`,
    );
  }
  if (
    value['sourceItemIds'] !== undefined &&
    (!Array.isArray(value['sourceItemIds']) || value['sourceItemIds'].some(itemId => typeof itemId !== 'string'))
  ) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.sourceItemIds' must be an array of strings.`);
  }
  if (
    value['itemAnchorById'] !== undefined &&
    (!isRecord(value['itemAnchorById']) || Object.values(value['itemAnchorById']).some(anchor => !isItemAnchor(anchor)))
  ) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.itemAnchorById' must contain finite vec2 values.`);
  }
  if (
    value['itemEulerHintById'] !== undefined &&
    (!isRecord(value['itemEulerHintById']) ||
      Object.values(value['itemEulerHintById']).some(eulerHint => !isItemEulerHint(eulerHint)))
  ) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.itemEulerHintById' must contain finite vec3 values.`);
  }
  if (
    value['sourceHierarchy'] !== undefined &&
    value['sourceHierarchy'] !== 'single-item' &&
    value['sourceHierarchy'] !== 'null-sprite-pair'
  ) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.sourceHierarchy' is invalid.`);
  }
  if (
    value['textSizeMode'] !== undefined &&
    value['textSizeMode'] !== 'auto-width' &&
    value['textSizeMode'] !== 'auto-height' &&
    value['textSizeMode'] !== 'fixed'
  ) {
    throw new TypeError(`[ge-ir:preserved-data] Layer data '${path}.textSizeMode' is invalid.`);
  }
}

function isGEEndBehavior(value: unknown): value is EndBehavior {
  return value === EndBehavior.destroy || value === EndBehavior.forward ||
    value === EndBehavior.freeze || value === EndBehavior.restart;
}

function isEffectsSpriteSplit(value: unknown): value is EffectsSpriteSplit {
  return Array.isArray(value) && value.length === 5 && value.slice(0, 4).every(isFiniteNumber) &&
    (value[4] === 0 || value[4] === 1);
}

function isEffectsTextureSheetAnimation(value: unknown): value is EffectsTextureSheetAnimation {
  return isRecord(value) && isPositiveSafeInteger(value['row']) && isPositiveSafeInteger(value['col']) &&
    (value['total'] === undefined || isPositiveSafeInteger(value['total'])) &&
    typeof value['animate'] === 'boolean' &&
    (value['loop'] === undefined || typeof value['loop'] === 'boolean');
}

function isItemAnchor(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}

function isItemEulerHint(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

function isNormalizedColor(value: unknown): value is IRColor {
  return Array.isArray(value) && value.length === 4 && value.every(channel => isFiniteNumber(channel) &&
    channel >= 0 && channel <= 1);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSize(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(entry => isFiniteNumber(entry) && entry > 0);
}

function isAuthoringBounds(value: unknown, previewSize: [number, number]): value is GEParticleAuthoringBounds {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber) &&
    value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0 &&
    value[0] + value[2] <= previewSize[0] && value[1] + value[3] <= previewSize[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

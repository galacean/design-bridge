import { IREndBehavior, type IRAnimatedProperty, type IRComposition, type IRLayer, type IRScene } from '@galacean/animation-ir';
import { getIRSceneEntryComposition, mapIRParticleScalarValues } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import { hexToIRColor, isHexEqual, isScalarEqual, isValidHexColor } from '../../common/utils';
import type { Composition, Layer } from '../../dsl/schema';
import { convertIRToDSL } from '../../ir2dsl/convert';
import type { IRToDSLLayerMapping } from '../../ir2dsl/types';
import { updateIRLayer } from './update-layer';
import { resolveSharedPrecompEdits } from './resolve-shared-edits';
import { updateLayerOrder } from './update-layer-order';
import type {
  DSLToIROptions, DSLToIRChangeReporter, DSLToIRWarning, DSLToIRWarningReporter,
} from '../types';

interface LayerEntry {
  layer: Layer;
  path: string;
}

interface LayerMatchContext {
  editedLayerById: Map<string, LayerEntry>;
  editedLayerByPath: Map<string, Layer>;
  matchedEditedLayerSet: Set<Layer>;
  baselineLayerIds: ReadonlySet<string>;
}

/** Apply previously validated DSL to a clone of the baseline IR. */
export function updateValidatedIRFromDSL(
  baselineScene: IRScene,
  editedDocument: Composition,
  layerMapping: IRToDSLLayerMapping,
  options: DSLToIROptions = {},
): IRScene {
  const reportWarning = createWarningReporter(options.onWarning);
  const reportChange = createChangeReporter(options.onChange);

  const baselineDSLResult = convertIRToDSL(baselineScene);
  const baselineDSL = baselineDSLResult.dsl;
  const editedDSL = structuredClone(editedDocument);
  const updatedScene = structuredClone(baselineScene);
  const updatedIR = getIRSceneEntryComposition(updatedScene);
  const compositionById = new Map(updatedScene.compositions.map(composition => [composition.id, composition] as const));
  const targetFrameRate = editedDSL.meta.fps;

  // Preserve independent source rates unless the document FPS is explicitly edited.
  if (!isScalarEqual(targetFrameRate, baselineDSL.meta.fps)) {
    const sourceFrameRates = new Map(baselineScene.compositions.map(composition =>
      [composition.id, composition.frameRate] as const,
    ));

    for (const composition of updatedScene.compositions) {
      for (const layer of composition.layers) {
        if (layer.type === 'precomp' && layer.time.sourceStartFrame != null) {
          const sourceFrameRate = sourceFrameRates.get(layer.content.compositionId);

          if (sourceFrameRate != null && !isScalarEqual(targetFrameRate, sourceFrameRate)) {
            layer.time.sourceStartFrame *= targetFrameRate / sourceFrameRate;
          }
        }
      }
      updateIRFrameRate(composition, targetFrameRate, reportChange, composition.id === updatedIR.id);
    }
  }
  updateIRComposition(updatedIR, editedDSL, baselineDSL, targetFrameRate, reportChange);

  const baselineLayers = collectLayersWithPaths(baselineDSL.layers);
  const baselineLayerIds = new Set(baselineLayers.map(entry => entry.layer.id));
  const editedLayerEntries = collectLayersWithPaths(editedDSL.layers);
  const editedLayers = editedLayerEntries.map(entry => entry.layer);
  const editedPathByLayer = new Map(editedLayerEntries.map(entry => [entry.layer, entry.path] as const));
  const editedLayerById = new Map<string, LayerEntry>();
  const editedLayerByPath = new Map<string, Layer>();

  for (const { layer, path } of editedLayerEntries) {
    const previousEntry = editedLayerById.get(layer.id);

    if (previousEntry != null) {
      throw new Error(
        `[dsl-ir:preserved-data] Duplicate layer id '${layer.id}'; earlier occurrence at path '${previousEntry.path}'.`,
      );
    }

    editedLayerById.set(layer.id, { layer, path });
    editedLayerByPath.set(path, layer);
  }

  const clonedLayerByIRId = new Map<string, IRLayer>();

  for (const layer of updatedIR.layers) {
    clonedLayerByIRId.set(layer.id, layer);
  }

  // Track object identity because edited IDs may have changed.
  const matchedEditedLayerSet = new Set<Layer>();
  const irLayerIdByEditedLayer = new Map<Layer, string>();
  const deletedIRLayerIdSet = new Set<string>();
  const deletedExpandedIRLayerIdsByCompositionId = new Map<string, Set<string>>();
  const semanticallyDeletedExpandedDSLIds = new Set<string>();

  resolveSharedPrecompEdits(baselineLayers.flatMap(({ layer, path }) => {
    const parentId = layerMapping.layers[layer.id]?.expandedSource?.parentLayerId;

    if (parentId != null && !editedLayerById.has(parentId)) {
      return [];
    }

    return [{ baseline: layer, path, edited: matchEditedLayer(layer, path, {
      editedLayerById, editedLayerByPath, matchedEditedLayerSet, baselineLayerIds,
    }) }];
  }), layerMapping, reportWarning);

  for (const { layer: baselineLayer, path } of baselineLayers) {
    const irLayerId = layerMapping.layers[baselineLayer.id]?.irLayerId;

    if (irLayerId == null) {
      continue;
    }

    const editedLayer = matchEditedLayer(baselineLayer, path, {
      editedLayerById,
      editedLayerByPath,
      matchedEditedLayerSet,
      baselineLayerIds,
    });

    if (editedLayer == null) {
      const expandedSource = layerMapping.layers[baselineLayer.id]?.expandedSource;

      if (expandedSource != null && !editedLayerById.has(expandedSource.parentLayerId)) {
        continue;
      }
      const expandedComposition = expandedSource != null
        ? compositionById.get(expandedSource.irCompositionId)
        : undefined;

      if (expandedSource != null && expandedComposition?.layers.some(layer => layer.id === irLayerId) === true) {
        const deletedIds = deletedExpandedIRLayerIdsByCompositionId.get(expandedSource.irCompositionId) ?? new Set();

        deletedIds.add(irLayerId);
        deletedExpandedIRLayerIdsByCompositionId.set(expandedSource.irCompositionId, deletedIds);
        semanticallyDeletedExpandedDSLIds.add(baselineLayer.id);
      } else {
        deletedIRLayerIdSet.add(irLayerId);
      }
      reportChange({ kind: 'layer', op: 'delete', layerId: baselineLayer.id });
      continue;
    }

    if (layerMapping.layers[baselineLayer.id]?.irCompositionId !== updatedIR.id ||
      layerMapping.layers[baselineLayer.id]?.expandedSource != null) {
      continue;
    }
    const irLayer = clonedLayerByIRId.get(irLayerId);

    if (irLayer == null) {
      continue;
    }

    matchedEditedLayerSet.add(editedLayer);
    irLayerIdByEditedLayer.set(editedLayer, irLayerId);
    updateIRLayer(
      irLayer,
      updatedScene,
      editedLayer,
      baselineLayer,
      path,
      targetFrameRate,
      reportWarning,
      reportChange,
    );
  }

  const expandedIRLayerIdByEditedLayer = new Map<Layer, string>();
  const editedExpandedCompositionById = new Map<string, IRComposition>();
  const updatedExpandedLayerKeys = new Set<string>();

  for (const editedLayer of editedLayers) {
    if (matchedEditedLayerSet.has(editedLayer)) {
      continue;
    }

    const expandedSource = layerMapping.layers[editedLayer.id]?.expandedSource;

    if (expandedSource != null) {
      const mappingEntry = layerMapping.layers[editedLayer.id];
      const targetComposition = compositionById.get(expandedSource.irCompositionId);
      const targetLayer = mappingEntry?.irLayerId != null
        ? targetComposition?.layers.find(layer => layer.id === mappingEntry.irLayerId)
        : undefined;

      if (targetComposition != null && targetLayer != null && mappingEntry?.irLayerId != null) {
        const key = JSON.stringify([targetComposition.id, mappingEntry.irLayerId]);

        if (deletedExpandedIRLayerIdsByCompositionId.get(targetComposition.id)?.has(mappingEntry.irLayerId) !== true) {
          updateIRLayer(
            targetLayer,
            updatedScene,
            editedLayer,
            buildExpandedBaselineLayer(editedLayer, expandedSource),
            editedPathByLayer.get(editedLayer) ?? '$.layers',
            targetComposition.frameRate,
            reportWarning,
            reportChange,
            !updatedExpandedLayerKeys.has(key),
          );
          updatedExpandedLayerKeys.add(key);
        }
        expandedIRLayerIdByEditedLayer.set(editedLayer, mappingEntry.irLayerId);
        editedExpandedCompositionById.set(expandedSource.irCompositionId, targetComposition);
      }

      continue;
    }

    const message = `[dsl-ir:preserved-data] edited layer '${editedLayer.id}' matches no baseline scene layer; new layers are not supported in this mode.`;

    reportWarning({
      code: 'INVENTED_LAYER',
      message,
      path: editedPathByLayer.get(editedLayer) ?? '$.layers',
      layerId: editedLayer.id,
    });
  }

  for (const [dslLayerId, mappingEntry] of Object.entries(layerMapping.layers)) {
    const expandedSource = mappingEntry.expandedSource;
    const irLayerId = mappingEntry.irLayerId;

    if (
      expandedSource == null ||
      irLayerId == null ||
      editedLayerById.has(dslLayerId) ||
      !editedLayerById.has(expandedSource.parentLayerId) ||
      semanticallyDeletedExpandedDSLIds.has(dslLayerId)
    ) {
      continue;
    }
    const composition = compositionById.get(expandedSource.irCompositionId);

    if (composition?.layers.some(layer => layer.id === irLayerId) !== true) {
      continue;
    }
    const deletedIds = deletedExpandedIRLayerIdsByCompositionId.get(expandedSource.irCompositionId) ?? new Set();

    deletedIds.add(irLayerId);
    deletedExpandedIRLayerIdsByCompositionId.set(expandedSource.irCompositionId, deletedIds);
    semanticallyDeletedExpandedDSLIds.add(dslLayerId);
    reportChange({ kind: 'layer', op: 'delete', layerId: dslLayerId });
  }

  removeIRLayers(updatedIR, deletedIRLayerIdSet, reportChange);
  for (const [compositionId, deletedLayerIds] of deletedExpandedIRLayerIdsByCompositionId) {
    const composition = compositionById.get(compositionId);

    if (composition != null) {
      removeIRLayers(composition, deletedLayerIds, reportChange);
    }
  }
  updateLayerOrder(
    updatedIR,
    editedDSL.layers,
    irLayerIdByEditedLayer,
    reportChange,
  );
  updateExpandedCompositionLayerOrder(
    editedDSL.layers,
    editedExpandedCompositionById,
    layerMapping,
    expandedIRLayerIdByEditedLayer,
    reportChange,
  );

  assertIRScene(updatedScene);

  return updatedScene;
}

function buildExpandedBaselineLayer(
  editedLayer: Layer,
  expandedSource: NonNullable<IRToDSLLayerMapping['layers'][string]['expandedSource']>,
): Layer {
  const baseline = expandedSource.baselineLayer;
  const transform = expandedSource.baselineTransform;

  if (baseline == null || transform == null) {
    return structuredClone(editedLayer);
  }

  const restored = {
    ...structuredClone(editedLayer),
    name: baseline.name,
    width: baseline.width,
    height: baseline.height,
    description: structuredClone(baseline.description),
    parent: baseline.parent,
    time_range: structuredClone(baseline.timeRange),
    position: structuredClone(transform.position),
    scale: structuredClone(transform.scale),
    rotation: structuredClone(transform.rotation),
    anchor: structuredClone(transform.anchor),
    opacity: structuredClone(transform.opacity),
    ...(baseline.text != null && { text: structuredClone(baseline.text) }),
    ...(baseline.asset != null && { asset: structuredClone(baseline.asset) }),
    ...(baseline.particle != null && { particle: structuredClone(baseline.particle) }),
  };

  if (baseline.type === 'text' && baseline.text != null) {
    return { ...restored, type: 'text', text: structuredClone(baseline.text) };
  }
  if (baseline.type === 'particle' && baseline.particle != null) {
    return { ...restored, type: 'particle', particle: structuredClone(baseline.particle) };
  }
  if (baseline.type === 'layer' && baseline.asset != null) {
    return { ...restored, type: 'layer', asset: structuredClone(baseline.asset) };
  }
  if (baseline.type === 'null') {
    return { ...restored, type: 'null' };
  }

  throw new TypeError('[dsl-ir:preserved-data] Expanded baseline layer is missing its required content.');
}

function updateExpandedCompositionLayerOrder(
  layers: Layer[],
  compositionById: ReadonlyMap<string, IRComposition>,
  layerMapping: IRToDSLLayerMapping,
  irLayerIdByEditedLayer: Map<Layer, string>,
  reportChange: DSLToIRChangeReporter,
): void {
  for (const layer of layers) {
    const children = layer.children ?? [];
    const firstExpandedSource = children
      .map(child => layerMapping.layers[child.id]?.expandedSource)
      .find(source => source != null);
    const targetComposition = firstExpandedSource != null
      ? compositionById.get(firstExpandedSource.irCompositionId)
      : undefined;

    if (targetComposition != null) {
      updateLayerOrder(
        targetComposition,
        children,
        irLayerIdByEditedLayer,
        reportChange,
        layer.id,
      );
    }
    updateExpandedCompositionLayerOrder(
      children,
      compositionById,
      layerMapping,
      irLayerIdByEditedLayer,
      reportChange,
    );
  }
}

function matchEditedLayer(baselineLayer: Layer, path: string, context: LayerMatchContext): Layer | undefined {
  const layerById = context.editedLayerById.get(baselineLayer.id)?.layer;

  if (layerById != null) {
    return layerById;
  }

  const layerByPath = context.editedLayerByPath.get(path);

  if (
    layerByPath != null &&
    !context.matchedEditedLayerSet.has(layerByPath) &&
    !context.baselineLayerIds.has(layerByPath.id) &&
    layerByPath.name === baselineLayer.name
  ) {
    return layerByPath;
  }

  return undefined;
}

function collectLayersWithPaths(layers: Layer[], prefix = '$.layers', entries: LayerEntry[] = []): LayerEntry[] {
  layers.forEach((layer, index) => {
    const path = `${prefix}[${index}]`;

    entries.push({ layer, path });
    collectLayersWithPaths(layer.children ?? [], `${path}.children`, entries);
  });

  return entries;
}

function createWarningReporter(onWarning: DSLToIROptions['onWarning']): DSLToIRWarningReporter {
  if (onWarning == null) {
    return () => {};
  }

  return ({ code, message, path, layerId }) => {
    const warning: DSLToIRWarning = { level: 'warning', code, message };

    if (path != null) {
      warning.path = path;
    }
    if (layerId != null) {
      warning.layerId = layerId;
    }

    onWarning(warning);
  };
}

function createChangeReporter(onChange: DSLToIROptions['onChange']): DSLToIRChangeReporter {
  if (onChange == null) {
    return () => {};
  }

  return change => {
    const normalizedChange = {
      kind: change.kind,
      op: change.op,
      ...(change.field != null && { field: change.field }),
      ...(change.layerId != null && { layerId: change.layerId }),
      ...(change.oldValue !== undefined && { oldValue: structuredClone(change.oldValue) }),
      ...(change.newValue !== undefined && { newValue: structuredClone(change.newValue) }),
      ...(change.note != null && { note: change.note }),
    };

    onChange(normalizedChange);
  };
}

function removeIRLayers(
  updatedIR: IRComposition,
  deletedIRLayerIdSet: Set<string>,
  reportChange: DSLToIRChangeReporter,
): void {
  if (deletedIRLayerIdSet.size === 0) {
    return;
  }

  updatedIR.layers = updatedIR.layers.filter(layer => !deletedIRLayerIdSet.has(layer.id));

  for (const layer of updatedIR.layers) {
    if (layer.parentId != null && deletedIRLayerIdSet.has(layer.parentId)) {
      delete layer.parentId;
      reportChange({ kind: 'layer', op: 'delete', field: 'parentId', layerId: layer.id });
    }
    if (layer.matte != null && deletedIRLayerIdSet.has(layer.matte.sourceLayerId)) {
      const previousMatte = layer.matte;

      delete layer.matte;
      reportChange({
        kind: 'layer',
        op: 'delete',
        field: 'matte',
        layerId: layer.id,
        oldValue: previousMatte,
      });
    }
  }
}

/** Scale frame-based IR timing so a frame-rate change preserves playback duration. */
function updateIRFrameRate(
  updatedIR: IRComposition,
  targetFrameRate: number,
  reportChange: DSLToIRChangeReporter,
  reportCompositionChange = true,
): void {
  const previousFrameRate = updatedIR.frameRate;

  if (isScalarEqual(targetFrameRate, previousFrameRate)) {
    return;
  }

  const frameRateScale = targetFrameRate / previousFrameRate;

  updatedIR.frameRate = targetFrameRate;
  updatedIR.inPoint *= frameRateScale;
  updatedIR.outPoint *= frameRateScale;

  for (const layer of updatedIR.layers) {
    layer.time.inFrame *= frameRateScale;
    layer.time.outFrame *= frameRateScale;
    reframeAnimatedProperty(layer.transform?.position, frameRateScale);
    reframeAnimatedProperty(layer.transform?.scale, frameRateScale);
    reframeAnimatedProperty(layer.transform?.rotation?.x, frameRateScale);
    reframeAnimatedProperty(layer.transform?.rotation?.y, frameRateScale);
    reframeAnimatedProperty(layer.transform?.rotation?.z, frameRateScale);
    reframeAnimatedProperty(layer.transform?.opacity, frameRateScale);
    if (layer.type === 'particle') {
      layer.content.startLifetime = mapIRParticleScalarValues(
        layer.content.startLifetime, frames => frames / previousFrameRate * targetFrameRate,
      );
      for (const burst of layer.content.emission.bursts ?? []) {
        burst.frameOffset *= frameRateScale;
        burst.repeatIntervalFrames *= frameRateScale;
      }
    }
  }

  if (reportCompositionChange) {
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'fps',
      oldValue: previousFrameRate,
      newValue: targetFrameRate,
    });
  }
}

function reframeAnimatedProperty(property: IRAnimatedProperty | undefined, frameRateScale: number): void {
  if (property?.type !== 'keyframed') {
    return;
  }

  for (const keyframe of property.keyframes) {
    keyframe.frame *= frameRateScale;
  }
}

function updateIRComposition(
  updatedIR: IRComposition,
  editedDSL: Composition,
  baselineDSL: Composition,
  frameRate: number,
  reportChange: DSLToIRChangeReporter,
): void {
  const baselineMeta = baselineDSL.meta;

  if (typeof editedDSL.meta.name === 'string' && editedDSL.meta.name !== baselineMeta.name) {
    const previousName = updatedIR.name;

    updatedIR.name = editedDSL.meta.name;
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'name',
      oldValue: previousName,
      newValue: editedDSL.meta.name,
    });
  }

  if (!isScalarEqual(editedDSL.meta.duration, baselineMeta.duration)) {
    updatedIR.outPoint = updatedIR.inPoint + editedDSL.meta.duration * frameRate;
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'duration',
      oldValue: baselineMeta.duration,
      newValue: editedDSL.meta.duration,
    });
  }

  if (
    Number.isFinite(editedDSL.meta.width) &&
    editedDSL.meta.width > 0 &&
    editedDSL.meta.width !== baselineMeta.width
  ) {
    const previousWidth = updatedIR.width;

    updatedIR.width = editedDSL.meta.width;
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'width',
      oldValue: previousWidth,
      newValue: editedDSL.meta.width,
    });
  }
  if (
    Number.isFinite(editedDSL.meta.height) &&
    editedDSL.meta.height > 0 &&
    editedDSL.meta.height !== baselineMeta.height
  ) {
    const previousHeight = updatedIR.height;

    updatedIR.height = editedDSL.meta.height;
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'height',
      oldValue: previousHeight,
      newValue: editedDSL.meta.height,
    });
  }

  const baselineLoop = baselineMeta.loop;

  if (editedDSL.meta.loop !== baselineLoop) {
    updatedIR.endBehavior = editedDSL.meta.loop ? IREndBehavior.Loop : IREndBehavior.Destroy;
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'loop',
      oldValue: baselineLoop,
      newValue: editedDSL.meta.loop,
    });
  }

  const baselineBackgroundColor = baselineMeta.background_color;
  const editedBackgroundColor = editedDSL.meta.background_color ?? null;

  if ((editedBackgroundColor === null || isValidHexColor(editedBackgroundColor)) &&
    !isHexEqual(editedBackgroundColor, baselineBackgroundColor)) {
    updatedIR.backgroundColor = editedBackgroundColor != null ? hexToIRColor(editedBackgroundColor) : undefined;
    reportChange({
      kind: 'composition',
      op: 'set',
      field: 'background_color',
      oldValue: baselineBackgroundColor,
      newValue: editedBackgroundColor,
    });
  }
}

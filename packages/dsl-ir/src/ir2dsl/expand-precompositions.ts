import type { IRComposition, IRScene, IRLayer } from '@galacean/animation-ir';
import { getIRSceneEntryComposition, type ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { Layer } from '../dsl/schema';
import type {
  IRToDSLExpandedLayerSource, IRToDSLLayerMapping, IRToDSLResult,
} from './types';

type ConvertIRSceneEntryToDSL = (scene: IRScene) => IRToDSLResult;

interface PrecompExpansionContext {
  irScene: IRScene;
  compositionById: ReadonlyMap<string, IRComposition>;
  layerMapping: IRToDSLLayerMapping;
  diagnostics: ConversionDiagnostic[];
  visitedCompositionIdSet: Set<string>;
  convertIRSceneEntryToDSL: ConvertIRSceneEntryToDSL;
}

/** Expand referenced IR Compositions into the editable DSL tree. */
export function expandDSLPrecompositions(
  dslResult: IRToDSLResult,
  convertIRSceneEntryToDSL: ConvertIRSceneEntryToDSL,
): void {
  const irScene = dslResult.preservedData.baselineScene;
  const context: PrecompExpansionContext = {
    irScene,
    compositionById: new Map(irScene.compositions.map(composition => [composition.id, composition] as const)),
    layerMapping: dslResult.preservedData.layerMapping,
    diagnostics: dslResult.diagnostics,
    visitedCompositionIdSet: new Set([irScene.entryCompositionId]),
    convertIRSceneEntryToDSL,
  };

  expandPrecompLayerTree(dslResult.dsl.layers, getIRSceneEntryComposition(irScene), context);
}

function expandPrecompLayerTree(
  layers: Layer[],
  sourceComposition: IRComposition,
  context: PrecompExpansionContext,
): void {
  const layerById = new Map(sourceComposition.layers.map(layer => [layer.id, layer] as const));

  for (const layer of layers) {
    const referencedComposition = resolveReferencedComposition(layer.id, context.layerMapping, layerById, context);
    const children = layer.children ?? [];

    if (referencedComposition != null && children.length === 0) {
      expandPrecompChildren(layer, referencedComposition, context);

      continue;
    }

    if (children.length > 0) {
      expandPrecompLayerTree(children, sourceComposition, context);
    }
  }
}

function expandPrecompChildren(
  parentLayer: Layer,
  referencedComposition: IRComposition,
  context: PrecompExpansionContext,
): void {
  if (context.visitedCompositionIdSet.has(referencedComposition.id)) {
    context.diagnostics.push({
      code: 'PRECOMP_EXPAND_CYCLE_SKIPPED',
      severity: 'warning',
      action: 'unsupported',
      path: '$.layers',
      sourceId: parentLayer.id,
      feature: 'precomp-cycle',
      message: `Precomp '${referencedComposition.id}' was not expanded because it would create a cycle.`,
    });

    return;
  }

  context.visitedCompositionIdSet.add(referencedComposition.id);

  try {
    const childScene = { ...context.irScene, entryCompositionId: referencedComposition.id };
    const childResult = context.convertIRSceneEntryToDSL(childScene);
    const prefix = `${parentLayer.id}__precomp_${sanitizeIdPart(referencedComposition.id)}__`;
    const children = cloneExpandedLayers(childResult.dsl.layers, {
      prefix,
      parentLayerId: parentLayer.id,
      irCompositionId: referencedComposition.id,
      childLayerMapping: childResult.preservedData.layerMapping,
      targetLayerMapping: context.layerMapping,
    });

    context.diagnostics.push(...childResult.diagnostics);
    parentLayer.children ??= [];
    parentLayer.children.push(...children);
    expandPrecompLayerTree(children, referencedComposition, context);
  } finally {
    context.visitedCompositionIdSet.delete(referencedComposition.id);
  }
}

interface CloneExpandedLayersOptions {
  prefix: string;
  parentLayerId: string;
  irCompositionId: string;
  childLayerMapping: IRToDSLLayerMapping;
  targetLayerMapping: IRToDSLLayerMapping;
}

function cloneExpandedLayers(layers: Layer[], options: CloneExpandedLayersOptions): Layer[] {
  const expandedLayerIdBySourceId = buildExpandedLayerIdBySourceId(layers, options.prefix);

  const cloneExpandedLayer = (layer: Layer, fallbackParentId: string): Layer => {
    const clonedLayer = structuredClone(layer);
    const expandedLayerId = expandedLayerIdBySourceId.get(layer.id) ?? `${options.prefix}${layer.id}`;

    clonedLayer.id = expandedLayerId;
    clonedLayer.parent = layer.parent != null
      ? (expandedLayerIdBySourceId.get(layer.parent) ?? fallbackParentId)
      : fallbackParentId;
    clonedLayer.children = (layer.children ?? []).map(childLayer => cloneExpandedLayer(childLayer, expandedLayerId));

    registerExpandedLayer(layer.id, clonedLayer, options);

    return clonedLayer;
  };

  return layers.map(layer => cloneExpandedLayer(layer, options.parentLayerId));
}

function buildExpandedLayerIdBySourceId(
  layers: Layer[],
  prefix: string,
  expandedLayerIdBySourceId = new Map<string, string>(),
): Map<string, string> {
  for (const layer of layers) {
    expandedLayerIdBySourceId.set(layer.id, `${prefix}${layer.id}`);
    buildExpandedLayerIdBySourceId(layer.children ?? [], prefix, expandedLayerIdBySourceId);
  }

  return expandedLayerIdBySourceId;
}

function registerExpandedLayer(
  sourceLayerId: string,
  expandedLayer: Layer,
  options: CloneExpandedLayersOptions,
): void {
  const childMapping = options.childLayerMapping.layers[sourceLayerId];

  if (childMapping == null) {
    return;
  }

  const expandedSource: IRToDSLExpandedLayerSource = {
    irCompositionId: options.irCompositionId,
    parentLayerId: options.parentLayerId,
    baselineTransform: {
      position: structuredClone(expandedLayer.position),
      scale: structuredClone(expandedLayer.scale),
      rotation: structuredClone(expandedLayer.rotation),
      anchor: structuredClone(expandedLayer.anchor),
      opacity: structuredClone(expandedLayer.opacity),
    },
    baselineLayer: {
      name: expandedLayer.name,
      type: expandedLayer.type,
      width: expandedLayer.width,
      height: expandedLayer.height,
      description: structuredClone(expandedLayer.description),
      parent: expandedLayer.parent,
      timeRange: structuredClone(expandedLayer.time_range),
      ...(expandedLayer.text != null && { text: structuredClone(expandedLayer.text) }),
      ...(expandedLayer.asset != null && { asset: structuredClone(expandedLayer.asset) }),
      ...(expandedLayer.particle != null && { particle: structuredClone(expandedLayer.particle) }),
    },
  };

  options.targetLayerMapping.layers[expandedLayer.id] = {
    irCompositionId: options.irCompositionId,
    irLayerId: childMapping.irLayerId,
    expandedSource,
  };
}

function resolveReferencedComposition(
  dslLayerId: string,
  layerMapping: IRToDSLLayerMapping,
  layerById: ReadonlyMap<string, IRLayer>,
  context: PrecompExpansionContext,
): IRComposition | undefined {
  const mapping = layerMapping.layers[dslLayerId];
  const sourceLayer = mapping != null ? layerById.get(mapping.irLayerId) : undefined;

  return sourceLayer?.type === 'precomp'
    ? context.compositionById.get(sourceLayer.content.compositionId)
    : undefined;
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

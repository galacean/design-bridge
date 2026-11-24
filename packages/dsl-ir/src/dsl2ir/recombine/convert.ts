import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import { isRecord } from '../../common/utils';
import type { Composition } from '../../dsl/schema';
import type { IRToDSLPreservedData } from '../../ir2dsl/types';
import type { DSLToIROptions, DSLToIRResult } from '../types';
import { updateValidatedIRFromDSL } from './update-ir';

/** Convert DSL to a clone of the baseline IR carried by the adapter-owned preserved data. */
export function convertDSLToIRWithPreservedData(
  composition: Composition,
  preservedData: IRToDSLPreservedData,
  options: DSLToIROptions = {},
): DSLToIRResult {
  assertIRToDSLPreservedData(preservedData);

  const diagnostics: ConversionDiagnostic[] = [];
  const scene = updateValidatedIRFromDSL(preservedData.baselineScene, composition, preservedData.layerMapping, {
    ...options,
    onWarning: warning => {
      diagnostics.push({
        code: warning.code,
        severity: 'warning',
        action: 'unsupported',
        path: warning.path ?? (warning.layerId != null ? '$.layers' : '$'),
        ...(warning.layerId != null && { sourceId: warning.layerId }),
        message: warning.message,
      });
      options.onWarning?.(warning);
    },
  });

  return { scene, diagnostics };
}

function assertIRToDSLPreservedData(preservedData: IRToDSLPreservedData): void {
  if (preservedData == null || typeof preservedData !== 'object') {
    throw new TypeError('[dsl-ir:preserved-data] Expected an IR-to-DSL preserved data object.');
  }
  if (!isRecord(preservedData.layerMapping)) {
    throw new TypeError('[dsl-ir:preserved-data] Invalid IR-to-DSL layer mapping.');
  }

  assertIRScene(preservedData.baselineScene);
  assertLayerMapping(preservedData.layerMapping, preservedData.baselineScene);
}

function assertLayerMapping(layerMapping: Record<string, unknown>, baselineScene: IRToDSLPreservedData['baselineScene']): void {
  const layers = layerMapping['layers'];

  if (!isRecord(layers)) {
    throw new TypeError('[dsl-ir:preserved-data] Layer mapping entries must be an object.');
  }
  const compositionById = new Map(
    baselineScene.compositions.map(composition => [composition.id, composition] as const),
  );

  for (const [dslLayerId, entry] of Object.entries(layers)) {
    if (dslLayerId === '' || !isRecord(entry)) {
      throw new TypeError(`[dsl-ir:preserved-data] Invalid mapping entry for DSL layer '${dslLayerId}'.`);
    }
    const irCompositionId = entry['irCompositionId'];
    const irLayerId = entry['irLayerId'];
    const composition = typeof irCompositionId === 'string' ? compositionById.get(irCompositionId) : undefined;

    if (
      composition == null ||
      typeof irLayerId !== 'string' ||
      !composition.layers.some(layer => layer.id === irLayerId)
    ) {
      throw new TypeError(`[dsl-ir:preserved-data] Invalid mapping entry for DSL layer '${dslLayerId}'.`);
    }
    if (entry['expandedSource'] !== undefined && !isExpandedLayerSource(entry['expandedSource'], layers)) {
      throw new TypeError(`[dsl-ir:preserved-data] Invalid expanded mapping for DSL layer '${dslLayerId}'.`);
    }
  }
}

function isExpandedLayerSource(value: unknown, layerEntries: Record<string, unknown>): boolean {
  if (
    !isRecord(value) ||
    typeof value['irCompositionId'] !== 'string' ||
    typeof value['parentLayerId'] !== 'string' ||
    !Object.hasOwn(layerEntries, value['parentLayerId']) ||
    !isRecord(value['baselineTransform']) ||
    !isRecord(value['baselineLayer'])
  ) {
    return false;
  }
  const transform = value['baselineTransform'];
  const layer = value['baselineLayer'];

  return ['position', 'scale', 'rotation', 'anchor', 'opacity'].every(field => isRecord(transform[field])) &&
    typeof layer['name'] === 'string' &&
    (layer['type'] === 'null' || layer['type'] === 'layer' || layer['type'] === 'text' ||
      layer['type'] === 'particle') &&
    (layer['type'] !== 'particle' || isRecord(layer['particle'])) &&
    typeof layer['width'] === 'number' && Number.isFinite(layer['width']) &&
    typeof layer['height'] === 'number' && Number.isFinite(layer['height']) &&
    isRecord(layer['description']) &&
    Array.isArray(layer['timeRange']) &&
    layer['timeRange'].length === 2;
}

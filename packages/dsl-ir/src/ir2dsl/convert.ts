import type { IRScene } from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import { toJSONPath } from '../common/utils';
import { DSLValidationError, validateDSL } from '../dsl/validator';
import { assembleDSLResult } from './assemble';
import { convertIRLayersToDSL } from './convert-layers';
import { expandDSLPrecompositions } from './expand-precompositions';
import type { IRToDSLResult } from './types';

/**
 * Project validated IR into editable DSL, diagnostics, and a paired JSON-serializable snapshot.
 * The input scene is not mutated. Invalid IR throws IRValidationError; an invalid
 * DSL projection throws DSLValidationError. Shared precompositions remain linked on write-back.
 */
export function convertIRToDSL(baselineScene: IRScene): IRToDSLResult {
  assertIRScene(baselineScene);
  const baselineSnapshot = structuredClone(baselineScene);
  const result = convertIRSceneEntryToDSL(baselineSnapshot);

  expandDSLPrecompositions(result, convertIRSceneEntryToDSL);
  validateConvertedDSL(result);

  return result;
}

function validateConvertedDSL(result: IRToDSLResult): void {
  const validationResult = validateDSL(result.dsl);

  if (validationResult.result === 'fail') {
    throw DSLValidationError.fromValidationResult(validationResult);
  }
  result.diagnostics.push(...validationResult.warnings.map(warning => ({
    code: warning.code,
    severity: 'warning' as const,
    action: 'unsupported' as const,
    path: toJSONPath(warning.path),
    ...(warning.layerId != null && { sourceId: warning.layerId }),
    message: warning.message,
  })));
}

function convertIRSceneEntryToDSL(baselineScene: IRScene): IRToDSLResult {
  const baselineComposition = getIRSceneEntryComposition(baselineScene);
  const convertedLayers = convertIRLayersToDSL(
    baselineComposition,
    baselineScene.assets,
    baselineComposition.frameRate,
  );

  return assembleDSLResult(
    baselineScene,
    baselineComposition,
    convertedLayers.dslLayerByIRId,
    convertedLayers.layerMapping,
    convertedLayers.diagnostics,
  );
}

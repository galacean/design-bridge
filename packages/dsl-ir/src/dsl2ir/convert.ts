import type { IRFontAsset, IRImageAsset } from '@galacean/animation-ir';
import { createIRScene, type ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import { toJSONPath } from '../common/utils';
import type { Composition } from '../dsl/schema';
import { DSLValidationError, validateDSL, type DSLValidationIssue } from '../dsl/validator';
import { convertDSLToIRWithPreservedData } from './recombine/convert';
import { convertDSLWithParticleSources } from './convert-source-instances';
import { assembleIRComposition } from './assemble';
import { convertDSLLayersToIR } from './convert-layers';
import type { DSLToIROptions, DSLToIRResult } from './types';

/**
 * Convert DSL into a new IR scene, or apply edits to its paired preserved snapshot.
 * Inputs are not mutated. Recoverable unsupported edits produce diagnostics.
 * Invalid DSL throws DSLValidationError; IR validation, invalid sidecars, unsafe
 * depth edits, and caller callbacks may throw other errors.
 */
export function convertDSLToIR(
  composition: Composition,
  options: DSLToIROptions = {},
): DSLToIRResult {
  const validationResult = validateDSL(composition);

  if (validationResult.result === 'fail') {
    throw DSLValidationError.fromValidationResult(validationResult);
  }

  const diagnostics = reportDSLValidationWarnings(validationResult.warnings, options);

  if ((options.particleSources?.length ?? 0) > 0) {
    const result = convertDSLWithParticleSources(composition, options);

    return { ...result, diagnostics: [...diagnostics, ...result.diagnostics] };
  }

  if (options.preservedData != null) {
    const preservedResult = convertDSLToIRWithPreservedData(composition, options.preservedData, options);

    assertIRScene(preservedResult.scene);

    return {
      scene: preservedResult.scene,
      diagnostics: [...diagnostics, ...preservedResult.diagnostics],
    };
  }

  const imageAssets: IRImageAsset[] = [];
  const fontAssets: IRFontAsset[] = [];
  const convertedLayers = convertDSLLayersToIR(composition, imageAssets, fontAssets);
  const scene = createIRScene(assembleIRComposition(composition, convertedLayers), [...imageAssets, ...fontAssets]);

  assertIRScene(scene);

  return {
    scene,
    diagnostics,
  };
}

function reportDSLValidationWarnings(
  warnings: DSLValidationIssue[],
  options: DSLToIROptions,
): ConversionDiagnostic[] {
  return warnings.map(warning => {
    const path = toJSONPath(warning.path);

    options.onWarning?.({
      level: 'warning',
      code: warning.code,
      message: warning.message,
      path,
      ...(warning.layerId != null && { layerId: warning.layerId }),
    });

    return {
      code: warning.code,
      severity: 'warning' as const,
      action: 'unsupported' as const,
      path,
      ...(warning.layerId != null && { sourceId: warning.layerId }),
      message: warning.message,
    };
  });
}

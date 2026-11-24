import type { JSONScene } from '@galacean/effects-specification';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import {
  convertGEToIR,
  convertIRToGE,
  updateGEToIRPreservedData,
  type GEToIRPreservedData,
  type GEToIROptions,
} from '@galacean/ge-ir';
import {
  convertDSLToIR,
  convertIRToDSL,
  type Composition,
  type DSLToIROptions,
  type DSLToIRChange,
  type IRToDSLPreservedData,
} from '../../src';

export type GEToDSLDiagnostic = ConversionDiagnostic;

export interface GEDSLPreservedData {
  ir: IRToDSLPreservedData;
  ge: GEToIRPreservedData;
}

export interface GEToDSLResult {
  dsl: Composition;
  preservedData: GEDSLPreservedData;
  diagnostics: ConversionDiagnostic[];
}

export interface ConvertDSLToGEOptions extends Omit<DSLToIROptions, 'preservedData'> {
  preservedData?: GEDSLPreservedData;
}

export interface DSLToGEResult {
  scene: JSONScene;
  diagnostics: ConversionDiagnostic[];
}

export function convertDSLToGE(
  composition: Composition,
  options: ConvertDSLToGEOptions = {},
): DSLToGEResult {
  const { preservedData, ...dslOptions } = options;
  const dslResult = convertDSLToIR(composition, {
    ...dslOptions,
    ...(preservedData != null && { preservedData: preservedData.ir }),
  });
  const updatedGEToIRPreservedData = preservedData != null
    ? updateGEToIRPreservedData(preservedData.ir.baselineScene, dslResult.scene, preservedData.ge, {
        onChange: change => options.onChange?.({
          kind: 'passthrough',
          op: 'clear',
          field: change.field,
          layerId: resolveDSLLayerId(
            preservedData.ir.layerMapping,
            change.compositionId,
            change.layerId,
          ),
        }),
      })
    : undefined;
  const effectsResult = convertIRToGE(dslResult.scene, {
    ...(updatedGEToIRPreservedData != null && { preservedData: updatedGEToIRPreservedData }),
  });

  return {
    scene: effectsResult.scene,
    diagnostics: [...dslResult.diagnostics, ...effectsResult.diagnostics],
  };
}

export function convertGEToDSL(scene: Record<string, unknown>, options: GEToIROptions): GEToDSLResult {
  assertSourceFrameRate(options.frameRate);
  const effectsResult = convertGEToIR(scene, options);
  const dslResult = convertIRToDSL(effectsResult.scene);

  return {
    dsl: dslResult.dsl,
    preservedData: {
      ir: dslResult.preservedData,
      ge: effectsResult.preservedData,
    },
    diagnostics: [...effectsResult.diagnostics, ...dslResult.diagnostics],
  };
}

function resolveDSLLayerId(
  layerMapping: IRToDSLPreservedData['layerMapping'],
  compositionId: string,
  irLayerId: string,
): string | undefined {
  return Object.entries(layerMapping.layers).find(([, mapping]) =>
    mapping.irCompositionId === compositionId && mapping.irLayerId === irLayerId,
  )?.[0];
}

function assertSourceFrameRate(frameRate: number): void {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new TypeError('options.frameRate must be finite and greater than 0.');
  }
}

export type { DSLToIRChange };

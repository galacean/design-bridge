import { buildSceneFromIR } from './builder/scene-builder';
import { extractKiwiIR } from './ir/kiwi-adapter';
import type { ConversionResult, ConvertOptions } from './types';
import { validateRuntimeReadiness } from './validators/runtime-smoke-validator';
import { validateSceneReferences } from './validators/scene-validator';

export type {
  ConversionDebugMap,
  ConversionIssue,
  ConversionResult,
  ConvertOptions,
  DebugMapEntry,
  EffectsScene,
} from './types';

export type {
  FigmaIRAutoLayout,
  FigmaIRAutoLayoutDirection,
  FigmaIREffect,
  FigmaIRFill,
  FigmaIRGradientHandle,
  FigmaIRGradientPaint,
  FigmaIRGradientStop,
  FigmaIRNode,
  FigmaIRNodeKind,
  FigmaIRPath,
  FigmaIRPathCommand,
  FigmaIRStroke,
} from './ir/figma-ir';

export { extractKiwiIR } from './ir/kiwi-adapter';
export type { KiwiIRResult } from './ir/kiwi-adapter';
export { decodeFigFile } from './fig-decoder';
export type { DecodedFigFile } from './fig-decoder';
export { validateRuntimeReadiness } from './validators/runtime-smoke-validator';
export { validateSceneReferences } from './validators/scene-validator';

/**
 * Convert a decoded Figma Kiwi NodeChange object into a minimal Galacean Effects JSONScene.
 */
export function convertFigmaToEffects(
  figmaJson: unknown,
  options: ConvertOptions = {},
  imagesByHash?: Map<string, Uint8Array>,
): ConversionResult {
  const { nodes: irNodes, blobs } = extractKiwiIR(figmaJson);
  const { scene, issues, debugMap } = buildSceneFromIR(irNodes, options, blobs, imagesByHash);
  const validationIssues = validateSceneReferences(scene);
  const runtimeIssues = validateRuntimeReadiness(scene);

  return {
    scene,
    issues: [...issues, ...validationIssues, ...runtimeIssues],
    debugMap,
  };
}

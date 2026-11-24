import * as spec from '@galacean/effects-specification';
import type { ConvertShaderToGEOptions, ShaderDiagnostic } from '../conversion-types';

export const DEFAULT_DURATION = 5;
export const DEFAULT_PREVIEW_SIZE: [number, number] = [512, 512];
export const DEFAULT_SCENE_NAME = 'ShaderScene';

export interface NormalizedConversionOptions {
  sceneName: string;
  duration: number;
  endBehavior: spec.EndBehavior;
  previewSize: [number, number];
}

export interface NormalizeConversionOptionsResult {
  options: NormalizedConversionOptions;
  diagnostics: ShaderDiagnostic[];
}

const END_BEHAVIORS = new Set<number>([
  spec.EndBehavior.destroy,
  spec.EndBehavior.forward,
  spec.EndBehavior.freeze,
  spec.EndBehavior.restart,
]);

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function normalizeConversionOptions(
  options: ConvertShaderToGEOptions,
): NormalizeConversionOptionsResult {
  const diagnostics: ShaderDiagnostic[] = [];
  const duration = isPositiveFiniteNumber(options.duration) ? options.duration : DEFAULT_DURATION;

  if (options.duration !== undefined && duration !== options.duration) {
    diagnostics.push({
      code: 'OPTION_DURATION_INVALID',
      severity: 'warning',
      message: `Invalid duration was replaced with the default value ${DEFAULT_DURATION}.`,
      path: '$.options.duration',
    });
  }

  const previewSize = normalizePreviewSize(options.previewSize, diagnostics);
  const endBehavior = normalizeEndBehavior(options.endBehavior, diagnostics);

  return {
    options: {
      sceneName: options.sceneName ?? DEFAULT_SCENE_NAME,
      duration,
      endBehavior,
      previewSize,
    },
    diagnostics,
  };
}

function normalizePreviewSize(
  previewSize: [number, number] | undefined,
  diagnostics: ShaderDiagnostic[],
): [number, number] {
  if (
    previewSize === undefined ||
    (Array.isArray(previewSize) &&
      previewSize.length === 2 &&
      isPositiveFiniteNumber(previewSize[0]) &&
      isPositiveFiniteNumber(previewSize[1]))
  ) {
    return previewSize ?? [...DEFAULT_PREVIEW_SIZE];
  }

  diagnostics.push({
    code: 'OPTION_PREVIEW_SIZE_INVALID',
    severity: 'warning',
    message:
      `Invalid previewSize was replaced with the default value ` +
      `${DEFAULT_PREVIEW_SIZE[0]}x${DEFAULT_PREVIEW_SIZE[1]}.`,
    path: '$.options.previewSize',
  });

  return [...DEFAULT_PREVIEW_SIZE];
}

function normalizeEndBehavior(
  endBehavior: spec.EndBehavior | undefined,
  diagnostics: ShaderDiagnostic[],
): spec.EndBehavior {
  if (endBehavior === undefined || END_BEHAVIORS.has(endBehavior)) {
    return endBehavior ?? spec.EndBehavior.restart;
  }

  diagnostics.push({
    code: 'OPTION_END_BEHAVIOR_INVALID',
    severity: 'warning',
    message: `Invalid endBehavior was replaced with restart (${spec.EndBehavior.restart}).`,
    path: '$.options.endBehavior',
  });

  return spec.EndBehavior.restart;
}

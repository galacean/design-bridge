import { IREndBehavior, type IRComposition, type IRLayer, type IRScene } from '@galacean/animation-ir';
import { createIRScene } from '@galacean/animation-ir/adapter';
import { isIRId, validateIRScene, type IRValidationResult } from '@galacean/animation-ir/validator';

export function makeLayer(overrides: Partial<IRLayer> = {}): IRLayer {
  return {
    id: 'layer-0',
    name: 'layer-0',
    type: 'null',
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    ...overrides,
  } as IRLayer;
}

export function makeComposition(overrides: Partial<IRComposition> = {}): IRComposition {
  return {
    id: 'composition',
    name: 'comp',
    width: 800,
    height: 600,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: IREndBehavior.Loop,
    layers: [makeLayer()],
    ...overrides,
  };
}

export function makeScene(assets: IRScene['assets'] = []): IRScene {
  return createIRScene(makeComposition(), assets);
}

export function makeHardeningComposition(): IRComposition {
  return makeComposition({
    width: 100,
    height: 100,
    layers: [makeLayer({ id: 'root', name: 'root' })],
  });
}

export function asUnknownRecord(composition = makeHardeningComposition()): Record<string, unknown> {
  return composition as unknown as Record<string, unknown>;
}

export function firstLayer(composition: IRComposition): Record<string, unknown> {
  return composition.layers[0] as unknown as Record<string, unknown>;
}

function wrapCompositionInput(input: unknown): unknown {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const compositionId = (input as Record<string, unknown>)['id'];

    if (typeof compositionId === 'string' && isIRId(compositionId)) {
      return createValidationScene(compositionId, input);
    }
  }

  return createValidationScene('composition', input);
}

function createValidationScene(entryCompositionId: string, composition: unknown): unknown {
  return {
    format: 'animation-ir',
    schemaVersion: '1.0.0',
    entryCompositionId,
    compositions: [composition],
    assets: [{
      id: 'font:body', type: 'font', family: 'sans-serif', style: 'normal', weight: 400,
      source: { kind: 'system' },
    }],
  };
}

function stripCompositionPath(path: string): string {
  return path === 'compositions[0]' ? '$' : path.replace(/^compositions\[0\]\./, '');
}

export function validateComposition(input: unknown): IRValidationResult {
  const result = validateIRScene(wrapCompositionInput(input));

  return {
    valid: result.valid,
    errors: result.errors
      .filter(issue => issue.path.startsWith('compositions[0]'))
      .map(issue => ({ ...issue, path: stripCompositionPath(issue.path) })),
    warnings: result.warnings
      .filter(warning => warning.path.startsWith('compositions[0]'))
      .map(warning => ({ ...warning, path: stripCompositionPath(warning.path) })),
  };
}

export function errorCodes(input: unknown): string[] {
  return validateComposition(input).errors.map(issue => issue.code);
}

export function errorPaths(input: unknown, code: string): string[] {
  return validateComposition(input).errors.filter(issue => issue.code === code).map(issue => issue.path);
}

export function issueKeys(input: unknown): string[] {
  return validateComposition(input).errors.map(issue => `${issue.code}:${issue.path}`);
}

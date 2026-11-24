import { IRLayerType } from '../schema/layer.js';
import { IREndBehavior } from '../schema/value-types.js';
import { ANIMATION_IR_SCHEMA_VERSION, type IRScene } from '../schema/scene.js';
import { validateAssetReferences, validateAssets } from './asset-validation.js';
import { IRValidationError, type IRValidationResult } from './contract.js';
import { ValidationContext } from './context.js';
import { validateCompositionLayers } from './layer-validation.js';
import {
  isFiniteNumber, isIRId, isOneOfConst, isRecord, validateColor,
} from './value-validation.js';

function validateComposition(ctx: ValidationContext, input: unknown, path: string): string | undefined {
  if (!isRecord(input)) {
    ctx.error('IR_COMPOSITION_INVALID', path, 'composition must be an object');

    return undefined;
  }
  const id = isIRId(input['id']) ? input['id'] : undefined;

  if (id === undefined) {
    ctx.error('IR_COMPOSITION_ID_INVALID', `${path}.id`, 'must be a non-empty string');
  }
  if (input['name'] !== undefined && typeof input['name'] !== 'string') {
    ctx.error('IR_COMPOSITION_NAME_INVALID', `${path}.name`, 'must be a string');
  }
  if (!isFiniteNumber(input['width']) || input['width'] <= 0) {
    ctx.error('IR_COMPOSITION_WIDTH_INVALID', `${path}.width`, 'must be finite and greater than 0');
  }
  if (!isFiniteNumber(input['height']) || input['height'] <= 0) {
    ctx.error('IR_COMPOSITION_HEIGHT_INVALID', `${path}.height`, 'must be finite and greater than 0');
  }
  if (!isFiniteNumber(input['frameRate']) || input['frameRate'] <= 0) {
    ctx.error('IR_COMPOSITION_FRAME_RATE_INVALID', `${path}.frameRate`, 'must be finite and greater than 0');
  }

  const inPoint = input['inPoint'];
  const outPoint = input['outPoint'];

  if (!isFiniteNumber(inPoint)) {
    ctx.error('IR_COMPOSITION_IN_POINT_INVALID', `${path}.inPoint`, 'must be finite');
  }
  if (!isFiniteNumber(outPoint)) {
    ctx.error('IR_COMPOSITION_OUT_POINT_INVALID', `${path}.outPoint`, 'must be finite');
  }
  if (isFiniteNumber(inPoint) && isFiniteNumber(outPoint) && outPoint <= inPoint) {
    ctx.error('IR_COMPOSITION_TIME_RANGE_INVALID', `${path}.outPoint`, 'must be greater than inPoint');
  }

  if (input['backgroundColor'] !== undefined) {
    validateColor(ctx, input['backgroundColor'], 'IR_COMPOSITION_BACKGROUND_COLOR_INVALID', `${path}.backgroundColor`);
  }
  if (!isOneOfConst(input['endBehavior'], IREndBehavior)) {
    ctx.error('IR_COMPOSITION_END_BEHAVIOR_INVALID', `${path}.endBehavior`, 'is invalid');
  }
  validateCompositionLayers(ctx, input['layers'], `${path}.layers`);

  return id;
}

interface CompositionTraversalFrame {
  compositionId: string;
  targets: string[];
  nextTargetIndex: number;
}

function validateCompositionReferenceCycles(
  ctx: ValidationContext,
  targetsByCompositionId: ReadonlyMap<string, ReadonlySet<string>>,
  compositionPathById: ReadonlyMap<string, string>,
): void {
  const visitState = new Map<string, 1 | 2>();
  const traversal: string[] = [];
  const traversalIndexById = new Map<string, number>();
  const enterComposition = (compositionId: string, stack: CompositionTraversalFrame[]): void => {
    visitState.set(compositionId, 1);
    traversalIndexById.set(compositionId, traversal.length);
    traversal.push(compositionId);
    stack.push({
      compositionId,
      targets: Array.from(targetsByCompositionId.get(compositionId) ?? []),
      nextTargetIndex: 0,
    });
  };

  for (const compositionId of compositionPathById.keys()) {
    if (visitState.has(compositionId)) {
      continue;
    }
    const stack: CompositionTraversalFrame[] = [];

    enterComposition(compositionId, stack);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];

      if (frame.nextTargetIndex >= frame.targets.length) {
        stack.pop();
        traversal.pop();
        traversalIndexById.delete(frame.compositionId);
        visitState.set(frame.compositionId, 2);
        continue;
      }
      const targetId = frame.targets[frame.nextTargetIndex++];
      const targetState = visitState.get(targetId);

      if (targetState === 1) {
        const cycleStart = traversalIndexById.get(targetId) ?? 0;
        const cycle = [...traversal.slice(cycleStart), targetId];

        ctx.error(
          'IR_COMPOSITION_REFERENCE_CYCLE',
          compositionPathById.get(frame.compositionId) ?? 'compositions',
          `Precomp reference graph contains a cycle: ${cycle.join(' -> ')}`,
        );
      } else if (targetState !== 2) {
        enterComposition(targetId, stack);
      }
    }
  }
}

function validateCompositionReferences(
  ctx: ValidationContext,
  compositions: unknown[],
  compositionPathById: ReadonlyMap<string, string>,
  entryCompositionId: string | undefined,
): void {
  const targetsByCompositionId = new Map<string, Set<string>>();

  for (const [compositionIndex, composition] of compositions.entries()) {
    if (!isRecord(composition) || !isIRId(composition['id']) || !Array.isArray(composition['layers'])) {
      continue;
    }
    const targets = new Set<string>();

    targetsByCompositionId.set(composition['id'], targets);
    for (const [layerIndex, layer] of composition['layers'].entries()) {
      if (!isRecord(layer) || layer['type'] !== IRLayerType.Precomp || !isRecord(layer['content'])) {
        continue;
      }
      const targetId = layer['content']['compositionId'];

      if (!isIRId(targetId)) {
        continue;
      }
      const path = `compositions[${compositionIndex}].layers[${layerIndex}].content.compositionId`;

      if (!compositionPathById.has(targetId)) {
        ctx.error(
          'IR_LAYER_PRECOMP_COMPOSITION_MISSING',
          path,
          `does not resolve to a Composition: ${targetId}`,
          isIRId(layer['id']) ? layer['id'] : undefined,
        );
      } else {
        targets.add(targetId);
      }
    }
  }

  validateCompositionReferenceCycles(ctx, targetsByCompositionId, compositionPathById);

  if (entryCompositionId == null || !compositionPathById.has(entryCompositionId)) {
    return;
  }
  const reachable = new Set<string>();
  const pending = [entryCompositionId];

  while (pending.length > 0) {
    const compositionId = pending.pop();

    if (compositionId == null || reachable.has(compositionId)) {
      continue;
    }
    reachable.add(compositionId);
    for (const targetId of targetsByCompositionId.get(compositionId) ?? []) {
      pending.push(targetId);
    }
  }

  for (const [compositionId, path] of compositionPathById) {
    if (!reachable.has(compositionId)) {
      ctx.warning('IR_COMPOSITION_UNREACHABLE', path, `Composition '${compositionId}' is not reachable from entry`);
    }
  }
}

/**
 * Validate known IR fields without mutating input; collect structural and reference issues without throwing.
 * Extra fields are ignored, not supported extensions. Success does not guarantee resource availability,
 * interpolated value bounds or rendering support in a consumer.
 */
export function validateIRScene(input: unknown): IRValidationResult {
  const ctx = new ValidationContext();

  if (!isRecord(input)) {
    ctx.error('IR_SCENE_INVALID', '$', 'scene must be an object');

    return { valid: false, errors: ctx.errors, warnings: ctx.warnings };
  }

  if (input['format'] !== 'animation-ir') {
    ctx.error('IR_SCENE_FORMAT_INVALID', 'format', "must be 'animation-ir'");
  }
  if (input['schemaVersion'] !== ANIMATION_IR_SCHEMA_VERSION) {
    ctx.error(
      'IR_SCENE_SCHEMA_VERSION_INVALID',
      'schemaVersion',
      `must be '${ANIMATION_IR_SCHEMA_VERSION}'`,
    );
  }

  const assetById = validateAssets(ctx, input['assets']);

  const entryCompositionId = isIRId(input['entryCompositionId'])
    ? input['entryCompositionId']
    : undefined;

  if (entryCompositionId === undefined) {
    ctx.error(
      'IR_SCENE_ENTRY_COMPOSITION_ID_INVALID',
      'entryCompositionId',
      'must be a valid Composition ID',
    );
  }

  const compositions = input['compositions'];

  if (!Array.isArray(compositions) || compositions.length === 0) {
    ctx.error('IR_SCENE_COMPOSITIONS_INVALID', 'compositions', 'must be a non-empty array');
  } else {
    validateAssetReferences(ctx, compositions, assetById);
    const compositionPathById = new Map<string, string>();

    for (const [index, composition] of compositions.entries()) {
      const compositionPath = `compositions[${index}]`;
      const compositionId = validateComposition(ctx, composition, compositionPath);

      if (compositionId === undefined) {
        continue;
      }

      const existingPath = compositionPathById.get(compositionId);

      if (existingPath != null) {
        ctx.error('IR_COMPOSITION_ID_DUPLICATE', `${compositionPath}.id`, `duplicates ${existingPath}.id`);
      } else {
        compositionPathById.set(compositionId, compositionPath);
      }
    }

    if (entryCompositionId !== undefined && !compositionPathById.has(entryCompositionId)) {
      ctx.error(
        'IR_SCENE_ENTRY_COMPOSITION_MISSING',
        'entryCompositionId',
        `does not match any Composition ID: ${entryCompositionId}`,
      );
    }
    validateCompositionReferences(ctx, compositions, compositionPathById, entryCompositionId);
  }

  return {
    valid: ctx.errors.length === 0,
    errors: ctx.errors,
    warnings: ctx.warnings,
  };
}

/**
 * Narrow an unknown value to IRScene using the same checks as validateIRScene, without mutating it.
 *
 * @throws IRValidationError with all blocking issues when validation fails.
 */
export function assertIRScene(input: unknown): asserts input is IRScene {
  const { errors } = validateIRScene(input);
  const firstIssue = errors[0];

  if (firstIssue !== undefined) {
    throw new IRValidationError(firstIssue, errors);
  }
}

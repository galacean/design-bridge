import { IRBlendMode, IRLayerType, IRMatteMode } from '../schema/layer.js';
import { IREndBehavior } from '../schema/value-types.js';
import {
  validateImageLayerContent, validateLocalBounds, validateMask, validateShapeData, validateSolidLayerContent,
  validateTextData,
} from './content-validation.js';
import type { ValidationContext } from './context.js';
import { validateAnimatedProperty, validateStaticProperty } from './property-validation.js';
import { validateParticleContent } from './particle-validation.js';
import {
  isFiniteNumber, isIRId, isOneOfConst, isRecord, validateOptionalFiniteNumber,
  validateOptionalPositiveFiniteNumber,
} from './value-validation.js';

function validateLayerTime(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  isPrecomp: boolean,
  layerId?: string,
): void {
  if (!isRecord(value)) {
    ctx.error('IR_LAYER_TIME_INVALID', path, 'must be an object containing inFrame and outFrame', layerId);

    return;
  }

  const inFrame = value['inFrame'];
  const outFrame = value['outFrame'];

  if (!isFiniteNumber(inFrame)) {
    ctx.error('IR_LAYER_TIME_START_INVALID', `${path}.inFrame`, 'must be finite', layerId);
  }
  if (!isFiniteNumber(outFrame)) {
    ctx.error('IR_LAYER_TIME_END_INVALID', `${path}.outFrame`, 'must be finite', layerId);
  }
  if (isFiniteNumber(inFrame) && isFiniteNumber(outFrame) && outFrame < inFrame) {
    ctx.error('IR_LAYER_TIME_RANGE_INVALID', path, 'outFrame must be greater than or equal to inFrame', layerId);
  }

  if (isPrecomp) {
    validateOptionalPositiveFiniteNumber(
      ctx,
      value['stretch'],
      'IR_LAYER_TIME_STRETCH_INVALID',
      `${path}.stretch`,
      layerId,
    );
    validateOptionalFiniteNumber(
      ctx,
      value['sourceStartFrame'],
      'IR_LAYER_TIME_SOURCE_START_INVALID',
      `${path}.sourceStartFrame`,
      {},
      layerId,
    );
  } else {
    if (value['stretch'] !== undefined) {
      ctx.error('IR_LAYER_TIME_STRETCH_INVALID', `${path}.stretch`, 'is only valid for precomp layers', layerId);
    }
    if (value['sourceStartFrame'] !== undefined) {
      ctx.error(
        'IR_LAYER_TIME_SOURCE_START_INVALID',
        `${path}.sourceStartFrame`,
        'is only valid for precomp layers',
        layerId,
      );
    }
  }
}

function validateLayerParent(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId?: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isIRId(value)) {
    ctx.error('IR_LAYER_PARENT_INVALID', path, 'must be a valid Layer ID', layerId);

    return undefined;
  }

  return value;
}

function validateLayerMatte(
  ctx: ValidationContext,
  value: unknown,
  path: string,
  layerId?: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    ctx.error('IR_LAYER_MATTE_INVALID', path, 'must be an object', layerId);

    return undefined;
  }
  const sourceLayerId = value['sourceLayerId'];

  if (!isIRId(sourceLayerId)) {
    ctx.error('IR_LAYER_MATTE_INVALID', `${path}.sourceLayerId`, 'must be a valid Layer ID', layerId);
  }
  if (!isOneOfConst(value['mode'], IRMatteMode)) {
    ctx.error('IR_LAYER_MATTE_INVALID', `${path}.mode`, 'must be geometry, alpha, or luminance', layerId);
  }
  if (value['inverted'] !== undefined && typeof value['inverted'] !== 'boolean') {
    ctx.error('IR_LAYER_MATTE_INVALID', `${path}.inverted`, 'must be boolean when present', layerId);
  }

  return isIRId(sourceLayerId) ? sourceLayerId : undefined;
}

function validateTransform(ctx: ValidationContext, value: unknown, path: string, layerId?: string): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    ctx.error('IR_TRANSFORM_INVALID', path, 'must be an object', layerId);

    return;
  }

  validateAnimatedProperty(ctx, value['position'], 3, `${path}.position`, layerId, {
    allowSpatialTangents: true,
  });
  validateStaticProperty(ctx, value['anchor'], 3, `${path}.anchor`, layerId);
  validateAnimatedProperty(ctx, value['scale'], 3, `${path}.scale`, layerId);
  validateAnimatedProperty(ctx, value['opacity'], 'number', `${path}.opacity`, layerId, {
    normalized: true,
  });

  const rotation = value['rotation'];

  if (rotation === undefined) {
    return;
  }
  if (!isRecord(rotation)) {
    ctx.error('IR_TRANSFORM_INVALID', `${path}.rotation`, 'must be an object', layerId);

    return;
  }

  const axes = ['x', 'y', 'z'] as const;

  if (!axes.some(axis => rotation[axis] !== undefined)) {
    ctx.error('IR_TRANSFORM_INVALID', `${path}.rotation`, 'must have at least one axis', layerId);
  }
  for (const axis of axes) {
    validateAnimatedProperty(ctx, rotation[axis], 'number', `${path}.rotation.${axis}`, layerId);
  }
}

interface LayerRelation {
  id: string;
  path: string;
  parentLayerId?: string;
  matteSourceLayerId?: string;
}

function validateLayer(
  ctx: ValidationContext,
  value: unknown,
  path: string,
): LayerRelation | undefined {
  if (!isRecord(value)) {
    ctx.error('IR_LAYER_INVALID', path, 'must be an object');

    return undefined;
  }

  const layerId = isIRId(value['id']) ? value['id'] : undefined;

  if (layerId === undefined) {
    ctx.error(
      'IR_LAYER_ID_INVALID',
      `${path}.id`,
      'must be a non-empty string',
      layerId,
    );
  }
  if (value['name'] !== undefined && typeof value['name'] !== 'string') {
    ctx.error('IR_LAYER_NAME_INVALID', `${path}.name`, 'must be a string', layerId);
  }
  if (!isOneOfConst(value['type'], IRLayerType)) {
    ctx.error('IR_LAYER_TYPE_INVALID', `${path}.type`, 'is invalid', layerId);
  }

  const type = value['type'];

  validateLayerTime(ctx, value['time'], `${path}.time`, type === IRLayerType.Precomp, layerId);
  if (typeof value['visible'] !== 'boolean') {
    ctx.error('IR_LAYER_VISIBILITY_INVALID', `${path}.visible`, 'must be boolean', layerId);
  }
  if (value['endBehavior'] !== undefined && !isOneOfConst(value['endBehavior'], IREndBehavior)) {
    ctx.error('IR_LAYER_END_BEHAVIOR_INVALID', `${path}.endBehavior`, 'is invalid when present', layerId);
  }
  const parentLayerId = validateLayerParent(ctx, value['parentId'], `${path}.parentId`, layerId);
  const matteSourceLayerId = validateLayerMatte(ctx, value['matte'], `${path}.matte`, layerId);

  validateTransform(ctx, value['transform'], `${path}.transform`, layerId);
  if (value['masks'] !== undefined) {
    if (!Array.isArray(value['masks'])) {
      ctx.error('IR_MASK_DATA_INVALID', `${path}.masks`, 'must be an array', layerId);
    } else {
      for (const [index, mask] of value['masks'].entries()) {
        validateMask(ctx, mask, `${path}.masks[${index}]`, layerId);
      }
    }
  }

  if (value['blendMode'] !== undefined && !isOneOfConst(value['blendMode'], IRBlendMode)) {
    ctx.error('IR_LAYER_BLEND_MODE_INVALID', `${path}.blendMode`, 'is invalid', layerId);
  }
  const content = value['content'];
  const textSizeMode = type === IRLayerType.Text && isRecord(content) ? content['sizeMode'] ?? 'auto-width' : undefined;

  if (value['localBounds'] !== undefined) {
    const automaticDimensions: Array<'width' | 'height'> = textSizeMode === 'auto-width'
      ? ['width', 'height'] : textSizeMode === 'auto-height' ? ['height'] : [];

    validateLocalBounds(ctx, value['localBounds'], `${path}.localBounds`, layerId, automaticDimensions);
  }

  if (type === IRLayerType.Image) {
    validateImageLayerContent(ctx, value['content'], `${path}.content`, layerId);
    if (value['localBounds'] === undefined) {
      ctx.error(
        'IR_LAYER_LOCAL_BOUNDS_INVALID',
        `${path}.localBounds`,
        'is required for image layers and cannot be inferred from Asset pixel metadata',
        layerId,
      );
    }
  }
  if (type === IRLayerType.Solid) {
    validateSolidLayerContent(ctx, value['content'], `${path}.content`, layerId);
    if (value['localBounds'] === undefined) {
      ctx.error(
        'IR_LAYER_LOCAL_BOUNDS_INVALID',
        `${path}.localBounds`,
        'is required for solid layers',
        layerId,
      );
    }
  }
  if (type === IRLayerType.Text) {
    if (value['content'] === undefined) {
      ctx.error('IR_TEXT_DATA_MISSING', `${path}.content`, 'content is required for text layers', layerId);
    } else {
      validateTextData(ctx, value['content'], `${path}.content`, layerId);
      if (value['localBounds'] === undefined && (textSizeMode === 'fixed' || textSizeMode === 'auto-height')) {
        ctx.error('IR_LAYER_LOCAL_BOUNDS_INVALID', `${path}.localBounds`,
          'is required for fixed and auto-height text layout', layerId);
      }
    }
  }
  if (type === IRLayerType.Null && value['content'] !== undefined) {
    ctx.error('IR_LAYER_CONTENT_INVALID', `${path}.content`, 'must be omitted for null layers', layerId);
  }
  if (type === IRLayerType.Precomp) {
    const content = value['content'];

    if (!isRecord(content)) {
      ctx.error(
        'IR_LAYER_PRECOMP_CONTENT_INVALID',
        `${path}.content`,
        'must be an object containing compositionId',
        layerId,
      );
    } else {
      if (!isIRId(content['compositionId'])) {
        ctx.error(
          'IR_LAYER_PRECOMP_CONTENT_INVALID',
          `${path}.content.compositionId`,
          'must be a valid Composition ID',
          layerId,
        );
      }
      if (typeof content['clipToBounds'] !== 'boolean') {
        ctx.error(
          'IR_LAYER_PRECOMP_CONTENT_INVALID',
          `${path}.content.clipToBounds`,
          'must be boolean',
          layerId,
        );
      }
      if (content['endBehavior'] !== undefined && !isOneOfConst(content['endBehavior'], IREndBehavior)) {
        ctx.error(
          'IR_LAYER_PRECOMP_CONTENT_INVALID',
          `${path}.content.endBehavior`,
          'is invalid when present',
          layerId,
        );
      }
    }
  }
  if (type === IRLayerType.Shape) {
    const contentPath = `${path}.content`;
    const content = value['content'];

    if (!isRecord(content)) {
      if (content === undefined) {
        ctx.error('IR_SHAPE_DATA_MISSING', contentPath, 'content is required for shape layers', layerId);
      } else {
        ctx.error('IR_SHAPE_DATA_INVALID', contentPath, 'must be an object', layerId);
      }
    } else {
      const shapes = content['shapes'];
      const shapesPath = `${contentPath}.shapes`;

      if (!Array.isArray(shapes)) {
        ctx.error('IR_SHAPE_DATA_INVALID', shapesPath, 'must be an array', layerId);
      } else {
        if (shapes.length === 0) {
          ctx.warning('IR_SHAPE_DATA_EMPTY', shapesPath, 'shape data is empty', layerId);
        }
        for (const [index, shape] of shapes.entries()) {
          validateShapeData(ctx, shape, `${shapesPath}[${index}]`, layerId);
        }
      }
    }
  }
  if (type === IRLayerType.Particle) {
    const layerTime = value['time'];
    const layerDurationFrames = isRecord(layerTime) && isFiniteNumber(layerTime['inFrame']) &&
      isFiniteNumber(layerTime['outFrame'])
      ? Math.max(0, layerTime['outFrame'] - layerTime['inFrame'])
      : 0;

    validateParticleContent(ctx, value['content'], `${path}.content`, layerDurationFrames, layerId);
    if (value['localBounds'] === undefined) {
      ctx.error(
        'IR_LAYER_LOCAL_BOUNDS_INVALID',
        `${path}.localBounds`,
        'is required for particle layers',
        layerId,
      );
    }
  }

  if (layerId === undefined) {
    return undefined;
  }

  return { id: layerId, path, parentLayerId, matteSourceLayerId };
}

function validateLayerIds(ctx: ValidationContext, layers: unknown[], layersPath: string): void {
  const pathById = new Map<string, string>();

  for (const [arrayIndex, layer] of layers.entries()) {
    if (!isRecord(layer) || !isIRId(layer['id'])) {
      continue;
    }

    const id = layer['id'];
    const path = `${layersPath}[${arrayIndex}]`;
    const existingPath = pathById.get(id);

    if (existingPath != null) {
      ctx.error('IR_LAYER_ID_DUPLICATE', `${path}.id`, `duplicates ${existingPath}.id`, id);
    } else {
      pathById.set(id, path);
    }
  }
}

function validateLayerRelation(
  ctx: ValidationContext,
  relationById: ReadonlyMap<string, LayerRelation>,
  kind: 'parent' | 'matte',
): void {
  const isParent = kind === 'parent';
  const referenceField = isParent ? 'parentId' : 'matte.sourceLayerId';
  const cycleField = isParent ? 'parentId' : 'matte';
  const nextById = new Map<string, LayerRelation>();

  for (const relation of relationById.values()) {
    const targetId = isParent ? relation.parentLayerId : relation.matteSourceLayerId;

    if (targetId === undefined) {
      continue;
    }

    if (targetId === relation.id) {
      ctx.error(
        isParent ? 'IR_LAYER_PARENT_SELF_REFERENCE' : 'IR_LAYER_MATTE_SELF_REFERENCE',
        `${relation.path}.${referenceField}`,
        'cannot point to the same layer',
        relation.id,
      );
      continue;
    }
    const target = relationById.get(targetId);

    if (target === undefined) {
      ctx.error(
        isParent ? 'IR_LAYER_PARENT_OUT_OF_RANGE' : 'IR_LAYER_MATTE_SOURCE_OUT_OF_RANGE',
        `${relation.path}.${referenceField}`,
        `does not match layer id ${targetId}`,
        relation.id,
      );
      continue;
    }
    nextById.set(relation.id, target);
  }

  const state = new Map<string, 'active' | 'done'>();

  for (const start of relationById.values()) {
    if (state.get(start.id) === 'done') {
      continue;
    }

    const traversal: LayerRelation[] = [];
    let current: LayerRelation | undefined = start;

    while (current !== undefined && state.get(current.id) !== 'done') {
      if (state.get(current.id) === 'active') {
        const closingLayer = traversal[traversal.length - 1];
        const cycle = traversal.slice(traversal.indexOf(current)).map(relation => relation.id);

        cycle.push(current.id);
        ctx.error(
          isParent ? 'IR_LAYER_PARENT_CYCLE' : 'IR_LAYER_MATTE_CYCLE',
          `${closingLayer.path}.${cycleField}`,
          `${kind} chain contains a cycle: ${cycle.join(' -> ')}`,
          closingLayer.id,
        );

        break;
      }

      state.set(current.id, 'active');
      traversal.push(current);
      current = nextById.get(current.id);
    }

    for (const relation of traversal) {
      state.set(relation.id, 'done');
    }
  }
}

export function validateCompositionLayers(ctx: ValidationContext, value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    ctx.error('IR_COMPOSITION_LAYERS_INVALID', path, 'must be an array');

    return;
  }

  validateLayerIds(ctx, value, path);
  const relationById = new Map<string, LayerRelation>();

  for (const [index, layer] of value.entries()) {
    const relation = validateLayer(ctx, layer, `${path}[${index}]`);

    if (relation !== undefined && !relationById.has(relation.id)) {
      relationById.set(relation.id, relation);
    }
  }

  validateLayerRelation(ctx, relationById, 'parent');
  validateLayerRelation(ctx, relationById, 'matte');
}

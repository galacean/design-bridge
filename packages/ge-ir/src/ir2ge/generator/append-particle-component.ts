import type { IRParticleLayer } from '@galacean/animation-ir';
import { DataType, ValueType } from '@galacean/effects-specification';
import { toDataPath } from '../../common/data-path';
import { restoreGEParticleScalarExpression } from '../../common/particle-expression';
import { isRecord, normalizeJSONValue } from '../../common/json-normalization';
import { roundNumber } from '../../common/math';
import { multiplyOpacityProperties } from '../converter/opacity';
import { mapBlendModeToGE } from '../mapping';
import type { GeneratedComponentData, LayerGenerationContext } from '../types';
import { copyPreservedMaskToComponent, resolveComponentId } from './component-preservation';

export function appendParticleComponent(
  layer: IRParticleLayer,
  itemId: string,
  anchorScaleX: number,
  anchorScaleY: number,
  ctx: LayerGenerationContext,
): string {
  const preservedContent = ctx.layerDataById[layer.id]?.particleContent;

  if (preservedContent == null) {
    throw new TypeError(
      `[ge-ir] Particle layer '${layer.id}' cannot be exported without trusted GE particle data ` +
      'because the source-neutral IR does not contain renderer, shape, or resource bindings.',
    );
  }

  const componentId = resolveComponentId(layer, ctx);
  const component = normalizeJSONValue(preservedContent) as GeneratedComponentData;
  const rawOptions = component['options'];
  const rawEmission = component['emission'];
  const rawRenderer = component['renderer'];
  const options = isRecord(rawOptions) ? { ...rawOptions } : {};
  const emission = isRecord(rawEmission) ? { ...rawEmission } : {};
  const renderer = isRecord(rawRenderer) ? { ...rawRenderer } : {};
  const bursts = layer.content.emission.bursts;
  const blending = mapBlendModeToGE(layer.blendMode);
  const opacity = resolveStaticParticleOpacity(layer, ctx);

  removeInvalidBurstOffsets(emission, bursts?.length ?? 0);
  options['maxCount'] = layer.content.maxParticles;
  options['startLifetime'] = restoreGEParticleScalarExpression(
    layer.content.startLifetime, options['startLifetime'], ctx.frameRate,
  );
  emission['rateOverTime'] = restoreGEParticleScalarExpression(
    layer.content.emission.rateOverTime, emission['rateOverTime'],
  );
  if (bursts == null) {
    delete emission['bursts'];
  } else {
    emission['bursts'] = bursts.map(burst => ({
      time: burst.frameOffset / ctx.frameRate,
      count: burst.count,
      cycles: burst.cycleCount === 'infinite' ? 0 : burst.cycleCount,
      interval: burst.repeatIntervalFrames / ctx.frameRate,
    }));
  }
  if (blending == null) {
    delete renderer['blending'];
  } else {
    renderer['blending'] = blending;
  }
  renderer['anchor'] = [roundNumber(anchorScaleX, 4), roundNumber(anchorScaleY, 4)];
  if (opacity != null && opacity !== 1) {
    options['startColor'] = scaleParticleStartColor(options['startColor'], opacity, layer.id);
  }

  component['id'] = componentId;
  component['dataType'] = DataType.ParticleSystem;
  component['item'] = toDataPath(itemId);
  component['options'] = options;
  component['emission'] = emission;
  component['renderer'] = renderer;

  copyPreservedMaskToComponent(layer, component, ctx);
  ctx.collector.components.push(component);

  return componentId;
}

function removeInvalidBurstOffsets(emission: Record<string, unknown>, burstCount: number): void {
  const preservedBursts = emission['bursts'];
  const burstOffsets = emission['burstOffsets'];

  if (
    !Array.isArray(burstOffsets) ||
    (Array.isArray(preservedBursts) && preservedBursts.length === burstCount &&
      burstOffsets.every(offset => isValidBurstOffset(offset, burstCount)))
  ) {
    return;
  }

  delete emission['burstOffsets'];
}

function isValidBurstOffset(value: unknown, burstCount: number): boolean {
  return isRecord(value) && typeof value['index'] === 'number' && Number.isInteger(value['index']) &&
    value['index'] >= 0 && value['index'] < burstCount;
}

function resolveStaticParticleOpacity(
  layer: IRParticleLayer,
  ctx: LayerGenerationContext,
): number | undefined {
  const opacity = multiplyOpacityProperties(
    ctx.inheritedOpacity,
    layer.transform?.opacity,
    layer.time.inFrame,
    layer.time.outFrame,
  );

  if (opacity == null) {
    return undefined;
  }
  if (opacity.type === 'static') {
    return opacity.value;
  }
  if (opacity.keyframes.length === 1) {
    return opacity.keyframes[0].value;
  }

  ctx.diagnostics.push({
    code: 'GE_PARTICLE_OPACITY_ANIMATION_UNSUPPORTED',
    severity: 'warning',
    action: 'unsupported',
    path: `$.compositions[id=${JSON.stringify(ctx.ir.id)}].layers[id=${JSON.stringify(layer.id)}].transform.opacity`,
    sourceId: layer.id,
    feature: 'particle-opacity',
    message: 'GE ParticleSystem has no timeline-compatible Layer opacity target; animated opacity was not emitted.',
  });

  return undefined;
}

function scaleParticleStartColor(value: unknown, opacity: number, layerId: string): unknown {
  if (value === undefined) {
    return [ValueType.RGBA_COLOR, [1, 1, 1, roundNumber(opacity, 4)]];
  }
  if (isFiniteNumberTuple(value, 4)) {
    return scaleColorTuple(value, opacity);
  }
  if (!Array.isArray(value) || value.length !== 2) {
    throwInvalidStartColor(layerId);
  }

  const expression: unknown[] = value;
  const type = expression[0];
  const payload = expression[1];

  if (type === ValueType.RGBA_COLOR && isFiniteNumberTuple(payload, 4)) {
    return [type, scaleColorTuple(payload, opacity)];
  }
  if (type === ValueType.GRADIENT_COLOR && Array.isArray(payload) && payload.every(isGradientStop)) {
    return [type, payload.map(stop => scaleGradientStop(stop, opacity))];
  }
  if (type === ValueType.COLORS && Array.isArray(payload) && payload.every(color => isFiniteNumberTuple(color, 4))) {
    return [type, payload.map(color => scaleColorTuple(color, opacity))];
  }

  return throwInvalidStartColor(layerId);
}

function scaleColorTuple(color: number[], opacity: number): number[] {
  return [color[0], color[1], color[2], roundNumber(color[3] * opacity, 4)];
}

function isGradientStop(value: unknown): value is number[] {
  return isFiniteNumberTuple(value, 5);
}

function scaleGradientStop(stop: number[], opacity: number): number[] {
  return [stop[0], stop[1], stop[2], stop[3], roundNumber(stop[4] * opacity, 4)];
}

function isFiniteNumberTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length &&
    value.every(entry => typeof entry === 'number' && Number.isFinite(entry));
}

function throwInvalidStartColor(layerId: string): never {
  throw new TypeError(
    `[ge-ir] Particle layer '${layerId}' has an unsupported preserved options.startColor value; ` +
    'static Layer opacity could not be applied safely.',
  );
}

import type { IRAnimatedProperty, IRLayer, IRPropertyValue, IRVec3 } from '@galacean/animation-ir';
import { throwInvalidLayerData, throwUnsupportedLayerFeature } from '../diagnostics/collect-warnings';
import { IDENTITY_MATRIX, multiplyMatrices, type LayerMatrix } from '../../matrix';

export interface StaticLayerState { matrix: LayerMatrix; opacity: number; visible: boolean }

function readStaticValue<T extends IRPropertyValue>(property: IRAnimatedProperty<T> | undefined, fallback: T): T {
  if (property == null) { return fallback; }
  if (property.type === 'static') { return property.value; }
  if (property.keyframes.length === 1) { return property.keyframes[0].value; }

  return throwUnsupportedLayerFeature('Animated properties are not sampled by static layers output.');
}

export function buildIRStaticStateResolver(
  layers: ReadonlyMap<string, IRLayer>,
  inPoint: number,
): (layer: IRLayer) => StaticLayerState {
  const resolving = new Set<string>();
  const matrices = new Map<string, LayerMatrix>();
  const resolveMatrix = (layer: IRLayer): LayerMatrix => {
    const cached = matrices.get(layer.id);

    if (cached != null) { return cached; }
    if (resolving.has(layer.id)) { throwInvalidLayerData('Cyclic IR parent reference.'); }
    resolving.add(layer.id);
    try {
      const transform = layer.transform;
      const position = readStaticValue<IRVec3>(transform?.position, [0, 0, 0]);
      const anchor = transform?.anchor?.value ?? [0, 0, 0];
      const scale = readStaticValue<IRVec3>(transform?.scale, [1, 1, 1]);
      const x = readStaticValue(transform?.rotation?.x, 0);
      const y = readStaticValue(transform?.rotation?.y, 0);
      const z = readStaticValue(transform?.rotation?.z, 0);

      if (position[2] !== 0 || anchor[2] !== 0 || x !== 0 || y !== 0) {
        throwUnsupportedLayerFeature('3D transforms cannot be expressed by flat pixel layers.');
      }
      const angle = z * Math.PI / 180;
      const local: LayerMatrix = {
        a: Math.cos(angle) * scale[0], b: Math.sin(angle) * scale[0],
        c: -Math.sin(angle) * scale[1], d: Math.cos(angle) * scale[1],
        e: position[0], f: position[1],
      };

      local.e -= local.a * anchor[0] + local.c * anchor[1];
      local.f -= local.b * anchor[0] + local.d * anchor[1];
      const parent = layer.parentId == null ? undefined : layers.get(layer.parentId);

      if (layer.parentId != null && parent == null) { throwInvalidLayerData('Missing IR parent layer.'); }
      const matrix = multiplyMatrices(parent == null ? IDENTITY_MATRIX : resolveMatrix(parent), local);

      matrices.set(layer.id, matrix);

      return matrix;
    } finally {
      resolving.delete(layer.id);
    }
  };

  return layer => {
    if (layer.time.inFrame !== inPoint) {
      throwUnsupportedLayerFeature('Delayed activation is not sampled by static layers output.');
    }

    // IR parentId 仅继承变换，显隐和透明度由图层自身定义。
    return {
      matrix: resolveMatrix(layer), opacity: readStaticValue(layer.transform?.opacity, 1), visible: layer.visible,
    };
  };
}

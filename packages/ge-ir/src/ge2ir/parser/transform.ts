import type { IRTransform, IRVec3 } from '@galacean/animation-ir';
import { convert3dTo2dPoint } from '../../common/coordinate-mapping';
import type { GESceneContext } from '../types';

export function parseStaticTransform(
  itemTransform: Record<string, unknown>,
  ctx: GESceneContext,
): Partial<IRTransform> {
  const channels: Partial<IRTransform> = {};

  const position = itemTransform['position'] as { x: number; y: number; z: number } | undefined;

  if (position != null) {
    const position2d = convert3dTo2dPoint(position.x, position.y, position.z ?? 0, ctx.width, ctx.height);

    channels.position = { type: 'static', value: position2d };
  }

  const scale = itemTransform['scale'] as { x: number; y: number; z: number } | undefined;

  if (scale != null) {
    const scaleValue: IRVec3 = [scale.x ?? 1, scale.y ?? 1, scale.z ?? 1];
    const isDefault = scaleValue.every(value => Math.abs(value - 1) < 1e-6);

    if (!isDefault) {
      channels.scale = { type: 'static', value: scaleValue };
    }
  }

  const eulerHint = itemTransform['eulerHint'] as { x: number; y: number; z: number } | undefined;

  if (eulerHint != null) {
    const x = Math.abs(eulerHint.x) > 1e-6 ? { type: 'static' as const, value: eulerHint.x } : undefined;
    const y = Math.abs(eulerHint.y) > 1e-6 ? { type: 'static' as const, value: eulerHint.y } : undefined;
    const z = Math.abs(eulerHint.z) > 1e-6 ? { type: 'static' as const, value: eulerHint.z } : undefined;

    if (x != null || y != null || z != null) {
      channels.rotation = {
        ...(x != null && { x }),
        ...(y != null && { y }),
        ...(z != null && { z }),
      };
    }
  }

  return channels;
}

import type { IRShape } from '@galacean/animation-ir';

export function expectShapePrimitive<T extends IRShape['primitiveType']>(
  shape: IRShape | undefined,
  primitiveType: T,
): Extract<IRShape, { primitiveType: T }> {
  if (shape?.primitiveType !== primitiveType) {
    throw new Error(`Expected ${primitiveType} shape, received ${shape?.primitiveType ?? 'undefined'}`);
  }

  return shape as Extract<IRShape, { primitiveType: T }>;
}

export function minimalTransform(position: number[] = [0, 0], scale: number[] = [100, 100]): Record<string, unknown> {
  return {
    ty: 'tr',
    p: { k: position },
    s: { k: scale },
    r: { k: 0 },
    o: { k: 100 },
    a: { k: [0, 0] },
  };
}

export function solidFill(color: number[] = [1, 0, 0, 1], opacity = 100): Record<string, unknown> {
  return { ty: 'fl', c: { k: color }, o: { k: opacity } };
}

export function solidStroke(
  color: number[] = [0, 0, 0, 1],
  width = 1,
  opacity = 100,
  lineCap?: number,
  lineJoin?: number,
): Record<string, unknown> {
  return {
    ty: 'st',
    c: { k: color },
    o: { k: opacity },
    w: { k: width },
    lc: lineCap,
    lj: lineJoin,
  };
}

import type { IRLocalBounds, IRMask } from '@galacean/animation-ir';

/** 完全覆盖图片的直边矩形 mask 不改变可见内容。 */
export function maskCoversImage(mask: IRMask, bounds: IRLocalBounds): boolean {
  const { path } = mask;
  const epsilon = 1e-6;

  if (mask.mode === 'subtract' || mask.inverted === true || !path.closed || path.points.length !== 4) {
    return false;
  }
  if (path.inTangents.length !== 4 || path.outTangents.length !== 4
    || [...path.inTangents, ...path.outTangents].some(tangent => tangent.x !== 0 || tangent.y !== 0)) {
    return false;
  }
  const straightEdges = path.points.every((point, index) => {
    const next = path.points[(index + 1) % 4];
    const opposite = path.points[(index + 2) % 4];
    const dx = Math.abs(next.x - point.x);
    const dy = Math.abs(next.y - point.y);

    return Number.isFinite(point.x) && Number.isFinite(point.y)
      && Math.abs(opposite.x - point.x) > epsilon && Math.abs(opposite.y - point.y) > epsilon
      && ((dx <= epsilon && dy > epsilon) || (dy <= epsilon && dx > epsilon));
  });

  if (!straightEdges) { return false; }
  const xs = path.points.map(point => point.x);
  const ys = path.points.map(point => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return bounds.width > 0 && bounds.height > 0
    && left <= bounds.x + epsilon && right >= bounds.x + bounds.width - epsilon
    && top <= bounds.y + epsilon && bottom >= bounds.y + bounds.height - epsilon;
}

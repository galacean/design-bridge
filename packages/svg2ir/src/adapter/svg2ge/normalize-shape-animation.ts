import type { IRBezierPath } from '@galacean/animation-ir';
import type { SVGPreservedShapeAnimation } from '../../svg-preserved-data';

export function normalizeShapeAnimationForGE (animation: SVGPreservedShapeAnimation): SVGPreservedShapeAnimation | undefined {
  const keyframes = animation.keyframes;
  const maxPathCount = Math.max(0, ...keyframes.map(keyframe => keyframe.paths.length));

  if (maxPathCount === 0 || (maxPathCount > 1 && keyframes.some(keyframe => keyframe.paths.length !== maxPathCount))) {
    return undefined;
  }
  const maxPointCounts = Array.from({ length: maxPathCount }, (_, pathIndex) => Math.max(
    0,
    ...keyframes.map(keyframe => keyframe.paths[pathIndex]?.points.length ?? 0),
  ));

  if (maxPointCounts.some(count => count === 0)) { return undefined; }
  const needsPadding = keyframes.some(keyframe => keyframe.paths.length !== maxPathCount
    || keyframe.paths.some((path, pathIndex) => path.points.length !== maxPointCounts[pathIndex]));

  if (!needsPadding) { return animation; }
  const templatePath = keyframes.flatMap(keyframe => keyframe.paths)[0];
  const fallbackPoint = templatePath?.points[0] ?? { x: 0, y: 0 };
  const fallbackClosed = templatePath?.closed ?? false;

  return {
    ...animation,
    keyframes: keyframes.map(keyframe => ({
      ...keyframe,
      paths: Array.from({ length: maxPathCount }, (_, pathIndex) => {
        const path = keyframe.paths[pathIndex];

        return path == null
          ? createDegeneratePath(maxPointCounts[pathIndex], fallbackPoint, fallbackClosed)
          : padPath(path, maxPointCounts[pathIndex]);
      }),
    })),
  };
}

function createDegeneratePath (
  pointCount: number,
  point: { x: number; y: number },
  closed: boolean,
): IRBezierPath {
  return {
    closed,
    points: Array.from({ length: pointCount }, () => ({ ...point })),
    inTangents: Array.from({ length: pointCount }, () => ({ x: 0, y: 0 })),
    outTangents: Array.from({ length: pointCount }, () => ({ x: 0, y: 0 })),
  };
}

function padPath (path: SVGPreservedShapeAnimation['keyframes'][number]['paths'][number], pointCount: number): IRBezierPath {
  const lastPoint = path.points.at(-1) ?? { x: 0, y: 0 };
  const missingCount = pointCount - path.points.length;

  if (missingCount <= 0) {
    return {
      ...path,
      points: [...path.points],
      inTangents: [...path.inTangents],
      outTangents: [...path.outTangents],
    };
  }

  return {
    ...path,
    points: [
      ...path.points,
      ...Array.from({ length: missingCount }, () => ({ ...lastPoint })),
    ],
    inTangents: [
      ...path.inTangents,
      ...Array.from({ length: missingCount }, () => ({ x: 0, y: 0 })),
    ],
    outTangents: [
      ...path.outTangents,
      ...Array.from({ length: missingCount }, () => ({ x: 0, y: 0 })),
    ],
  };
}

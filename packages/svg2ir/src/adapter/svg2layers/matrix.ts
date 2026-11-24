import type { SVGLayerBBox } from './types';
import { throwInvalidLayerData } from './converter/diagnostics/collect-warnings';

export interface LayerMatrix {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
}
export type LayerPoint = [number, number];

export const IDENTITY_MATRIX: LayerMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiplyMatrices(parent: LayerMatrix, local: LayerMatrix): LayerMatrix {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    e: parent.a * local.e + parent.c * local.f + parent.e,
    f: parent.b * local.e + parent.d * local.f + parent.f,
  };
}

export function transformPoint(matrix: LayerMatrix, x: number, y: number): LayerPoint {
  return [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f];
}

export function transformBoxCorners(matrix: LayerMatrix, box: SVGLayerBBox): LayerPoint[] {
  return [
    transformPoint(matrix, box[0], box[1]), transformPoint(matrix, box[2], box[1]),
    transformPoint(matrix, box[2], box[3]), transformPoint(matrix, box[0], box[3]),
  ];
}

export function mapPointsToBBox(points: readonly LayerPoint[], roundCoordinates = true): SVGLayerBBox {
  const bbox: SVGLayerBBox = [
    Math.min(...points.map(point => point[0])), Math.min(...points.map(point => point[1])),
    Math.max(...points.map(point => point[0])), Math.max(...points.map(point => point[1])),
  ];

  if (bbox.some(value => !Number.isFinite(value))) { throwInvalidLayerData('Non-finite pixel geometry.'); }
  if (!roundCoordinates) { return bbox; }

  return [roundPixel(bbox[0]), roundPixel(bbox[1]), roundPixel(bbox[2]), roundPixel(bbox[3])];
}

export function roundPixel(value: number): number {
  if (!Number.isFinite(value)) { throwInvalidLayerData('Non-finite pixel geometry.'); }
  const result = Math.round(value * 100) / 100;

  return Object.is(result, -0) ? 0 : result;
}

import type { JSONScene } from '@galacean/effects-specification';
import { get2dTo3dRatio } from '@galacean/ge-ir';

function isRecord (value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** 修正 ge-ir 2D→3D 坐标映射后的 SVG 归一化渐变坐标。 */
export function restoreGradientUV (scene: JSONScene, compositionWidth: number, compositionHeight: number): void {
  const ratio = get2dTo3dRatio(compositionWidth, compositionHeight);

  if (ratio === 0) { return; }
  for (const component of scene.components) {
    if (!isRecord(component)) { continue; }
    const shapeFills = Array.isArray(component['fills'])
      ? component['fills'].filter(isRecord)
      : undefined;
    const shapeStrokes = Array.isArray(component['strokes'])
      ? component['strokes'].filter(isRecord)
      : undefined;

    for (const paints of [shapeFills, shapeStrokes]) {
      if (!Array.isArray(paints)) { continue; }

      for (const paint of paints) {
        if (paint == null || paint['startPoint'] == null) { continue; }

        if (isRecord(paint['startPoint']) && isRecord(paint['endPoint'])) {
          restoreUV(paint['startPoint'], ratio);
          restoreUV(paint['endPoint'], ratio);
        }
      }
    }
  }
}

function restoreUV (point: Record<string, unknown>, ratio: number): void {
  if (typeof point.x !== 'number' || typeof point.y !== 'number') { return; }
  point.x /= ratio;
  point.y = -point.y / ratio;
}

import { CameraClipMode } from '@galacean/effects-specification';

/** Default camera Z position for 2D GE scenes. */
export const DEFAULT_CAMERA_Z = 8;
/** Default camera field of view for 2D GE scenes. */
export const DEFAULT_CAMERA_FOV = 60;
/** Default camera clipping mode for 2D GE scenes. */
export const DEFAULT_CLIP_MODE = CameraClipMode.portrait;

/** GE 3.7 text layout converts glyph pixels to world units before applying item scale. */
export const TEXT_WORLD_UNITS_PER_PIXEL = 0.0123;

/** Return the pixel-to-world scale for the given canvas. */
export function get2dTo3dRatio(width: number, height: number): number {
  let ratio = (2 / height) * DEFAULT_CAMERA_Z * Math.tan((DEFAULT_CAMERA_FOV / 2) * (Math.PI / 180)) + 1e-6;

  if (DEFAULT_CLIP_MODE === CameraClipMode.portrait) {
    ratio *= height / width;
  }

  return ratio;
}

/**
 * Convert a canvas point from a top-left origin to GE world space with a centered
 * origin and inverted Y axis. The Z value is included in the perspective adjustment.
 */
export function convert2dTo3dPoint(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): [number, number, number] {
  const ratio = get2dTo3dRatio(width, height);
  const adaptRatioZ = (DEFAULT_CAMERA_Z - z) / DEFAULT_CAMERA_Z;
  const offsetX = (x - width / 2.0) * ratio * adaptRatioZ;
  const offsetY = (height / 2.0 - y) * ratio * adaptRatioZ;

  return [offsetX, offsetY, z];
}

/**
 * Convert a GE world-space point to a top-left canvas coordinate while
 * preserving its perspective-adjusted Z value.
 */
export function convert3dTo2dPoint(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): [number, number, number] {
  const ratio = get2dTo3dRatio(width, height);
  const adaptRatioZ = (DEFAULT_CAMERA_Z - z) / DEFAULT_CAMERA_Z;
  const effectiveRatio = Math.abs(adaptRatioZ) > 1e-10 ? ratio * adaptRatioZ : ratio;
  const pixelX = x / effectiveRatio + width / 2;
  const pixelY = height / 2 - y / effectiveRatio;

  return [pixelX, pixelY, z];
}

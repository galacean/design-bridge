import { prepareSVGSnapshot, type SVGSnapshotContext } from './prepare-snapshot';

interface RasterizedSVG {
  url: string;
  /** Logical viewport pixels, independent of raster resolution. */
  bbox: [number, number, number, number];
}

/** Render an SVG subtree as a cropped PNG, or return null if it has no visible pixels. */
export async function rasterizeSVG(
  source: string,
  path: string,
  size: [number, number],
  scale = 2,
  inspect?: (context: SVGSnapshotContext) => void,
): Promise<RasterizedSVG | null> {
  if (!Number.isFinite(scale) || scale <= 0) { throw new RangeError('rasterScale must be finite and positive.'); }
  if (Math.ceil(size[0] * scale) * Math.ceil(size[1] * scale) > 16_777_216) {
    throw new RangeError('SVG rasterization exceeds the 16 megapixel working limit; reduce rasterScale.');
  }
  const snapshot = prepareSVGSnapshot(source, path, size, inspect);
  const canvas = await renderSVG(snapshot, size, scale);

  return cropRasterImage(canvas, scale);
}

/** No DOM access at module initialization: the Node entry also imports this module. */
export function canRasterizeSVG(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
    && typeof window.HTMLCanvasElement === 'function' && typeof window.Image === 'function'
    && typeof window.getComputedStyle === 'function';
}

async function renderSVG(svg: string, size: [number, number], scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');

  canvas.width = Math.ceil(size[0] * scale);
  canvas.height = Math.ceil(size[1] * scale);
  const context = canvas.getContext('2d');

  if (context == null) { throw new Error('A 2D canvas context is required for SVG rasterization.'); }
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The prepared SVG could not be decoded.'));
      image.src = url;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Trim transparent pixels after rendering, retaining strokes, blur and filter extents. */
function cropRasterImage(canvas: HTMLCanvasElement, scale: number): RasterizedSVG | null {
  const context = canvas.getContext('2d');

  if (context == null) { throw new Error('A 2D canvas context is required for SVG rasterization.'); }
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let top = canvas.height;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] === 0) { continue; }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (right <= left || bottom <= top) { return null; }
  const cropped = document.createElement('canvas');

  cropped.width = right - left;
  cropped.height = bottom - top;
  const croppedContext = cropped.getContext('2d');

  if (croppedContext == null) { throw new Error('A 2D canvas context is required for SVG rasterization.'); }
  croppedContext.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);

  return { url: cropped.toDataURL('image/png'), bbox: [left / scale, top / scale, right / scale, bottom / scale] };
}

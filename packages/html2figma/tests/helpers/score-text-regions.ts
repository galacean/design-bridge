interface GrayscaleImage {
  width: number;
  height: number;
  pixels: ArrayLike<number>;
}

interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Supplement the historical host-box score with independently measured DOM text ranges.
// Pixels are normalized luma values in [0, 1]; this is a local renderer diagnostic, not Figma acceptance.
export function scoreTextRegions(
  reference: GrayscaleImage, actual: GrayscaleImage, regions: TextRegion[],
): number | null {
  const { width, height } = reference;

  if (actual.width !== width || actual.height !== height ||
      reference.pixels.length !== width * height || actual.pixels.length !== width * height) {
    throw new Error('Text scoring requires matching image dimensions.');
  }
  const scores: number[] = [];

  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x));
    const top = Math.max(0, Math.floor(region.y));
    const right = Math.min(width, Math.ceil(region.x + region.width));
    const bottom = Math.min(height, Math.ceil(region.y + region.height));
    const blocks: number[] = [];

    for (let y = top; y < bottom; y += 8) {
      for (let x = left; x < right; x += 8) {
        let a = 0, b = 0, aa = 0, bb = 0, ab = 0, count = 0;

        for (let yy = y; yy < Math.min(y + 8, bottom); yy++) {
          for (let xx = x; xx < Math.min(x + 8, right); xx++) {
            const av = reference.pixels[yy * width + xx];
            const bv = actual.pixels[yy * width + xx];

            a += av;
            b += bv;
            aa += av * av;
            bb += bv * bv;
            ab += av * bv;
            count++;
          }
        }
        if (count < 2) {
          continue;
        }
        const ma = a / count, mb = b / count;
        const va = Math.max(0, aa / count - ma * ma), vb = Math.max(0, bb / count - mb * mb);
        const covariance = ab / count - ma * mb;

        blocks.push(((2 * ma * mb + 0.0001) * (2 * covariance + 0.0009)) /
          ((ma * ma + mb * mb + 0.0001) * (va + vb + 0.0009)));
      }
    }
    if (blocks.length > 0) {
      scores.push(Math.max(0, Math.min(100, blocks.reduce((sum, value) => sum + value, 0) / blocks.length * 100)));
    }
  }

  return scores.length === 0 ? null : scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

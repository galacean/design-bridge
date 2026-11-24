// ─── 对比结果 ───

export interface CompareResult {
  /** Maximum difference density in a local window, excluding antialiasing. */
  localDiffDensity?: number;
  /** 全图原始 MS-SSIM（不裁剪、不模糊、不降权） */
  fullSsim: number;
  /** 核心 ROI MS-SSIM（去掉四周 10% 边缘，严格比主体） */
  coreRoiSsim: number;
  /** 模糊后全图 MS-SSIM（Gaussian blur sigma≈3 后再算，降低粒子/光效噪声） */
  blurredSsim: number;
  /** Alpha 轮廓 IoU（基于 alpha 通道的不透明区域轮廓比较） */
  edgeIoU: number;
  /** Visible RGB and alpha difference area, with per-channel tolerance. */
  pixelDiffRatio: number;
  /** 差异热力图 data URL */
  diffDataUrl: string;
}

interface CompareOptions {
  localDiffDensity?: boolean;
}

// ─── SSIM 常量 ───
const SSIM_K1 = 0.01;
const SSIM_K2 = 0.03;
const SSIM_L = 255;
const SSIM_C1 = (SSIM_K1 * SSIM_L) ** 2;
const SSIM_C2 = (SSIM_K2 * SSIM_L) ** 2;
const SSIM_C3 = SSIM_C2 / 2;
const SSIM_WINDOW_SIZE = 8;
const MS_SSIM_WEIGHTS = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333];

// 核心 ROI 边距比例（四周各去掉 10%）
const ROI_MARGIN_RATIO = 0.1;

// RGB 像素差异通道阈值（50 可过滤光效/粒子/抗锯齿的合理渲染差异）
const PIXEL_DIFF_CHANNEL_THRESHOLD = 50;

// ─── 基础工具 ───

function toGrayscale(pixels: Uint8Array, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height);

  for (let i = 0; i < gray.length; i++) {
    const offset = i * 4;

    const alpha = pixels[offset + 3] / 255;

    // Composite over the same black matte used by the frame previews.
    gray[i] = (0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2]) * alpha;
  }

  return gray;
}

/** 提取 ROI 区域的灰度数据 */
function extractRoi(
  gray: Float32Array,
  fullWidth: number,
  x: number,
  y: number,
  roiWidth: number,
  roiHeight: number,
): Float32Array {
  const roi = new Float32Array(roiWidth * roiHeight);

  for (let row = 0; row < roiHeight; row++) {
    for (let col = 0; col < roiWidth; col++) {
      roi[row * roiWidth + col] = gray[(y + row) * fullWidth + (x + col)];
    }
  }

  return roi;
}

/**
 * 简易 Gaussian blur（separable, sigma≈3）。
 * 使用 7×7 近似核，先水平再垂直。
 */
function gaussianBlur(gray: Float32Array, width: number, height: number): Float32Array {
  // 7-tap kernel for sigma≈3 (unnormalized, will normalize)
  const kernel = [1, 6, 15, 20, 15, 6, 1];
  const kernelSum = kernel.reduce((a, b) => a + b, 0);
  const radius = 3;

  // 水平pass
  const horizontal = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;

      for (let k = 0; k < kernel.length; k++) {
        const srcX = Math.min(width - 1, Math.max(0, x + k - radius));

        sum += gray[y * width + srcX] * kernel[k];
      }
      horizontal[y * width + x] = sum / kernelSum;
    }
  }

  // 垂直pass
  const result = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;

      for (let k = 0; k < kernel.length; k++) {
        const srcY = Math.min(height - 1, Math.max(0, y + k - radius));

        sum += horizontal[srcY * width + x] * kernel[k];
      }
      result[y * width + x] = sum / kernelSum;
    }
  }

  return result;
}

function downsample2x(
  gray: Float32Array,
  width: number,
  height: number,
): { data: Float32Array; width: number; height: number } {
  const newWidth = Math.floor(width / 2);
  const newHeight = Math.floor(height / 2);
  const result = new Float32Array(newWidth * newHeight);

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = x * 2;
      const srcY = y * 2;

      result[y * newWidth + x] =
        (gray[srcY * width + srcX] +
          gray[srcY * width + srcX + 1] +
          gray[(srcY + 1) * width + srcX] +
          gray[(srcY + 1) * width + srcX + 1]) *
        0.25;
    }
  }

  return { data: result, width: newWidth, height: newHeight };
}

// ─── SSIM 计算 ───

interface WindowStats {
  meanA: number;
  meanB: number;
  varianceA: number;
  varianceB: number;
  covariance: number;
}

function computeWindowStats(
  grayA: Float32Array,
  grayB: Float32Array,
  width: number,
  startX: number,
  startY: number,
  windowSize: number,
): WindowStats {
  let sumA = 0,
    sumB = 0,
    sumA2 = 0,
    sumB2 = 0,
    sumAB = 0;
  const count = windowSize * windowSize;

  for (let dy = 0; dy < windowSize; dy++) {
    for (let dx = 0; dx < windowSize; dx++) {
      const idx = (startY + dy) * width + (startX + dx);
      const a = grayA[idx],
        b = grayB[idx];

      sumA += a;
      sumB += b;
      sumA2 += a * a;
      sumB2 += b * b;
      sumAB += a * b;
    }
  }

  const meanA = sumA / count,
    meanB = sumB / count;

  return {
    meanA,
    meanB,
    varianceA: sumA2 / count - meanA * meanA,
    varianceB: sumB2 / count - meanB * meanB,
    covariance: sumAB / count - meanA * meanB,
  };
}

function luminance(s: WindowStats): number {
  return (2 * s.meanA * s.meanB + SSIM_C1) / (s.meanA ** 2 + s.meanB ** 2 + SSIM_C1);
}

function contrast(s: WindowStats): number {
  const sigA = Math.sqrt(Math.max(0, s.varianceA));
  const sigB = Math.sqrt(Math.max(0, s.varianceB));

  return (2 * sigA * sigB + SSIM_C2) / (s.varianceA + s.varianceB + SSIM_C2);
}

function structure(s: WindowStats): number {
  const sigA = Math.sqrt(Math.max(0, s.varianceA));
  const sigB = Math.sqrt(Math.max(0, s.varianceB));

  return (s.covariance + SSIM_C3) / (sigA * sigB + SSIM_C3);
}

function computeScaleComponents(
  grayA: Float32Array,
  grayB: Float32Array,
  width: number,
  height: number,
): { lum: number; con: number; str: number; ssimMap: Float32Array; mapW: number; mapH: number } {
  const ws = SSIM_WINDOW_SIZE;
  const mapW = Math.max(1, Math.floor((width - ws) / ws) + 1);
  const mapH = Math.max(1, Math.floor((height - ws) / ws) + 1);
  const ssimMap = new Float32Array(mapW * mapH);
  let lumSum = 0,
    conSum = 0,
    strSum = 0,
    count = 0;

  for (let my = 0; my < mapH; my++) {
    for (let mx = 0; mx < mapW; mx++) {
      const sx = mx * ws,
        sy = my * ws;

      if (sx + ws > width || sy + ws > height) {
        continue;
      }
      const stats = computeWindowStats(grayA, grayB, width, sx, sy, ws);

      const lumVal = luminance(stats);
      const conVal = contrast(stats);
      const strVal = structure(stats);

      lumSum += lumVal;
      conSum += conVal;
      strSum += strVal;
      ssimMap[my * mapW + mx] = lumVal * conVal * strVal;
      count++;
    }
  }

  return count === 0
    ? { lum: 1, con: 1, str: 1, ssimMap, mapW, mapH }
    : { lum: lumSum / count, con: conSum / count, str: strSum / count, ssimMap, mapW, mapH };
}

/** 计算 MS-SSIM，返回分值 + 原始尺度的 SSIM map */
function computeMsSsim(
  grayA: Float32Array,
  grayB: Float32Array,
  width: number,
  height: number,
): { score: number; ssimMap: Float32Array; mapW: number; mapH: number } {
  let curA = grayA,
    curB = grayB,
    curW = width,
    curH = height;
  const minDim = Math.min(width, height);
  const scaleCount = Math.max(
    1,
    Math.min(MS_SSIM_WEIGHTS.length, Math.floor(Math.log2(minDim / SSIM_WINDOW_SIZE)) + 1),
  );
  const weights = MS_SSIM_WEIGHTS.slice(0, scaleCount);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const normWeights = weights.map(w => w / wSum);

  let result = 1;
  let firstMap: Float32Array | null = null;
  let firstMapW = 0,
    firstMapH = 0;

  for (let s = 0; s < scaleCount; s++) {
    const { lum, con, str, ssimMap, mapW, mapH } = computeScaleComponents(curA, curB, curW, curH);

    if (s === 0) {
      firstMap = ssimMap;
      firstMapW = mapW;
      firstMapH = mapH;
    }

    const w = normWeights[s];

    result *=
      s === scaleCount - 1
        ? Math.pow(Math.max(0, lum), w) * Math.pow(Math.max(0, con), w) * Math.pow(Math.max(0, str), w)
        : Math.pow(Math.max(0, con), w) * Math.pow(Math.max(0, str), w);

    if (s < scaleCount - 1) {
      const dA = downsample2x(curA, curW, curH);
      const dB = downsample2x(curB, curW, curH);

      curA = dA.data;
      curB = dB.data;
      curW = dA.width;
      curH = dA.height;
    }
  }

  return {
    score: Math.max(0, Math.min(1, result)),
    ssimMap: firstMap ?? new Float32Array(0),
    mapW: firstMapW,
    mapH: firstMapH,
  };
}

// ─── 5 指标计算 ───

/**
 * 指标: 核心 ROI MS-SSIM
 * 去掉四周 10% 边缘区域，只比较主体内容。
 */
function computeCoreRoiSsim(grayA: Float32Array, grayB: Float32Array, width: number, height: number): number {
  const marginX = Math.round(width * ROI_MARGIN_RATIO);
  const marginY = Math.round(height * ROI_MARGIN_RATIO);
  const roiW = width - 2 * marginX;
  const roiH = height - 2 * marginY;

  if (roiW < SSIM_WINDOW_SIZE || roiH < SSIM_WINDOW_SIZE) {
    return computeMsSsim(grayA, grayB, width, height).score;
  }

  const roiA = extractRoi(grayA, width, marginX, marginY, roiW, roiH);
  const roiB = extractRoi(grayB, width, marginX, marginY, roiW, roiH);

  return computeMsSsim(roiA, roiB, roiW, roiH).score;
}

/**
 * 指标 2: 模糊后全图 MS-SSIM
 * 两图先做 Gaussian blur (sigma≈3) 再算 MS-SSIM。
 * 降低粒子、光效、羽化差异的影响。
 */
function computeBlurredSsim(grayA: Float32Array, grayB: Float32Array, width: number, height: number): number {
  const blurA = gaussianBlur(grayA, width, height);
  const blurB = gaussianBlur(grayB, width, height);

  return computeMsSsim(blurA, blurB, width, height).score;
}

/** Ignore invisible RGB while retaining alpha amplitude differences on any matte. */
function computePixelDiffRatio(pixelsA: Uint8Array, pixelsB: Uint8Array, width: number, height: number): number {
  const totalPixels = width * height;
  let diffCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;

    if (getVisiblePixelDifference(pixelsA, pixelsB, offset) > PIXEL_DIFF_CHANNEL_THRESHOLD) {
      diffCount++;
    }
  }

  return totalPixels > 0 ? diffCount / totalPixels : 0;
}

function getVisiblePixelDifference(pixelsA: Uint8Array, pixelsB: Uint8Array, offset: number): number {
  const alphaA = pixelsA[offset + 3] / 255;
  const alphaB = pixelsB[offset + 3] / 255;

  return Math.max(
    Math.abs(pixelsA[offset] * alphaA - pixelsB[offset] * alphaB),
    Math.abs(pixelsA[offset + 1] * alphaA - pixelsB[offset + 1] * alphaB),
    Math.abs(pixelsA[offset + 2] * alphaA - pixelsB[offset + 2] * alphaB),
    Math.abs(pixelsA[offset + 3] - pixelsB[offset + 3]),
  );
}

/**
 * 指标: Alpha 轮廓 IoU
 *
 * 基于 alpha 通道的不透明区域轮廓比较，而非灰度 Sobel 边缘。
 *
 * 原理：
 * - 遮罩错误 → 不透明区域形状变化 → alpha 轮廓不同 → IoU 下降
 * - 光效差异 → 只改变 RGB 亮度，不改变主体 alpha 形状 → IoU 不受影响
 *
 * 步骤：
 * 1. 提取两图的 alpha 通道
 * 2. 二值化（alpha > 10 → 不透明）
 * 3. 对二值 alpha 图做形态学边缘检测（膨胀 - 原图 = 外轮廓）
 * 4. 比较轮廓像素的 IoU
 *
 * 为了对轻微抗锯齿差异容忍，对轮廓做 3px 膨胀后再比较。
 */
function computeEdgeIoU(pixelsA: Uint8Array, pixelsB: Uint8Array, width: number, height: number): number {
  const alphaThreshold = 10;

  // 提取二值 alpha
  const binaryA = new Uint8Array(width * height);
  const binaryB = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    binaryA[i] = pixelsA[i * 4 + 3] > alphaThreshold ? 1 : 0;
    binaryB[i] = pixelsB[i * 4 + 3] > alphaThreshold ? 1 : 0;
  }

  // 提取外轮廓：不透明像素且相邻有透明像素
  const contourA = extractContour(binaryA, width, height);
  const contourB = extractContour(binaryB, width, height);

  // 对轮廓做 3px 膨胀，容忍抗锯齿/亚像素差异
  const dilatedA = dilateContour(contourA, width, height, 3);
  const dilatedB = dilateContour(contourB, width, height, 3);

  // 计算容忍后的 IoU
  // A 的轮廓像素是否在 B 的膨胀轮廓内（反之亦然）
  let matchedA = 0;
  let matchedB = 0;
  let totalA = 0;
  let totalB = 0;

  for (let i = 0; i < width * height; i++) {
    if (contourA[i]) {
      totalA++;
      if (dilatedB[i]) {
        matchedA++;
      }
    }
    if (contourB[i]) {
      totalB++;
      if (dilatedA[i]) {
        matchedB++;
      }
    }
  }

  // 双向匹配率的调和平均（F1-score 形式）
  if (totalA === 0 && totalB === 0) {
    return 1;
  }
  if (totalA === 0 || totalB === 0) {
    return 0;
  }

  const precisionAtoB = matchedA / totalA;
  const precisionBtoA = matchedB / totalB;

  // 取较低值作为最终分数（任一方向不匹配都意味着轮廓差异）
  return Math.min(precisionAtoB, precisionBtoA);
}

/** 提取二值图的外轮廓：不透明像素且 4-邻域中存在透明像素 */
function extractContour(binary: Uint8Array, width: number, height: number): Uint8Array {
  const contour = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (!binary[idx]) {
        continue;
      }

      // 检查 4-邻域是否存在透明像素（或在边界上）
      const hasTransparentNeighbor =
        x === 0 ||
        x === width - 1 ||
        y === 0 ||
        y === height - 1 ||
        !binary[(y - 1) * width + x] ||
        !binary[(y + 1) * width + x] ||
        !binary[y * width + (x - 1)] ||
        !binary[y * width + (x + 1)];

      if (hasTransparentNeighbor) {
        contour[idx] = 1;
      }
    }
  }

  return contour;
}

/** 对轮廓做正方形膨胀（半径 r 像素） */
function dilateContour(contour: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dilated = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!contour[y * width + x]) {
        continue;
      }

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;

          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            dilated[ny * width + nx] = 1;
          }
        }
      }
    }
  }

  return dilated;
}

// ─── 热力图 ───

function generateDiffHeatmap(
  ssimMap: Float32Array,
  mapW: number,
  mapH: number,
  imageWidth: number,
  imageHeight: number,
  pixelsA: Uint8Array,
  pixelsB: Uint8Array,
): string {
  const canvas = document.createElement('canvas');

  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const ctx = canvas.getContext('2d');

  if (ctx == null) {
    throw new Error('Canvas 2D context is unavailable for the difference heatmap');
  }
  const imageData = ctx.createImageData(imageWidth, imageHeight);
  const data = imageData.data;
  const step = SSIM_WINDOW_SIZE;

  for (let my = 0; my < mapH; my++) {
    for (let mx = 0; mx < mapW; mx++) {
      const val = ssimMap[my * mapW + mx];
      const startX = mx * step,
        startY = my * step;

      for (let dy = 0; dy < step && startY + dy < imageHeight; dy++) {
        for (let dx = 0; dx < step && startX + dx < imageWidth; dx++) {
          const pi = ((startY + dy) * imageWidth + (startX + dx)) * 4;
          const intensity = Math.max(0, 1 - val, getVisiblePixelDifference(pixelsA, pixelsB, pi) / 255);

          data[pi] = Math.round(255 * Math.min(1, intensity * 2));
          data[pi + 1] = Math.round(50 * intensity);
          data[pi + 2] = 50;
          data[pi + 3] = Math.round(intensity * 255);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

// ─── 像素加载 ───

function loadPixelsFromDataUrl(dataUrl: string, width: number, height: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');

        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        if (context == null) {
          throw new Error('Canvas 2D context is unavailable for frame comparison');
        }
        context.drawImage(img, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;

        resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image from data URL'));
    img.src = dataUrl;
  });
}

// ─── 主入口 ───

/**
 * Lottie→GE 视觉等价测试：5 指标独立阈值判定（不加权）。
 *
 * 指标体系：
 * 1. **fullSsim** — 全图原始 MS-SSIM（不裁剪、不模糊，全局兜底）
 * 2. **coreRoiSsim** — 核心 ROI MS-SSIM（去掉四周 10% 边缘，严格比主体）
 * 3. **blurredSsim** — 模糊后全图 MS-SSIM（降低粒子/光效噪声）
 * 4. **edgeIoU** — Alpha 轮廓 IoU（基于 alpha 通道轮廓，检测遮罩/形状错误）
 * 5. **pixelDiffRatio** — Visible RGB and alpha difference area.
 * Optional **localDiffDensity** is computed only when requested by the caller.
 *
 * 判定阈值由调用方统一配置（见 frame-comparison-config.ts）。
 */
export function compareDataUrls(
  dataUrlA: string, dataUrlB: string, width: number, height: number,
  options: CompareOptions & { localDiffDensity: true },
): Promise<CompareResult & { localDiffDensity: number }>;
export function compareDataUrls(
  dataUrlA: string, dataUrlB: string, width: number, height: number, options?: CompareOptions,
): Promise<CompareResult>;
export async function compareDataUrls(
  dataUrlA: string,
  dataUrlB: string,
  width: number,
  height: number,
  options: CompareOptions = {},
): Promise<CompareResult> {
  const [pixelsA, pixelsB] = await Promise.all([
    loadPixelsFromDataUrl(dataUrlA, width, height),
    loadPixelsFromDataUrl(dataUrlB, width, height),
  ]);

  const grayA = toGrayscale(pixelsA, width, height);
  const grayB = toGrayscale(pixelsB, width, height);

  // 5 指标（热力图复用 fullSsim 的 SSIM map）
  const { score: fullSsim, ssimMap, mapW, mapH } = computeMsSsim(grayA, grayB, width, height);
  const coreRoiSsim = computeCoreRoiSsim(grayA, grayB, width, height);
  const blurredSsim = computeBlurredSsim(grayA, grayB, width, height);
  const edgeIoU = computeEdgeIoU(pixelsA, pixelsB, width, height);
  const pixelDiffRatio = computePixelDiffRatio(pixelsA, pixelsB, width, height);

  let localDiffDensity: number | undefined;

  if (options.localDiffDensity === true) {
    const { measureLocalDiffDensity } = await import('./local-diff-density');

    localDiffDensity = measureLocalDiffDensity(pixelsA, pixelsB, width, height);
  }

  const diffDataUrl = generateDiffHeatmap(ssimMap, mapW, mapH, width, height, pixelsA, pixelsB);

  return {
    fullSsim,
    coreRoiSsim,
    blurredSsim,
    edgeIoU,
    pixelDiffRatio,
    ...(options.localDiffDensity === true ? { localDiffDensity } : {}),
    diffDataUrl,
  };
}

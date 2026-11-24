import { EPSILON } from './types';

/**
 * 单个图层烘焙组合变换时的采样点上限。
 *
 * 组合变换只能栅格化，采样密度直接决定 IR 与 GE 的体积：长时间线会转出上百 MB
 * 场景数据，Effects 解析时锁死主线程。与 COMPOSITION_SAMPLE_STEP 共同决定切换点，
 * 1024 点约合 256 帧（30fps 下 8.5 秒）之后转入误差驱动细分。
 */
export const MAX_COMPOSITION_SAMPLES = 1024;

/** 烘焙组合变换的基准采样间隔（帧）。 */
export const COMPOSITION_SAMPLE_STEP = 0.25;

/** 误差检查位置。曲线可能与端点连线在多个位置相交，只查中点会漏判。 */
const ERROR_PROBES = [0.25, 0.5, 0.75];

export interface CompositionFrameSample<T> {
  frame: number;
  value: T;
}

export interface CompositionFrameSamplingOptions<T> {
  /** 时间线末帧。 */
  endFrame: number;
  /** 承载语义、必须保留的时刻：源关键帧、区间边界、动画起止。 */
  anchorFrames: number[];
  /** 瞬时跳变时刻。跨越它的区间不参与细分，否则误差必然超限并耗尽预算。 */
  jumpFrames?: number[];
  /** 求指定帧的组合值。 */
  evaluate: (frame: number) => T;
  /** 把值对齐到左邻所在分支，例如角度跨过 ±180° 时补整圈。 */
  unwrapForMeasure?: (value: T, left: T) => T;
  /** 相对线性插值的误差，1 表示刚好达到容忍度；t 为区间内的归一化位置。 */
  normalizeError: (value: T, left: T, right: T, t: number) => number;
}

/**
 * 组合变换的采样入口。
 *
 * 均匀网格装得进预算时照常铺网；超出预算时按误差细分，保留全部锚点，只加密
 * 线性插值误差超限的区间。
 */
export function sampleCompositionFrames<T> (
  options: CompositionFrameSamplingOptions<T>,
): CompositionFrameSample<T>[] {
  if (!fitsUniformGrid(options.endFrame)) {
    return refineCompositionFrames(options);
  }
  const frames = new Set<number>(uniformFrames(options.endFrame));

  for (const frame of options.anchorFrames) {
    if (Number.isFinite(frame) && frame >= 0 && frame <= options.endFrame + EPSILON) {
      frames.add(frame);
    }
  }

  return [...frames]
    .sort((left, right) => left - right)
    .map(frame => ({ frame, value: options.evaluate(frame) }));
}

/**
 * 在锚点之间按误差细分。
 *
 * 锚点全部保留；只有相对两端线性插值的误差超限时才继续二分，因此线性区间不会
 * 增加采样点，而曲线路径（如绕远端支点旋转的圆心轨迹）会被检测到。
 */
export function refineCompositionFrames<T> (
  options: CompositionFrameSamplingOptions<T>,
): CompositionFrameSample<T>[] {
  const jumpFrames = options.jumpFrames ?? [];
  const anchors = [...new Set(options.anchorFrames)]
    .filter(frame => Number.isFinite(frame))
    .sort((left, right) => left - right);

  if (anchors.length === 0) { return []; }
  const samples: CompositionFrameSample<T>[] = anchors.map(frame => ({
    frame,
    value: options.evaluate(frame),
  }));

  if (samples.length < 2 || samples.length >= MAX_COMPOSITION_SAMPLES) { return samples; }
  const errors = samples.slice(0, -1).map((sample, index) => (
    intervalError(options, sample, samples[index + 1], jumpFrames)
  ));

  while (samples.length < MAX_COMPOSITION_SAMPLES) {
    let worstIndex = -1;
    let worstError = 1;

    for (let index = 0; index < errors.length; index++) {
      if (errors[index] > worstError) {
        worstError = errors[index];
        worstIndex = index;
      }
    }
    if (worstIndex < 0) { break; }
    const left = samples[worstIndex];
    const right = samples[worstIndex + 1];

    if (!canSplitInterval(right.frame - left.frame)) {
      errors[worstIndex] = 0;
      continue;
    }
    const frame = (left.frame + right.frame) / 2;
    const inserted: CompositionFrameSample<T> = { frame, value: options.evaluate(frame) };

    samples.splice(worstIndex + 1, 0, inserted);
    errors.splice(
      worstIndex,
      1,
      intervalError(options, left, inserted, jumpFrames),
      intervalError(options, inserted, right, jumpFrames),
    );
  }

  return samples;
}

/** 按基准间隔铺满整条时间线，末帧单独收尾。 */
function uniformFrames (endFrame: number): number[] {
  if (!Number.isFinite(endFrame) || endFrame <= 0) { return [0]; }
  const frames: number[] = [];

  for (let frame = 0; frame < endFrame - EPSILON; frame += COMPOSITION_SAMPLE_STEP) {
    frames.push(frame);
  }
  frames.push(endFrame);

  return frames;
}

/** 均匀网格是否装得进预算。与 uniformFrames 用同一推进方式计数，保证边界一致。 */
function fitsUniformGrid (endFrame: number): boolean {
  if (!Number.isFinite(endFrame) || endFrame <= 0) { return true; }
  let interior = 0;

  for (let frame = 0; frame < endFrame - EPSILON; frame += COMPOSITION_SAMPLE_STEP) {
    interior++;
    if (interior + 1 > MAX_COMPOSITION_SAMPLES) { return false; }
  }

  return true;
}

function intervalError<T> (
  options: CompositionFrameSamplingOptions<T>,
  left: CompositionFrameSample<T>,
  right: CompositionFrameSample<T>,
  jumpFrames: number[],
): number {
  const span = right.frame - left.frame;

  if (!canSplitInterval(span) || containsJump(left.frame, right.frame, jumpFrames)) { return 0; }
  const alignedRight = align(options, right.value, left.value);
  let worst = 0;

  for (const t of ERROR_PROBES) {
    const value = align(options, options.evaluate(left.frame + span * t), left.value);
    const error = options.normalizeError(value, left.value, alignedRight, t);

    if (Number.isFinite(error) && error > worst) { worst = error; }
  }

  return worst;
}

function align<T> (options: CompositionFrameSamplingOptions<T>, value: T, left: T): T {
  return options.unwrapForMeasure == null ? value : options.unwrapForMeasure(value, left);
}

/** 区间内（不含左端）存在跳变时不可细分。 */
function containsJump (leftFrame: number, rightFrame: number, jumpFrames: number[]): boolean {
  return jumpFrames.some(frame => frame > leftFrame + EPSILON && frame <= rightFrame + EPSILON);
}

/** 二分后的半区间是否仍不小于基准间隔，决定该区间能否继续加密。 */
function canSplitInterval (span: number): boolean {
  return span >= 2 * COMPOSITION_SAMPLE_STEP - EPSILON;
}

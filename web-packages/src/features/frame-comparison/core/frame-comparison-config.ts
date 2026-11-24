export interface FrameMetricValues {
  fullSsim: number;
  coreRoiSsim: number;
  blurredSsim: number;
  edgeIoU?: number;
  pixelDiffRatio: number;
  localDiffDensity?: number;
  comparisonState?: 'comparable' | 'source-static' | 'target-static';
  comparisonMessage?: string;
}

export const FRAME_COMPARISON_THRESHOLDS = {
  fullSsim: 0.93,
  coreRoiSsim: 0.93,
  blurredSsim: 0.93,
  edgeIoU: 0.93,
  pixelDiffRatio: 0.05,
  // Maximum difference density in a 64×64 window, excluding antialiasing.
  localDiffDensity: 0.35,
} as const;

export const FRAME_SAMPLE_COUNT = 15;

/**
 * Stop before the final repeat boundary: SVG and GE can freeze or reset on opposite sides
 * of that boundary. End-only changes are checked separately by the SVG runner.
 */
export const SAMPLE_TIME_SAFE_END_RATIO = 0.95;

/** Sample after the boundary to capture changes that only occur at the end. */
export const END_OF_TIMELINE_PROBE_RATIO = 1.05;

export function getSampleTimePoints (duration: number, sampleCount = FRAME_SAMPLE_COUNT): number[] {
  if (sampleCount <= 0 || duration <= 0) {
    return [];
  }

  const safeEnd = duration * SAMPLE_TIME_SAFE_END_RATIO;

  return Array.from({ length: sampleCount }, (_, i) => {
    const ratio = i / Math.max(1, sampleCount - 1);

    return ratio * safeEnd;
  });
}

/**
 * Chrome quantizes the SMIL clock. At a fill="remove" boundary, the observed time may
 * still be inside the active interval; seeking GE to the requested time would compare
 * different states. Use the observed time, or the requested time when no clock is exposed.
 */
export function resolveTargetSeekTime (
  requestedTime: number,
  observedSourceTime: number | undefined,
): number {
  return observedSourceTime ?? requestedTime;
}

export function isFramePass (metrics: FrameMetricValues): boolean {
  if (metrics.comparisonState === 'source-static' || metrics.comparisonState === 'target-static') { return false; }

  return (
    metrics.fullSsim >= FRAME_COMPARISON_THRESHOLDS.fullSsim &&
    metrics.coreRoiSsim >= FRAME_COMPARISON_THRESHOLDS.coreRoiSsim &&
    metrics.blurredSsim >= FRAME_COMPARISON_THRESHOLDS.blurredSsim &&
    (metrics.edgeIoU == null ? metrics.localDiffDensity != null : metrics.edgeIoU >= FRAME_COMPARISON_THRESHOLDS.edgeIoU) &&
    metrics.pixelDiffRatio <= FRAME_COMPARISON_THRESHOLDS.pixelDiffRatio &&
    (metrics.localDiffDensity == null || metrics.localDiffDensity <= FRAME_COMPARISON_THRESHOLDS.localDiffDensity)
  );
}

export function getFailedMetrics (metrics: FrameMetricValues): string[] {
  if (metrics.comparisonState === 'source-static') {
    return [metrics.comparisonMessage ?? '原生 SVG 在全部采样点没有可观测像素变化，不能判定动画转换通过。'];
  }
  if (metrics.comparisonState === 'target-static') {
    return [metrics.comparisonMessage ?? '原生 SVG 有动画变化，但 GE 所有采样帧完全相同。'];
  }
  const failures: string[] = [];

  if (metrics.fullSsim < FRAME_COMPARISON_THRESHOLDS.fullSsim) {
    failures.push(`fullSsim=${metrics.fullSsim.toFixed(4)} (need >=${FRAME_COMPARISON_THRESHOLDS.fullSsim})`);
  }
  if (metrics.coreRoiSsim < FRAME_COMPARISON_THRESHOLDS.coreRoiSsim) {
    failures.push(`coreRoiSsim=${metrics.coreRoiSsim.toFixed(4)} (need >=${FRAME_COMPARISON_THRESHOLDS.coreRoiSsim})`);
  }
  if (metrics.blurredSsim < FRAME_COMPARISON_THRESHOLDS.blurredSsim) {
    failures.push(`blurredSsim=${metrics.blurredSsim.toFixed(4)} (need >=${FRAME_COMPARISON_THRESHOLDS.blurredSsim})`);
  }
  if (metrics.edgeIoU != null && metrics.edgeIoU < FRAME_COMPARISON_THRESHOLDS.edgeIoU) {
    failures.push(`edgeIoU=${metrics.edgeIoU.toFixed(4)} (need >=${FRAME_COMPARISON_THRESHOLDS.edgeIoU})`);
  }
  if (metrics.pixelDiffRatio > FRAME_COMPARISON_THRESHOLDS.pixelDiffRatio) {
    failures.push(
      `pixelDiffRatio=${(metrics.pixelDiffRatio * 100).toFixed(2)}% ` +
      `(need <=${FRAME_COMPARISON_THRESHOLDS.pixelDiffRatio * 100}%)`,
    );
  }
  if (metrics.localDiffDensity != null && metrics.localDiffDensity > FRAME_COMPARISON_THRESHOLDS.localDiffDensity) {
    failures.push(
      `localDiffDensity=${(metrics.localDiffDensity * 100).toFixed(2)}% ` +
      `(need <=${FRAME_COMPARISON_THRESHOLDS.localDiffDensity * 100}%)`,
    );
  }

  return failures;
}

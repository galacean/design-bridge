import type { FrameResult } from '../core/types';
import {
  FRAME_COMPARISON_THRESHOLDS, isFramePass,
} from '../core/frame-comparison-config';

export type MetricLevel = 'pass' | 'fail';

export function getEdgeIoU(result: FrameResult): number | undefined {
  return result.format !== 'svg' ? result.edgeIoU : undefined;
}

export function getLocalDiffDensity(result: FrameResult): number | undefined {
  return result.format === 'svg' ? result.localDiffDensity : undefined;
}

export function judgeFullSsim(value: number): MetricLevel {
  return value >= FRAME_COMPARISON_THRESHOLDS.fullSsim ? 'pass' : 'fail';
}

export function judgeCoreRoiSsim(value: number): MetricLevel {
  return value >= FRAME_COMPARISON_THRESHOLDS.coreRoiSsim ? 'pass' : 'fail';
}

export function judgeBlurredSsim(value: number): MetricLevel {
  return value >= FRAME_COMPARISON_THRESHOLDS.blurredSsim ? 'pass' : 'fail';
}

export function judgeEdgeIoU(value: number | undefined): MetricLevel {
  return value == null || value >= FRAME_COMPARISON_THRESHOLDS.edgeIoU ? 'pass' : 'fail';
}

export function judgePixelDiffRatio(value: number): MetricLevel {
  return value <= FRAME_COMPARISON_THRESHOLDS.pixelDiffRatio ? 'pass' : 'fail';
}

export function judgeLocalDiffDensity(value: number | undefined): MetricLevel {
  return value == null || value <= FRAME_COMPARISON_THRESHOLDS.localDiffDensity ? 'pass' : 'fail';
}

export function getOverallResult(result: FrameResult): { text: string; color: string } {
  if (result.comparisonState === 'source-static') {
    return { text: '⏭ SKIP', color: 'text-[var(--workbench-muted)]' };
  }

  return isFramePass(result)
    ? { text: '✅ PASS', color: 'text-[var(--cyan)]' }
    : { text: '❌ FAIL', color: 'text-[var(--coral)]' };
}

export const LEVEL_COLOR: Record<MetricLevel, string> = {
  pass: 'text-[var(--workbench-muted)]',
  fail: 'text-[var(--coral)]',
};

export function formatScore(value: number | undefined): string {
  return value == null ? '—' : value.toFixed(4);
}

export function formatPercent(ratio: number | undefined): string {
  return ratio == null ? '—' : `${(ratio * 100).toFixed(2)}%`;
}

import { describe, expect, it } from 'vitest';
import {
  END_OF_TIMELINE_PROBE_RATIO, FRAME_SAMPLE_COUNT, SAMPLE_TIME_SAFE_END_RATIO, getFailedMetrics, getSampleTimePoints,
  isFramePass, resolveTargetSeekTime,
} from './frame-comparison-config';
import type { FrameMetricValues } from './frame-comparison-config';

function perfectFrame(overrides: Partial<FrameMetricValues> = {}): FrameMetricValues {
  return {
    fullSsim: 1,
    coreRoiSsim: 1,
    blurredSsim: 1,
    pixelDiffRatio: 0,
    localDiffDensity: 0,
    ...overrides,
  };
}

describe('dynamic SVG comparability', () => {
  it('does not count identical native SVG samples as an animation PASS', () => {
    const frame = perfectFrame({
      comparisonState: 'source-static',
      comparisonMessage: '原生 SVG 在全部采样点没有可观测像素变化。',
    });

    expect(isFramePass(frame)).toBe(false);
    expect(getFailedMetrics(frame)).toEqual(['原生 SVG 在全部采样点没有可观测像素变化。']);
  });

  it('forces a FAIL when SVG changes but the GE renderer is frozen', () => {
    const frame = perfectFrame({
      comparisonState: 'target-static',
      comparisonMessage: '原生 SVG 有动画变化，但 GE 所有采样帧完全相同。',
    });

    expect(isFramePass(frame)).toBe(false);
    expect(getFailedMetrics(frame)).toEqual(['原生 SVG 有动画变化，但 GE 所有采样帧完全相同。']);
  });

  it('retains the contour gate for Lottie and GE results', () => {
    const frame = perfectFrame({ edgeIoU: 0.2, localDiffDensity: undefined });

    expect(isFramePass(frame)).toBe(false);
    expect(getFailedMetrics(frame)).toContain('edgeIoU=0.2000 (need >=0.93)');
  });

  it('keeps the existing Lottie and GE failure order', () => {
    const frame = perfectFrame({ edgeIoU: 0.2, pixelDiffRatio: 0.1, localDiffDensity: undefined });

    expect(getFailedMetrics(frame)).toEqual([
      'edgeIoU=0.2000 (need >=0.93)',
      'pixelDiffRatio=10.00% (need <=5%)',
    ]);
  });

  it('does not pass legacy metrics when the required contour metric is missing', () => {
    expect(isFramePass(perfectFrame({ edgeIoU: undefined, localDiffDensity: undefined }))).toBe(false);
  });

  it('keeps ordinary static and visually changing frame comparisons on the existing metric path', () => {
    expect(isFramePass(perfectFrame())).toBe(true);
    expect(isFramePass(perfectFrame({ comparisonState: 'comparable' }))).toBe(true);
  });
});

describe('dynamic sample grid', () => {
  it('keeps every sample strictly inside the animation window', () => {
    const times = getSampleTimePoints(4);

    expect(times).toHaveLength(FRAME_SAMPLE_COUNT);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeCloseTo(4 * SAMPLE_TIME_SAFE_END_RATIO, 9);
    expect(times[times.length - 1]).toBeLessThan(4);
  });

  it('spaces samples evenly so a single cycle is covered uniformly', () => {
    const times = getSampleTimePoints(8, 5);
    const gaps = times.slice(1).map((time, index) => time - times[index]);

    for (const gap of gaps) { expect(gap).toBeCloseTo(gaps[0], 9); }
  });

  it('probes past the end boundary so end-of-timeline changes stay observable', () => {
    // End-only changes are missed if every sample remains inside the interval.
    expect(END_OF_TIMELINE_PROBE_RATIO).toBeGreaterThan(SAMPLE_TIME_SAFE_END_RATIO);
    expect(END_OF_TIMELINE_PROBE_RATIO).toBeGreaterThan(1);
  });

  it('returns an empty grid for non-positive input', () => {
    expect(getSampleTimePoints(0)).toEqual([]);
    expect(getSampleTimePoints(-1)).toEqual([]);
    expect(getSampleTimePoints(1, 0)).toEqual([]);
  });
});

describe('resolveTargetSeekTime', () => {
  it('aligns the GE seek with the clock the browser actually reached', () => {
    expect(resolveTargetSeekTime(3.8, 3.7999989986419678)).toBe(3.7999989986419678);
  });

  it('keeps the requested time when the renderer exposes no clock', () => {
    expect(resolveTargetSeekTime(3.8, undefined)).toBe(3.8);
  });
});

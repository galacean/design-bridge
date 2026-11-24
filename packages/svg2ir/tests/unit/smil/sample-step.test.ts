import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_SAMPLE_STEP,
  MAX_COMPOSITION_SAMPLES,
  refineCompositionFrames,
  sampleCompositionFrames,
} from '../../../src/svg2ir/converter/smil/sample-composition-frames';

const linearError = (value: number, left: number, right: number, t: number): number => (
  Math.abs(value - (left + (right - left) * t))
);

/** 均匀网格刚好放得下的最后一帧：末帧另占一个名额。 */
const uniformLimit = (MAX_COMPOSITION_SAMPLES - 1) * COMPOSITION_SAMPLE_STEP;

describe('sampleCompositionFrames', () => {
  it('keeps the baseline grid while it fits the budget', () => {
    const sampled = sampleCompositionFrames<number>({
      endFrame: 1,
      anchorFrames: [0, 1],
      evaluate: frame => frame,
      normalizeError: linearError,
    });
    const frames = sampled.map(sample => sample.frame);

    expect(frames).toContain(0);
    expect(frames).toContain(COMPOSITION_SAMPLE_STEP);
    expect(frames).toContain(0.5);
    expect(frames).toContain(1);
  });

  it('adds anchors to the baseline grid', () => {
    const sampled = sampleCompositionFrames<number>({
      endFrame: 1,
      anchorFrames: [0.3, 1],
      evaluate: frame => frame,
      normalizeError: linearError,
    });

    expect(sampled.map(sample => sample.frame)).toContain(0.3);
  });

  it('switches to error-driven sampling once the baseline grid overflows', () => {
    const sampled = sampleCompositionFrames<number>({
      endFrame: uniformLimit + COMPOSITION_SAMPLE_STEP,
      anchorFrames: [0, uniformLimit + COMPOSITION_SAMPLE_STEP],
      evaluate: () => 0,
      normalizeError: linearError,
    });

    // 平坦区间无需细分，点数远少于均匀网格。
    expect(sampled.length).toBeLessThan(MAX_COMPOSITION_SAMPLES);
  });

  it('agrees with the emitted grid at the budget boundary', () => {
    // 预算是"装得下就照常铺网、装不下才细分"，边界判定必须与实际铺出的点数一致，
    // 否则刚好卡在阈值上的时间线会被误送进细分分支。
    const atLimit = sampleCompositionFrames<number>({
      endFrame: uniformLimit,
      anchorFrames: [0, uniformLimit],
      evaluate: frame => frame,
      normalizeError: linearError,
    });
    const overLimit = sampleCompositionFrames<number>({
      endFrame: uniformLimit + COMPOSITION_SAMPLE_STEP,
      anchorFrames: [0, uniformLimit + COMPOSITION_SAMPLE_STEP],
      evaluate: frame => frame,
      normalizeError: linearError,
    });

    expect(atLimit.length).toBe(MAX_COMPOSITION_SAMPLES);
    expect(overLimit.length).toBe(2);
  });
});

describe('refineCompositionFrames', () => {
  it('keeps every anchor and adds nothing when the interval is already linear', () => {
    const samples = refineCompositionFrames<number>({
      endFrame: 60,
      anchorFrames: [0, 30, 60],
      evaluate: frame => frame / 60,
      normalizeError: linearError,
    });

    expect(samples.map(sample => sample.frame)).toEqual([0, 30, 60]);
  });

  it('subdivides a curved interval until the error fits the tolerance', () => {
    const samples = refineCompositionFrames<number>({
      endFrame: 8,
      anchorFrames: [0, 8],
      evaluate: frame => (frame - 4) ** 2,
      normalizeError: linearError,
    });

    expect(samples.length).toBeGreaterThan(2);
    expect(samples[0].frame).toBe(0);
    expect(samples.at(-1)?.frame).toBe(8);
  });

  it('stops at the sample budget even while the error stays high', () => {
    // 锚点数已顶到预算：不再细分，但锚点一个不少。
    const anchors = Array.from({ length: MAX_COMPOSITION_SAMPLES }, (_, index) => index);
    const samples = refineCompositionFrames<number>({
      endFrame: MAX_COMPOSITION_SAMPLES - 1,
      anchorFrames: anchors,
      evaluate: Math.sin,
      normalizeError: () => 10,
    });

    expect(samples.map(sample => sample.frame)).toEqual(anchors);
  });

  it('spends at most the budget on a curved timeline', () => {
    const samples = refineCompositionFrames<number>({
      endFrame: 4000,
      anchorFrames: [0, 4000],
      evaluate: Math.sin,
      normalizeError: () => 10,
    });

    expect(samples.length).toBeLessThanOrEqual(MAX_COMPOSITION_SAMPLES);
  });

  it('does not subdivide the interval leading into an instantaneous jump', () => {
    const samples = refineCompositionFrames<number>({
      endFrame: 20,
      anchorFrames: [0, 10, 20],
      jumpFrames: [10],
      evaluate: frame => (frame < 10 ? 0 : 1),
      normalizeError: linearError,
    });

    expect(samples.filter(sample => sample.frame > 0 && sample.frame < 10)).toEqual([]);
    expect(samples.map(sample => sample.frame)).toContain(10);
  });

  it('never samples denser than the baseline step', () => {
    const samples = refineCompositionFrames<number>({
      endFrame: 100,
      anchorFrames: [0, 100],
      evaluate: Math.sin,
      normalizeError: () => 10,
    });

    for (let index = 1; index < samples.length; index++) {
      expect(samples[index].frame - samples[index - 1].frame).toBeGreaterThanOrEqual(COMPOSITION_SAMPLE_STEP);
    }
  });

  it('collapses duplicate and unsorted anchors into one ordered sequence', () => {
    const samples = refineCompositionFrames<number>({
      endFrame: 60,
      anchorFrames: [30, 0, 30, 60],
      evaluate: frame => frame,
      normalizeError: () => 0,
    });

    expect(samples.map(sample => sample.frame)).toEqual([0, 30, 60]);
  });
});

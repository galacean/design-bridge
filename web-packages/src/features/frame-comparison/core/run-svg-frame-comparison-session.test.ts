import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  sourceTime: 0,
  targetTime: 0,
  endOnly: false,
  sourceDisposed: vi.fn(),
  targetDisposed: vi.fn(),
  compare: vi.fn(async () => ({
    fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, edgeIoU: 1,
    pixelDiffRatio: 0, localDiffDensity: 0, diffDataUrl: 'diff',
  })),
}));

vi.mock('./image-comparator', () => ({ compareDataUrls: capture.compare }));
vi.mock('./svg2ge-shared', () => ({
  prepareSvgForConvert: vi.fn(async (source: string) => source),
  getMeasureText: () => () => ({ width: 0 }),
  convertSVGToEffects: () => ({
    data: {}, ir: { compositions: [{ inPoint: 0, outPoint: 30, frameRate: 30 }] }, warnings: [],
  }),
}));
vi.mock('../runtime/svg-renderer', async importOriginal => ({
  ...await importOriginal<typeof import('../runtime/svg-renderer')>(),
  SvgRenderer: class {
    async load() {}
    async gotoTimeAsync(time: number) { capture.sourceTime = time; }
    gotoTime(time: number) { capture.sourceTime = time; }
    getDuration() { return 1; }
    getObservedAnimationTime() { return capture.sourceTime; }
    toDataUrl() {
      return `source-${capture.endOnly && capture.sourceTime < 1 ? 0 : capture.sourceTime}`;
    }
    dispose() { capture.sourceDisposed(); }
  },
}));
vi.mock('../runtime/effects-renderer', () => ({
  EffectsRenderer: class {
    async load() {}
    gotoTime(time: number) { capture.targetTime = time; }
    toDataUrl() { return `target-${capture.targetTime}`; }
    dispose() { capture.targetDisposed(); }
  },
}));

import { runSvgFrameComparison } from './run-svg-frame-comparison';

beforeEach(() => {
  capture.sourceTime = 0;
  capture.targetTime = 0;
  capture.endOnly = false;
  vi.clearAllMocks();
  vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
});
afterEach(() => vi.unstubAllGlobals());

const source = '<svg width="100" height="100"></svg>';

describe('SVG comparison runner contract', () => {
  it('returns one static frame in an array and reports its progress', async () => {
    const onFrameProgress = vi.fn();
    const frames = await runSvgFrameComparison(source, { onFrameProgress });

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ time: 0, localDiffDensity: 0 });
    expect(onFrameProgress).toHaveBeenCalledWith(0, 1, 0);
    expect(capture.compare).toHaveBeenCalledWith('source-0', 'target-0', 100, 100, { localDiffDensity: true });
    expect(capture.sourceDisposed).toHaveBeenCalledOnce();
    expect(capture.targetDisposed).toHaveBeenCalledOnce();
  });

  it('reports each animated sample and returns the same shared frame structure', async () => {
    const onFrameProgress = vi.fn();
    const frames = await runSvgFrameComparison(source, { animated: true, sampleCount: 3, onFrameProgress });

    expect(frames.map(frame => frame.time)).toEqual([0, 0.475, 0.95]);
    expect(onFrameProgress.mock.calls).toEqual([[0, 3, 0], [1, 3, 0.475], [2, 3, 0.95]]);
    expect(frames.every(frame => frame.comparisonState === 'comparable')).toBe(true);
  });

  it('includes a discovered end-boundary frame in the progress total', async () => {
    capture.endOnly = true;
    const onFrameProgress = vi.fn();
    const frames = await runSvgFrameComparison(source, { animated: true, sampleCount: 2, onFrameProgress });

    expect(frames.map(frame => frame.time)).toEqual([0, 0.95, 1.05]);
    expect(onFrameProgress.mock.calls).toEqual([[0, 2, 0], [1, 2, 0.95], [2, 3, 1.05]]);
    expect(frames.every(frame => frame.comparisonState === 'comparable')).toBe(true);
  });
});

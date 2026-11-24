import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeSVGCaseSelection } from '../../features/svg-test-inputs/case-api';
import { selectSVGCases, summarizeSVGFrames } from './frame-regression.spec';
import type { SVGCase } from '../../features/svg-test-inputs/case-api';
import type { SVGFrameResult } from '../../features/frame-comparison/core/types';

const cases: SVGCase[] = ['pass', '', 'svg2ge', 'ge-capability'].map((tag, index) => ({
  name: `case-${index}.svg`, tag, pool: 'syn', type: 'static', note: '',
}));
const frame: SVGFrameResult = {
  format: 'svg' as const,
  time: 0, fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, pixelDiffRatio: 0, localDiffDensity: 0,
  lottieDataUrl: 'source', effectsDataUrl: 'target', diffDataUrl: 'diff',
};

afterEach(() => vi.unstubAllGlobals());

describe('SVG regression scope and reporting', () => {
  it('supports full, queued, passed, named, and deterministic sampled scopes', () => {
    expect(selectSVGCases(cases, new URLSearchParams())).toHaveLength(4);
    expect(selectSVGCases(cases, new URLSearchParams('mode=queue')).map(item => item.tag)).toEqual(['', 'svg2ge']);
    expect(selectSVGCases(cases, new URLSearchParams('mode=pass'))).toEqual([cases[0]]);
    expect(selectSVGCases(cases, new URLSearchParams('name=case-2.svg'))).toEqual([cases[2]]);
    expect(selectSVGCases(cases, new URLSearchParams('seed=fixed&max=2')))
      .toEqual(selectSVGCases(cases, new URLSearchParams('seed=fixed&max=2')));
    expect(selectSVGCases(cases, new URLSearchParams('offset=2&max=1'))).toEqual([cases[2]]);
  });

  it('runs exactly the multi-selected names and refuses to broaden a missing selection', () => {
    const values = new Map<string, string>();

    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const id = storeSVGCaseSelection('static', [cases[0].name, cases[2].name]);
    const query = new URLSearchParams({ type: 'static', selection: id });

    expect(selectSVGCases(cases, query)).toEqual([cases[0], cases[2]]);
    expect(() => selectSVGCases([cases[0]], query)).toThrow('选中的案例已不存在');
    expect(() => selectSVGCases(cases, new URLSearchParams('selection=missing'))).toThrow('多选范围已失效');
  });

  it('keeps non-comparable source frames out of the pass and failure counts', () => {
    expect(summarizeSVGFrames(cases[0], [{ ...frame, comparisonState: 'source-static' }]))
      .toMatchObject({ pass: false, skipped: true, frameTotal: 1, framePassCount: 0 });
    expect(summarizeSVGFrames(cases[0], [{ ...frame, comparisonState: 'target-static' }]))
      .toMatchObject({ pass: false, skipped: false });
  });

  it('aggregates the worst metrics while retaining a representative failure image', () => {
    const report = summarizeSVGFrames(cases[0], [frame, { ...frame, time: 1, fullSsim: 0.7, localDiffDensity: 0.9 }]);

    expect(report).toMatchObject({
      pass: false, framePassCount: 1, fullSsim: 0.7, localDiffDensity: 0.9, worstFrameTime: 1,
    });
  });

  it('selects an actual failing frame when another frame has the lowest full-image score', () => {
    const passing = { ...frame, fullSsim: 0.94, lottieDataUrl: 'passing' };
    const failing = { ...frame, time: 1, fullSsim: 0.97, localDiffDensity: 0.4, lottieDataUrl: 'failing' };
    const report = summarizeSVGFrames(cases[0], [passing, failing]);

    expect(report).toMatchObject({
      pass: false, framePassCount: 1, fullSsim: 0.94, localDiffDensity: 0.4,
      worstFrameTime: 1, svgDataUrl: 'failing',
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  list: vi.fn(async () => ['first.svg', 'second.svg', 'third.svg'].map(name => ({
    name, type: 'static', pool: 'ti', tag: '', note: '',
  }))),
  read: vi.fn(async () => '<svg/>'),
  compare: vi.fn(async () => [{
    time: 0, fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, pixelDiffRatio: 0, localDiffDensity: 0,
    lottieDataUrl: 'source', effectsDataUrl: 'target', diffDataUrl: 'diff',
  }]),
}));

vi.mock('../../features/svg-test-inputs/case-api', () => ({ listSVGCases: mock.list, readSVGCase: mock.read }));
vi.mock('../../features/frame-comparison/core/run-svg-frame-comparison', () => ({ runSvgFrameComparison: mock.compare }));
vi.mock('../../features/frame-comparison/regression/render-frame-gallery', () => ({ renderFrameGallery: vi.fn() }));

import { registerSVGFrameRegressionSuite } from './frame-regression.spec';
import { clearSVGReport, readSVGReport } from './frame-regression-report-store';
import { renderFrameGallery } from '../../features/frame-comparison/regression/render-frame-gallery';

type TestContext = { timeout: (duration: number) => void; skip: () => never };
const tasks: Array<(this: TestContext) => Promise<void>> = [];
const context: TestContext = { timeout: () => undefined, skip: () => { throw new Error('test skipped'); } };

beforeEach(() => {
  tasks.length = 0;
  vi.clearAllMocks();
  const target = Object.assign(new EventTarget(), { location: { search: '?max=3' } });

  vi.stubGlobal('window', target);
  vi.stubGlobal('document', { createElement: () => ({ dataset: {} }) });
  vi.stubGlobal('describe', (_name: string, body: () => void) => body());
  vi.stubGlobal('it', (_name: string, body: (this: TestContext) => Promise<void>) => tasks.push(body));
});
afterEach(() => vi.unstubAllGlobals());

const root = { appendChild: vi.fn() } as unknown as HTMLElement;

describe('SVG partial regression reports', () => {
  it('retains completed results on stop and excludes an aborted case from failures', async () => {
    const controller = new AbortController();
    const target = window as Window & { __batchReport?: unknown };

    await registerSVGFrameRegressionSuite(root, { signal: controller.signal });
    expect(readSVGReport()).toMatchObject({ status: 'running', total: 0, plannedTotal: 3 });
    expect(target.__batchReport).toBeUndefined();
    await tasks[0].call(context);
    const firstSnapshot = readSVGReport();

    expect(firstSnapshot).toMatchObject({ total: 1, passCount: 1, status: 'running' });
    let resume: (value: string) => void = () => undefined;

    mock.read.mockImplementationOnce(() => new Promise<string>(resolve => { resume = resolve; }));
    const pending = tasks[1].call(context);

    controller.abort();
    expect(readSVGReport()).toMatchObject({ status: 'stopped', total: 1, plannedTotal: 3, failCount: 0 });
    expect(target.__batchReport).toBe(readSVGReport());
    resume('<svg/>');
    await expect(pending).rejects.toThrow('test skipped');
    expect(readSVGReport()?.results.map(result => result.name)).toEqual(['first.svg']);
    expect(firstSnapshot?.status).toBe('running');
  });

  it('does not let an old cancelled run replace a newly started report', async () => {
    const old = new AbortController();

    await registerSVGFrameRegressionSuite(root, { signal: old.signal });
    clearSVGReport();
    await registerSVGFrameRegressionSuite(root, {});
    const currentRun = readSVGReport()?.runId;

    old.abort();
    expect(readSVGReport()).toMatchObject({ status: 'running', runId: currentRun });
  });

  it('keeps cases that fail before rendering accessible from the result list', async () => {
    mock.read.mockRejectedValueOnce(new Error('invalid SVG'));
    await registerSVGFrameRegressionSuite(root, {});
    await expect(tasks[0].call(context)).rejects.toThrow('invalid SVG');
    expect(readSVGReport()).toMatchObject({
      total: 1, failCount: 1, results: [{ name: 'first.svg', error: 'invalid SVG' }],
    });
    expect(root.appendChild).toHaveBeenCalledWith(expect.objectContaining({
      href: '/svg-frame-test?fixture=first.svg&type=static&run=1', target: '_blank',
      textContent: 'first.svg · FAIL', dataset: { caseStatus: 'fail' },
    }));
    expect(root.appendChild).toHaveBeenCalledWith(expect.objectContaining({
      textContent: 'invalid SVG', dataset: { caseStatus: 'fail' },
    }));
  });

  it('uses the same single-case destination for a failed result and its frame gallery', async () => {
    const frame = (await mock.compare())[0];

    mock.compare.mockResolvedValueOnce([{ ...frame, time: 1.5, fullSsim: 0.5 }]);
    await registerSVGFrameRegressionSuite(root, {});
    await expect(tasks[0].call(context)).rejects.toThrow();
    expect(root.appendChild).toHaveBeenCalledWith(expect.objectContaining({
      href: '/svg-frame-test?fixture=first.svg&type=static&run=1&time=1.5',
      textContent: 'first.svg · FAIL',
    }));
    expect(renderFrameGallery).toHaveBeenCalledWith('first.svg', expect.any(Array), root, ['SVG', 'GE'], {
      caseUrl: '/svg-frame-test?fixture=first.svg&type=static&run=1&time=1.5',
    });
  });
});

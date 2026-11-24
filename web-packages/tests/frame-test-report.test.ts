import { describe, expect, it } from 'vitest';
import { buildFrameTestReport } from '../scripts/frame-test-report.mjs';

describe('buildFrameTestReport', () => {
  it('keeps skipped SVG cases separate from failures', () => {
    const report = buildFrameTestReport({
      done: true,
      isSvg: true,
      stats: '1s',
      tests: [
        { name: 'passed.svg', passed: true, skipped: false },
        { name: 'skipped.svg', passed: false, skipped: true },
        { name: 'failed.svg', passed: false, skipped: false, detail: 'difference' },
      ],
    }, '/svg-auto-frame-test', ['', 'browser warning']);

    expect(report).toMatchObject({
      done: true,
      url: '/svg-auto-frame-test',
      stats: '1s',
      total: 3,
      pass: 1,
      fail: 1,
      skip: 1,
      consoleHints: ['browser warning'],
      passed: ['passed.svg'],
      skipped: ['skipped.svg'],
      failed: [{ name: 'failed.svg', detail: 'difference' }],
    });
  });

  it('keeps pending legacy cases in the failure count', () => {
    const report = buildFrameTestReport({
      done: true,
      stats: '1s',
      tests: [
        { name: 'passed.json', passed: true },
        { name: 'pending.json', passed: false },
      ],
    }, '/auto-frame-test', []);

    expect(report).toMatchObject({
      total: 2,
      pass: 1,
      fail: 1,
      failed: [{ name: 'pending.json' }],
    });
    expect(report).not.toHaveProperty('skip');
    expect(report).not.toHaveProperty('skipped');
  });

  it('reports an empty completed SVG run as an error', () => {
    const report = buildFrameTestReport({ done: true, isSvg: true, empty: true, tests: [] }, '/svg-auto-frame-test', []);

    expect(report).toMatchObject({
      done: true,
      empty: true,
      error: 'No cases matched the selection.',
      total: 0,
      pass: 0,
      fail: 0,
      skip: 0,
    });
  });
});

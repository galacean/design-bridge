import { describe, expect, it } from 'vitest';
import { hasInputSources, listInputJsonFiles, readInputJson } from '../helpers/input-files';
import { validateLottieSchema } from '../helpers/lottie-schema';

function createOpacityAnimationLottie(keyframes: unknown[]): Record<string, unknown> {
  return {
    v: '5.7.0',
    fr: 24,
    ip: 0,
    op: 24,
    w: 100,
    h: 100,
    nm: 'schema-kf-rules',
    layers: [
      {
        ty: 2,
        nm: 'image-layer',
        ind: 1,
        ip: 0,
        op: 24,
        st: 0,
        refId: 'img_0',
        w: 100,
        h: 100,
        ks: {
          a: { a: 0, k: [50, 50, 0] },
          p: { a: 0, k: [50, 50, 0] },
          s: { a: 0, k: [100, 100, 100] },
          r: { a: 0, k: 0 },
          o: { a: 1, k: keyframes },
        },
      },
    ],
    assets: [
      {
        id: 'img_0',
        w: 100,
        h: 100,
        u: '',
        p: 'data:image/png;base64,iVBORw==',
        e: 1,
      },
    ],
  };
}

describe('lottie schema validation', () => {
  it('returns a structured report for invalid input', () => {
    const report = validateLottieSchema({ foo: 'bar' });

    expect(report.valid).toBe(false);
    expect(report.errorCount).toBeGreaterThan(0);
    expect(Array.isArray(report.issues)).toBe(true);

    const firstIssue = report.issues[0];

    expect(typeof firstIssue.type).toBe('string');
    expect(typeof firstIssue.message).toBe('string');
    expect(typeof firstIssue.path).toBe('string');
    expect(typeof firstIssue.name).toBe('string');
    expect(typeof firstIssue.docs).toBe('string');
  });

  it('validates fixture inputs and produces inspectable reports', async () => {
    expect(hasInputSources()).toBe(true);

    const files = listInputJsonFiles(5);

    for (const fileName of files) {
      const raw = readInputJson(fileName);
      const json = JSON.parse(raw) as Record<string, unknown>;
      const report = validateLottieSchema(json);

      expect(typeof report.valid, `report.valid in ${fileName}`).toBe('boolean');
      expect(report.errorCount, `report.errorCount in ${fileName}`).toBeGreaterThanOrEqual(0);
      expect(report.warningCount, `report.warningCount in ${fileName}`).toBeGreaterThanOrEqual(0);

      if (report.issues.length > 0) {
        expect(typeof report.issues[0].message, `issue.message in ${fileName}`).toBe('string');
        expect(typeof report.issues[0].path, `issue.path in ${fileName}`).toBe('string');
      }
    }
  });

  it('accepts keyframe property shapes for both a=0 and a=1', () => {
    const staticLottie = {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 24,
      w: 100,
      h: 100,
      layers: [
        {
          ty: 2,
          nm: 'static-layer',
          ind: 1,
          ip: 0,
          op: 24,
          st: 0,
          refId: 'img_0',
          w: 100,
          h: 100,
          ks: {
            a: { a: 0, k: [50, 50, 0] },
            p: { a: 0, k: [50, 50, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        },
      ],
      assets: [{ id: 'img_0', w: 100, h: 100, u: '', p: 'data:image/png;base64,iVBORw==', e: 1 }],
    };

    const animatedLottie = createOpacityAnimationLottie([
      { t: 0, s: [100], e: [60], i: { x: [0.4], y: [0.4] }, o: { x: [0.6], y: [0.6] } },
      { t: 24, s: [60] },
    ]);

    const staticReport = validateLottieSchema(staticLottie);
    const animatedReport = validateLottieSchema(animatedLottie);

    expect(staticReport.errorCount).toBe(0);
    expect(animatedReport.errorCount).toBe(0);
  });

  it('reports non-ascending keyframe t values as schema errors', () => {
    const invalidLottie = createOpacityAnimationLottie([
      { t: 10, s: [100], e: [60], i: { x: [0.4], y: [0.4] }, o: { x: [0.6], y: [0.6] } },
      { t: 5, s: [60] },
    ]);

    const report = validateLottieSchema(invalidLottie);
    const messages = report.issues
      .filter(issue => issue.type === 'error')
      .map(issue => issue.message)
      .join('\n');

    expect(report.errorCount).toBeGreaterThan(0);
    expect(messages.toLowerCase()).toContain('ascending order');
  });

  it('accepts hold keyframes without i/o handles when h=1', () => {
    const holdLottie = createOpacityAnimationLottie([
      { t: 0, s: [100], e: [40], h: 1 },
      { t: 24, s: [40] },
    ]);

    const report = validateLottieSchema(holdLottie);
    const errorMessages = report.issues
      .filter(issue => issue.type === 'error')
      .map(issue => issue.message)
      .join('\n');

    expect(errorMessages).not.toContain("must have required property 'i'");
    expect(errorMessages).not.toContain("must have required property 'o'");
  });
});

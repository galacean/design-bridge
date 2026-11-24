import { describe, expect, it } from 'vitest';
import { IRMaskMode } from '@galacean/animation-ir';
import { convertLottieMasks } from '../../../src/converter/convert-lottie-mask';

describe('convertLottieMasks', () => {
  it('parses rectangular mask', () => {
    const rectMask = [
      {
        mode: 'a',
        pt: {
          a: 0,
          k: {
            c: true,
            v: [
              [0, 0],
              [200, 0],
              [200, 100],
              [0, 100],
            ],
            i: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ],
            o: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ],
          },
        },
      },
    ];

    const { masks: [result] } = convertLottieMasks(rectMask);

    expect(result).toBeDefined();
    expect(result?.mode).toBe(IRMaskMode.Add);
    expect(result?.inverted).toBeUndefined();
    expect(result.path.points).toHaveLength(4);
    expect(result.path.points[0]).toEqual({ x: 0, y: 0 });
    expect(result.path.points[2]).toEqual({ x: 200, y: 100 });
    expect(result.path.inTangents).toHaveLength(4);
    expect(result.path.outTangents).toHaveLength(4);
    expect(result.path.closed).toBe(true);
  });

  it('preserves curved path tangents', () => {
    const curvedMask = [
      {
        mode: 'a',
        pt: {
          a: 0,
          k: {
            c: true,
            v: [
              [0, 50],
              [50, 0],
              [100, 50],
              [50, 100],
            ],
            i: [
              [0, 27.6],
              [-27.6, 0],
              [0, -27.6],
              [27.6, 0],
            ],
            o: [
              [0, -27.6],
              [27.6, 0],
              [0, 27.6],
              [-27.6, 0],
            ],
          },
        },
      },
    ];

    const { masks: [result] } = convertLottieMasks(curvedMask);

    expect(result).toBeDefined();
    expect(result.path.inTangents[0].y).toBe(27.6);
    expect(result.path.outTangents[0].y).toBe(-27.6);
  });

  it('returns undefined for empty input', () => {
    const { masks: [result] } = convertLottieMasks([] as unknown);

    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty mask path instead of producing invalid IR', () => {
    const { masks: [result] } = convertLottieMasks([
      {
        mode: 'a',
        pt: {
          a: 0,
          k: { c: true, v: [], i: [], o: [] },
        },
      },
    ] as unknown);

    expect(result).toBeUndefined();
  });

  it.each([
    { mode: 'a', o: { a: 0, k: 50 } },
    { mode: 'a', o: { a: 1, k: [] } },
  ])('does not normalize unsupported mask semantics: %o', maskOptions => {
    const { masks: [result] } = convertLottieMasks([
      {
        ...maskOptions,
        pt: {
          a: 0,
          k: {
            c: true,
            v: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
            i: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ],
            o: [
              [0, 0],
              [0, 0],
              [0, 0],
              [0, 0],
            ],
          },
        },
      },
    ] as unknown);

    expect(result).toBeUndefined();
  });

  it.each([
    { sourceMode: 'a', expectedMode: IRMaskMode.Add, sourceInverted: false },
    { sourceMode: 'a', expectedMode: IRMaskMode.Add, sourceInverted: true },
    { sourceMode: 'i', expectedMode: IRMaskMode.Intersect, sourceInverted: true },
    { sourceMode: 's', expectedMode: IRMaskMode.Subtract, sourceInverted: false },
    { sourceMode: 's', expectedMode: IRMaskMode.Subtract, sourceInverted: true },
  ])('preserves one static $sourceMode mask operation and inversion', ({
    sourceMode, expectedMode, sourceInverted,
  }) => {
    const { masks: [result] } = convertLottieMasks([{
      mode: sourceMode,
      inv: sourceInverted,
      pt: {
        a: 0,
        k: {
          c: true,
          v: [[0, 0], [10, 0], [10, 10], [0, 10]],
          i: [[0, 0], [0, 0], [0, 0], [0, 0]],
          o: [[0, 0], [0, 0], [0, 0], [0, 0]],
        },
      },
    }] as unknown);

    expect(result?.mode).toBe(expectedMode);
    expect(result?.inverted ?? false).toBe(sourceInverted);
  });

  it.each([false, undefined])('does not normalize an open mask path with c=$closed', closed => {
    const { masks: [result] } = convertLottieMasks([{
      mode: 'a',
      pt: {
        a: 0,
        k: {
          ...(closed !== undefined && { c: closed }),
          v: [[0, 0], [10, 0], [10, 10]],
          i: [[0, 0], [0, 0], [0, 0]],
          o: [[0, 0], [0, 0], [0, 0]],
        },
      },
    }] as unknown);

    expect(result).toBeUndefined();
  });

  it('does not approximate an animated mask path with one keyframe', () => {
    const { masks: [result] } = convertLottieMasks([{
      mode: 'a',
      pt: {
        a: 1,
        k: [{
          t: 0,
          s: [{
            c: true,
            v: [[0, 0], [10, 0], [10, 10], [0, 10]],
            i: [[0, 0], [0, 0], [0, 0], [0, 0]],
            o: [[0, 0], [0, 0], [0, 0], [0, 0]],
          }],
        }],
      },
    }] as unknown);

    expect(result).toBeUndefined();
  });

  it('preserves all active masks in source order', () => {
    const mask = {
      mode: 'a',
      pt: {
        a: 0,
        k: {
          c: true,
          v: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          i: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          o: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        },
      },
    };

    const result = convertLottieMasks([mask, { ...mask, mode: 'n' }, { ...mask, mode: 's', inv: true }]);

    expect(result.unsupportedFeatures).toEqual([]);
    expect(result.masks.map(({ mode, inverted }) => ({ mode, inverted }))).toEqual([
      { mode: IRMaskMode.Add, inverted: undefined },
      { mode: IRMaskMode.Subtract, inverted: true },
    ]);
    expect(convertLottieMasks([mask, { ...mask, o: 50 }])).toEqual({
      masks: [], unsupportedFeatures: ['unsupported-mask-opacity'],
    });
  });
});

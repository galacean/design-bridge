import { describe, expect, it } from 'vitest';
import { BezierKeyframeType } from '@galacean/effects-specification';
import type { IRAnimatedProperty, IRVec3 } from '@galacean/animation-ir';

import {
  convertIRPositionKeyframesToGE,
  convertIRScalarKeyframesToGE,
  convertIRVectorKeyframesToGE,
} from '../../../src/ir2ge/converter/bezier';

const ctx = { inFrame: 0, outFrame: 60 };

describe('convertIRScalarKeyframesToGE', () => {
  it('returns undefined for non-keyframed properties', () => {
    const prop: IRAnimatedProperty<number> = { type: 'static', value: 0.5 };

    expect(convertIRScalarKeyframesToGE(prop, ctx)).toBeUndefined();
  });

  it('returns undefined when there are fewer than 2 keyframes', () => {
    const prop: IRAnimatedProperty<number> = {
      type: 'keyframed',
      keyframes: [{ frame: 0, value: 0 }],
    };

    expect(convertIRScalarKeyframesToGE(prop, ctx)).toBeUndefined();
  });

  it('generates EASE_OUT first, EASE_IN last, EASE between for ≥3 keyframes', () => {
    const prop: IRAnimatedProperty<number> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0, outTangent: { x: 0.5, y: 0.5 } },
        { frame: 30, value: 0.5, inTangent: { x: 0.5, y: 0.5 }, outTangent: { x: 0.5, y: 0.5 } },
        { frame: 60, value: 1, inTangent: { x: 0.5, y: 0.5 } },
      ],
    };

    const result = convertIRScalarKeyframesToGE(prop, ctx);

    expect(result).toHaveLength(1);
    const curve = result![0];

    expect(curve).toHaveLength(3);
    expect(curve[0][0]).toBe(BezierKeyframeType.EASE_OUT);
    expect(curve[1][0]).toBe(BezierKeyframeType.EASE);
    expect(curve[2][0]).toBe(BezierKeyframeType.EASE_IN);
  });

  it('honors hold by collapsing v1 to v0 and using {0,0}/{1,1} tangents', () => {
    const prop: IRAnimatedProperty<number> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0.2, hold: true },
        { frame: 60, value: 0.8, inTangent: { x: 0.6, y: 0.6 } },
      ],
    };

    const result = convertIRScalarKeyframesToGE(prop, ctx);

    expect(result).toBeDefined();
    const curve = result![0];

    // The held segment is followed by an instantaneous jump to the final value.
    expect(curve).toHaveLength(3);
    expect(curve[2][1]).toEqual([1, 0.8, 1, 0.8]);

    // EASE_OUT payload: [t0, v0, outCp_x, outCp_y]
    // hold: v1=v0=0.2, outTangent={0,0} → outCp = lerp(0, 1, 0) = 0 for x,
    //                                       outCpY = lerp(0.2, 0.2, 0) = 0.2
    const easeOut = curve[0][1] as number[];

    expect(easeOut[0]).toBeCloseTo(0, 4); // t0 = 0
    expect(easeOut[1]).toBeCloseTo(0.2, 4); // v0 = 0.2
    expect(easeOut[2]).toBeCloseTo(0, 4); // outCp_x = lerp(0, 1, 0) = 0
    expect(easeOut[3]).toBeCloseTo(0.2, 4); // outCp_y = lerp(0.2, 0.2, 0) = 0.2

    // EASE payload starts with [inCp_x, inCp_y, t1, v1]
    // hold: inTangent={1,1} → inCp = lerp(0, 1, 1) = 1 for x,
    //                          inCpY = lerp(0.2, 0.2, 1) = 0.2
    // v1 = v0 = 0.2 (hold collapses end value)
    const easeIn = curve[1][1] as number[];

    expect(easeIn[0]).toBeCloseTo(1, 4); // inCp_x = lerp(0, 1, 1) = 1
    expect(easeIn[1]).toBeCloseTo(0.2, 4); // inCp_y = lerp(0.2, 0.2, 1) = 0.2
    expect(easeIn[2]).toBeCloseTo(1, 4); // t1 = 1
    expect(easeIn[3]).toBeCloseTo(0.2, 4); // v1 = 0.2 (held)
  });

  it('uses endValue as the authoritative scalar segment end', () => {
    const prop: IRAnimatedProperty<number> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0, endValue: 0.75 },
        { frame: 60, value: 1 },
      ],
    };

    const result = convertIRScalarKeyframesToGE(prop, ctx);
    const easeIn = result![0][1][1] as number[];

    expect(easeIn[3]).toBeCloseTo(0.75, 4);
  });

  it('keeps both sides of a scalar reset at the same time', () => {
    const result = convertIRScalarKeyframesToGE({
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0, endValue: 1 },
        { frame: 30, value: 0, endValue: 1 },
        { frame: 60, value: 1 },
      ],
    }, ctx);

    expect(result?.[0]).toHaveLength(4);
    expect(result?.[0][1][1].slice(2, 4)).toEqual([0.5, 1]);
    expect(result?.[0][2][1].slice(2, 4)).toEqual([0.5, 0]);
  });

  it('prepends a hold-bridge segment when the first keyframe starts after t=0', () => {
    const prop: IRAnimatedProperty<number> = {
      type: 'keyframed',
      keyframes: [
        { frame: 30, value: 0.4 },
        { frame: 60, value: 0.8, inTangent: { x: 0.5, y: 0.5 } },
      ],
    };

    const result = convertIRScalarKeyframesToGE(prop, ctx);

    expect(result).toBeDefined();
    const curve = result![0];

    // 2 keyframes + 1 prepended hold segment = 3 points total
    expect(curve).toHaveLength(3);
    expect(curve[0][0]).toBe(BezierKeyframeType.EASE_OUT);
  });

  it('reads inTangent from kf[i+1] per the per-keyframe IR convention', () => {
    // If we mistakenly read inTangent from kf[i] (the adjacent-keyframe convention),
    // the segment 0→30 would use the in-tangent intended for segment 30→60.
    // The IR convention is the opposite: kf[i+1].inTangent describes the
    // segment ending at kf[i+1]. So segment 0→30's in-tangent comes from
    // keyframes[1].inTangent.
    const prop: IRAnimatedProperty<number> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: 0, outTangent: { x: 0.2, y: 0.2 } },
        { frame: 30, value: 1, inTangent: { x: 0.9, y: 0.9 }, outTangent: { x: 0.5, y: 0.5 } },
        { frame: 60, value: 0, inTangent: { x: 0.1, y: 0.1 } },
      ],
    };

    const result = convertIRScalarKeyframesToGE(prop, ctx);

    expect(result).toBeDefined();
    const curve = result![0];
    // The middle EASE keyframe carries the in-cp from segment 0→30 (inTangent
    // of keyframes[1]) and the out-cp from segment 30→60 (outTangent of
    // keyframes[1]). With t0=0, t1=0.5 normalised, the in-cp x should be
    // lerp(0, 0.5, 0.9) = 0.45; the out-cp x should be lerp(0.5, 1, 0.5) = 0.75.
    const middle = curve[1];
    const payload = middle[1] as number[];

    // payload layout for EASE: [in_cp_x, in_cp_y, t, v, out_cp_x, out_cp_y]
    expect(payload[0]).toBeCloseTo(0.45, 4);
    expect(payload[4]).toBeCloseTo(0.75, 4);
  });
});

describe('convertIRVectorKeyframesToGE', () => {
  it('returns one curve per dimension', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [1, 2, 3], outTangent: { x: 0.5, y: 0.5 } },
        { frame: 60, value: [4, 5, 6], inTangent: { x: 0.5, y: 0.5 } },
      ],
    };

    const result = convertIRVectorKeyframesToGE(prop, ctx);

    expect(result).toHaveLength(3);
    expect(result![0]).toHaveLength(2);
    expect(result![1]).toHaveLength(2);
    expect(result![2]).toHaveLength(2);
  });

  it('returns undefined for non-keyframed properties', () => {
    const prop: IRAnimatedProperty<IRVec3> = { type: 'static', value: [0, 0, 0] };

    expect(convertIRVectorKeyframesToGE(prop, ctx)).toBeUndefined();
  });

  it('uses endValue for every vector dimension', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [0, 0, 0], endValue: [2, 3, 4] },
        { frame: 60, value: [10, 10, 10] },
      ],
    };

    const result = convertIRVectorKeyframesToGE(prop, ctx)!;

    expect((result[0][1][1] as number[])[3]).toBe(2);
    expect((result[1][1][1] as number[])[3]).toBe(3);
    expect((result[2][1][1] as number[])[3]).toBe(4);
  });
});

describe('convertIRPositionKeyframesToGE', () => {
  it('returns pathPoints + controlPoints + timing curves', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [100, 200, 0], outTangent: { x: 0.4, y: 0 } },
        { frame: 60, value: [300, 400, 0], inTangent: { x: 0.6, y: 1 } },
      ],
    };

    const result = convertIRPositionKeyframesToGE(prop, ctx);

    expect(result).toBeDefined();
    expect(result!.pathPoints).toHaveLength(1);
    expect(result!.pathPoints[0]).toEqual([
      [100, 200, 0],
      [300, 400, 0],
    ]);
    expect(result!.controlPoints).toHaveLength(1);
    expect(result!.curves[0].length).toBeGreaterThanOrEqual(2);
  });

  it('shares the boundary point between adjacent path segments', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [0, 0, 0] },
        { frame: 30, value: [50, 100, 0] },
        { frame: 60, value: [100, 200, 0] },
      ],
    };

    const result = convertIRPositionKeyframesToGE(prop, ctx);

    expect(result!.pathPoints).toHaveLength(2);
    expect(result!.pathPoints[0][1]).toEqual([50, 100, 0]);
    expect(result!.pathPoints[0][1]).toEqual(result!.pathPoints[1][0]);
  });

  it('uses explicit spatial CPs when both endpoints provide them', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [0, 0, 0], spatialOut: [10, 20], outTangent: { x: 0.5, y: 0.5 } },
        { frame: 60, value: [100, 100, 0], spatialIn: [-30, -40], inTangent: { x: 0.5, y: 0.5 } },
      ],
    };

    const result = convertIRPositionKeyframesToGE(prop, ctx);

    expect(result).toBeDefined();
    expect(result!.controlPoints[0]).toEqual([
      [10, 20, 0],
      [-30, -40, 0],
    ]);
  });

  it('synthesises linear one-third control points when spatial handles are missing', () => {
    // Control points are derived from keyframe.endValue (the authoritative segment-end value),
    // not from nextKeyframe.value. With endValue=[60,60] on the start keyframe,
    // outgoingControlPoint = (segmentEnd - startPosition) / 3 = (60-0, 60-0) / 3 = (20, 20).
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [0, 0, 0], endValue: [60, 60, 0], outTangent: { x: 0.5, y: 0.5 } },
        { frame: 60, value: [100, 100, 0], inTangent: { x: 0.5, y: 0.5 } },
      ],
    };

    const result = convertIRPositionKeyframesToGE(prop, ctx);
    const controlPointPair = result!.controlPoints[0];

    expect(result!.pathPoints[0][1]).toEqual([60, 60, 0]);
    // outgoingControlPoint = (segmentEnd - startPosition) / 3 = (60, 60) / 3 = (20, 20)
    // incomingControlPoint = (startPosition - segmentEnd) / 3 = (-20, -20)
    expect(controlPointPair[0]).toEqual([20, 20, 0]);
    expect(controlPointPair[1]).toEqual([-20, -20, 0]);
  });

  it('prepends a hold-bridge with flat {1,1} inTangent when first keyframe is past t=0', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 30, value: [50, 50, 0], outTangent: { x: 0.5, y: 0.5 } },
        { frame: 60, value: [100, 100, 0], inTangent: { x: 0.5, y: 0.5 } },
      ],
    };

    const result = convertIRPositionKeyframesToGE(prop, ctx);

    expect(result).toBeDefined();
    // 2 original kfs + 1 prepended bridge → 2 pathPoint pairs total
    expect(result!.pathPoints).toHaveLength(2);
    // bridge sits at the start: collapses to the first original position
    expect(result!.pathPoints[0]).toEqual([
      [50, 50, 0],
      [50, 50, 0],
    ]);
    expect(result!.controlPoints[0]).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  it('returns undefined when there are fewer than 2 keyframes', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [{ frame: 0, value: [0, 0, 0] }],
    };

    expect(convertIRPositionKeyframesToGE(prop, ctx)).toBeUndefined();
  });

  it('collapses segment end to start when hold=true', () => {
    const prop: IRAnimatedProperty<IRVec3> = {
      type: 'keyframed',
      keyframes: [
        { frame: 0, value: [10, 20, 0], hold: true },
        { frame: 60, value: [100, 200, 0] },
      ],
    };

    const result = convertIRPositionKeyframesToGE(prop, ctx);

    // Hold segment: segmentEnd = startPosition.
    expect(result!.pathPoints[0]).toEqual([
      [10, 20, 0],
      [10, 20, 0],
    ]);
  });
});

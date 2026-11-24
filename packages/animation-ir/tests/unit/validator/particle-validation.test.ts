import { describe, expect, it } from 'vitest';
import type { IRParticleLayer, IRParticleScalarExpression } from '@galacean/animation-ir';
import { errorCodes, errorPaths, issueKeys, makeComposition } from './test-scene';

function makeParticleLayer(): IRParticleLayer {
  return {
    id: 'particle',
    type: 'particle',
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    localBounds: { x: 0, y: 0, width: 400, height: 300 },
    content: {
      maxParticles: 100,
      startLifetime: { type: 'constant', value: 2 },
      emission: {
        rateOverTime: { type: 'randomBetweenConstants', min: 10, max: 20 },
        bursts: [{ frameOffset: 15, count: 30, cycleCount: 2, repeatIntervalFrames: 5 }],
      },
    },
  };
}

describe('particle layer validation', () => {
  it('accepts every source-neutral particle scalar expression form', () => {
    const expressions: IRParticleScalarExpression[] = [
      { type: 'constant', value: 1 },
      { type: 'randomBetweenConstants', min: 1, max: 2 },
      {
        type: 'curve',
        keyframes: [
          {
            progress: 0,
            value: 1,
            outControl: { progress: 0.3, value: 1.3 },
          },
          {
            progress: 1,
            value: 2,
            inControl: { progress: 0.7, value: 1.7 },
          },
        ],
      },
    ];

    for (const expression of expressions) {
      const layer = makeParticleLayer();

      layer.content.startLifetime = expression;
      expect(errorCodes(makeComposition({ layers: [layer] }))).toEqual([]);
    }
  });

  it('allows finite Bezier handles outside the parameter value range', () => {
    const layer = makeParticleLayer();

    layer.content.emission.rateOverTime = { type: 'curve', keyframes: [
      { progress: 0, value: 1, outControl: { progress: 0.3, value: -0.1 } },
      { progress: 1, value: 0, inControl: { progress: 0.7, value: 1 } },
    ] };
    expect(errorCodes(makeComposition({ layers: [layer] }))).toEqual([]);
    layer.content.emission.rateOverTime.keyframes[0].outControl!.value = Infinity;
    expect(errorCodes(makeComposition({ layers: [layer] }))).toContain('IR_PARTICLE_EXPRESSION_INVALID');
  });

  it('requires authoring bounds and validates particle-owned ranges', () => {
    const layer = makeParticleLayer() as unknown as Record<string, unknown>;
    const content = layer['content'] as Record<string, unknown>;
    const emission = content['emission'] as Record<string, unknown>;

    delete layer['localBounds'];
    content['maxParticles'] = 0;
    content['startLifetime'] = { type: 'randomBetweenConstants', min: 2, max: 1 };
    emission['rateOverTime'] = { type: 'constant', value: -1 };
    emission['bursts'] = [{ frameOffset: 60, count: -1, cycleCount: 2, repeatIntervalFrames: 0 }];

    const composition = makeComposition({ layers: [layer as unknown as IRParticleLayer] });

    expect(issueKeys(composition)).toEqual(expect.arrayContaining([
      'IR_LAYER_LOCAL_BOUNDS_INVALID:layers[0].localBounds',
      'IR_PARTICLE_CONTENT_INVALID:layers[0].content.maxParticles',
      'IR_PARTICLE_EXPRESSION_INVALID:layers[0].content.startLifetime',
      'IR_PARTICLE_EXPRESSION_INVALID:layers[0].content.emission.rateOverTime.value',
      'IR_PARTICLE_BURST_INVALID:layers[0].content.emission.bursts[0].frameOffset',
    ]));
  });

  it('requires explicit cycle semantics and bounds finite repeated bursts', () => {
    const layer = makeParticleLayer() as unknown as Record<string, unknown>;
    const content = layer['content'] as Record<string, unknown>;
    const emission = content['emission'] as Record<string, unknown>;

    emission['bursts'] = [
      { frameOffset: 10, count: 1 },
      { frameOffset: 10, count: 1, cycleCount: 'infinite', repeatIntervalFrames: 0 },
      { frameOffset: 50, count: 1, cycleCount: 2, repeatIntervalFrames: 10 },
    ];

    const paths = errorPaths(
      makeComposition({ layers: [layer as unknown as IRParticleLayer] }),
      'IR_PARTICLE_BURST_INVALID',
    );

    expect(paths).toEqual(expect.arrayContaining([
      'layers[0].content.emission.bursts[0].cycleCount',
      'layers[0].content.emission.bursts[0].repeatIntervalFrames',
      'layers[0].content.emission.bursts[1].repeatIntervalFrames',
      'layers[0].content.emission.bursts[2]',
    ]));
  });
});

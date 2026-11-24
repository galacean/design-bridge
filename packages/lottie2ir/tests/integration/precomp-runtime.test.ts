import { describe, expect, it } from 'vitest';
import { getStandardJSON } from '@galacean/effects';
import { DataType, ValueType } from '@galacean/effects-specification';
import type { LottieJSON } from '@galacean/lottie2ir';
import { convertLottieToGE } from '../helpers/convert-lottie-to-ge';

function baseTransform() {
  return {
    a: { a: 0, k: [0, 0, 0] },
    p: { a: 0, k: [0, 0, 0] },
    s: { a: 0, k: [100, 100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
  };
}

const precompRuntimeCases: Array<{ name: string; input: LottieJSON }> = [
  {
    name: 'nested-precomp-static-opacity-chain',
    input: {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 100,
      w: 200,
      h: 200,
      nm: 'nested-precomp-static-opacity-chain',
      layers: [
        {
          ty: 0,
          nm: 'root-precomp',
          ind: 1,
          refId: 'asset-A',
          ip: 0,
          op: 100,
          st: 0,
          ks: { ...baseTransform(), o: { a: 0, k: 50 } },
        },
      ],
      assets: [
        {
          id: 'asset-A',
          w: 200,
          h: 200,
          layers: [
            {
              ty: 0,
              nm: 'precomp-A',
              ind: 11,
              refId: 'asset-B',
              ip: 0,
              op: 100,
              st: 0,
              ks: { ...baseTransform(), o: { a: 0, k: 80 } },
            },
          ],
        },
        {
          id: 'asset-B',
          w: 150,
          h: 150,
          layers: [
            {
              ty: 0,
              nm: 'precomp-B',
              ind: 21,
              refId: 'asset-C',
              ip: 0,
              op: 100,
              st: 0,
              ks: { ...baseTransform(), o: { a: 0, k: 25 } },
            },
          ],
        },
        {
          id: 'asset-C',
          w: 120,
          h: 120,
          layers: [
            {
              ty: 2,
              nm: 'deep-image',
              ind: 31,
              refId: 'asset-IMG',
              ip: 0,
              op: 100,
              st: 0,
              ks: baseTransform(),
            },
          ],
        },
        {
          id: 'asset-IMG',
          p: 'deep.png',
          w: 64,
          h: 64,
        },
      ],
    } as unknown as LottieJSON,
  },
  {
    name: 'precomp-with-sr-and-tm-metadata',
    input: {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 120,
      w: 200,
      h: 200,
      nm: 'precomp-with-sr-and-tm-metadata',
      layers: [
        {
          ty: 0,
          nm: 'precomp-root',
          ind: 1,
          refId: 'asset-pre',
          ip: 0,
          op: 120,
          st: 0,
          ks: baseTransform(),
        },
      ],
      assets: [
        {
          id: 'asset-pre',
          w: 200,
          h: 200,
          layers: [
            {
              ty: 2,
              nm: 'sprite-sr-tm',
              ind: 2,
              refId: 'asset-IMG',
              ip: 10,
              op: 90,
              st: 5,
              sr: 0.75,
              tm: {
                a: 1,
                k: [
                  { t: 0, s: [0] },
                  { t: 20, s: [10] },
                ],
              },
              ks: baseTransform(),
            },
          ],
        },
        {
          id: 'asset-IMG',
          p: 'a.png',
          w: 64,
          h: 64,
        },
      ],
    } as unknown as LottieJSON,
  },
];

describe('precomp runtime compatibility', () => {
  it('passes runtime compatibility and structural guards for nested and time-remapped precomps', async () => {
    for (const testCase of precompRuntimeCases) {
      const result = await convertLottieToGE(testCase.input, { resourceBaseUrl: 'https://example.com/animations/' });
      const scene = result.scene as unknown as Record<string, unknown>;

      expect(() => getStandardJSON(scene)).not.toThrow();

      const items = (scene.items as Array<Record<string, unknown>> | undefined) ?? [];

      if (testCase.name === 'nested-precomp-static-opacity-chain') {
        const deepItem = items.find(item => item.name === 'deep-image');
        const compositionItems = items.filter(item => item.type === '7');

        expect(deepItem).toBeDefined();
        expect(deepItem?.parentId).toBeUndefined();
        expect(compositionItems.length).toBeGreaterThanOrEqual(2);
        expect(result.diagnostics).toHaveLength(0);
        expect((scene.miscs as Array<Record<string, unknown>>).some(misc => {
          const color = misc['colorOverLifetime'] as Record<string, unknown> | undefined;

          return misc['dataType'] === DataType.SpriteColorPlayableAsset &&
            JSON.stringify(color?.['opacity']) === JSON.stringify([ValueType.CONSTANT, 0.1]);
        })).toBe(true);
      }

      if (testCase.name === 'precomp-with-sr-and-tm-metadata') {
        const spriteItem = items.find(item => item.name === 'sprite-sr-tm');

        expect(spriteItem).toBeDefined();
        expect(result.diagnostics).toHaveLength(0);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ItemType } from '@galacean/effects-specification';
import { LOTTIE_CONVERTER_ERROR_CODES } from '@galacean/lottie2ir';
import { hasInputSources, listInputJsonFiles, readInputJson, TEST_INPUT_LIMITS } from '../helpers/input-files';
import { convertLottieToGE } from '../helpers/convert-lottie-to-ge';

describe('lottie2ir and ge-ir integration', () => {
  it('converts minimal Lottie to GE', async () => {
    const minimalLottie = {
      v: '5.7.0',
      fr: 24,
      ip: 0,
      op: 48,
      w: 1080,
      h: 570,
      nm: 'test-minimal',
      layers: [
        {
          ty: 2,
          nm: 'image-layer',
          ind: 0,
          ip: 0,
          op: 48,
          st: 0,
          ks: {
            a: { a: 0, k: [50, 50, 0] },
            p: { a: 0, k: [540, 285, 0] },
            s: { a: 0, k: [100, 100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          refId: 'img_0',
          w: 100,
          h: 100,
        },
      ],
      assets: [{ id: 'img_0', w: 100, h: 100, p: 'data:image/png;base64,iVBORw==', u: '', e: 1 }],
    };

    const result = await convertLottieToGE(JSON.stringify(minimalLottie));
    const sceneRecord = result.scene as unknown as Record<string, unknown>;

    expect(result.scene).toBeDefined();
    expect(sceneRecord['type']).toBe('ge');
    expect(result.scene.images).toHaveLength(1);
    expect(result.scene.compositions).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });

  it('keeps a Precomp clip mask equal to its intrinsic image canvas', async () => {
    const lottie = {
      v: '5.7.0', fr: 20, ip: 0, op: 80, w: 1080, h: 570, nm: 'button-precomp-clip',
      layers: [{
        ty: 0, nm: 'button-precomp', ind: 1, ip: 0, op: 80, st: 0, refId: 'button-comp', w: 235, h: 83,
        ks: {
          a: { a: 0, k: [117.5, 41.5, 0] }, p: { a: 0, k: [180, 440, 0] },
          s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
        },
      }],
      assets: [
        {
          id: 'button-comp',
          layers: [{
            ty: 2, nm: 'button-background', ind: 1, ip: 0, op: 80, st: 0, refId: 'button-image', w: 235, h: 83,
            ks: {
              a: { a: 0, k: [117.5, 41.5, 0] }, p: { a: 0, k: [117.5, 41.5, 0] },
              s: { a: 0, k: [100, 100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 },
            },
          }],
        },
        { id: 'button-image', w: 235, h: 83, p: 'data:image/png;base64,iVBORw==', u: '', e: 1 },
      ],
    };

    const { scene } = await convertLottieToGE(JSON.stringify(lottie));
    const maskItem = scene.items.find(item => item.name === 'button-precomp_mask');
    const maskComponent = (scene.components as unknown as Record<string, unknown>[]).find(
      component => component['id'] === maskItem?.components?.[0]?.id,
    );
    const imageItem = scene.items.find(item => item.name === 'button-background' && item.type === ItemType.sprite);

    expect(maskComponent?.['width']).toBe(imageItem?.transform?.size?.x);
    expect(maskComponent?.['height']).toBe(imageItem?.transform?.size?.y);
  });

  it('rejects input without Lottie Composition fields', async () => {
    const invalidInput = { type: 'unknown' };

    await expect(convertLottieToGE(JSON.stringify(invalidInput))).rejects.toMatchObject({
      code: LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
    });
  });

  const testFiles = listInputJsonFiles(TEST_INPUT_LIMITS.convert);

  it('has available fixtures', () => {
    expect(hasInputSources()).toBe(true);
    expect(testFiles.length).toBeGreaterThan(0);
  });

  for (const fileName of testFiles) {
    it(`converts fixture: ${fileName}`, async () => {
      const content = readInputJson(fileName);
      const result = await convertLottieToGE(content);
      const sceneRecord = result.scene as unknown as Record<string, unknown>;

      expect(result.scene).toBeDefined();
      expect(sceneRecord['type']).toBe('ge');
      expect(result.scene.images).toBeInstanceOf(Array);
      expect(result.scene.compositions.length).toBeGreaterThanOrEqual(1);

      const comp = result.scene.compositions.find(composition => composition.id === result.scene.compositionId);

      expect(comp).toBeDefined();
      const compRecord = comp as unknown as Record<string, unknown>;
      const components = compRecord['components'] as unknown[] | undefined;
      const itemCount = components?.length ?? 0;

      expect(itemCount).toBeGreaterThan(0);
      expect(comp?.duration).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    });
  }
});

import { describe, expect, it } from 'vitest';
import { getStandardJSON } from '@galacean/effects';
import { hasInputSources, listInputJsonFiles, readInputJson, TEST_INPUT_LIMITS } from '../helpers/input-files';
import { assertCommonSceneIntegrity } from '../helpers/scene-integrity';
import { convertLottieToGE } from '../helpers/convert-lottie-to-ge';

describe('Lottie to GE scene coverage', () => {
  it('validates fixture inputs against structure and runtime compatibility', async () => {
    expect(hasInputSources()).toBe(true);

    const files = listInputJsonFiles(TEST_INPUT_LIMITS.coverage, true);

    expect(files.length).toBeGreaterThan(0);

    for (const fileName of files) {
      const raw = readInputJson(fileName);
      const converted = await convertLottieToGE(raw);
      const scene = converted.scene as unknown as Record<string, unknown>;

      assertCommonSceneIntegrity(scene, fileName);
      expect(() => getStandardJSON(scene), `processJSON failed for ${fileName}`).not.toThrow();
    }
  });
});
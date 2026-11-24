import { describe, expect, it } from 'vitest';
import {
  hasInputSources,
  isUsingLocalInputDir,
  listInputJsonFiles,
  readInputJson,
  TEST_INPUT_LIMITS,
} from '../helpers/input-files';
import { normalizeSceneIgnoringGuid, stableStringify } from '../helpers/scene-string-compare';
import type { JSONValue } from '../helpers/scene-string-compare';
import { convertLottieToGE } from '../helpers/convert-lottie-to-ge';

const snapshotIt = isUsingLocalInputDir() ? it.skip : it;

describe('Lottie to GE scene snapshot', () => {
  snapshotIt('matches normalized output for fixture inputs', async () => {
    expect(hasInputSources()).toBe(true);

    const files = listInputJsonFiles(TEST_INPUT_LIMITS.snapshot, true);

    expect(files.length).toBeGreaterThan(0);

    for (const fileName of files) {
      const raw = readInputJson(fileName);
      const converted = await convertLottieToGE(raw);
      const normalized = normalizeSceneIgnoringGuid(converted.scene as unknown as JSONValue);
      const sceneText = stableStringify(normalized);

      expect.soft(sceneText, fileName).toMatchSnapshot();
    }
  });
});

import { describe, expect, it } from 'vitest';
import * as shader2ge from '@galacean/shader2ge';

describe('@galacean/shader2ge public API', () => {
  it('should expose only the supported runtime functions', () => {
    expect(Object.keys(shader2ge)).toEqual(['convertShaderToGE']);
  });
});

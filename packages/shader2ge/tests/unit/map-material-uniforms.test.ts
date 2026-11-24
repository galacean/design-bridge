import { describe, expect, it } from 'vitest';
import type * as spec from '@galacean/effects-specification';
import type { ParsedUniform } from '../../src/conversion-types';
import { mapUniformsToMaterial } from '../../src/converter/map-material-uniforms';
import { DEFAULT_WHITE_TEXTURE_URL } from '../../src/generator/texture-constants';

describe('mapUniformsToMaterial', () => {
  it('should map supported numeric and vector uniforms with defaults', () => {
    const uniforms: ParsedUniform[] = [
      { name: 'uFloat', type: 'float' },
      { name: 'uInt', type: 'int' },
      { name: 'uVec2', type: 'vec2' },
      { name: 'uVec3', type: 'vec3' },
      { name: 'uVec4', type: 'vec4' },
    ];

    const result = mapUniformsToMaterial(uniforms, {
      uFloat: 2,
      uInt: 3,
      uVec4: { x: 6, y: 7, z: 8, w: 9 },
    });

    expect(result.floats.uFloat).toBe(2);
    expect(result.ints.uInt).toBe(3);
    expect(result.vector4s.uVec2).toBeUndefined();
    expect(result.vector4s.uVec3).toBeUndefined();
    expect(result.vector4s.uVec4).toEqual({ x: 6, y: 7, z: 8, w: 9 });
  });

  it('should map vec4 color override to colors', () => {
    const uniforms: ParsedUniform[] = [{ name: 'uColor', type: 'vec4' }];
    const result = mapUniformsToMaterial(uniforms, {
      uColor: { r: 1, g: 0.5, b: 0.25, a: 1 },
    });

    expect(result.colors.uColor).toEqual({ r: 1, g: 0.5, b: 0.25, a: 1 });
    expect(result.vector4s.uColor).toBeUndefined();
  });

  it('should create default texture chain for sampler2D without override', () => {
    const uniforms: ParsedUniform[] = [{ name: 'uMainTex', type: 'sampler2D' }];
    const result = mapUniformsToMaterial(uniforms);

    expect(result.images).toHaveLength(1);
    expect(result.textures).toHaveLength(1);
    expect(result.images[0].url).toBe(DEFAULT_WHITE_TEXTURE_URL);
    expect(result.materialTextures.uMainTex.texture.id).toBe(result.textures[0].id);
    expect(((result.textures[0] as spec.SerializedTexture2DImageSource).source as spec.DataPath).id).toBe(
      result.images[0].id,
    );
  });
});

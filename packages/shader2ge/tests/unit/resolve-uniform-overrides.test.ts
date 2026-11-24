import { describe, expect, it } from 'vitest';
import type { ConvertShaderToGEOptions } from '../../src/conversion-types';
import {
  isColorInput,
  isTextureInput,
  isVector4Input,
  resolveUniformOverrides,
} from '../../src/converter/resolve-uniform-overrides';
import {
  mapPreviewSizeToResolution,
  shouldInjectNativeResolution,
} from '../../src/converter/map-resolution-uniform';

describe('resolveUniformOverrides', () => {
  it('should keep uniformOverrides precedence over channelTextures', () => {
    const { overrides, diagnostics } = resolveUniformOverrides(
      {
        uniformOverrides: {
          iChannel0: { url: 'https://example.com/override.png' },
          uFloat: 1,
        },
        channelTextures: {
          iChannel0: { url: 'https://example.com/channel.png' },
          iChannel1: { url: 'https://example.com/channel1.png' },
        },
      },
      [
        { name: 'uFloat', type: 'float' },
        { name: 'iChannel0', type: 'sampler2D' },
        { name: 'iChannel1', type: 'sampler2D' },
      ],
    );

    expect(overrides.iChannel0).toEqual({ url: 'https://example.com/override.png' });
    expect(overrides.iChannel1).toEqual({ url: 'https://example.com/channel1.png' });
    expect(overrides.uFloat).toBe(1);
    expect(diagnostics).toEqual([]);
  });

  it('shouldInjectNativeResolution should require uResolution vec4', () => {
    const uniforms = [{ name: 'uResolution', type: 'vec4' as const }];

    expect(shouldInjectNativeResolution(uniforms)).toBe(true);
    expect(shouldInjectNativeResolution([{ name: 'uResolution', type: 'vec3' as const }])).toBe(false);
  });

  it('mapPreviewSizeToResolution should map previewSize to vec4 payload', () => {
    expect(mapPreviewSizeToResolution([800, 600])).toEqual({ x: 800, y: 600, z: 1, w: 0 });
  });

  it('type guards should classify texture/vector/color inputs correctly', () => {
    expect(isTextureInput({ url: 'https://example.com/tex.png' })).toBe(true);
    expect(isTextureInput({ url: ' ' })).toBe(false);
    expect(isTextureInput({ url: 'javascript:alert(1)' })).toBe(false);
    expect(isTextureInput({ url: 'file:///tmp/texture.png' })).toBe(false);
    expect(isTextureInput({ url: 'x', wrapS: Number.NaN })).toBe(false);
    expect(isTextureInput({ x: 1, y: 2 })).toBe(false);

    expect(isVector4Input({ x: 1, y: 2, z: 3, w: 4 })).toBe(true);
    expect(isVector4Input({ x: 1, y: 2 })).toBe(false);
    expect(isVector4Input({ r: 1, g: 2, b: 3, a: 4 })).toBe(false);

    expect(isColorInput({ r: 1, g: 0.5, b: 0.2, a: 1 })).toBe(true);
    expect(isColorInput({ r: 1, g: 0.5, b: Number.POSITIVE_INFINITY, a: 1 })).toBe(false);
    expect(isColorInput({ x: 1, y: 2, z: 3, w: 4 })).toBe(false);
  });

  it('should reject invalid channels, unknown overrides, and mismatched values', () => {
    const options = {
      uniformOverrides: {
        uFloat: { x: 1, y: 2, z: 3, w: 4 },
        uUnknown: 1,
      },
      channelTextures: {
        iChannel4: { url: 'https://example.com/out-of-range.png' },
      },
    } as unknown as ConvertShaderToGEOptions;
    const { overrides, diagnostics } = resolveUniformOverrides(options, [{ name: 'uFloat', type: 'float' }]);

    expect(overrides).toEqual({});
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'UNIFORM_OVERRIDE_INVALID',
      'UNIFORM_OVERRIDE_UNKNOWN',
      'CHANNEL_NAME_INVALID',
    ]);
  });

  it('should reject non-integer int values and invalid texture inputs', () => {
    const options = {
      uniformOverrides: {
        uCount: 1.5,
        uTexture: { url: '', minFilter: 1 },
      },
    } as unknown as ConvertShaderToGEOptions;
    const { overrides, diagnostics } = resolveUniformOverrides(options, [
      { name: 'uCount', type: 'int' },
      { name: 'uTexture', type: 'sampler2D' },
    ]);

    expect(overrides).toEqual({});
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'UNIFORM_OVERRIDE_INVALID',
      'TEXTURE_INPUT_INVALID',
    ]);
  });
});

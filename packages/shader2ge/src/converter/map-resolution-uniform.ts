import type * as spec from '@galacean/effects-specification';
import type { ParsedUniform } from '../conversion-types';

export function shouldInjectNativeResolution(
  uniforms: ParsedUniform[],
): boolean {
  return uniforms.some(uniform => uniform.name === 'uResolution' && uniform.type === 'vec4');
}

export function mapPreviewSizeToResolution(previewSize: [number, number]): spec.Vector4Data {
  return {
    x: previewSize[0],
    y: previewSize[1],
    z: 1,
    w: 0,
  };
}

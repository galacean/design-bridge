import * as spec from '@galacean/effects-specification';
import { describe, expect, it } from 'vitest';
import { convertShaderToGE } from '@galacean/shader2ge';
import { validateGEScene } from '../../src/validator/validate-ge-scene';

const NATIVE_SHADER = `
precision highp float;
varying vec2 vUV;
uniform vec4 uResolution;
void main() {
  gl_FragColor = vec4(vUV * uResolution.xy / uResolution.xy, 0.0, 1.0);
}
`;

describe('validateGEScene', () => {
  it('should accept a generated scene with complete DataPath references and JSON values', () => {
    const { scene } = convertShaderToGE(NATIVE_SHADER, { previewSize: [1280, 720] });

    expect(validateGEScene(scene)).toEqual([]);
    expect(JSON.parse(JSON.stringify(scene))).toStrictEqual(scene);
  });

  it('should report unresolved references and non-finite numbers', () => {
    const { scene } = convertShaderToGE(NATIVE_SHADER);

    scene.materials[0].shader.id = 'missing-shader';
    scene.items[0].duration = Number.NaN;

    const diagnostics = validateGEScene(scene);

    expect(diagnostics).toContainEqual({
      code: 'SCENE_REFERENCE_INVALID',
      severity: 'error',
      message: 'DataPath reference "missing-shader" does not resolve to the expected object pool.',
      path: '$.materials[0].shader',
    });
    expect(diagnostics).toContainEqual({
      code: 'SCENE_VALUE_NON_FINITE',
      severity: 'error',
      message: 'Generated JSONScene contains a non-finite number.',
      path: '$.items[0].duration',
    });
  });

  it('should report references that resolve to the wrong GE object type', () => {
    const { scene } = convertShaderToGE(NATIVE_SHADER);
    const effectComponent = scene.components.find(component => component.dataType === spec.DataType.EffectComponent);

    scene.compositions[0].components[0].id = effectComponent!.id;

    expect(validateGEScene(scene)).toContainEqual({
      code: 'SCENE_REFERENCE_INVALID',
      severity: 'error',
      message:
        `DataPath reference "${effectComponent!.id}" resolves to "EffectComponent" ` +
        'instead of "CompositionComponent".',
      path: '$.compositions[0].components[0]',
    });
  });
});

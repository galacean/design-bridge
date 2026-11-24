import { describe, it, expect } from 'vitest';
import { parseUniforms } from '../../src/parser/parse-uniforms';

describe('parseUniforms', () => {
  it('should parse basic uniform declarations', () => {
    const source = `
      uniform float uTime;
      uniform vec4 uColor;
      void main() { gl_FragColor = uColor; }
    `;
    const { uniforms, diagnostics } = parseUniforms(source);

    expect(uniforms).toHaveLength(2);
    expect(uniforms[0]).toEqual({ name: 'uTime', type: 'float' });
    expect(uniforms[1]).toEqual({ name: 'uColor', type: 'vec4' });
    expect(diagnostics).toEqual([]);
  });

  it('should parse all supported types', () => {
    const source = `
      uniform float uFloat;
      uniform vec2 uVec2;
      uniform vec3 uVec3;
      uniform vec4 uVec4;
      uniform int uInt;
      uniform sampler2D uTexture;
      void main() {}
    `;
    const { uniforms, diagnostics } = parseUniforms(source);

    expect(uniforms).toHaveLength(6);
    expect(uniforms.map(u => u.type)).toEqual(['float', 'vec2', 'vec3', 'vec4', 'int', 'sampler2D']);
    expect(diagnostics.filter(diagnostic => diagnostic.code === 'UNIFORM_VECTOR_SIZE_UNSUPPORTED')).toHaveLength(2);
  });

  it('should capture inline comments', () => {
    const source = `
      uniform float uTime; // elapsed time in seconds
      uniform vec4 uColor; // base color
      void main() {}
    `;
    const { uniforms } = parseUniforms(source);

    expect(uniforms[0].comment).toBe('elapsed time in seconds');
    expect(uniforms[1].comment).toBe('base color');
  });

  it('should skip duplicate uniform names', () => {
    const source = `
      uniform float uTime;
      uniform float uTime;
      void main() {}
    `;
    const { uniforms, diagnostics } = parseUniforms(source);

    expect(uniforms).toHaveLength(1);
    expect(diagnostics).toContainEqual({
      code: 'UNIFORM_DUPLICATE',
      severity: 'warning',
      message: 'Duplicate uniform "uTime" with type "float" was ignored.',
      path: '$.shader.uniforms.uTime',
    });
  });

  it('should report conflicting duplicate uniform types', () => {
    const { uniforms, diagnostics } = parseUniforms(`
      uniform float uValue;
      uniform vec4 uValue;
    `);

    expect(uniforms).toEqual([{ name: 'uValue', type: 'float' }]);
    expect(diagnostics).toContainEqual({
      code: 'UNIFORM_TYPE_CONFLICT',
      severity: 'error',
      message: 'Uniform "uValue" is declared as both "float" and "vec4"; the first declaration was kept.',
      path: '$.shader.uniforms.uValue',
    });
  });

  it('should report arrays, matrices, and unknown uniform types', () => {
    const { uniforms, diagnostics } = parseUniforms(`
      uniform float uWeights[4];
      uniform mat4 uTransform;
      uniform samplerCube uEnvironment;
    `);

    expect(uniforms).toEqual([]);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'UNIFORM_ARRAY_UNSUPPORTED',
      'UNIFORM_TYPE_UNSUPPORTED',
      'UNIFORM_TYPE_UNSUPPORTED',
    ]);
    expect(diagnostics.every(diagnostic => diagnostic.severity === 'error')).toBe(true);
  });

  it('should return empty array for shader without uniforms', () => {
    const source = `
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }
    `;
    const { uniforms, diagnostics } = parseUniforms(source);

    expect(uniforms).toHaveLength(0);
    expect(diagnostics).toEqual([]);
  });

  it('should handle uniforms without comments', () => {
    const source = `uniform float uSpeed;`;
    const { uniforms } = parseUniforms(source);

    expect(uniforms).toHaveLength(1);
    expect(uniforms[0]).toEqual({ name: 'uSpeed', type: 'float' });
    expect(uniforms[0].comment).toBeUndefined();
  });
});

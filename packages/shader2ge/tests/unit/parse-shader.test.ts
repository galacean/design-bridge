import { describe, it, expect } from 'vitest';
import { parseShader } from '../../src/parser/parse-shader';

const NATIVE_SHADER = `
precision highp float;
varying vec2 vUV;
uniform float uTime;
uniform vec4 uColor;

void main() {
  vec3 col = 0.5 + 0.5 * cos(uTime + vUV.xyx + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(col, 1.0) * uColor;
}
`.trim();

const MAINIMAGE_SOURCE = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3(0.0, 2.0, 4.0));
  fragColor = vec4(col, 1.0);
}
`.trim();

const MAINIMAGE_WITH_ICHANNEL = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 tex = texture2D(iChannel0, uv);
  fragColor = tex;
}
`.trim();

describe('parseShader', () => {
  describe('empty input', () => {
    it('falls back to gradient and emits a warning', () => {
      const parsed = parseShader('');

      expect(parsed.diagnostics).toContainEqual({
        code: 'SHADER_EMPTY',
        severity: 'warning',
        message: 'Empty fragment shader was replaced with the fallback gradient shader.',
        path: '$.shader',
      });
      expect(parsed.fragment).toContain('gl_FragColor');
      expect(parsed.fragment).toContain('void main');
    });

    it('also handles whitespace-only input', () => {
      const parsed = parseShader('   \n\t  \n');

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_EMPTY')).toBe(true);
    });
  });

  describe('GE-native shader', () => {
    it('passes source through and parses uniforms', () => {
      const parsed = parseShader(NATIVE_SHADER);

      expect(parsed.usesMainImage).toBe(false);
      expect(parsed.fragment).toContain('uniform vec4 uColor');
      expect(parsed.fragment).toContain('gl_FragColor');
      const names = parsed.uniforms.map(u => u.name);

      expect(names).toContain('uColor');
    });

    it('emits no structural diagnostics for valid input', () => {
      const parsed = parseShader(NATIVE_SHADER);

      expect(parsed.diagnostics).toEqual([]);
    });
  });

  describe('mainImage format bridging', () => {
    it('detects mainImage and produces a bridged fragment', () => {
      const parsed = parseShader(MAINIMAGE_SOURCE);

      expect(parsed.usesMainImage).toBe(true);
      expect(parsed.fragment).toContain('precision highp float;');
      expect(parsed.fragment).toContain('varying vec2 vUV;');
      expect(parsed.fragment).toContain('varying float vTime;');
      expect(parsed.fragment).toContain('uniform vec4 iResolution');
      expect(parsed.fragment).toContain('#define iTime vTime');
      expect(parsed.fragment).toContain('void main()');
      expect(parsed.fragment).toContain('mainImage(fragColor, fragCoord)');
      expect(parsed.fragment).toContain('gl_FragColor = fragColor');
    });

    it('auto-injects iChannel uniforms based on usage', () => {
      const parsed = parseShader(MAINIMAGE_WITH_ICHANNEL);

      expect(parsed.usesMainImage).toBe(true);
      expect(parsed.fragment).toContain('uniform sampler2D iChannel0;');
      const names = parsed.uniforms.map(u => u.name);

      expect(names).toContain('iChannel0');
    });

    it('does not inject an iChannel uniform referenced only in a comment', () => {
      const parsed = parseShader(`
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          // iChannel0 can be connected by callers when texture sampling is enabled.
          fragColor = vec4(fragCoord, 0.0, 1.0);
        }
      `);

      expect(parsed.fragment).toContain('// iChannel0 can be connected by callers when texture sampling is enabled.');
      expect(parsed.fragment).not.toContain('uniform sampler2D iChannel0;');
      expect(parsed.uniforms.some(uniform => uniform.name === 'iChannel0')).toBe(false);
    });

    it.each(['lowp', 'mediump', 'highp'])(
      'normalizes a same-line %s-qualified iChannel declaration without duplicating it',
      precision => {
        const parsed = parseShader(`
          uniform ${precision} sampler2D iChannel0; void mainImage(out vec4 fragColor, in vec2 fragCoord) {
            fragColor = texture2D(iChannel0, fragCoord / iResolution.xy);
          }
        `);

        expect(parsed.fragment.match(/uniform\s+sampler2D\s+iChannel0\s*;/g)).toHaveLength(1);
        expect(parsed.fragment).not.toMatch(new RegExp(`uniform\\s+${precision}\\s+sampler2D\\s+iChannel0`));
        expect(parsed.uniforms.filter(uniform => uniform.name === 'iChannel0')).toHaveLength(1);
        expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'UNIFORM_DUPLICATE')).toBe(false);
      },
    );

    it('does not bridge a mainImage signature that only appears in a comment', () => {
      const parsed = parseShader(`
        /*
        void mainImage(out vec4 fragColor, in vec2 fragCoord) {
          fragColor = vec4(1.0);
        }
        */
      `);

      expect(parsed.usesMainImage).toBe(false);
      expect(parsed.fragment).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_MAIN_MISSING')).toBe(true);
      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_OUTPUT_MISSING')).toBe(true);
    });
  });

  describe('structural validation', () => {
    it('reports GLSL ES 3.00 as unsupported', () => {
      const parsed = parseShader(`
        #version 300 es
        precision highp float;
        out vec4 fragmentColor;
        void main() { fragmentColor = vec4(1.0); }
      `);

      expect(parsed.diagnostics).toContainEqual({
        code: 'SHADER_VERSION_UNSUPPORTED',
        severity: 'error',
        message: 'GLSL ES 3.00 shaders are not supported; use WebGL 1.0 / GLSL ES 1.00 syntax.',
        path: '$.shader',
      });
    });

    it('ignores GLSL version directives that only appear in comments', () => {
      const parsed = parseShader(`
        // #version 300 es
        /* #version 300 es */
        precision highp float;
        void main() { gl_FragColor = vec4(1.0); }
      `);

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_VERSION_UNSUPPORTED')).toBe(false);
    });

    it('warns when main() is missing', () => {
      const noMain = `
        precision highp float;
        varying vec2 vUV;
        void other() { }
      `;
      const parsed = parseShader(noMain);

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_MAIN_MISSING')).toBe(true);
    });

    it('warns when gl_FragColor is not written', () => {
      const noFragColor = `
        precision highp float;
        void main() {
          float x = 1.0;
        }
      `;
      const parsed = parseShader(noFragColor);

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_OUTPUT_MISSING')).toBe(true);
    });

    it('does not accept a main() function that only appears in a comment', () => {
      const source = `
        precision highp float;
        /* void main() { gl_FragColor = vec4(1.0); } */
        void helper() { gl_FragColor = vec4(1.0); }
      `;
      const parsed = parseShader(source);

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_MAIN_MISSING')).toBe(true);
      expect(parsed.fragment).toContain('/* void main() { gl_FragColor = vec4(1.0); } */');
    });

    it('does not accept a fragment color write that only appears in a comment', () => {
      const source = `
        precision highp float;
        void main() {
          // gl_FragColor = vec4(1.0);
          float value = 1.0;
        }
      `;
      const parsed = parseShader(source);

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'SHADER_OUTPUT_MISSING')).toBe(true);
      expect(parsed.fragment).toContain('// gl_FragColor = vec4(1.0);');
    });

    it('ignores out-of-range channel names in comments', () => {
      const parsed = parseShader(`
        precision highp float;
        // iChannel4 is not active.
        void main() { gl_FragColor = vec4(1.0); }
      `);

      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'CHANNEL_NAME_INVALID')).toBe(false);
    });
  });

  describe('uTime auto-bridge', () => {
    it('rewrites uniform float uTime into a vTime-backed #define', () => {
      const parsed = parseShader(NATIVE_SHADER);

      expect(parsed.fragment).toContain('varying float vTime;');
      expect(parsed.fragment).toContain('#define uTime vTime');
      expect(parsed.fragment).not.toMatch(/uniform\s+float\s+uTime\s*;/);
    });

    it('removes uTime from the uniform list so it is not written to material floats', () => {
      const parsed = parseShader(NATIVE_SHADER);
      const names = parsed.uniforms.map(u => u.name);

      expect(names).not.toContain('uTime');
    });

    it('removes duplicate uTime declarations when applying the bridge', () => {
      const parsed = parseShader(`${NATIVE_SHADER}\nuniform float uTime;`);

      expect(parsed.fragment.match(/uniform\s+float\s+uTime/g)).toBeNull();
      expect(parsed.fragment.match(/#define uTime vTime/g)).toHaveLength(1);
      expect(parsed.diagnostics.some(diagnostic => diagnostic.code === 'UNIFORM_DUPLICATE')).toBe(true);
    });

    it('preserves valid GLSL that follows the uTime declaration on the same line', () => {
      const parsed = parseShader(
        'precision highp float; uniform float uTime; void main() { gl_FragColor = vec4(uTime); }',
      );

      expect(parsed.fragment).toContain('void main() { gl_FragColor = vec4(uTime); }');
      expect(parsed.fragment).toMatch(/#define uTime vTime\s*\n\s*void main/);
      expect(parsed.diagnostics).toEqual([]);
    });

    it.each(['lowp', 'mediump', 'highp'])('rewrites a %s-qualified uTime declaration', precision => {
      const parsed = parseShader(`
        precision highp float;
        uniform ${precision} float uTime;
        void main() { gl_FragColor = vec4(uTime); }
      `);

      expect(parsed.fragment).toContain('#define uTime vTime');
      expect(parsed.fragment).not.toMatch(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?float\s+uTime\s*;/);
      expect(parsed.uniforms.some(uniform => uniform.name === 'uTime')).toBe(false);
      expect(parsed.diagnostics).toEqual([]);
    });

    it('preserves commented uTime declarations while bridging the active declaration', () => {
      const parsed = parseShader(`
        precision highp float;
        /* uniform float uTime; retained as documentation */
        uniform highp float uTime;
        void main() { gl_FragColor = vec4(uTime); }
      `);

      expect(parsed.fragment).toContain('/* uniform float uTime; retained as documentation */');
      expect(parsed.fragment).not.toMatch(/^\s*uniform\s+highp\s+float\s+uTime\s*;/m);
      expect(parsed.fragment).toContain('#define uTime vTime');
    });

    it('leaves uniform lists alone when uTime is absent', () => {
      const noUTime = `
        precision highp float;
        varying vec2 vUV;
        uniform vec4 uColor;
        void main() { gl_FragColor = uColor; }
      `;
      const parsed = parseShader(noUTime);
      const names = parsed.uniforms.map(u => u.name);

      expect(names).toContain('uColor');
      expect(parsed.fragment).not.toContain('#define uTime');
    });
  });
});

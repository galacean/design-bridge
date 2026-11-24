import type { ParsedUniform, ShaderDiagnostic, UniformType } from '../conversion-types';

const SUPPORTED_TYPES: Set<string> = new Set(['float', 'vec2', 'vec3', 'vec4', 'int', 'sampler2D']);
const UNIFORM_REGEX = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*;/g;

export interface ParseUniformsResult {
  uniforms: ParsedUniform[];
  diagnostics: ShaderDiagnostic[];
}

export function parseUniforms(source: string): ParseUniformsResult {
  const uniforms: ParsedUniform[] = [];
  const diagnostics: ShaderDiagnostic[] = [];
  const seen = new Map<string, string>();
  const sourceWithoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));

  for (const line of sourceWithoutBlocks.split('\n')) {
    const commentStart = line.indexOf('//');
    const code = commentStart === -1 ? line : line.slice(0, commentStart);
    const comment = commentStart === -1 ? undefined : line.slice(commentStart + 2).trim();

    UNIFORM_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = UNIFORM_REGEX.exec(code)) !== null) {
      const [, type, name, arraySuffix] = match;
      const path = `$.shader.uniforms.${name}`;

      if (arraySuffix !== undefined) {
        diagnostics.push({
          code: 'UNIFORM_ARRAY_UNSUPPORTED',
          severity: 'error',
          message: `Uniform array "${name}${arraySuffix}" is not supported by GE MaterialData.`,
          path,
        });
        continue;
      }

      const previousType = seen.get(name);

      if (previousType !== undefined) {
        diagnostics.push(
          previousType === type
            ? {
                code: 'UNIFORM_DUPLICATE',
                severity: 'warning',
                message: `Duplicate uniform "${name}" with type "${type}" was ignored.`,
                path,
              }
            : {
                code: 'UNIFORM_TYPE_CONFLICT',
                severity: 'error',
                message:
                  `Uniform "${name}" is declared as both "${previousType}" and "${type}"; ` +
                  'the first declaration was kept.',
                path,
              },
        );
        continue;
      }

      seen.set(name, type);

      if (!SUPPORTED_TYPES.has(type)) {
        diagnostics.push({
          code: 'UNIFORM_TYPE_UNSUPPORTED',
          severity: 'error',
          message: `Uniform "${name}" uses unsupported type "${type}".`,
          path,
        });
        continue;
      }

      if (/^iChannel\d+$/.test(name) && !/^iChannel[0-3]$/.test(name)) {
        diagnostics.push({
          code: 'CHANNEL_NAME_INVALID',
          severity: 'error',
          message: `Uniform "${name}" is outside the supported iChannel0 through iChannel3 range.`,
          path,
        });
        continue;
      }

      const uniformType = type as UniformType;

      uniforms.push({
        name,
        type: uniformType,
        ...(comment !== undefined && comment.length > 0 ? { comment } : {}),
      });

      if (uniformType === 'vec2' || uniformType === 'vec3') {
        diagnostics.push({
          code: 'UNIFORM_VECTOR_SIZE_UNSUPPORTED',
          severity: 'error',
          message:
            `Uniform "${name}" uses ${uniformType}, which cannot be represented safely by GE MaterialData; ` +
            'use vec4 and swizzle it in GLSL.',
          path,
        });
      }
    }
  }

  return { uniforms, diagnostics };
}

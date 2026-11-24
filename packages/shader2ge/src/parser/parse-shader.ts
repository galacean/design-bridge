import type { ParsedUniform, ShaderDiagnostic } from '../conversion-types';
import { convertMainImageToFragmentShader } from '../converter/convert-main-image';
import { convertTimeUniformToVarying } from '../converter/convert-time-uniform';
import { FALLBACK_FRAGMENT_SHADER } from '../generator/shader-templates';
import { maskShaderComments } from './mask-shader-comments';
import { parseUniforms } from './parse-uniforms';

interface ParsedShader {
  fragment: string;
  uniforms: ParsedUniform[];
  usesMainImage: boolean;
  diagnostics: ShaderDiagnostic[];
}

/** Parse and normalize a native or mainImage fragment shader. */
export function parseShader(source: string): ParsedShader {
  const diagnostics: ShaderDiagnostic[] = [];
  let fragment = source.trim();

  if (!fragment) {
    diagnostics.push({
      code: 'SHADER_EMPTY',
      severity: 'warning',
      message: 'Empty fragment shader was replaced with the fallback gradient shader.',
      path: '$.shader',
    });
    fragment = FALLBACK_FRAGMENT_SHADER;
  }

  appendUnsupportedVersionDiagnostics(fragment, diagnostics);

  const usesMainImage = /void\s+mainImage\s*\(\s*out\s+vec4/.test(maskShaderComments(fragment));

  if (usesMainImage) {
    fragment = convertMainImageToFragmentShader(fragment);
  }

  const uniformResult = parseUniforms(fragment);
  const uniforms = uniformResult.uniforms;

  diagnostics.push(...uniformResult.diagnostics);
  appendInvalidChannelUsageDiagnostics(source, diagnostics);

  const hasUTime = uniforms.some(u => u.name === 'uTime' && u.type === 'float');

  if (hasUTime) {
    const convertedFragment = convertTimeUniformToVarying(fragment);

    if (convertedFragment !== fragment) {
      fragment = convertedFragment;
      const uTimeIndex = uniforms.findIndex(u => u.name === 'uTime');

      if (uTimeIndex !== -1) {
        uniforms.splice(uTimeIndex, 1);
      }
    }
  }

  validateMainAndColorOutput(maskShaderComments(fragment), diagnostics);

  return { fragment, uniforms, usesMainImage, diagnostics };
}

function appendUnsupportedVersionDiagnostics(fragment: string, diagnostics: ShaderDiagnostic[]): void {
  const fragmentWithoutComments = maskShaderComments(fragment);

  if (!/^[ \t]*#[ \t]*version[ \t]+300[ \t]+es\b/gm.test(fragmentWithoutComments)) {
    return;
  }
  diagnostics.push({
    code: 'SHADER_VERSION_UNSUPPORTED',
    severity: 'error',
    message: 'GLSL ES 3.00 shaders are not supported; use WebGL 1.0 / GLSL ES 1.00 syntax.',
    path: '$.shader',
  });
}

function validateMainAndColorOutput(fragment: string, diagnostics: ShaderDiagnostic[]): void {
  if (!/void\s+main\s*\(/.test(fragment)) {
    diagnostics.push({
      code: 'SHADER_MAIN_MISSING',
      severity: 'error',
      message: 'Fragment shader does not contain a main() function.',
      path: '$.shader',
    });
  }

  if (!fragment.includes('gl_FragColor') && !/out\s+vec4/.test(fragment)) {
    diagnostics.push({
      code: 'SHADER_OUTPUT_MISSING',
      severity: 'error',
      message: 'Fragment shader does not write a fragment color.',
      path: '$.shader',
    });
  }
}

function appendInvalidChannelUsageDiagnostics(source: string, diagnostics: ShaderDiagnostic[]): void {
  const sourceWithoutComments = maskShaderComments(source);
  const channelNames = new Set(
    Array.from(sourceWithoutComments.matchAll(/\biChannel(\d+)\b/g), match => `iChannel${match[1]}`),
  );

  for (const channelName of channelNames) {
    if (/^iChannel[0-3]$/.test(channelName)) {
      continue;
    }
    const path = `$.shader.uniforms.${channelName}`;

    if (diagnostics.some(diagnostic => diagnostic.code === 'CHANNEL_NAME_INVALID' && diagnostic.path === path)) {
      continue;
    }
    diagnostics.push({
      code: 'CHANNEL_NAME_INVALID',
      severity: 'error',
      message: `Uniform "${channelName}" is outside the supported iChannel0 through iChannel3 range.`,
      path,
    });
  }
}

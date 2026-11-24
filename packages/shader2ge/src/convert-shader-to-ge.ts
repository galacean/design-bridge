import type {
  ConvertShaderToGEOptions,
  ParsedUniform,
  ShaderDiagnostic,
  ShaderToGEResult,
  UniformValue,
} from './conversion-types';
import { mapPreviewSizeToResolution, shouldInjectNativeResolution } from './converter/map-resolution-uniform';
import { normalizeConversionOptions } from './converter/normalize-conversion-options';
import { isTextureInput, resolveUniformOverrides } from './converter/resolve-uniform-overrides';
import { assembleGEScene } from './generator/assemble-ge-scene';
import { parseShader } from './parser/parse-shader';
import { validateGEScene } from './validator/validate-ge-scene';

/** Convert a GLSL fragment shader to a playable GE JSONScene. */
export function convertShaderToGE(
  fragmentShader: string,
  options: ConvertShaderToGEOptions = {},
): ShaderToGEResult {
  const parsed = parseShader(fragmentShader);
  const normalized = normalizeConversionOptions(options);
  const resolved = resolveUniformOverrides(options, parsed.uniforms);
  const diagnostics = [...parsed.diagnostics, ...normalized.diagnostics, ...resolved.diagnostics];
  const overrides = resolved.overrides;

  appendMissingSamplerDiagnostics(parsed.uniforms, overrides, diagnostics);
  injectResolutionOverrides(
    parsed.uniforms,
    parsed.usesMainImage,
    normalized.options.previewSize,
    overrides,
    diagnostics,
  );

  const scene = assembleGEScene(
    parsed.fragment,
    parsed.uniforms,
    { ...normalized.options, uniformOverrides: overrides },
    parsed.usesMainImage,
  );

  diagnostics.push(...validateGEScene(scene));

  return { scene, diagnostics, uniforms: parsed.uniforms };
}

function appendMissingSamplerDiagnostics(
  uniforms: ParsedUniform[],
  overrides: Record<string, UniformValue>,
  diagnostics: ShaderDiagnostic[],
): void {
  for (const uniform of uniforms) {
    if (uniform.type !== 'sampler2D' || isTextureInput(overrides[uniform.name])) {
      continue;
    }
    diagnostics.push({
      code: 'TEXTURE_FALLBACK_USED',
      severity: 'warning',
      message:
        `Uniform "${uniform.name}" uses the default 1x1 white texture because no valid texture input was provided.`,
      path: `$.options.uniformOverrides.${uniform.name}`,
    });
  }
}

function injectResolutionOverrides(
  uniforms: ParsedUniform[],
  usesMainImage: boolean,
  previewSize: [number, number],
  overrides: Record<string, UniformValue>,
  diagnostics: ShaderDiagnostic[],
): void {
  if (shouldInjectNativeResolution(uniforms)) {
    appendIgnoredResolutionOverride('uResolution', overrides, diagnostics);
    overrides.uResolution = mapPreviewSizeToResolution(previewSize);
  }

  if (usesMainImage) {
    appendIgnoredResolutionOverride('iResolution', overrides, diagnostics);
  }
}

function appendIgnoredResolutionOverride(
  name: string,
  overrides: Record<string, UniformValue>,
  diagnostics: ShaderDiagnostic[],
): void {
  if (!(name in overrides)) {
    return;
  }
  diagnostics.push({
    code: 'UNIFORM_OVERRIDE_IGNORED',
    severity: 'warning',
    message: `Override for "${name}" was replaced with the normalized previewSize.`,
    path: `$.options.uniformOverrides.${name}`,
  });
}

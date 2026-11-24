import type {
  ConvertShaderToGEOptions,
  ParsedUniform,
  ShaderDiagnostic,
  TextureInput,
  UniformValue,
} from '../conversion-types';
import { setRecordValue } from './set-record-value';

const CHANNEL_NAME_PATTERN = /^iChannel[0-3]$/;
const TEXTURE_WRAP_VALUES = new Set([33071, 33648, 10497]);
const TEXTURE_MAG_FILTER_VALUES = new Set([9728, 9729]);
const TEXTURE_MIN_FILTER_VALUES = new Set([9728, 9729, 9984, 9985, 9986, 9987]);

export interface ResolveUniformOverridesResult {
  overrides: Record<string, UniformValue>;
  diagnostics: ShaderDiagnostic[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasOptionalEnumValue(record: Record<string, unknown>, key: string, values: Set<number>): boolean {
  const value = record[key];

  return value === undefined || (isFiniteNumber(value) && values.has(value));
}

function isSupportedTextureUrl(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) {
    return false;
  }

  const scheme = /^([A-Za-z][A-Za-z\d+.-]*):/.exec(value)?.[1]?.toLowerCase();

  return scheme === undefined || scheme === 'http' || scheme === 'https' || /^data:image\//i.test(value);
}

export function isTextureInput(value: unknown): value is TextureInput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.url === 'string' &&
    isSupportedTextureUrl(record.url) &&
    !('x' in record) &&
    !('r' in record) &&
    hasOptionalEnumValue(record, 'wrapS', TEXTURE_WRAP_VALUES) &&
    hasOptionalEnumValue(record, 'wrapT', TEXTURE_WRAP_VALUES) &&
    hasOptionalEnumValue(record, 'magFilter', TEXTURE_MAG_FILTER_VALUES) &&
    hasOptionalEnumValue(record, 'minFilter', TEXTURE_MIN_FILTER_VALUES) &&
    (record.flipY === undefined || typeof record.flipY === 'boolean')
  );
}

export function isVector4Input(value: unknown): value is { x: number; y: number; z: number; w: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isFiniteNumber(record.x) &&
    isFiniteNumber(record.y) &&
    isFiniteNumber(record.z) &&
    isFiniteNumber(record.w)
  );
}

export function isColorInput(value: unknown): value is { r: number; g: number; b: number; a: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isFiniteNumber(record.r) &&
    isFiniteNumber(record.g) &&
    isFiniteNumber(record.b) &&
    isFiniteNumber(record.a)
  );
}

export function resolveUniformOverrides(
  options: ConvertShaderToGEOptions,
  uniforms: ParsedUniform[],
): ResolveUniformOverridesResult {
  const overrides: Record<string, UniformValue> = {};
  const diagnostics: ShaderDiagnostic[] = [];
  const uniformsByName = new Map(uniforms.map(uniform => [uniform.name, uniform]));

  for (const [name, value] of Object.entries(options.uniformOverrides ?? {})) {
    if (/^iChannel\d+$/.test(name) && !CHANNEL_NAME_PATTERN.test(name)) {
      diagnostics.push({
        code: 'CHANNEL_NAME_INVALID',
        severity: 'error',
        message: `Channel "${name}" is outside the supported iChannel0 through iChannel3 range.`,
        path: `$.options.uniformOverrides.${name}`,
      });
      continue;
    }

    appendOverride(name, value, `$.options.uniformOverrides.${name}`, uniformsByName, overrides, diagnostics);
  }

  for (const [channel, value] of Object.entries(options.channelTextures ?? {})) {
    const path = `$.options.channelTextures.${channel}`;

    if (!CHANNEL_NAME_PATTERN.test(channel)) {
      diagnostics.push({
        code: 'CHANNEL_NAME_INVALID',
        severity: 'error',
        message: `Channel "${channel}" is outside the supported iChannel0 through iChannel3 range.`,
        path,
      });
      continue;
    }

    if (channel in overrides) {
      continue;
    }

    appendOverride(channel, value, path, uniformsByName, overrides, diagnostics);
  }

  return { overrides, diagnostics };
}

function appendOverride(
  name: string,
  value: unknown,
  path: string,
  uniformsByName: Map<string, ParsedUniform>,
  overrides: Record<string, UniformValue>,
  diagnostics: ShaderDiagnostic[],
): void {
  const uniform = uniformsByName.get(name);

  if (uniform === undefined) {
    diagnostics.push({
      code: 'UNIFORM_OVERRIDE_UNKNOWN',
      severity: 'warning',
      message: `Override for undeclared uniform "${name}" was ignored.`,
      path,
    });

    return;
  }

  if (uniform.type === 'sampler2D') {
    if (isTextureInput(value)) {
      setRecordValue(overrides, name, value);
    } else {
      diagnostics.push({
        code: 'TEXTURE_INPUT_INVALID',
        severity: 'warning',
        message: `Texture input for uniform "${name}" is invalid and was ignored.`,
        path,
      });
    }

    return;
  }

  const isValid =
    (uniform.type === 'float' && isFiniteNumber(value)) ||
    (uniform.type === 'int' && isFiniteNumber(value) && Number.isInteger(value)) ||
    (uniform.type === 'vec4' && (isVector4Input(value) || isColorInput(value)));

  if (isValid) {
    setRecordValue(overrides, name, value as UniformValue);
  } else {
    diagnostics.push({
      code: 'UNIFORM_OVERRIDE_INVALID',
      severity: 'warning',
      message: `Override for uniform "${name}" does not match its ${uniform.type} declaration and was ignored.`,
      path,
    });
  }
}

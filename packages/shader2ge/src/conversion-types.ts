import type * as spec from '@galacean/effects-specification';

/** GLSL uniform types recognized by the shader parser. */
export type UniformType = 'float' | 'vec2' | 'vec3' | 'vec4' | 'int' | 'sampler2D';

/** Texture channel names available to mainImage shaders. */
export type ShaderChannel = 'iChannel0' | 'iChannel1' | 'iChannel2' | 'iChannel3';

/** Severity level of a shader conversion diagnostic. */
export type ShaderDiagnosticSeverity = 'warning' | 'error';

/** Stable identifier for a shader conversion diagnostic. */
export type ShaderDiagnosticCode =
  | 'CHANNEL_NAME_INVALID'
  | 'OPTION_DURATION_INVALID'
  | 'OPTION_END_BEHAVIOR_INVALID'
  | 'OPTION_PREVIEW_SIZE_INVALID'
  | 'SCENE_JSON_UNSTABLE'
  | 'SCENE_REFERENCE_INVALID'
  | 'SCENE_VALUE_NON_FINITE'
  | 'SHADER_EMPTY'
  | 'SHADER_MAIN_MISSING'
  | 'SHADER_OUTPUT_MISSING'
  | 'SHADER_VERSION_UNSUPPORTED'
  | 'TEXTURE_FALLBACK_USED'
  | 'TEXTURE_INPUT_INVALID'
  | 'UNIFORM_ARRAY_UNSUPPORTED'
  | 'UNIFORM_DUPLICATE'
  | 'UNIFORM_OVERRIDE_IGNORED'
  | 'UNIFORM_OVERRIDE_INVALID'
  | 'UNIFORM_OVERRIDE_UNKNOWN'
  | 'UNIFORM_TYPE_CONFLICT'
  | 'UNIFORM_TYPE_UNSUPPORTED'
  | 'UNIFORM_VECTOR_SIZE_UNSUPPORTED';

/** A stable diagnostic emitted while parsing, normalizing, or validating a conversion. */
export interface ShaderDiagnostic {
  code: ShaderDiagnosticCode;
  severity: ShaderDiagnosticSeverity;
  message: string;
  path?: string;
}

/** Parsed GLSL uniform declaration. */
export interface ParsedUniform {
  name: string;
  type: UniformType;
  comment?: string;
}

/** Options for converting a fragment shader to GE JSONScene. */
export interface ConvertShaderToGEOptions {
  sceneName?: string; // Defaults to ShaderScene.
  duration?: number; // Seconds; defaults to 5.
  endBehavior?: import('@galacean/effects-specification').EndBehavior; // Defaults to restart.
  previewSize?: [number, number]; // Defaults to [512, 512].
  uniformOverrides?: Record<string, UniformValue>;
  channelTextures?: Partial<Record<ShaderChannel, TextureInput>>;
}

/** Scalar, four-component vector, color, or texture input supplied as a uniform override. */
export type UniformValue =
  | number
  | { x: number; y: number; z: number; w: number }
  | { r: number; g: number; b: number; a: number }
  | TextureInput;

/** Texture source and sampling options for a sampler2D uniform. */
export interface TextureInput {
  url: string; // Supports HTTP(S), data URLs, and relative paths.
  wrapS?: number; // Defaults to REPEAT.
  wrapT?: number; // Defaults to REPEAT.
  magFilter?: number; // Defaults to LINEAR.
  minFilter?: number; // Defaults to LINEAR.
  flipY?: boolean; // Defaults to true.
}

/** Result of converting a fragment shader to GE JSONScene. */
export interface ShaderToGEResult {
  scene: spec.JSONScene;
  diagnostics: ShaderDiagnostic[];
  uniforms: ParsedUniform[];
}

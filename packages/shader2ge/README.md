# @galacean/shader2ge

English | [简体中文](./README-zh_CN.md)

Convert GLSL fragment shaders into Galacean Effects JSONScene.

The converter accepts GE-style `main()` shaders and `mainImage` shaders. It creates a full-screen quad, shader,
material, timeline, and data-path references, and returns structured diagnostics for unsupported uniforms, invalid
options, and scene-reference problems.

## Contents

  - [Install](#install)
  - [Usage](#usage)
  - [Input capabilities](#input-capabilities)
  - [Shader input formats](#shader-input-formats)
  - [Public API](#public-api)
  - [Diagnostics](#diagnostics)
  - [WebGL and uniform limitations](#webgl-and-uniform-limitations)
  - [Internal data flow](#internal-data-flow)
  - [Third-party dependency licenses](#third-party-dependency-licenses)
  - [License](#license)

## Install

```bash
pnpm add @galacean/shader2ge
```

The converter can generate JSONScene without a GE player. Install the matching runtime only when the scene must be
played in a browser:

```bash
pnpm add @galacean/effects
```

Conversion works in Node.js and browsers that provide Web Crypto. Node.js 24 or later is required for package use in
this repository. Browser playback requires WebGL 1.0.

## Usage

### Minimal conversion example

```ts
import { convertShaderToGE } from '@galacean/shader2ge';

const result = convertShaderToGE(`
  precision highp float;
  varying vec2 vUV;
  varying float vTime;

  void main() {
    vec3 color = 0.5 + 0.5 * cos(vTime + vUV.xyx + vec3(0.0, 2.0, 4.0));
    gl_FragColor = vec4(color, 1.0);
  }
`, {
  sceneName: 'CosineGradient',
  duration: 5,
  previewSize: [1280, 720],
});

const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
if (errors.length > 0) {
  throw new Error(errors.map(diagnostic => diagnostic.message).join('\n'));
}

console.info(result.scene);
```

All public conversion goes through `convertShaderToGE`; parser and scene-generator modules are internal.

### Play with GE Player

```ts
import { Player } from '@galacean/effects';
import { convertShaderToGE } from '@galacean/shader2ge';

const container = document.getElementById('player');
if (container === null) {
  throw new Error('Player container was not found.');
}

const { scene, diagnostics } = convertShaderToGE(`
  precision highp float;
  varying vec2 vUV;

  void main() {
    gl_FragColor = vec4(vUV, 0.0, 1.0);
  }
`);
const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
if (errors.length > 0) {
  throw new Error(errors.map(diagnostic => diagnostic.message).join('\n'));
}

const player = new Player({ container });
await player.loadScene(scene);
```

The generated scene still needs a GLSL compiler and a compatible GE runtime. The converter validates known input and
scene-reference constraints but cannot predict device-specific shader or WebGL failures.

## Input capabilities

Supported refers to the listed conversion subset; partial means bridge code, a fallback, or runtime validation is
needed. The generated scene targets a single fragment pass on a fixed full-screen quad.

### Input formats and boundaries

| Capability | Status | Behavior |
| --- | --- | --- |
| GE-native fragment shader | Supported | `void main()` and `gl_FragColor`; fixed `vUV` / `vTime` inputs. |
| `mainImage` shader | Supported | Generates GE bridge code for time, resolution, and used channels. |
| URL `sampler2D` / channels | Partial | Missing or invalid image input falls back to white with a warning. |
| External uniform values | Partial | `float`, `int`, `vec4`, `sampler2D`; unsupported types warn as listed below. |
| Invalid conversion options | Partial | Duration, size, and end behavior use defaults and return warnings. |
| GLSL ES 3.0 | Unsupported | `#version 300 es` reports an error; use WebGL 1.0 syntax. |
| Custom vertex / multipass | Unsupported | No custom geometry, feedback buffers, or multipass scene orchestration. |
| Video / cube / binary texture | Unsupported | Texture inputs accept image URLs only. |
| Complete GLSL validation | Unsupported | No full compilation/linking; a runtime compiler must check the shader. |

Inspect `diagnostics` before using the returned scene: warnings describe fallback or ignored data, while errors can
make the scene unusable. The converter can return a scene even when errors exist. Zero diagnostics does not prove
GLSL compilation, texture access, or device compatibility; representative codes are listed under
[Diagnostics](#diagnostics).

### Output

`convertShaderToGE` returns a `ShaderToGEResult`:

| Field | Content |
| --- | --- |
| `scene` | GE `JSONScene` containing Composition, EffectComponent, Shader, Material, Geometry, and timeline data |
| `uniforms` | Normalized uniform declarations found in the shader |
| `diagnostics` | Structured issues from parsing, option normalization, uniform mapping, and scene validation |

### External uniform values

`options.uniformOverrides` maps supported uniforms into GE `MaterialData`. This does not restrict internal GLSL
calculations that use `vec2` and `vec3`.

| GLSL uniform | Status | GE mapping |
| --- | --- | --- |
| `float` | Supported | `materials[].floats` |
| `int` | Supported | `materials[].ints`; external values must be finite integers |
| `vec4` | Supported | `{ x, y, z, w }` in `vector4s`; `{ r, g, b, a }` in `colors` |
| `sampler2D` | Supported | `images`, `textures`, and material texture reference |
| `vec2` / `vec3` | Declaration only | No material mapping; reports `UNIFORM_VECTOR_SIZE_UNSUPPORTED` |
| Uniform arrays | Unsupported | Reports `UNIFORM_ARRAY_UNSUPPORTED` |
| Matrices and other types | Unsupported | Reports `UNIFORM_TYPE_UNSUPPORTED` |

For an externally supplied two- or three-dimensional value, use `vec4` and read `.xy` or `.xyz` in the shader.

## Shader input formats

### GE-native format

The native format provides `main()` directly. The fixed vertex shader supplies `vUV` and `vTime`; declare the
corresponding `varying` values when the fragment shader uses them.

```glsl
precision highp float;
varying vec2 vUV;
varying float vTime;
uniform vec4 uResolution;

void main() {
  vec2 uv = vUV;
  uv.x *= uResolution.x / uResolution.y;
  gl_FragColor = vec4(uv, abs(sin(vTime)), 1.0);
}
```

Declaring `uniform float uTime;` bridges that value to `vTime`. A native shader receives resolution data only when it
declares `uniform vec4 uResolution;`; the value is derived from `previewSize` as `{ x: width, y: height, z: 1, w: 0 }`.

### `mainImage` format

`mainImage` input receives `iTime`, `iResolution`, and the `iChannel0`–`iChannel3` declarations that it uses. The
converter generates `main()` and computes `fragCoord` from `vUV * iResolution.xy`.

```ts
const { scene, diagnostics } = convertShaderToGE(`
  void mainImage(out vec4 color, in vec2 coord) {
    vec2 uv = coord / iResolution.xy;
    color = vec4(uv, abs(sin(iTime)), 1.0);
  }
`, { previewSize: [512, 512] });
```

Relative texture URLs are resolved by the application that loads the generated scene. When both
`uniformOverrides` and `channelTextures` provide the same channel, `uniformOverrides` takes precedence.

## Public API

### Runtime export

The package root exposes one runtime function:

```ts
function convertShaderToGE(
  fragmentShader: string,
  options?: ConvertShaderToGEOptions,
): ShaderToGEResult;
```

### Options and result

```ts
interface ConvertShaderToGEOptions {
  sceneName?: string;
  duration?: number;
  endBehavior?: import('@galacean/effects-specification').EndBehavior;
  previewSize?: [number, number];
  uniformOverrides?: Record<string, UniformValue>;
  channelTextures?: Partial<Record<ShaderChannel, TextureInput>>;
}

interface ShaderToGEResult {
  scene: import('@galacean/effects-specification').JSONScene;
  diagnostics: ShaderDiagnostic[];
  uniforms: ParsedUniform[];
}
```

Defaults are `ShaderScene`, 5 seconds, `EndBehavior.restart`, `[512, 512]`, empty overrides, and no textures.
Invalid duration, end behavior, or preview size uses a safe default and returns a warning.

### Texture input

```ts
interface TextureInput {
  url: string;
  wrapS?: number;
  wrapT?: number;
  magFilter?: number;
  minFilter?: number;
  flipY?: boolean;
}
```

`url` accepts HTTP(S), `data:image/*`, and relative paths. WebGL wrap and filter values are validated; `flipY`
defaults to `true`. `wrapS` and `wrapT` accept `CLAMP_TO_EDGE`, `MIRRORED_REPEAT`, and `REPEAT`; magnification
filters accept `NEAREST` and `LINEAR`, and minification filters accept WebGL 1.0 mipmap values. A missing or invalid
`sampler2D` input uses a 1×1 white texture and reports `TEXTURE_FALLBACK_USED`.

### Type exports

The root exports `ConvertShaderToGEOptions`, `ShaderToGEResult`, `ParsedUniform`, `ShaderChannel`, `TextureInput`,
`UniformType`, `UniformValue`, `ShaderDiagnostic`, `ShaderDiagnosticCode`, and `ShaderDiagnosticSeverity`.
`JSONScene` and `EndBehavior` come from `@galacean/effects-specification`.

## Diagnostics

Each `ShaderDiagnostic` has a stable `code`, `warning` or `error` severity, a message, and an optional data path:

```ts
interface ShaderDiagnostic {
  code: ShaderDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  path?: string;
}
```

Representative codes include `SHADER_EMPTY`, `SHADER_MAIN_MISSING`, `SHADER_OUTPUT_MISSING`,
`SHADER_VERSION_UNSUPPORTED`, `UNIFORM_ARRAY_UNSUPPORTED`, `UNIFORM_DUPLICATE`, `UNIFORM_TYPE_CONFLICT`,
`UNIFORM_TYPE_UNSUPPORTED`, `UNIFORM_VECTOR_SIZE_UNSUPPORTED`, `UNIFORM_OVERRIDE_IGNORED`,
`UNIFORM_OVERRIDE_INVALID`, `UNIFORM_OVERRIDE_UNKNOWN`, `CHANNEL_NAME_INVALID`, `TEXTURE_FALLBACK_USED`,
`TEXTURE_INPUT_INVALID`, `OPTION_DURATION_INVALID`, `OPTION_END_BEHAVIOR_INVALID`, `OPTION_PREVIEW_SIZE_INVALID`,
`SCENE_JSON_UNSTABLE`, `SCENE_REFERENCE_INVALID`, and `SCENE_VALUE_NON_FINITE`. Warnings describe safe normalization,
fallback, or ignored input. Errors mean that the result may not render as expected; inspect them before playback or
persistence.

## WebGL and uniform limitations

- Output targets WebGL 1.0 and GLSL ES 1.0. `#version 300 es`, fragment `in`/`out`, `texture()`, and other GLSL ES
  3.0 syntax are unsupported; use `varying`, `gl_FragColor`, and `texture2D()`.
- The fixed vertex shader uses the GE Runtime `aPos`, `aUV`, `effects_ObjectToWorld`, `effects_MatrixVP`, and `_Time`
  attributes and renders a full-screen quad.
- Uniform parsing targets `uniform [precision] type name;` declarations. Arrays are unsupported.
- GE material data uses `vector4s` as the general vector serialization path, so external `vec2`/`vec3` values use a
  `vec4` and swizzle in the shader.
- Only URL image inputs are supported for `sampler2D`; video, cube, and binary textures are outside the package scope.
- The converter does not perform complete GLSL compilation, linking, or device-capability checks.

## Internal data flow

```text
GLSL source
  -> parser: detect entry, parse uniforms, normalize mainImage and time input
  -> converter: normalize options and map uniform values
  -> generator: build Quad, Shader, Material, EffectComponent, and timeline
  -> validator: verify DataPath references, finite values, and JSON round trip
  -> ShaderToGEResult
```

`src/index.ts` exposes the stable public entry. Parser, converter, generator, and validator modules are internal.

The internal stages are intentionally kept out of the package API so callers depend on the stable conversion result
and diagnostic contract.

## Third-party dependency licenses

| Dependency | Declared range | License |
| --- | --- | --- |
| `@galacean/effects-specification` | `^2.8.0` | MIT |
| `uuid` | `^13.0.0` | MIT |

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

# Shader to GE guide

`@galacean/shader2ge` wraps a GLSL fragment shader into a playable GE scene: a fixed full-screen quad, a single pass,
and a timeline. This chapter covers both input formats, uniforms and textures, handling diagnostics, and playback.

## Two input formats

### GE native: `main()`

The fixed vertex shader outputs `vUV` (UV in 0..1) and `vTime` (time). Declare matching `varying`s to use them:

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

`uResolution` is assigned only when declared; its value comes from `previewSize` as `{ x: width, y: height, z: 1, w: 0 }`.
Declared `uniform float uTime` is rewritten to the `vTime` varying. Set the preview size through `previewSize`;
resolution overrides are replaced and reported as `UNIFORM_OVERRIDE_IGNORED`.

### `mainImage`: ShaderToy style

A `mainImage` input automatically gets `iTime`, `iResolution`, and any `iChannel0`–`iChannel3` it uses. The converter
generates `main()`:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 tex = texture2D(iChannel0, uv);
  fragColor = vec4(tex.rgb * abs(sin(iTime)), tex.a);
}
```

Both formats must use **WebGL 1.0 / GLSL ES 1.0** syntax: `varying`, `gl_FragColor`, `texture2D()`.
`#version 300 es`, ES 3.0 fragment input/output declarations, and `texture()` are not supported.
The `in`/`out` function parameters in `mainImage` are valid ES 1.0 syntax.

## Conversion options

```ts
import { convertShaderToGE } from '@galacean/shader2ge';

const result = convertShaderToGE(fragmentSource, {
  sceneName: 'Aurora',
  duration: 8,
  previewSize: [1080, 1080],
  uniformOverrides: { uSpeed: 1.5, uTint: { r: 0.2, g: 0.6, b: 1, a: 1 } },
  channelTextures: { iChannel0: { url: 'https://cdn.example.com/noise.png' } },
});
```

| Option | Description | Default |
| --- | --- | --- |
| `sceneName` | Scene name | `ShaderScene` |
| `duration` | Duration in seconds | 5 |
| `endBehavior` | End behavior | restart |
| `previewSize` | Preview size `[width, height]` | `[512, 512]` |
| `uniformOverrides` | External uniform values | none |
| `channelTextures` | Image textures for `iChannel*` | none |

The result contains `scene` (GE JSONScene), `uniforms` (recognized declarations, useful for building a parameter
panel), and `diagnostics`.

## Uniform mapping

| GLSL type | External value | Notes |
| --- | --- | --- |
| `float` | `number` | Written to `materials[].floats` |
| `int` | finite integer | Written to `ints` |
| `vec4` | `{x,y,z,w}` or `{r,g,b,a}` | The first writes a vector, the second a color |
| `sampler2D` | `{ url, ... }` | Generates image, texture, and material references |
| `vec2` / `vec3` | — | Declaration only; reports `UNIFORM_VECTOR_SIZE_UNSUPPORTED` |

To pass a 2D or 3D vector, use `vec4` and read `.xy` / `.xyz` in the shader. If a channel is set by both
`uniformOverrides` and `channelTextures`, `uniformOverrides` wins. Textures accept image URLs only; missing or
invalid ones fall back to white with a warning.

## Handling diagnostics

A `ShaderDiagnostic` has a stable `code`, a `severity` (`warning` or `error`), a message, and an optional path.
The converter tries to return a scene rather than throw, so **check for errors before playback**:

```ts
const errors = result.diagnostics.filter(item => item.severity === 'error');

if (errors.length > 0) {
  throw new Error(errors.map(item => `${item.code}: ${item.message}`).join('\n'));
}
```

Common codes: `SHADER_MAIN_MISSING`, `SHADER_OUTPUT_MISSING` (missing entry), `SHADER_VERSION_UNSUPPORTED` (ES 3.0),
`UNIFORM_OVERRIDE_UNKNOWN` (override name matches no declaration), `TEXTURE_FALLBACK_USED` (texture fallback), and
`OPTION_*_INVALID` (an option was replaced by its default).

## Playback

Conversion itself needs no player. Use the GE Player to play the result:

```ts
import { Player } from '@galacean/effects';

const player = new Player({ container });

await player.loadScene(result.scene);
// When the page unloads or the scene is replaced: player.dispose();
```

The converter checks only the entry point, uniforms, and JSONScene references; it does not fully compile GLSL.
Syntax errors and device-specific WebGL limits surface only at runtime, so test on the target devices.

## Limits

- Single-pass fragment shader on fixed full-screen geometry; no custom vertex shader, feedback buffer, or multipass.
- No video, cube, or binary textures.
- No uniform arrays or matrices.

To tweak parameters with a live preview in the browser, open the workbench `/shader2ge` page; see
[Try it in the local workbench](../playground/).

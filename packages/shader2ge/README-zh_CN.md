# @galacean/shader2ge

[English](./README.md) | 简体中文

将 GLSL fragment shader 转换为可由 Galacean Effects 播放的 JSONScene。

本包支持 GE 原生 fragment shader 和 `mainImage` 入口格式，并负责生成全屏 Quad、
Shader、Material、时间线及其 DataPath 引用。转换结果同时包含结构化 diagnostics，便于调用方
在播放前识别不受支持的 uniform、无效选项和场景结构问题。

## 目录

- [安装](#安装)
- [使用](#使用)
- [输入能力](#输入能力)
- [Shader 输入格式](#shader-输入格式)
- [公共 API](#公共-api)
- [Diagnostics](#diagnostics)
- [WebGL 与 uniform 限制](#webgl-与-uniform-限制)
- [内部数据链路](#内部数据链路)
- [第三方依赖许可](#第三方依赖许可)
- [许可证](#许可证)

## 安装

```bash
pnpm add @galacean/shader2ge
```

转换得到的 `JSONScene` 不依赖 GE Player 即可生成。如果需要在浏览器中播放，再安装
`@galacean/effects`：

```bash
pnpm add @galacean/effects
```

本包可在 Node.js 和浏览器中执行转换，运行环境需要提供 Web Crypto。
在本仓库中开发本包需要 Node.js 24 或更高版本和 pnpm 10 或更高版本。
浏览器播放需要支持 WebGL 1.0。

## 使用

### 最小转换示例

```ts
import { convertShaderToGE } from '@galacean/shader2ge';

const fragmentShader = `
precision highp float;
varying vec2 vUV;
varying float vTime;

void main() {
  vec3 color = 0.5 + 0.5 * cos(vTime + vUV.xyx + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

const result = convertShaderToGE(fragmentShader, {
  sceneName: 'CosineGradient',
  duration: 5,
  previewSize: [1280, 720],
});

const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');

if (errors.length > 0) {
  console.error(errors);
} else {
  console.info(result.scene);
}
```

所有功能都通过包根入口的 `convertShaderToGE` 使用；解析和场景生成阶段不是公共 API。

### 配合 GE Player 播放

```ts
import { Player } from '@galacean/effects';
import { convertShaderToGE } from '@galacean/shader2ge';

const fragmentShader = `
precision highp float;
varying vec2 vUV;

void main() {
  gl_FragColor = vec4(vUV, 0.0, 1.0);
}
`;

const container = document.getElementById('player');

if (container === null) {
  throw new Error('Player container was not found.');
}

const { scene, diagnostics } = convertShaderToGE(fragmentShader);
const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');

if (errors.length > 0) {
  throw new Error(errors.map(diagnostic => diagnostic.message).join('\n'));
}

const player = new Player({ container });

await player.loadScene(scene);
```

转换器会检查已知输入约束和 JSONScene 引用完整性，但不会替代 GLSL 编译器。
实际播放仍可能报告 shader 语法错误或设备相关的 WebGL 限制。

## 输入能力

支持表示表中列出的转换子集；部分支持表示需要桥接代码、fallback 或运行时校验。
生成的场景使用固定全屏 Quad 上的单个 fragment pass。

### 输入格式与边界

| 能力 | 状态 | 行为 |
| --- | --- | --- |
| GE 原生 fragment shader | 支持 | `void main()` 和 `gl_FragColor`；固定 vertex shader 提供 `vUV` / `vTime`。 |
| `mainImage` shader | 支持 | 自动生成时间、分辨率及使用通道的 GE 桥接代码。 |
| URL `sampler2D` / 通道 | 部分支持 | 提供图片纹理；缺失或无效输入使用白色 fallback 并告警。 |
| Uniform 外部赋值 | 部分支持 | `float`、`int`、`vec4`、`sampler2D`；其他类型按下表告警。 |
| 无效转换选项 | 部分支持 | duration、size 和 end behavior 使用默认值并返回 warning。 |
| GLSL ES 3.0 | 不支持 | `#version 300 es` 报告 error；应使用 WebGL 1.0 语法。 |
| 自定义 vertex / multipass | 不支持 | 不提供自定义几何、反馈 buffer 或多 pass 场景编排。 |
| 视频 / cube / 二进制纹理 | 不支持 | 纹理输入仅接受图片 URL。 |
| 完整 GLSL 校验 | 不支持 | 不执行完整编译 / 链接；生成的 shader 仍需运行时编译器检查。 |

使用返回场景前请检查 `diagnostics`：warning 表示 fallback 或忽略数据，error 可能导致场景无法使用。
即使存在 error，转换器也可能返回场景。diagnostics 为空不表示 GLSL 编译、纹理访问或设备兼容性已经通过；
代表性 code 见 [Diagnostics](#diagnostics)。

### 输出

`convertShaderToGE` 返回 `ShaderToGEResult`：

| 字段 | 内容 |
| --- | --- |
| `scene` | 包含 Composition、EffectComponent、Shader、Material、Geometry 和时间线的 GE `JSONScene` |
| `uniforms` | 标准化后识别到的 uniform 声明 |
| `diagnostics` | 输入解析、选项归一化、uniform 映射和场景校验产生的结构化诊断 |

### Uniform 外部赋值

下表描述 `options.uniformOverrides` 到 GE `MaterialData` 的映射能力。它不限制 GLSL 局部变量、
`varying`、函数参数或计算过程使用 `vec2` 和 `vec3`。

| GLSL uniform | 状态 | GE 映射 |
| --- | --- | --- |
| `float` | 支持 | `materials[].floats` |
| `int` | 支持 | `materials[].ints`，外部值必须是有限整数 |
| `vec4` | 支持 | `{ x, y, z, w }` 写入 `vector4s`；`{ r, g, b, a }` 写入 `colors` |
| `sampler2D` | 支持 | 生成 `images`、`textures` 和 Material 纹理引用 |
| `vec2` / `vec3` | 仅识别声明 | 不写入 Material；返回 `UNIFORM_VECTOR_SIZE_UNSUPPORTED` |
| uniform 数组 | 不支持 | 返回 `UNIFORM_ARRAY_UNSUPPORTED` |
| 矩阵及其他类型 | 不支持 | 返回 `UNIFORM_TYPE_UNSUPPORTED` |

需要从外部传入二或三维向量时，使用 `vec4` 并在 shader 中通过 `.xy` 或 `.xyz` 读取：

```glsl
uniform vec4 uDirectionAndSpeed;

void main() {
  vec2 direction = uDirectionAndSpeed.xy;
  float speed = uDirectionAndSpeed.z;
  gl_FragColor = vec4(direction * speed, 0.0, 1.0);
}
```

## Shader 输入格式

### GE 原生格式

原生格式直接提供 `main()`。固定 vertex shader 会输出 `vUV` 和 `vTime`。
fragment shader 使用这些值时需要声明对应的 `varying`。

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

声明 `uniform float uTime;` 时，转换器会将其桥接到 `vTime`。建议新 shader 直接声明并使用
`varying float vTime;`。

原生 shader 只有在声明 `uniform vec4 uResolution;` 时才会获得分辨率值。该值由 `previewSize`
生成，格式为 `{ x: width, y: height, z: 1, w: 0 }`。

### `mainImage` 格式

`mainImage` 输入会自动获得 `iTime`、`iResolution` 以及实际使用到的 `iChannel0` 至 `iChannel3` 声明。
转换器会生成 `main()`，并以 `vUV * iResolution.xy` 计算 `fragCoord`。

```ts
import { convertShaderToGE } from '@galacean/shader2ge';

const fragmentShader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 textureColor = texture2D(iChannel0, uv);
  fragColor = vec4(textureColor.rgb * abs(sin(iTime)), textureColor.a);
}
`;

const result = convertShaderToGE(fragmentShader, {
  previewSize: [512, 512],
  channelTextures: {
    iChannel0: { url: '/textures/noise.png' },
  },
});

console.info(result.scene);
console.info(result.diagnostics);
```

相对纹理 URL 由加载场景的应用负责解析。`uniformOverrides` 和 `channelTextures`
同时设置同一通道时，`uniformOverrides` 优先。

## 公共 API

### 运行时导出

| 导出 | 用途 |
| --- | --- |
| `convertShaderToGE` | 将 GLSL fragment shader 转换为 GE JSONScene，并返回 uniforms 和 diagnostics |

```ts
function convertShaderToGE(
  fragmentShader: string,
  options?: ConvertShaderToGEOptions,
): ShaderToGEResult;
```

### 选项与结果

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

选项默认值：

| 选项 | 默认值 | 约束 |
| --- | --- | --- |
| `sceneName` | `'ShaderScene'` | 用于生成场景和资产名称 |
| `duration` | `5` | 单位为秒，必须是大于 0 的有限数 |
| `endBehavior` | `EndBehavior.restart` | 类型来自 `@galacean/effects-specification` |
| `previewSize` | `[512, 512]` | 两项都必须是大于 0 的有限数 |
| `uniformOverrides` | `{}` | key 必须对应已识别的 uniform，值必须与 GLSL 类型匹配 |
| `channelTextures` | `{}` | 只接受 `iChannel0` 至 `iChannel3` |

传入无效的 `duration`、`endBehavior` 或 `previewSize` 时，转换器使用安全默认值并返回 warning。
原生 shader 声明的 `uResolution` 和 `mainImage` 使用的 `iResolution` 均由标准化后的
`previewSize` 决定；同名 override 会被忽略并返回 `UNIFORM_OVERRIDE_IGNORED`。

### 纹理输入

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

- `url` 接受 HTTP(S)、`data:image/*` 和相对路径，不接受空字符串或其他 URL scheme。
- `wrapS` 和 `wrapT` 接受 `CLAMP_TO_EDGE`、`MIRRORED_REPEAT` 或 `REPEAT`，默认 `REPEAT`。
- `magFilter` 接受 `NEAREST` 或 `LINEAR`，默认 `LINEAR`。
- `minFilter` 接受 WebGL 1.0 的 `NEAREST`、`LINEAR` 和 mipmap filter 值，默认 `LINEAR`。
- `flipY` 默认为 `true`。
- 没有有效纹理输入的 `sampler2D` 会使用 1×1 白色纹理，并返回 `TEXTURE_FALLBACK_USED`。

### 类型导出

以下类型均从 `@galacean/shader2ge` 包根入口导出：

- 转换：`ConvertShaderToGEOptions`、`ShaderToGEResult`。
- Uniform：`ParsedUniform`、`UniformType`、`UniformValue`。
- 纹理通道：`ShaderChannel`、`TextureInput`。
- 诊断：`ShaderDiagnostic`、`ShaderDiagnosticCode`、`ShaderDiagnosticSeverity`。

`EndBehavior` 和 `JSONScene` 由 `@galacean/effects-specification` 定义，不是本包的运行时导出。

## Diagnostics

`ShaderDiagnostic` 包含稳定的机器可读 `code`、`warning` 或 `error` 严重级别、人类可读消息，以及
可选的 `path`：

```ts
interface ShaderDiagnostic {
  code: ShaderDiagnosticCode;
  severity: 'warning' | 'error';
  message: string;
  path?: string;
}
```

| 类别 | Diagnostic code |
| --- | --- |
| Shader 入口 | `SHADER_EMPTY`、`SHADER_MAIN_MISSING`、`SHADER_OUTPUT_MISSING`、`SHADER_VERSION_UNSUPPORTED` |
| Uniform 声明 | `UNIFORM_ARRAY_UNSUPPORTED`、`UNIFORM_DUPLICATE`、`UNIFORM_TYPE_CONFLICT` |
| Uniform 类型 | `UNIFORM_TYPE_UNSUPPORTED`、`UNIFORM_VECTOR_SIZE_UNSUPPORTED` |
| 外部赋值 | `UNIFORM_OVERRIDE_IGNORED`、`UNIFORM_OVERRIDE_INVALID`、`UNIFORM_OVERRIDE_UNKNOWN` |
| 纹理通道 | `CHANNEL_NAME_INVALID`、`TEXTURE_FALLBACK_USED`、`TEXTURE_INPUT_INVALID` |
| 转换选项 | `OPTION_DURATION_INVALID`、`OPTION_END_BEHAVIOR_INVALID`、`OPTION_PREVIEW_SIZE_INVALID` |
| GE 场景校验 | `SCENE_JSON_UNSTABLE`、`SCENE_REFERENCE_INVALID`、`SCENE_VALUE_NON_FINITE` |

`warning` 表示输入已被安全降级、替换或忽略；`error` 表示结果可能无法按预期渲染。
转换器会尽量返回场景和完整 diagnostics，而不是因这些问题直接抛出异常。
调用方应在播放或持久化之前检查 error。

## WebGL 与 uniform 限制

- 输出面向 WebGL 1.0 和 GLSL ES 1.0；`#version 300 es` 会产生 `SHADER_VERSION_UNSUPPORTED` error。
  fragment `in`/`out`、`texture()` 等 GLSL ES 3.0 写法也不受支持；请使用 `varying`、`gl_FragColor`
  和 `texture2D()`。
- 固定 vertex shader 使用 GE Runtime 的 `aPos`、`aUV`、`effects_ObjectToWorld`、`effects_MatrixVP`
  和 `_Time` 约定，并渲染全屏 Quad。
- uniform 解析面向 `uniform [precision] type name;` 形式。数组不受支持，建议每个 uniform
  独立声明。
- GE `MaterialData` 只提供 `vector4s` 作为通用向量序列化入口，因此外部 `vec2` / `vec3` 使用
  `vec4` + swizzle 表达。shader 内部的 `vec2` / `vec3` 计算不受影响。
- `sampler2D` 目前只接受 URL 型图片输入；视频、立方体纹理和二进制纹理不在支持范围内。
- 转换器执行入口、uniform 和 JSONScene 结构检查，不执行完整 GLSL 语法、链接或设备能力
  校验。

## 内部数据链路

```text
GLSL source
  -> parser: detect entry, parse uniforms, normalize mainImage and time input
  -> converter: normalize options and map uniform values
  -> generator: build Quad, Shader, Material, EffectComponent and timeline
  -> validator: verify DataPath references, finite values and JSON round trip
  -> ShaderToGEResult
```

`src/index.ts` 只暴露稳定公共入口。`parser`、`converter`、`generator` 和 `validator` 是包内实现，
不会作为独立 API 导出。

## 第三方依赖许可

| 依赖 | 当前声明范围 | 许可证 |
| --- | --- | --- |
| `@galacean/effects-specification` | `^2.8.0` | MIT |
| `uuid` | `^13.0.0` | MIT |

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

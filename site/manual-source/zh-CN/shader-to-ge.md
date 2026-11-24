# Shader 到 GE 指南

`@galacean/shader2ge` 把 GLSL 片元着色器封装成可播放的 GE 场景：固定全屏 Quad、单遍渲染、带时间轴。
本章覆盖两种输入格式、uniform 与纹理、诊断处理和播放。

## 两种输入格式

### GE 原生：`main()`

固定的顶点着色器会输出 `vUV`（0..1 的 UV）和 `vTime`（时间）。要使用它们，需声明对应的 `varying`：

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

`uResolution` 仅在声明时才会赋值，值来自 `previewSize`，形如 `{ x: 宽, y: 高, z: 1, w: 0 }`。
声明的 `uniform float uTime` 会改写为 `vTime` varying。通过 `previewSize` 设置尺寸；
分辨率的外部赋值会被替换，并报告 `UNIFORM_OVERRIDE_IGNORED`。

### `mainImage`：ShaderToy 风格

`mainImage` 输入自动获得 `iTime`、`iResolution` 和实际用到的 `iChannel0`–`iChannel3`，转换器会生成 `main()`：

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 tex = texture2D(iChannel0, uv);
  fragColor = vec4(tex.rgb * abs(sin(iTime)), tex.a);
}
```

两种格式都必须使用 **WebGL 1.0 / GLSL ES 1.0** 写法：`varying`、`gl_FragColor`、`texture2D()`；
`#version 300 es`、ES 3.0 片元输入/输出声明和 `texture()` 不被支持；
`mainImage` 的 `in`/`out` 函数参数属于合法的 ES 1.0 语法。

## 转换选项

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

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `sceneName` | 场景名称 | `ShaderScene` |
| `duration` | 时长（秒） | 5 |
| `endBehavior` | 结束行为 | restart |
| `previewSize` | 预览尺寸 `[宽, 高]` | `[512, 512]` |
| `uniformOverrides` | 外部赋值 | 无 |
| `channelTextures` | `iChannel*` 的图片纹理 | 无 |

结果包含 `scene`（GE JSONScene）、`uniforms`（识别到的声明，可用来生成参数面板）和 `diagnostics`。

## Uniform 映射

| GLSL 类型 | 外部值 | 说明 |
| --- | --- | --- |
| `float` | `number` | 写入 `materials[].floats` |
| `int` | 有限整数 | 写入 `ints` |
| `vec4` | `{x,y,z,w}` 或 `{r,g,b,a}` | 前者写入向量，后者写入颜色 |
| `sampler2D` | `{ url, ... }` | 生成图片、纹理与材质引用 |
| `vec2` / `vec3` | — | 只识别声明，会报 `UNIFORM_VECTOR_SIZE_UNSUPPORTED` |

需要传入二、三维向量时，使用 `vec4` 并在着色器里用 `.xy` / `.xyz` 读取。
同一通道同时设置了 `uniformOverrides` 和 `channelTextures` 时，以 `uniformOverrides` 为准。
纹理只接受图片 URL；缺失或无效时回退为白色并报警告。

## 处理诊断

`ShaderDiagnostic` 含稳定的 `code`、`severity`（`warning` 或 `error`）、消息和可选路径。
转换器会尽量返回场景而不是抛出异常，因此**播放前必须检查 error**：

```ts
const errors = result.diagnostics.filter(item => item.severity === 'error');

if (errors.length > 0) {
  throw new Error(errors.map(item => `${item.code}: ${item.message}`).join('\n'));
}
```

常见 code：`SHADER_MAIN_MISSING`、`SHADER_OUTPUT_MISSING`（入口缺失）、`SHADER_VERSION_UNSUPPORTED`（用了 ES 3.0）、
`UNIFORM_OVERRIDE_UNKNOWN`（赋值名对不上声明）、`TEXTURE_FALLBACK_USED`（纹理回退）、`OPTION_*_INVALID`（选项被默认值替换）。

## 播放

转换本身不需要播放器。播放使用 GE Player：

```ts
import { Player } from '@galacean/effects';

const player = new Player({ container });

await player.loadScene(result.scene);
// 页面卸载或替换场景时：player.dispose();
```

转换器只检查入口、uniform 和 JSONScene 引用，不做完整的 GLSL 编译。语法错误和设备相关的 WebGL 限制只会在
真实运行时暴露，所以要在目标设备上试播。

## 限制

- 单遍片元着色器，固定全屏几何；不支持自定义顶点着色器、反馈缓冲或多遍渲染。
- 不支持视频、立方体或二进制纹理。
- uniform 数组、矩阵不支持。

想在浏览器里调参并实时预览，打开工作台的 `/shader2ge` 页面，见[在本地工作台体验](../playground/)。

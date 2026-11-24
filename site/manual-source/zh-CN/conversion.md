# 转换链路

Design Bridge 包含八个独立包，覆盖动画模型、设计文件与 Shader 接入。按输入和目标选择链路，
不必把所有素材都先转成 Animation IR。

## 能力总览

| 包 | 转换方向 | 主要用途 |
| --- | --- | --- |
| `@galacean/animation-ir` | 来源无关的二维动画模型 | 类型、关键帧与模型校验，是 IR 的唯一真源 |
| `@galacean/lottie2ir` | Lottie JSON / ZIP → IR | 接入支持的 Lottie 图层与动画 |
| `@galacean/svg2ir` | SVG → IR / GE / 静态分层 | 矢量接入、场景输出与图文分层 |
| `@galacean/ge-ir` | GE ↔ IR | 解析与生成 Galacean Effects JSONScene |
| `@galacean/dsl-ir` | DSL ↔ IR | 可编辑表达、校验与保真重组 |
| `@galacean/html2figma` | HTML / CSS → Figma | 生成 Figma Scene、剪贴板和 `.fig` 文件 |
| `@galacean/figma2ge` | Figma `.fig` → GE | 解码设计文件并生成 GE 场景；开发中 |
| `@galacean/shader2ge` | GLSL fragment shader → GE | 封装全屏材质、纹理与时间轴 |

箭头表示已提供的转换方向，不承诺所有特性无损。诊断、保真数据和目标运行环境共同决定实际结果。

## 输入到 IR

Lottie 使用 [convertLottieToIR](../../api/lottie2ir/current/convertLottieToIR/)，SVG 使用 [convertSVGToIR](../../api/svg2ir/current/convertSVGToIR/)，GE 使用 [convertGEToIR](../../api/ge-ir/current/convertGEToIR/)。各自结果中的诊断描述被归一化、丢弃或不支持的语义。

## GE、IR 与 DSL 的双向编辑

`GE ↔ IR ↔ DSL` 的每一段都有独立 API：

- GE → IR：[convertGEToIR](../../api/ge-ir/current/convertGEToIR/)。
- IR → GE：[convertIRToGE](../../api/ge-ir/current/convertIRToGE/)。
- IR → DSL：[convertIRToDSL](../../api/dsl-ir/current/convertIRToDSL/)。
- DSL → IR：[convertDSLToIR](../../api/dsl-ir/current/convertDSLToIR/)。

GE 与 DSL 转换器互不依赖，由应用通过 IR 显式组合。编辑时，DSL 与 `IRToDSLPreservedData`
成对保存；GE 专有语义由 `GEToIRPreservedData` 管理。双向转换不等同于任意编辑后都完全还原。

在新合成中放置既有粒子系统时，`convertDSLToIR` 接收 `particleSources` 并返回 `sourceInstances`；
将对应的原始 GE 导入结果与 ID 映射通过 `sources` 交给 `convertIRToGE`。
放置要求和完整示例见 [DSL 编辑指南](../dsl-editing/)。

```ts
import { convertIRToGE } from '@galacean/ge-ir';

const result = convertIRToGE(scene);
console.info(result.scene, result.diagnostics);
```

GE 的输出是 JSONScene，可交给兼容的 Galacean Effects 播放器。完整编辑流程见[保真编辑](../fidelity-editing/)。

## HTML / CSS 到 Figma

从网页恢复设计数据时，使用 `@galacean/html2figma`，无需经过 Animation IR。
它提取渲染后的布局、文本、图像和支持的样式，输出 Figma Scene、剪贴板内容或 `.fig` 文件。

```ts
import { createFigmaFile, extractScene } from '@galacean/html2figma';

const sceneData = await extractScene('/absolute/path/to/page.html', false, {
  viewport: { width: 390, height: 844 },
  scriptPolicy: 'disabled',
  networkPolicy: 'offline',
});
const result = await createFigmaFile(
  [{ name: 'Imported page', sceneData }],
  { documentName: 'Imported page' },
);
```

检查 `result.validation` 后再使用 `result.bytes`。根入口面向 Node.js，依赖 Playwright Chromium；
浏览器从 `@galacean/html2figma/browser` 提取，通过 `/browser/file` 或 `/browser/clipboard` 生成目标数据。
HTML 字符串、Document 和带资源的虚拟项目／ZIP 具有不同入口，详见
[html2figma API](../../api/?package=html2figma)。

`.fig` 导出默认使用快照布局。浏览器导出支持编码字形路径，并默认要求可见文字的字形完整；
应提供字体字节或 Local Font Access 权限。两端默认值、字体配置和剪贴板流程见[设计文件与网页接入](../design-to-ge/)。

这是页面快照，不会把 JavaScript 交互、CSS 动画时间轴或应用逻辑变成 Figma 行为。
文本可编辑，但字体、资源与 CSS 支持范围会影响结果。输入脚本、网络与文件访问权限由调用方控制；
禁用脚本或离线网络并不等于对本地文件的完整隔离。

## Figma 设计文件到 GE

将 `.fig` 接入动画运行时，使用独立的 `@galacean/figma2ge`：

```ts
import { convertFigmaToEffects, decodeFigFile } from '@galacean/figma2ge';

const { message, images } = decodeFigFile(figBytes);
const result = convertFigmaToEffects(message, {}, images);
```

`figBytes` 是调用方提供的 `.fig` 文件字节。检查 `result.issues`，再把 `result.scene` 交给兼容播放器。
该包仍在开发中，部分布局、效果、文本和组件会近似或省略，不包含 Figma URL / API 拉取。
它使用包内的 Figma IR，不是 Animation IR。

`HTML / CSS → Figma → GE` 需要应用显式串联两个包；不是一键、无损的网站到运行时转换。
详见 [figma2ge README](https://github.com/galacean/design-bridge/blob/main/packages/figma2ge/README-zh_CN.md)。

## GLSL Shader 到 GE

已有程序化视觉效果时，使用 `@galacean/shader2ge` 直接生成 GE JSONScene，无需先转 IR。
它接受 GE 风格的 `main()` 和 `mainImage` 片元着色器，生成全屏 Quad、Shader、材质与时间轴。

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
`, { duration: 5, previewSize: [1280, 720] });
```

使用 `result.scene` 前检查 `result.diagnostics`。转换不需要播放器；实际播放需要兼容的 GE Runtime
与 WebGL 1.0。支持的图片纹理与部分 uniform 可配置，未支持的值可能产生警告或回退。

该转换面向固定全屏几何上的单遍 fragment shader，不支持 GLSL ES 3.0、自定义顶点着色器、
反馈缓冲或多遍渲染编排，也不替代 GPU 编译和运行时校验。
详见 [shader2ge API](../../api/?package=shader2ge)。

## 组合与验证

先选择输入和目标，再按需安装对应包。保留转换诊断与配对 sidecar，检查目标平台的字体、资源与
运行环境；结构校验通过不代表像素级一致。完整运行边界见[运行环境与限制](../runtime-and-limits/)。

# @galacean/lottie2ir

[English](./README.md) | 简体中文

Lottie 到 Animation IR 转换器。

## 目录

- [安装](#安装)
- [使用](#使用)
- [输入能力](#输入能力)
- [API](#api)
- [源码结构](#源码结构)
- [许可证](#许可证)

## 安装

需要 Node.js 24 或更高版本。

```bash
pnpm add @galacean/lottie2ir
```

## 使用

### 转换 JSON

```ts
import { convertLottieToIR } from '@galacean/lottie2ir';

const result = convertLottieToIR(lottieJSON, {
  resourceBaseUrl: 'https://cdn.example.com/animations/data.json',
});

console.info(result.scene.format); // animation-ir
```

`convertLottieToIR` 接受 Lottie JSON 对象或序列化字符串。相对图片和字体路径通过绝对的
`resourceBaseUrl` 解析。

### 提取 ZIP 输入

```ts
import { convertLottieToIR, extractLottieFromZip } from '@galacean/lottie2ir';

const extracted = await extractLottieFromZip(zipArrayBuffer);
const result = convertLottieToIR(extracted.json, { zipResources: extracted });
```

## 输入能力

下表描述 Lottie 导入 Animation IR 的能力。支持表示可转换表中列出的子集；部分支持表示某些值会近似或丢弃。
通过 `@galacean/ge-ir` 导出 GE 时还需遵循目标格式的限制。

| 能力 | 状态 | 行为 |
| --- | --- | --- |
| JSON 对象 / 字符串 | 支持 | 需要有效帧率、画布尺寸及入点 / 出点。 |
| ZIP 输入 | 支持 | 提取 JSON 和支持的图片 / 字体文件，将 ZIP 资源转换为 Data URL。 |
| 图层与层级 | 支持 | 预合成、纯色、图片、null、形状、文字层，以及父层引用。 |
| 预合成时间 | 部分支持 | 映射起始时间和 stretch；无效 stretch 使用 `1` 并告警。 |
| 变换关键帧 | 部分支持 | 位置、旋转、缩放和透明度；动画 anchor 使用首个值。 |
| 分离位置通道 | 部分支持 | 分轴时间不兼容时按合并后的关键帧时间采样并告警。 |
| 形状几何与 paint | 部分支持 | 路径、矩形、椭圆、星形、多边形、填充和描边。 |
| 动画渐变 | 部分支持 | 只保留首个关键帧，并返回 warning。 |
| 形状修饰器 | 不支持 | trim、repeater、merge 等不支持的运算被丢弃并告警。 |
| 原生 mask | 部分支持 | 有序闭合静态路径栈、完全不透明、add / subtract / intersect 和反转。 |
| Track matte | 部分支持 | alpha / luminance 及反转可进入 IR；GE 导出不支持 luminance matte。 |
| 文字 | 部分支持 | 仅首个 Text Document；静态填充点文字的内嵌字形转为矢量形状，字体文字仍可能使用估算边界和 fallback 字体。 |
| 资源加载 | 部分支持 | 解析 URL 或 ZIP 数据；转换时不下载外部图片和字体。 |
| 表达式、效果、3D | 不支持 | 不提供表达式执行器、通用效果管道或 3D 场景转换。 |

请检查 `result.diagnostics`，代表性 code 包括 `LOTTIE_UNSUPPORTED_LAYER_TYPE`、
`LOTTIE_UNSUPPORTED_SHAPE_FEATURE`、`LOTTIE_UNSUPPORTED_MASK`、`LOTTIE_ANIMATED_ANCHOR_FALLBACK`
和 `LOTTIE_ANIMATED_GRADIENT_FALLBACK`。Mask 按来源顺序保存在 `layer.masks[]`。
包含动画、开放、非完全不透明或其他不支持条目的 Mask 栈会整体丢弃，
并报告 `LOTTIE_UNSUPPORTED_MASK`。文字动画及未识别字段并非都有专门诊断；diagnostics 为空不表示完全保真。
JSON、ZIP 解析、转换或 IR 校验失败时会抛出 `LottieConverterError`。

内嵌 `chars` 转为 IR Shape 图层，保留字形轮廓、实际字宽、字距、对齐和行距。图层变换与父子关系保留，
但不再作为可编辑文字输出。缺失字形、段落文本框、描边、动画字形和不支持的轮廓操作会回退到字体文字，
并返回 `LOTTIE_UNSUPPORTED_TEXT_GLYPHS`。
重复图层编号返回 `LOTTIE_DUPLICATE_LAYER_INDEX`；父级引用通过独立 null 图层保留 lottie-web 按源顺序叠加
变换的行为，不修改原有可见父层的层级。
子层在祖先显示区间之外仍然有效时，也使用独立变换节点继续计算祖先动画；祖先自身内容仍按原显示区间播放。

## API

### `convertLottieToIR(input, options?)`

- `input`：Lottie JSON 对象或序列化 JSON 字符串。
- `options.resourceBaseUrl`：用于解析相对图片和字体路径的绝对基础 URL。
- `options.zipResources`：`extractLottieFromZip` 返回的 ZIP 资源目录和 Data URL 映射。
- 返回 `{ scene: IRScene; diagnostics: ConversionDiagnostic[] }`，并在返回前校验 IR。

### `extractLottieFromZip(zipData)`

接收 ZIP `ArrayBuffer`，返回 JSON 字符串、资源 Data URL 映射和 JSON 所在目录。

### 错误

`LottieConverterError` 与 `LOTTIE_CONVERTER_ERROR_CODES` 从包根入口导出，
用于处理 JSON、ZIP、转换流程和 IR 校验错误。

## 源码结构

```text
src/
├── convert-lottie-to-ir.ts            # 公开转换流程与 IR 边界校验
├── assemble-ir-scene.ts               # 组装 IRScene 与 Composition
├── extract-lottie-from-zip.ts         # 提取 ZIP 中的 Lottie 输入与资源
├── parser/                             # 输入、图层栈和属性解析
├── converter/                          # Layer、资源、Mask、Shape、Text 和 Transform 转换
├── common/                             # 类型、错误模型和标识生成
└── index.ts                            # 稳定公开入口
```

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

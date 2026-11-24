# @galacean/figma2ge

[English](./README.md) | 简体中文

> 开发进行中：Figma `.fig` 解码与 Galacean Effects JSONScene 转换。

`@galacean/figma2ge` 可以在浏览器环境解码 Figma `.fig` 文件，将 Kiwi 节点消息提取为精简的 Figma IR，并生成
Galacean Effects 场景。该包仍在积极开发中，首个稳定版本前转换覆盖范围和公开类型可能变化。


## 目录

- [安装](#安装)
- [使用](#使用)
- [公开 API](#公开-api)
- [输入能力](#输入能力)
- [已知限制](#已知限制)
- [许可证](#许可证)

## 安装

```bash
pnpm add @galacean/figma2ge @galacean/effects@2.11.0-alpha.1
```

生成场景的类型和运行时使用 `@galacean/effects@2.11.0-alpha.1`，它是本包的 peer dependency。解码器依赖 `fzstd`、`pako`
和 `kiwi-schema`，不使用 Node.js API，因此可以在浏览器运行。包开发和 Node.js 调用方需要 Node.js 24 或更高版本。

## 使用

先解码 `.fig` 文件，再转换解码后的 Kiwi 消息：

```ts
import { convertFigmaToEffects, decodeFigFile } from '@galacean/figma2ge';

const response = await fetch('/scene.fig');
const figBytes = new Uint8Array(await response.arrayBuffer());
const { message, images } = decodeFigFile(figBytes);
const result = convertFigmaToEffects(message, {}, images);

for (const issue of result.issues) {
  console.warn(issue.type, issue.message);
}

console.info(result.scene, result.debugMap);
```

如果调用方已有解码后的 Kiwi `NodeChange` 对象，可以直接传给 `convertFigmaToEffects`。当图片 blob 没有嵌入解码消息
时，可通过 `imagesByHash` 传入图片数据。

## 公开 API

| 导出 | 用途 |
| --- | --- |
| `decodeFigFile` | 将 Figma `.fig` ZIP 解码为元数据、Kiwi 消息和图片字节 |
| `extractKiwiIR` | 将解码后的 Kiwi 消息转换为 Figma IR 节点和 blob |
| `convertFigmaToEffects` | 生成 GE JSONScene，并返回转换问题和 Figma 到 GE 的调试映射 |
| `validateSceneReferences` | 检查生成场景中的 Item、Composition 和 Data 引用 |
| `validateRuntimeReadiness` | 检查生成场景的运行时约束 |

根入口还导出 `ConversionResult`、`ConvertOptions`、`ConversionIssue`、`ConversionDebugMap`、`DebugMapEntry`、
`EffectsScene`、`FigmaIR*` 类型、`KiwiIRResult` 和 `DecodedFigFile`。

`ConvertOptions` 当前支持 `compositionName`、`compositionDuration` 和 `includeInvisibleNodes`。
`ConversionResult.issues` 包含 warning 和 error；即使存在问题，转换器也可能返回场景。

## 输入能力

本包仍在开发中。支持表示表中列出的解码或映射子集，不表示完整 Figma 渲染保真；部分支持表示仅映射部分数据，
或渲染结果依赖 GE Runtime。

| 能力 | 状态 | 行为 |
| --- | --- | --- |
| `.fig` 解码 | 支持 | ZIP stored / deflate 条目；`canvas.fig` 内 deflate 或 zstd 压缩的 Kiwi schema / message。 |
| 已解码 Kiwi 节点 | 支持 | 平铺 `nodeChanges` 层级；document / canvas 节点下探到子节点。 |
| 常见视觉节点 | 部分支持 | frame、group、形状、vector、text、symbol、instance 和 section。 |
| Paint 与图片数据 | 部分支持 | 纯色 / 渐变填充与描边；图片需通过 hash 索引的 blob 或图片字节提供。 |
| Mask 与 frame 裁剪 | 部分支持 | 映射支持的渲染组件；最终结果依赖目标 Runtime。 |
| 文字 | 部分支持 | 映射内容和对齐；字体可用性及估算 metrics 会影响布局。 |
| 自动布局与效果 | 部分支持 | 保存布局、阴影和模糊元数据；不提供完整 Figma 布局 / 效果引擎。 |
| 原型交互 | 不支持 | 生成带激活轨道的静态场景，不生成原型行为时间线。 |
| Figma URL / API 读取 | 不支持 | 需提供 `.fig` 字节或已解码 Kiwi 数据；不包含 Figma API 客户端。 |

请检查 `result.issues` 中的转换及场景 / Runtime 校验 warning 或 error。未知字段及近似处理并非都会产生 issue；
issues 为空不表示完全保真。ZIP、解压或 Kiwi 解码失败时，可能在返回转换结果前抛出错误。

生成结果是精简的 Galacean Effects JSONScene，需要由兼容的 GE Runtime 加载；本包不提供预览播放器。

## 已知限制

- `.fig` 解码器接受包含 `canvas.fig`、可选 `meta.json` 和 `images/*` 条目的 Figma ZIP 文件。
- 没有对应 GE 表达的 Figma 能力可能被跳过或近似，并记录在 `issues` 中。
- 字体可用性、文本 metrics 和 GE Runtime 能力会影响文本渲染结果。
- Figma 文件和 fixture 可能含有私有设计、图片和字体元数据；公开测试或分发前必须确认授权。
- 本包不转换 Figma URL，也不调用 Figma API；调用方需要提供 `.fig` 字节或已解码数据。

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

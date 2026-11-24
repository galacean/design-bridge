# @galacean/svg2ir

[English](./README.md) | 简体中文

将 SVG 转换为来源无关的 Animation IR，并在同一包内提供可选的 SVG→GE 以及SVG->layers适配。

## 目录

- [安装](#安装)
- [使用](#使用)
- [API](#api)
- [输出](#输出)
- [输入能力](#输入能力)
- [限制](#限制)
- [许可证](#许可证)

## 安装

```bash
pnpm add @galacean/svg2ir @galacean/ge-ir
```

运行要求：Node.js `>= 24`，pnpm `>= 10`。

## 使用

### SVG → IR

```ts
import { convertSVGToIR } from '@galacean/svg2ir';

const { ir, warnings } = convertSVGToIR(
  '<svg width="400" height="300"><rect x="20" y="20" width="200" height="120" fill="#1677ff"/></svg>',
);

console.log(ir.compositions[0].layers);
console.log(warnings);
```

`convertSVGToIR` 只返回核心 `IRScene` 和 warning，不携带 SVG 专属保留数据。

### 拆出 SVG 保留数据

```ts
import { splitSVG } from '@galacean/svg2ir';

const { ir, warnings, preservedData } = splitSVG(svgSource);
```

`preservedData` 的类型是 `SVGPreservedData`，用于保存核心 IR 暂时不支持的 SVG 信息，
包括富文本片段和 SMIL paint 动画；静态分层输出也使用其中的文字片段。

### SVG → GE

```ts
import { convertSVGToGE, splitSVG } from '@galacean/svg2ir';

const splitResult = splitSVG(svgSource);
const { data, warnings } = convertSVGToGE(
  splitResult,
  {
    fonts: [
      {
        fontFamily: 'Custom Sans',
        fontURL: 'https://example.com/fonts/custom-sans.woff2',
      },
    ],
  },
);
```

`convertSVGToGE` 始终使用 `@galacean/ge-ir` 的 `convertIRToGE` 生成基础 GE 场景；只有传入
`preservedData` 时，才执行 SVG 专属的 RichText、paint 动画和渐变 UV 后处理。直接传入 `splitSVG` 返回的
`SVGConversionContext` 会复用已解析的 IR 和保留数据，不再重复解析 SVG；传入 SVG 字符串时仍需单独传入
`preservedData` 才会启用这些后处理。`frameRate`、`durationSeconds`、`measureText` 等解析选项应传给
`splitSVG`；传给 `convertSVGToGE` 的选项用于 GE 输出和诊断。字体由 `SVGToGEOptions.fonts` 独立注入。

Node.js 调用方和浏览器调用方使用同一个根入口；Node 条件入口会自动安装 `svgdom` 解析底座。

### SVG → 静态分层

```ts
import { convertSVGToLayers } from '@galacean/svg2ir';

const svgSource = '<svg width="400" height="300"><text x="20" y="40" font-size="24">Hello</text></svg>';
const { size: canvasSize, data: layers, warnings } = await convertSVGToLayers(svgSource);
const json = JSON.stringify(layers);

console.info(canvasSize, json, warnings);
```

`convertSVGToLayers` 从 Animation IR 和 SVG 保留文字数据直接生成静态分层，
异步返回 `{ size, data, warnings }`。
`data` 是图片与文字的扁平图层数组，`size` 是独立返回的画布宽高，单位为像素。
SVG 图片转换为图片层，原生文字转换为可编辑文字层，不识别图片内部的文字。

依赖自包含的静态图形烘焙为透明 PNG，保留填充、渐变、图案、描边、标记、变换、滤镜、裁切、蒙版和透明度。
普通图形分别保留；组级效果可能将子图形合成一张 PNG。原生文字和图片始终不烘焙。
使用方需要按数组顺序创建图层，以保留 SVG 绘制顺序。

正片叠底、滤色、叠加等非 normal 混合模式降级为普通 Alpha 叠加。
烘焙和降级均告警；成功烘焙在严格模式下仍只告警。
烘焙依赖浏览器的 SVG、Canvas 和 DOM；Node 转换原生图层，并对未烘焙的图形告警。
包含原生文字／图片的效果分组或依赖、外部绘制资源、动画、脚本和 `foreignObject` 不烘焙。

图层格式：

- 公共字段：`id` 自动生成；`bbox` 使用画布像素坐标 `[left, top, right, bottom]`。
- 图片层：`type: 'image'`、`role: 'content'`，`url` 为 Base64 data URL。
  `size` 为旋转前的显示宽高，`rotation` 为 XYZ 欧拉角（度，Z 正值顺时针）；`width`、`height` 为 bbox 宽高。
  原生图片几何值保留两位小数。烘焙几何值遵循栅格分辨率；变换已进入像素，`rotation` 为 `[0, 0, 0]`。
- 文字层：`type: 'text'`、`state: 'active'`，`content` 为完整文字，`fragments` 保存分段内容、字体、字号、颜色和字距。
  片段 `bbox`、`polygon` 相对文字层左上角，polygon 为布局四角；`rotation` 单位为度，颜色使用 `#RRGGBB`。
  `font_family` 为不带 CSS 外层引号的字体名；导入时应沿用 `font_size` 和 `letter_spacing`。
  文字坐标、字号、字距和旋转保留精度。片段框宽按变换后字号逐字测量，只在字符之间添加字距，
  不追加宽度余量；使用方保存和还原文字时也应保留精度。
  原生文字无需擦除图片区域，`erase_operations` 为空数组。

外链图片默认通过 fetch 读取并内联，浏览器需要资源支持 CORS；本地文件或鉴权资源可通过 `loadImage` 读取。
相对图片路径需提供 `resourceBaseUrl`，图片读取失败或资源无效时会报错。

## API

### 包 API

- `convertSVGToIR(source, options?)`：返回 `{ ir, warnings }`。
- `splitSVG(source, options?)`：返回 `{ ir, warnings, preservedData }`。
- `convertSVGToGE(sourceOrContext, options?, preservedData?)`：返回 `{ data, warnings }`。
- `convertSVGToLayers(source, options?, preservedData?)`：返回 `Promise<SVGToLayersResult>`。
- `inferNumericWeightFromFamily(fontFamily)`：从字体名推断字重，无法识别时返回 `null`。

`splitSVG`、`convertSVGToGE` 和 `convertSVGToLayers` 使用的保留数据类型：

```ts
import type { SVGPreservedData } from '@galacean/svg2ir';
```

`SVGConversionContext` 是 `splitSVG` 的返回类型，可直接传给 `convertSVGToGE` 复用解析结果。

主要选项：

| 选项 | 说明 |
| --- | --- |
| `frameRate` | IR 帧率，默认 `30`。 |
| `durationSeconds` | 静态 SVG 展示时长，默认 `5` 秒；动态 SVG 根据 SMIL active interval 调整。 |
| `backgroundColor` | IR Composition 背景色。 |
| `resourceBaseUrl` | SVG 来源的绝对 URL，用于解析相对图片 `href`。 |
| `imageNaturalSizes` | 图片固有尺寸表，用于计算 `preserveAspectRatio` 几何。 |
| `measureText` | 可选文本测量回调，用于改善文本边界和布局。 |
| `strict` | 将可降级的 unsupported feature 从 warning 升级为错误。 |
| `onWarning` | 每产生一条 warning 时调用的回调。 |
| `fonts` | GE 输出使用的可选 GE Runtime 字体定义。 |
| `rasterScale` | layers 烘焙分辨率倍数，有限正数，默认 `2`，不改变显示尺寸；工作画布限制为 1600 万像素。 |
| `loadImage` | layers 图片读取回调：`(url) => Promise<{ data: Uint8Array; mimeType: string }>`，data 为原始图片字节。 |

## 输出

```ts
convertSVGToIR(source, options?);
// { ir: IRScene; warnings: SVG2IRWarning[] }

splitSVG(source, options?);
// { ir: IRScene; warnings: SVG2IRWarning[]; preservedData: SVGPreservedData }

convertSVGToGE(source, options?, preservedData?);
// { data: JSONScene; warnings: SVG2IRWarning[] }

await convertSVGToLayers(source, options?, preservedData?);
// { size: [number, number]; data: SVGStaticLayer[]; warnings: SVG2IRWarning[] }
```

## 输入能力

支持表示表中列出的子集；部分支持表示某些属性会近似或丢弃。能力取决于输出格式：静态分层支持的子集小于 IR 和 GE。

### IR 与 GE

| 能力 | 状态 | 行为 |
| --- | --- | --- |
| SVG 字符串与形状 | 支持 | `rect`、`circle`、`ellipse`、`path`、`polygon`、`polyline` 和 `line`。 |
| 分组与引用 | 支持 | 层级、变换、透明度及展开后的 `use` / `symbol` 实例。 |
| 图片 | 部分支持 | URL 资源和宽高比；需提供自然尺寸，避免拟合几何 fallback。 |
| 文字 | 部分支持 | text / tspan、路径文字、多行和竖排；GE 富文本需要 SVG 保留数据。 |
| Paint | 部分支持 | 纯色及支持的渐变；渐变文字变为单色，部分渐变属性丢弃。 |
| Mask 与 clipPath | 部分支持 | 元素级 clipPath、元素 / 组级 mask；单位和区域限制见下文。 |
| 组级 `clip-path` | 不支持 | 丢弃并报告 `svg2ir_group_clip_path_dropped`。 |
| SMIL | 部分支持 | 变换、运动、透明度、可见性、部分几何与 paint；GE paint 动画需要 sidecar。 |
| Filter / pattern / marker | 不支持 | 丢弃相关效果并告警，保留仍可表达的来源内容。 |
| Skew 与文字装饰 | 不支持 | 丢弃并告警；文字描边也会丢弃。 |
| 其他元素 | 不支持 | `foreignObject` 等未映射内容被丢弃并告警。 |

### 静态分层

| 能力 | 状态 | 行为 |
| --- | --- | --- |
| 图片与原生文字 | 支持 | 扁平图片 / 文字层；不识别图片内部文字。 |
| 图片资源 | 支持 | 下载并内联字节；本地或鉴权资源可通过 `loadImage` 读取。 |
| 文字布局与样式 | 部分支持 | metrics 可能估算；字重 / 斜体降级；竖排拆层。 |
| 形状与动画 | 不支持 | 跳过并告警；分层输出不会栅格化矢量形状。 |
| Mask 与视觉变换 | 部分支持 | 支持基本旋转 / 缩放；不支持的透明度、裁剪、斜切等导致跳过图层。 |

请检查 `warnings`，也可通过 `onWarning` 接收诊断。代表性 code 包括 `svg2ir_filter_dropped`、
`svg2ir_text_gradient_fill_flattened` 和 `svg2ge_layers_unsupported_feature`。
`strict: true` 将已报告的不支持能力和样式降级转为错误；分层文字边界估算仍仅告警。
SVG 无效或分层图片读取失败时会抛出错误。warnings 为空不表示已经完成渲染保真检查。

## 限制

- `filter`、`pattern`、`marker`、skew 和部分文本装饰没有完整的核心 IR 表达，会记录 warning 或被降级。
- Effects Runtime 不提供元素级投影、模糊和内阴影的通用入口；SVG filter 只保留可表达的源内容。
- 文本 stroke、text-decoration 和部分 per-span 定位不能完整进入策略 RichText。
- radialGradient 焦点偏移、`spreadMethod` 和部分 `gradientTransform` 不保留。
- 组级 `clip-path` 暂不映射；元素级 clipPath 和组级 mask 可用。
- IR 和 GE 转换不下载外部资源；URL 解析、字体及运行时资源加载由调用方负责。分层输出按上述规则读取并内联图片。

静态分层输出仅支持图片与文字。SMIL 动画元素会被移除并告警；不支持的动态通道、未烘焙的形状、纯色背景、图片斜切/镜像/裁剪、mask、透明度、
非等比文字缩放和路径文字会跳过并返回 warning。字重和斜体降级并告警；竖排文字逐字拆层，片段 direction 为 horizontal。
转换前应加载 `measureText` 使用的字体；该回调同步测量，不负责加载字体。度量不完整时返回边界估算 warning。
`strict: true` 将不支持的内容和样式降级转为错误；边界估算仍返回 warning。

直边矩形 mask 完全覆盖图片且未反向或减去区域时，保留原图片。

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

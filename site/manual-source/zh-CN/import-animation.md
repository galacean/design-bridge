# 接入 Lottie 与 SVG

本章按“输入 → IR → 校验 → 输出”的顺序，演示最常用的两类动画输入。读完后你可以把 Lottie 或 SVG 转成
Galacean Effects（GE）场景，并知道如何读取诊断。

## Lottie → IR → GE

`@galacean/lottie2ir` 接受 Lottie JSON 对象或序列化字符串。转换是同步的，失败时抛出 `LottieConverterError`。

```ts
import { convertLottieToIR, LottieConverterError } from '@galacean/lottie2ir';
import { validateIRScene } from '@galacean/animation-ir/validator';
import { convertIRToGE } from '@galacean/ge-ir';

try {
  const { scene, diagnostics } = convertLottieToIR(lottieJSON, {
    resourceBaseUrl: 'https://cdn.example.com/lottie/',
  });
  const report = validateIRScene(scene);
  const effects = convertIRToGE(scene);

  console.info(report.valid, diagnostics, effects.scene);
} catch (error) {
  if (error instanceof LottieConverterError) {
    console.error(error.message);
  }
  throw error;
}
```

- `resourceBaseUrl` 必须是绝对地址，用于解析 Lottie 中的相对图片和字体路径；转换时不会下载外部资源。
- `diagnostics` 中每一项包含 `action`（`normalized`、`approximated`、`dropped`、`unsupported`）和 JSON 路径，
  用来定位被近似或丢弃的特性。
- `convertIRToGE` 返回 `scene`（GE JSONScene）、`diagnostics` 和 `itemLayerIds`（GE 元素与 IR 图层的映射）。

### 带资源的 ZIP

素材通常以 ZIP 交付。先提取 JSON 和资源，再交给转换器；ZIP 内资源会被转为 Data URL。

```ts
import { convertLottieToIR, extractLottieFromZip } from '@galacean/lottie2ir';

const extracted = await extractLottieFromZip(zipArrayBuffer);
const { scene } = convertLottieToIR(extracted.json, { zipResources: extracted });
```

带内嵌 `chars` 的静态填充点文本可转成矢量 Shape 图层，保留字形轮廓，但失去文字可编辑性。
缺失或不支持的字形会回退为字体文本，并报告 `LOTTIE_UNSUPPORTED_TEXT_GLYPHS`。
作者遮罩支持有序、闭合、静态、全不透明的 add/subtract/intersect 路径子集；不支持的条目会使整组遮罩丢弃，
并报告 `LOTTIE_UNSUPPORTED_MASK`。IR 可以保留 GE 无法导出的亮度遮罩，应同时读取导入与 GE 导出的诊断。

## SVG → GE

`@galacean/svg2ir` 的 [convertSVGToGE](../../api/svg2ir/current/convertSVGToGE/) 将 SVG 字符串转换为 GE 场景。

```ts
import { convertSVGToGE, splitSVG } from '@galacean/svg2ir';

const context = splitSVG(svgText, {
  frameRate: 30,
  durationSeconds: 5,
});
const { data, warnings } = convertSVGToGE(context);
```

`data` 是 GE JSONScene，`warnings` 列出被丢弃或降级的 SVG 特性。静态 SVG 使用 `durationSeconds` 决定展示时长；
带 SMIL 动画的 SVG 以其激活区间为准。传入 `splitSVG` 上下文可保留 SVG 专属数据，并复用已解析的 IR，避免再次解析源文件。

### 只要 IR

需要继续用 IR 编辑时，调用 [convertSVGToIR](../../api/svg2ir/current/convertSVGToIR/)，结果为
`{ ir, warnings }`。随后可以用 `convertIRToGE` 或 `convertIRToDSL` 继续。

### 静态分层导出

设计与图文拆分场景使用 `convertSVGToLayers`，返回 Promise：

```ts
import { convertSVGToLayers } from '@galacean/svg2ir';

const { size, data, warnings } = await convertSVGToLayers(svgText, {
  rasterScale: 2,
  loadImage: async url => {
    const response = await fetch(url, { headers: { Authorization: token } });

    if (!response.ok) {
      throw new Error(`Image load failed: HTTP ${response.status}`);
    }
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get('content-type') ?? 'image/png',
    };
  },
});
```

`size` 是画布宽高，`data` 是图片层与文本层列表。`loadImage` 返回原始字节和 MIME 类型（不是 Base64），适合需要鉴权的图片；省略时使用 `fetch`；内嵌 Data URL 无需读取。
具体回调签名见 [SVGImageResourceLoader](../../api/svg2ir/current/SVGImageResourceLoader/)。

- 按 `data` 数组顺序创建图层，以保留 painter order。原生 SVG 文字保持可编辑，不识别图片中的文字；图层边界使用画布像素。
- 浏览器可把自包含静态图形烘焙成透明 PNG，覆盖受支持的渐变、滤镜、pattern、裁剪与遮罩。
  组级效果可能合并子图形，原生文字与图片仍独立保留。
- 烘焙需要 SVG、Canvas 与图片支持；Node 导出会报告无法烘焙的图形。含原生文字/图片的混合组、外部绘制资源等不一定能烘焙。
- `rasterScale` 默认为 `2`，只改变栅格分辨率，不改变显示尺寸；工作栅格上限为 1600 万像素。
  烘焙后的矢量几何不可编辑，非 normal 混合模式会降级并警告。
- 静态导出移除 SMIL 动画元素，不采样动画帧；`strict: true` 拒绝不支持的特性与样式降级，成功烘焙只给提示。

以上烘焙能力属于静态分层输出，不代表 SVG → IR → GE 新增了滤镜或 pattern 支持。

## 如何阅读诊断

| 字段 | 含义 | 建议 |
| --- | --- | --- |
| `info` + `normalized` | 来源语义被标准化 | 通常无需处理 |
| `warning` + `approximated` | 效果近似 | 在目标播放器里目测确认 |
| `warning` + `dropped` | 特性被丢弃 | 评估对视觉的影响，必要时改素材 |
| `warning` + `unsupported` | 来源特性不支持 | 在设计端改写，或改走其他链路 |

诊断是格式差异的第一手证据。保存或上线前把诊断写入日志，并抽检代表性帧。
继续阅读[转换链路](../conversion/)了解其余六个包，或阅读[最佳实践](../best-practices/)。

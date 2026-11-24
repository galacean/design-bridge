# 构建 Animation IR

大多数场景由转换器生成 IR，但自己构建 IR 能帮你理解模型，也适合写测试夹具或自定义来源适配器。
本章从最小场景开始，逐步加入图层、关键帧和资源。字段定义以 [animation-ir README](https://github.com/galacean/design-bridge/blob/main/packages/animation-ir/README-zh_CN.md)
和 [API 参考](../../api/?package=animation-ir) 为准。

## 最小场景

`IRScene` 由入口合成、合成列表和资源注册表组成。`format` 与 `schemaVersion` 是固定值。

```ts
import { IREndBehavior, IRLayerType, type IRScene } from '@galacean/animation-ir';
import { validateIRScene } from '@galacean/animation-ir/validator';

const scene: IRScene = {
  format: 'animation-ir',
  schemaVersion: '1.0.0',
  entryCompositionId: 'main',
  compositions: [{
    id: 'main',
    name: 'Main',
    width: 750,
    height: 400,
    frameRate: 30,
    inPoint: 0,
    outPoint: 60,
    endBehavior: IREndBehavior.Loop,
    layers: [],
  }],
  assets: [],
};

console.info(validateIRScene(scene).valid);
```

## 时间与坐标

- 时间单位是**帧**，每个合成有自己的 `frameRate`。`60` 帧、30 fps 即 2 秒。
- 图层活动区间是半开区间 `[inFrame, outFrame)`。
- 坐标原点在左上角，X 向右、Y 向下，单位为像素；旋转是角度，缩放是倍率，颜色是 `0..1` 的 RGBA。
- `position` 是 anchor 在父坐标系的位置，`anchor` 是旋转与缩放中心（图层局部坐标）。
- `layers` 数组按 painter order 从底到顶；`parentId` 只继承变换，不影响绘制顺序。

## 添加图层

图层类型决定必填内容：

| 类型 | 必填内容 |
| --- | --- |
| `solid` | `content.color`、`localBounds` |
| `image` | `content.assetId`、`localBounds` |
| `text` | `content`（含 `fontAssetId`） |
| `shape` | `content.shapes` |
| `precomp` | `content.compositionId`、`content.clipToBounds` |
| `particle` | `content.maxParticles`、`content.startLifetime`（所属合成的帧数）、`content.emission`、`localBounds` |
| `null` | 无；常用作变换父节点 |

下面添加一个纯色背景和一段会下移的文字，并为文字注册一个系统字体资源：

```ts
const [composition] = scene.compositions;

composition.layers.push(
  {
    id: 'bg',
    type: IRLayerType.Solid,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    content: { color: [0.1, 0.1, 0.2, 1] },
    localBounds: { x: 0, y: 0, width: 750, height: 400 },
  },
  {
    id: 'title',
    type: IRLayerType.Text,
    time: { inFrame: 0, outFrame: 60 },
    visible: true,
    content: {
      text: 'Hello',
      color: [1, 1, 1, 1],
      fontAssetId: 'font',
      fontSize: 48,
      letterSpacing: 0,
      lineHeight: 56,
      textAlign: 'center',
    },
    transform: {
      position: {
        type: 'keyframed',
        keyframes: [
          { frame: 0, value: [375, 120, 0], outTangent: { x: 0.33, y: 0 } },
          { frame: 30, value: [375, 200, 0], inTangent: { x: 0.67, y: 1 } },
        ],
      },
    },
  },
);
scene.assets.push({
  id: 'font',
  type: 'font',
  family: 'sans-serif',
  style: 'normal',
  weight: 400,
  source: { kind: 'system' },
});
```

## 动画属性

可动画属性（`position`、`scale`、`rotation`、`opacity`）用 `type` 区分：

- `{ type: 'static', value }`：固定值。
- `{ type: 'keyframed', keyframes }`：关键帧序列。`frame` 属于**合成帧域**，不是相对图层起点的偏移。
  两个关键帧之间的缓动由起点的 `outTangent` 和终点的 `inTangent` 决定；`hold` 表示保持到下一关键帧。

`anchor` 是静态属性；文本内容、形状几何、填充和描边也是静态数据，需要动画时通过所属图层的变换实现。

## 资源

图片和字体都登记在 `scene.assets`，图层通过 `assetId` / `fontAssetId` 引用。资源来源：

```ts
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';

const imageURL = resolveIRResourceUrl('./a.png', 'https://cdn.example.com/scenes/intro.json');
const externalSource = createIRResourceSource(imageURL);
// { kind: 'url', url: 'https://cdn.example.com/scenes/a.png' }
const embeddedSource = createIRResourceSource('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E');
// 内嵌来源保存 mimeType 与不含 data: 前缀的 Base64 data。
```

相对地址应由适配器结合来源地址解析后再写入。系统字体依赖运行环境，校验会给出可移植性警告。

## 校验与错误处理

```ts
import { assertIRScene, validateIRScene } from '@galacean/animation-ir/validator';

const result = validateIRScene(scene);

for (const issue of [...result.errors, ...result.warnings]) {
  console.info(issue.code, issue.path, issue.message);
}
const input: unknown = JSON.parse(serialized);

assertIRScene(input); // 失败时抛出 IRValidationError，成功后 input 收窄为 IRScene
```

常见问题：ID 重复、资源或 Precomp 引用悬空、父图层成环、`localBounds` 缺失、时间范围非法。
`validateIRScene` 一次返回全部问题，适合在编辑器里展示；`assertIRScene` 适合在服务边界快速失败。
校验通过只说明结构合法，不保证资源可加载或像素一致。

## 输出

合法的 IR 可直接交给转换器：

```ts
import { convertIRToGE } from '@galacean/ge-ir';
import { convertIRToDSL } from '@galacean/dsl-ir';

const ge = convertIRToGE(scene);
const editable = convertIRToDSL(scene);
```

接下来阅读[接入 Lottie 与 SVG](../import-animation/)，了解如何用转换器生成 IR。

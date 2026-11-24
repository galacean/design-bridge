# @galacean/animation-ir

[English](./README.md) | 简体中文

来源无关的二维动画 Schema、Adapter 契约与运行时校验。

导入器把源文件转换为 `IRScene`，编辑器按帧修改图层，导出器再将场景写入目标格式。三者共用同一套合成、图层和资源类型。

## 目录

- [安装](#安装)
- [创建场景](#创建场景)
- [场景与图层](#场景与图层)
- [时间与动画](#时间与动画)
- [粒子](#粒子)
- [资源](#资源)
- [运行时校验](#运行时校验)
- [Adapter 契约](#adapter-契约)
- [贡献](#贡献)
- [许可证](#许可证)

## 安装

```bash
pnpm add @galacean/animation-ir
```

本包使用原生 ESM。在 Node.js 中运行需要 24 或更高版本。

| 导入路径 | 用途 |
| --- | --- |
| `@galacean/animation-ir` | 场景类型与运行时常量，如 `IRScene`、`IRLayerType` |
| `@galacean/animation-ir/adapter` | 创建场景、解析资源地址、换算粒子参数 |
| `@galacean/animation-ir/validator` | 校验未知输入，返回诊断或抛出异常 |

## 创建场景

下面的蓝色方块以 30 fps 播放。第 0 帧透明，第 30 帧完全可见，第 60 帧开始下一轮循环。

```ts
import { createIRScene } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';

const scene = createIRScene({
  id: 'main',
  width: 320,
  height: 180,
  frameRate: 30,
  inPoint: 0,
  outPoint: 60,
  endBehavior: 'loop',
  layers: [{
    id: 'square',
    type: 'solid',
    visible: true,
    time: { inFrame: 0, outFrame: 60 },
    localBounds: { x: 0, y: 0, width: 80, height: 80 },
    content: { color: [0, 0.4, 1, 1] },
    transform: {
      opacity: {
        type: 'keyframed',
        keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }, { frame: 60, value: 0 }],
      },
    },
  }],
});

assertIRScene(scene);
```

`createIRScene` 把 `main` 设为入口，并填写 `format` 和 `schemaVersion`。有共享资源时，将资源数组作为第二个参数传入。

## 场景与图层

- `scene.entryCompositionId` 指定播放入口。读取已有场景时，用 `getIRSceneEntryComposition(scene)` 按 ID 取得该合成。
- `scene.compositions` 保存各自拥有画布、帧率和图层的合成。`scene.assets` 保存所有合成共享的图片和字体。
- 合成 ID、资源 ID 分别在各自列表内唯一。图层 ID 只需在所属合成内唯一。引用按 ID 精确匹配。

### 图层类型

| `type` | 内容 | `localBounds` |
| --- | --- | --- |
| `solid` | `content.color` 指定 RGBA，各通道取 `0..1` | 必填，定义矩形范围 |
| `image` | `content.assetId` 引用图片资源 | 必填，定义显示尺寸 |
| `text` | 文本、`fontAssetId`、颜色、字号、字距、行高、对齐方式 | 可选，定义文本边界 |
| `shape` | `content.shapes` 保存矢量图形、填充和描边 | 可选 |
| `particle` | `content` 保存粒子数量上限、寿命和发射参数 | 必填，定义编辑区域 |
| `precomp` | `content.compositionId` 引用源合成，`clipToBounds` 控制画布裁剪 | 可选 |
| `null` | 可作为一组图层的变换父节点 | 可选 |

`layers[0]` 位于最底层，最后一项位于最顶层。`parentId` 让子图层继承同一合成中父图层的变换。子图层的绘制顺序、可见性和活动区间各自独立。

### 矢量形状与遮罩

- **形状**支持矩形、椭圆、多边形、星形和自定义贝塞尔路径。每个形状先绘制全部填充，再绘制全部描边。
- **填充与描边**支持纯色、线性渐变、径向渐变、角向渐变和图片纹理。纹理通过 `assetId` 引用共享图片。
- **路径蒙版** `masks` 按数组顺序叠加静态闭合路径。每项指定 `add`、`subtract` 或 `intersect`，并可设置 `inverted`。
- **轨道遮罩** `matte` 通过 `sourceLayerId` 取同一合成内另一图层的几何覆盖、Alpha 或亮度。来源图层仍按自身顺序和可见性绘制。

同一图层可同时使用两种遮罩。最终透明度等于内容 Alpha、路径蒙版覆盖率、轨道遮罩覆盖率和图层 `opacity` 的乘积。

## 时间与动画

### 帧与播放区间

| 字段 | 解释 |
| --- | --- |
| `composition.inPoint`、`outPoint` | 合成的起止帧，时长为 `(outPoint - inPoint) / frameRate` 秒 |
| `layer.time.inFrame`、`outFrame` | 图层的基础活动区间 `[inFrame, outFrame)` |
| `keyframe.frame` | 所属合成的绝对帧号，允许小数 |
| `precomp.time.sourceStartFrame` | 实例激活时采样的源帧，默认取源合成的 `inPoint` |
| `precomp.time.stretch` | 正数播放时长倍率，默认 `1`，`2` 表示半速 |

例如，父合成 30 fps，源合成 24 fps。实例从源帧 10 开始半速播放，父合成经过 30 帧（1 秒）后，源帧为 `10 + 24 / 2 = 22`。

合成必须指定 `endBehavior`，图层默认取 `destroy`。预合成实例可用 `content.endBehavior` 覆盖源合成的结束行为。

- `destroy` 停止参与合成，`loop` 回到起始帧重播。
- `freeze` 保持结束前的状态，`continue` 继续推进本地时间。

### 坐标与关键帧

坐标原点在左上角，X 向右、Y 向下。`anchor` 是图层局部像素坐标，`position` 指定该锚点在父坐标系中的位置。

| 变换属性 | 单位 | 默认值 |
| --- | --- | --- |
| `position`、`anchor` | 像素 | `[0, 0, 0]` |
| `scale` | 倍率 | `[1, 1, 1]` |
| `rotation.x/y/z` | 度，正 Z 旋转在屏幕上呈顺时针 | 各轴 `0` |
| `opacity` | `0..1` | `1` |

`anchor` 取静态值。其余变换支持 `static` 和 `keyframed`，关键帧按 `frame` 严格递增。若图层从第 10 帧开始，第 15 帧的关键帧就在图层出现 5 帧后生效。

- **线性插值**是默认行为。起始关键帧设置 `hold: true` 时，在该片段保持起始值。
- **贝塞尔缓动**使用起点的 `outTangent` 和终点的 `inTangent`，控制值随时间变化的速度。
- **位置路径**使用 `spatialOut` 和 `spatialIn`。这两个手柄以像素表示相对各自端点的偏移。

## 粒子

`startLifetime` 是粒子出生时取样的寿命，单位是所属合成的帧，允许小数。下面的发射器在 30 fps 合成中生成寿命为 0.25 至 0.5 秒的粒子。

```ts
import type { IRParticleContent } from '@galacean/animation-ir';

const particles: IRParticleContent = {
  maxParticles: 100,
  startLifetime: { type: 'randomBetweenConstants', min: 7.5, max: 15 },
  emission: {
    rateOverTime: { type: 'constant', value: 12 },
    bursts: [{ frameOffset: 5, count: 8, cycleCount: 2, repeatIntervalFrames: 15 }],
  },
};
```

| 示例参数 | 播放效果 |
| --- | --- |
| `maxParticles: 100` | 同时存活的粒子最多 100 个 |
| `startLifetime` | 每个粒子的寿命在 7.5 至 15 帧之间均匀随机取值 |
| `emission.rateOverTime` | 持续发射，每秒 12 个粒子 |
| `emission.bursts` | 相对图层起点，第 5 帧和第 20 帧各发射 8 个粒子 |

寿命和持续发射率都支持常量、随机区间和曲线。曲线横轴 `progress` 是发射周期内的归一化进度（`0..1`），纵轴 `value` 使用对应参数的单位。

**迁移按秒保存的粒子寿命**

- 有源 GE 或 DSL 时，重新导入即可。如有配对的 DSL 保真数据，一并重新生成。
- 直接迁移 IR 时，按所属合成帧率调用 `mapIRParticleScalarValues(lifetime, seconds => seconds * frameRate)`。它换算常量、区间端点、曲线关键帧和控制点的值，保留 `progress`。

## 资源

图片图层和形状纹理通过 `assetId` 共享图片，文字图层通过 `fontAssetId` 选择字体。

| `source.kind` | 数据 | 适用资源 |
| --- | --- | --- |
| `url` | 绝对 URL | 图片、字体 |
| `embedded` | `mimeType` 和标准 Base64 `data`，数据不含 Data URL 前缀 | 图片、字体 |
| `system` | 由消费环境按字体的 `family`、`style`、`weight` 查找 | 字体 |

导入器用源文档的 URL 解析相对路径。`createIRResourceSource` 也能把 Data URL 转为 `embedded`，导出时用 `getIRResourceSourceUrl` 还原为 URL 或 Data URL。

```ts
import { createIRResourceSource, resolveIRResourceUrl } from '@galacean/animation-ir/adapter';

const url = resolveIRResourceUrl('./icon.png', 'https://example.com/scenes/intro.json');
const source = createIRResourceSource(url);
// { kind: 'url', url: 'https://example.com/scenes/icon.png' }
```

文字图层和字体资源的完整示例见[构建 Animation IR](../../site/manual-source/zh-CN/author-animation-ir.md)。

## 运行时校验

- 编辑器或批量导入工具用 `validateIRScene(input)` 收集问题。返回值是 `{ valid, errors, warnings }`，`errors` 为空时场景有效。
- 从 JSON 读取场景时，用 `assertIRScene(input)` 将 `unknown` 收窄为 `IRScene`。断言失败时，`IRValidationError.issues` 包含所有阻断错误。

例如，将前面示例的入口改为一个不存在的合成 ID，诊断会指出具体字段。

```ts
import { validateIRScene } from '@galacean/animation-ir/validator';

const result = validateIRScene({ ...scene, entryCompositionId: 'intro' });
// result.valid          → false
// result.errors[0].code → 'IR_SCENE_ENTRY_COMPOSITION_MISSING'
// result.errors[0].path → 'entryCompositionId'
```

校验覆盖字段取值、ID 唯一性、资源引用，以及父图层、轨道遮罩和预合成的循环引用。不可达合成和系统字体依赖会产生警告。资源加载和渲染由消费方负责。

## Adapter 契约

- **导入**时将源格式的时间、坐标和资源引用映射到 IR。导出时按目标格式换算单位。
- **保真回写**所需的格式专有数据与 `IRScene` 配对保存，由对应转换包读取。
- **转换诊断**使用 `ConversionDiagnostic`。`action` 取 `normalized`、`approximated`、`dropped` 或 `unsupported`，`path` 指向受影响的数据。

## 贡献

包测试命令是 `pnpm --filter @galacean/animation-ir test`。提交要求见[贡献指南](../../CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

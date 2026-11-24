# @galacean/dsl-ir

[English](./README.md) | 简体中文

面向可编辑 DSL 与来源无关 Animation IR 的双向转换和校验工具包。

本包只负责 DSL 边界。Galacean Effects JSONScene 的导入、导出和 GE-only 数据保留由
`@galacean/ge-ir` 负责。

## 目录

- [安装](#安装)
- [使用](#使用)
- [数据与编辑边界](#数据与编辑边界)
- [公开 API](#公开-api)
- [源码结构](#源码结构)
- [许可证](#许可证)

## 安装

需要 Node.js 24 或更高版本。

```bash
pnpm add @galacean/dsl-ir
```

需要处理 Galacean Effects 时同时安装：

```bash
pnpm add @galacean/dsl-ir @galacean/ge-ir
```

## 使用

### DSL 转 Animation IR

从零创建的 DSL 不需要保真数据：

```ts
import { convertDSLToIR, type Composition } from '@galacean/dsl-ir';

const dsl: Composition = {
  meta: {
    name: 'example',
    duration: 2,
    fps: 30,
    width: 512,
    height: 512,
    loop: true,
    background_color: null,
  },
  layers: [],
};

const { scene, diagnostics } = convertDSLToIR(dsl);
```

DSL 的时间单位是秒；Animation IR 使用帧。转换帧率来自 `dsl.meta.fps`，帧率和画布尺寸均允许有限正小数。
相邻动画段的终点和起点可以不同，用于表达瞬时复位。

保真写回保留各来源合成的帧率，除非显式修改 `meta.fps`。修改后，所有合成按新帧率重采样，
保持秒单位的时长和预合成来源时间偏移。

DSL 的初始 `position.z` 决定同级图层的层级，值越大越靠上，数组排列不决定遮挡顺序。
同值时，保真编辑保持导入顺序；普通直转按图层 ID 确定稳定顺序。导出的 DSL 将绘制层级写入 Z，
来源空间深度保留在配对数据中。仅修改 Z 会移动整个兄弟子树，不改变相机距离；普通直转的 IR 位置 Z 为 0。
动画位置以第一段 `start.z` 为固定层级。来源深度有动画时，XY 编辑保留相同关键帧时间上的深度；
暂不支持改变该位置动画的时间结构或改成静态位置。

文字的局部原点是「水平对齐点 × 首行基线」，仍按
`parent * T(position) * R * S * T(-anchor)` 应用变换。宽高描述排版框，不代表原点或额外平移。
转换器通过 IR `localBounds` 表达偏移：`x = -a * width`、`y = -B`，其中左、中、右对齐的 `a`
分别为 `0`、`0.5`、`1`；`B = fontSize + (lineHeight - fontSize) / 3` 对应 GE 顶部对齐排版的首行基线。
父级变换保持不变。保真编辑修改字号、行高、对齐或宽高时保持基线点固定；反向转换将矩形坐标系中的 IR
锚点换算到基线坐标系，文字层的子节点位置同步换算。

旋转中心遵循 DSL 的 `anchor`。若要绕 GE 排版框中心旋转，基线坐标系下的锚点为
`[(0.5 - a) * width, height / 2 - B, 0]`，`position` 放在目标中心。父级与旋转变换不再叠加基线平移。

已有按矩形左上角编写的 DSL，需要从文字 `anchor` 减去 `[a * width, B, 0]` 才能保留原有位置；
原本使用基线坐标的 DSL 不需要迁移。字形、换行和溢出仍由渲染器处理，此映射不测量字形，也不改变排版策略。

### Animation IR 转 DSL

`convertIRToDSL` 始终返回可编辑 DSL、diagnostics 和 `IRToDSLPreservedData` 保真数据：

```ts
import { convertIRToDSL } from '@galacean/dsl-ir';

const { dsl, preservedData, diagnostics } = convertIRToDSL(scene);
```

`preservedData` 保存 DSL 无法完整表达的 IR 信息和写回关系。该对象属于 adapter
保真数据，不是 DSL 业务数据。它可以经过 `JSON.stringify` / `JSON.parse` 持久化，
但业务代码不应修改或依赖其内部结构。

### 把编辑后的 DSL 写回来源 IR

将同一次转换产生的 DSL 与保真数据一起传回 `convertDSLToIR`：

```ts
const converted = convertIRToDSL(scene);
const editedDSL = structuredClone(converted.dsl);

editedDSL.layers[0].opacity = { a: false, value: 0.5 };

const { scene: updatedScene, diagnostics } = convertDSLToIR(editedDSL, {
  preservedData: converted.preservedData,
  onChange: change => console.info(change),
  onWarning: warning => console.warn(warning),
});
```

提供 `preservedData` 时，转换器会把 DSL 可表达的变化写入保留的 IR 快照，
同时保留 DSL 契约之外的信息。
warning 不会中断转换；新增图层、修改类型等可安全忽略的编辑会通过 diagnostics 和 `onWarning` 报告，
支持的编辑仍会生效。无效输入、无效保真数据或无法保留源深度的位置编辑仍会抛出异常。
应用应捕获转换失败，保留上一次有效场景，仅在转换成功后替换。

### 与 `@galacean/ge-ir` 组合

应用显式组合两个 adapter，并配对保存各自的 sidecar。

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';
import { convertIRToDSL, convertDSLToIR } from '@galacean/dsl-ir';

const ge = convertGEToIR(geScene, { frameRate: 30 });
const dsl = convertIRToDSL(ge.scene);
const edited = structuredClone(dsl.dsl);

edited.meta.duration = 4;

const updated = convertDSLToIR(edited, { preservedData: dsl.preservedData });
const preservedData = updateGEToIRPreservedData(ge.scene, updated.scene, ge.preservedData);
const restored = convertIRToGE(updated.scene, { preservedData });
```

### 粒子图层

所有图层统一使用 `Composition` 和 `Layer`。粒子通过 `type: 'particle'` 区分。所有图层均可省略
`time_range`、`rotation`、`scale`、`anchor`、`opacity`。保真写回保留省略字段的源值；无保真数据时使用
合成时间和默认变换。转换不补写输入 DSL，显式提供的字段仍校验格式。`convertIRToDSL` 输出完整图层，`validateDSL` 和 `convertDSLToIR` 统一校验和转换。
`parseParticleShape` 解析来源 adapter 提供的可选、只读发射器几何信息。

DSL 的 `particle.options.startLifetime` 使用秒，适配器按粒子所属合成的帧率与 IR 的 `content.startLifetime`
双向换算。嵌套粒子使用其所在预合成的帧率。

来源效果、目标布局、模型请求和 GE 资源恢复由应用通过公开 adapter API 组合。

### 转换包含粒子来源的完整 DSL

把完整 DSL 传给 `convertDSLToIR`，通过配套 DSL 保真数据绑定粒子占位层；普通层在同一次转换中创建。
下面的来源包含一个根粒子层，`fullDSL` 中对应目标层的 ID 为 `target-particle`：

```ts
import { convertDSLToIR, convertIRToDSL } from '@galacean/dsl-ir';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';

const particle = convertGEToIR(particleGE, { frameRate: 30 });
const source = convertIRToDSL(particle.scene);
const converted = convertDSLToIR(fullDSL, {
  particleSources: [{
    preservedData: source.preservedData,
    layers: { 'target-particle': source.dsl.layers[0].id },
  }],
});
const exported = convertIRToGE(converted.scene, {
  sources: converted.sourceInstances?.map(({ idMap }) => ({ ...particle, idMap })),
});
```

每个 `particleSources` 条目创建一个独立 IR Precomp 实例。`layers` 将目标 DSL ID 映射到来源 DSL ID，
可以绑定一个系统或来源合成中的全部系统。共享实例的目标宽高、静态位置、旋转和缩放必须一致；目标必须是根级粒子叶节点。
独立布局或重复使用同一来源时提供多个条目。分别布局系统时，辅助图层随来源中的第一个系统保留。

目标宽高和位置用于放置来源区域；Z 与普通 DSL 图层共同决定绘制顺序。可选 `authoringBounds` 默认使用来源
画布，按比例适配且不裁剪。布局支持静态 XY 等比缩放（`scale.z = 1`）和顺时针 Z 轴旋转，以来源活动区域中心
为基准，Wrapper 使用 XYZ 等比缩放。目标锚点不修改源发射器变换。粒子参数、名称、透明度和时间用于编辑源 IR，
未编辑的曲线保留。省略时间时，将源粒子及必要祖先延长至宿主时长；显式时间不变。
`meta.duration` 决定宿主与来源实例的播放窗口。来源合成保留自身帧率，并至少延长至该时长；
较长来源保留局部时间数据，不会延长宿主。

来源布局中的旋转和缩放现在作用于 Wrapper。若应用从源 Layer 克隆目标层，应先将布局旋转重置为零、缩放重置为一，
再应用目标布局；需要修改发射器本身时，编辑配对的源文档。GE 导出会适配世界空间运动，并默认补偿粒子尺寸，
见[粒子空间适配](../ge-ir/README-zh_CN.md#粒子空间适配)。

`sourceInstances` 返回每个输入的 `sourceIndex` 与 `idMap`。多个来源时，按索引关联对应 GE 导入结果。
`convertIRToGE` 通过 `options.sources` 恢复和隔离 GE payload、协调编辑字段，再一次导出。
组装后的保真数据仅在导出内部使用，输入不会被修改。

来源需要可信的 GE 3.6 保真数据和不含嵌套合成的自包含 Composition；互相引用的系统必须放在同一实例中。
DSL 与 GE adapter 不相互依赖，来源选择与两份 sidecar 的配对由应用负责。

## 数据与编辑边界

- `@galacean/animation-ir` 是 Animation IR 类型和校验的唯一真源。
- DSL 是面向编辑的子集，不是任意来源格式 schema 的镜像。
- `convertIRToDSL` 会展开预合成，并把写回关系保存在 `IRToDSLPreservedData` 中。
  共享实例联动编辑同一来源图层；同一字段的冲突编辑保留原值并报告 warning，其他编辑继续应用。
  删除共享子图层影响所有实例，并报告 warning。
- 旋转各轴独立时，在各轴关键帧时间的并集采样并使用线性插值，同时报告诊断；
  未编辑旋转时，sidecar 保留原始曲线和缓动。
- 字号、行高使用合成像素且必须大于零；字距使用相同单位并允许负数。行高省略时使用 `text.size * 1.2`。
- 保真写回支持既有图层的字段编辑、删除和同父级重排；无法安全写回的编辑通过
  diagnostics 或 warning 报告。
- 两个转换方向都会校验 IR；成功返回的 `scene` 始终满足 Animation IR 契约。
- 外部图片资源进入 Animation IR 时必须使用绝对 URL 或 Data URL；DSL 字体名会映射为系统字体
  资产。内联 SVG 的 `url` 省略或为空字符串时，转换器使用 SVG 内容。
- Particle Layer 与其他受支持图层共用 `convertIRToDSL` 和 `convertDSLToIR` 链路。DSL 表达可编辑的
  `options` 和 `emission`；来源 adapter 还可以提供可选的只读 `shape`，供模型理解发射器几何。
  renderer、资源及其他 GE-only 字段仍保留在 GE adapter sidecar 中。
- Burst 的 `cycles` 缺省或为 `0` 时表示持续重复到 Layer 结束；发生重复时，秒单位的 `interval` 必须
  大于 `0`。只发射一次时需显式设置 `cycles: 1`。
- 粒子寿命和发射数值使用 GE `NumberExpression` 的 DSL 子集，只支持固定值 tag `0` 和随机范围
  tag `4`；IR 曲线会带诊断投影，并在对应字段未编辑时由 DSL sidecar 保留。
  投影出的 `shape` 不写入 Animation IR；来源 adapter 仍负责恢复原始发射器几何。

相关文档：

- [DSL Schema 类型](./src/dsl/schema.ts)
- [Animation IR 数据契约](../animation-ir/README-zh_CN.md)
- [GE Adapter 与包边界](../ge-ir/README-zh_CN.md)

## 公开 API

### 运行时导出

| 导出 | 用途 |
| --- | --- |
| `convertDSLToIR` | 将新建 DSL 转换为 IR，或把 DSL 值写回保留的 IR |
| `convertIRToDSL` | 将 IR 转成可编辑 DSL，并返回写回所需的保真数据 |
| `validateDSL` | 校验未知输入是否符合 DSL 数据契约 |
| `DSLValidationError` | DSL 无效时抛出的结构化错误；转换也可能抛出 IR 校验或其他错误 |
| `parseParticleShape` | 把 GE 风格数值 shape 标签投影为可选的只读 DSL 上下文 |
| `ValueType` | 粒子表达式运行时标签：`CONSTANT = 0`、`RANDOM = 4` |

核心签名：

```ts
function convertDSLToIR(composition: Composition, options?: DSLToIROptions): DSLToIRResult;

function convertIRToDSL(scene: IRScene): IRToDSLResult;

function validateDSL(dsl: unknown): DSLValidationResult;
```

### 类型导出

所有公开类型都从包根入口导入：

- DSL 结构：`AnimationCurve`、`AnimatedProperty`、`Asset`、`Composition`、`CompositionMeta`、`Description`、
  `Layer`、`LLMSVGAsset`、`NumberExpression`、`Particle*` 类型、`TextProperties` 和
  `UserAsset`，以及 `ValueType`。
- 校验：`DSLValidationIssue` 和 `DSLValidationResult`。
- DSL → IR：`DSLToIROptions`、`DSLParticleSource`、`DSLToIRChange`、`DSLToIRResult` 和 `DSLToIRWarning`。
- IR → DSL：`IRToDSLPreservedData` 和 `IRToDSLResult`。

重要结果和选项类型：

```ts
interface IRToDSLResult {
  dsl: Composition;
  preservedData: IRToDSLPreservedData;
  diagnostics: ConversionDiagnostic[];
}

interface DSLToIRResult {
  sourceInstances?: { sourceIndex: number; idMap: Record<string, string> }[];
  scene: IRScene;
  diagnostics: ConversionDiagnostic[];
}

interface DSLParticleSource {
  preservedData: IRToDSLPreservedData;
  layers: Readonly<Record<string, string>>;
  authoringBounds?: readonly [x: number, y: number, width: number, height: number];
}

interface DSLToIROptions {
  preservedData?: IRToDSLPreservedData;
  particleSources?: readonly DSLParticleSource[];
  onWarning?: (warning: DSLToIRWarning) => void;
  onChange?: (change: DSLToIRChange) => void;
}
```

TypeScript 调用方应使用 `Layer['position']` 或 `AnimatedProperty<[number, number, number]>` 声明向量轨道，
使用 `AnimatedProperty<number>` 声明透明度；`anchor` 仅支持静态值。构造 `Layer` 时，按类型同时提供必需的
`asset`、`text` 或 `particle` 内容。文字层须有正文和正字号。显式行高以像素为单位，省略时使用 `text.size * 1.2`。

名称、描述和素材提示词缺失或格式错误时，转换会告警并继续。背景或文字样式无效时，优先保留配对的基线样式；
新场景省略无效背景，文字样式分别回退为黑色、无衬线字体、左对齐、零字间距和 `text.size * 1.2` 行高。
生成的 SVG 素材优先使用有效的 URL。URL 缺失或无效时回退到内联 SVG；内联 SVG 缺失或无法编码时，
仍可使用有效的 URL。两者都不可用时转换才会因素材来源失败。静态透明度可用单元素数值数组，越界时会限制在有效区间；
普通图层的静态二维位置 `[x, y]` 使用 `z = 0`。无效缓动回退为线性，无效或不适用的空间切线会被忽略，
动画锚点使用第一段的起始值。诊断会标出受影响的字段。校验失败时，`DSLValidationError.message` 只列出阻断错误，
`issues` 仍保留告警明细。

## 源码结构

```text
src/
  dsl/          DSL schema、发射器形状解析与校验
  dsl2ir/       DSL → Animation IR
    recombine/  使用 preserved data 写回保留的 IR
  ir2dsl/       Animation IR → DSL 与预合成展开
  common/       两个方向共享的值映射
```

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

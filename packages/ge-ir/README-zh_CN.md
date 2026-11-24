# @galacean/ge-ir

[English](./README.md) | 简体中文

Galacean Effects JSONScene 与来源无关 Animation IR 的双向转换。

本包负责 GE 与规范化 IR 的双向转换，并把 GE-only 数据保存在 adapter
自有的保真数据中，供保真导出使用。

## 目录

- [安装](#安装)
- [使用](#使用)
- [输入能力](#输入能力)
- [保真数据](#保真数据)
- [数据边界](#数据边界)
- [公开 API](#公开-api)
- [源码结构](#源码结构)
- [许可证](#许可证)

## 安装

需要 Node.js 24 或更高版本。

```bash
pnpm add @galacean/ge-ir
```

## 使用

### GE 转 Animation IR

```ts
import { convertGEToIR } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, {
  frameRate: 30,
  resourceBaseUrl: 'https://cdn.example.com/scenes/demo.json',
});

console.info(imported.scene);
console.info(imported.diagnostics);
```

`frameRate` 用于把 GE 的秒转换成 IR 的帧。可选的 `resourceBaseUrl` 必须是绝对 URL，用于在 GE
导入边界解析相对的图片和字体 URL。

### 粒子来源数据

`convertGEToIR` 会提取最终宿主布局所需的 ParticleSystem 来源绑定和布局信息：

```ts
import { convertGEToIR } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });

console.info(imported.preservedData.particleSourceData);
```

每个包含 ParticleSystem 的来源 Composition 对应一个 `particleEffectGroup`；每个 ParticleSystem 保留
独立绑定和原始 Item 顺序。由于 GE 不提供主要视觉边界，adapter 保存
`[0, 0, previewWidth, previewHeight]` 作为 fallback `authoringBounds`，并标记 `authoringBoundsSource: 'source_preview'`。
可通过 `particleAuthoringBounds` 按来源 GE Composition ID 提供创作或多帧回放确认的活动区域。没有
ParticleSystem 时 group 和 Layer 数组都为空。源 GE 可以省略未使用的 `animations` 集合；提供时必须为数组。
完整 renderer、shape 和资源数据仍保存在 GE Layer 保真数据中，不进入这份布局索引。

### 粒子空间适配

导入时使用 `convertGEToIR(scene, { frameRate, particleAuthoringBounds: { [compositionId]: {
  bounds: [x, y, width, height], source: 'reviewed_multiframe_playback',
} } })` 记录活动区域和来源；`source` 也可为 `'authored'`。区域必须在源预览画布内，DSL 的
`particleSources[].authoringBounds` 与 GE 的 `sources[].authoringBounds` 应传入同一组区域。

显式来源布局会结合源相机和宿主相机计算 Wrapper，并把缩放、旋转、偏心透视修正烘焙到世界空间运动字段。
源发射器变换保留，普通配对 GE 往返不受影响。`particleFollowParent: true` 会被拒绝；混合 3D 方向、动态源变换、
X/Y 轨道旋转、湍流及无法合并的运动曲线会产生近似诊断。目标框不裁剪粒子。转换前以 30 fps 确定性源回放检查缩放后的发射深度与未缩放的 Z 向运动，
关闭尺寸补偿时也会检查。估算越过宿主 near/far 平面时，按粒子系统和裁剪面用 `GE_PARTICLE_DEPTH_CLIPPED`
报告最早的采样时间。导出保留运动，尺寸统计跳过被裁剪的样本。采样不覆盖全部随机极值或未支持的 3D 操作。

贴图填充率按源 `images[].url` 和序列帧 `col/row/total` 查询包内离线表，忽略 URL 的 query 和 fragment；
切格不同视为不同测量。转换时不下载或解码图片。`src/particle/texture-fill-table.ts` 保存 KiwiBeat v0.1.4
模板库（2026-11-05）的 117 条贴图记录，新增或替换模板后随提供方发布的测量数据更新。
每个 `sources` 条目可传入 `particleTextureFills: { [原始ParticleSystem组件ID]: fill }` 覆盖表值，范围为 `(0, 1]`。
它替代原来的 `particleTextures` 像素输入，调用方应移除像素加载，使用离线表或预先测量的填充率。
`GE_PARTICLE_TEXTURE_FILL` 报告每个系统的填充率及来源（`table`、`given`、`untextured`、`default`）。
无贴图系统按实心圆计算；URL 无法解析、表未收录或切格不匹配时也回退到 `Math.PI / 4`，同时输出
`GE_PARTICLE_TEXTURE_FILL_MISSING`，供调用方记录并反馈缺失的模板测量。
覆盖值无效时输出 `GE_PARTICLE_TEXTURE_FILL_INVALID`，并回退到上述查询逻辑。

`sources[].sizeCompensation` 默认 `true`。先对编辑后的来源做确定性解析回放，结合填充率、可见尺寸和覆盖率，
为每次来源布局取原生显示大小、区域短边 15% 的大粒子尺寸、12% 的覆盖率及封顶 3 四个上限中的最小值，
再限制到 `[1, 3]`，最后烘焙运动。倍率只修改初始粒子尺寸和独立拖尾宽度。
`false` 关闭尺寸补偿但保留空间适配，正数固定倍率；这两种模式跳过填充率查询。
`GE_PARTICLE_SIZE_COMPENSATION` 报告倍率、各项上限与限制因素。固定倍率无效时输出
`GE_PARTICLE_SIZE_COMPENSATION_INVALID` 并使用自动尺寸补偿。统计中的曲线采用关键值线性插值，
不保证 Monte Carlo 统计逐像素一致，也不保证复杂 3D 运动完全还原。

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

### Animation IR 转 GE

```ts
import { convertIRToGE } from '@galacean/ge-ir';

const exported = convertIRToGE(irScene);

console.info(exported.scene);
console.info(exported.diagnostics);
```

`convertIRToGE` 会在转换前校验 IR Scene。`options.duration` 可以覆盖导出时长。

输出采用 GE JSONScene **3.7**：合成和元素通过 `children` 表达层级，不再输出
`CompositionComponent.items`。Timeline 资产和场景绑定继续负责播放与绘制顺序。
文本使用 `autoResize`，字形尺寸与元素缩放分离；输出已使用 GE Player `2.11.0-alpha.1` 验证。
读取旧版平铺元素列表的调用方需要改为遍历 `children`；有 Timeline 绑定的元素按轨道顺序绘制。
GE 导入仍接受 3.6 输入，同时支持导出的 3.7 层级和文本单位。

### 在 GE 往返中保留 GE-only 数据

IR 未发生编辑时，把 `convertGEToIR` 返回的保真数据直接传回 `convertIRToGE`：

```ts
const imported = convertGEToIR(geScene, { frameRate: 30 });
const roundTripped = convertIRToGE(imported.scene, {
  preservedData: imported.preservedData,
});
```

IR Scene 脱离保真数据后仍然合法并且可以独立导出。显式传入保真数据时，
转换器会恢复兼容的 GE 对象池数据、原始动画 payload、mask、预合成 payload、
Sprite 元数据和来源层级等无法在来源无关 IR 中无损表达的信息。
粒子 Layer 需要可信的 GE 保真数据才能导出，因为 renderer、shape 和资源绑定不属于来源无关的粒子契约。

### 使用保留的 GE 数据导出编辑后 IR

IR 发生编辑后，先协调原有保真数据再导出：

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });
const updatedScene = structuredClone(imported.scene);

updatedScene.compositions[0].layers[0].transform = {
  ...updatedScene.compositions[0].layers[0].transform,
  opacity: { type: 'static', value: 0.5 },
};

const updatedPreservedData = updateGEToIRPreservedData(
  imported.scene,
  updatedScene,
  imported.preservedData,
);

const exported = convertIRToGE(updatedScene, {
  preservedData: updatedPreservedData,
});
```

`updateGEToIRPreservedData` 对比基线 IR 和编辑后 IR。它会复制传入的保真数据，
只删除与 IR 变化冲突的 GE 数据，同时移除已删除 Composition 和 Layer 的绑定，
然后返回协调后的新保真数据。它不会修改两个 IR Scene，也不会生成 GE。

修改图层激活区间时，已有动画的时间位置保持不变：保留的贝塞尔、线性和颜色渐变曲线会重新映射到新区间。
规范化 IR 关键帧使用编辑后 Composition 的帧率；仅在 GE sidecar 中表达的动画保留来源数据中的秒数时间。
新插入图层遵循 IR 中相对保留图层的绘制顺序，GE 专属对象保留原有槽位。

## 输入能力

下表描述 GE JSONScene 导入与往返的能力。支持仅适用于表中列出的 IR 子集；部分支持需要近似处理或 GE 保真数据。
原始 payload 被保留不代表它可在 IR 中编辑。

| 能力 | 状态 | 行为 |
| --- | --- | --- |
| Scene 与 Composition | 支持 | 导入全部来源 Composition，并解析入口 Composition。 |
| 常见图层 | 支持 | 图片、纯色、文字、形状、null、预合成及有效 ParticleSystem 层。 |
| 层级与时间 | 支持 | 父层引用、绘制顺序、秒到帧转换和激活时间。 |
| 变换动画 | 部分支持 | 映射可表达的通道和基础缩放乘子；原始编码保留在 sidecar 中。 |
| GE 运行时对象关系 | 保真保留 | Effect、后处理、模型/灯光、FFD、视频、相机控制器及 Animator 仍由 GE 管理。 |
| 组件属性轨道 | 部分支持 | 通过保真数据恢复组件绑定、属性轨道及其 playable asset。 |
| 相机与渲染配置 | 部分支持 | 通过保真数据保留来源相机、深度与渲染设置及几何引用。 |
| Sprite 元数据 | 部分支持 | tint、图集裁剪、纹理采样、图片候选地址和序列帧设置通过保真数据恢复。 |
| 文字与形状 paint | 部分支持 | 规范化文字 metrics；缺少端点的渐变被丢弃并告警。 |
| Mask 引用 | 部分支持 | 单个可解析 mask；多个或无法解析的引用保留在来源专属数据中。 |
| 预合成导出 | 部分支持 | opacity、非零来源起点和 stretch 可能产生诊断；画布裁剪可与 Mask 组合。 |
| 粒子编辑 | 部分支持 | 映射支持的参数；导出需要可信来源的 renderer、shape 和资源。 |
| 粒子透明度动画 | 不支持 | 应用静态 opacity；动画 opacity 在导出时告警。 |
| Luminance matte 导出 | 不支持 | 不生成，并报告 `GE_MATTE_MODE_UNSUPPORTED`。 |
| 其他 Item / 插件类型 | 保真保留 | 未映射子集中的 Item 保存在 sidecar 中，并报告 `GE_RUNTIME_ITEM_PRESERVED`。 |
| 外部资源 | 部分支持 | 用 `resourceBaseUrl` 解析图片、字体、媒体和二进制资源 URL，不下载资源。 |

请检查 `diagnostics` 中的 `normalized`、`approximated`、`dropped` 和 `unsupported` action。
粒子来源缺少有效 `previewSize` 时会报告 `GE_PARTICLE_SOURCE_LAYOUT_UNAVAILABLE`，但粒子仍可导入。
必要数据无效、入口 Composition 缺失、IR 校验失败或保真数据不匹配时可能抛出错误。
转换器不保证任意插件 payload 或所有 GE Runtime 版本都能无损往返。

### Composition 导出

`convertIRToGE` 生成选定的 `entryCompositionId` 及其可达 Precomp 引用链，不生成未引用的 IR 合成及其
图层、组件和时间轴。普通引用复用同一合成；裁剪、蒙版或继承透明度需要实例专属副本时，只生成需要的副本，
不附带未使用的原始合成。导出其他根合成时，先将 `entryCompositionId` 设为目标合成。
通过 `preservedData` 保留的 GE 专属资源仍遵循下文的保真规则。

### Mask 导出

`layer.masks[]`、Precomp 画布裁剪和 Layer matte 组合为 GE `mask.references[]`，每项为
`{ mask: { id: componentId }, inverted: boolean }`。跨 Composition 的 Mask source 保留原层级；
仅在相同坐标空间内消除包含关系明确的冗余正向 Mask。

这是破坏性契约调整：IR 的 `mask: value` 改为 `masks: [value]`，GE 的
`mask: { reference, inverted }` 改为 `mask: { references: [{ mask: reference, inverted }] }`。
导入时兼容旧版单数引用，并转换为 `references[]`；已有的数组引用优先。
导出只生成数组引用，不修改调用方的输入 JSON。播放需要读取 `mask.references[]` 的 Runtime；
工作台使用 GE `2.11.0-alpha.1` 及同版本插件。

正向引用取交集，反向引用扣除。多个正向 Add 需要并集，当前 Runtime 模型无法表达，
额外正向 Add 会被丢弃并报告 `GE_MASK_ADD_UNION_UNSUPPORTED`。
GE 导入仍将多个 references 保存在配对保真数据中，不重建 authored Mask 栈。

## 保真数据

`GEToIRPreservedData` 由本 adapter 管理，存放在 Animation IR 契约之外。需要保持 GE 往返保真时，
应当将它与 IR Scene 成对保存；业务代码不应直接修改其内部字段。

GE 专属 Item 保存在其所属 Composition 的保真绑定中，不创建占位 IR Null 图层。可编辑图层上的附加组件、
Composition 级组件会保留对象引用、时间轴绑定、材质、Shader、几何体、二进制资源和媒体。导出时围绕重建的
IR Item 恢复层级与绘制顺序，并保留场景渲染设置。提供 `resourceBaseUrl` 时，媒体和二进制资源地址与
规范化图片资源一样解析为绝对地址。

Effect、后处理、模型/灯光、FFD、视频、相机控制器和 Animator 通过此路径保真重组。
`GE_RUNTIME_ITEM_PRESERVED` 表示内容已保留，但不能通过 IR 编辑。这些能力依赖配对的 `preservedData`
和兼容的 GE Runtime/插件，不等同于可移植的 IR 能力定义。删除可编辑图层或修改其类型会移除其附加运行时组件；
同级的 GE 专属 Item 仍归 Composition 所有，其内部参数和动画保持原始语义。

Layer 级保真数据可以包含：

- 原始位置、旋转、缩放和颜色动画 payload，以及静态基础缩放；
- 组件属性轨道及其 playable asset、渲染设置和几何引用；
- Sprite 起始颜色、纹理裁剪、采样设置、图片候选地址和序列帧动画设置；
- GE Item 和 Component 标识、Item 时间及独立的 Activation clip 结束行为；
- 无法无损规范化的 mask 和预合成 payload；
- 完整的 ParticleSystem payload；导出时规范化 IR 字段会覆盖其中对应值；
- 原始的单 Item 或 Null/Sprite 层级结构。

顶层 `particleSourceData` 索引最终宿主布局使用的 ParticleSystem 来源边界、来源顺序和 IR 绑定。来源
Composition 缺少有效 `previewSize` 时仍会正常导入 IR，但不会生成其宿主布局绑定，并报告
`GE_PARTICLE_SOURCE_LAYOUT_UNAVAILABLE`。

编辑完整 Scene 时使用 `updateGEToIRPreservedData`。它根据基线和编辑后 IR Scene 的差异计算全部
受支持的失效项；Layer 级查询和失效处理属于包内实现细节。

Composition 绑定还保留来源相机配置。修改图层类型或时间会清除组件属性轨道；内容或边界变化会使属性轨道失效，
opacity 修改会使颜色轨道失效。替换图片会清除对应纹理元数据；修改 scale 会同时清除原始缩放曲线和基础缩放。
Composition 绑定覆盖导入的内容，新建 Composition 不要求来源绑定；粒子层仍必须带有可信 GE payload。
导出保留来源要求的最低 Web Player 版本与二进制数组槽位。

## 数据边界

- `@galacean/animation-ir` 是 Animation IR 类型和校验的唯一真源。
- `GEToIRPreservedData` 属于 `@galacean/ge-ir`，不会嵌入来源无关的 IR Schema。
- 保真数据绑定特定的 IR Composition 和 Layer 标识；复用前会校验 version 和 Scene 绑定。
- 所有来源 Composition 都会导入；来源入口 Composition 会成为 `IRScene.entryCompositionId`。
- 进入 IR 的外部图片和字体资源必须解析为绝对 URL 或 Data URL。
- 转换 diagnostics 用于报告规范化、近似、数据丢弃和不支持的能力。
- 应用通过 Animation IR 组合 GE 与 DSL adapter，两个包的生产代码不得相互依赖。
- 粒子导入会把可编辑的 GE `options` 映射为扁平 IR 粒子字段，并将支持的 GE 标量表达式规范化为 IR 曲线；
  renderer、shape 和资源等引擎字段保留在可信 sidecar 中。GE 的 `options.startLifetime` 使用秒，导入和导出时
  按所属合成的帧率与 IR 的 `startLifetime` 双向换算。导出时应用 `maxParticles`、寿命表达式、
  `rateOverTime`、`bursts`、Layer blend mode、anchor 和静态 opacity，不会伪造 renderer、shape 或资源默认值。
- 粒子随机端点按 IR 范围顺序规范化，曲线裁剪到发射器进度 `[0, 1]`。未编辑的参数导出时恢复原始 GE
  表达式，以保持求值和带种子的随机顺序。负 Item 尺寸转为正的局部边界，并在 scale 通道中表达镜像。
- GE burst 的默认值会规范化为显式的 IR `cycleCount` 和 `repeatIntervalFrames`，包括无限循环，并返回信息性
  normalization diagnostic。GE Item 的 end behavior 进入规范化 Layer；Activation clip 的 end behavior 独立保留
  并在导出时恢复。

相关文档：

- [Animation IR 数据契约](../animation-ir/README-zh_CN.md)
- [DSL Adapter 与编辑契约](../dsl-ir/README-zh_CN.md)

普通层与粒子层统一使用 DSL 初始 `position.z` 排序，值越大越靠上；数组重排不改变层级。
普通子树整体位于根层的排序位置。层级与 GE 对象的映射仅在内部传递，不写入 GE 空间变换。

## 公开 API

### 转换与保真数据

```ts
function convertGEToIR(scene: Record<string, unknown>, options: GEToIROptions): GEToIRResult;

function convertIRToGE(scene: IRScene, options?: IRToGEOptions): IRToGEResult;

function updateGEToIRPreservedData(
  baselineScene: IRScene,
  updatedScene: IRScene,
  preservedData: GEToIRPreservedData,
  options?: UpdateGEToIRPreservedDataOptions,
): GEToIRPreservedData;

```

结果和选项：

```ts
interface GEToIRResult {
  scene: IRScene;
  preservedData: GEToIRPreservedData;
  diagnostics: ConversionDiagnostic[];
}

interface IRToGEResult {
  itemLayerIds: Readonly<Record<string, string>>;
  scene: JSONScene;
  diagnostics: ConversionDiagnostic[];
}

interface GEToIROptions {
  frameRate: number;
  resourceBaseUrl?: string;
}

interface IRToGEOptions {
  duration?: number;
  preservedData?: GEToIRPreservedData;
  sources?: readonly {
    scene: IRScene;
    preservedData: GEToIRPreservedData;
    idMap: Readonly<Record<string, string>>;
  }[];
}
```

`UpdateGEToIRPreservedDataOptions.onChange` 会收到协调过程中被删除字段对应的
Composition、Layer 和字段信息。

### 运行时导出

| 导出 | 用途 |
| --- | --- |
| `convertGEToIR` | 把 GE JSONScene 导入为 Animation IR 和 GE 保真数据 |
| `convertIRToGE` | 把 Animation IR 导出为 GE JSONScene |
| `updateGEToIRPreservedData` | IR 编辑后协调 GE 保真数据 |
| `get2dTo3dRatio` | 计算坐标转换比例 |

### 类型导出

所有公开类型都从包根入口导入：

- 转换：`GEToIROptions`、`GEToIRResult`、`IRToGEOptions` 和 `IRToGEResult`。
- GE 保真数据：`GEToIRPreservedData`。
- 协调处理：`GEToIRPreservedDataChange` 和 `UpdateGEToIRPreservedDataOptions`。

`JSONScene` 由 `@galacean/effects-specification` 定义，应从该包直接导入。

## 源码结构

```text
src/
  ge2ir/                   GE 解析、映射、组装和后处理
  ir2ge/                   IR 转换、GE 生成、组装和后处理
  particle/                粒子 Fragment 提取、布局与宿主 Scene 合并
  common/                  坐标、DataPath、JSON、ID 和数学工具
  conversion.ts            公开转换结果和选项类型
  preserved-data.ts        GE 自有的 Composition 和 Layer 数据契约
  layer-preserved-data.ts  Layer 数据查询和字段失效处理
  update-preserved-data.ts Scene 级保真数据协调
  index.ts                 稳定公开入口
```

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

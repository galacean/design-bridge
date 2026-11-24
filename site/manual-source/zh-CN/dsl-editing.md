# DSL 编辑指南

DSL 是面向人和模型编辑的 JSON，时间用**秒**、颜色用字符串、动画用分段曲线，比 Animation IR 更易读写。
`@galacean/dsl-ir` 提供校验和与 IR 的双向转换。字段定义见 [Composition](../../api/dsl-ir/current/Composition/) 等类型，
权威定义是 [schema.ts](https://github.com/galacean/design-bridge/blob/main/packages/dsl-ir/src/dsl/schema.ts)。

## 文档结构

一个 DSL 文档由 `meta` 和 `layers` 组成：

```ts
import { validateDSL, convertDSLToIR, type Composition } from '@galacean/dsl-ir';

const dsl: Composition = {
  meta: {
    name: 'demo',
    duration: 2, // 秒
    fps: 30,
    width: 750,
    height: 400,
    loop: true,
    background_color: '#101020',
  },
  layers: [{
    id: 'title',
    name: 'title',
    type: 'text',
    width: 400,
    height: 60,
    description: { self: 'Title text', composite: 'Title text' },
    position: {
      a: true,
      animation: [{
        t: [0, 1], // 该段起止时间（秒）
        start: [375, 120, 0],
        end: [375, 200, 0],
        easing: [0.33, 0, 0.67, 1], // 三次贝塞尔
      }],
    },
    opacity: { a: false, value: 1 },
    text: { content: 'Hello', size: 48, color: '#ffffff', align: 'center' },
  }],
};
```

- 图层类型：`null`（变换节点）、`layer`（图片，需要 `asset`）、`text`（需要 `text`）、`particle`（需要 `particle`）。
- 属性用 `{ a: false, value }` 表示静态值，`{ a: true, animation: [...] }` 表示分段动画。相邻段的终点与起点可以不同，
  用来表达瞬时复位。
- `position.z` 的**初始值**决定同级图层的叠放顺序，值越大越靠上；数组顺序不决定遮挡。
- 可省略 `time_range`、`rotation`、`scale`、`anchor`、`opacity`。省略时，保真写回沿用来源值，全新转换使用默认值。
- 文字局部原点为水平对齐点与首行基线的交点，宽高不产生额外平移。转换通过 IR 文字边界偏移完成，父级变换保持不变，
  文字锚点只应用一次。

## 先校验，再转换

`validateDSL` 接受任意输入，永不抛出，返回 `result`（`'pass'` 或 `'fail'`）、`errors` 与 `warnings`：

```ts
const report = validateDSL(dsl);

if (report.result === 'fail') {
  for (const issue of report.errors) {
    console.error(issue.code, issue.path, issue.message);
  }
}
```

每个问题带稳定 `code`、JSON `path` 和可选 `layerId`。人工编辑或模型输出都应先走这一步；
把 `errors` 原样反馈给模型即可让它自我修正。

## 从零创建

全新创建的 DSL 不需要保真数据：

```ts
const { scene, diagnostics } = convertDSLToIR(dsl);
```

转换后的 `scene` 一定满足 Animation IR 契约，可继续 `convertIRToGE`。

## 在已有场景上编辑

从 IR 导出 DSL，并把 `preservedData` 与 DSL 一起保存：

```ts
import { convertIRToDSL } from '@galacean/dsl-ir';

const { dsl, preservedData } = convertIRToDSL(scene);
const edited = structuredClone(dsl);

edited.layers[0].opacity = { a: false, value: 0.5 };

const result = convertDSLToIR(edited, {
  preservedData,
  onChange: change => console.info(change.kind, change.op, change.field),
  onWarning: warning => console.warn(warning.code, warning.message),
});
```

- `onChange` 逐项报告落地的修改；`onWarning` 报告被安全忽略的编辑（如新增图层、修改类型）。warning 不会中断转换。
- `preservedData` 可以 `JSON.stringify` 持久化，但不要修改或依赖其内部结构。
- 保真写回支持既有图层的字段编辑、删除和同父级重排。
- 预合成会在 DSL 中展开；共享实例联动编辑同一来源图层，同一字段的冲突编辑保留原值并报告 warning。
- 无效 DSL、不匹配的保真数据，或无法保留源深度的位置编辑会抛出异常。捕获后保留上一次有效场景，成功后再替换。

## 与 GE 组合

编辑 GE 场景时，GE 与 DSL 的保真数据**各自独立**。DSL 写回得到新 IR 后，要先协调 GE 保真数据再导出：

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });
const editable = convertIRToDSL(imported.scene);
const edited = structuredClone(editable.dsl);

edited.meta.duration = 4;

const updated = convertDSLToIR(edited, { preservedData: editable.preservedData });
const gePreserved = updateGEToIRPreservedData(imported.scene, updated.scene, imported.preservedData);
const output = convertIRToGE(updated.scene, { preservedData: gePreserved });
```

遗漏 `updateGEToIRPreservedData` 会让 GE sidecar 与已编辑的 IR 不一致。

## 粒子图层

粒子是 `type: 'particle'` 的普通图层，可编辑 `options`（`maxCount`、`startLifetime`）和 `emission`
（`rateOverTime`、`bursts`）。

- 数值用 GE `NumberExpression` 的子集：固定值或随机范围；IR 中的曲线会带诊断投影，字段未编辑时由 sidecar 保留。
- `startLifetime`、burst 时间与间隔使用秒，`rateOverTime` 使用每秒粒子数；适配器按粒子所在 IR 合成的帧率换算，包括预合成内部。
- `burst.cycles` 省略或为 `0` 时表示持续重复；只发射一次需显式设置 `cycles: 1`。重复时 `interval`（秒）必须大于 0。
- `shape` 是来源适配器提供的只读发射器几何，用于帮助模型理解，不要手工写回。
- 渲染器、纹理与 GE 专有字段保留在 GE 保真数据中，导出粒子需要原场景或下方各放置来源的可信 GE sidecar。

## 组合粒子来源

使用 `particleSources`，可将既有粒子系统和普通图层放入一份完整目标 DSL。
下例的 `fullDSL` 是通过校验的目标文档，含 ID 为 `target-particle` 的根级粒子叶节点；
`particleGE` 是可信的 GE 3.6 来源，粒子合成需自包含：

```ts
import { convertDSLToIR, convertIRToDSL } from '@galacean/dsl-ir';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';

const particle = convertGEToIR(particleGE, { frameRate: 30 });
const source = convertIRToDSL(particle.scene);
const sourceLayer = source.dsl.layers.find(layer => layer.type === 'particle' && layer.parent == null);

if (sourceLayer === undefined) {
  throw new Error('The source needs a root particle layer');
}
const converted = convertDSLToIR(fullDSL, {
  particleSources: [{
    preservedData: source.preservedData,
    layers: { 'target-particle': sourceLayer.id },
  }],
});
const exported = convertIRToGE(converted.scene, {
  sources: converted.sourceInstances?.map(({ idMap }) => ({ ...particle, idMap })),
});
```

- `layers` 将目标 DSL ID 映射到来源 DSL ID。每个条目把一个系统或完整来源组放入独立 IR Precomp；
  相互耦合的系统必须保持在一起，重复放置使用不同条目。
- 目标必须是根级粒子叶节点，位置为静态，仅绕 Z 轴旋转，XY 等比缩放且 `scale.z = 1`。
  共用一个条目的系统必须具有相同的目标尺寸与放置变换。
- 目标宽高和位置将来源区域等比放入目标，不进行裁剪；`position.z` 决定与普通图层的叠放顺序。
  可选 `authoringBounds` 用于选择来源区域，默认使用完整来源画布。
- 旋转和缩放作用于包装层，不修改来源发射器；克隆来源图层做新布局时应先重置这两个字段。
  名称、透明度、时间与可编辑粒子参数仍更新来源 IR。
- 省略 `time_range` 会将粒子及其祖先延长到宿主时长，显式时间保持不变；`meta.duration` 控制宿主播放窗口。
- 多来源时，将返回的 `sourceIndex` / `idMap` 与对应索引的原始 GE 导入结果配对。
  GE 导出通过 `sources` 恢复并协调来源载荷，DSL 包不读取 GE sidecar。

GE 来源放置会适配世界空间运动，并默认启用精灵尺寸补偿。检查 `GE_PARTICLE_SIZE_COMPENSATION`、
`GE_PARTICLE_TEXTURE_FILL_MISSING`、`GE_PARTICLE_DEPTH_CLIPPED` 等诊断。
每个来源的 `sizeCompensation` 可设为 `false` 或固定正倍率；`particleTextureFills` 按原始 ParticleSystem 组件 ID
提供预计算平均透明度覆盖值。详见
[GE 粒子指南](https://github.com/galacean/design-bridge/blob/main/packages/ge-ir/README-zh_CN.md#粒子空间适配)。

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 编辑后图层顺序没变 | DSL 靠 `position.z` 排序而非数组顺序 | 修改初始 `position.z` |
| 新增图层没有出现 | 保真写回不支持新增图层 | 查看 `onWarning`，改为从 IR 一侧新增 |
| 抛出保真数据不匹配 | 用了另一个场景的 `preservedData` | 与对应 DSL 成对保存 |
| 字号校验失败 | `size`、`line_height` 必须大于 0 | 修正数值 |

继续阅读[保真编辑](../fidelity-editing/)，或回到[最佳实践](../best-practices/)。

# 保真编辑

把可编辑 DSL 和保真 sidecar 成对保存。sidecar 记录投影到 DSL 时无法直接表达的来源数据与映射。

## IR 与 DSL 往返

```ts
import { convertIRToDSL, convertDSLToIR } from '@galacean/dsl-ir';

const editable = convertIRToDSL(scene);
// 编辑 editable.dsl，保留 editable.preservedData。
const restored = convertDSLToIR(editable.dsl, {
  preservedData: editable.preservedData,
});
console.info(restored.scene, restored.diagnostics);
```

[IRToDSLPreservedData](../../api/dsl-ir/current/IRToDSLPreservedData/)必须与生成它的 DSL 配对。不同场景的 sidecar 不能混用。输入不会被转换器修改。

## GE 的来源保真

GE → IR 会返回自己的 `GEToIRPreservedData`。应用分别保管 GE 与 DSL sidecar，并在 IR → GE 时传回 GE 保真数据；IR 被编辑过时，先用 `updateGEToIRPreservedData` 协调，详见 [DSL 编辑指南](../dsl-editing/)；DSL 包不负责处理 GE sidecar。

GE 专有运行时元素、组件轨道、材质、媒体与粒子渲染设置可以保留在这份 sidecar 中。
保留载荷不代表能通过 IR 或 DSL 编辑这些字段，播放仍需匹配的运行时插件。
将粒子来源放入新合成时，通过 `convertIRToGE` 的 `sources` 传入原始导入结果及 ID 映射，由导出阶段协调这些来源。

## 编辑边界

可恢复的不支持编辑会产生诊断；无效 DSL、无效 IR 或不匹配的 sidecar 可能抛出异常。读取诊断并结合实际渲染验证，不把成功返回等同于像素一致。

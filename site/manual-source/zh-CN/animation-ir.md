# Animation IR 模型

Animation IR 是来源无关的二维动画模型。`@galacean/animation-ir` 是类型与校验的唯一真源。

## 场景与合成

[IRScene](../../api/animation-ir/current/IRScene/)保存合成列表、入口合成 ID 和资源注册表。合成引用图层，图层可以再引用共享的预合成；ID 是稳定身份，不能据此推断渲染顺序。

## 时间、坐标与动画

图层包含独立的时间和变换字段。属性可以是静态值或关键帧序列；转换器负责把来源格式的坐标与时间语义映射到 IR。不要直接把一个格式的原始字段复制成 IR。

## 校验

```ts
import { validateIRScene } from '@galacean/animation-ir/validator';

const report = validateIRScene(scene);
if (!report.valid) {
  console.error(report.errors);
}
```

校验报告区分错误和警告。资源可移植性或空内容警告不等同于无效模型。想亲手构建场景，见[构建 Animation IR](../author-animation-ir/)；否则继续阅读[转换链路](../conversion/)。

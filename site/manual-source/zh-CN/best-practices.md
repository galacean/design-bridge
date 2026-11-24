# 最佳实践

本页按场景给出推荐做法，示例为静态代码，不在页面中实时运行。想看实时结果，见[在本地工作台体验](../playground/)。

## 场景一：Lottie 素材上线到 GE

1. 转换后立即用 `validateIRScene` 校验，再生成 GE。
2. 遍历 `diagnostics`，把 `dropped`、`unsupported` 项记录到构建日志；`approximated` 项交给设计抽检。
3. 相对资源路径统一通过 `resourceBaseUrl`（绝对地址）解析；`extractLottieFromZip` 将受支持的包内资源转为 Data URL，
   ZIP 中缺少的外部资源仍需在运行时可访问。
4. 用工作台的帧对比页面验证代表性帧，再批量回归。

```ts
import { validateIRScene } from '@galacean/animation-ir/validator';
import { convertLottieToIR } from '@galacean/lottie2ir';

const { scene, diagnostics } = convertLottieToIR(lottieJSON, { resourceBaseUrl });
const report = validateIRScene(scene);

if (!report.valid) {
  throw new Error('Invalid IR scene');
}
const blocking = diagnostics.filter(item => item.action === 'unsupported');

if (blocking.length > 0) {
  console.warn('Unsupported Lottie features', blocking);
}
```

## 场景二：对已有 GE 做可控编辑（含 AI 编辑）

链路为 `GE → IR → DSL → 编辑 → IR → GE`。关键是保存两份配对数据，并让 DSL 变更保持最小。

```ts
import { convertGEToIR, convertIRToGE, updateGEToIRPreservedData } from '@galacean/ge-ir';
import { convertDSLToIR, convertIRToDSL, validateDSL } from '@galacean/dsl-ir';

const imported = convertGEToIR(geScene, { frameRate: 30 });
const editable = convertIRToDSL(imported.scene);

const nextDSL = await editDSL(editable.dsl); // 人工或模型修改

if (validateDSL(nextDSL).result === 'fail') {
  throw new Error('Invalid DSL');
}
const restored = convertDSLToIR(nextDSL, { preservedData: editable.preservedData });
const gePreserved = updateGEToIRPreservedData(imported.scene, restored.scene, imported.preservedData);
const output = convertIRToGE(restored.scene, { preservedData: gePreserved });
```

- `imported.preservedData`（GE sidecar）与 `editable.preservedData`（DSL sidecar）必须和生成它们的场景一起存储，
  不要跨场景复用。
- DSL 写回得到新 IR 后，必须先 `updateGEToIRPreservedData` 协调 GE sidecar，再导出 GE。
- 模型输出先 `validateDSL`，通过后再转换；校验失败时把问题列表回传给模型修正，而不是静默回退。
- 只修改需要变化的字段，未改动图层交由 sidecar 还原，可以最大程度保留 GE 原有语义。
- `convertDSLToIR` 的 `onChange` / `onWarning` 回调可用于审计本次编辑实际落地了什么。
- GE 与 DSL 两个包互不依赖，由应用层串联；两份 sidecar 分字段保存，只交给各自所属的适配器。

## 场景三：SVG 矢量动画与图文分层

- 需要播放：`convertSVGToGE` 输出 GE；检查 `warnings` 后交给播放器。
- 需要继续编辑：`convertSVGToIR`，再走 DSL 编辑链路。
- 需要拆图层交付：`convertSVGToLayers`，图片资源用 `loadImage` 统一读取并处理鉴权、缓存。
- 浏览器静态导出可把受支持图形烘焙为 PNG；保留数组顺序，检查烘焙警告，并用 `rasterScale` 选择输出分辨率。
  Node 不提供这条浏览器栅格化链路。
- 动态 SVG 的时长来自 SMIL 激活区间；静态 SVG 明确传入 `durationSeconds`，不要依赖默认值。
- 字体在 GE 场景里需要由运行时可用，通过 `fonts` 选项注入。

## 场景四：网页还原为 Figma

- 固定 `viewport`，关闭不需要的脚本，把资源放入 ZIP 或虚拟项目；Node 提取还支持 `networkPolicy: 'offline'`，
  浏览器 API 没有对应的离线开关。
- 浏览器导出时提供字体字节，或获取 Local Font Access 权限；浏览器 `.fig` 生成默认拒绝可见文字缺少字形。
  保留测量位置时使用快照布局，有意需要可重排布局时再启用 Auto Layout。
- 生成文件后检查 `result.validation`，再写入 `result.bytes`。
- 页面中的交互与 CSS 动画不会被还原；把它当作设计稿快照使用。
- 在 Node.js 使用根入口；浏览器使用 `@galacean/html2figma/browser`，不要在浏览器引入 Playwright 链路。

## 场景五：Figma 设计到 GE

```ts
const { message, images } = decodeFigFile(figBytes);
const result = convertFigmaToEffects(message, {}, images);

if (result.issues.length > 0) {
  console.warn(result.issues);
}
```

该包仍在开发中。每次升级后用同一批代表性 `.fig` 回归，重点关注布局、文本和效果的近似项；
需要网页到运行时的完整链路时，由应用显式串联 `html2figma` 与 `figma2ge`，不要期待一步无损。

## 场景六：Shader 作为程序化背景

- 保持单遍 fragment shader，使用 WebGL 1.0 语法；先在目标 GE Runtime 里编译确认。
- 用 `uniformOverrides` 暴露可调参数，用 `channelTextures` 绑定图片纹理，`result.uniforms` 可用于生成参数面板。
- 明确 `duration`、`previewSize` 与 `endBehavior`，不要依赖默认的 5 秒和 512×512。

```ts
const result = convertShaderToGE(fragmentSource, {
  duration: 8,
  previewSize: [1080, 1080],
  uniformOverrides: { uSpeed: 1.5 },
});
```

## 通用工程习惯

| 习惯 | 原因 |
| --- | --- |
| 始终读取诊断、警告或 issues | 转换成功不代表语义无损 |
| 分开保存编辑基线 | GE/IR/DSL 适配器保留输入，Node HTML 导出会更新传入场景节点的字体来源 |
| 保存 sidecar 与对应产物 | 保真数据与场景一一对应 |
| 用小而稳定的样例做回归 | 批量回归才能发现升级带来的差异 |
| 只从包的公开入口导入 | 内部路径不属于稳定契约 |
| 在目标播放器中验证像素 | 校验通过不代表渲染一致 |

深入各场景：[DSL 编辑指南](../dsl-editing/)、[Shader 到 GE 指南](../shader-to-ge/)、[设计文件与网页接入](../design-to-ge/)。

接下来：[常见问题与排查](../troubleshooting/)，然后是[在本地工作台体验](../playground/)。

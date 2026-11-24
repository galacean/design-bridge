# 快速开始

Design Bridge 提供可组合的 TypeScript 转换库。根据输入格式选择包，以 Animation IR 作为共享中间格式。

## 安装

需要 Node.js 24 或更高版本。应用可以单独安装所需包；本仓库开发使用 pnpm 10。

```bash
pnpm add @galacean/lottie2ir @galacean/ge-ir
```

## 第一次转换

```ts
import { convertLottieToIR } from '@galacean/lottie2ir';
import { convertIRToGE } from '@galacean/ge-ir';

const result = convertLottieToIR(lottieJSON);
const effects = convertIRToGE(result.scene);
console.info(result.diagnostics, effects.scene);
```

`lottieJSON` 是你的 Lottie 动画对象。检查 diagnostics 后再保存或播放结果。

## 我该用哪个包

| 输入 | 目标 | 包 |
| --- | --- | --- |
| Lottie JSON / ZIP | GE | `@galacean/lottie2ir` + `@galacean/ge-ir` |
| SVG | GE、IR 或静态图层 | `@galacean/svg2ir` |
| 已有 GE | 可编辑 DSL / IR | `@galacean/ge-ir` + `@galacean/dsl-ir` |
| HTML / CSS | Figma | `@galacean/html2figma` |
| Figma `.fig` | GE | `@galacean/figma2ge` |
| GLSL fragment shader | GE | `@galacean/shader2ge` |

## 推荐阅读顺序

1. [转换链路](../conversion/)：先了解八个包与可选链路，决定要用哪些。
2. [Animation IR 模型](../animation-ir/)、[构建 Animation IR](../author-animation-ir/)：理解共享数据模型。
3. [接入 Lottie 与 SVG](../import-animation/)、[Shader 到 GE 指南](../shader-to-ge/)、[设计文件与网页接入](../design-to-ge/)：按输入选择接入链路。
4. [DSL 编辑指南](../dsl-editing/)、[保真编辑](../fidelity-editing/)：学会 GE ↔ IR ↔ DSL 的往返编辑。
5. [最佳实践](../best-practices/)、[常见问题与排查](../troubleshooting/)：套用推荐做法，按现象定位问题。
6. [在本地工作台体验](../playground/)、[运行环境与限制](../runtime-and-limits/)：实时调试，并了解运行边界。

也可以直接查看 [convertLottieToIR](../../api/lottie2ir/current/convertLottieToIR/) 的输入契约。

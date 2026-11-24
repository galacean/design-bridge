## Design Bridge 解决什么问题

动画与设计素材分散在 Lottie、SVG、Figma、HTML、Shader 和 Galacean Effects（GE）等不同格式中，
每种格式都有自己的数据模型，互相转换往往要逐对手写。Design Bridge 的做法是引入一个
来源无关的中间格式 **Animation IR**，再配一份便于人和 AI 编辑的 **DSL**：

```text
Lottie ─→ Animation IR ←→ GE JSONScene ─→ Galacean Effects 播放器
SVG ────→     ↕
         DSL（可编辑）

SVG ─→ 静态图片层与文本层
GLSL fragment shader ─→ GE JSONScene
HTML/CSS ─→ Figma Scene / .fig ─→ GE JSONScene
```

每个包只负责一段转换，应用按需组合；新增动画适配器可以复用 IR，Shader 和设计文件则使用各自的直接转换链路。

## 适合你的场景

| 你想做什么 | 推荐路径 | 阅读 |
| --- | --- | --- |
| 把 Lottie 动画放进 Galacean Effects | `lottie2ir` → `ge-ir` | [接入 Lottie 与 SVG](./import-animation/) |
| 把 SVG 变成动画场景或分层静态图 | `svg2ir` | [接入 Lottie 与 SVG](./import-animation/) |
| 用代码生成或程序化编辑动画 | `animation-ir` | [构建 Animation IR](./author-animation-ir/) |
| 让用户或 AI 通过 DSL 修改已有 GE 动画 | `ge-ir` + `dsl-ir` | [DSL 编辑指南](./dsl-editing/)、[保真编辑](./fidelity-editing/) |
| 把 GLSL 效果做成 GE 材质 | `shader2ge` | [Shader 到 GE 指南](./shader-to-ge/) |
| 把网页还原为可编辑的设计稿 | `html2figma` | [设计文件与网页接入](./design-to-ge/) |
| 把 Figma 设计稿接入动画运行时 | `figma2ge` | [设计文件与网页接入](./design-to-ge/) |
| 转换结果和预期不一致 | — | [常见问题与排查](./troubleshooting/) |

## 五分钟上手

安装后只需两次调用，就能完成 Lottie 到 GE 的转换：

```ts
import { convertLottieToIR } from '@galacean/lottie2ir';
import { convertIRToGE } from '@galacean/ge-ir';

const result = convertLottieToIR(lottieJSON);
const effects = convertIRToGE(result.scene);

console.info(result.diagnostics, effects.scene);
```

`convertLottieToIR` 是同步函数；两个结果都带有 `diagnostics`，用来告诉你哪些语义被保留、
归一化、丢弃或不受支持。**保存或播放之前先检查诊断**，这是使用所有转换器的基本习惯。
完整的安装与选包说明见[快速开始](./getting-started/)。

## 使用前需要了解的原则

- **转换不承诺无损**：箭头表示已提供的方向，不代表任意素材都能完整还原。结果由输入、诊断和目标运行环境共同决定。
- **IR 是中枢，不是必经之路**：HTML → Figma、Figma → GE、Shader → GE 不经过 Animation IR，按输入与目标选最短链路即可。
- **编辑要走保真链路**：DSL 与 DSL sidecar 成对保存，同时保留独立的 GE sidecar；编辑 IR 后，先协调 GE sidecar 再导出 GE。
- **浏览器与 Node.js 能力不同**：核心转换可在浏览器运行；`html2figma` 根入口等需要 Node.js 与 Playwright。详见[运行环境与限制](./runtime-and-limits/)。

## 选一条学习路径

1. **快速接入**：[快速开始](./getting-started/) → [接入 Lottie 与 SVG](./import-animation/) → [最佳实践](./best-practices/)。目标是尽快把现有素材转成 GE。
2. **理解模型**：[转换链路](./conversion/) → [Animation IR 模型](./animation-ir/) → [构建 Animation IR](./author-animation-ir/)。适合要做二次开发或程序化生成的人。
3. **编辑与回写**：[DSL 编辑指南](./dsl-editing/) → [保真编辑](./fidelity-editing/) → [最佳实践](./best-practices/)。适合搭建编辑器或接入 AI 改写。
4. **设计与 Shader**：[设计文件与网页接入](./design-to-ge/)、[Shader 到 GE 指南](./shader-to-ge/)。

左侧目录按学习顺序列出了全部页面；需要查具体函数签名时，请使用 [API 参考](../api/)。

## 在本地实时体验

手册中的代码是静态示例。想上传真实素材、观察转换结果并调试，可以克隆源码仓库，
运行 `pnpm install && pnpm dev` 启动 `web-packages` 工作台（默认 `http://localhost:8080`）。
各转换页面的入口、输入清单和调试建议见[在本地工作台体验](./playground/)。

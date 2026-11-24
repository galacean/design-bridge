# Design Bridge

[English](./README.md) | 简体中文

Design Bridge 是一个用于转换、校验和编辑设计与动画数据的 TypeScript monorepo。各个包使用 Animation IR
作为来源无关的中间模型，并在需要时生成 Galacean Effects JSONScene。

## 目录

- [安装](#安装)
- [使用](#使用)
- [包](#包)
- [兼容性](#兼容性)
- [演示与文档](#演示与文档)
- [贡献](#贡献)
- [许可证](#许可证)

## 安装

按应用需要安装对应的包，例如：

```bash
pnpm add @galacean/lottie2ir @galacean/ge-ir
```

各个包可以单独安装，其 README 会说明公开入口和运行环境要求。
仓库环境安装与本地开发见[开发指南](./docs/developing.md)。

## 使用

按应用需要组合转换阶段。例如，使用 `@galacean/lottie2ir` 导入 Lottie，再通过 `@galacean/ge-ir` 转为
Galacean Effects；可编辑工作流则结合 `@galacean/dsl-ir` 和同一套 IR。
支持的输入、公开 API、调用示例和保真数据要求见下方各包 README。

## 包

| 包 | 用途 | 文档 |
| --- | --- | --- |
| [`@galacean/animation-ir`](./packages/animation-ir/README-zh_CN.md) | 来源无关的动画 Schema、校验和 Adapter 契约 | [README](./packages/animation-ir/README-zh_CN.md) |
| [`@galacean/dsl-ir`](./packages/dsl-ir/README-zh_CN.md) | 可编辑 DSL 与 Animation IR 转换，以及保真数据写回 | [README](./packages/dsl-ir/README-zh_CN.md) |
| [`@galacean/figma2ge`](./packages/figma2ge/README-zh_CN.md) | Figma `.fig`/Kiwi 数据转换为 Galacean Effects JSONScene | [README](./packages/figma2ge/README-zh_CN.md) |
| [`@galacean/ge-ir`](./packages/ge-ir/README-zh_CN.md) | Galacean Effects JSONScene 与 Animation IR 转换 | [README](./packages/ge-ir/README-zh_CN.md) |
| [`@galacean/html2figma`](./packages/html2figma/README-zh_CN.md) | HTML/CSS 提取为 Figma Scene、剪贴板数据和 `.fig` 文件 | [README](./packages/html2figma/README-zh_CN.md) |
| [`@galacean/lottie2ir`](./packages/lottie2ir/README-zh_CN.md) | 将 Lottie JSON 和 ZIP 导入 Animation IR | [README](./packages/lottie2ir/README-zh_CN.md) |
| [`@galacean/shader2ge`](./packages/shader2ge/README-zh_CN.md) | 将 GLSL Fragment Shader 转换为 Galacean Effects JSONScene | [README](./packages/shader2ge/README-zh_CN.md) |
| [`@galacean/svg2ir`](./packages/svg2ir/README-zh_CN.md) | 将 SVG 导入 Animation IR、GE 场景或静态图片与文字图层 | [README](./packages/svg2ir/README-zh_CN.md) |

包 README 提供输入能力矩阵、API 签名、示例和已知限制。测试 fixture 用于展示回归用例，不代表对完整
格式的支持。

## 兼容性

| 包 | 运行环境与入口说明 |
| --- | --- |
| `@galacean/animation-ir` | Node.js 24+；仅 ESM，提供根入口和 `/adapter` ESM 入口 |
| `@galacean/dsl-ir`、`@galacean/ge-ir`、`@galacean/lottie2ir`、`@galacean/shader2ge`、`@galacean/figma2ge` | Node.js 24+；提供 ESM 和 CommonJS 构建 |
| `@galacean/svg2ir` | Node.js 24+；提供浏览器和 Node 条件入口，Node 入口使用 `svgdom` |
| `@galacean/html2figma` | 根入口和 `node` 入口需要 Node.js 24+；浏览器 bundle 使用包 README 中说明的子路径 |

`@galacean/figma2ge` 需要匹配的 `@galacean/effects` 2.11.0-alpha.1 peer dependency。`@galacean/shader2ge` 负责生成场景；在
浏览器播放还需要 Galacean Effects、WebGL 1.0 和 Web Crypto。格式限制和资源加载行为请以各包 README 为准。

## 演示与文档

- [工作台 README](./web-packages/README-zh_CN.md) 说明本地转换工具和批处理流程。
- [站点 README](./site/README-zh_CN.md) 说明双语手册、API 浏览、浏览器 Demo 和 Pages 部署。
- 在 [GitHub Issues](https://github.com/galacean/design-bridge/issues) 报告问题或提出功能请求。

## 贡献

环境安装、本地工具、检查、构建和清理命令见[开发指南](./docs/developing.md)。
贡献与验证规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

欢迎通过 [GitHub Pull Request](https://github.com/galacean/design-bridge/pulls) 贡献代码。请说明受影响的包、
验证命令、兼容性影响，以及相关 fixture 或资源的授权信息。

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

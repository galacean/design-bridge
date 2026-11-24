# 运行环境与限制

安装转换库时，按其公开入口选择对应运行环境。

## 浏览器与 Node.js

仓库开发和文档说明的 Node.js 使用环境要求 Node.js 24+，仓库使用 pnpm 10+。
浏览器应用应选择兼容的公开入口：

| 包 | 入口与运行环境 |
| --- | --- |
| `animation-ir` | ESM 根入口提供类型，`/validator`、`/adapter` 提供校验与共享适配工具 |
| `ge-ir`、`dsl-ir`、`lottie2ir`、`shader2ge`、`figma2ge` | 公开根入口，提供 ESM 与 CommonJS 构建 |
| `svg2ir` | 根入口条件导出自动选择 Node 的 `svgdom` 初始化或浏览器入口，没有 `/node` 子路径 |
| `html2figma` | 根入口和 `/node` 使用 Playwright Chromium；`/browser` 及其 `/zip`、`/file`、`/clipboard` 入口使用浏览器 API |

Node HTML 提取需安装 Playwright Chromium；浏览器 HTML 提取使用 DOM 与 iframe，无需安装 Playwright。
SVG 图形烘焙还需要浏览器 SVG、Canvas 与图片支持；Node 静态分层可保留原生图片与文本，并对无法烘焙的图形报告警告。

## 资源与播放器

IR、GE、DSL、Lottie 与 SVG 的 IR/GE 转换只解析或保留资源引用，不下载这些资源。
SVG 静态分层会读取并内嵌图片；HTML 提取和导出可能读取字体及其他资源。浏览器读取按需满足 CORS，
各链路应分别配置，不能假定所有转换都离线执行。

GE 播放器需要 WebGL 和场景使用的插件；`figma2ge` 当前要求匹配的 `@galacean/effects@2.11.0-alpha.1` peer。
Shader 播放面向 WebGL 1.0，转换阶段不做 GPU 编译。替换场景或离开页面时销毁播放器；字体、资源可用性与渲染器版本都会影响像素。

## 支持范围

校验检查数据契约，不证明像素一致或资源安全；还应读取转换诊断：

- Lottie 的效果、表达式、3D 特性和不受支持的遮罩栈会被省略或近似；内嵌字形可能转成形状，不再是可编辑文字。
- GE Runtime 图、粒子渲染数据与其他 GE 专有字段依赖配对的 GE 保真数据和运行时插件。
- SVG 的 IR/GE 与静态分层能力不同；烘焙后的静态图形不再保留矢量可编辑性或动画。
- HTML 转换捕获渲染快照；`.fig` 默认使用快照布局，可选推断 Auto Layout。
- Figma 接入仍在开发中；`.fig` 输出应在原生 Figma 中检查，GE 输出应在目标播放器中检查。

限制不可信输入的字节数、解压体积、尺寸与处理时间。HTML 脚本隔离不等同于网络或本地文件沙箱，
详见[设计文件与网页接入](../design-to-ge/)。

## 文档版本

核对 API 参考中选中的包与版本是否匹配应用实际安装的版本。`current` 指向该包当前选定的快照，各包发布版本相互独立。
缺少注释翻译时可能回退到源语言，未注释的符号仍可能展示签名。入口与能力限制以对应包 README 为准。

遇到问题见[常见问题与排查](../troubleshooting/)。返回[快速开始](../getting-started/)，或浏览 [API](../../api/)。

# 在本地工作台体验

站点只提供文档和静态代码示例。要实时运行转换、调参并看到渲染结果，请使用源码仓库中的
`web-packages` 工作台。它是 Vite + React 本地调试应用，不作为 npm 库发布。

## 启动

需要 Node.js 24+ 和 pnpm 10+。

```bash
git clone https://github.com/galacean/design-bridge.git
cd design-bridge
pnpm install
pnpm dev
```

打开 `http://localhost:8080`。工作台没有生产构建命令，只通过开发服务使用。

使用 Node/Playwright HTML 提取链路时，另行安装一次 Chromium：

```bash
pnpm --filter @galacean/html2figma exec playwright install chromium
```

## 按目标选择页面

| 我想… | 打开 | 说明 |
| --- | --- | --- |
| 把 Lottie 转成 GE 并预览、导出视频 | `/lottie2ge` | 第一个推荐体验的页面 |
| 编辑 DSL 并预览 GE | `/dsl2ge` | 在线预览与 JSON 导出 |
| 调试 GLSL Shader | `/shader2ge` | 编辑、调参、GE 预览 |
| 把网页转成 Figma 数据 | `/html2figma` | ZIP / HTML → Figma Scene、剪贴板与 `.fig` |
| 导入 `.fig` 文件 | `/figma2ge` | 解码、转换与场景预览 |
| 编辑 GE 的 DSL 或 IR | `/ge2dsl-bundle`、`/ir-editing` | 拆分、编辑、保真重组 |
| 验证往返是否保真 | `/ge2ir`、`/ge2dsl` | GE 往返对比 |
| 对比渲染差异 | `/frame-test` | Lottie 与 GE 逐帧对比 |
| 对比 SVG 渲染 | `/svg-frame-test` | SVG 与 GE 对比、预览及导出 |
| 批量帧回归 | `/auto-frame-test`、`/ge-auto-frame-test`、`/svg-auto-frame-test` | Lottie、GE 往返或 SVG |
| 校验 DSL | `/dsl-validator` | 格式与语义检查 |

## 建议的学习顺序

1. `/lottie2ge`：加载一个 Lottie，观察转换结果和诊断，与手册[接入 Lottie 与 SVG](../import-animation/)对照。
2. `/ir-editing` 或 `/ge2dsl-bundle`：体验 GE 拆分成可编辑数据再重组，理解[保真编辑](../fidelity-editing/)。
3. `/frame-test`：对同一素材比较源格式与 GE 输出，学会判断近似与丢弃。
4. `/shader2ge`、`/html2figma`、`/figma2ge`：按需体验其余链路。

## 本地输入与输出

本节路径均相对于 `web-packages/`。GE、DSL 与 Lottie 选择器从清单读取 HTTP(S) JSON URL，不扫描本地输入目录：

| 路径 | 用途 |
| --- | --- |
| `tests/fixtures/lottie/urls.txt` | Lottie 转换、帧对比与批量回归 |
| `tests/fixtures/ge/urls.txt` | GE 往返、DSL / IR 编辑 |
| `tests/fixtures/dsl/urls.txt` | DSL 转 GE 与格式校验 |
| `tmp/dsl-input` | GE → DSL 批处理输出，不会加入 DSL 选择器 |
| `tmp/output` | 转换后保存的场景与图片 |
| `tmp/html-input` | HTML/ZIP 临时上传，由 API 清理 |

每行填写一个 URL，忽略空行与重复项。空清单不选择输入，清单缺失或 URL 非法会报错。
浏览器读取需满足 CORS；支持的一次性本地导入可使用文件选择器。
SVG 对比使用 `tmp/svg_input`、`tmp/svg_dynamic_tests/` 下的本地样例，`tmp/` 输出由 Git 忽略。

上方安装命令为 Node HTML 提取准备 Chromium；帧回归 CLI 使用本地 Chrome、Chromium 或 Edge，
自动发现失败时设置 `CHROME_EXECUTABLE`。工作台和本地文件 API 应只在开发机器使用。

## 调试自己的转换

- 修改 `packages/*/src` 后，开发服务会使用 workspace 源码，无需先构建。
- 在页面里复现问题，再把最小输入保存为对应包的测试 fixture。
- 运行单个包的测试：`pnpm --filter @galacean/lottie2ir test`。
- 工作台的详细页面、批处理接口和目录约定见仓库中的
  [web-packages README](https://github.com/galacean/design-bridge/blob/main/web-packages/README-zh_CN.md)。

遇到差异时，先看[运行环境与限制](../runtime-and-limits/)，再到 [API 参考](../../api/)核对契约。

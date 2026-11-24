# @galacean/html2figma

[English](./README.md) | 简体中文

将 HTML 和 CSS 转换为 Figma 中可编辑的图层，可保存为 `.fig` 设计文件，也可复制后粘贴到 Figma。
本地文件和批量转换使用 Node.js；页面内提取和导出使用浏览器入口。

## 目录

- [安装](#安装)
- [使用](#使用)
- [入口](#入口)
- [布局与字体](#布局与字体)
- [导入包含资源的 ZIP](#导入包含资源的-zip)
- [剪贴板输出](#剪贴板输出)
- [限制](#限制)
- [诊断与校验](#诊断与校验)
- [运行时与安全边界](#运行时与安全边界)
- [通过 script 标签接入](#通过-script-标签接入)

## 安装

```bash
pnpm add @galacean/html2figma
```

Node.js 入口需要 Node.js 24 或更高版本，并安装完整的 Playwright Chromium：

```bash
pnpm exec playwright install chromium
```

浏览器调用方只需执行第一条安装命令，并使用下方的 `/browser` 入口。

## 使用

转换分两步：先让浏览器渲染 HTML，提取图层位置、样式和文字等场景数据，再将这些数据导出为文件或剪贴板内容。

### Node.js：HTML 文件转 .fig

```ts
import { writeFile } from 'node:fs/promises';
import { createFigmaFile, extractScene } from '@galacean/html2figma';

const sceneData = await extractScene('/absolute/path/to/page.html', false, {
  scriptPolicy: 'disabled',
});
const result = await createFigmaFile(
  [{ name: 'Imported page', sceneData }],
  { documentName: 'Imported page' },
);

await writeFile('imported-page.fig', result.bytes);
```

默认视口为 390 × 844 CSS 像素，可通过提取选项 `viewport` 调整。
输入为 HTML 字符串时，调用 `extractScene(html, true, options)`；页面需要执行脚本时，设置 `scriptPolicy: 'trusted'`。

### 浏览器：HTML 字符串转 .fig

```ts
import { extractSceneDocumentFromHTML } from '@galacean/html2figma/browser';
import { createFigmaFileFromSceneDocuments, downloadFigmaFile } from '@galacean/html2figma/browser/file';

const html = '<div style="width:320px;height:180px;background:#2563eb"></div>';
const scene = await extractSceneDocumentFromHTML(html, { scriptPolicy: 'disabled' });
const result = await createFigmaFileFromSceneDocuments(scene, { documentName: 'Imported page' });

downloadFigmaFile(result.bytes, 'imported-page.fig');
```

示例使用纯图形，便于在未配置字体时直接运行。包含文字的页面请参阅[布局与字体](#布局与字体)。
这里的 `scene` 包含场景数据和 `diagnostics`，后者记录资源缺失等提取问题。
需要在隔离 iframe 中执行输入脚本时，使用浏览器默认策略 `scriptPolicy: 'sandboxed'`。

## 入口

| 导入路径 | 用途 |
| --- | --- |
| `@galacean/html2figma` | Node.js 提取、剪贴板生成和 `.fig` 导出 |
| `@galacean/html2figma/node` | 根 Node.js API 的别名 |
| `@galacean/html2figma/browser` | 提取 HTML 字符串、已加载的页面文档或包含多个文件的页面 |
| `@galacean/html2figma/browser/zip` | 读取打包了 HTML 和页面资源的 ZIP |
| `@galacean/html2figma/browser/clipboard` | 生成并写入浏览器剪贴板 HTML |
| `@galacean/html2figma/browser/file` | 生成、校验和下载 `.fig` 文件 |

## 布局与字体

`.fig` 默认使用 `layoutMode: 'snapshot'`，保留测量的位置和尺寸。
如果希望在 Figma 中修改内容后让图层自动重新排列，可设置 `layoutMode: 'auto-layout'`，
尝试生成 Figma 的自动布局（Auto Layout）。重新排版可能改变原页面效果。

文字导出需要真实字体文件。下面沿用浏览器示例的导入，替换其中的提取、导出部分；先在应用的 `/fonts/brand-sans.ttf`
放置包含示例文字的字体。CSS 声明用于页面排版，`fonts` 则将同一文件交给导出接口：

```ts
const fontURL = new URL('/fonts/brand-sans.ttf', window.location.href).href;
const response = await fetch(fontURL);

if (!response.ok) {
  throw new Error('Font load failed');
}
const bytes = await response.arrayBuffer();
const html = `
  <style>@font-face { font-family: 'Brand Sans'; src: url('${fontURL}'); }</style>
  <p style="font-family: 'Brand Sans'">Hello Figma</p>
`;
const scene = await extractSceneDocumentFromHTML(html, { scriptPolicy: 'disabled' });
const result = await createFigmaFileFromSceneDocuments(scene, {
  fonts: [{ family: 'Brand Sans', bytes }],
  localFontAccess: 'disabled',
});

downloadFigmaFile(result.bytes, 'imported-text.fig');
```

也可经用户授权读取本机字体（Local Font Access），需 HTTPS 或 localhost 和受支持的 Chromium 浏览器。
`localFontAccess` 的 `auto`（默认）会尝试读取，`disabled` 禁用读取，`required` 在不可用或授权失败时报错。

| `.fig` 导出端 | 缺字时的默认行为 | 调整方式 |
| --- | --- | --- |
| Node.js | 继续导出并警告，缺字可能显示为占位符 | `requireTextGlyphs: true` 拒绝缺字 |
| 浏览器 | 字体不含所需字符时拒绝导出 | `requireTextGlyphs: false` 交由 Figma 重新排版文字 |

交由 Figma 重新排版不保证导入后的文字可见性和排版一致性。
对于通过 CSS 加载的字体，若浏览器用普通样式模拟粗体或斜体，可对支持的情况启用 `rasterizeSyntheticText: true`，
将对应文字保存为图片并记录 `TEXT_RASTERIZED`。这部分文字将无法编辑；默认保留文字。

## 导入包含资源的 ZIP

当页面由 `index.html`、CSS、图片和字体等多个文件组成时，保留它们的相对目录结构并打包成 ZIP。
库会将这些文件组织成 `VirtualProject` 对象，保存要打开的 HTML 文件路径和各文件内容，以便找到页面引用的资源。
下面的 `file` 是用户通过文件选择器选中的 ZIP 文件，`entryPath` 指定从 ZIP 内的 `index.html` 开始渲染：

```ts
import { createVirtualProjectFromZip } from '@galacean/html2figma/browser/zip';
import { extractSceneDocumentFromProject } from '@galacean/html2figma/browser';
import { createFigmaFileFromSceneDocuments, downloadFigmaFile } from '@galacean/html2figma/browser/file';

const project = await createVirtualProjectFromZip(file, { entryPath: 'index.html' });
const scene = await extractSceneDocumentFromProject(project);
const result = await createFigmaFileFromSceneDocuments(scene);

downloadFigmaFile(result.bytes, 'imported-project.fig');
```

缺失的资源会记录在 `scene.diagnostics` 中。
如果已在代码中持有文件路径和内容，可用 `createVirtualProject` 创建同样的对象；
Node.js 根入口同样提供 `extractSceneDocumentFromProject`。

## 剪贴板输出

沿用浏览器示例的 `scene`，先准备数据，再在点击时直接写入剪贴板，随后在 Figma 中粘贴：

```ts
import {
  createFigmaClipboardFromSceneDocuments, writeFigmaClipboardHTML,
} from '@galacean/html2figma/browser/clipboard';

const clipboard = await createFigmaClipboardFromSceneDocuments(scene);
const button = document.createElement('button');

button.textContent = 'Copy to Figma';
button.addEventListener('click', () => {
  void writeFigmaClipboardHTML(clipboard.html).catch(error => console.error(error));
});
document.body.append(button);
```

Node.js 的 `createCurrentFigmaClipboard` 接收与 `createFigmaFile` 相同的场景数组，会异步准备字体并生成剪贴板数据。
`createFigmaClipboard` 是同步版本，需要预先准备本地字体文件。Node.js 接口只生成数据，剪贴板写入由调用应用完成。
剪贴板转换会推导 Figma 自动布局；需要保留测量位置时使用 `.fig` 默认的快照导出。

## 限制

转换结果是渲染后的页面快照，保留支持的图层和文字，不保留 JavaScript 交互、CSS 动画时间线或应用逻辑。

- **布局与样式**：Flex、grid、填充、边框、阴影和独立模糊效果仅支持部分 CSS。
  复杂变换、滤镜链和表格交点可能近似处理。
- **文字**：复杂文字排版、从右到左或竖排文字、同段混用多种字体时，结果可能与浏览器不同。
  水平从左到右文字中的彩色 emoji，以及主动选择转为图片的合成粗体或斜体，都会保存为图片。
- **媒体**：可捕获图片、内联 SVG、可读的 Canvas 像素和静态视频封面。
  内联 SVG 输出为位图，不捕获播放中的视频帧。
- **资源**：字体和图片需要可访问；网络、跨域读取权限、浏览器版本和已安装字体都可能影响结果。

## 诊断与校验

沿用浏览器示例的 `scene` 和 `result`，查看资源、图片捕获问题和字体等导出警告：

```ts
scene.diagnostics.forEach(issue => console.warn(issue.code, issue.message));
result.validation.warnings.forEach(message => console.warn(message));
```

Node.js 使用 `extractSceneDocument` 代替 `extractScene`，也可获取包含 `diagnostics` 的提取结果。
文件生成会拒绝结构校验失败的结果。已有文件可通过 `validateFigmaFile(bytes)` 检查，
也可以在仓库根目录运行：

```bash
make verify-fig FILE="/absolute/path/to/design.fig"
```

诊断不覆盖全部不支持的 CSS。文件结构有效且字体包含所需字符，也不代表外观一致，关键页面应在目标 Figma 版本中检查。

## 运行时与安全边界

| 提取选项 | Node.js 默认值 | 浏览器默认值 |
| --- | --- | --- |
| `scriptPolicy` | `trusted` | `sandboxed` |
| `networkPolicy` | `allow`；`offline` 在提取期间拦截 HTTP(S) | 不提供离线选项 |
| `timeoutMs` | 30 秒 | 60 秒 |
| `maxInputBytes` | 入口 HTML 为 10 MiB | 不提供 |

不需要执行脚本的页面使用 `scriptPolicy: 'disabled'`；浏览器 `trusted` 策略让输入脚本拥有与宿主页面相同的访问权限。
`sandboxed` 在隔离 iframe 中运行输入脚本，但仍允许网络请求。Node 离线模式仍可能读取本地文件，也不控制后续导出。
请在隔离环境中处理不可信的 Node 输入，不要向 HTML 传入密钥或内部服务地址。

## 通过 script 标签接入

也可在 HTML 中通过 script 标签直接加载已打包的浏览器脚本：

```html
<script src="/vendor/html2figma/dist/browser.umd.js"></script>
```

它提供全局对象 `window.Html2Figma`，包含 HTML 提取、`.fig` 生成、下载和校验功能。
例如依次调用 `Html2Figma.extractSceneDocumentFromHTML(html)`、
`Html2Figma.createFigmaFileFromSceneDocuments(scene)` 和 `Html2Figma.downloadFigmaFile(result.bytes)`。

部署时保留包内 `dist/` 与 `data/` 的相对目录关系，并在脚本 URL 中固定版本。
构建会相对于脚本加载 `dist/zstd.wasm` 和 `data/figma-file-schema.bin`。
资源单独部署时，在 script 标签上设置 `data-html2figma-base-url`，值为以 `/` 结尾的绝对包根目录 URL。
跨域部署时，服务器需允许浏览器读取资源（CORS）；如果页面配置了内容安全策略（CSP），
需允许脚本、资源请求和脚本所需的 WebAssembly 模块执行。

完整接入链路见[设计文件与网页接入](../../site/manual-source/zh-CN/design-to-ge.md)。

## 许可证

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

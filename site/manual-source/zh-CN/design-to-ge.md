# 设计文件与网页接入

本章覆盖两个独立于 Animation IR 的方向：HTML/CSS → Figma（`@galacean/html2figma`），以及 Figma `.fig` → GE（`@galacean/figma2ge`）。
两者都需要你显式串联，不是一键无损链路。

## HTML / CSS → Figma

### 选择入口

| 运行环境 | 导入路径 | 说明 |
| --- | --- | --- |
| Node.js | `@galacean/html2figma` 或 `/node` | 基于 Playwright Chromium，可读本地文件 |
| 浏览器 | `@galacean/html2figma/browser` | 基于 iframe 和 `Document`，不依赖 Node.js |
| 浏览器 ZIP | `@galacean/html2figma/browser/zip` | ZIP → `VirtualProject` |
| 浏览器输出 | `@galacean/html2figma/browser/clipboard`、`/browser/file` | 剪贴板、`.fig` 下载 |

### Node.js：HTML 文件 → `.fig`

```ts
import { writeFile } from 'node:fs/promises';
import { createFigmaFile, extractSceneDocument } from '@galacean/html2figma';

const extracted = await extractSceneDocument('/absolute/path/to/page.html', false, {
  viewport: { width: 390, height: 844 },
  scriptPolicy: 'disabled',
  networkPolicy: 'offline',
  timeoutMs: 30_000,
});
const { bytes, validation } = await createFigmaFile(
  [{ name: 'Imported page', sceneData: extracted.root }],
  { documentName: 'Imported page' },
);

console.info(extracted.diagnostics, validation.warnings);
await writeFile('imported-page.fig', bytes);
```

先在使用项目中运行 `pnpm exec playwright install chromium`。`extractSceneDocument` 保留提取诊断，
`extractScene` 只返回场景根节点；两者的第二个参数为 `true` 时接收 HTML 字符串。
结构校验失败会使文件生成抛出异常，成功后仍应检查返回的警告。

### 浏览器：HTML 字符串或 ZIP

```ts
import { extractSceneDocumentFromHTML } from '@galacean/html2figma/browser';
import { createFigmaFileFromSceneDocuments, downloadFigmaFile } from '@galacean/html2figma/browser/file';

const html = '<div style="width:320px;height:180px;background:#2563eb"></div>';
const extracted = await extractSceneDocumentFromHTML(html, {
  viewport: { width: 390, height: 844 },
  scriptPolicy: 'disabled',
});
const result = await createFigmaFileFromSceneDocuments(extracted, { documentName: 'Imported page' });

downloadFigmaFile(result.bytes, 'imported-page.fig');
```

这个纯形状示例不需要字体配置。通过文件选择器获得的 ZIP `file` 可提供本地 CSS、图片和字体：

```ts
import { extractSceneDocumentFromProject } from '@galacean/html2figma/browser';
import { createVirtualProjectFromZip } from '@galacean/html2figma/browser/zip';

const project = await createVirtualProjectFromZip(file, { entryPath: 'index.html' });
const projectDocument = await extractSceneDocumentFromProject(project, { scriptPolicy: 'disabled' });
```

缺失项目资源会在 `diagnostics` 中报告 `RESOURCE_NOT_FOUND`；继续使用同一个 `createFigmaFileFromSceneDocuments`
导出 `projectDocument`。Node 根入口提供自己的 `extractSceneDocumentFromProject`。

### 布局、字体与剪贴板

`.fig` 默认使用 `layoutMode: 'snapshot'`，保留测量的位置与尺寸；`layoutMode: 'auto-layout'` 会推断可重排布局，
可能改变外观。剪贴板生成会推断 Auto Layout。

浏览器支持编码真实字形路径。提供与页面渲染 CSS 匹配的字体字节，或在支持的 Chromium 浏览器中，
通过用户授权和 HTTPS / localhost 使用 Local Font Access。`localFontAccess` 支持 `auto`（默认）、`disabled`、`required`。
已将字体读取为 `fontBytes` 时：

```ts
const result = await createFigmaFileFromSceneDocuments(extracted, {
  fonts: [{ family: 'Brand Sans', bytes: fontBytes, weight: 400 }],
  localFontAccess: 'disabled',
  requireTextGlyphs: true,
});
```

文档应使用相同的字体家族、字重与样式，并在提取前加载 CSS 字体。

| `.fig` 导出端 | 可见文字缺少字形时的默认行为 | 选项 |
| --- | --- | --- |
| Node.js | 警告，可能使用占位字形 | `requireTextGlyphs: true` 拒绝缺字 |
| 浏览器 | 拒绝缺少必需字形 | `requireTextGlyphs: false` 允许可编辑文字回退 |

允许回退不保证在 Figma 中可见或布局一致。水平从左到右文本中的彩色 emoji 可捕获为图片；
提取时设置 `rasterizeSyntheticText: true` 也可将受支持的浏览器合成字体样式捕获为图片，并报告 `TEXT_RASTERIZED`，
这些文字片段不再可编辑。

剪贴板输出先准备数据，再在按钮点击回调中写入：

```ts
import {
  createFigmaClipboardFromSceneDocuments, writeFigmaClipboardHTML,
} from '@galacean/html2figma/browser/clipboard';

const clipboard = await createFigmaClipboardFromSceneDocuments(extracted);

copyButton.addEventListener('click', () => {
  void writeFigmaClipboardHTML(clipboard.html).catch(error => console.error(error));
});
```

`copyButton` 是应用提供的按钮，写入仍受剪贴板权限和安全上下文要求约束。
Node 的 `createCurrentFigmaClipboard` 异步准备数据，实际剪贴板写入由宿主应用完成。

### 安全策略

HTML 提取会运行不可信或半可信内容：

| 策略 | 取值 | 含义 |
| --- | --- | --- |
| 浏览器 `scriptPolicy` | `disabled` / `sandboxed`（默认）/ `trusted` | 不执行 / 隔离 iframe 执行 / 以调用方权限执行 |
| Node `scriptPolicy` | `trusted`（默认）/ `disabled` | 是否执行输入脚本 |
| Node `networkPolicy` | `allow`（默认）/ `offline` | 是否拦截 HTTP(S) 请求 |
| Node `maxInputBytes`、`timeoutMs` | 默认 10 MiB、30 秒 | 入口 HTML 大小与提取期限 |
| 浏览器 `timeoutMs`、`signal` | 默认 60 秒，可选 `AbortSignal` | 提取期限与取消；没有 `maxInputBytes` 选项 |

Node 离线模式**不会**隔离本地文件访问，也不控制后续文件/剪贴板生成。
浏览器 `disabled` 只禁用脚本，不拦截图片/字体请求，沙箱脚本也仍可能请求外部资源。
处理不可信页面时，使用有操作系统级文件/网络限制与资源上限的隔离进程，不要把密钥或内部服务地址放进页面。

### 校验与结果预期

- 生成时会校验 ZIP 条目、节点引用、blob 索引、图片哈希等；务必检查 `validation`。
- 已有 `.fig` 可在仓库根目录用 `make verify-fig FILE="/absolute/path/design.fig"` 做结构检查。
- 结果是**页面快照**：受支持文字可编辑，但 JS 交互、CSS 动画和应用逻辑不会还原；Flex/Grid、渐变、阴影、模糊与表格边框只映射子集。
- 内联 SVG、可读取的 Canvas 像素和静态视频 poster 可捕获为图片，不捕获播放中的视频帧。
  `IMAGE_CAPTURE_MISSING`、`BACKGROUND_IMAGE_CAPTURE_MISSING` 可定位缺失像素。
- 浏览器和 Node 都支持字形生成，但字体解析、整形、回退与权限可能不同；复杂文字、混合字体、从右到左或竖排文字可能不匹配来源。
- Node 文件导出会更新传入场景节点的字体来源；需要保留不变基线时先复制场景。
- 结构有效不代表像素一致；发布前建议在原生 Figma 中冒烟验证。

## Figma `.fig` → GE

```ts
import { convertFigmaToEffects, decodeFigFile } from '@galacean/figma2ge';

const response = await fetch('/scene.fig');
const { message, images } = decodeFigFile(new Uint8Array(await response.arrayBuffer()));
const result = convertFigmaToEffects(message, { compositionName: 'Design', compositionDuration: 5 }, images);

for (const issue of result.issues) {
  console.warn(issue.type, issue.message);
}
```

- `decodeFigFile` 兼容 ZIP 的 stored / deflate 条目，以及 `canvas.fig` 内的 deflate / zstd 数据，可在浏览器运行。
- `ConvertOptions` 支持 `compositionName`、`compositionDuration` 与 `includeInvisibleNodes`。
- `result.scene` 是精简 GE JSONScene，`result.debugMap` 保存 Figma 节点到 GE 元素的映射，便于定位问题。
- `result.issues` 包含 warning 和 error，转换器即使有 issue 也可能返回场景；issues 为空**不**代表完全保真。
- 不支持原型交互，也不能通过 Figma URL / API 读取文件；调用方需自行提供 `.fig` 字节。
- 该包仍在开发中：自动布局、效果、文本和组件会被近似或省略。公开测试前确认 `.fig` 素材的授权。

## 串联：网页 → Figma → GE

两个包没有一键链路：先用 `html2figma` 得到 `.fig` 字节，再按上一节的方式解码并转换。两段各自有诊断与限制，
误差会叠加，因此对关键页面应分别检查 `validation` 与 `issues`，并在 GE Runtime 里目测。串联前请先用代表性页面
确认 `.fig` 能被 `decodeFigFile` 读取。

需要实时体验时，使用工作台的 `/html2figma` 与 `/figma2ge` 页面，见[在本地工作台体验](../playground/)。

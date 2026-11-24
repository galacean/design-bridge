# @galacean/html2figma

English | [简体中文](./README-zh_CN.md)

Convert HTML and CSS into editable Figma layers, then save a `.fig` design file or copy and paste into Figma.
Use Node.js for local files and batch conversion, or the browser entries for in-page extraction and export.

## Contents

- [Install](#install)
- [Usage](#usage)
- [Entry points](#entry-points)
- [Layout and fonts](#layout-and-fonts)
- [Import a page with local assets](#import-a-page-with-local-assets)
- [Clipboard output](#clipboard-output)
- [Limitations](#limitations)
- [Diagnostics](#diagnostics)
- [Runtime and security](#runtime-and-security)
- [Script tag usage](#script-tag-usage)

## Install

```bash
pnpm add @galacean/html2figma
```

Node.js requires version 24 or later and a full Playwright Chromium installation:

```bash
pnpm exec playwright install chromium
```

For browser use, only the package installation is needed; choose a `/browser` entry below.

## Usage

Conversion has two steps: render HTML in a browser and extract layer positions, styles, and text as scene data,
then export that data as a file or clipboard content.

### Node.js: HTML file to .fig

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

The default viewport is 390 × 844 CSS pixels; pass `viewport` in the extraction options to change it.
For an HTML string, call `extractScene(html, true, options)`.
Enable `scriptPolicy: 'trusted'` if the page needs scripts.

### Browser: HTML string to .fig

```ts
import { extractSceneDocumentFromHTML } from '@galacean/html2figma/browser';
import { createFigmaFileFromSceneDocuments, downloadFigmaFile } from '@galacean/html2figma/browser/file';

const html = '<div style="width:320px;height:180px;background:#2563eb"></div>';
const scene = await extractSceneDocumentFromHTML(html, { scriptPolicy: 'disabled' });
const result = await createFigmaFileFromSceneDocuments(scene, { documentName: 'Imported page' });

downloadFigmaFile(result.bytes, 'imported-page.fig');
```

This example uses a shape so it can run without font setup. For text, see [Layout and fonts](#layout-and-fonts).
Here, `scene` contains the scene data and `diagnostics`, which records extraction issues such as missing resources.
Use `scriptPolicy: 'sandboxed'`, the browser default, when input scripts must run in an isolated iframe.

## Entry points

| Import | Use |
| --- | --- |
| `@galacean/html2figma` | Node.js extraction, clipboard generation, and `.fig` export |
| `@galacean/html2figma/node` | Alias for the root Node.js API |
| `@galacean/html2figma/browser` | Extract HTML strings, loaded page documents, or pages made up of multiple files |
| `@galacean/html2figma/browser/zip` | Read a ZIP containing HTML and its page assets |
| `@galacean/html2figma/browser/clipboard` | Generate and write browser clipboard HTML |
| `@galacean/html2figma/browser/file` | Generate, validate, and download `.fig` files |

## Layout and fonts

`.fig` export defaults to `layoutMode: 'snapshot'`, preserving measured positions and dimensions.
To make layers rearrange when content changes in Figma, set `layoutMode: 'auto-layout'` to infer Figma's Auto Layout.
This can change the original appearance.

Text export needs real font files. Reuse the browser example's imports and replace its extraction and export steps.
First serve a font containing the example text at `/fonts/brand-sans.ttf` in your application.
The CSS declaration lays out the page; `fonts` supplies the same file to the exporter:

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

Browsers can also read installed fonts with user permission through Local Font Access, requiring HTTPS or localhost
and a supported Chromium browser. Set `localFontAccess` to `auto` (default) to try access, `disabled` to skip it,
or `required` to reject unavailable or denied access.

| `.fig` exporter | Missing characters by default | Override |
| --- | --- | --- |
| Node.js | Warns; may use placeholders | `requireTextGlyphs: true` rejects missing characters |
| Browser | Rejects fonts missing required characters | `requireTextGlyphs: false` lets Figma lay out the text |

Letting Figma lay out the text does not guarantee visible text or matching layout on import.
For fonts loaded through CSS, when a browser simulates bold or italic from a regular face,
`rasterizeSyntheticText: true` can capture supported cases as images and report `TEXT_RASTERIZED`.
Those runs lose text editability; the default keeps text.

## Import a page with local assets

For a page made up of `index.html`, CSS, images, and fonts, package the files as a ZIP with their relative paths intact.
The library organizes these files into a `VirtualProject` object containing the HTML file to open and all file contents
so it can find the page's referenced assets.
Below, `file` is a ZIP selected through a file picker; `entryPath` selects `index.html` as the page to render:

```ts
import { createVirtualProjectFromZip } from '@galacean/html2figma/browser/zip';
import { extractSceneDocumentFromProject } from '@galacean/html2figma/browser';
import { createFigmaFileFromSceneDocuments, downloadFigmaFile } from '@galacean/html2figma/browser/file';

const project = await createVirtualProjectFromZip(file, { entryPath: 'index.html' });
const scene = await extractSceneDocumentFromProject(project);
const result = await createFigmaFileFromSceneDocuments(scene);

downloadFigmaFile(result.bytes, 'imported-project.fig');
```

Missing assets are recorded in `scene.diagnostics`.
If your code already holds file paths and contents, use `createVirtualProject` to create the same object.
The Node.js root entry also exports `extractSceneDocumentFromProject`.

## Clipboard output

Reuse `scene` from the browser example. Prepare the data first, then write it directly on a button click
and paste into Figma:

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

In Node.js, `createCurrentFigmaClipboard` accepts the same named scene array as `createFigmaFile` and prepares fonts
asynchronously. `createFigmaClipboard` is synchronous and expects prepared local font files. These Node.js APIs generate
data; the calling application writes the clipboard. Clipboard conversion infers Figma Auto Layout;
use the default `.fig` snapshot export to preserve measured positions.

## Limitations

The result is a rendered page snapshot. It preserves supported layers and text, but not JavaScript interaction,
CSS animation timelines, or application logic.

- **Layout and styling:** Flex, grid, fills, borders, shadows, and standalone blur effects support a subset of CSS.
  Complex transforms, filter chains, and table joins may be approximate.
- **Text:** Complex scripts, right-to-left or vertical text, and text mixing fonts may differ from the browser.
  Color emoji in horizontal left-to-right text and opted-in simulated bold or italic are saved as images.
- **Media:** Images, inline SVG, readable Canvas pixels, and static video posters can be captured.
  Inline SVG becomes raster content; playing video frames are not captured.
- **Resources:** Fonts and images must be accessible. Network availability, permission to read cross-origin resources,
  browser versions, and installed fonts can affect the result.

## Diagnostics

Reuse `scene` and `result` from the browser example to inspect resource, image capture, and font export warnings:

```ts
scene.diagnostics.forEach(issue => console.warn(issue.code, issue.message));
result.validation.warnings.forEach(message => console.warn(message));
```

In Node.js, use `extractSceneDocument` instead of `extractScene` to get a result that also includes `diagnostics`.
File generation rejects structurally invalid output. Use `validateFigmaFile(bytes)` to check an existing archive,
or run this command from the repository root:

```bash
make verify-fig FILE="/absolute/path/to/design.fig"
```

Diagnostics do not cover every unsupported CSS feature. A valid file with all required font characters can still look
different; inspect representative pages in the target Figma version.

## Runtime and security

| Extraction option | Node.js default | Browser default |
| --- | --- | --- |
| `scriptPolicy` | `trusted` | `sandboxed` |
| `networkPolicy` | `allow`; `offline` blocks HTTP(S) during extraction | No offline option |
| `timeoutMs` | 30 seconds | 60 seconds |
| `maxInputBytes` | 10 MiB of entry HTML | Not provided |

Use `scriptPolicy: 'disabled'` for pages that do not need scripts. Browser `trusted` gives input scripts the host page's
access permissions; `sandboxed` runs them in an isolated iframe but still allows network requests.
Node offline mode can still read local files and does not control later export operations.
Run untrusted Node input in an isolated environment and keep secrets and internal service URLs out of the HTML.

## Script tag usage

You can also load the bundled browser script directly in HTML:

```html
<script src="/vendor/html2figma/dist/browser.umd.js"></script>
```

It exposes `window.Html2Figma` with HTML extraction, `.fig` generation, download, and validation functions.
For example, call `Html2Figma.extractSceneDocumentFromHTML(html)`, then
`Html2Figma.createFigmaFileFromSceneDocuments(scene)` and `Html2Figma.downloadFigmaFile(result.bytes)`.

Host the package's `dist/` and `data/` directories together and pin the version in the script URL.
The build loads `dist/zstd.wasm` and `data/figma-file-schema.bin` relative to its script.
For separate resource hosting, set `data-html2figma-base-url` on the script to an absolute package-root URL
ending in `/`.
For cross-origin hosting, the server must allow browsers to read the resources (CORS). If the page has a Content
Security Policy (CSP), it must allow the scripts, resource requests, and their required WebAssembly modules to run.

For the wider workflow, see [Design files and web pages](../../site/manual-source/en/design-to-ge.md).

## License

[MIT](./LICENSE) © 2019-present Ant Group Co., Ltd.

# Design files and web pages

This chapter covers the two directions that bypass Animation IR: HTML/CSS → Figma (`@galacean/html2figma`) and Figma
`.fig` → GE (`@galacean/figma2ge`). You compose them explicitly; there is no one-click lossless pipeline.

## HTML / CSS → Figma

### Choose an entry

| Environment | Import path | Notes |
| --- | --- | --- |
| Node.js | `@galacean/html2figma` or `/node` | Playwright Chromium; can read local files |
| Browser | `@galacean/html2figma/browser` | iframe and `Document`; no Node.js dependency |
| Browser ZIP | `@galacean/html2figma/browser/zip` | ZIP → `VirtualProject` |
| Browser output | `@galacean/html2figma/browser/clipboard`, `/browser/file` | Clipboard and `.fig` download |

### Node.js: HTML file → `.fig`

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

Run `pnpm exec playwright install chromium` in the consuming project first. `extractSceneDocument` retains extraction
diagnostics; `extractScene` returns only the scene root. Both accept an HTML string when the second argument is `true`.
File generation throws if structural validation fails; inspect the returned warnings as well.

### Browser: HTML string or ZIP

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

This shape-only example needs no font setup. A ZIP selected as `file` can supply local CSS, images, and fonts:

```ts
import { extractSceneDocumentFromProject } from '@galacean/html2figma/browser';
import { createVirtualProjectFromZip } from '@galacean/html2figma/browser/zip';

const project = await createVirtualProjectFromZip(file, { entryPath: 'index.html' });
const projectDocument = await extractSceneDocumentFromProject(project, { scriptPolicy: 'disabled' });
```

Missing project resources produce `RESOURCE_NOT_FOUND` in `diagnostics`. Export `projectDocument` with the same
`createFigmaFileFromSceneDocuments` function. Node exposes its own `extractSceneDocumentFromProject` at the root entry.

### Layout, fonts, and clipboard

`.fig` output defaults to `layoutMode: 'snapshot'`, preserving measured positions and dimensions.
`layoutMode: 'auto-layout'` infers editable flow layout and may change the appearance.
Clipboard generation infers Auto Layout.

Browsers can encode real glyph paths. Supply font bytes matching the CSS used to render the page, or use Local Font
Access in a supported Chromium browser with user permission and HTTPS or localhost. `localFontAccess` accepts
`auto` (default), `disabled`, or `required`. For explicit font bytes already loaded into `fontBytes`:

```ts
const result = await createFigmaFileFromSceneDocuments(extracted, {
  fonts: [{ family: 'Brand Sans', bytes: fontBytes, weight: 400 }],
  localFontAccess: 'disabled',
  requireTextGlyphs: true,
});
```

The document must use the same family, weight, and style; load its CSS fonts before extraction.

| `.fig` exporter | Default when visible glyphs are missing | Option |
| --- | --- | --- |
| Node.js | Warns and may use placeholders | `requireTextGlyphs: true` rejects missing characters |
| Browser | Rejects missing required glyphs | `requireTextGlyphs: false` allows editable-text fallback |

Allowing fallback does not guarantee visible text or matching Figma layout. Horizontal left-to-right color emoji can
be captured as images. `rasterizeSyntheticText: true` on extraction also captures supported browser-simulated font
styles as images, with `TEXT_RASTERIZED`; those runs lose text editability.

For clipboard output, prepare the data before a button click, then write it from the click handler:

```ts
import {
  createFigmaClipboardFromSceneDocuments, writeFigmaClipboardHTML,
} from '@galacean/html2figma/browser/clipboard';

const clipboard = await createFigmaClipboardFromSceneDocuments(extracted);

copyButton.addEventListener('click', () => {
  void writeFigmaClipboardHTML(clipboard.html).catch(error => console.error(error));
});
```

`copyButton` is your application's button. Clipboard permissions and secure-context requirements apply.
Node's `createCurrentFigmaClipboard` prepares data asynchronously; the host application writes the actual clipboard.

### Security policies

HTML extraction runs untrusted or semi-trusted content:

| Policy | Values | Meaning |
| --- | --- | --- |
| Browser `scriptPolicy` | `disabled` / `sandboxed` (default) / `trusted` | No scripts / isolated iframe / caller's privileges |
| Node `scriptPolicy` | `trusted` (default) / `disabled` | Whether input scripts run |
| Node `networkPolicy` | `allow` (default) / `offline` | Whether HTTP(S) requests are blocked |
| Node `maxInputBytes`, `timeoutMs` | 10 MiB, 30 s by default | Entry HTML size and extraction deadline |
| Browser `timeoutMs`, `signal` | 60 s, optional `AbortSignal` | Deadline and cancellation; no `maxInputBytes` |

Node offline mode does **not** isolate local file access or govern later file/clipboard generation.
Browser `disabled` blocks scripts, not image/font requests; sandboxed scripts may still request external resources.
For untrusted pages, use an isolated process with OS-level file/network restrictions and resource limits.
Keep secrets and internal service URLs out of the page.

### Validation and expectations

- Generation validates ZIP entries, node references, blob indexes, and image hashes; always check `validation`.
- Existing `.fig` files can be structurally checked from the repository root with
  `make verify-fig FILE="/absolute/path/design.fig"`.
- The result is a **page snapshot**: supported text stays editable, but JS interaction, CSS animation, and app logic
  are not restored; Flex/Grid, gradients, shadows, blur, and table borders map a supported subset.
- Inline SVG, readable Canvas pixels, and static video posters can be captured as images; playing video frames are
  not captured. `IMAGE_CAPTURE_MISSING` and `BACKGROUND_IMAGE_CAPTURE_MISSING` identify missing pixel data.
- Browser and Node both support glyph generation, but font resolution, shaping, fallback, and permissions can differ.
  Complex scripts, mixed fonts, and right-to-left or vertical text may not match the source.
- Node file export hydrates font sources on the supplied scene nodes; clone a scene first to keep an unchanged baseline.
- A valid structure does not mean identical pixels; smoke-test in native Figma before publishing.

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

- `decodeFigFile` handles stored / deflate ZIP entries and deflate / zstd data inside `canvas.fig`, and runs in browsers.
- `ConvertOptions` supports `compositionName`, `compositionDuration`, and `includeInvisibleNodes`.
- `result.scene` is a compact GE JSONScene; `result.debugMap` maps Figma nodes to GE items to help locate problems.
- `result.issues` holds warnings and errors, and a scene may be returned even with issues; an empty list does **not**
  mean full fidelity.
- Prototype interactions are unsupported, and files cannot be fetched by Figma URL / API; supply the `.fig` bytes.
- The package is still in development: auto layout, effects, text, and components are approximated or omitted.
  Confirm you are licensed to use a `.fig` asset before publishing tests.

## Chaining: web page → Figma → GE

There is no one-click path: use `html2figma` to get `.fig` bytes, then decode and convert them as in the previous
section. Each stage has its own diagnostics and limits, and errors accumulate, so check `validation` and `issues`
separately for key pages and inspect the result in the GE runtime. Before chaining, confirm with a representative
page that `decodeFigFile` can read the generated `.fig`.

For live experiments, use the workbench `/html2figma` and `/figma2ge` pages; see
[Try it in the local workbench](../playground/).

# web-packages

English | [简体中文](./README-zh_CN.md)

The local Vite + React workbench for Design Bridge. It is a development and validation application, not an npm library.

## Contents

- [Run locally](#run-locally)
- [Pages](#pages)
- [Local files and APIs](#local-files-and-apis)
- [Conversion boundaries](#conversion-boundaries)
- [Project structure](#project-structure)

## Run locally

Development requires Node.js 24+ and pnpm 10+. From the repository root:

```bash
pnpm install
pnpm dev
```

The workbench is served at `http://localhost:8080` and is used through the development server, not a production build.
Run its tests with:

```bash
pnpm --filter web-packages test
```

The frame-regression CLI requires a local Chrome, Chromium, or Edge executable. Set `CHROME_EXECUTABLE` when automatic
discovery does not find it.

See [`Design.md`](./Design.md) for the project UI guidelines.

## Pages

The home page groups tools into conversion, editing, and validation columns. Figma tools belong to conversion.

| Route | Purpose |
| --- | --- |
| `/` | Tool navigation |
| `/lottie2ge` | Lottie conversion, GE rendering checks, and video export |
| `/dsl2ge` | DSL conversion, preview, and JSON export |
| `/shader2ge` | Shader editing, uniform controls, and GE preview |
| `/ge2dsl-bundle` | Split GE into DSL and preserved data, edit, and recombine |
| `/ir-editing` | Split GE into IR and preserved data, edit IR, and compare the regenerated GE preview |
| `/ge2ir` | GE → IR → GE fidelity and normalization checks |
| `/ge2dsl` | Manual GE → IR → DSL → IR → GE fidelity comparison with a user-selected frame rate |
| `/dsl-validator` | Validate the configured DSL inputs for format and semantics |
| `/frame-test` | Single-file Lottie and GE frame comparison |
| `/svg-frame-test` | Single-case SVG and GE frame comparison, preview, and export |
| `/auto-frame-test` | Batch Lottie → GE frame regression |
| `/ge-auto-frame-test` | Batch GE round-trip frame regression |
| `/svg-auto-frame-test` | Batch SVG → GE frame regression |
| `/figma2ge` | Figma file import, conversion, and scene preview |
| `/html2figma` | Browser or Playwright HTML/ZIP to Figma Scene and clipboard conversion |

System, Light, and Dark themes are available; the selection is saved locally.

### Video export and scene storage

Video export defaults to the active GE composition's `previewSize`; `saveToVideo` accepts `width` and `height` overrides.
Frames render with 2× sampling, scaled down proportionally when required by GPU texture limits, before composition at
output resolution. MP4 uses H.264, `yuv420p`, and CRF 18. Odd dimensions are padded to even numbers, and logs show the
actual render and output sizes. Frames are composited onto an opaque background before encoding. The default is black;
custom transparent or translucent backgrounds are first composited over black, preserving smooth translucent edges.

The video export tab loads on demand. Export supports cancellation; leaving the tab stops the task and releases the
player, encoder, and temporary URLs. This workflow requires browser Canvas, WebGL, and Workers; use the video export
tab on `/lottie2ge`.

Saving a scene and its images writes the copied images and `result.json` to a separate directory under `tmp/output`.
If an image cannot be saved, no manifest is generated and the page reports the failure. HTTP(S) and embedded images are
supported; unsupported relative paths or temporary URLs fail explicitly.

## Local files and APIs

The local file APIs live in `server/` and are registered through a Vite plugin in `vite.config.js`.

- GE, DSL, and Lottie inputs come exclusively from `tests/fixtures/<format>/urls.txt` (`ge`, `dsl`, or `lottie`).
  Each line is an HTTP(S) JSON URL; blank lines and duplicates are ignored. Empty manifests select no inputs;
  missing manifests and invalid URLs produce errors. Switching files, editing source text, or clearing input
  cancels stale reads.
- Conversion and frame comparison pages fetch inputs directly in the browser. The CDN must allow cross-origin
  requests; resource URLs must be public or embedded in the JSON.
- `POST /api/ge2dsl/batch-validate` starts a background job using the configured GE inputs and writes local
  `tmp/dsl-input/*.dsl.json` outputs. Inputs use a stable URL hash as the output filename and their own URL as the
  resource base. Generated files are not added to the DSL input list. `GET` returns progress and per-input results.
- The DSL validator uses `@galacean/dsl-ir`'s TypeScript `validateDSL` in both the browser and Vite middleware.
- `GET /api/dsl-validator/check` validates the DSL manifest URLs; `POST` validates raw JSON text.
- Run the validator regression command with `pnpm --filter web-packages test:dsl-validator`.

SVG tests use local cases in `tmp/svg_input` and `tmp/svg_dynamic_tests/`; tags and notes are in `tmp/svg2ge-case-tags.json`.
Batch reports can be filtered or exported. After confirmation, a completed static run can update `tmp/fail-list.txt`.
The old `/svg2ge?fixture=…` and `/svg-auto-frame-test.html` links remain supported.

### Input manifests and output directories

Paths below are relative to `web-packages`. GE, DSL, and Lottie use URL manifests; conversion outputs stay local.

| Path | Consumers |
| --- | --- |
| `tests/fixtures/lottie/urls.txt` | Lottie conversion, single-file comparison, and batch frame regression |
| `tests/fixtures/ge/urls.txt` | Shared GE inputs for round-trip comparison, editing, and regression |
| `tests/fixtures/dsl/urls.txt` | Shared DSL inputs for conversion and validation |
| `tmp/dsl-input` | GE→DSL batch output |
| `tmp/output` | GE scenes and images generated by Lottie conversion, available for preview |
| `tmp/html-input` | Temporary HTML-to-Figma uploads, automatically cleaned by the API |

The Lottie scripts also read `tests/fixtures/lottie/urls.txt`:

- `node scripts/batch-convert.js [--limit 10] [--filter URL-substring]` writes `tmp/output/<URL hash>.json`.
- `node scripts/local-convert.js` writes `tmp/output/<URL hash>/result.json` and local image copies under `images/`.

Select inputs by editing the manifest (or using the batch filters). Script arguments and input APIs do not accept local
file paths. The removed `/api/{ge2ir,dsl2ge,lottie2ge}/read-input/` endpoints are replaced by direct URL fetches.
Browser file-picker imports remain available for explicit one-off inputs.

Shader examples come from the page and Figma files are imported by the user; these tools do not require fixed input
directories. Keep screenshots, frame reports, diagnostic scripts, and browser caches in the operating system's temporary
directory.

Repository setup and validation commands are in the [development guide](../docs/developing.md).

## Conversion boundaries

`src/features/dsl-conversion/ge-dsl-workflow.ts` composes the adapters explicitly:

- `convertGEToDSL` returns DSL, `GEDSLPreservedData`, and diagnostics.
- `convertDSLToGE` creates a GE scene from plain DSL or writes edits back with paired `preservedData`.

The application owns source selection, editing state, and paired preserved data. `dsl-ir` owns DSL format, validation,
source instance layout, and parameter reconstruction; `ge-ir` owns GE ↔ IR and GE resource
reassembly from source sidecars. The two production packages remain independent.
Run `pnpm --filter web-packages test` to verify application orchestration.

`GEDSLPreservedData` pairs the two adapter sidecars:

```ts
interface GEDSLPreservedData {
  ir: IRToDSLPreservedData;
  ge: GEToIRPreservedData;
}
```

Changing the source GE or import frame rate in the DSL editor clears the previous DSL, preserved data, and result;
a new editing baseline must be generated. Uploaded DSL and preserved data must come from the same baseline and can
be read independently.

### IR editing

`/ir-editing` generates editable Animation IR from source GE. Applying changes calls `updateGEToIRPreservedData`
against the baseline IR, then `convertIRToGE` to generate GE. The page displays diagnostics, original and edited
previews, and GE export. Editing capabilities follow the current `ge-ir` contract.

Save `ir.json` together with `preserved-data.json`. The sidecar contains source GE, baseline IR, and GE preserved data;
the page maintains it and displays it as read-only. Restore the sidecar before importing edited IR. Every apply starts
from the original baseline, without overwriting it or cumulatively clearing preserved fields. Changing the source GE
or import frame rate resets editing state.

## Project structure

```text
web-packages/
├── src/
│   ├── app.tsx          # Lazy page routes and theme entry
│   ├── components/      # Generic controls, JSON editors, and headers
│   ├── features/        # Local inputs, GE preview, conversion, video, and frame comparison
│   ├── pages/           # Page views, page-specific state, and workflows
│   ├── styles/          # Theme variables and shared CSS
│   └── theme/           # Theme state and persistence
├── server/              # Vite local file APIs; Node.js only
├── scripts/             # Standalone command-line tools
├── tests/               # Application regression tests
├── index.html
└── vite.config.js       # Aliases, development configuration, and local API plugin registration
```

### Module boundaries

Pages own layout and interaction. The IR and DSL editing pages use `use-ir-editing.ts` and `use-dsl-editing.ts` for
import, editing, preserved data, and conversion state. They share file lists, JSON editors, and scene comparison views,
while retaining their distinct data rules.

Shared capabilities in `features/` include:

- `local-inputs`: URL manifest APIs, cancellable input loading, JSON downloads, and list views.
- `ge-runtime`: runtime plugin registration, imported directly by players and renderers without requiring another page.
- `ge-preview`: shared players, active composition metadata, and before/after previews.
- `dsl-conversion`: explicit application composition of GE ↔ IR ↔ DSL.
- `frame-comparison`: metrics, rendering, previews, and batch regression reports.
- `ge-video`: video rendering and encoding.

Pages cannot import other pages; shared code belongs in `features/` or `components/`. Shared capabilities cannot import
`pages/`. Browser code cannot import `server/`, `scripts/`, or private source paths across package boundaries. ESLint
enforces these boundaries for both TS and TSX.

`server/vite-file-api-plugin.js` registers endpoints implemented in `server/file-api/`. Conversion endpoints load public
package entries or explicit application workflows through Vite's module loader for consistent source resolution. These
APIs serve local development and are not a production backend.

Global styles contain theme variables and shared controls; home, editing, and regression styles load from
their own entries. Keep new routes independent to avoid loading rendering, conversion, and video dependencies on home.

Vitest collects `tests/**/*.test.ts`, `src/**/*.test.{ts,tsx}`, and `server/**/*.test.js`. Browser Mocha regression suites
remain in each regression page's `frame-regression.spec.ts` and run through the page. Local API integration tests use
temporary directories and self-contained inputs without reading the user's `tmp/` data.

### Frame comparison

Each synchronous GE seek resets a seeded random sequence so both sides use identical random inputs for particles.
The random function is restored immediately after seek, including on errors, without affecting asynchronous resource
loading. Pixel and contour thresholds are not relaxed for particles.

SSIM uses visible color composited onto black. Pixel comparison and heatmaps include visible RGB and alpha differences,
so transparency changes are detected while invisible RGB in fully transparent pixels is ignored. Both sides pass
through PNG and the same Canvas 2D pixel-reading pipeline to avoid WebGL premultiplied-alpha differences. Sequential
GE round-trip comparisons store original frames as PNG to avoid retaining many uncompressed frames.
